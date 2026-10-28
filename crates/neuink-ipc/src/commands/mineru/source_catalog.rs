use std::{collections::BTreeSet, fs, path::Path};

use serde::Serialize;

const MAX_VISITED: usize = 20_000;
const MAX_ARCHIVES: usize = 300;
const MAX_ITEMS: usize = 250;
const MAX_DEPTH: usize = 4;

#[derive(Clone, Debug, Serialize)]
pub(super) struct MineruItem {
    pub id: String,
    pub path: String,
    pub title: String,
    pub kind: &'static str,
    pub has_pdf: bool,
}

#[derive(Debug, Default)]
pub(super) struct Catalog {
    pub items: Vec<MineruItem>,
    pub truncated: bool,
}

#[cfg(test)]
pub(super) fn scan_root(root: &Path) -> Result<Catalog, String> {
    scan_root_interruptible(root, || false)
}

pub(super) fn scan_root_interruptible(
    root: &Path,
    cancelled: impl Fn() -> bool,
) -> Result<Catalog, String> {
    if !root.is_dir() {
        return Err("MinerU 结果目录不存在，请重新选择。".into());
    }
    let mut pending = vec![(root.to_path_buf(), 0usize)];
    let mut result_dirs = BTreeSet::new();
    let mut archives = Vec::new();
    let mut visited = 0usize;
    let mut catalog = Catalog::default();
    while let Some((directory, depth)) = pending.pop() {
        if cancelled() {
            return Err("MinerU 查找已取消。".into());
        }
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) if directory != root => continue,
            Err(_) => return Err("无法读取 MinerU 结果目录。".into()),
        };
        for entry in entries.flatten() {
            if cancelled() {
                return Err("MinerU 查找已取消。".into());
            }
            visited += 1;
            if visited > MAX_VISITED {
                catalog.truncated = true;
                break;
            }
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if depth < MAX_DEPTH && !skip_directory(&path) {
                    pending.push((path, depth + 1));
                }
            } else if kind.is_file() {
                let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                if is_content_list(&name) {
                    result_dirs.insert(directory.clone());
                } else if name.ends_with(".zip") || name.ends_with(".rar") {
                    if archives.len() < MAX_ARCHIVES {
                        archives.push(path);
                    } else {
                        catalog.truncated = true;
                    }
                }
            }
        }
        if visited > MAX_VISITED {
            break;
        }
    }
    for directory in result_dirs {
        if cancelled() {
            return Err("MinerU 查找已取消。".into());
        }
        if catalog.items.len() >= MAX_ITEMS {
            catalog.truncated = true;
            break;
        }
        if let Some(item) = inspect_directory(&directory) {
            catalog.items.push(item);
        }
    }
    for path in archives {
        if cancelled() {
            return Err("MinerU 查找已取消。".into());
        }
        if catalog.items.len() >= MAX_ITEMS {
            catalog.truncated = true;
            break;
        }
        if let Some(item) = inspect_archive(&path, &cancelled) {
            catalog.items.push(item);
        }
    }
    if cancelled() {
        return Err("MinerU 查找已取消。".into());
    }
    catalog
        .items
        .sort_by(|left, right| left.title.to_lowercase().cmp(&right.title.to_lowercase()));
    Ok(catalog)
}

fn skip_directory(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| {
            matches!(
                name.to_ascii_lowercase().as_str(),
                "images"
                    | "__macosx"
                    | "node_modules"
                    | ".git"
                    | "cache"
                    | "code cache"
                    | "gpucache"
                    | "indexeddb"
                    | "local storage"
                    | "session storage"
            )
        })
}

fn is_content_list(name: &str) -> bool {
    name.ends_with("content_list_v2.json") || name.ends_with("content_list.json")
}

fn inspect_directory(path: &Path) -> Option<MineruItem> {
    let names = fs::read_dir(path)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            entry
                .file_type()
                .ok()
                .filter(|kind| kind.is_file())
                .map(|_| entry.file_name().to_string_lossy().into_owned())
        })
        .collect::<Vec<_>>();
    make_item(path, "directory", &names)
}

