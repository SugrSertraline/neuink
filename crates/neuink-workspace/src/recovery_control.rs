//! Explicit recovery controls remain available even when normal opening fails.
//! Keeping current files archives the intent and cached recovery bytes; it never
//! overwrites current user files or claims to roll back already-published writes.
use crate::{
    atomic_write_json,
    sync_export::files::{fingerprint, safe_path},
    tag_transaction::lock_metadata,
    Workspace,
};
use serde::Serialize;
use serde_json::Value;
use std::{collections::BTreeSet, fs, path::Path};
const JOURNALS: [&str; 6] = [
    "sync-apply.journal.json",
    "content-operation.journal.json",
    "child-trash.journal.json",
    "entry-lifecycle.journal.json",
    "tag-operation.journal.json",
    "source-note-import.journal.json",
];
#[derive(Serialize)]
pub struct RecoveryItem {
    pub name: String,
    pub token: String,
    pub bytes: u64,
    pub cache_files: usize,
}
fn root(path: &Path) -> Result<std::path::PathBuf, String> {
    let root = path.canonicalize().map_err(|_| "无法定位资料库")?;
    let marker = safe_path(&root, "neuink.workspace.json").map_err(|_| "资料库标记路径无效")?;
    let value: Value = serde_json::from_slice(&fs::read(marker).map_err(|_| "资料库标记缺失")?)
        .map_err(|_| "资料库标记无效")?;
    if value["schema_version"] != 1 {
        return Err("资料库版本不受支持".into());
    }
    Ok(root)
}
fn cached_hashes(value: &Value, out: &mut BTreeSet<String>) {
    match value {
        Value::Object(values) => {
            for (key, value) in values {
                if key == "hash" {
                    if let Some(hash) = value.as_str() {
                        if hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                            out.insert(hash.to_owned());
                        }
                    }
                }
                cached_hashes(value, out);
            }
        }
        Value::Array(values) => {
            for value in values {
                cached_hashes(value, out);
            }
        }
        _ => {}
    }
}
fn record(root: &Path, name: &str) -> Result<(Vec<u8>, BTreeSet<String>), String> {
    if !JOURNALS.contains(&name) {
        return Err("恢复记录类型无效".into());
    }
    let path = safe_path(root, name).map_err(|_| "恢复记录路径无效")?;
    if fs::metadata(&path).map_err(|_| "恢复记录缺失")?.len() > 128 * 1024 * 1024 {
        return Err("恢复记录过大，请保留原文件进行人工处理".into());
    }
    let bytes = fs::read(path).map_err(|_| "无法读取恢复记录")?;
    let mut hashes = BTreeSet::new();
    // Malformed records can still be preserved verbatim rather than trapping opening forever.
    if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
        cached_hashes(&value, &mut hashes);
    }
    Ok((bytes, hashes))
}
pub fn inspect(path: &Path) -> Result<Vec<RecoveryItem>, String> {
    let _guard = lock_metadata().map_err(|e| e.to_string())?;
    let root = root(path)?;
    let mut items = Vec::new();
    for name in JOURNALS {
        if safe_path(&root, name).map_err(|e| e.to_string())?.exists() {
            let (bytes, hashes) = record(&root, name)?;
            items.push(RecoveryItem {
                name: name.into(),
                token: blake3::hash(&bytes).to_hex().to_string(),
                bytes: bytes.len() as u64,
                cache_files: hashes.len(),
            });
        }
    }
    Ok(items)
}
pub fn retry(path: &Path) -> Result<(), String> {
    Workspace::open_existing(path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}
pub fn keep_current(path: &Path, name: &str, token: &str) -> Result<String, String> {
    let _guard = lock_metadata().map_err(|e| e.to_string())?;
    let root = root(path)?;
    let (bytes, hashes) = record(&root, name)?;
    if blake3::hash(&bytes).to_hex().as_str() != token {
        return Err("恢复记录已变化，请重新读取".into());
    }
    let id = neuink_domain::EntryId::new();
    let archive = format!(".neuink-recovery-archives/{id}");
    let destination = safe_path(&root, &archive).map_err(|e| e.to_string())?;
    fs::create_dir_all(destination.join("blobs")).map_err(|_| "无法创建恢复归档")?;
    for hash in hashes {
        let source =
            safe_path(&root, &format!(".neuink-sync/blobs/{hash}")).map_err(|e| e.to_string())?;
        if !source.exists() {
            continue;
        }
        let before = fingerprint(&source).map_err(|e| e.to_string())?;
        let copy = destination.join("blobs").join(&hash);
        fs::copy(&source, &copy).map_err(|_| "无法保留恢复附件")?;
        if fingerprint(&copy).map_err(|e| e.to_string())? != before {
            return Err("归档校验失败，原恢复记录仍保留".into());
        }
    }
    atomic_write_json(destination.join("decision.json"),&serde_json::json!({"action":"keep_current","journal":name,"token":token,"note":"Current files were retained. Already published writes were not rolled back."})).map_err(|_|"无法保存恢复决定")?;
    let source = safe_path(&root, name).map_err(|e| e.to_string())?;
    if fs::read(&source).map_err(|_| "无法核对恢复记录")? != bytes {
        return Err("恢复记录已变化，未移走".into());
    }
    // Automatic sync remains paused until the user reviews the surviving files.
    atomic_write_json(
        safe_path(&root, "sync-control.json").map_err(|e| e.to_string())?,
        &crate::sync_control::SyncControl { paused: true },
    )
    .map_err(|_| "无法暂停同步")?;
    fs::rename(&source, destination.join("journal.json")).map_err(|_| "无法完成恢复记录归档")?;
    Ok(destination.to_string_lossy().into_owned())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn archive_preserves_available_recovery_bytes_without_changing_current_files() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let entry = workspace.create_entry("Existing content").unwrap();
        let bytes = b"unpublished downloaded note";
        let hash = blake3::hash(bytes).to_hex().to_string();
        let cache = dir.path().join(".neuink-sync/blobs");
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join(&hash), bytes).unwrap();
        let record = serde_json::to_vec(
            &serde_json::json!({"changes":[{"hash":hash,"path":"not-a-valid-journal"}]}),
        )
        .unwrap();
        fs::write(dir.path().join(JOURNALS[0]), &record).unwrap();
        let items = inspect(dir.path()).unwrap();
        assert_eq!(items[0].cache_files, 1);
        let archive = keep_current(dir.path(), JOURNALS[0], &items[0].token).unwrap();
        assert_eq!(
            fs::read(Path::new(&archive).join("blobs").join(&hash)).unwrap(),
            bytes
        );
        assert_eq!(
            fs::read(Path::new(&archive).join("journal.json")).unwrap(),
            record
        );
        assert_eq!(
            workspace.read_entry(&entry.id).unwrap().title,
            "Existing content"
        );
        assert_eq!(fs::read(cache.join(hash)).unwrap(), bytes);
    }
    #[test]
    fn stale_archive_is_refused_and_current_files_and_original_record_survive() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let entry = workspace.create_entry("Preserved").unwrap();
        let path = dir.path().join(JOURNALS[0]);
        fs::write(&path, b"broken recovery record").unwrap();
        assert!(Workspace::open_existing(dir.path()).is_err());
        let preview = inspect(dir.path()).unwrap();
        assert!(keep_current(dir.path(), JOURNALS[0], "stale").is_err());
        assert!(path.exists());
        let archive = keep_current(dir.path(), JOURNALS[0], &preview[0].token).unwrap();
        assert_eq!(
            fs::read(Path::new(&archive).join("journal.json")).unwrap(),
            b"broken recovery record"
        );
        let opened = Workspace::open_existing(dir.path()).unwrap();
        assert_eq!(opened.read_entry(&entry.id).unwrap().title, "Preserved");
        assert!(opened.sync_control().unwrap().paused);
    }
}
