//! Bounded, disposable UI cache. Network publication still exports and verifies bytes.
use neuink_workspace::{sync_control::entry_status_stamp, sync_export, Workspace};
use std::{collections::BTreeMap, path::PathBuf, sync::{Mutex, OnceLock}, time::{Duration, Instant}};
type Documents = BTreeMap<String, serde_json::Value>;
struct Cached { stamp: String, checked: Instant, bytes: usize, docs: Documents }
static CACHE: OnceLock<Mutex<BTreeMap<PathBuf, Cached>>> = OnceLock::new();

pub(super) fn documents(workspace: &Workspace, id: &str) -> Result<Documents, String> {
    let root = workspace.layout().root();
    let key = root.canonicalize().map_err(|e| e.to_string())?.join("entries").join(id);
    let before = entry_status_stamp(root, id).map_err(|e| e.to_string())?;
    let cache = CACHE.get_or_init(Default::default);
    {
        let entries = cache.lock().map_err(|e| e.to_string())?;
        if let Some(entry) = entries.get(&key) {
            if entry.stamp == before && entry.checked.elapsed() < Duration::from_secs(300) {
                return Ok(entry.docs.clone());
            }
        }
    }
    let bundle = sync_export::export_entry(root, id).map_err(|e| e.to_string())?;
    let docs = bundle.manifest().documents.iter().map(|doc|
        Ok((doc.entity_id.clone(), super::wire::encode(doc)?))).collect::<Result<Documents, String>>()?;
    let after = entry_status_stamp(root, id).map_err(|e| e.to_string())?;
    if before != after { return Err("条目正在更新，请稍后重新检查".into()); }
    let mut entries = cache.lock().map_err(|e| e.to_string())?;
    // Large libraries remain correct even when their manifests exceed the cache budget.
    let bytes = serde_json::to_vec(&docs).map_err(|e| e.to_string())?.len();
    if bytes > 1024 * 1024 { return Ok(docs); }
    entries.remove(&key);
    while entries.len() >= 512 || entries.values().map(|entry| entry.bytes).sum::<usize>() + bytes > 64 * 1024 * 1024 {
        let oldest = entries.iter().min_by_key(|(_, entry)| entry.checked).map(|(key, _)| key.clone());
        if let Some(oldest) = oldest { entries.remove(&oldest); } else { break; }
    }
    entries.insert(key, Cached { stamp: after, checked: Instant::now(), bytes, docs: docs.clone() });
    Ok(docs)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unchanged_entry_reuses_export_but_note_and_journal_changes_invalidate() {
        let dir = tempfile::tempdir().unwrap();
        let ws = Workspace::create(dir.path()).unwrap();
        let entry = ws.create_entry("Paper").unwrap();
        let first = documents(&ws, entry.id.as_str()).unwrap();
        let key = dir.path().canonicalize().unwrap().join("entries").join(entry.id.as_str());
        let checked = CACHE.get().unwrap().lock().unwrap()[&key].checked;
        assert_eq!(documents(&ws, entry.id.as_str()).unwrap(), first);
        assert_eq!(CACHE.get().unwrap().lock().unwrap()[&key].checked, checked);
        ws.create_note(&entry.id, "Unsynced note").unwrap();
        assert_ne!(documents(&ws, entry.id.as_str()).unwrap(), first);
        std::fs::write(dir.path().join("content-operation.journal.json"), b"{}").unwrap();
        assert!(documents(&ws, entry.id.as_str()).is_err());
    }
}
