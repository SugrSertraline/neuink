use neuink_domain::{NeuinkDocument, SegmentType, SourceSegment};
use serde_json::json;

use super::{enrich_document_with_middle, normalized_bbox};

#[test]
fn enriches_list_segments_with_item_regions() {
    let mut document = NeuinkDocument::new(vec![SourceSegment::new(
        SegmentType::List,
        0,
        Some([100.0, 100.0, 900.0, 500.0]),
        "1. First\n2. Second".to_string(),
    )]);
    let middle = json!({
        "pdf_info": [{
            "page_idx": 0,
            "para_blocks": [{
                "type": "list", "bbox": [100, 100, 900, 500],
                "blocks": [
                    {"bbox": [110, 110, 890, 250], "lines": [{"spans": [{"content": "First"}]}]},
                    {"bbox": [110, 270, 890, 480], "lines": [{"spans": [{"content": "Second"}]}]}
                ]
            }]
        }]
    });

    enrich_document_with_middle(&mut document, &middle);

    let regions = regions(&document, 0);
    assert_eq!(regions.len(), 2);
    assert_eq!(regions[1]["text"], "Second");
    assert_eq!(regions[0]["bbox"], json!([110.0, 110.0, 890.0, 250.0]));
}

#[test]
fn scales_page_unit_coordinates_once_for_the_whole_list_block() {
    let bbox = normalized_bbox([61.2, 79.2, 306.0, 158.4], Some([612.0, 792.0]), true);
    for (actual, expected) in bbox.into_iter().zip([100.0, 100.0, 500.0, 200.0]) {
        assert!((actual - expected).abs() < 0.01);
    }
}

#[test]
fn matches_page_units_using_the_middle_page_index() {
    let mut document = NeuinkDocument::new(vec![SourceSegment::new(
        SegmentType::List,
        0,
        Some([100.0, 100.0, 900.0, 500.0]),
        "1. First".to_string(),
    )]);
    let middle = json!({
        "pdf_info": [{
            "page_idx": 0, "page_size": [612, 792],
            "para_blocks": [{
                "type": "list", "bbox": [61.2, 79.2, 550.8, 396.0],
                "blocks": [{"bbox": [61.2, 79.2, 306.0, 158.4], "text": "First"}]
            }]
        }]
    });

    enrich_document_with_middle(&mut document, &middle);

    let result = regions(&document, 0);
    let actual = result[0]["bbox"].as_array().unwrap();
    for (value, expected) in actual.iter().zip([100.0, 100.0, 500.0, 200.0]) {
        assert!((value.as_f64().unwrap() as f32 - expected).abs() < 0.01);
    }
}

#[test]
fn keeps_list_candidates_on_their_declared_pages() {
    let mut document = NeuinkDocument::new(vec![
        SourceSegment::new(
            SegmentType::List,
            0,
            Some([100.0, 100.0, 900.0, 300.0]),
            "1. First page".to_string(),
        ),
        SourceSegment::new(
            SegmentType::List,
            1,
            Some([100.0, 500.0, 900.0, 800.0]),
            "1. Second page".to_string(),
        ),
    ]);
    let middle = json!({
        "pdf_info": [
            {"page_idx": 0, "preproc_blocks": [{"type": "list", "bbox": [100, 100, 900, 300], "blocks": [{"bbox": [100, 100, 900, 300], "text": "First page"}]}]},
            {"page_idx": 1, "preproc_blocks": [{"type": "list", "bbox": [100, 500, 900, 800], "blocks": [{"bbox": [100, 500, 900, 800], "text": "Second page"}]}]}
        ]
    });

    enrich_document_with_middle(&mut document, &middle);

    assert_eq!(regions(&document, 0).len(), 1);
    assert_eq!(regions(&document, 1).len(), 1);
}

#[test]
fn attaches_cross_page_reference_items_using_preproc_page_coordinates() {
    let mut document = NeuinkDocument::new(vec![SourceSegment::new(
        SegmentType::List,
        0,
        Some([100.0, 100.0, 900.0, 900.0]),
        "[1] First reference\n[2] Second reference".to_string(),
    )]);
    let middle = json!({
        "pdf_info": [
            {
                "page_idx": 0,
                "para_blocks": [{"type": "list", "sub_type": "ref_text", "bbox": [100, 100, 900, 900], "blocks": []}],
                "preproc_blocks": [{"type": "list", "sub_type": "ref_text", "bbox": [100, 100, 900, 900], "blocks": [{"bbox": [100, 100, 900, 300], "text": "First reference"}]}]
            },
            {
                "page_idx": 1,
                "para_blocks": [{"type": "list", "sub_type": "ref_text", "bbox": [100, 100, 900, 900], "blocks": []}],
                "preproc_blocks": [{"type": "list", "sub_type": "ref_text", "bbox": [100, 100, 900, 900], "blocks": [{"bbox": [100, 100, 900, 300], "text": "Second reference"}]}]
            }
        ]
    });

    enrich_document_with_middle(&mut document, &middle);

    let result = regions(&document, 0);
    assert_eq!(result[0]["page_idx"], 0);
    assert_eq!(result[1]["page_idx"], 1);
    assert_eq!(result[1]["text"], "Second reference");
}

fn regions(document: &NeuinkDocument, segment_index: usize) -> Vec<serde_json::Value> {
    serde_json::from_str(
        document.segments[segment_index]
            .mineru_metadata
            .get("list_item_regions")
            .unwrap(),
    )
    .unwrap()
}

