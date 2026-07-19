use std::collections::BTreeMap;

use neuink_domain::{NeuinkDocument, SegmentType};
use serde::Serialize;
use serde_json::Value;

const LIST_ITEM_REGIONS_KEY: &str = "list_item_regions";

#[derive(Serialize)]
struct ListItemRegion {
    bbox: [f32; 4],
    page_idx: u32,
    text: String,
}

struct ListRegionCandidate {
    bbox: [f32; 4],
    items: Vec<ListItemRegion>,
    authoritative_items: bool,
    page_idx: u32,
    page_size: Option<[f32; 2]>,
    sub_type: Option<String>,
}

pub fn enrich_document_with_middle(document: &mut NeuinkDocument, middle: &Value) {
    let candidates = list_region_candidates(middle);
    let mut used = vec![false; candidates.len()];
    for segment in document
        .segments
        .iter_mut()
        .filter(|segment| segment.segment_type == SegmentType::List)
    {
        segment.mineru_metadata.remove(LIST_ITEM_REGIONS_KEY);
    }

    for segment in document
        .segments
        .iter_mut()
        .filter(|segment| segment.segment_type == SegmentType::List)
    {
        let Some(segment_bbox) = segment.bbox else {
            continue;
        };
        let best = candidates
            .iter()
            .enumerate()
            .filter(|(index, candidate)| {
                !used[*index]
                    && !is_reference_candidate(candidate)
                    && candidate.page_idx == segment.page_idx
            })
            .min_by(|(_, left), (_, right)| {
                candidate_fit(segment_bbox, left)
                    .0
                    .total_cmp(&candidate_fit(segment_bbox, right).0)
            });
        let Some((index, candidate)) = best else {
            continue;
        };
        let (distance, scale_page_units) = candidate_fit(segment_bbox, candidate);
        if candidate.items.is_empty() || distance > 900.0 {
            continue;
        }
        let items = normalized_item_regions(candidate, scale_page_units);
        if let Ok(encoded) = serde_json::to_string(&items) {
            segment
                .mineru_metadata
                .insert(LIST_ITEM_REGIONS_KEY.to_string(), encoded);
            used[index] = true;
        }
    }

    enrich_reference_list_segments(document, &candidates);
}

fn list_region_candidates(middle: &Value) -> Vec<ListRegionCandidate> {
    let Some(pages) = find_key(middle, "pdf_info").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for (fallback_page_idx, page) in pages.iter().enumerate() {
        let page_idx = page
            .get("page_idx")
            .and_then(Value::as_u64)
            .unwrap_or(fallback_page_idx as u64) as u32;
        let page_size = page_size(page);
        // `preproc_blocks` owns page-local geometry. `para_blocks` may aggregate
        // a cross-page reference list onto its first page, so it only improves
        // matching items and semantic fields when geometry already exists.
        if let Some(blocks) = page.get("preproc_blocks").and_then(Value::as_array) {
            collect_list_blocks(blocks, page_idx, page_size, true, &mut result);
        }
        if let Some(blocks) = page.get("para_blocks").and_then(Value::as_array) {
            collect_list_blocks(blocks, page_idx, page_size, false, &mut result);
        }
    }
    merge_matching_list_candidates(result)
}

fn collect_list_blocks(
    blocks: &[Value],
    page_idx: u32,
    page_size: Option<[f32; 2]>,
    authoritative_items: bool,
    result: &mut Vec<ListRegionCandidate>,
) {
    for block in blocks {
        if block.get("type").and_then(Value::as_str) == Some("list") {
            if let Some(candidate) = list_candidate(block, page_idx, page_size, authoritative_items)
            {
                result.push(candidate);
            }
            continue;
        }
        if let Some(children) = block.get("blocks").and_then(Value::as_array) {
            collect_list_blocks(children, page_idx, page_size, authoritative_items, result);
        }
    }
}

fn list_candidate(
    block: &Value,
    page_idx: u32,
    page_size: Option<[f32; 2]>,
    authoritative_items: bool,
) -> Option<ListRegionCandidate> {
    let candidate_page_idx = direct_page_idx(block).unwrap_or(page_idx);
    let raw_bbox = bbox_from_value(block.get("bbox"))?;
    let items = block
        .get("blocks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let text = block_text(item)?;
            let bbox = bbox_from_value(item.get("bbox")).or_else(|| nested_bbox(item))?;
            Some(ListItemRegion {
                bbox,
                page_idx: nested_page_idx(item).unwrap_or(candidate_page_idx),
                text,
            })
        })
        .collect();
    Some(ListRegionCandidate {
        bbox: raw_bbox,
        items,
        authoritative_items,
        page_idx: candidate_page_idx,
        page_size,
        sub_type: block
            .get("sub_type")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    })
}

