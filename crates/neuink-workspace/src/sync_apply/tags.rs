use super::{error, Result, SyncDocumentChange};
use crate::{
    sync_export::tags, sync_journal::WorkspaceSyncBinding, tag_transaction::TagTransactionTarget,
    Workspace,
};
use neuink_domain::TagMeta;
use std::collections::{BTreeMap, BTreeSet};

impl Workspace {
    pub fn apply_sync_tags(
        &self,
        binding: &WorkspaceSyncBinding,
        changes: &[SyncDocumentChange],
    ) -> Result<Vec<String>> {
        let _guard = self.begin_tag_safe_mutation().map_err(error)?;
        self.check_sync_binding(binding)?;
        let mut file = self.read_workspace_file().map_err(error)?;
        let mut tags_by_id: BTreeMap<_, _> = file
            .tags
            .iter()
            .cloned()
            .map(|t| (t.id.clone(), t))
            .collect();
        let mut seen = BTreeSet::new();
        let mut changed = false;
        for change in changes {
            change.target.validate().map_err(str::to_owned)?;
            let tag: TagMeta =
                serde_json::from_value(change.target.payload["tag"].clone()).map_err(error)?;
            if tags::document(&tag).map_err(error)? != change.target
                || !seen.insert(change.target.entity_id.clone())
            {
                return Err("标签实体格式无效或重复".into());
            }
            let current = tags_by_id
                .get(&tag.id)
                .map(tags::document)
                .transpose()
                .map_err(error)?;
            if current.as_ref() == Some(&change.target) {
                continue;
            }
            if current != change.expected {
                return Err("本地标签已改变，须保留双方并处理冲突".into());
            }
            if file.tag_archives.iter().any(|archive| {
                archive.root_tag.id == tag.id || archive.tags.iter().any(|t| t.id == tag.id)
            }) {
                return Err("标签已归档，须显式恢复，未自动覆盖".into());
            }
            tags_by_id.insert(tag.id.clone(), tag);
            changed = true;
        }
        if changed {
            file.tags = tags_by_id.into_values().collect();
            tags::validate(&file.tags).map_err(|e| e.to_string())?;
            let change = self
                .tag_file_change(TagTransactionTarget::Workspace, &file)
                .map_err(error)?;
            self.commit_tag_transaction(vec![change]).map_err(error)?;
        }
        Ok(seen.into_iter().collect())
    }
}
