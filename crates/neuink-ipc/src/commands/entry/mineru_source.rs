// UnRAR source is used only to read RAR archives. Its original license is
// distributed as apps/desktop/src-tauri/resources/unrar-license.txt.
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Cursor, Read, Write},
    path::{Component, Path, PathBuf},
};

use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const MAX_ENTRIES: usize = 10_000;
const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;

pub(crate) fn read_mineru_source(path: &Path) -> Result<Vec<u8>, String> {
    if path.is_dir() {
        return zip_directory(path);
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if extension.eq_ignore_ascii_case("zip") {
        let size = fs::metadata(path).map_err(|error| error.to_string())?.len();
        check_size(size, MAX_TOTAL_BYTES)?;
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        validate_zip(&bytes)?;
        return Ok(bytes);
    }
    if extension.eq_ignore_ascii_case("rar") {
        return zip_rar(path);
    }
    Err("请选择 MinerU 解析结果目录、ZIP 或 RAR 压缩包。".into())
}

fn safe_name(path: &Path) -> Result<String, String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let part = part.to_str().ok_or("结果文件名不是有效文本。")?;
                let stem = part
                    .split('.')
                    .next()
                    .unwrap_or_default()
                    .to_ascii_uppercase();
                let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                    || (stem.len() == 4
                        && (stem.starts_with("COM") || stem.starts_with("LPT"))
                        && stem.as_bytes()[3].is_ascii_digit());
                if part.contains(':')
                    || part.contains('\\')
                    || part.ends_with(' ')
                    || part.ends_with('.')
                    || part.is_empty()
                    || reserved
                {
                    return Err("结果包含无效文件路径。".into());
                }
                parts.push(part);
            }
            _ => return Err("结果包含不安全的文件路径。".into()),
        }
    }
    if parts.is_empty() {
        return Err("结果包含空文件路径。".into());
    }
    Ok(parts.join("/"))
}

fn check_size(size: u64, limit: u64) -> Result<(), String> {
    if size > limit {
        return Err("MinerU 结果过大，请选择单篇论文的完整解析结果。".into());
    }
    Ok(())
}

fn validate_zip(bytes: &[u8]) -> Result<(), String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| format!("无法读取 MinerU ZIP：{error}"))?;
    if archive.len() > MAX_ENTRIES {
        return Err("MinerU 结果包含过多文件。".into());
    }
    let mut total = 0u64;
    let mut names = HashSet::new();
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = safe_name(Path::new(file.name()))?;
        if !names.insert(name.to_ascii_lowercase()) && !file.is_dir() {
            return Err("MinerU 结果包含重名文件。".into());
        }
        check_size(file.size(), MAX_FILE_BYTES)?;
        total = total.saturating_add(file.size());
        check_size(total, MAX_TOTAL_BYTES)?;
        if !file.is_dir() {
            let copied = std::io::copy(&mut file, &mut std::io::sink())
                .map_err(|error| format!("MinerU ZIP 文件损坏：{error}"))?;
            if copied != file.size() {
                return Err("MinerU ZIP 文件大小与内容不符。".into());
            }
        }
    }
    Ok(())
}

fn zip_directory(root: &Path) -> Result<Vec<u8>, String> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::<(PathBuf, String, u64)>::new();
    let mut total = 0u64;
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
            if metadata.file_type().is_symlink() {
                return Err("解析结果目录包含链接文件，请选择原始结果目录。".into());
            }
            if metadata.is_dir() {
                pending.push(path);
            } else if metadata.is_file() {
                let relative = path.strip_prefix(root).map_err(|error| error.to_string())?;
                let name = safe_name(relative)?;
                check_size(metadata.len(), MAX_FILE_BYTES)?;
                total = total.saturating_add(metadata.len());
                check_size(total, MAX_TOTAL_BYTES)?;
                files.push((path, name, metadata.len()));
                if files.len() > MAX_ENTRIES {
                    return Err("MinerU 结果包含过多文件。".into());
                }
            }
        }
    }
    files.sort_by(|left, right| left.1.cmp(&right.1));
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for (path, name, expected_size) in files {
        writer
            .start_file(name, SimpleFileOptions::default())
            .map_err(|error| error.to_string())?;
        let mut input = File::open(path).map_err(|error| error.to_string())?;
        let copied = std::io::copy(&mut input, &mut writer).map_err(|error| error.to_string())?;
        if copied != expected_size {
            return Err("解析结果目录在导入期间发生变化，请重试。".into());
        }
    }
    writer
        .finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|error| error.to_string())
}

