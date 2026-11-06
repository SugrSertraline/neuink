//! Explicit append-only note snapshots. The journal publishes documents, provenance and metadata together.
use crate::{
    atomic_write, atomic_write_json, entry_sources::is_source_managed_dir,
    tag_reading::validate_id, Workspace, WorkspaceError,
};
use chrono::Utc;
use neuink_domain::{ContentItem, EntryId, EntryMeta, NoteId};
use neuink_zotero::Paper;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io::ErrorKind};

const RECORDS: &str = "imported-source-notes.json";
const JOURNAL: &str = "source-note-import.journal.json";

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct ImportedSourceNote {
    pub source_id: String,
    pub item_id: String,
    pub note_key: String,
    pub content_hash: String,
    pub note_id: NoteId,
    pub imported_at: chrono::DateTime<Utc>,
    pub original_html: String,
}
#[derive(Serialize)]
pub struct SourceNoteCandidate {
    pub key: String,
    pub content_hash: String,
    pub title: String,
    pub text: String,
    pub imported: bool,
}
#[derive(Deserialize)]
pub struct SourceNoteSelection {
    pub key: String,
    pub content_hash: String,
}
#[derive(Serialize)]
pub struct SourceNoteImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub entry_id: EntryId,
}
#[derive(Deserialize, Serialize)]
struct PendingNote {
    id: NoteId,
    document: String,
}
#[derive(Deserialize, Serialize)]
struct NoteImportJournal {
    version: u16,
    entry_id: EntryId,
    before_meta: String,
    before_records: Option<String>,
    after_meta: EntryMeta,
    after_records: Vec<ImportedSourceNote>,
    notes: Vec<PendingNote>,
}

fn failure(message: &str) -> WorkspaceError {
    WorkspaceError::Zotero(message.into())
}
fn hash(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}
fn optional_bytes(path: &std::path::Path) -> Result<Option<Vec<u8>>, WorkspaceError> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

impl Workspace {
    fn imported_source_notes(
        &self,
        target: &EntryId,
    ) -> Result<Vec<ImportedSourceNote>, WorkspaceError> {
        optional_bytes(&self.layout().entry_dir(target).join(RECORDS))?
            .map(|bytes| serde_json::from_slice(&bytes).map_err(Into::into))
            .unwrap_or(Ok(vec![]))
    }

    fn source_note_target(&self, target: &EntryId) -> Result<EntryMeta, WorkspaceError> {
        validate_id(target.as_str())?;
        let entry = self.read_entry(target)?;
        if is_source_managed_dir(&self.layout().entry_dir(target))? {
            return Err(failure(
                "请选择独立的本地条目，来源条目不作为笔记导入目标。",
            ));
        }
        Ok(entry)
    }

    pub fn source_note_candidates(
        &self,
        source_id: &str,
        paper: &Paper,
        target: &EntryId,
    ) -> Result<Vec<SourceNoteCandidate>, WorkspaceError> {
        let entry = self.source_note_target(target)?;
        let records = self.imported_source_notes(target)?;
        Ok(paper.notes.iter().enumerate().map(|(index, note)| {
            let content_hash = hash(note.html.as_bytes());
            let text = crate::zotero_note_sync::imported_markdown(&note.html);
            let imported = records.iter().any(|record| record.source_id == source_id && record.item_id == paper.id && record.note_key == note.key && record.content_hash == content_hash && entry.contents.iter().any(|content| matches!(content, ContentItem::Note { note_id, .. } if note_id == &record.note_id)));
            SourceNoteCandidate { key: note.key.clone(), content_hash, title: format!("Zotero 笔记 {}", index + 1), text, imported }
        }).collect())
    }

