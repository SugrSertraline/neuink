//! Date-owned Markdown. Header, sources and body commit together, just like tag notes.
use crate::{
    atomic_write,
    daily::{invalid, revision, validate_date},
    note::{validate_owned_note_links, NoteDocument},
    note_catalog::CatalogNote,
    Workspace, WorkspaceError,
};
use chrono::Utc;
use neuink_domain::{EntryId, LinkOwner, NoteId, NoteOwner, NoteTarget, SegmentUid, SourceLink};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

const PREFIX: &str = "---\nneuink_daily_note: ";
const MAX_BYTES: usize = 32 * 1024 * 1024;
#[derive(Deserialize, Serialize)]
struct Header {
    version: u16,
    date: String,
    title: String,
    links: Vec<SourceLink>,
    updated_at: String,
}
fn owner(date: &str) -> LinkOwner {
    LinkOwner::DailyNote {
        date: date.into(),
        note_id: NoteId::from_string("journal"),
    }
}

impl Workspace {
    pub fn daily_note_file(&self, date: &str) -> Result<PathBuf, WorkspaceError> {
        validate_date(date)?;
        let path = self.daily_dir()?.join("notes").join(format!("{date}.md"));
        self.validate_note_workspace_path(&path)?;
        Ok(path)
    }
    pub fn read_daily_note(&self, date: &str) -> Result<NoteDocument, WorkspaceError> {
        let path = self.daily_note_file(date)?;
        if !path.exists() {
            return Ok(NoteDocument {
                note_id: NoteId::from_string("journal"),
                title: format!("{date} 每日记录"),
                markdown: String::new(),
                links: vec![],
                revision: "missing".into(),
            });
        }
        if fs::metadata(&path)?.len() > MAX_BYTES as u64 {
            return Err(invalid("每日记录超过 32 MB"));
        }
        let text = fs::read_to_string(path)?;
        let (meta, markdown) = text
            .strip_prefix(PREFIX)
            .and_then(|s| s.split_once("\n---\n"))
            .ok_or_else(|| invalid("每日记录元数据损坏，未覆盖原文件"))?;
        let header: Header = serde_json::from_str(meta)?;
        if header.version != 1 || header.date != date {
            return Err(invalid("每日记录归属或版本不兼容"));
        }
        validate_owned_note_links(&owner(date), markdown, &header.links)?;
        Ok(NoteDocument {
            note_id: NoteId::from_string("journal"),
            title: header.title,
            markdown: markdown.into(),
            links: header.links,
            revision: revision(text.as_bytes()),
        })
    }
    pub fn save_daily_note(
        &self,
        date: &str,
        document: NoteDocument,
    ) -> Result<NoteDocument, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let current = self.read_daily_note(date)?;
        if document.note_id.as_str() != "journal" {
            return Err(invalid("每日记录标识无效"));
        }
        if current.revision != document.revision {
            return Err(WorkspaceError::NoteRevisionConflict(date.into()));
        }
        if document.title.trim().is_empty() || document.title.len() > 500 {
            return Err(invalid("请输入不超过 500 字节的记录标题"));
        }
        validate_owned_note_links(&owner(date), &document.markdown, &document.links)?;
        let header = Header {
            version: 1,
            date: date.into(),
            title: document.title,
            links: document.links,
            updated_at: Utc::now().to_rfc3339(),
        };
        let text = format!(
            "{PREFIX}{}\n---\n{}",
            serde_json::to_string(&header)?,
            document.markdown
        );
        if text.len() > MAX_BYTES {
            return Err(invalid("每日记录超过 32 MB"));
        }
        atomic_write(self.daily_note_file(date)?, text.as_bytes())?;
        self.read_daily_note(date)
    }
    pub fn build_daily_note_source_link(
        &self,
        date: &str,
        entry: &EntryId,
        segment: SegmentUid,
    ) -> Result<SourceLink, WorkspaceError> {
        self.read_daily_note(date)?;
        self.build_owned_source_link(owner(date), entry, segment)
    }
    pub fn write_daily_note_asset(
        &self,
        date: &str,
        extension: &str,
        bytes: &[u8],
    ) -> Result<(String, PathBuf), WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        self.read_daily_note(date)?;
        if !["png", "jpg", "jpeg", "gif", "webp", "avif"].contains(&extension)
            || bytes.is_empty()
            || bytes.len() > 20 * 1024 * 1024
        {
            return Err(invalid("图片格式不支持、为空或超过 20 MB"));
        }
        let relative = format!(
            "{date}.assets/{}.{}",
            blake3::hash(bytes).to_hex(),
            extension
        );
        let path = self.daily_dir()?.join("notes").join(&relative);
        self.validate_note_workspace_path(&path)?;
        atomic_write(&path, bytes)?;
        Ok((format!("./{relative}"), path))
    }
    pub(crate) fn append_daily_note_catalog(
        &self,
        notes: &mut Vec<CatalogNote>,
        errors: &mut Vec<String>,
    ) -> Result<(), WorkspaceError> {
        let directory = self.daily_dir()?.join("notes");
        self.validate_note_workspace_path(&directory)?;
        if !directory.exists() {
            return Ok(());
        }
        for item in fs::read_dir(directory)? {
            let path = item?.path();
            if path.extension().is_none_or(|ext| ext != "md") {
                continue;
            }
            let Some(date) = path.file_stem().and_then(|date| date.to_str()) else {
                continue;
            };
            match self.read_daily_note(date) {
                Ok(doc) => {
                    let text = fs::read_to_string(self.daily_note_file(date)?)?;
                    let header: Header = serde_json::from_str(
                        text.strip_prefix(PREFIX)
                            .and_then(|s| s.split_once("\n---\n"))
                            .ok_or_else(|| invalid("每日记录元数据损坏"))?
                            .0,
                    )?;
                    notes.push(CatalogNote {
                        target: NoteTarget {
                            owner: NoteOwner::Daily { date: date.into() },
                            note_id: doc.note_id,
                        },
                        title: doc.title,
                        owner_title: format!("{date} 每日记录"),
                        updated_at: header.updated_at,
                        deleted_at: None,
                        revision: doc.revision,
                        links: crate::note_catalog::referenced_links(&doc.markdown, &doc.links),
                        source_statuses: vec![],
                        error: None,
                    });
                }
                Err(error) => errors.push(format!("每日记录 {date}：{error}")),
            }
        }
        Ok(())
    }
}
