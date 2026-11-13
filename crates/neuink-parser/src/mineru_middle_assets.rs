//! Recover only the historical empty-filename placeholder from matching geometry.
//! Ambiguous, absent, or unsafe candidates leave the original reference untouched.
use super::{bbox_from_value, find_key, normalized_bbox, page_size};
use neuink_domain::{NeuinkDocument, SegmentType};
use serde_json::Value;
use std::collections::BTreeSet;

pub(super) fn repair_directory_placeholders(document: &mut NeuinkDocument, middle: &Value) {
    let Some(pages) = find_key(middle, "pdf_info").and_then(Value::as_array) else {
        return;
    };
    for segment in &mut document.segments {
        if segment.asset_path.as_deref() != Some("images/") {
            continue;
        }
        let kind = match segment.segment_type {
            SegmentType::Figure => "image",
            SegmentType::Table => "table",
            _ => continue,
        };
        let Some(bbox) = segment.bbox else {
            continue;
        };
        let mut matches = BTreeSet::new();
        for (index, page) in pages.iter().enumerate() {
            if page
                .get("page_idx")
                .and_then(Value::as_u64)
                .unwrap_or(index as u64)
                != u64::from(segment.page_idx)
            {
                continue;
            }
            for key in ["preproc_blocks", "para_blocks"] {
                if let Some(blocks) = page.get(key).and_then(Value::as_array) {
                    collect(blocks, kind, bbox, page_size(page), &mut matches);
                }
            }
        }
        if matches.len() != 1 {
            continue;
        }
        let path = matches.into_iter().next().unwrap();
        // Only the parser-generated bare placeholder is rewritten. User prose,
        // captions and Markdown remain intact, and the segment identifier stays stable.
        if segment.text == "images/" {
            segment.text = path.clone();
        }
        if segment.markdown.as_deref() == Some("images/") {
            segment.markdown = Some(path.clone());
        }
        segment.asset_path = Some(path);
    }
}

fn collect(
    blocks: &[Value],
    kind: &str,
    target: [f32; 4],
    size: Option<[f32; 2]>,
    matches: &mut BTreeSet<String>,
) {
    for block in blocks {
        if block.get("type").and_then(Value::as_str) == Some(kind) {
            if let Some(raw) = bbox_from_value(block.get("bbox")) {
                let same = |bbox: [f32; 4]| {
                    bbox.iter()
                        .zip(target)
                        .all(|(a, b)| a.is_finite() && b.is_finite() && (a - b).abs() <= 2.0)
                };
                if same(raw) || (size.is_some() && same(normalized_bbox(raw, size, true))) {
                    image_paths(block, matches);
                }
            }
        }
        if let Some(children) = block.get("blocks").and_then(Value::as_array) {
            collect(children, kind, target, size, matches);
        }
    }
}

fn image_paths(value: &Value, paths: &mut BTreeSet<String>) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if key == "image_path" || key == "img_path" {
                    if let Some(path) = value.as_str().filter(|p| !p.is_empty()) {
                        let path = path.strip_prefix("images/").unwrap_or(path);
                        // Old middle files use a single image filename, not a host path.
                        if path
                            .chars()
                            .any(|c| c.is_control() || "/\\:<>\"|?*".contains(c))
                            || path.ends_with(['.', ' '])
                        {
                            continue;
                        }
                        let extension = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
                        if matches!(
                            extension.as_str(),
                            "png"
                                | "jpg"
                                | "jpeg"
                                | "webp"
                                | "gif"
                                | "bmp"
                                | "tif"
                                | "tiff"
                                | "avif"
                                | "svg"
                        ) {
                            paths.insert(format!("images/{path}"));
                        }
                    }
                } else if value.is_object() || value.is_array() {
                    image_paths(value, paths);
                }
            }
        }
        Value::Array(values) => {
            for value in values {
                image_paths(value, paths);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use neuink_domain::SourceSegment;
    use serde_json::json;
    #[test]
    fn repairs_only_unique_same_page_same_region_and_preserves_identity() {
        let mut segment = SourceSegment::new(
            SegmentType::Table,
            13,
            Some([100., 200., 400., 600.]),
            "images/".into(),
        );
        segment.asset_path = Some("images/".into());
        let id = segment.uid.clone();
        let block =
            json!({"type":"table","bbox":[50,100,200,300],"blocks":[{"image_path":"table.jpg"}]});
        let middle = json!({"pdf_info":[{"page_idx":13,"page_size":[500,500],"preproc_blocks":[block.clone()],"para_blocks":[block.clone()]}]});
        let mut document = NeuinkDocument::new(vec![segment.clone()]);
        repair_directory_placeholders(&mut document, &middle);
        assert_eq!(
            document.segments[0].asset_path.as_deref(),
            Some("images/table.jpg")
        );
        assert_eq!(document.segments[0].uid, id);
        assert_eq!(document.segments[0].text, "images/table.jpg");
        for alternate in [
            json!({"image_path":"other.jpg"}),
            json!({"image_path":"../outside.jpg"}),
        ] {
            let mut ambiguous = middle.clone();
            if alternate["image_path"] == "other.jpg" {
                ambiguous["pdf_info"][0]["preproc_blocks"][0]["blocks"]
                    .as_array_mut()
                    .unwrap()
                    .push(alternate);
            } else {
                ambiguous["pdf_info"][0]["preproc_blocks"][0]["blocks"] = json!([alternate]);
                ambiguous["pdf_info"][0]["para_blocks"] = json!([]);
            }
            let mut document = NeuinkDocument::new(vec![segment.clone()]);
            repair_directory_placeholders(&mut document, &ambiguous);
            assert_eq!(document.segments[0].asset_path.as_deref(), Some("images/"));
        }
        let mut other_page = segment.clone();
        other_page.page_idx = 12;
        let mut document = NeuinkDocument::new(vec![other_page]);
        repair_directory_placeholders(&mut document, &middle);
        assert_eq!(document.segments[0].asset_path.as_deref(), Some("images/"));
    }
}
