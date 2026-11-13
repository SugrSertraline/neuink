use crate::{atomic_write_json, Workspace, WorkspaceError};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io, path::Path, time::UNIX_EPOCH};

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SyncControl {
    pub paused: bool,
}

impl Workspace {
    pub fn sync_control(&self) -> Result<SyncControl, WorkspaceError> {
        let path = self.layout().root().join("sync-control.json");
        self.validate_note_workspace_path(&path)?;
        match fs::read(path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(SyncControl::default()),
            Err(error) => Err(error.into()),
        }
    }

    pub fn set_sync_paused(&self, paused: bool) -> Result<SyncControl, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        if self.sync_binding()?.is_none() {
            return Err(WorkspaceError::ContentTransaction(
                "请先确认同步绑定".into(),
            ));
        }
        let control = SyncControl { paused };
        let path = self.layout().root().join("sync-control.json");
        self.validate_note_workspace_path(&path)?;
        atomic_write_json(path, &control)?;
        Ok(control)
    }
}

/// Cheap change detection for debounce. Every remote poll still re-exports and
/// hashes actual content, including changes made by external editors.
pub fn change_stamp(root: &Path) -> io::Result<String> {
    let root = root.canonicalize()?;
    let mut stamps = BTreeMap::new();
    for name in [
        "neuink.workspace.json",
        "ideation/state.json",
        "lifecycle-sequence.json",
        "child-lifecycle-sequence.json",
    ] {
        let path = crate::sync_export::files::safe_path(&root, name)?;
        if path.exists() {
            add_stamp(&path, name, &mut stamps)?;
        }
    }
    let entries = root.join("entries");
    if entries.exists() {
        visit(&root, &entries, 0, &mut stamps, false)?;
    }
    Ok(blake3::hash(&serde_json::to_vec(&stamps)?)
        .to_hex()
        .to_string())
}

/// UI status cache key only; never substitutes for export/upload validation.
pub fn entry_status_stamp(root: &Path, entry_id: &str) -> io::Result<String> {
    let root = root.canonicalize()?;
    let path = crate::sync_export::files::safe_path(&root, &format!("entries/{entry_id}"))?;
    let mut stamps = BTreeMap::new();
    visit(&root, &path, 0, &mut stamps, true)?;
    // Transactions and shared metadata can change the meaning of entry files.
    for entry in fs::read_dir(&root)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.ends_with(".json") { add_stamp(&entry.path(), &name, &mut stamps)?; }
        }
    }
    Ok(blake3::hash(&serde_json::to_vec(&stamps)?).to_hex().to_string())
}

fn add_stamp(
    path: &Path,
    relative: &str,
    stamps: &mut BTreeMap<String, (u64, u128)>,
) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(io::Error::other("同步内容包含不支持的链接"));
    }
    let modified = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_nanos();
    stamps.insert(relative.into(), (metadata.len(), modified));
    Ok(())
}

fn visit(
    root: &Path,
    dir: &Path,
    depth: usize,
    stamps: &mut BTreeMap<String, (u64, u128)>,
    all: bool,
) -> io::Result<()> {
    if depth > 64 {
        return Err(io::Error::other("同步目录层级过深"));
    }
    if !dir.canonicalize()?.starts_with(root) {
        return Err(io::Error::other("同步目录包含外部链接"));
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        if !all && name.to_string_lossy().starts_with('.') {
            continue;
        }
        let path = entry.path();
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            return Err(io::Error::other("同步内容包含链接"));
        }
        if kind.is_dir() {
            visit(root, &path, depth + 1, stamps, all)?;
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(io::Error::other)?
            .to_string_lossy()
            .replace(std::path::MAIN_SEPARATOR, "/");
        if all || crate::sync_inventory::selected(&relative.split('/').collect::<Vec<_>>())
            || relative.ends_with("/paper.reading-snapshot.json")
        {
            add_stamp(&path, &relative, stamps)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pause_survives_reopen_and_cache_writes_do_not_trigger_sync() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        workspace
            .bind_sync(&crate::sync_journal::WorkspaceSyncBinding {
                server_id: "1".repeat(64),
                account_id: "2".repeat(64),
                library_id: "3".repeat(64),
                epoch: "4".repeat(64),
            })
            .unwrap();
        workspace.set_sync_paused(true).unwrap();
        assert!(
            Workspace::open_existing(dir.path())
                .unwrap()
                .sync_control()
                .unwrap()
                .paused
        );
        let before = change_stamp(dir.path()).unwrap();
        fs::write(dir.path().join("sync-sequence.json"), b"1").unwrap();
        assert_eq!(change_stamp(dir.path()).unwrap(), before);
        workspace.create_entry("A new paper").unwrap();
        assert_ne!(change_stamp(dir.path()).unwrap(), before);
    }
}
