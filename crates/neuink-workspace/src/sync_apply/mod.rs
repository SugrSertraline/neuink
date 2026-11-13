//! Verified downloads are published only by Workspace, behind a recovery journal.
mod cache;
mod entries;
mod ideation;
mod journal;
mod lifecycle;
mod render;
mod tags;
use crate::{sync_export::ExportBundle, sync_journal::WorkspaceSyncBinding, Workspace};
use neuink_sync_protocol::document::EntityDocument;
use std::{collections::BTreeMap, path::PathBuf};

type Result<T> = std::result::Result<T, String>;
fn error(_: impl std::fmt::Display) -> String {
    "同步暂存或落盘失败，已保留原始资料及恢复记录".into()
}

#[derive(Clone)]
pub struct SyncDocumentChange {
    pub expected: Option<EntityDocument>,
    pub target: EntityDocument,
}

impl Workspace {
    pub fn read_sync_resource(
        &self,
        binding: &WorkspaceSyncBinding,
        resource: &neuink_sync_protocol::document::Resource,
    ) -> Result<Vec<u8>> {
        self.check_sync_binding(binding)?;
        cache::read(self, resource)
    }

    pub fn stage_sync_text(
        &self,
        binding: &WorkspaceSyncBinding,
        bytes: &[u8],
    ) -> Result<neuink_sync_protocol::document::Resource> {
        self.check_sync_binding(binding)?;
        if bytes.len() > 64 * 1024 * 1024 {
            return Err("合并正文超过大小限制".into());
        }
        let hash = blake3::hash(bytes).to_hex().to_string();
        let path = cache::blob_path(self, &hash)?;
        crate::atomic_write(path, bytes).map_err(error)?;
        Ok(neuink_sync_protocol::document::Resource {
            name: "note.json".into(),
            hash,
            size: bytes.len() as u64,
        })
    }

    pub fn sync_blob_path(&self, binding: &WorkspaceSyncBinding, hash: &str) -> Result<PathBuf> {
        self.check_sync_binding(binding)?;
        cache::blob_path(self, hash)
    }

    pub fn sync_replica_path(&self, binding: &WorkspaceSyncBinding) -> Result<PathBuf> {
        self.check_sync_binding(binding)?;
        let root = self.layout().root().canonicalize().map_err(error)?;
        let path = crate::sync_export::files::safe_path(&root, ".neuink-sync/replica.sqlite")
            .map_err(error)?;
        std::fs::create_dir_all(path.parent().ok_or("同步状态目录无效")?).map_err(error)?;
        Ok(path)
    }

    pub fn recover_pending_sync(&self, binding: &WorkspaceSyncBinding) -> Result<()> {
        self.check_sync_binding(binding)?;
        drop(self.begin_tag_safe_mutation().map_err(error)?);
        Ok(())
    }

    /// A corrupt cache is quarantined, never mistaken for a verified attachment.
    /// A valid prefix remains available to the existing resumable downloader.
    pub fn prepare_sync_download(
        &self,
        binding: &WorkspaceSyncBinding,
        resource: &neuink_sync_protocol::document::Resource,
    ) -> Result<PathBuf> {
        let path = self.sync_blob_path(binding, &resource.hash)?;
        if resource.size > 2_147_483_648 {
            return Err("附件大小超出限制".into());
        }
        if path.exists() {
            let size = std::fs::metadata(&path).map_err(error)?.len();
            if size > resource.size
                || (size == resource.size
                    && cache::verify(&path, &resource.hash, resource.size).is_err())
            {
                let quarantine = path.with_file_name(format!(
                    "{}.{}.invalid",
                    resource.hash,
                    neuink_domain::EntryId::new()
                ));
                std::fs::rename(&path, quarantine).map_err(error)?;
            }
        }
        Ok(path)
    }

    fn check_sync_binding(&self, binding: &WorkspaceSyncBinding) -> Result<()> {
        if self.sync_binding().map_err(error)?.as_ref() != Some(binding) {
            return Err("资料库与本次同步账号、服务器或云端库不匹配".into());
        }
        Ok(())
    }

    pub fn stage_sync_bundle(
        &self,
        binding: &WorkspaceSyncBinding,
        bundle: &ExportBundle,
    ) -> Result<()> {
        let _guard = crate::tag_transaction::lock_metadata().map_err(error)?;
        self.stage_sync_bundle_locked(binding, bundle)
    }

    pub(crate) fn stage_sync_bundle_locked(
        &self,
        binding: &WorkspaceSyncBinding,
        bundle: &ExportBundle,
    ) -> Result<()> {
        self.check_sync_binding(binding)?;
        bundle.verify_unchanged_locked().map_err(error)?;
        let mut hashes = std::collections::BTreeSet::new();
        for resource in bundle
            .manifest()
            .documents
            .iter()
            .flat_map(|d| &d.resources)
        {
            if hashes.insert(&resource.hash) {
                cache::stage(self, bundle, resource)?;
            }
        }
        bundle.verify_unchanged_locked().map_err(error)
    }

    pub fn apply_sync_entry(
        &self,
        binding: &WorkspaceSyncBinding,
        entry_id: &str,
        changes: &[SyncDocumentChange],
    ) -> Result<Vec<String>> {
        self.apply_sync_entries(
            binding,
            &BTreeMap::from([(entry_id.to_owned(), changes.to_vec())]),
        )
    }
}