    pub fn import_source_notes(
        &self,
        source_id: &str,
        paper: &Paper,
        target: &EntryId,
        selected: &[SourceNoteSelection],
    ) -> Result<SourceNoteImportResult, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let mut entry = self.source_note_target(target)?;
        let before_meta = hash(&fs::read(self.layout().entry_meta_file(target))?);
        let before_records = optional_bytes(&self.layout().entry_dir(target).join(RECORDS))?
            .map(|bytes| hash(&bytes));
        let candidates = self.source_note_candidates(source_id, paper, target)?;
        let mut records = self.imported_source_notes(target)?;
        let mut notes = Vec::new();
        let mut skipped = 0;
        let mut keys = HashSet::new();
        let mut size = 0;
        // Validate every selected version before publishing any note.
        for selection in selected {
            if !keys.insert(&selection.key) {
                return Err(failure("重复的笔记选择，请重新选择。"));
            }
            let index = candidates
                .iter()
                .position(|candidate| {
                    candidate.key == selection.key
                        && candidate.content_hash == selection.content_hash
                })
                .ok_or_else(|| failure("Zotero 笔记在预览后发生变化，请重新读取并选择。"))?;
            if candidates[index].imported {
                skipped += 1;
                continue;
            }
            let original = &paper.notes[index];
            size += original.html.len();
            if size > 10_000_000 {
                return Err(failure("本次笔记内容超过 10 MB，请分批导入。"));
            }
            let id = NoteId::new();
            let title = candidates[index].title.clone();
            let quoted_title = serde_json::to_string(&title)?;
            let document = format!("---\nkind: note\nentry_id: {target}\nnote_id: {id}\ntitle: {quoted_title}\n---\n\n{}", candidates[index].text);
            entry.contents.push(ContentItem::Note {
                note_id: id.clone(),
                title,
            });
            records.push(ImportedSourceNote {
                source_id: source_id.into(),
                item_id: paper.id.clone(),
                note_key: original.key.clone(),
                content_hash: selection.content_hash.clone(),
                note_id: id.clone(),
                imported_at: Utc::now(),
                original_html: original.html.clone(),
            });
            notes.push(PendingNote { id, document });
        }
        let imported = notes.len();
        if imported > 0 {
            entry.updated_at = Utc::now();
            entry.validate()?;
            atomic_write_json(
                self.layout().root().join(JOURNAL),
                &NoteImportJournal {
                    version: 1,
                    entry_id: target.clone(),
                    before_meta,
                    before_records,
                    after_meta: entry,
                    after_records: records,
                    notes,
                },
            )?;
            self.recover_source_note_import()?;
        }
        Ok(SourceNoteImportResult {
            imported,
            skipped,
            entry_id: target.clone(),
        })
    }

    pub(crate) fn recover_source_note_import(&self) -> Result<(), WorkspaceError> {
        let path = self.layout().root().join(JOURNAL);
        let Some(bytes) = optional_bytes(&path)? else {
            return Ok(());
        };
        if !path
            .canonicalize()?
            .starts_with(self.layout().root().canonicalize()?)
        {
            return Err(failure("笔记导入恢复路径超出资料库。"));
        }
        let journal: NoteImportJournal = serde_json::from_slice(&bytes)?;
        validate_id(journal.entry_id.as_str())?;
        if journal.version != 1 || journal.entry_id != journal.after_meta.id {
            return Err(failure("笔记导入恢复记录无效，已保留记录。"));
        }
        journal.after_meta.validate()?;
        self.source_note_target(&journal.entry_id)?;
        let dir = self.layout().entry_dir(&journal.entry_id);
        let root = self.layout().root().canonicalize()?;
        if !dir.canonicalize()?.starts_with(&root) {
            return Err(failure("笔记导入目标超出资料库。"));
        }
        let metadata = self.layout().entry_meta_file(&journal.entry_id);
        let record_file = dir.join(RECORDS);
        let after_meta = serde_json::to_vec_pretty(&journal.after_meta)?;
        let after_records = serde_json::to_vec_pretty(&journal.after_records)?;
        let current_meta = hash(&fs::read(&metadata)?);
        let current_records = optional_bytes(&record_file)?.map(|bytes| hash(&bytes));
        if current_meta != journal.before_meta && current_meta != hash(&after_meta)
            || current_records != journal.before_records
                && current_records != Some(hash(&after_records))
        {
            return Err(failure("笔记导入恢复遇到外部修改，已保留草稿与恢复记录。"));
        }
        fs::create_dir_all(self.layout().entry_notes_dir(&journal.entry_id))?;
        if !self
            .layout()
            .entry_notes_dir(&journal.entry_id)
            .canonicalize()?
            .starts_with(&root)
        {
            return Err(failure("笔记目录超出资料库。"));
        }
        let mut pending = Vec::new();
        for note in &journal.notes {
            validate_id(note.id.as_str())?;
            let file = self.layout().entry_note_file(&journal.entry_id, &note.id);
            if let Some(bytes) = optional_bytes(&file)? {
                if hash(&bytes) != hash(note.document.as_bytes()) {
                    return Err(failure("笔记导入文件已被修改，停止恢复以保留内容。"));
                }
            } else {
                pending.push((file, &note.document));
            }
        }
        for (file, document) in pending {
            atomic_write(file, document.as_bytes())?;
        }
        atomic_write(&record_file, &after_records)?;
        atomic_write(&metadata, &after_meta)?;
        fs::remove_file(path)?;
        Ok(())
    }

    pub(crate) fn record_copied_zotero_notes(
        &self,
        source: &EntryId,
        destination: &std::path::Path,
        replacements: &[(String, String)],
    ) -> Result<(), WorkspaceError> {
        let baselines = self.zotero_note_baselines(source)?;
        let originals: Vec<serde_json::Value> =
            optional_bytes(&self.layout().entry_dir(source).join("zotero-notes.json"))?
                .map(|bytes| serde_json::from_slice(&bytes))
                .transpose()?
                .unwrap_or_default();
        let mut records = Vec::new();
        for origin in self.zotero_sources(source)? {
            for (key, old_id) in origin.note_ids {
                let html = baselines
                    .get(old_id.as_str())
                    .map(|baseline| baseline.source_html.clone())
                    .or_else(|| {
                        originals
                            .iter()
                            .find(|note| note["key"].as_str() == Some(&key))
                            .and_then(|note| note["html"].as_str())
                            .map(str::to_owned)
                    });
                if let (Some(html), Some((_, new))) = (
                    html,
                    replacements.iter().find(|(old, _)| old == old_id.as_str()),
                ) {
                    records.push(ImportedSourceNote {
                        source_id: origin.source_id.clone(),
                        item_id: origin.item_id.clone(),
                        note_key: key,
                        content_hash: hash(html.as_bytes()),
                        note_id: NoteId::from_string(new),
                        imported_at: Utc::now(),
                        original_html: html,
                    });
                }
            }
        }
        if !records.is_empty() {
            atomic_write_json(destination.join(RECORDS), &records)?;
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "source_notes_tests.rs"]
mod tests;
