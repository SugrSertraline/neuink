use std::{collections::BTreeMap, fs};

use chrono::Utc;
use neuink_domain::{
    ContentItem, EntryId, EntryMeta, NoteId, PdfParseStatus, SegmentRef, SegmentUid, SourceLink,
    SourceSegment,
};
use serde::Serialize;

use crate::{atomic_write, atomic_write_json, Workspace, WorkspaceError};

#[derive(Clone, Debug, Serialize)]
pub struct NoteDocument {
    pub note_id: NoteId,
    pub title: String,
    pub markdown: String,
    pub links: Vec<SourceLink>,
}

impl Workspace {
    pub fn read_note(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
    ) -> Result<NoteDocument, WorkspaceError> {
        let entry = self.read_entry(entry_id)?;
        let title = entry
            .contents
            .iter()
            .find_map(|content| match content {
                ContentItem::Note {
                    note_id: content_note_id,
                    title,
                } if content_note_id == note_id => Some(title.clone()),
                _ => None,
            })
            .ok_or_else(|| WorkspaceError::NoteMissing(note_id.to_string()))?;

        let note_path = self.layout().entry_note_file(entry_id, note_id);
        if !note_path.exists() {
            return Err(WorkspaceError::NoteMissing(note_id.to_string()));
        }

        let markdown = strip_frontmatter(&fs::read_to_string(note_path)?).to_string();
        let mut links = self.read_note_links(entry_id, note_id)?;
        self.enrich_note_source_link_assets(&mut links);
        Ok(NoteDocument {
            note_id: note_id.clone(),
            title,
            markdown,
            links,
        })
    }

    pub fn update_note(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
        title: impl Into<String>,
        markdown: impl Into<String>,
    ) -> Result<NoteDocument, WorkspaceError> {
        let title = normalize_note_title(title.into());
        let markdown = markdown.into();
        let mut entry = self.read_entry(entry_id)?;
        let mut note_found = false;

        for content in &mut entry.contents {
            let ContentItem::Note {
                note_id: content_note_id,
                title: content_title,
            } = content;
            if content_note_id == note_id {
                *content_title = title.clone();
                note_found = true;
            }
        }

        if !note_found {
            return Err(WorkspaceError::NoteMissing(note_id.to_string()));
        }

        let frontmatter_title = title.replace('\\', "\\\\").replace('"', "\\\"");
        let body = format!(
            "---\nkind: note\nentry_id: {}\nnote_id: {}\ntitle: \"{}\"\nupdated_at: \"{}\"\n---\n\n{}",
            entry_id.as_str(),
            note_id.as_str(),
            frontmatter_title,
            Utc::now().to_rfc3339(),
            markdown.trim_start()
        );
        atomic_write(
            self.layout().entry_note_file(entry_id, note_id),
            body.as_bytes(),
        )?;
        entry.updated_at = Utc::now();
        atomic_write_json(self.layout().entry_meta_file(entry_id), &entry)?;
        self.read_note(entry_id, note_id)
    }

    pub fn delete_note(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
    ) -> Result<EntryMeta, WorkspaceError> {
        let mut entry = self.read_entry(entry_id)?;
        let (original_index, title) = entry
            .contents
            .iter()
            .enumerate()
            .find_map(|(index, content)| match content {
                ContentItem::Note {
                    note_id: current,
                    title,
                } if current == note_id => Some((index, title.clone())),
                _ => None,
            })
            .ok_or_else(|| WorkspaceError::NoteMissing(note_id.to_string()))?;
        self.store_deleted_markdown_note(entry_id, note_id, title, original_index)?;
        entry.contents.retain(|content| match content {
            ContentItem::Note {
                note_id: content_note_id,
                ..
            } => content_note_id != note_id,
        });

        entry.updated_at = Utc::now();
        atomic_write_json(self.layout().entry_meta_file(entry_id), &entry)?;
        Ok(entry)
    }

