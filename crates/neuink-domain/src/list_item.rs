use crate::{SegmentType, SegmentUid, SourceSegment};
use serde::Deserialize;

#[derive(Deserialize)]
struct ListItemRegion {
    bbox: [f32; 4],
    page_idx: Option<u32>,
    text: String,
}

pub fn list_item_address(uid: &str) -> Option<(&str, usize)> {
    let (parent, index) = uid.rsplit_once(":list-item:")?;
    let parsed = index.parse::<usize>().ok()?;
    (parsed.to_string() == index).then_some((parent, parsed))
}

/// Virtual identities leave the original parse and existing whole-list references intact.
pub fn list_item_segments(segment: &SourceSegment) -> Vec<SourceSegment> {
    if segment.segment_type != SegmentType::List
        || list_item_address(segment.uid.as_str()).is_some()
    {
        return Vec::new();
    }
    let regions: Vec<ListItemRegion> = segment
        .mineru_metadata
        .get("list_item_regions")
        .and_then(|raw| serde_json::from_str::<Vec<serde_json::Value>>(raw).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|value| {
            !value
                .get("page_idx")
                .is_some_and(serde_json::Value::is_null)
        })
        .filter_map(|value| serde_json::from_value::<ListItemRegion>(value).ok())
        .filter(|item| item.bbox.iter().all(|value| value.is_finite()))
        .collect();
    let items: Vec<(String, Option<[f32; 4]>, u32)> = if regions.is_empty() {
        list_item_texts(segment.markdown.as_deref().unwrap_or(&segment.text))
            .into_iter()
            .map(|text| (text, None, segment.page_idx))
            .collect()
    } else {
        regions
            .into_iter()
            .map(|item| {
                (
                    item.text,
                    Some(item.bbox),
                    item.page_idx.unwrap_or(segment.page_idx),
                )
            })
            .collect()
    };
    items
        .into_iter()
        .enumerate()
        .map(|(index, (text, bbox, page_idx))| {
            let mut item = segment.clone();
            item.uid = SegmentUid::from_string(format!("{}:list-item:{}", segment.uid, index));
            item.continuation_group_id = None;
            item.visual_group_id = None;
            item.markdown = Some(text.clone());
            item.text = text;
            item.bbox = bbox;
            item.page_idx = page_idx;
            item.mineru_metadata
                .insert("list_parent_uid".into(), segment.uid.to_string());
            item.mineru_metadata
                .insert("list_item_index".into(), index.to_string());
            let region = bbox.map(
                |bbox| serde_json::json!({ "bbox": bbox, "page_idx": page_idx, "text": item.text }),
            );
            item.mineru_metadata.insert(
                "list_item_regions".into(),
                serde_json::Value::Array(region.into_iter().collect()).to_string(),
            );
            item
        })
        .collect()
}

pub fn find_source_segment(segments: &[SourceSegment], uid: &SegmentUid) -> Option<SourceSegment> {
    if let Some(segment) = segments.iter().find(|segment| {
        segment.uid == *uid || segment.continuation_group_id.as_deref() == Some(uid.as_str())
    }) {
        return Some(segment.clone());
    }
    let (parent_uid, index) = list_item_address(uid.as_str())?;
    let parent = segments
        .iter()
        .find(|segment| segment.uid.as_str() == parent_uid)?;
    list_item_segments(parent).into_iter().nth(index)
}

fn marker(line: &str) -> Option<(usize, &str)> {
    let trimmed = line.trim_start();
    let indent = line.len() - trimmed.len();
    let marker_end = trimmed.find(char::is_whitespace)?;
    let prefix = &trimmed[..marker_end];
    let ordered = prefix
        .strip_suffix('.')
        .or_else(|| prefix.strip_suffix(')'))
        .is_some_and(|number| !number.is_empty() && number.bytes().all(|c| c.is_ascii_digit()));
    (matches!(prefix, "-" | "*" | "+") || ordered)
        .then_some((indent, trimmed[marker_end..].trim_start()))
}

// Keep in sync with shared/lib/listItemSegments.ts; nested lists belong to their outer item.
fn list_item_texts(text: &str) -> Vec<String> {
    let lines: Vec<&str> = text.trim().lines().collect();
    let Some(indent) = lines
        .iter()
        .filter_map(|line| marker(line).map(|(indent, _)| indent))
        .min()
    else {
        return lines
            .iter()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect();
    };
    let mut items: Vec<String> = Vec::new();
    for line in lines {
        if let Some((_, content)) = marker(line).filter(|(level, _)| *level == indent) {
            items.push(content.to_owned());
        } else if let Some(item) = items.last_mut() {
            item.push('\n');
            item.push_str(line);
        }
    }
    items
        .into_iter()
        .map(|item| item.trim().to_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn list_item_identity_preserves_cross_page_geometry_and_parent() {
        let mut list = SourceSegment::new(SegmentType::List, 0, None, "Parent".into());
        list.continuation_group_id = Some("whole-list".into());
        list.mineru_metadata.insert(
            "list_item_regions".into(),
            serde_json::json!([
                { "bbox": [100, 200, 400, 300], "text": "First" },
                { "bbox": [100, 100, 400, 250], "page_idx": 1, "text": "Second" }
            ])
            .to_string(),
        );
        let items = list_item_segments(&list);
        assert_eq!(items.len(), 2);
        assert_eq!(items[1].text, "Second");
        assert_eq!(items[1].page_idx, 1);
        assert_eq!(items[1].bbox, Some([100., 100., 400., 250.]));
        assert_eq!(items[1].continuation_group_id, None);
        assert_eq!(
            find_source_segment(&[list.clone()], &items[1].uid),
            Some(items[1].clone())
        );
        assert_eq!(
            find_source_segment(&[list.clone()], &list.uid),
            Some(list.clone())
        );
        assert!(list_item_segments(&items[1]).is_empty());
        assert!(find_source_segment(
            &[list.clone()],
            &SegmentUid::from_string(format!("{}:list-item:99", list.uid))
        )
        .is_none());
    }
    #[test]
    fn list_item_texts_keep_wrapped_and_nested_content() {
        assert_eq!(
            list_item_texts("- First\n  wrapped line\n  - Nested\n- Second\n\n  continued"),
            ["First\n  wrapped line\n  - Nested", "Second\n\n  continued"]
        );
        assert_eq!(list_item_texts("1. Alpha\n2. Beta"), ["Alpha", "Beta"]);
        assert_eq!(
            list_item_texts("[1] Alpha\n[2] Beta"),
            ["[1] Alpha", "[2] Beta"]
        );
        assert!(list_item_address("list:list-item:01").is_none());
    }
}