#[test]
fn keeps_nested_reference_items_on_their_declared_pages() {
    let mut document = NeuinkDocument::new(vec![SourceSegment::new(
        SegmentType::List,
        0,
        Some([100.0, 100.0, 900.0, 900.0]),
        "[1] First reference\n[2] Second reference".to_string(),
    )]);
    let middle = json!({
        "pdf_info": [{
            "page_idx": 0,
            "preproc_blocks": [{
                "type": "list",
                "sub_type": "ref_text",
                "bbox": [100, 100, 900, 900],
                "blocks": [
                    {"bbox": [100, 100, 900, 300], "page_idx": 0, "text": "First reference"},
                    {"bbox": [100, 100, 900, 300], "page_idx": 1, "text": "Second reference"}
                ]
            }]
        }]
    });

    enrich_document_with_middle(&mut document, &middle);

    let regions: serde_json::Value = serde_json::from_str(
        document.segments[0]
            .mineru_metadata
            .get("list_item_regions")
            .unwrap(),
    )
    .unwrap();
    assert_eq!(regions.as_array().unwrap().len(), 2);
    assert_eq!(regions[0]["page_idx"], 0);
    assert_eq!(regions[1]["page_idx"], 1);
}

#[test]
fn deduplicates_reference_items_by_page_and_geometry() {
    let mut document = NeuinkDocument::new(vec![SourceSegment::new(
        SegmentType::List,
        0,
        Some([100.0, 100.0, 900.0, 900.0]),
        "[1] Complete reference".to_string(),
    )]);
    let middle = json!({
        "pdf_info": [{
            "page_idx": 0,
            "preproc_blocks": [{
                "type": "list",
                "sub_type": "ref_text",
                "bbox": [100, 100, 900, 900],
                "blocks": [{"bbox": [100, 100, 900, 300], "text": "Reference"}]
            }],
            "para_blocks": [{
                "type": "list",
                "sub_type": "ref_text",
                "bbox": [100, 100, 900, 900],
                "blocks": [{"bbox": [100, 100, 900, 300], "text": "Complete reference"}]
            }]
        }]
    });

    enrich_document_with_middle(&mut document, &middle);

    let regions: serde_json::Value = serde_json::from_str(
        document.segments[0]
            .mineru_metadata
            .get("list_item_regions")
            .unwrap(),
    )
    .unwrap();
    assert_eq!(regions.as_array().unwrap().len(), 1);
    assert_eq!(regions[0]["text"], "Complete reference");
}

#[test]
fn ignores_cross_page_items_from_semantic_reference_aggregates() {
    let mut document = NeuinkDocument::new(vec![SourceSegment::new(
        SegmentType::List,
        0,
        Some([100.0, 300.0, 500.0, 900.0]),
        "[1] First\n[2] Second\n[3] Third\n[4] Fourth".to_string(),
    )]);
    let middle = json!({
        "pdf_info": [
            {
                "page_idx": 0,
                "preproc_blocks": [{
                    "type": "list", "sub_type": "ref_text", "bbox": [100, 300, 500, 900],
                    "blocks": [
                        {"bbox": [100, 300, 500, 500], "text": "[1] First"},
                        {"bbox": [100, 500, 500, 900], "text": "[2] Second"}
                    ]
                }],
                "para_blocks": [{
                    "type": "list", "sub_type": "ref_text", "bbox": [100, 300, 500, 900],
                    "blocks": [
                        {"bbox": [100, 300, 500, 500], "text": "[1] First"},
                        {"bbox": [100, 500, 500, 900], "text": "[2] Second"},
                        {"bbox": [100, 100, 500, 300], "text": "[3] Third"},
                        {"bbox": [100, 300, 500, 600], "text": "[4] Fourth"}
                    ]
                }]
            },
            {
                "page_idx": 1,
                "preproc_blocks": [{
                    "type": "list", "sub_type": "ref_text", "bbox": [100, 100, 500, 600],
                    "blocks": [
                        {"bbox": [100, 100, 500, 300], "text": "[3] Third"},
                        {"bbox": [100, 300, 500, 600], "text": "[4] Fourth"}
                    ]
                }]
            }
        ]
    });

    enrich_document_with_middle(&mut document, &middle);

    let regions: Vec<serde_json::Value> = serde_json::from_str(
        document.segments[0]
            .mineru_metadata
            .get("list_item_regions")
            .unwrap(),
    )
    .unwrap();
    assert_eq!(regions.len(), 4);
    assert_eq!(
        regions.iter().filter(|item| item["page_idx"] == 0).count(),
        2
    );
    assert_eq!(
        regions.iter().filter(|item| item["page_idx"] == 1).count(),
        2
    );
}

#[test]
fn removes_stale_list_regions_before_rebuilding_from_middle() {
    let mut segment = SourceSegment::new(
        SegmentType::List,
        0,
        Some([100.0, 100.0, 900.0, 900.0]),
        "[1] Reference".to_string(),
    );
    segment.mineru_metadata.insert(
        "list_item_regions".to_string(),
        r#"[{"bbox":[100,100,900,300],"page_idx":0,"text":"stale"}]"#.to_string(),
    );
    let mut document = NeuinkDocument::new(vec![segment]);

    enrich_document_with_middle(&mut document, &json!({ "pdf_info": [] }));

    assert!(!document.segments[0]
        .mineru_metadata
        .contains_key("list_item_regions"));
}
