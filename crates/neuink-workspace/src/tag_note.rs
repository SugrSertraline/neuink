//! Tag-owned notes reuse the editor contract without creating an artificial Entry.
//! Metadata, Markdown, and source links are one atomic Markdown file.
use crate::{
    atomic_write,
    note::{validate_owned_note_links, NoteDocument},
    tag_reading::validate_id,
    Workspace, WorkspaceError,
};
use chrono::{DateTime, Utc};
use neuink_domain::{EntryId, LinkOwner, NoteId, SegmentUid, SourceLink, TagId};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

const HEADER_PREFIX: &str = "---\nneuink_note: ";
const MAX_NOTE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct TagNoteHeader {
    version: u16,
    tag_id: TagId,
    note_id: NoteId,
    pub(crate) title: String,
    pub(crate) links: Vec<SourceLink>,
    pub(crate) updated_at: DateTime<Utc>,
    pub(crate) deleted_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TagNoteSummary {
    pub note_id: NoteId,
    pub title: String,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
    pub revision: String,
}

fn invalid(message: &str) -> WorkspaceError {
    WorkspaceError::InvalidNoteDocument(message.into())
}
fn revision(text: &str) -> String {
    blake3::hash(text.as_bytes()).to_hex().to_string()
}

impl Workspace {
    pub fn tag_notes_dir(&self, tag_id: &TagId) -> Result<PathBuf, WorkspaceError> {
        validate_id(tag_id.as_str())?;
        let path = self
            .layout()
            .root()
            .join("tag-reading")
            .join(tag_id.as_str())
            .join("notes");
        self.validate_note_workspace_path(&path)?;
        Ok(path)
    }

    pub fn tag_note_file(
        &self,
        tag_id: &TagId,
        note_id: &NoteId,
    ) -> Result<PathBuf, WorkspaceError> {
        validate_id(note_id.as_str())?;
        let path = self.tag_notes_dir(tag_id)?.join(format!("{note_id}.md"));
        self.validate_note_workspace_path(&path)?;
        Ok(path)
    }

    pub(crate) fn validate_note_workspace_path(&self, path: &Path) -> Result<(), WorkspaceError> {
        let root = self.layout().root().canonicalize()?;
        let mut existing = path;
        while !existing.exists() {
            existing = existing.parent().ok_or_else(|| invalid("笔记路径不可用"))?;
        }
        let relative = existing
            .strip_prefix(self.layout().root())
            .map_err(|_| invalid("笔记路径超出资料库范围"))?;
        if existing.canonicalize()? != root.join(relative) {
            return Err(invalid("笔记路径经过重定向目录，请移回资料库后重试"));
        }
        Ok(())
    }

    fn ensure_note_tag(&self, tag_id: &TagId) -> Result<(), WorkspaceError> {
        if !self.list_tags()?.iter().any(|tag| &tag.id == tag_id) {
            return Err(WorkspaceError::TagMissing(tag_id.to_string()));
        }
        Ok(())
    }

    pub(crate) fn read_tag_note_file(
        &self,
        tag_id: &TagId,
        note_id: &NoteId,
    ) -> Result<(TagNoteHeader, String, String), WorkspaceError> {
        self.ensure_note_tag(tag_id)?;
        let path = self.tag_note_file(tag_id, note_id)?;
        if fs::metadata(&path)?.len() > MAX_NOTE_BYTES as u64 {
            return Err(invalid("笔记超过 32 MB，请拆分后编辑"));
        }
        let source = fs::read_to_string(path)?;
        let rest = source
            .strip_prefix(HEADER_PREFIX)
            .ok_or_else(|| invalid("综合笔记元数据缺失，未覆盖原文件"))?;
        let (metadata, markdown) = rest
            .split_once("\n---\n")
            .ok_or_else(|| invalid("综合笔记文件不完整，未覆盖原文件"))?;
        let header: TagNoteHeader = serde_json::from_str(metadata)?;
        if header.version != 1 || &header.tag_id != tag_id || &header.note_id != note_id {
            return Err(invalid("综合笔记格式或归属不兼容，请保留原文件"));
        }
        validate_owned_note_links(
            &LinkOwner::TagNote {
                tag_id: tag_id.clone(),
                note_id: note_id.clone(),
            },
            markdown,
            &header.links,
        )?;
        Ok((header, markdown.to_string(), revision(&source)))
    }

    pub fn list_tag_notes(&self, tag_id: &TagId) -> Result<Vec<TagNoteSummary>, WorkspaceError> {
        self.ensure_note_tag(tag_id)?;
        let directory = self.tag_notes_dir(tag_id)?;
        if !directory.exists() {
            return Ok(Vec::new());
        }
        let mut notes = Vec::new();
        for item in fs::read_dir(directory)? {
            let path = item?.path();
            if path.extension().is_none_or(|extension| extension != "md") {
                continue;
            }
            let id = path
                .file_stem()
                .and_then(|id| id.to_str())
                .ok_or_else(|| invalid("综合笔记文件名无效"))?;
            let (header, _, revision) =
                self.read_tag_note_file(tag_id, &NoteId::from_string(id))?;
            notes.push(TagNoteSummary {
                note_id: header.note_id,
                title: header.title,
                updated_at: header.updated_at,
                deleted_at: header.deleted_at,
                revision,
            });
        }
        notes.sort_by(|a, b| {
            b.updated_at
                .cmp(&a.updated_at)
                .then(a.note_id.cmp(&b.note_id))
        });
        Ok(notes)
    }

    pub fn read_tag_note(
        &self,
        tag_id: &TagId,
        note_id: &NoteId,
    ) -> Result<NoteDocument, WorkspaceError> {
        let (header, markdown, revision) = self.read_tag_note_file(tag_id, note_id)?;
        if header.deleted_at.is_some() {
            return Err(WorkspaceError::NoteMissing(note_id.to_string()));
        }
        Ok(NoteDocument {
            note_id: header.note_id,
            title: header.title,
            markdown,
            links: header.links,
            revision,
        })
    }

    pub fn create_tag_note(
        &self,
        tag_id: &TagId,
        title: String,
    ) -> Result<NoteDocument, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        self.ensure_note_tag(tag_id)?;
        let note_id = NoteId::new();
        let path = self.tag_note_file(tag_id, &note_id)?;
        if path.exists() {
            return Err(invalid("笔记标识冲突，请重试"));
        }
        let header = TagNoteHeader {
            version: 1,
            tag_id: tag_id.clone(),
            note_id,
            title: title.trim().to_string(),
            links: Vec::new(),
            updated_at: Utc::now(),
            deleted_at: None,
        };
        self.write_tag_note_file(&header, "")?;
        self.read_tag_note(tag_id, &header.note_id)
    }

    pub fn update_tag_note(
        &self,
        tag_id: &TagId,
        note_id: &NoteId,
        document: NoteDocument,
    ) -> Result<NoteDocument, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let (mut header, _, current_revision) = self.read_tag_note_file(tag_id, note_id)?;
        if header.deleted_at.is_some() {
            return Err(WorkspaceError::NoteMissing(note_id.to_string()));
        }
        if document.note_id != *note_id || document.revision != current_revision {
            return Err(WorkspaceError::NoteRevisionConflict(note_id.to_string()));
        }
        header.title = document.title.trim().to_string();
        header.links = validate_owned_note_links(
            &LinkOwner::TagNote {
                tag_id: tag_id.clone(),
                note_id: note_id.clone(),
            },
            &document.markdown,
            &document.links,
        )?;
        header.updated_at = Utc::now();
        self.write_tag_note_file(&header, &document.markdown)?;
        self.read_tag_note(tag_id, note_id)
    }

    pub fn set_tag_note_deleted(
        &self,
        tag_id: &TagId,
        note_id: &NoteId,
        deleted: bool,
        expected_revision: &str,
    ) -> Result<(), WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let (mut header, markdown, current_revision) = self.read_tag_note_file(tag_id, note_id)?;
        if current_revision != expected_revision {
            return Err(WorkspaceError::NoteRevisionConflict(note_id.to_string()));
        }
        header.deleted_at = if deleted { Some(Utc::now()) } else { None };
        header.updated_at = Utc::now();
        self.write_tag_note_file(&header, &markdown)
    }

    fn write_tag_note_file(
        &self,
        header: &TagNoteHeader,
        markdown: &str,
    ) -> Result<(), WorkspaceError> {
        if header.title.is_empty() {
            return Err(invalid("请输入笔记标题"));
        }
        let body = format!(
            "{HEADER_PREFIX}{}\n---\n{markdown}",
            serde_json::to_string(header)?
        );
        if body.len() > MAX_NOTE_BYTES {
            return Err(invalid("笔记超过 32 MB，请拆分后编辑"));
        }
        let path = self.tag_note_file(&header.tag_id, &header.note_id)?;
        atomic_write(path, body.as_bytes())
    }

    pub fn build_tag_note_source_link(
        &self,
        tag_id: &TagId,
        note_id: &NoteId,
        source_entry_id: &EntryId,
        segment_uid: SegmentUid,
    ) -> Result<SourceLink, WorkspaceError> {
        self.read_tag_note(tag_id, note_id)?;
        self.build_owned_source_link(
            LinkOwner::TagNote {
                tag_id: tag_id.clone(),
                note_id: note_id.clone(),
            },
            source_entry_id,
            segment_uid,
        )
    }

    pub fn write_tag_note_asset(
        &self,
        tag_id: &TagId,
        note_id: &NoteId,
        extension: &str,
        bytes: &[u8],
    ) -> Result<(String, PathBuf), WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        self.read_tag_note(tag_id, note_id)?;
        if !["png", "jpg", "jpeg", "gif", "webp", "avif"].contains(&extension)
            || bytes.is_empty()
            || bytes.len() > 20 * 1024 * 1024
        {
            return Err(invalid("图片格式不支持、为空或超过 20 MB"));
        }
        let name = format!("{}.{}", blake3::hash(bytes).to_hex(), extension);
        let relative = format!("{note_id}.assets/{name}");
        let path = self.tag_notes_dir(tag_id)?.join(&relative);
        self.validate_note_workspace_path(&path)?;
        atomic_write(&path, bytes)?;
        Ok((format!("./{relative}"), path))
    }
}

#[cfg(test)]
#[path = "tag_note_tests.rs"]
mod tests;
