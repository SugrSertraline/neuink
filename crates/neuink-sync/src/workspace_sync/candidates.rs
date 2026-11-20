//! Disposable observation hints. Durable replica/outbox state remains authoritative.
use super::wire;
use crate::replica::Replica;
use neuink_sync_protocol::document::EntityDocument;
use neuink_workspace::{sync_journal::WorkspaceSyncBinding, Workspace};
use std::{
    collections::BTreeMap,
    fs, io,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, UNIX_EPOCH},
};

const AUDIT_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
// Parallel tests create many independent profiles in one process. Production
// retains only the small number of recently used desktop libraries.
const MAX_LIBRARIES: usize = if cfg!(test) { 128 } else { 8 };
#[derive(Default)]
struct Library {
    binding: String,
    audited: Option<Instant>,
    entries: BTreeMap<String, Cached>,
}
struct Cached {
    stamp: String,
    documents: Vec<EntityDocument>,
    bytes: usize,
    checked: Instant,
}
fn cache() -> &'static Mutex<BTreeMap<PathBuf, Library>> {
    static CACHE: OnceLock<Mutex<BTreeMap<PathBuf, Library>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}
fn binding_key(binding: &WorkspaceSyncBinding) -> String {
    format!(
        "{}:{}:{}:{}",
        binding.server_id, binding.account_id, binding.library_id, binding.epoch
    )
}
pub(super) fn due(workspace: &Workspace) -> bool {
    let Ok(cache) = cache().lock() else {
        return true;
    };
    cache
        .get(workspace.layout().root())
        .and_then(|c| c.audited)
        .is_none_or(|at| at.elapsed() >= AUDIT_INTERVAL)
}
pub(super) fn invalidate(workspace: &Workspace) {
    if let Ok(mut cache) = cache().lock() {
        cache.remove(workspace.layout().root());
    }
}
pub(super) fn invalidate_entries(workspace: &Workspace, entries: &[String]) {
    if let Ok(mut cache) = cache().lock() {
        if let Some(library) = cache.get_mut(workspace.layout().root()) {
            for entry in entries {
                library.entries.remove(entry);
            }
        }
    }
}
pub(super) fn invalidate_candidates(workspace: &Workspace) {
    if let Ok(mut cache) = cache().lock() {
        if let Some(library) = cache.get_mut(workspace.layout().root()) {
            library.entries.clear();
        }
    }
}
/// A new session/binding or explicit audit starts with fresh resource fingerprints.
pub(super) fn begin(workspace: &Workspace, binding: &WorkspaceSyncBinding) -> Result<bool, String> {
    let mut cache = cache().lock().map_err(|_| "本地核对状态不可用")?;
    if cache.len() >= MAX_LIBRARIES && !cache.contains_key(workspace.layout().root()) {
        cache.clear();
    }
    let library = cache
        .entry(workspace.layout().root().to_owned())
        .or_default();
    let key = binding_key(binding);
    let audit = library.binding != key
        || library
            .audited
            .is_none_or(|at| at.elapsed() >= AUDIT_INTERVAL);
    if audit {
        library.binding = key;
        library.entries.clear();
        library.audited = None;
    }
    Ok(audit)
}
pub(super) fn finish_audit(workspace: &Workspace) {
    if let Ok(mut cache) = cache().lock() {
        if let Some(library) = cache.get_mut(workspace.layout().root()) {
            library.audited = Some(Instant::now());
        }
    }
}
pub(super) fn get(
    workspace: &Workspace,
    entry: &str,
    stamp: &str,
    replica: &Replica,
) -> Option<Vec<EntityDocument>> {
    let cache = cache().lock().ok()?;
    let item = cache.get(workspace.layout().root())?.entries.get(entry)?;
    // ACKs for old in-flight operations must never replace newer local content.
    // Pending, conflicted, or inbound-modified objects therefore re-export.
    (item.stamp == stamp
        && item.documents.iter().all(|doc| {
            wire::encode(doc).ok().is_some_and(|v| {
                replica
                    .settled_content(&doc.entity_id, Some(&v))
                    .unwrap_or(false)
            })
        }))
    .then(|| item.documents.clone())
}
pub(super) fn put(
    workspace: &Workspace,
    entry: &str,
    stamp: String,
    documents: Vec<EntityDocument>,
) {
    let Ok(bytes) = serde_json::to_vec(&documents).map(|v| v.len()) else {
        return;
    };
    if bytes > 2 * 1024 * 1024 {
        return;
    }
    if let Ok(mut cache) = cache().lock() {
        if let Some(library) = cache.get_mut(workspace.layout().root()) {
            // Bound memory; eviction affects only performance, never publication.
            library.entries.remove(entry);
            while library.entries.len() >= 4096
                || library
                    .entries
                    .values()
                    .map(|entry| entry.bytes)
                    .sum::<usize>()
                    + bytes
                    > 32 * 1024 * 1024
            {
                let oldest = library
                    .entries
                    .iter()
                    .min_by_key(|(_, entry)| entry.checked)
                    .map(|(id, _)| id.clone());
                if let Some(oldest) = oldest {
                    library.entries.remove(&oldest);
                } else {
                    break;
                }
            }
            library.entries.insert(
                entry.into(),
                Cached {
                    stamp,
                    documents,
                    bytes,
                    checked: Instant::now(),
                },
            );
        }
    }
}
pub(super) fn stamp(root: &Path, entry: &str) -> io::Result<String> {
    let generation = super::local_watch::entry_generation(root, entry);
    let canonical = root.canonicalize()?;
    let root = canonical.as_path();
    let mut stamps = BTreeMap::new();
    visit(root, &root.join("entries").join(entry), 0, &mut stamps)?;
    // Shared metadata and unfinished transactions can invalidate entry exports.
    for name in [
        "neuink.workspace.json",
        "tag-operation.journal.json",
        "content-operation.journal.json",
        "child-trash.journal.json",
        "source-note-import.journal.json",
        "account-parse.journal.json",
        "sync-apply.journal.json",
    ] {
        let path = root.join(name);
        match fs::symlink_metadata(&path) {
            Ok(meta) => add(root, &path, &meta, &mut stamps)?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    Ok(format!(
        "{}:{generation}",
        blake3::hash(&serde_json::to_vec(&stamps)?).to_hex()
    ))
}
type Stamps = BTreeMap<String, (u64, u128, u128)>;
fn add(root: &Path, path: &Path, meta: &fs::Metadata, stamps: &mut Stamps) -> io::Result<()> {
    if meta.file_type().is_symlink() {
        return Err(io::Error::other("同步内容包含链接"));
    }
    let nanos = |t: std::time::SystemTime| {
        t.duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .map_err(io::Error::other)
    };
    let relative = path
        .strip_prefix(root)
        .map_err(io::Error::other)?
        .to_string_lossy()
        .into_owned();
    stamps.insert(
        relative,
        (
            meta.len(),
            nanos(meta.modified()?)?,
            meta.created().ok().and_then(|t| nanos(t).ok()).unwrap_or(0),
        ),
    );
    Ok(())
}
fn visit(root: &Path, dir: &Path, depth: usize, stamps: &mut Stamps) -> io::Result<()> {
    if depth > 64 || !dir.canonicalize()?.starts_with(root) {
        return Err(io::Error::other("同步目录不在资料库内或层级过深"));
    }
    let metadata = fs::symlink_metadata(dir)?;
    if metadata.file_type().is_symlink() {
        return Err(io::Error::other("同步内容包含链接"));
    }
    for item in fs::read_dir(dir)? {
        let item = item?;
        let path = item.path();
        let meta = fs::symlink_metadata(&path)?;
        if meta.file_type().is_symlink() {
            return Err(io::Error::other("同步内容包含链接"));
        }
        if meta.is_dir() {
            visit(root, &path, depth + 1, stamps)?;
        } else {
            add(root, &path, &meta, stamps)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn audit_trust_expires_and_is_not_reused_across_bindings() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let mut binding = super::super::test_support::binding();
        assert!(begin(&workspace, &binding).unwrap());
        assert!(due(&workspace));
        finish_audit(&workspace);
        assert!(!due(&workspace));
        assert!(!begin(&workspace, &binding).unwrap());
        binding.epoch = "9".repeat(64);
        assert!(begin(&workspace, &binding).unwrap());
        finish_audit(&workspace);
        cache()
            .lock()
            .unwrap()
            .get_mut(workspace.layout().root())
            .unwrap()
            .audited = Some(Instant::now() - AUDIT_INTERVAL - Duration::from_secs(1));
        assert!(due(&workspace));
        assert!(begin(&workspace, &binding).unwrap());
        finish_audit(&workspace);
        invalidate(&workspace);
        assert!(due(&workspace));
    }
    #[test]
    fn metadata_candidates_include_reader_snapshot_and_missing_files_without_deletion_inference() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let entry = workspace.create_entry("Reading").unwrap();
        let before = stamp(dir.path(), entry.id.as_str()).unwrap();
        std::fs::write(
            workspace.layout().entry_dir(&entry.id).join("paper.reading-snapshot.json"),
            br#"{"version":1,"segments_hash":"updated-reader-snapshot"}"#,
        ).unwrap();
        assert_ne!(stamp(dir.path(), entry.id.as_str()).unwrap(), before);
        std::fs::rename(
            workspace.layout().entry_dir(&entry.id),
            dir.path().join("outside-entries"),
        )
        .unwrap();
        assert!(stamp(dir.path(), entry.id.as_str()).is_err());
    }
}
