use super::{cache, error, Result};
use crate::{
    atomic_write_json,
    sync_export::files::{fingerprint, safe_path},
    sync_journal::WorkspaceSyncBinding,
    Workspace, WorkspaceError,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fs};

const JOURNAL: &str = "sync-apply.journal.json";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct FileChange {
    pub relative: String,
    pub before: Option<String>,
    pub hash: String,
    pub size: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    version: u16,
    binding: WorkspaceSyncBinding,
    changes: Vec<FileChange>,
}

fn allowed(relative: &str) -> bool {
    let parts: Vec<_> = relative.split('/').collect();
    if parts.len() < 3
        || parts[0] != "entries"
        || crate::tag_reading::validate_id(parts[1]).is_err()
    {
        return false;
    }
    match &parts[2..] {
        ["entry.meta.json"
        | "paper.pdf"
        | "paper.segments.json"
        | "paper.annotations.json"
        | "paper.reading-snapshot.json"
        | "segment-notes.json"
        | "paper.folds.json"
        | "paper.translation.json"
        | "paper.sentence-translations.json"
        | "paper.paragraph-translations.json"] => true,
        [".trash", "items.json"] => true,
        [".trash", "sync", name] => name
            .strip_suffix(".json")
            .is_some_and(|hash| hash.len() == 64 && hash.bytes().all(|c| c.is_ascii_hexdigit())),
        // Preserve local asset housekeeping and quarantined files as well as
        // displayed images. safe_path still checks every path component.
        [".trash", "notes", folder, _, ..] if folder.ends_with(".assets") => folder
            .strip_suffix(".assets")
            .is_some_and(|id| crate::tag_reading::validate_id(id).is_ok()),
        [".trash", "notes", ..] => {
            allowed(&format!("entries/{}/{}", parts[1], parts[3..].join("/")))
        }
        ["notes", name] => name
            .strip_suffix(".links.json")
            .or_else(|| name.strip_suffix(".md"))
            .is_some_and(|id| crate::tag_reading::validate_id(id).is_ok()),
        ["mineru-output", ..] => parts.len() > 3 && super::render::image(relative),
        ["notes", folder, ..] => {
            parts.len() > 4
                && folder
                    .strip_suffix(".assets")
                    .is_some_and(|id| crate::tag_reading::validate_id(id).is_ok())
                && super::render::image(relative)
        }
        _ => false,
    }
}

pub(super) fn commit(
    workspace: &Workspace,
    binding: &WorkspaceSyncBinding,
    changes: Vec<FileChange>,
) -> Result<()> {
    let root = workspace.layout().root().canonicalize().map_err(error)?;
    let path = safe_path(&root, JOURNAL).map_err(error)?;
    if path.exists() {
        return Err("仍有入站恢复记录，未开始新的覆盖操作".into());
    }
    let journal = Journal {
        version: 1,
        binding: binding.clone(),
        changes,
    };
    preflight(workspace, &journal)?;
    atomic_write_json(path, &journal).map_err(error)?;
    recover(workspace)
}

fn preflight(workspace: &Workspace, journal: &Journal) -> Result<()> {
    workspace.check_sync_binding(&journal.binding)?;
    if journal.version != 1 || journal.changes.is_empty() || journal.changes.len() > 10000 {
        return Err("入站恢复格式无效".into());
    }
    let root = workspace.layout().root().canonicalize().map_err(error)?;
    let mut paths = BTreeSet::new();
    for change in &journal.changes {
        if !allowed(&change.relative) || !paths.insert(change.relative.to_lowercase()) {
            return Err("入站恢复包含不允许或重复的目标".into());
        }
        let target = safe_path(&root, &change.relative).map_err(error)?;
        cache::verify(
            &cache::blob_path(workspace, &change.hash)?,
            &change.hash,
            change.size,
        )?;
        let current = fingerprint(&target).map_err(error)?.map(|(hash, _)| hash);
        if current.as_ref() != Some(&change.hash) && current != change.before {
            return Err("本地文件已变化，保留恢复记录与双方内容，未继续覆盖".into());
        }
    }
    Ok(())
}

fn recover(workspace: &Workspace) -> Result<()> {
    let root = workspace.layout().root().canonicalize().map_err(error)?;
    let path = safe_path(&root, JOURNAL).map_err(error)?;
    let raw = match fs::read(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(error(e)),
    };
    let journal: Journal = serde_json::from_slice(&raw).map_err(error)?;
    preflight(workspace, &journal)?;
    for change in &journal.changes {
        let target = safe_path(&root, &change.relative).map_err(error)?;
        let current = fingerprint(&target).map_err(error)?.map(|(hash, _)| hash);
        if current.as_ref() == Some(&change.hash) {
            continue;
        }
        if current != change.before {
            return Err("入站写入期间文件已变化，已停止并保留恢复记录".into());
        }
        cache::copy(
            &cache::blob_path(workspace, &change.hash)?,
            &target,
            &change.hash,
            change.size,
        )?;
    }
    fs::remove_file(path).map_err(error)
}

impl Workspace {
    pub(crate) fn recover_sync_apply(&self) -> std::result::Result<(), WorkspaceError> {
        recover(self).map_err(WorkspaceError::ContentTransaction)
    }
}
