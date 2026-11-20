use super::{cache, error, journal, render, Result, SyncDocumentChange};
use crate::{
    sync_export::{export_entry_locked, tags::export_tags_locked},
    sync_journal::WorkspaceSyncBinding,
    Workspace,
};
use std::collections::{BTreeMap, BTreeSet};

impl Workspace {
    /// Publish a dependency-connected set. Cross-entry cycles are valid and are
    /// reconstructed together; unrelated entries need not join this transaction.
    pub fn apply_sync_entries(
        &self,
        binding: &WorkspaceSyncBinding,
        changes: &BTreeMap<String, Vec<SyncDocumentChange>>,
    ) -> Result<Vec<String>> {
        self.apply_sync_entries_with_deletions(binding, changes, &BTreeMap::new())
    }

    pub fn apply_sync_entries_with_deletions(
        &self,
        binding: &WorkspaceSyncBinding,
        changes: &BTreeMap<String, Vec<SyncDocumentChange>>,
        deletions: &BTreeMap<String, Vec<neuink_sync_protocol::document::EntityDocument>>,
    ) -> Result<Vec<String>> {
        let _guard = self.begin_tag_safe_mutation().map_err(error)?;
        self.check_sync_binding(binding)?;
        let root = self.layout().root().canonicalize().map_err(error)?;
        let tags = export_tags_locked(&root).map_err(|e| e.to_string())?;
        let mut queue: BTreeSet<String> = changes.keys().chain(deletions.keys()).cloned().collect();
        let mut trash_files = Vec::new();
        let mut groups = BTreeMap::new();
        let mut old = Vec::new();
        let mut changed = BTreeSet::new();
        let mut seen = BTreeSet::new();
        while let Some(entry_id) = queue.pop_first() {
            if groups.contains_key(&entry_id) {
                continue;
            }
            crate::tag_reading::validate_id(&entry_id).map_err(error)?;
            if self.layout().trashed_entries_dir().join(&entry_id).exists() {
                return Err("条目已在本地回收站，须显式恢复后才能应用云端内容".into());
            }
            let path = crate::sync_export::files::safe_path(
                &root,
                &format!("entries/{entry_id}/entry.meta.json"),
            )
            .map_err(error)?;
            let previous = if path.exists() {
                let bundle = export_entry_locked(&root, &entry_id).map_err(|e| e.to_string())?;
                for resource in bundle
                    .manifest()
                    .documents
                    .iter()
                    .flat_map(|d| &d.resources)
                {
                    cache::stage(self, &bundle, resource)?;
                }
                bundle.manifest().documents.clone()
            } else {
                Vec::new()
            };
            let mut documents: BTreeMap<_, _> = previous
                .iter()
                .map(|d| (d.entity_id.clone(), d.clone()))
                .collect();
            old.extend(previous);
            let mut removed = Vec::new();
            for document in deletions.get(&entry_id).into_iter().flatten() {
                seen.insert(document.entity_id.clone());
                if documents.get(&document.entity_id).is_none() {
                    // A crash may occur after journal publication but before replica
                    // acknowledgement. Only a matching archived snapshot proves replay.
                    let archived = self
                        .sync_child_trash_files(
                            &neuink_domain::EntryId::from_string(entry_id.clone()),
                            &[],
                            &BTreeSet::from([document.entity_id.clone()]),
                        )
                        .map_err(error)?;
                    if archived.restored.iter().any(|d| d == document) {
                        continue;
                    }
                    return Err("删除缺少匹配的本地或回收站基线，未确认应用".into());
                }
                if documents.get(&document.entity_id) != Some(document) {
                    return Err("子内容删除与本地新修改冲突，已保留双方".into());
                }
                documents.remove(&document.entity_id);
                changed.insert(document.entity_id.clone());
                removed.push(document.clone());
            }
            let restored = changes
                .get(&entry_id)
                .into_iter()
                .flatten()
                .filter(|c| c.expected.is_none())
                .map(|c| c.target.entity_id.clone())
                .collect();
            let archived = self
                .sync_child_trash_files(
                    &neuink_domain::EntryId::from_string(entry_id.clone()),
                    &removed,
                    &restored,
                )
                .map_err(|e| e.to_string())?;
            old.extend(archived.restored);
            trash_files.extend(archived.files);
            if let Some(updates) = changes.get(&entry_id) {
                for update in updates {
                    update.target.validate().map_err(str::to_owned)?;
                    let key = &update.target.entity_id;
                    if !seen.insert(key.clone()) {
                        return Err("本次入站包含重复实体".into());
                    }
                    if documents.get(key) == Some(&update.target) {
                        continue;
                    }
                    if documents.get(key) != update.expected.as_ref() {
                        return Err("本地内容已改变，须保留双方并处理冲突".into());
                    }
                    documents.insert(key.clone(), update.target.clone());
                    changed.insert(key.clone());
                }
            }
            if !documents.contains_key(&format!("entry:{entry_id}")) {
                return Err("来源条目尚未下载完整，已保留队列".into());
            }
            for reference in documents.values().flat_map(|d| &d.references) {
                if let Some(id) = reference
                    .strip_prefix("entry:")
                    .or_else(|| reference.strip_prefix("parse:"))
                {
                    if id != entry_id && !groups.contains_key(id) {
                        queue.insert(id.to_owned());
                    }
                }
            }
            groups.insert(entry_id, documents.into_values().collect::<Vec<_>>());
        }
        if changed.is_empty() {
            return Ok(seen.into_iter().collect());
        }
        let mut rendered = render::render_all(self, &groups)?;
        rendered.include_deletions(self, &groups, deletions)?;
        let known: BTreeSet<_> = groups
            .values()
            .flatten()
            .chain(tags.iter())
            .map(|d| d.entity_id.as_str())
            .collect();
        if known.len() != groups.values().map(Vec::len).sum::<usize>() + tags.len() {
            return Err("来源集合存在重复实体标识，未覆盖任何内容".into());
        }
        for (entry, documents) in &groups {
            let verified =
                export_entry_locked(rendered.root.path(), entry).map_err(|e| e.to_string())?;
            if verified.manifest().documents != *documents
                || verified
                    .manifest()
                    .required_entities
                    .iter()
                    .any(|r| !known.contains(r.as_str()))
            {
                return Err("入站内容不完整、版本不兼容或来源依赖尚未就绪".into());
            }
        }
        let mut files = rendered.changes(self, &old, &changed)?;
        for (relative, source) in trash_files {
            let target = crate::sync_export::files::safe_path(&root, &relative).map_err(error)?;
            let before = crate::sync_export::files::fingerprint(&target)
                .map_err(error)?
                .map(|(h, _)| h);
            let (hash, size) = match source {
                crate::trash::SyncTrashSource::Bytes(bytes) => {
                    let hash = blake3::hash(&bytes).to_hex().to_string();
                    crate::atomic_write(cache::blob_path(self, &hash)?, &bytes).map_err(error)?;
                    (hash, bytes.len() as u64)
                }
                crate::trash::SyncTrashSource::File(path) => {
                    let (hash, size) = crate::sync_export::files::fingerprint(&path)
                        .map_err(error)?
                        .ok_or("回收站备份源缺失")?;
                    cache::copy(&path, &cache::blob_path(self, &hash)?, &hash, size)?;
                    (hash, size)
                }
            };
            files.push(journal::FileChange {
                relative,
                before,
                hash,
                size,
            });
        }
        journal::commit(self, binding, files)?;
        Ok(seen.into_iter().collect())
    }
}
