//! Rebuildable, owner-neutral catalog. A broken note is reported without hiding other notes.
use crate::{note::NoteDocument, Workspace, WorkspaceError};
use neuink_domain::{ContentItem, NoteId, NoteOwner, NoteTarget, SourceLink};
use pulldown_cmark::{Event, Options, Parser, Tag};
use serde::Serialize;
use std::{collections::BTreeSet, fs, ops::Range};

pub fn source_reference_ranges(markdown: &str) -> Vec<(Range<usize>, String)> {
    let protected: Vec<_> = Parser::new_ext(markdown, Options::all()).into_offset_iter()
        .filter_map(|(event, range)| matches!(event, Event::Code(_) | Event::Start(Tag::CodeBlock(_))).then_some(range)).collect();
    markdown.match_indices("[^sl-").filter_map(|(start, _)| {
        if protected.iter().any(|range| range.contains(&start)) { return None; }
        // Escaped markers are ordinary text, not evidence references.
        if markdown[..start].bytes().rev().take_while(|ch| *ch == b'\\').count() % 2 == 1 { return None; }
        let close = markdown[start..].find(']')?;
        let end = start + close + 1;
        let anchor = &markdown[start + 2..end - 1];
        crate::tag_reading::validate_id(anchor).ok()?;
        Some((start..end, anchor.to_owned()))
    }).collect()
}

pub fn referenced_links(markdown: &str, links: &[SourceLink]) -> Vec<SourceLink> {
    let anchors: BTreeSet<_> = source_reference_ranges(markdown).into_iter().map(|(_, anchor)| anchor).collect();
    links.iter().filter(|link| anchors.contains(&link.anchor_id)).cloned().collect()
}

#[derive(Debug, Serialize)]
pub struct CatalogNote {
    pub target: NoteTarget,
    pub title: String,
    pub owner_title: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: String,
    pub links: Vec<SourceLink>,
    pub source_statuses: Vec<crate::source_availability::SourceAvailability>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct NoteCatalog { pub notes: Vec<CatalogNote>, pub errors: Vec<String> }

impl Workspace {
    pub fn read_note_catalog(&self) -> Result<NoteCatalog, WorkspaceError> {
        let mut catalog = NoteCatalog { notes: Vec::new(), errors: Vec::new() };
        for entry in self.list_entries()? {
            for ContentItem::Note { note_id, title, .. } in &entry.contents {
                let target = NoteTarget { owner: NoteOwner::Entry { entry_id: entry.id.clone() }, note_id: note_id.clone() };
                catalog.notes.push(catalog_note(target, title.clone(), entry.title.clone(), entry.updated_at.to_rfc3339(), self.read_note(&entry.id, note_id)));
            }
        }
        for tag in self.list_tags()? {
            let dir = self.tag_notes_dir(&tag.id)?;
            if !dir.exists() { continue; }
            let items = match fs::read_dir(dir) {
                Ok(items) => items,
                Err(error) => { catalog.errors.push(format!("{}：{error}", tag.name)); continue; }
            };
            for item in items {
                let path = match item { Ok(item) => item.path(), Err(error) => { catalog.errors.push(error.to_string()); continue; } };
                if path.extension().is_none_or(|ext| ext != "md") { continue; }
                let Some(id) = path.file_stem().and_then(|id| id.to_str()) else { continue; };
                let note_id = NoteId::from_string(id);
                let target = NoteTarget { owner: NoteOwner::TagReading { tag_id: tag.id.clone() }, note_id: note_id.clone() };
                match self.read_tag_note_file(&tag.id, &note_id) {
                    Ok((header, markdown, revision)) => catalog.notes.push(CatalogNote {
                        target, title: header.title, owner_title: tag.name.clone(), updated_at: header.updated_at.to_rfc3339(),
                        deleted_at: header.deleted_at.map(|date| date.to_rfc3339()), revision,
                        links: referenced_links(&markdown, &header.links), source_statuses: Vec::new(), error: None,
                    }),
                    Err(error) => catalog.notes.push(catalog_note(target, id.to_owned(), tag.name.clone(), String::new(), Err(error))),
                }
            }
        }
        let sources = catalog.notes.iter().flat_map(|note| note.links.iter().flat_map(|link| link.sources.clone())).collect::<Vec<_>>();
        let mut statuses = self.inspect_sources(&sources).into_iter();
        for note in &mut catalog.notes {
            note.source_statuses = statuses.by_ref().take(note.links.iter().map(|link| link.sources.len()).sum()).collect();
        }
        catalog.notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.title.cmp(&b.title)));
        Ok(catalog)
    }
}

fn catalog_note(target: NoteTarget, title: String, owner_title: String, updated_at: String, result: Result<NoteDocument, WorkspaceError>) -> CatalogNote {
    match result {
        Ok(note) => CatalogNote { target, title: note.title, owner_title, updated_at, deleted_at: None,
            revision: note.revision, links: referenced_links(&note.markdown, &note.links), source_statuses: Vec::new(), error: None },
        Err(error) => CatalogNote { target, title, owner_title, updated_at, deleted_at: None,
            revision: String::new(), links: Vec::new(), source_statuses: Vec::new(), error: Some(error.to_string()) },
    }
}
