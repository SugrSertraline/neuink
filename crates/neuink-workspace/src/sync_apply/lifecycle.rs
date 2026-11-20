use super::{error, Result};
use crate::{
    entry_lifecycle::{EntryLifecycleAction, EntryLifecycleEvent},
    sync_export::{export_entry_locked, export_trashed_entry_locked},
    sync_journal::WorkspaceSyncBinding,
    Workspace,
};
use neuink_domain::EntryId;
use neuink_sync_protocol::document::EntityDocument;
use std::collections::BTreeMap;

fn documents(values: &[EntityDocument]) -> BTreeMap<String, EntityDocument> {
    values
        .iter()
        .map(|d| (d.entity_id.clone(), d.clone()))
        .collect()
}
impl Workspace {
    /// A whole entry enters the local recycle bin only when every child matches
    /// its deletion baseline. A concurrent saved child edit blocks the move.
    pub fn apply_sync_entry_deletion(
        &self,
        binding: &WorkspaceSyncBinding,
        entry: &str,
        expected: &[EntityDocument],
    ) -> Result<()> {
        let _guard = self.begin_tag_safe_mutation().map_err(error)?;
        self.check_sync_binding(binding)?;
        crate::tag_reading::validate_id(entry).map_err(error)?;
        let id = EntryId::from_string(entry.to_owned());
        if !expected
            .iter()
            .any(|d| d.entity_id == format!("entry:{entry}"))
        {
            return Err("条目删除尚未接收完整，已保留本地内容".into());
        }
        let active = self.layout().entry_dir(&id);
        let trash = self.layout().trashed_entry_dir(&id);
        if active.exists() && trash.exists() {
            return Err("活动条目与回收站标识冲突，未覆盖".into());
        }
        if !active.exists() {
            if !trash.exists() {
                return Err("删除基线对应的本地条目缺失，未确认应用".into());
            }
            let bundle = export_trashed_entry_locked(self.layout().root(), entry)
                .map_err(|e| e.to_string())?;
            if documents(&bundle.manifest().documents) != documents(expected) {
                return Err("回收站内容已改变，已保留双方".into());
            }
            return Ok(());
        }
        let bundle = export_entry_locked(self.layout().root(), entry).map_err(|e| e.to_string())?;
        if documents(&bundle.manifest().documents) != documents(expected) {
            return Err("删除与本地编辑冲突，条目及子内容均未移走".into());
        }
        self.move_entry_with_origin(&id, EntryLifecycleAction::Delete, true, expected.to_vec())
            .map_err(error)
    }

    /// Restore only a complete, explicit remote resurrection of a previously
    /// deleted group. Return the preserved baseline for subsequent file CAS.
    pub fn prepare_sync_entry_restore(
        &self,
        binding: &WorkspaceSyncBinding,
        entry: &str,
        targets: &[EntityDocument],
    ) -> Result<Option<Vec<EntityDocument>>> {
        let _guard = self.begin_tag_safe_mutation().map_err(error)?;
        self.check_sync_binding(binding)?;
        crate::tag_reading::validate_id(entry).map_err(error)?;
        let id = EntryId::from_string(entry.to_owned());
        if !self.layout().trashed_entry_dir(&id).exists() {
            return Ok(None);
        }
        if self.layout().entry_dir(&id).exists() {
            return Err("活动条目与回收站标识冲突，未恢复".into());
        }
        let root = self.layout().root().canonicalize().map_err(error)?;
        let receipt = crate::sync_export::files::safe_path(
            &root,
            &format!("trash/entries/{entry}/.sync-deleted.json"),
        )
        .map_err(error)?;
        let receipt: EntryLifecycleEvent =
            serde_json::from_slice(&std::fs::read(receipt).map_err(error)?).map_err(error)?;
        if receipt.binding.as_ref() != Some(binding)
            || receipt.entry_id != id
            || receipt.action != EntryLifecycleAction::Delete
        {
            return Err("回收站缺少匹配的同步删除记录，请在本地显式恢复".into());
        }
        let parent = targets
            .iter()
            .find(|d| d.entity_id == format!("entry:{entry}"))
            .ok_or("云端恢复缺少条目目录")?;
        if receipt.documents.is_empty()
            || receipt.documents.iter().any(|d| {
                !targets.iter().any(|target| target.entity_id == d.entity_id)
                    && !(d.kind == neuink_sync_protocol::ObjectKind::Note
                        && !parent.references.contains(&d.entity_id))
            })
        {
            return Err("云端恢复尚未接收全部子内容，已保留回收站".into());
        }
        let bundle = export_trashed_entry_locked(&root, entry).map_err(|e| e.to_string())?;
        if documents(&bundle.manifest().documents) != documents(&receipt.documents) {
            return Err("回收站内容存在新编辑，未自动覆盖或恢复".into());
        }
        self.move_entry_with_origin(&id, EntryLifecycleAction::Restore, true, Vec::new())
            .map_err(error)?;
        Ok(Some(receipt.documents))
    }
}