fn merge_matching_list_candidates(
    candidates: Vec<ListRegionCandidate>,
) -> Vec<ListRegionCandidate> {
    let mut merged = Vec::<ListRegionCandidate>::new();

    for candidate in candidates {
        let matching = merged.iter_mut().find(|existing| {
            existing.page_idx == candidate.page_idx
                && list_candidate_bbox_distance(existing, &candidate) <= 80.0
        });
        let Some(existing) = matching else {
            merged.push(candidate);
            continue;
        };

        if existing.page_size.is_none() {
            existing.page_size = candidate.page_size;
        }
        if existing.sub_type.is_none() {
            existing.sub_type = candidate.sub_type;
        }
        for item in candidate.items {
            merge_list_item(&mut existing.items, item, candidate.authoritative_items);
        }
    }

    merged
}

fn list_candidate_bbox_distance(left: &ListRegionCandidate, right: &ListRegionCandidate) -> f32 {
    let raw_distance = bbox_distance(left.bbox, right.bbox);
    let Some(page_size) = left.page_size.or(right.page_size) else {
        return raw_distance;
    };
    raw_distance.min(bbox_distance(
        normalized_bbox(left.bbox, Some(page_size), true),
        normalized_bbox(right.bbox, Some(page_size), true),
    ))
}

fn same_list_item_position(left: &ListItemRegion, right: &ListItemRegion) -> bool {
    left.page_idx == right.page_idx && bbox_distance(left.bbox, right.bbox) <= 4.0
}

fn merge_list_item(items: &mut Vec<ListItemRegion>, candidate: ListItemRegion, allow_insert: bool) {
    let Some(existing) = items
        .iter_mut()
        .find(|item| same_list_item_position(item, &candidate))
    else {
        if allow_insert {
            items.push(candidate);
        }
        return;
    };

    if candidate.text.chars().count() > existing.text.chars().count() {
        existing.text = candidate.text;
    }
}

fn direct_page_idx(value: &Value) -> Option<u32> {
    value
        .get("page_idx")
        .and_then(Value::as_u64)
        .and_then(|page_idx| u32::try_from(page_idx).ok())
}

fn nested_page_idx(value: &Value) -> Option<u32> {
    direct_page_idx(value).or_else(|| {
        ["blocks", "lines", "spans"]
            .iter()
            .filter_map(|key| value.get(*key).and_then(Value::as_array))
            .flatten()
            .find_map(nested_page_idx)
    })
}

fn block_text(value: &Value) -> Option<String> {
    let mut parts = Vec::new();
    collect_text(value, &mut parts);
    let text = parts
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (!text.is_empty()).then_some(text)
}

fn collect_text(value: &Value, parts: &mut Vec<String>) {
    if let Some(text) = value.get("content").and_then(Value::as_str) {
        parts.push(text.to_string());
        return;
    }
    if let Some(text) = value.get("text").and_then(Value::as_str) {
        parts.push(text.to_string());
        return;
    }
    for key in ["blocks", "lines", "spans"] {
        if let Some(items) = value.get(key).and_then(Value::as_array) {
            for item in items {
                collect_text(item, parts);
            }
        }
    }
}

fn nested_bbox(value: &Value) -> Option<[f32; 4]> {
    ["lines", "spans"]
        .iter()
        .filter_map(|key| value.get(*key).and_then(Value::as_array))
        .flatten()
        .filter_map(|item| bbox_from_value(item.get("bbox")))
        .reduce(union_bbox)
}

fn bbox_from_value(value: Option<&Value>) -> Option<[f32; 4]> {
    let values = value?.as_array()?;
    if values.len() != 4 {
        return None;
    }
    let mut bbox = [0.0; 4];
    for (index, value) in values.iter().enumerate() {
        bbox[index] = value.as_f64()? as f32;
    }
    Some(bbox)
}