fn inspect_archive(path: &Path, cancelled: &impl Fn() -> bool) -> Option<MineruItem> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    let names = if extension == "zip" {
        let file = fs::File::open(path).ok()?;
        let mut archive = zip::ZipArchive::new(file).ok()?;
        if archive.len() > 10_000 {
            return None;
        }
        let mut names = Vec::with_capacity(archive.len());
        for index in 0..archive.len() {
            if cancelled() {
                return None;
            }
            names.push(archive.by_index(index).ok()?.name().to_owned());
        }
        names
    } else if extension == "rar" {
        let archive = unrar::Archive::new(path).open_for_listing().ok()?;
        let mut names = Vec::new();
        for entry in archive.take(10_001) {
            if cancelled() {
                return None;
            }
            names.push(entry.ok()?.filename.to_string_lossy().into_owned());
        }
        names
    } else {
        return None;
    };
    if names.len() > 10_000 {
        return None;
    }
    make_item(path, if extension == "zip" { "zip" } else { "rar" }, &names)
}

fn make_item(path: &Path, kind: &'static str, names: &[String]) -> Option<MineruItem> {
    let content = names
        .iter()
        .find(|name| is_content_list(&name.to_ascii_lowercase()))?;
    let origin = names
        .iter()
        .find(|name| name.to_ascii_lowercase().ends_with("_origin.pdf"));
    let pdf = origin.or_else(|| {
        names
            .iter()
            .find(|name| name.to_ascii_lowercase().ends_with(".pdf"))
    });
    let title = origin
        .map(|name| {
            name.rsplit(['/', '\\'])
                .next()
                .unwrap_or(name)
                .trim_end_matches("_origin.pdf")
                .to_owned()
        })
        .or_else(|| {
            content.rsplit(['/', '\\']).next().map(|name| {
                name.trim_end_matches("_content_list_v2.json")
                    .trim_end_matches("_content_list.json")
                    .to_owned()
            })
        })
        .filter(|value| !looks_like_uuid(value))
        .filter(|value| value != "content_list" && value != "content_list_v2")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| folder_title(path));
    let path = path.canonicalize().ok()?;
    let id = blake3::hash(path.to_string_lossy().as_bytes())
        .to_hex()
        .to_string();
    Some(MineruItem {
        id,
        path: path.to_string_lossy().into_owned(),
        title,
        kind,
        has_pdf: pdf.is_some(),
    })
}

fn folder_title(path: &Path) -> String {
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let value = stem
        .rsplit_once(".pdf-")
        .filter(|(_, suffix)| looks_like_uuid(suffix))
        .map(|(title, _)| title)
        .unwrap_or(&stem);
    value.trim().to_owned()
}

fn looks_like_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::{write::SimpleFileOptions, ZipWriter};

    #[test]
    fn finds_result_folder_and_zip_without_entering_images() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("paper/auto");
        fs::create_dir_all(folder.join("images")).unwrap();
        fs::write(folder.join("paper_content_list.json"), b"[]").unwrap();
        fs::write(folder.join("paper_origin.pdf"), b"%PDF-1.4").unwrap();
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file("other_content_list.json", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"[]").unwrap();
        writer
            .start_file("other_origin.pdf", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"%PDF-1.4").unwrap();
        fs::write(
            root.path().join("other.zip"),
            writer.finish().unwrap().into_inner(),
        )
        .unwrap();
        let catalog = scan_root(root.path()).unwrap();
        assert_eq!(catalog.items.len(), 2);
        assert!(catalog.items.iter().all(|item| item.has_pdf));
        assert!(catalog.items.iter().any(|item| item.title == "paper"));
    }

    #[test]
    fn names_uuid_output_from_its_result_folder_and_stops_when_cancelled() {
        let root = tempfile::tempdir().unwrap();
        let folder = root
            .path()
            .join("Readable Paper.pdf-f4d9b92f-2f00-4979-8fda-9101e49bb1d9");
        fs::create_dir(&folder).unwrap();
        fs::write(
            folder.join("07cb00c3-f50a-4a51-b3ed-df08c65d3cb9_content_list_v2.json"),
            b"[]",
        )
        .unwrap();
        fs::write(
            folder.join("07cb00c3-f50a-4a51-b3ed-df08c65d3cb9_origin.pdf"),
            b"%PDF-1.4",
        )
        .unwrap();
        let catalog = scan_root(root.path()).unwrap();
        assert_eq!(catalog.items.len(), 1);
        assert_eq!(catalog.items[0].title, "Readable Paper");
        assert!(scan_root_interruptible(root.path(), || true)
            .unwrap_err()
            .contains("已取消"));
    }
}
