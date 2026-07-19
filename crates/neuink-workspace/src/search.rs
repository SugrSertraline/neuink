use std::collections::BTreeMap;

use neuink_domain::{
    AnnotationImportance, ContentItem, EntryId, NoteId, PdfParseStatus, SegmentType, SegmentUid,
    SourceSegment, TagId, TagMeta,
};

use crate::{Workspace, WorkspaceError};

#[derive(Clone, Debug)]
pub struct WorkspaceSearchOptions {
    pub include_entry_meta: bool,
    pub include_notes: bool,
    pub include_segments: bool,
}

impl Default for WorkspaceSearchOptions {
    fn default() -> Self {
        Self {
            include_entry_meta: true,
            include_notes: true,
            include_segments: true,
        }
    }
}

#[derive(Clone, Debug)]
pub struct WorkspaceSearchRecord {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub kind: WorkspaceSearchRecordKind,
    pub title: String,
    pub text: String,
    pub field_name: Option<String>,
    pub tag_id: Option<TagId>,
    pub tag_path: Option<String>,
    pub note_id: Option<NoteId>,
    pub segment_uid: Option<SegmentUid>,
    pub page_idx: Option<u32>,
    pub segment_type: Option<SegmentType>,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum WorkspaceSearchRecordKind {
    EntryTitle,
    EntryField,
    EntryTag,
    NoteTitle,
    NoteBody,
    SegmentNote,
    Annotation,
    PdfPage,
    Segment,
}

impl Workspace {
    pub fn collect_search_records(
        &self,
        options: WorkspaceSearchOptions,
    ) -> Result<Vec<WorkspaceSearchRecord>, WorkspaceError> {
        let entries = self.list_entries()?;
        let tags = self.list_tags()?;
        let tags_by_id = tags
            .into_iter()
            .map(|tag| (tag.id.clone(), tag))
            .collect::<BTreeMap<_, _>>();
        let mut records = Vec::new();

        for entry in entries {
            if options.include_entry_meta {
                records.push(WorkspaceSearchRecord {
                    entry_id: entry.id.clone(),
                    entry_title: entry.title.clone(),
                    kind: WorkspaceSearchRecordKind::EntryTitle,
                    title: entry.title.clone(),
                    text: entry.title.clone(),
                    field_name: None,
                    tag_id: None,
                    tag_path: None,
                    note_id: None,
                    segment_uid: None,
                    page_idx: None,
                    segment_type: None,
                });

                for (name, value) in &entry.fields {
                    if value.trim().is_empty() {
                        continue;
                    }
                    records.push(WorkspaceSearchRecord {
                        entry_id: entry.id.clone(),
                        entry_title: entry.title.clone(),
                        kind: WorkspaceSearchRecordKind::EntryField,
                        title: name.clone(),
                        text: format!("{name} {value}"),
                        field_name: Some(name.clone()),
                        tag_id: None,
                        tag_path: None,
                        note_id: None,
                        segment_uid: None,
                        page_idx: None,
                        segment_type: None,
                    });
                }

                for tag_id in &entry.tags {
                    let tag_path = tag_path(tag_id, &tags_by_id)
                        .unwrap_or_else(|| tag_id.as_str().to_string());
                    records.push(WorkspaceSearchRecord {
                        entry_id: entry.id.clone(),
                        entry_title: entry.title.clone(),
                        kind: WorkspaceSearchRecordKind::EntryTag,
                        title: tag_path.clone(),
                        text: tag_path.clone(),
                        field_name: None,
                        tag_id: Some(tag_id.clone()),
                        tag_path: Some(tag_path),
                        note_id: None,
                        segment_uid: None,
                        page_idx: None,
                        segment_type: None,
                    });
                }
            }

            if options.include_notes {
                for content in &entry.contents {
                    let ContentItem::Note { note_id, title } = content;
                    let note = self.read_note(&entry.id, note_id)?;
                    records.push(WorkspaceSearchRecord {
                        entry_id: entry.id.clone(),
                        entry_title: entry.title.clone(),
                        kind: WorkspaceSearchRecordKind::NoteTitle,
                        title: title.clone(),
                        text: title.clone(),
                        field_name: None,
                        tag_id: None,
                        tag_path: None,
                        note_id: Some(note_id.clone()),
                        segment_uid: None,
                        page_idx: None,
                        segment_type: None,
                    });
                    if !note.markdown.trim().is_empty() {
                        let text =
                            structured_markdown_note_text(&entry.title, title, &note.markdown);
                        records.push(WorkspaceSearchRecord {
                            entry_id: entry.id.clone(),
                            entry_title: entry.title.clone(),
                            kind: WorkspaceSearchRecordKind::NoteBody,
                            title: title.clone(),
                            text,
                            field_name: None,
                            tag_id: None,
                            tag_path: None,
                            note_id: Some(note_id.clone()),
                            segment_uid: None,
                            page_idx: None,
                            segment_type: None,
                        });
                    }
                }

                let segments = self.read_segments(&entry.id)?;
                let segments_by_uid = segments
                    .iter()
                    .map(|segment| (segment.uid.clone(), segment))
                    .collect::<BTreeMap<_, _>>();
                for note in self.read_segment_notes(&entry.id)? {
                    let note_text = html_to_plain_text(&note.text);
                    if note_text.trim().is_empty() {
                        continue;
                    }
                    let segment = segments_by_uid.get(&note.segment_uid).copied();
                    let page_idx = segment.map(|segment| segment.page_idx);
                    let title = page_idx
                        .map(|page_idx| format!("Segment Note · Page {}", page_idx + 1))
                        .unwrap_or_else(|| "Segment Note".to_string());
                    let text = structured_segment_note_text(&entry.title, segment, &note_text);
                    records.push(WorkspaceSearchRecord {
                        entry_id: entry.id.clone(),
                        entry_title: entry.title.clone(),
                        kind: WorkspaceSearchRecordKind::SegmentNote,
                        title,
                        text,
                        field_name: None,
                        tag_id: None,
                        tag_path: None,
                        note_id: None,
                        segment_uid: Some(note.segment_uid),
                        page_idx,
                        segment_type: segment.map(|segment| segment.segment_type),
                    });
                }

                for annotation in self.read_annotations(&entry.id)? {
                    if annotation.content.trim().is_empty() {
                        continue;
                    }
                    let segment = segments_by_uid.get(&annotation.segment_uid).copied();
                    let snapshot = annotation.segment_snapshot.as_ref();
                    let page_idx = segment
                        .map(|segment| segment.page_idx)
                        .or_else(|| snapshot.map(|segment| segment.page_idx));
                    let segment_type = segment
                        .map(|segment| segment.segment_type)
                        .or_else(|| snapshot.map(|segment| segment.segment_type));
                    let title = page_idx
                        .map(|page_idx| format!("Annotation · Page {}", page_idx + 1))
                        .unwrap_or_else(|| "Annotation".to_string());
                    let text = structured_annotation_text(
                        &entry.title,
                        &annotation.kind,
                        annotation.importance,
                        segment,
                        snapshot.map(|segment| {
                            (
                                segment.page_idx,
                                segment.segment_type,
                                segment.markdown.as_deref().unwrap_or(&segment.text),
                            )
                        }),
                        &annotation.content,
                    );
                    records.push(WorkspaceSearchRecord {
                        entry_id: entry.id.clone(),
                        entry_title: entry.title.clone(),
                        kind: WorkspaceSearchRecordKind::Annotation,
                        title,
                        text,
                        field_name: None,
                        tag_id: None,
                        tag_path: None,
                        note_id: None,
                        segment_uid: Some(annotation.segment_uid),
                        page_idx,
                        segment_type,
                    });
                }
            }

            let parse_status = entry.pdf.as_ref().map(|pdf| pdf.parse.status);
            if options.include_segments && parse_status == Some(PdfParseStatus::Succeeded) {
                let segments = self.read_segments(&entry.id)?;
                let mut page_parts = BTreeMap::<u32, Vec<String>>::new();
                let mut page_targets = BTreeMap::<u32, (SegmentUid, SegmentType)>::new();

                for segment in &segments {
                    if is_page_level_segment_type(segment.segment_type) {
                        let text = segment_text(segment);
                        if !text.trim().is_empty() {
                            page_parts
                                .entry(segment.page_idx)
                                .or_default()
                                .push(format!(
                                    "{}: {}",
                                    segment_type_label(segment.segment_type),
                                    compact_whitespace(&text)
                                ));
                            page_targets
                                .entry(segment.page_idx)
                                .or_insert_with(|| (segment.uid.clone(), segment.segment_type));
                        }
                    }
                }

                for (page_idx, parts) in page_parts {
                    let Some((segment_uid, segment_type)) = page_targets.get(&page_idx).cloned()
                    else {
                        continue;
                    };
                    let body = trim_chars(&parts.join("\n"), 8000);
                    if body.trim().is_empty() {
                        continue;
                    }
                    let title = format!("PDF Page {}", page_idx + 1);
                    let text = structured_pdf_page_text(&entry.title, page_idx, &body);
                    records.push(WorkspaceSearchRecord {
                        entry_id: entry.id.clone(),
                        entry_title: entry.title.clone(),
                        kind: WorkspaceSearchRecordKind::PdfPage,
                        title,
                        text,
                        field_name: None,
                        tag_id: None,
                        tag_path: None,
                        note_id: None,
                        segment_uid: Some(segment_uid),
                        page_idx: Some(page_idx),
                        segment_type: Some(segment_type),
                    });
                }

                for segment in segments {
                    let text = segment_text(&segment);
                    if text.trim().is_empty() {
                        continue;
                    }
                    let title = format!(
                        "PDF Segment · Page {} · {}",
                        segment.page_idx + 1,
                        segment_type_label(segment.segment_type)
                    );
                    let text = structured_pdf_segment_text(&entry.title, &segment, &text);
                    records.push(WorkspaceSearchRecord {
                        entry_id: entry.id.clone(),
                        entry_title: entry.title.clone(),
                        kind: WorkspaceSearchRecordKind::Segment,
                        title,
                        text,
                        field_name: None,
                        tag_id: None,
                        tag_path: None,
                        note_id: None,
                        segment_uid: Some(segment.uid),
                        page_idx: Some(segment.page_idx),
                        segment_type: Some(segment.segment_type),
                    });
                }
            }
        }

        Ok(records)
    }
}

fn structured_markdown_note_text(entry_title: &str, note_title: &str, markdown: &str) -> String {
    format!(
        "Entry: {entry_title}\nSource: Markdown note\nNote title: {note_title}\nContent:\n{}",
        markdown.trim()
    )
}

fn structured_segment_note_text(
    entry_title: &str,
    segment: Option<&SourceSegment>,
    note_text: &str,
) -> String {
    let mut lines = vec![
        format!("Entry: {entry_title}"),
        "Source: Segment note".to_string(),
    ];
    if let Some(segment) = segment {
        lines.push(format!("Page: {}", segment.page_idx + 1));
        lines.push(format!(
            "Segment type: {}",
            segment_type_label(segment.segment_type)
        ));
        let segment_text = segment_text(segment);
        if !segment_text.trim().is_empty() {
            lines.push("Segment:".to_string());
            lines.push(trim_chars(&compact_whitespace(&segment_text), 700));
        }
    }
    lines.push("Note:".to_string());
    lines.push(note_text.trim().to_string());
    lines.join("\n")
}

fn structured_annotation_text(
    entry_title: &str,
    kind: &str,
    importance: AnnotationImportance,
    segment: Option<&SourceSegment>,
    snapshot: Option<(u32, SegmentType, &str)>,
    annotation_text: &str,
) -> String {
    let mut lines = vec![
        format!("Entry: {entry_title}"),
        "Source: Annotation".to_string(),
        format!("Annotation type: {}", kind.trim()),
        format!("Importance: {}", annotation_importance_label(importance)),
    ];
    if let Some(segment) = segment {
        lines.push(format!("Page: {}", segment.page_idx + 1));
        lines.push(format!(
            "Segment type: {}",
            segment_type_label(segment.segment_type)
        ));
        let segment_text = segment_text(segment);
        if !segment_text.trim().is_empty() {
            lines.push("Segment:".to_string());
            lines.push(trim_chars(&compact_whitespace(&segment_text), 700));
        }
    } else if let Some((page_idx, segment_type, segment_text)) = snapshot {
        lines.push(format!("Page: {}", page_idx + 1));
        lines.push(format!(
            "Segment type: {}",
            segment_type_label(segment_type)
        ));
        if !segment_text.trim().is_empty() {
            lines.push("Segment snapshot:".to_string());
            lines.push(trim_chars(&compact_whitespace(segment_text), 700));
        }
    }
    lines.push("Annotation:".to_string());
    lines.push(annotation_text.trim().to_string());
    lines.join("\n")
}

fn structured_pdf_page_text(entry_title: &str, page_idx: u32, page_text: &str) -> String {
    format!(
        "Paper: {entry_title}\nSource: PDF page\nPage: {}\nContent:\n{}",
        page_idx + 1,
        page_text.trim()
    )
}

fn structured_pdf_segment_text(
    entry_title: &str,
    segment: &SourceSegment,
    segment_text: &str,
) -> String {
    format!(
        "Paper: {entry_title}\nSource: PDF segment\nPage: {}\nSegment type: {}\nContent:\n{}",
        segment.page_idx + 1,
        segment_type_label(segment.segment_type),
        segment_text.trim()
    )
}

fn segment_text(segment: &SourceSegment) -> String {
    segment
        .markdown
        .as_ref()
        .filter(|markdown| !markdown.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| segment.text.clone())
}

fn is_page_level_segment_type(segment_type: SegmentType) -> bool {
    matches!(
        segment_type,
        SegmentType::Paragraph
            | SegmentType::Heading
            | SegmentType::List
            | SegmentType::Code
            | SegmentType::AsideText
            | SegmentType::PageFootnote
    )
}

fn segment_type_label(segment_type: SegmentType) -> &'static str {
    match segment_type {
        SegmentType::Paragraph => "paragraph",
        SegmentType::Heading => "heading",
        SegmentType::Table => "table",
        SegmentType::Math => "math",
        SegmentType::Figure => "figure",
        SegmentType::Code => "code",
        SegmentType::List => "list",
        SegmentType::PageHeader => "page_header",
        SegmentType::PageFooter => "page_footer",
        SegmentType::PageNumber => "page_number",
        SegmentType::AsideText => "aside_text",
        SegmentType::PageFootnote => "page_footnote",
    }
}

fn annotation_importance_label(importance: AnnotationImportance) -> &'static str {
    match importance {
        AnnotationImportance::Core => "core",
        AnnotationImportance::Important => "important",
        AnnotationImportance::Normal => "normal",
    }
}

fn compact_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn trim_chars(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let trimmed = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{}...", trimmed.trim())
    } else {
        trimmed
    }
}

fn html_to_plain_text(value: &str) -> String {
    let mut text = String::with_capacity(value.len());
    let mut in_tag = false;

    for character in value.chars() {
        match character {
            '<' => {
                in_tag = true;
                text.push(' ');
            }
            '>' => {
                in_tag = false;
                text.push(' ');
            }
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }

    text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn tag_path(tag_id: &TagId, tags_by_id: &BTreeMap<TagId, TagMeta>) -> Option<String> {
    let mut names = Vec::new();
    let mut current = Some(tag_id.clone());
    let mut guard = 0;

    while let Some(id) = current {
        let tag = tags_by_id.get(&id)?;
        names.push(tag.name.clone());
        current = tag.parent_id.clone();
        guard += 1;
        if guard > tags_by_id.len() {
            return None;
        }
    }

    names.reverse();
    Some(names.join("/"))
}