fn normalized_bbox(
    mut bbox: [f32; 4],
    page_size: Option<[f32; 2]>,
    scale_page_units: bool,
) -> [f32; 4] {
    if scale_page_units {
        if let Some([width, height]) = page_size {
            bbox = [
                bbox[0] / width * 1000.0,
                bbox[1] / height * 1000.0,
                bbox[2] / width * 1000.0,
                bbox[3] / height * 1000.0,
            ];
        }
    }
    bbox.map(|value| value.clamp(0.0, 1000.0))
}

fn candidate_fit(segment_bbox: [f32; 4], candidate: &ListRegionCandidate) -> (f32, bool) {
    let normalized_distance = bbox_distance(segment_bbox, candidate.bbox);
    let Some(page_size) = candidate.page_size else {
        return (normalized_distance, false);
    };
    let page_units_distance = bbox_distance(
        segment_bbox,
        normalized_bbox(candidate.bbox, Some(page_size), true),
    );
    if page_units_distance < normalized_distance {
        (page_units_distance, true)
    } else {
        (normalized_distance, false)
    }
}

fn is_reference_candidate(candidate: &ListRegionCandidate) -> bool {
    candidate.sub_type.as_deref() == Some("ref_text")
}

fn normalized_item_regions(
    candidate: &ListRegionCandidate,
    scale_page_units: bool,
) -> Vec<ListItemRegion> {
    candidate
        .items
        .iter()
        .map(|item| ListItemRegion {
            bbox: normalized_bbox(item.bbox, candidate.page_size, scale_page_units),
            page_idx: item.page_idx,
            text: item.text.clone(),
        })
        .collect()
}

fn enrich_reference_list_segments(
    document: &mut NeuinkDocument,
    candidates: &[ListRegionCandidate],
) {
    let mut items_by_segment = BTreeMap::<usize, Vec<ListItemRegion>>::new();

    for candidate in candidates
        .iter()
        .filter(|candidate| is_reference_candidate(candidate))
    {
        if candidate.items.is_empty() {
            continue;
        }
        let Some((segment_index, _segment)) = document
            .segments
            .iter()
            .enumerate()
            .filter(|(_, segment)| {
                segment.segment_type == SegmentType::List && segment.page_idx <= candidate.page_idx
            })
            .max_by_key(|(_, segment)| segment.page_idx)
        else {
            continue;
        };

        let scale_page_units = candidate_uses_page_units(candidate);
        let segment_items = items_by_segment.entry(segment_index).or_default();
        for item in normalized_item_regions(candidate, scale_page_units) {
            merge_list_item(segment_items, item, true);
        }
    }

    for (segment_index, mut items) in items_by_segment {
        items.sort_by(|left, right| {
            left.page_idx
                .cmp(&right.page_idx)
                .then_with(|| left.bbox[1].total_cmp(&right.bbox[1]))
                .then_with(|| left.bbox[0].total_cmp(&right.bbox[0]))
        });
        if let Ok(encoded) = serde_json::to_string(&items) {
            document.segments[segment_index]
                .mineru_metadata
                .insert(LIST_ITEM_REGIONS_KEY.to_string(), encoded);
        }
    }
}

fn candidate_uses_page_units(candidate: &ListRegionCandidate) -> bool {
    candidate.page_size.is_some_and(|[width, height]| {
        width > 0.0
            && height > 0.0
            && candidate.bbox[2] <= width * 1.05
            && candidate.bbox[3] <= height * 1.05
    })
}

fn page_size(page: &Value) -> Option<[f32; 2]> {
    let values = page.get("page_size")?.as_array()?;
    Some([
        values.first()?.as_f64()? as f32,
        values.get(1)?.as_f64()? as f32,
    ])
}

fn find_key<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(map) => map
            .get(key)
            .or_else(|| map.values().find_map(|value| find_key(value, key))),
        Value::Array(items) => items.iter().find_map(|value| find_key(value, key)),
        _ => None,
    }
}

fn bbox_distance(left: [f32; 4], right: [f32; 4]) -> f32 {
    left.iter()
        .zip(right.iter())
        .map(|(left, right)| (left - right).abs())
        .sum()
}

fn union_bbox(left: [f32; 4], right: [f32; 4]) -> [f32; 4] {
    [
        left[0].min(right[0]),
        left[1].min(right[1]),
        left[2].max(right[2]),
        left[3].max(right[3]),
    ]
}

#[cfg(test)]
#[path = "mineru_middle_regression_tests.rs"]
mod regression_tests;
