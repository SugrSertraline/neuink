//! Provenance and independent local editing baselines for copied Zotero notes.
use crate::{atomic_write_json, Workspace, WorkspaceError};
use neuink_domain::{EntryId, NoteId};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs};

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct NoteBaseline {
    pub note_key: String,
    pub imported_html: String,
    pub source_html: String,
    pub local_markdown: String,
    pub local_title: String,
}

#[derive(Serialize)]
pub struct ZoteroNoteStatus {
    pub note_key: String,
    pub local_modified: bool,
    pub source_html: Option<String>,
}

pub(crate) fn imported_markdown(html: &str) -> String {
    let separated = html.replace("</p>", "</p>\n\n").replace("</div>", "</div>\n\n")
        .replace("<br>", "<br>\n").replace("<br/>", "<br/>\n").replace("<br />", "<br />\n");
    let mut plain = scraper::Html::parse_fragment(&separated).root_element().text().collect::<String>().trim().to_owned();
    if html.contains("<img") { plain.push_str("\n\n[原笔记包含图片；图片请在 Zotero 中查看。]"); }
    plain
}

impl Workspace {
    pub(crate) fn zotero_note_baselines(&self, entry: &EntryId) -> Result<HashMap<String, NoteBaseline>, WorkspaceError> {
        match fs::read(self.layout().entry_dir(entry).join("zotero-note-sync.json")) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
            Err(error) => Err(error.into()),
        }
    }

    pub fn zotero_note_status(&self, entry: &EntryId, note: &NoteId) -> Result<Option<ZoteroNoteStatus>, WorkspaceError> {
        let key = self.zotero_sources(entry)?.into_iter().find_map(|source| source.note_ids.into_iter().find_map(|(key, id)| (id == *note).then_some(key)));
        let Some(key) = key else { return Ok(None); };
        let local = self.read_note(entry, note)?;
        let baseline = self.zotero_note_baselines(entry)?.remove(note.as_str());
        let (local_modified, source_html) = if let Some(baseline) = baseline {
            (local.markdown != baseline.local_markdown || local.title != baseline.local_title, Some(baseline.source_html))
        } else {
            // Legacy imports retain original HTML; never adopt an edited local note as the baseline.
            let originals: Vec<serde_json::Value> = serde_json::from_slice(&fs::read(self.layout().entry_dir(entry).join("zotero-notes.json"))?)?;
            let html = originals.iter().find(|item| item["key"].as_str() == Some(&key))
                .and_then(|item| item["html"].as_str()).map(str::to_owned);
            (html.as_ref().map(|html| local.markdown != imported_markdown(html)).unwrap_or(true), html)
        };
        Ok(Some(ZoteroNoteStatus { note_key: key, local_modified, source_html }))
    }

    pub fn record_zotero_note_write(&self, entry: &EntryId, note: &NoteId, html: &str) -> Result<(), WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let Some(status) = self.zotero_note_status(entry, note)? else { return Err(WorkspaceError::Zotero("笔记没有 Zotero 来源记录。".into())); };
        let mut baselines = self.zotero_note_baselines(entry)?;
        let local = self.read_note(entry, note)?;
        let imported_html = if let Some(previous) = baselines.get(note.as_str()) { previous.imported_html.clone() } else {
            let originals: Vec<serde_json::Value> = serde_json::from_slice(&fs::read(self.layout().entry_dir(entry).join("zotero-notes.json"))?)?;
            originals.iter().find(|item| item["key"].as_str() == Some(&status.note_key)).and_then(|item| item["html"].as_str())
                .ok_or_else(|| WorkspaceError::Zotero("缺少导入时的 Zotero 笔记原文。".into()))?.to_owned()
        };
        baselines.insert(note.to_string(), NoteBaseline { note_key: status.note_key, imported_html, source_html: html.to_owned(), local_markdown: local.markdown, local_title: local.title });
        atomic_write_json(self.layout().entry_dir(entry).join("zotero-note-sync.json"), &baselines)
    }
}
