use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

use crate::{workspace::WorkspaceFile, WorkspaceError, WorkspaceLayout};

/// Validate identity without initializing layout or replaying a pending transaction.
pub fn validate_workspace_read_only(root: &Path) -> Result<PathBuf, WorkspaceError> {
    let metadata = fs::metadata(root).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            WorkspaceError::WorkspaceMissing(root.to_path_buf())
        } else {
            error.into()
        }
    })?;
    if !metadata.is_dir() {
        return Err(WorkspaceError::WorkspaceNotDirectory(root.to_path_buf()));
    }
    let root = root.canonicalize()?;
    let layout = WorkspaceLayout::new(root.clone());
    let journal = root.join("tag-operation.journal.json");
    reject_pending_transaction(&journal)?;
    let marker = layout.workspace_file();
    let bytes = fs::read(&marker).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            WorkspaceError::WorkspaceMarkerMissing(marker)
        } else {
            error.into()
        }
    })?;
    let state: WorkspaceFile = serde_json::from_slice(&bytes)?;
    if state.schema_version != 1 {
        return Err(WorkspaceError::WorkspaceSchemaUnsupported(
            state.schema_version,
        ));
    }
    reject_pending_transaction(&journal)?;
    Ok(root)
}

fn reject_pending_transaction(journal: &Path) -> Result<(), WorkspaceError> {
    match fs::symlink_metadata(journal) {
        Ok(_) => Err(WorkspaceError::TagReading(
            "资料库有未完成的标签事务，请先通过正常打开流程恢复；搜索未执行恢复或写盘".into(),
        )),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(test)]
#[path = "read_only_tests.rs"]
mod tests;