fn zip_rar(path: &Path) -> Result<Vec<u8>, String> {
    let mut archive = unrar::Archive::new(path)
        .open_for_processing()
        .map_err(|error| format!("无法读取 MinerU RAR：{error}"))?;
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let mut total = 0u64;
    let mut count = 0usize;
    while let Some(header) = archive.read_header().map_err(|error| error.to_string())? {
        let entry = header.entry();
        count += 1;
        if count > MAX_ENTRIES {
            return Err("MinerU 结果包含过多文件。".into());
        }
        let name = safe_name(&entry.filename)?;
        if entry.is_split() || entry.is_encrypted() {
            return Err("暂不支持分卷或加密 RAR，请导出完整的单个结果包。".into());
        }
        if entry.is_directory() {
            archive = header.skip().map_err(|error| error.to_string())?;
            continue;
        }
        check_size(entry.unpacked_size, MAX_FILE_BYTES)?;
        total = total.saturating_add(entry.unpacked_size);
        check_size(total, MAX_TOTAL_BYTES)?;
        let (data, next) = header.read().map_err(|error| error.to_string())?;
        check_size(data.len() as u64, MAX_FILE_BYTES)?;
        writer
            .start_file(name, SimpleFileOptions::default())
            .map_err(|error| error.to_string())?;
        writer.write_all(&data).map_err(|error| error.to_string())?;
        archive = next;
    }
    let bytes = writer
        .finish()
        .map_err(|error| error.to_string())?
        .into_inner();
    validate_zip(&bytes)?;
    Ok(bytes)
}

pub(crate) fn source_pdf(zip_bytes: &[u8]) -> Result<Option<String>, String> {
    let mut archive = ZipArchive::new(Cursor::new(zip_bytes)).map_err(|error| error.to_string())?;
    let mut preferred = Vec::new();
    let mut fallback = Vec::new();
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = file.name();
        if name.to_ascii_lowercase().ends_with("_origin.pdf") {
            preferred.push(name.to_owned());
        }
        if name.to_ascii_lowercase().ends_with(".pdf") {
            fallback.push(name.to_owned());
        }
    }
    let candidates = if preferred.is_empty() {
        fallback
    } else {
        preferred
    };
    if candidates.len() > 1 {
        return Err("结果中包含多个 PDF，请选择单篇论文的结果目录。".into());
    }
    let selected = candidates.into_iter().next();
    if let Some(name) = &selected {
        let mut file = archive.by_name(name).map_err(|error| error.to_string())?;
        let mut signature = [0u8; 5];
        file.read_exact(&mut signature)
            .map_err(|error| error.to_string())?;
        if &signature != b"%PDF-" {
            return Err("结果中的原 PDF 文件无效。".into());
        }
    }
    Ok(selected)
}

pub(crate) fn source_pdf_hash(zip_bytes: &[u8], name: &str) -> Result<String, String> {
    let mut archive = ZipArchive::new(Cursor::new(zip_bytes)).map_err(|error| error.to_string())?;
    let mut file = archive.by_name(name).map_err(|error| error.to_string())?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 { break; }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

pub(crate) fn validate_single_result(zip_bytes: &[u8]) -> Result<(), String> {
    let mut archive = ZipArchive::new(Cursor::new(zip_bytes)).map_err(|error| error.to_string())?;
    let mut documents = HashSet::new();
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = file.name().to_ascii_lowercase();
        let prefix = name
            .strip_suffix("_content_list_v2.json")
            .or_else(|| name.strip_suffix("_content_list.json"))
            .or_else(|| name.strip_suffix("content_list_v2.json"))
            .or_else(|| name.strip_suffix("content_list.json"));
        if let Some(prefix) = prefix {
            documents.insert(prefix.to_owned());
        }
    }
    if documents.len() > 1 {
        return Err("所选目录包含多篇论文的解析结果，请选择其中一篇的结果目录。".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directory_is_packed_with_relative_paths() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("images")).unwrap();
        fs::write(root.path().join("paper_content_list.json"), b"[]").unwrap();
        fs::write(root.path().join("images/figure.png"), b"image").unwrap();
        let bytes = read_mineru_source(root.path()).unwrap();
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert!(archive.by_name("paper_content_list.json").is_ok());
        assert!(archive.by_name("images/figure.png").is_ok());
    }

    #[test]
    fn zip_rejects_parent_path() {
        assert!(safe_name(Path::new("../paper.pdf")).is_err());
    }

    #[test]
    fn rar_is_converted_to_zip() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("result.rar");
        fs::write(&path, include_bytes!("fixtures/unicode-entry.rar")).unwrap();
        let bytes = read_mineru_source(&path).unwrap();
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert_eq!(archive.len(), 1);
        let mut content = String::new();
        archive
            .by_index(0)
            .unwrap()
            .read_to_string(&mut content)
            .unwrap();
        assert_eq!(content, "foobar\n");
    }
}
