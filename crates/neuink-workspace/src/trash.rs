use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use neuink_domain::{Annotation, ContentItem, EntryId, NoteId, SegmentBlockNote};
use serde::{Deserialize, Serialize};

use crate::{atomic_write_json, Workspace, WorkspaceError};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrashItemKind {
    Entry,
    MarkdownNote,
    SegmentNote,
    Annotation,
    Highlight,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TrashItem {
    pub trash_id: String,
    pub entry_id: EntryId,
    pub entry_title: String,
    pub kind: TrashItemKind,
    pub item_id: String,
    pub title: String,
    pub preview: String,
    pub deleted_at: DateTime<Utc>,
    pub parent_entry_trashed: bool,
    pub restorable: bool,
    pub stored_trash_item: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoredTrashRecord {
    trash_id: String,
    deleted_at: DateTime<Utc>,
    payload: StoredTrashPayload,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum StoredTrashPayload {
    MarkdownNote {
        note_id: NoteId,
        title: String,
        original_index: usize,
    },
    SegmentNote {
        note: SegmentBlockNote,
    },
    Annotation {
        annotation: Annotation,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct TrashedEntryState {
    deleted_at: DateTime<Utc>,
}

impl Workspace {
    pub fn list_trash_items(&self) -> Result<Vec<TrashItem>, WorkspaceError> {
        let mut items = Vec::new();

        for entry in self.list_entries()? {
            items.extend(self.read_stored_trash_items(
                &entry.id,
                &entry.title,
                &self.layout().entry_dir(&entry.id),
                false,
            )?);
        }

        for entry in self.list_trashed_entries()? {
            let entry_dir = self.layout().trashed_entry_dir(&entry.id);
            let entry_deleted_at = read_json_or_default::<Option<TrashedEntryState>>(
                &entry_dir.join(".trashed.json"),
            )?
            .map(|state| state.deleted_at)
            .unwrap_or(entry.updated_at);
            items.push(TrashItem {
                trash_id: format!("entry:{}", entry.id.as_str()),
                entry_id: entry.id.clone(),
                entry_title: entry.title.clone(),
                kind: TrashItemKind::Entry,
                item_id: entry.id.to_string(),
                title: entry.title.clone(),
                preview: "条目及其 PDF、笔记和片段记录".to_string(),
                deleted_at: entry_deleted_at,
                parent_entry_trashed: true,
                restorable: true,
                stored_trash_item: false,
            });
            items.extend(self.virtual_items_for_trashed_entry(
                &entry,
                &entry_dir,
                entry_deleted_at,
            )?);
            items.extend(self.read_stored_trash_items(
                &entry.id,
                &entry.title,
                &entry_dir,
                true,
            )?);
        }

        items.sort_by(|left, right| right.deleted_at.cmp(&left.deleted_at));
        Ok(items)
    }

    pub fn list_entry_trash_items(
        &self,
        entry_id: &EntryId,
    ) -> Result<Vec<TrashItem>, WorkspaceError> {
        let entry = self.read_entry(entry_id)?;
        let mut items = self.read_stored_trash_items(
            entry_id,
            &entry.title,
            &self.layout().entry_dir(entry_id),
            false,
        )?;
        items.sort_by(|left, right| right.deleted_at.cmp(&left.deleted_at));
        Ok(items)
    }

    pub fn restore_trash_item(
        &self,
        entry_id: &EntryId,
        trash_id: &str,
    ) -> Result<(), WorkspaceError> {
        let mut records = self.read_trash_records(&self.layout().entry_dir(entry_id))?;
        let index = records
            .iter()
            .position(|record| record.trash_id == trash_id)
            .ok_or_else(|| WorkspaceError::TrashItemMissing(trash_id.to_string()))?;
        let record = records[index].clone();

        match &record.payload {
            StoredTrashPayload::MarkdownNote {
                note_id,
                title,
                original_index,
            } => {
                let mut entry = self.read_entry(entry_id)?;
                if entry.contents.iter().any(|content| {
                    matches!(
                        content,
                        ContentItem::Note { note_id: current, .. } if current == note_id
                    )
                }) {
                    return Err(WorkspaceError::TrashRestoreConflict(note_id.to_string()));
                }
                self.restore_note_files(entry_id, note_id)?;
                let insert_at = (*original_index).min(entry.contents.len());
                entry.contents.insert(
                    insert_at,
                    ContentItem::Note {
                        note_id: note_id.clone(),
                        title: title.clone(),
                    },
                );
                entry.updated_at = Utc::now();
                atomic_write_json(self.layout().entry_meta_file(entry_id), &entry)?;
            }
            StoredTrashPayload::SegmentNote { note } => {
                let mut notes = self.read_segment_notes(entry_id)?;
                if notes
                    .iter()
                    .any(|current| current.segment_uid == note.segment_uid)
                {
                    return Err(WorkspaceError::TrashRestoreConflict(
                        note.segment_uid.to_string(),
                    ));
                }
                notes.push(note.clone());
                atomic_write_json(self.layout().entry_segment_notes_file(entry_id), &notes)?;
            }
            StoredTrashPayload::Annotation { annotation } => {
                let mut annotations = self.read_annotations(entry_id)?;
                if annotations
                    .iter()
                    .any(|current| current.annotation_id == annotation.annotation_id)
                {
                    return Err(WorkspaceError::TrashRestoreConflict(
                        annotation.annotation_id.to_string(),
                    ));
                }
                annotations.push(annotation.clone());
                atomic_write_json(self.layout().entry_annotations_file(entry_id), &annotations)?;
            }
        }

        records.remove(index);
        self.write_trash_records(entry_id, &records)
    }

    pub fn purge_trash_item(
        &self,
        entry_id: &EntryId,
        trash_id: &str,
    ) -> Result<(), WorkspaceError> {
        let mut records = self.read_trash_records(&self.layout().entry_dir(entry_id))?;
        let index = records
            .iter()
            .position(|record| record.trash_id == trash_id)
            .ok_or_else(|| WorkspaceError::TrashItemMissing(trash_id.to_string()))?;
        if let StoredTrashPayload::MarkdownNote { note_id, .. } = &records[index].payload {
            self.remove_trashed_note_files(entry_id, note_id)?;
        }
        records.remove(index);
        self.write_trash_records(entry_id, &records)
    }

    pub fn empty_entry_trash(&self, entry_id: &EntryId) -> Result<(), WorkspaceError> {
        self.read_entry(entry_id)?;
        let trash_dir = self.layout().entry_trash_dir(entry_id);
        if trash_dir.exists() {
            fs::remove_dir_all(trash_dir)?;
        }
        Ok(())
    }

    pub(crate) fn store_deleted_markdown_note(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
        title: String,
        original_index: usize,
    ) -> Result<(), WorkspaceError> {
        let mut records = self.read_trash_records(&self.layout().entry_dir(entry_id))?;
        let trash_id = format!("markdown_note:{}", note_id.as_str());
        records.retain(|record| record.trash_id != trash_id);
        self.move_note_files_to_trash(entry_id, note_id)?;
        records.push(StoredTrashRecord {
            trash_id,
            deleted_at: Utc::now(),
            payload: StoredTrashPayload::MarkdownNote {
                note_id: note_id.clone(),
                title,
                original_index,
            },
        });
        self.write_trash_records(entry_id, &records)
    }

    pub(crate) fn mark_entry_trashed(&self, entry_id: &EntryId) -> Result<(), WorkspaceError> {
        atomic_write_json(
            self.layout().entry_dir(entry_id).join(".trashed.json"),
            &TrashedEntryState {
                deleted_at: Utc::now(),
            },
        )
    }

    pub(crate) fn store_deleted_segment_note(
        &self,
        entry_id: &EntryId,
        note: SegmentBlockNote,
    ) -> Result<(), WorkspaceError> {
        let mut records = self.read_trash_records(&self.layout().entry_dir(entry_id))?;
        let trash_id = format!("segment_note:{}", note.segment_uid.as_str());
        records.retain(|record| record.trash_id != trash_id);
        records.push(StoredTrashRecord {
            trash_id,
            deleted_at: Utc::now(),
            payload: StoredTrashPayload::SegmentNote { note },
        });
        self.write_trash_records(entry_id, &records)
    }

    pub(crate) fn store_deleted_annotation(
        &self,
        entry_id: &EntryId,
        annotation: Annotation,
    ) -> Result<(), WorkspaceError> {
        let mut records = self.read_trash_records(&self.layout().entry_dir(entry_id))?;
        let trash_id = format!("annotation:{}", annotation.annotation_id.as_str());
        records.retain(|record| record.trash_id != trash_id);
        records.push(StoredTrashRecord {
            trash_id,
            deleted_at: Utc::now(),
            payload: StoredTrashPayload::Annotation { annotation },
        });
        self.write_trash_records(entry_id, &records)
    }

    fn virtual_items_for_trashed_entry(
        &self,
        entry: &neuink_domain::EntryMeta,
        entry_dir: &Path,
        deleted_at: DateTime<Utc>,
    ) -> Result<Vec<TrashItem>, WorkspaceError> {
        let mut items = Vec::new();
        for content in &entry.contents {
            let ContentItem::Note { note_id, title } = content;
            items.push(TrashItem {
                trash_id: format!(
                    "entry:{}:markdown_note:{}",
                    entry.id.as_str(),
                    note_id.as_str()
                ),
                entry_id: entry.id.clone(),
                entry_title: entry.title.clone(),
                kind: TrashItemKind::MarkdownNote,
                item_id: note_id.to_string(),
                title: title.clone(),
                preview: "随所属条目进入回收站".to_string(),
                deleted_at,
                parent_entry_trashed: true,
                restorable: false,
                stored_trash_item: false,
            });
        }

        let notes: Vec<SegmentBlockNote> =
            read_json_or_default(&entry_dir.join("segment-notes.json"))?;
        for note in notes {
            items.push(self.segment_note_item(entry, note, deleted_at, true, false, false));
        }
        let annotations: Vec<Annotation> =
            read_json_or_default(&entry_dir.join("paper.annotations.json"))?;
        for annotation in annotations {
            items.push(self.annotation_item(entry, annotation, deleted_at, true, false, false));
        }
        Ok(items)
    }

    fn read_stored_trash_items(
        &self,
        entry_id: &EntryId,
        entry_title: &str,
        entry_dir: &Path,
        parent_entry_trashed: bool,
    ) -> Result<Vec<TrashItem>, WorkspaceError> {
        let records = self.read_trash_records(entry_dir)?;
        let entry = neuink_domain::EntryMeta {
            id: entry_id.clone(),
            title: entry_title.to_string(),
            tags: Vec::new(),
            fields: Default::default(),
            pdf: None,
            contents: Vec::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        Ok(records
            .into_iter()
            .map(|record| match record.payload {
                StoredTrashPayload::MarkdownNote { note_id, title, .. } => TrashItem {
                    trash_id: record.trash_id,
                    entry_id: entry_id.clone(),
                    entry_title: entry_title.to_string(),
                    kind: TrashItemKind::MarkdownNote,
                    item_id: note_id.to_string(),
                    title,
                    preview: "已删除的 Markdown 笔记".to_string(),
                    deleted_at: record.deleted_at,
                    parent_entry_trashed,
                    restorable: !parent_entry_trashed,
                    stored_trash_item: true,
                },
                StoredTrashPayload::SegmentNote { note } => self.segment_note_item(
                    &entry,
                    note,
                    record.deleted_at,
                    parent_entry_trashed,
                    !parent_entry_trashed,
                    true,
                ),
                StoredTrashPayload::Annotation { annotation } => self.annotation_item(
                    &entry,
                    annotation,
                    record.deleted_at,
                    parent_entry_trashed,
                    !parent_entry_trashed,
                    true,
                ),
            })
            .collect())
    }

    fn segment_note_item(
        &self,
        entry: &neuink_domain::EntryMeta,
        note: SegmentBlockNote,
        deleted_at: DateTime<Utc>,
        parent_entry_trashed: bool,
        restorable: bool,
        stored_trash_item: bool,
    ) -> TrashItem {
        TrashItem {
            trash_id: format!("segment_note:{}", note.segment_uid.as_str()),
            entry_id: entry.id.clone(),
            entry_title: entry.title.clone(),
            kind: TrashItemKind::SegmentNote,
            item_id: note.segment_uid.to_string(),
            title: "片段笔记".to_string(),
            preview: compact_preview(&note.text),
            deleted_at,
            parent_entry_trashed,
            restorable,
            stored_trash_item,
        }
    }

    fn annotation_item(
        &self,
        entry: &neuink_domain::EntryMeta,
        annotation: Annotation,
        deleted_at: DateTime<Utc>,
        parent_entry_trashed: bool,
        restorable: bool,
        stored_trash_item: bool,
    ) -> TrashItem {
        let is_highlight = annotation.kind == "highlight";
        TrashItem {
            trash_id: format!("annotation:{}", annotation.annotation_id.as_str()),
            entry_id: entry.id.clone(),
            entry_title: entry.title.clone(),
            kind: if is_highlight {
                TrashItemKind::Highlight
            } else {
                TrashItemKind::Annotation
            },
            item_id: annotation.annotation_id.to_string(),
            title: if is_highlight {
                "高亮".to_string()
            } else {
                "批注".to_string()
            },
            preview: compact_preview(if annotation.content.is_empty() {
                annotation
                    .text_selection
                    .as_ref()
                    .map(|selection| selection.text.as_str())
                    .unwrap_or("")
            } else {
                &annotation.content
            }),
            deleted_at,
            parent_entry_trashed,
            restorable,
            stored_trash_item,
        }
    }

    fn read_trash_records(
        &self,
        entry_dir: &Path,
    ) -> Result<Vec<StoredTrashRecord>, WorkspaceError> {
        read_json_or_default(&entry_dir.join(".trash").join("items.json"))
    }

    fn write_trash_records(
        &self,
        entry_id: &EntryId,
        records: &[StoredTrashRecord],
    ) -> Result<(), WorkspaceError> {
        let trash_dir = self.layout().entry_trash_dir(entry_id);
        fs::create_dir_all(&trash_dir)?;
        atomic_write_json(
            self.layout().entry_trash_index_file(entry_id),
            &records.to_vec(),
        )
    }

    fn move_note_files_to_trash(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
    ) -> Result<(), WorkspaceError> {
        let target_dir = self.layout().entry_trash_notes_dir(entry_id);
        fs::create_dir_all(&target_dir)?;
        move_if_exists(
            self.layout().entry_note_file(entry_id, note_id),
            target_dir.join(format!("{}.md", note_id.as_str())),
        )?;
        move_if_exists(
            self.layout().entry_note_links_file(entry_id, note_id),
            target_dir.join(format!("{}.links.json", note_id.as_str())),
        )?;
        move_if_exists(
            self.layout().entry_note_assets_dir(entry_id, note_id),
            target_dir.join(format!("{}.assets", note_id.as_str())),
        )?;
        Ok(())
    }

    fn restore_note_files(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
    ) -> Result<(), WorkspaceError> {
        let source_dir = self.layout().entry_trash_notes_dir(entry_id);
        fs::create_dir_all(self.layout().entry_notes_dir(entry_id))?;
        move_if_exists(
            source_dir.join(format!("{}.md", note_id.as_str())),
            self.layout().entry_note_file(entry_id, note_id),
        )?;
        move_if_exists(
            source_dir.join(format!("{}.links.json", note_id.as_str())),
            self.layout().entry_note_links_file(entry_id, note_id),
        )?;
        move_if_exists(
            source_dir.join(format!("{}.assets", note_id.as_str())),
            self.layout().entry_note_assets_dir(entry_id, note_id),
        )?;
        Ok(())
    }

    fn remove_trashed_note_files(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
    ) -> Result<(), WorkspaceError> {
        let dir = self.layout().entry_trash_notes_dir(entry_id);
        remove_if_exists(dir.join(format!("{}.md", note_id.as_str())))?;
        remove_if_exists(dir.join(format!("{}.links.json", note_id.as_str())))?;
        remove_if_exists(dir.join(format!("{}.assets", note_id.as_str())))?;
        Ok(())
    }
}

fn read_json_or_default<T>(path: &Path) -> Result<T, WorkspaceError>
where
    T: for<'de> Deserialize<'de> + Default,
{
    if !path.exists() {
        return Ok(T::default());
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn move_if_exists(source: PathBuf, target: PathBuf) -> Result<(), WorkspaceError> {
    if !source.exists() {
        return Ok(());
    }
    if target.exists() {
        remove_if_exists(target.clone())?;
    }
    fs::rename(source, target)?;
    Ok(())
}

fn remove_if_exists(path: PathBuf) -> Result<(), WorkspaceError> {
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn compact_preview(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    compact.chars().take(180).collect()
}
