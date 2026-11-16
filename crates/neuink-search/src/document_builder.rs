use crate::{
    SearchDocument, SearchDocumentSource, SearchDocumentSourceKind, SearchTarget, SearchTextSection,
};
use neuink_domain::EntryId;

/// The IPC adapter and benchmark supply the same representation fields.
pub struct SearchDocumentInput {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub source: SearchDocumentSource,
    pub target: SearchTarget,
    pub title: String,
    pub body: String,
    pub caption: Option<String>,
    pub translation: Option<String>,
    pub boost: f32,
}

pub fn compose_search_document(input: SearchDocumentInput) -> SearchDocument {
    let title_boost = if input.source.kind == SearchDocumentSourceKind::Segment {
        0.25
    } else {
        2.4
    };
    let mut sections = vec![SearchTextSection::with_boost(
        "title",
        input.title.clone(),
        title_boost,
    )];
    if let Some(path) = input
        .source
        .section_path
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        sections.push(SearchTextSection::with_boost("section_path", path, 1.6));
    }
    if let Some(caption) = input.caption.filter(|s| !s.trim().is_empty()) {
        sections.push(SearchTextSection::with_boost("caption", caption, 1.8));
    }
    sections.push(SearchTextSection::body(input.body));
    if let Some(translation) = input.translation {
        sections.push(SearchTextSection::with_boost(
            "translation",
            translation,
            0.85,
        ));
    }
    SearchDocument {
        entry_id: input.entry_id,
        entry_title: input.entry_title,
        source: input.source,
        target: input.target,
        title: input.title,
        sections,
        boost: input.boost,
    }
}
