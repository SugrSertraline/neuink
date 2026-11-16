//! Structural contract for MinerU-shaped input through the public parser entry.
//! This checks hierarchy, caption binding, math and References roles only. It
//! makes no claim about retrieval quality or table content understanding.

use neuink_domain::{build_document_outline, CanonicalSectionRole, SegmentType};
use neuink_parser::normalizer::normalize_parser_response;
use serde_json::json;

#[test]
fn v1_content_list_yields_numbered_hierarchy_math_captions_and_references() {
    let value = json!({
        "content_list": [
            {"type": "title", "text": "1 Introduction", "text_level": 1, "page_idx": 0},
            {"type": "text", "text": "We study retrieval.", "page_idx": 0},
            {"type": "title", "text": "1.1 Background", "text_level": 2, "page_idx": 0},
            {"type": "text", "text": "Prior work is summarized here.", "page_idx": 0},
            {"type": "equation", "text": "E = mc^2", "page_idx": 0},
            {
                "type": "image",
                "img_path": "images/fig1.jpg",
                "image_caption": ["Figure 1: Architecture overview"],
                "page_idx": 1
            },
            {
                "type": "table",
                "table_body": "<table><tr><td>a</td></tr></table>",
                "table_caption": ["Table 1: Scores"],
                "page_idx": 1
            },
            {"type": "title", "text": "References", "text_level": 1, "page_idx": 2},
            {"type": "text", "text": "[1] Vaswani et al. Attention is all you need.", "page_idx": 2}
        ]
    });

    let document = normalize_parser_response(&value).expect("content_list parses");
    let segments = &document.segments;

    // Segment types survive the real mapping, in reading order.
    let types = segments.iter().map(|s| s.segment_type).collect::<Vec<_>>();
    assert_eq!(
        types,
        vec![
            SegmentType::Heading,
            SegmentType::Paragraph,
            SegmentType::Heading,
            SegmentType::Paragraph,
            SegmentType::Math,
            SegmentType::Figure,
            SegmentType::Table,
            SegmentType::Heading,
            SegmentType::Paragraph,
        ]
    );

    // Caption binding in v1: the caption text is the visual segment's text, and
    // the image path is kept as the asset.
    let figure = &segments[5];
    assert_eq!(figure.text, "Figure 1: Architecture overview");
    assert_eq!(figure.asset_path.as_deref(), Some("images/fig1.jpg"));
    let table = &segments[6];
    assert_eq!(table.text, "<table><tr><td>a</td></tr></table>");

    // Numbered headings nest by number; the child inherits its parent role.
    let outline = build_document_outline(segments);
    assert_eq!(
        outline.sections.len(),
        2,
        "1 Introduction and References are roots"
    );
    let introduction = &outline.sections[0];
    assert_eq!(introduction.level, 1);
    assert_eq!(
        introduction.section_role,
        CanonicalSectionRole::Introduction
    );
    assert_eq!(
        introduction.children.len(),
        1,
        "1.1 Background nests under 1"
    );
    let background = &introduction.children[0];
    assert_eq!(background.level, 2);
    assert_eq!(background.section_role, CanonicalSectionRole::Introduction);

    // The equation stays in the section that contains it, not in a new heading.
    let math_uid = &segments[4].uid;
    assert_eq!(
        outline.segment_sections.get(math_uid).map(String::as_str),
        Some(background.section_id.as_str())
    );

    // References is a canonical role and owns its entries.
    let references = &outline.sections[1];
    assert_eq!(references.section_role, CanonicalSectionRole::References);
    assert_eq!(
        outline
            .segment_sections
            .get(&segments[8].uid)
            .map(String::as_str),
        Some(references.section_id.as_str())
    );
}

#[test]
fn v2_image_caption_shares_visual_group_with_its_figure() {
    let value = json!({
        "content_list_v2": [[{
            "type": "image",
            "content": {
                "image_source": {"path": "images/figure.jpg"},
                "image_caption": [{
                    "type": "text",
                    "content": "Figure caption",
                    "bbox": [10, 405, 300, 430]
                }]
            },
            "bbox": [10, 20, 300, 400]
        }]]
    });

    let document = normalize_parser_response(&value).expect("content_list_v2 parses");
    let figure = document
        .segments
        .iter()
        .find(|s| s.segment_type == SegmentType::Figure)
        .expect("figure segment");
    let caption = document
        .segments
        .iter()
        .find(|s| s.block_role.as_deref() == Some("caption"))
        .expect("caption segment");

    assert_eq!(caption.text, "Figure caption");
    assert!(figure.visual_group_id.is_some());
    assert_eq!(figure.visual_group_id, caption.visual_group_id);
}
