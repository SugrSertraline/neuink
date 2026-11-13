//! Prepare recycle-bin files alongside incoming content, before either is published.
use super::*;
use neuink_sync_protocol::{document::EntityDocument, ObjectKind};
use std::collections::BTreeSet;

pub(crate) enum SyncTrashSource {
    Bytes(Vec<u8>),
    File(PathBuf),
}
pub(crate) struct SyncTrashFiles {
    pub files: Vec<(String, SyncTrashSource)>,
    pub restored: Vec<EntityDocument>,
}
fn snapshot_name(id: &str) -> String {
    format!(".trash/sync/{}.json", blake3::hash(id.as_bytes()).to_hex())
}
fn key(entry: &EntryId, payload: &StoredTrashPayload) -> String {
    match payload {
        StoredTrashPayload::MarkdownNote { note_id, .. } => format!("note:{note_id}"),
        StoredTrashPayload::SegmentNote { note } => {
            format!("segment_note:{entry}:{}", note.segment_uid)
        }
        StoredTrashPayload::Annotation { annotation } => {
            format!("annotation:{}", annotation.annotation_id)
        }
    }
}
impl Workspace {
    pub(crate) fn sync_child_trash_files(
        &self,
        entry_id: &EntryId,
        deleted: &[EntityDocument],
        restored: &BTreeSet<String>,
    ) -> Result<SyncTrashFiles, WorkspaceError> {
        let root = self.layout().root().canonicalize()?;
        let prefix = format!("entries/{entry_id}/");
        let mut records = self.read_trash_records(&self.layout().entry_dir(entry_id))?;
        let mut result = SyncTrashFiles {
            files: Vec::new(),
            restored: Vec::new(),
        };
        for doc in deleted {
            if records
                .iter()
                .any(|r| key(entry_id, &r.payload) == doc.entity_id)
            {
                return Err(WorkspaceError::TrashRestoreConflict(doc.entity_id.clone()));
            }
            let (trash_id, payload) = match doc.kind {
                ObjectKind::Note => {
                    let note_id: NoteId = serde_json::from_value(doc.payload["note_id"].clone())?;
                    let entry = self.read_entry(entry_id)?;
                    let (original_index, title) = entry
                        .contents
                        .iter()
                        .enumerate()
                        .find_map(|(i, c)| match c {
                            ContentItem::Note {
                                note_id: current,
                                title,
                            } if current == &note_id => Some((i, title.clone())),
                            _ => None,
                        })
                        .ok_or_else(|| WorkspaceError::NoteMissing(note_id.to_string()))?;
                    for suffix in ["md", "links.json"] {
                        let source = crate::sync_export::files::safe_path(
                            &root,
                            &format!("{prefix}notes/{note_id}.{suffix}"),
                        )?;
                        if source.exists() {
                            result.files.push((
                                format!("{prefix}.trash/notes/{note_id}.{suffix}"),
                                SyncTrashSource::File(source),
                            ));
                        }
                    }
                    let assets = crate::sync_export::files::safe_path(
                        &root,
                        &format!("{prefix}notes/{note_id}.assets"),
                    )?;
                    if assets.exists() {
                        copy_assets(
                            &root,
                            &assets,
                            &format!("{prefix}.trash/notes/{note_id}.assets"),
                            &mut result.files,
                        )?;
                    }
                    (
                        format!("markdown_note:{note_id}"),
                        StoredTrashPayload::MarkdownNote {
                            note_id,
                            title,
                            original_index,
                        },
                    )
                }
                ObjectKind::Annotation => {
                    let annotation: Annotation =
                        serde_json::from_value(doc.payload["annotation"].clone())?;
                    (
                        format!("annotation:{}", annotation.annotation_id),
                        StoredTrashPayload::Annotation { annotation },
                    )
                }
                ObjectKind::SegmentNote => {
                    let note: SegmentBlockNote =
                        serde_json::from_value(doc.payload["note"].clone())?;
                    (
                        format!("segment_note:{}", note.segment_uid),
                        StoredTrashPayload::SegmentNote { note },
                    )
                }
                _ => {
                    return Err(WorkspaceError::ContentTransaction(
                        "不支持此子实体的回收站删除".into(),
                    ))
                }
            };
            records.push(StoredTrashRecord {
                trash_id,
                deleted_at: Utc::now(),
                payload,
            });
            result.files.push((
                format!("{prefix}{}", snapshot_name(&doc.entity_id)),
                SyncTrashSource::Bytes(serde_json::to_vec(doc)?),
            ));
        }
        for record in &records {
            let id = key(entry_id, &record.payload);
            if !restored.contains(&id) {
                continue;
            }
            let snapshot = crate::sync_export::files::safe_path(
                &root,
                &format!("{prefix}{}", snapshot_name(&id)),
            )?;
            let doc: EntityDocument = serde_json::from_slice(&fs::read(snapshot)?)?;
            if doc.entity_id != id {
                return Err(WorkspaceError::TrashRestoreConflict(id));
            }
            doc.validate()
                .map_err(|e| WorkspaceError::ContentTransaction(e.into()))?;
            match &record.payload {
                StoredTrashPayload::Annotation { annotation }
                    if serde_json::to_value(annotation)? != doc.payload["annotation"] =>
                {
                    return Err(WorkspaceError::TrashRestoreConflict(id.clone()))
                }
                StoredTrashPayload::SegmentNote { note }
                    if serde_json::to_value(note)? != doc.payload["note"] =>
                {
                    return Err(WorkspaceError::TrashRestoreConflict(id.clone()))
                }
                _ => {}
            }
            if let StoredTrashPayload::MarkdownNote { note_id, title, .. } = &record.payload {
                let resource = doc
                    .resources
                    .iter()
                    .find(|r| r.name == "note.json")
                    .ok_or_else(|| WorkspaceError::TrashRestoreConflict(id.clone()))?;
                let binding = self
                    .sync_binding()?
                    .ok_or_else(|| WorkspaceError::TrashRestoreConflict(id.clone()))?;
                let body: serde_json::Value = serde_json::from_slice(
                    &self
                        .read_sync_resource(&binding, resource)
                        .map_err(WorkspaceError::ContentTransaction)?,
                )?;
                let archived = self
                    .layout()
                    .entry_trash_notes_dir(entry_id)
                    .join(format!("{note_id}.md"));
                self.validate_note_workspace_path(&archived)?;
                let markdown = fs::read_to_string(archived)?;
                let links_path = self
                    .layout()
                    .entry_trash_notes_dir(entry_id)
                    .join(format!("{note_id}.links.json"));
                self.validate_note_workspace_path(&links_path)?;
                let links: Vec<neuink_domain::SourceLink> = read_json_or_default(&links_path)?;
                if body["markdown"].as_str() != Some(crate::note::strip_frontmatter(&markdown))
                    || body["title"].as_str() != Some(title.as_str())
                    || serde_json::to_value(links)? != body["links"]
                {
                    return Err(WorkspaceError::TrashRestoreConflict(id.clone()));
                }
                for resource in &doc.resources {
                    if let Some(tail) = resource
                        .name
                        .strip_prefix(&format!("{prefix}notes/{note_id}.assets/"))
                    {
                        let path = crate::sync_export::files::safe_path(
                            &root,
                            &format!("{prefix}.trash/notes/{note_id}.assets/{tail}"),
                        )?;
                        if crate::sync_export::files::fingerprint(&path)?
                            != Some((resource.hash.clone(), resource.size))
                        {
                            return Err(WorkspaceError::TrashRestoreConflict(id.clone()));
                        }
                    }
                }
                // Orphan originals are deliberately preserved on incoming delete.
                // They may only be replaced if they still match the archived bytes.
                for suffix in ["md", "links.json"] {
                    let active = crate::sync_export::files::safe_path(
                        &root,
                        &format!("{prefix}notes/{note_id}.{suffix}"),
                    )?;
                    let archived = crate::sync_export::files::safe_path(
                        &root,
                        &format!("{prefix}.trash/notes/{note_id}.{suffix}"),
                    )?;
                    if active.exists()
                        && crate::sync_export::files::fingerprint(&active)?
                            != crate::sync_export::files::fingerprint(&archived)?
                    {
                        return Err(WorkspaceError::TrashRestoreConflict(note_id.to_string()));
                    }
                }
            }
            result.restored.push(doc);
        }
        let had_restore = records
            .iter()
            .any(|r| restored.contains(&key(entry_id, &r.payload)));
        records.retain(|r| !restored.contains(&key(entry_id, &r.payload)));
        if !deleted.is_empty() || had_restore {
            result.files.push((
                format!("{prefix}.trash/items.json"),
                SyncTrashSource::Bytes(serde_json::to_vec_pretty(&records)?),
            ));
        }
        Ok(result)
    }
}
fn copy_assets(
    root: &Path,
    dir: &Path,
    target: &str,
    files: &mut Vec<(String, SyncTrashSource)>,
) -> Result<(), WorkspaceError> {
    for item in fs::read_dir(dir)? {
        let item = item?;
        let name = item
            .file_name()
            .into_string()
            .map_err(|_| WorkspaceError::ContentTransaction("附件名称无效".into()))?;
        let relative = item
            .path()
            .strip_prefix(root)
            .map_err(|_| WorkspaceError::ContentTransaction("附件路径越界".into()))?
            .to_string_lossy()
            .replace('\\', "/");
        let path = crate::sync_export::files::safe_path(root, &relative)?;
        if item.file_type()?.is_dir() {
            copy_assets(root, &path, &format!("{target}/{name}"), files)?;
        } else {
            files.push((format!("{target}/{name}"), SyncTrashSource::File(path)));
        }
    }
    Ok(())
}
