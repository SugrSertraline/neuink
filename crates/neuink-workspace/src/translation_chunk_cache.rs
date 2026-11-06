//! Rebuildable paid-work checkpoints, separate from the authoritative segment result.
use crate::{atomic_write_json, Workspace, WorkspaceError};
use neuink_domain::EntryId;
use std::fs;

impl Workspace {
    pub fn remove_translation_chunk(&self, entry: &EntryId, key: &str) -> Result<(), WorkspaceError> {
        let path = self.translation_chunk_file(entry, key)?;
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
    fn translation_chunk_file(
        &self,
        entry: &EntryId,
        key: &str,
    ) -> Result<std::path::PathBuf, WorkspaceError> {
        self.read_entry(entry)?;
        // Never use external text or a model-generated filename as a path component.
        let name = blake3::hash(key.as_bytes()).to_hex().to_string();
        Ok(self
            .layout()
            .entry_dir(entry)
            .join("translation-chunks")
            .join(format!("{name}.json")))
    }
    pub fn read_translation_chunk(
        &self,
        entry: &EntryId,
        key: &str,
    ) -> Result<Option<String>, WorkspaceError> {
        let path = self.translation_chunk_file(entry, key)?;
        if !path.exists() {
            return Ok(None);
        }
        Ok(Some(serde_json::from_slice(&fs::read(path)?)?))
    }
    pub fn write_translation_chunk(
        &self,
        entry: &EntryId,
        key: &str,
        value: &str,
    ) -> Result<(), WorkspaceError> {
        let path = self.translation_chunk_file(entry, key)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        atomic_write_json(&path, &value)
    }
}