    pub fn create_note_source_link(
        &self,
        owner_entry_id: &EntryId,
        note_id: &NoteId,
        source_entry_id: &EntryId,
        segment_uid: SegmentUid,
    ) -> Result<SourceLink, WorkspaceError> {
        self.read_note(owner_entry_id, note_id)?;
        let source_entry = self.read_entry(source_entry_id)?;
        let parse_status = source_entry.pdf.as_ref().map(|pdf| pdf.parse.status);
        if parse_status != Some(PdfParseStatus::Succeeded) {
            return Err(WorkspaceError::PdfNotParsed(source_entry_id.to_string()));
        }

        let segment = self.resolve_source_segment(source_entry_id, &segment_uid)?;
        let source_segment_uid = segment.uid.clone();
        let snapshot_text = segment
            .markdown
            .as_ref()
            .filter(|markdown| !markdown.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| segment.text.clone());
        let anchor_id = format!("sl-{}", neuink_domain::SourceLinkId::new().as_str());
        let source = SegmentRef {
            entry_id: source_entry_id.clone(),
            segment_uid: source_segment_uid,
            page: segment.page_idx + 1,
            bbox: segment.bbox,
            segment_type: Some(segment.segment_type),
            quote_hash: blake3::hash(snapshot_text.as_bytes()).to_hex().to_string(),
            snapshot_asset_path: segment.asset_path.clone(),
            snapshot_text,
        };
        let link = SourceLink::note(
            owner_entry_id.clone(),
            note_id.clone(),
            anchor_id,
            source,
            format!("p.{}", segment.page_idx + 1),
        );

        let mut links = self.read_note_links(owner_entry_id, note_id)?;
        links.push(link.clone());
        atomic_write_json(
            self.layout().entry_note_links_file(owner_entry_id, note_id),
            &links,
        )?;
        Ok(link)
    }

    pub fn read_note_source_links(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
    ) -> Result<Vec<SourceLink>, WorkspaceError> {
        self.read_note(entry_id, note_id)?;
        self.read_note_links(entry_id, note_id)
    }

    pub fn replace_note_source_links(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
        links: &[SourceLink],
    ) -> Result<(), WorkspaceError> {
        self.read_note(entry_id, note_id)?;
        atomic_write_json(
            self.layout().entry_note_links_file(entry_id, note_id),
            &links.to_vec(),
        )
    }

    fn read_note_links(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
    ) -> Result<Vec<SourceLink>, WorkspaceError> {
        let path = self.layout().entry_note_links_file(entry_id, note_id);
        if !path.exists() {
            return Ok(Vec::new());
        }
        Ok(serde_json::from_slice(&fs::read(path)?)?)
    }

    fn enrich_note_source_link_assets(&self, links: &mut [SourceLink]) {
        let mut segments_by_entry: BTreeMap<EntryId, Vec<SourceSegment>> = BTreeMap::new();

        for link in links {
            for source in &mut link.sources {
                if source.snapshot_asset_path.is_some() && source.bbox.is_some() {
                    continue;
                }

                if !segments_by_entry.contains_key(&source.entry_id) {
                    let segments = self.read_segments(&source.entry_id).unwrap_or_default();
                    segments_by_entry.insert(source.entry_id.clone(), segments);
                }

                if let Some(segment) =
                    segments_by_entry
                        .get(&source.entry_id)
                        .and_then(|segments| {
                            segments
                                .iter()
                                .find(|segment| segment.uid == source.segment_uid)
                        })
                {
                    if source.snapshot_asset_path.is_none() {
                        source.snapshot_asset_path = segment.asset_path.clone();
                    }
                    if source.bbox.is_none() {
                        source.bbox = segment.bbox;
                    }
                }
            }
        }
    }
}

fn normalize_note_title(title: String) -> String {
    let title = title.trim();
    if title.is_empty() {
        "Untitled note".to_string()
    } else {
        title.to_string()
    }
}

fn strip_frontmatter(markdown: &str) -> &str {
    let Some(rest) = markdown.strip_prefix("---\n") else {
        return markdown;
    };
    let Some(end) = rest.find("\n---\n") else {
        return markdown;
    };
    &rest[end + "\n---\n".len()..]
}
