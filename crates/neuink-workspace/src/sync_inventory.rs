//! Read-only sync preview. No caches, credentials, runtime files or destructive cleanup.
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    io::{self, Read},
    path::Path,
};

#[derive(Debug, Serialize)]
pub struct SyncFile {
    pub path: String,
    pub hash: String,
    pub size: u64,
}
#[derive(Debug, Default, Serialize)]
pub struct SyncInventory {
    pub files: Vec<SyncFile>,
    pub logical_bytes: u64,
    pub unique_bytes: u64,
    pub omitted_files: usize,
    pub omitted_bytes: u64,
    pub entries: Vec<SyncEntryCheck>,
    pub validated_entities: usize,
    pub validated_attachment_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct SyncEntryCheck {
    pub entry_id: String,
    pub entity_count: usize,
    pub issue: Option<String>,
    pub notices: Vec<crate::sync_export::ExportNotice>,
}

pub(crate) fn selected(parts: &[&str]) -> bool {
    if parts.len() < 3 || parts[0] != "entries" {
        return false;
    }
    if parts.iter().any(|p| p.starts_with('.')) {
        return false;
    }
    let name = parts[parts.len() - 1];
    if parts.len() == 3 {
        return matches!(
            name,
            "entry.meta.json"
                | "paper.pdf"
                | "paper.segments.json"
                | "paper.annotations.json"
                | "paper.translation.json"
                | "paper.sentence-translations.json"
                | "paper.paragraph-translations.json"
                | "paper.folds.json"
                | "segment-notes.json"
        );
    }
    if parts[2] == "notes" {
        return name.ends_with(".md")
            || name.ends_with(".links.json")
            || parts.iter().any(|p| p.ends_with(".assets"));
    }
    if parts[2] == "mineru-output" {
        // File existence is not a reconstruction proof. Retain all recovery
        // candidates until the real download/apply path passes reconstruction.
        return true;
    }
    false
}

pub fn preview(root: &Path) -> io::Result<SyncInventory> {
    let root = root.canonicalize()?;
    let mut report = SyncInventory::default();
    let mut hashes = BTreeMap::<String, u64>::new();
    let entries = root.join("entries");
    if !entries.exists() {
        return Ok(report);
    }
    fn visit(
        root: &Path,
        dir: &Path,
        report: &mut SyncInventory,
        hashes: &mut BTreeMap<String, u64>,
    ) -> io::Result<()> {
        for item in fs::read_dir(dir)? {
            let item = item?;
            let path = item.path();
            let metadata = fs::symlink_metadata(&path)?;
            if metadata.file_type().is_symlink() || !path.canonicalize()?.starts_with(root) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "同步预览拒绝外部链接",
                ));
            }
            if metadata.is_dir() {
                visit(root, &path, report, hashes)?;
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            let relative = path
                .strip_prefix(root)
                .map_err(io::Error::other)?
                .to_string_lossy()
                .replace('\\', "/");
            let parts: Vec<_> = relative.split('/').collect();
            if !selected(&parts) || crate::sync_export::is_source_cache(root, parts[1])? {
                report.omitted_files += 1;
                report.omitted_bytes += metadata.len();
                continue;
            }
            let mut file = fs::File::open(&path)?;
            let mut hasher = blake3::Hasher::new();
            let mut buffer = [0u8; 65536];
            let mut size = 0;
            loop {
                let n = file.read(&mut buffer)?;
                if n == 0 {
                    break;
                }
                hasher.update(&buffer[..n]);
                size += n as u64;
            }
            let after = file.metadata()?;
            if size != metadata.len() || after.modified()? != metadata.modified()? {
                return Err(io::Error::other("文件在预览期间发生变化，请重试"));
            }
            let hash = hasher.finalize().to_hex().to_string();
            report.logical_bytes += size;
            if hashes.insert(hash.clone(), size).is_none() {
                report.unique_bytes += size;
            }
            report.files.push(SyncFile {
                path: relative,
                hash,
                size,
            });
        }
        Ok(())
    }
    visit(&root, &entries, &mut report, &mut hashes)?;
    report.files.sort_by(|a, b| a.path.cmp(&b.path));
    let mut validated_hashes = BTreeMap::new();
    for item in fs::read_dir(&entries)? {
        let item = item?;
        if !item.file_type()?.is_dir() {
            continue;
        }
        let entry_id = item.file_name().to_string_lossy().to_string();
        if crate::sync_export::is_source_cache(&root, &entry_id)? { continue; }
        let check = match crate::sync_export::export_entry(&root, &entry_id) {
            Ok(bundle) => {
                let manifest = bundle.manifest();
                report.validated_entities += manifest.documents.len();
                for document in &manifest.documents {
                    for resource in &document.resources {
                        validated_hashes.insert(resource.hash.clone(), resource.size);
                    }
                }
                SyncEntryCheck {
                    entry_id,
                    entity_count: manifest.documents.len(),
                    issue: None,
                    notices: manifest.notices.clone(),
                }
            }
            Err(error) => SyncEntryCheck {
                entry_id,
                entity_count: 0,
                issue: Some(error.to_string()),
                notices: Vec::new(),
            },
        };
        report.entries.push(check);
    }
    report.entries.sort_by(|a, b| a.entry_id.cmp(&b.entry_id));
    report.validated_attachment_bytes = validated_hashes.values().sum();
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn previews_dedup_without_deleting_original_parse_data() {
        let dir = tempfile::tempdir().unwrap();
        let entry = dir.path().join("entries/a");
        fs::create_dir_all(entry.join("mineru-output")).unwrap();
        fs::write(entry.join("paper.pdf"), b"same").unwrap();
        fs::write(entry.join("paper.segments.json"), b"{}").unwrap();
        fs::write(entry.join("mineru-output/image.jpg"), b"same").unwrap();
        fs::write(entry.join("mineru-output/full.zip"), b"archive").unwrap();
        fs::write(entry.join("paper.reading.json"), b"local").unwrap();
        let report = preview(dir.path()).unwrap();
        assert_eq!(report.files.len(), 4);
        assert_eq!(report.logical_bytes, 17);
        assert_eq!(report.unique_bytes, 13);
        assert_eq!(report.omitted_files, 1);
        assert!(report.entries[0].issue.is_some());
        assert_eq!(report.validated_entities, 0);
        assert!(entry.join("mineru-output/full.zip").exists());
    }
    #[test]
    fn retains_unconverted_parse_sources_and_excludes_machine_data() {
        assert!(selected(&["entries", "a", "mineru-output", "full.zip"]));
        assert!(!selected(&["cache", "a", "token.json"]));
        assert!(!selected(&["entries", "a", ".trash", "note.md"]));
        assert!(selected(&[
            "entries",
            "a",
            "notes",
            "n.assets",
            "figure.png"
        ]));
    }
}
