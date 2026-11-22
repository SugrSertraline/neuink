use crate::{
    SearchDocument, SearchDocumentSource, SearchDocumentSourceKind, SearchTarget, SearchTextSection,
};
use neuink_domain::{EntryId, SegmentType};

const HEADING_SEGMENT_BOOST_FACTOR: f32 = 0.35;

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
    let boost = if input.source.kind == SearchDocumentSourceKind::Segment
        && input.source.segment_type == Some(SegmentType::Heading)
    {
        input.boost * HEADING_SEGMENT_BOOST_FACTOR
    } else {
        input.boost
    };
    SearchDocument {
        entry_id: input.entry_id,
        entry_title: input.entry_title,
        source: input.source,
        target: input.target,
        title: input.title,
        sections,
        boost,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use neuink_domain::SegmentUid;

    fn sample(segment_type: SegmentType) -> SearchDocument {
        compose_search_document(SearchDocumentInput {
            entry_id: EntryId::from_string("e1"),
            entry_title: "Paper".into(),
            source: SearchDocumentSource {
                kind: SearchDocumentSourceKind::Segment,
                segment_type: Some(segment_type),
                section_path: Some("Experiments".into()),
                ..SearchDocumentSource::default()
            },
            target: SearchTarget::Segment {
                entry_id: EntryId::from_string("e1"),
                segment_uid: SegmentUid::from_string("s1"),
                page_idx: 0,
            },
            title: "Paper".into(),
            body: "Experiments".into(),
            caption: None,
            translation: None,
            boost: 1.0,
        })
    }

    #[test]
    fn standalone_heading_segments_receive_reduced_boost() {
        let heading = sample(SegmentType::Heading);
        let paragraph = sample(SegmentType::Paragraph);
        assert!((heading.boost - 0.35).abs() < 1e-6);
        assert!((paragraph.boost - 1.0).abs() < 1e-6);
    }
}
