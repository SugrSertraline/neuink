use std::collections::{BTreeMap, HashMap};

use neuink_domain::{NeuinkDocument, SegmentType, SegmentUid, SourceSegment};
use serde_json::Value;
use sha1::{Digest, Sha1};

use crate::{mineru_middle::enrich_document_with_middle, ParserError};

pub fn normalize_parser_response(value: &Value) -> Result<NeuinkDocument, ParserError> {
    let mut document = if let Some(document) = normalize_neuink_document(value) {
        document
    } else if let Some(content_list_v2) = find_key(value, "content_list_v2") {
        normalize_content_list_v2(content_list_v2)?
    } else if let Some(content_list) = find_key(value, "content_list") {
        normalize_content_list(content_list)?
    } else if let Some(content_list) = find_embedded_json_key(value, "content_list") {
        normalize_content_list(&content_list)?
    } else if value.is_array() {
        if looks_like_content_list_v2(value) {
            normalize_content_list_v2(value)?
        } else {
            normalize_content_list(value)?
        }
    } else {
        return Err(ParserError::MissingContentList);
    };

    if let Some(middle) = find_key(value, "middle_json") {
        enrich_document_with_middle(&mut document, middle);
    }
    assign_stable_segment_uids(&mut document.segments);
    Ok(document)
}

fn assign_stable_segment_uids(segments: &mut [SourceSegment]) {
    let mut occurrences = HashMap::<String, usize>::new();
    for segment in segments {
        let mut hasher = Sha1::new();
        hasher.update(format!(
            "{:?}\0{}\0",
            segment.segment_type, segment.page_idx
        ));
        if let Some(bbox) = segment.bbox {
            for value in bbox {
                hasher.update(value.to_bits().to_le_bytes());
            }
        }
        hasher.update(b"\0");
        hasher.update(segment.text.as_bytes());
        hasher.update(b"\0");
        hasher.update(segment.block_role.as_deref().unwrap_or_default().as_bytes());
        let fingerprint = format!("{:x}", hasher.finalize());
        let occurrence = occurrences.entry(fingerprint.clone()).or_default();
        segment.uid =
            SegmentUid::from_string(format!("seg-{}-{}", &fingerprint[..20], *occurrence));
        *occurrence += 1;
    }
}

fn normalize_neuink_document(value: &Value) -> Option<NeuinkDocument> {
    serde_json::from_value::<NeuinkDocument>(value.clone()).ok()
}

fn normalize_content_list_v2(value: &Value) -> Result<NeuinkDocument, ParserError> {
    let pages = value.as_array().ok_or_else(|| {
        ParserError::InvalidResponse("content_list_v2 must be an array".to_string())
    })?;
    let mut segments = Vec::new();
    let mut continuation_state = V2ContinuationState::default();

    for (page_idx, page) in pages.iter().enumerate() {
        let blocks = page.as_array().ok_or_else(|| {
            ParserError::InvalidResponse("content_list_v2 page must be an array".to_string())
        })?;
        continuation_state.start_page();
        for block in blocks {
            let block_segments = segments_from_v2_block(block, page_idx as u32);
            append_v2_segments_with_continuations(
                &mut segments,
                block_segments,
                &mut continuation_state,
            );
        }
        continuation_state.finish_page();
    }

    document_from_segments(segments)
}

fn normalize_content_list(value: &Value) -> Result<NeuinkDocument, ParserError> {
    let blocks = value
        .as_array()
        .ok_or_else(|| ParserError::InvalidResponse("content_list must be an array".to_string()))?;
    let segments = blocks
        .iter()
        .filter_map(segment_from_content_list_block)
        .collect();
    document_from_segments(segments)
}

fn segments_from_v2_block(block: &Value, page_idx: u32) -> Vec<SourceSegment> {
    visual_segments_from_v2_block(block, page_idx)
        .filter(|segments| !segments.is_empty())
        .unwrap_or_else(|| segment_from_v2_block(block, page_idx).into_iter().collect())
}

fn segment_from_v2_block(block: &Value, page_idx: u32) -> Option<SourceSegment> {
    let block_type = block.get("type")?.as_str()?;
    let segment_type = segment_type_from_v2(block_type)?;
    let content = block.get("content").unwrap_or(&Value::Null);
    let bbox = bbox_from_value(block.get("bbox"));
    let sub_type = block.get("sub_type").and_then(Value::as_str);
    let text = text_from_v2_content(block_type, content)
        .or_else(|| fallback_visual_text(block_type, bbox.as_ref()))
        .or_else(|| empty_text_region(block_type, bbox.as_ref()))?;
    Some(
        SourceSegment::new(segment_type, page_idx, bbox, text)
            .with_asset_path(asset_path_from_v2_content(block_type, content))
            .with_mineru_metadata(
                Some(block_type.to_string()),
                sub_type.map(ToString::to_string),
                None,
            )
            .with_mineru_metadata_fields(mineru_metadata_from_v2_block(block_type, block, content)),
    )
}

#[derive(Default)]
struct V2ContinuationState {
    current_page_has_paragraph: bool,
    current_page_last_paragraph_index: Option<usize>,
    previous_page_last_paragraph_index: Option<usize>,
    next_group_index: usize,
}

impl V2ContinuationState {
    fn start_page(&mut self) {
        self.current_page_has_paragraph = false;
        self.current_page_last_paragraph_index = None;
    }

    fn finish_page(&mut self) {
        if self.current_page_has_paragraph {
            self.previous_page_last_paragraph_index = self.current_page_last_paragraph_index;
        }
    }

    fn continuation_source_index(&self) -> Option<usize> {
        if self.current_page_has_paragraph {
            self.current_page_last_paragraph_index
        } else {
            self.previous_page_last_paragraph_index
        }
    }

    fn next_group_id(&mut self) -> String {
        let group_id = format!("v2-continuation-{}", self.next_group_index);
        self.next_group_index += 1;
        group_id
    }
}

fn append_v2_segments_with_continuations(
    segments: &mut Vec<SourceSegment>,
    block_segments: Vec<SourceSegment>,
    state: &mut V2ContinuationState,
) {
    for mut segment in block_segments {
        if segment.segment_type != SegmentType::Paragraph {
            segments.push(segment);
            continue;
        }

        if segment.text.trim().is_empty() {
            if let Some(source_index) = state.continuation_source_index() {
                if !segments[source_index].text.trim().is_empty() {
                    let group_id = segments[source_index]
                        .continuation_group_id
                        .clone()
                        .unwrap_or_else(|| state.next_group_id());
                    segments[source_index].continuation_group_id = Some(group_id.clone());
                    segment.text = segments[source_index].text.clone();
                    segment.continuation_group_id = Some(group_id);
                }
            }
        }

        segments.push(segment);
        state.current_page_has_paragraph = true;
        state.current_page_last_paragraph_index = Some(segments.len() - 1);
    }
}

fn segment_from_content_list_block(block: &Value) -> Option<SourceSegment> {
    let block_type = block.get("type")?.as_str()?;
    let segment_type = segment_type_from_content_list(block_type)?;
    let page_idx = block.get("page_idx").and_then(Value::as_u64).unwrap_or(0) as u32;
    let bbox = bbox_from_value(block.get("bbox"));
    let text = text_from_content_list_block(block_type, block)
        .or_else(|| fallback_visual_text(block_type, bbox.as_ref()))
        .or_else(|| empty_text_region(block_type, bbox.as_ref()))?;
    Some(
        SourceSegment::new(segment_type, page_idx, bbox, text)
            .with_asset_path(asset_path_from_content_list_block(block_type, block))
            .with_mineru_metadata(
                Some(block_type.to_string()),
                block
                    .get("sub_type")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                None,
            )
            .with_mineru_metadata_fields(mineru_metadata_from_content_list(block_type, block)),
    )
}

fn visual_segments_from_v2_block(block: &Value, page_idx: u32) -> Option<Vec<SourceSegment>> {
    let block_type = block.get("type")?.as_str()?;
    if !matches!(block_type, "image" | "chart" | "table") {
        return None;
    }

    let segment_type = segment_type_from_v2(block_type)?;
    let content = block.get("content").unwrap_or(&Value::Null);
    let block_bbox = bbox_from_value(block.get("bbox"));
    let asset_path = asset_path_from_v2_content(block_type, content);
    let visual_group_id = visual_group_id_from_v2_block(block_type, page_idx, block_bbox);
    let sub_type = block
        .get("sub_type")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let mut segments = Vec::new();

    if let Some(body_text) = visual_body_text(block_type, content)
        .or_else(|| fallback_visual_text(block_type, block_bbox.as_ref()))
    {
        segments.push(
            SourceSegment::new(segment_type, page_idx, block_bbox, body_text)
                .with_asset_path(asset_path.clone())
                .with_mineru_metadata(
                    Some(block_type.to_string()),
                    sub_type.clone(),
                    Some("body".to_string()),
                )
                .with_mineru_metadata_fields(mineru_metadata_from_v2_block(
                    block_type, block, content,
                ))
                .with_relation_groups(None, Some(visual_group_id.clone())),
        );
    }

    for role in ["caption", "footnote"] {
        let Some(text) = visual_role_text(block_type, role, content) else {
            continue;
        };
        let bbox = visual_role_bbox(block_type, role, content);

        segments.push(
            SourceSegment::new(SegmentType::Paragraph, page_idx, bbox, text)
                .with_asset_path(asset_path.clone())
                .with_mineru_metadata(
                    Some(block_type.to_string()),
                    sub_type.clone(),
                    Some(role.to_string()),
                )
                .with_mineru_metadata_fields(mineru_metadata_from_v2_block(
                    block_type, block, content,
                ))
                .with_relation_groups(None, Some(visual_group_id.clone())),
        );
    }

    Some(segments)
}

fn visual_group_id_from_v2_block(
    block_type: &str,
    page_idx: u32,
    bbox: Option<[f32; 4]>,
) -> String {
    if let Some([x0, y0, x1, y1]) = bbox {
        format!(
            "visual-{block_type}-p{page_idx}-{:.0}-{:.0}-{:.0}-{:.0}",
            x0, y0, x1, y1
        )
    } else {
        format!("visual-{block_type}-p{page_idx}-no-bbox")
    }
}

fn segment_type_from_v2(block_type: &str) -> Option<SegmentType> {
    match block_type {
        "title" => Some(SegmentType::Heading),
        "paragraph" => Some(SegmentType::Paragraph),
        "equation_interline" => Some(SegmentType::Math),
        "table" => Some(SegmentType::Table),
        "image" | "chart" => Some(SegmentType::Figure),
        "code" | "algorithm" => Some(SegmentType::Code),
        "list" | "index" => Some(SegmentType::List),
        "page_header" => Some(SegmentType::PageHeader),
        "page_footer" => Some(SegmentType::PageFooter),
        "page_number" => Some(SegmentType::PageNumber),
        "page_aside_text" => Some(SegmentType::AsideText),
        "page_footnote" => Some(SegmentType::PageFootnote),
        _ => None,
    }
}

fn segment_type_from_content_list(block_type: &str) -> Option<SegmentType> {
    match block_type {
        "text" => Some(SegmentType::Paragraph),
        "title" => Some(SegmentType::Heading),
        "equation" => Some(SegmentType::Math),
        "table" => Some(SegmentType::Table),
        "image" | "chart" => Some(SegmentType::Figure),
        "code" => Some(SegmentType::Code),
        "list" => Some(SegmentType::List),
        "header" => Some(SegmentType::PageHeader),
        "footer" => Some(SegmentType::PageFooter),
        "page_number" => Some(SegmentType::PageNumber),
        "aside_text" => Some(SegmentType::AsideText),
        "page_footnote" => Some(SegmentType::PageFootnote),
        _ => None,
    }
}

fn text_from_v2_content(block_type: &str, content: &Value) -> Option<String> {
    let text = match block_type {
        "title" => inline_items_text(content.get("title_content")?),
        "paragraph" => inline_items_text(content.get("paragraph_content")?),
        "equation_interline" => string_field(content, "math_content"),
        "table" => string_field(content, "table_body")
            .or_else(|| string_field(content, "html"))
            .or_else(|| string_array_field(content, "table_caption"))
            .or_else(|| inline_items_text(content.get("table_caption")?))
            .or_else(|| string_array_field(content, "table_footnote"))
            .or_else(|| inline_items_text(content.get("table_footnote")?))
            .or_else(|| string_field(content, "img_path"))
            .or_else(|| string_field(content, "image_path"))
            .or_else(|| nested_string_field(content, &["image_source", "path"])),
        "image" => string_array_field(content, "image_caption")
            .or_else(|| inline_items_text(content.get("image_caption")?))
            .or_else(|| string_array_field(content, "image_footnote"))
            .or_else(|| inline_items_text(content.get("image_footnote")?))
            .or_else(|| string_field(content, "img_path"))
            .or_else(|| string_field(content, "image_path"))
            .or_else(|| nested_string_field(content, &["image_source", "path"])),
        "chart" => string_field(content, "chart_content")
            .or_else(|| string_field(content, "content"))
            .or_else(|| string_array_field(content, "chart_caption"))
            .or_else(|| inline_items_text(content.get("chart_caption")?))
            .or_else(|| string_array_field(content, "chart_footnote"))
            .or_else(|| inline_items_text(content.get("chart_footnote")?))
            .or_else(|| string_field(content, "img_path"))
            .or_else(|| string_field(content, "image_path"))
            .or_else(|| nested_string_field(content, &["image_source", "path"])),
        "code" => code_text_from_v2_content(content, "code")
            .or_else(|| string_array_field(content, "code_caption"))
            .or_else(|| inline_items_text(content.get("code_caption")?))
            .or_else(|| string_array_field(content, "code_footnote"))
            .or_else(|| inline_items_text(content.get("code_footnote")?)),
        "algorithm" => code_text_from_v2_content(content, "algorithm")
            .or_else(|| string_array_field(content, "algorithm_caption"))
            .or_else(|| inline_items_text(content.get("algorithm_caption")?))
            .or_else(|| string_array_field(content, "code_caption"))
            .or_else(|| inline_items_text(content.get("code_caption")?))
            .or_else(|| string_array_field(content, "algorithm_footnote"))
            .or_else(|| inline_items_text(content.get("algorithm_footnote")?))
            .or_else(|| string_array_field(content, "code_footnote"))
            .or_else(|| inline_items_text(content.get("code_footnote")?)),
        "list" | "index" => list_items_markdown(content),
        "page_header" => inline_items_text(content.get("page_header_content")?),
        "page_footer" => inline_items_text(content.get("page_footer_content")?),
        "page_number" => inline_items_text(content.get("page_number_content")?)
            .or_else(|| Some("[Page Number]".to_string())),
        "page_aside_text" => inline_items_text(content.get("page_aside_text_content")?),
        "page_footnote" => inline_items_text(content.get("page_footnote_content")?),
        _ => None,
    }?;
    non_empty(text)
}

fn text_from_content_list_block(block_type: &str, block: &Value) -> Option<String> {
    let text = match block_type {
        "text" | "title" | "equation" => string_field(block, "text"),
        "table" => string_field(block, "table_body")
            .or_else(|| string_array_field(block, "table_caption"))
            .or_else(|| string_array_field(block, "table_footnote"))
            .or_else(|| string_field(block, "img_path"))
            .or_else(|| string_field(block, "image_path")),
        "image" => string_array_field(block, "image_caption")
            .or_else(|| string_array_field(block, "image_footnote"))
            .or_else(|| string_field(block, "img_path"))
            .or_else(|| string_field(block, "image_path")),
        "chart" => string_field(block, "content")
            .or_else(|| string_array_field(block, "chart_caption"))
            .or_else(|| string_field(block, "img_path")),
        "code" => code_text_from_content_list_block(block)
            .or_else(|| string_array_field(block, "code_caption"))
            .or_else(|| string_array_field(block, "algorithm_caption"))
            .or_else(|| string_array_field(block, "code_footnote"))
            .or_else(|| string_array_field(block, "algorithm_footnote")),
        "list" => content_list_items_markdown(block),
        "header" | "footer" | "aside_text" | "page_footnote" => string_field(block, "text"),
        "page_number" => string_field(block, "text").or_else(|| Some("[Page Number]".to_string())),
        _ => None,
    }?;
    non_empty(text)
}

fn visual_body_text(block_type: &str, content: &Value) -> Option<String> {
    match block_type {
        "table" => string_field(content, "table_body")
            .or_else(|| string_field(content, "html"))
            .or_else(|| string_field(content, "img_path"))
            .or_else(|| string_field(content, "image_path"))
            .or_else(|| nested_string_field(content, &["image_source", "path"])),
        "image" => textish_field(content, "content")
            .or_else(|| string_field(content, "img_path"))
            .or_else(|| string_field(content, "image_path"))
            .or_else(|| nested_string_field(content, &["image_source", "path"])),
        "chart" => textish_field(content, "chart_content")
            .or_else(|| textish_field(content, "content"))
            .or_else(|| string_field(content, "img_path"))
            .or_else(|| string_field(content, "image_path"))
            .or_else(|| nested_string_field(content, &["image_source", "path"])),
        _ => None,
    }
    .and_then(non_empty)
}

fn visual_role_text(block_type: &str, role: &str, content: &Value) -> Option<String> {
    let field = match (block_type, role) {
        ("table", "caption") => "table_caption",
        ("table", "footnote") => "table_footnote",
        ("image", "caption") => "image_caption",
        ("image", "footnote") => "image_footnote",
        ("chart", "caption") => "chart_caption",
        ("chart", "footnote") => "chart_footnote",
        _ => return None,
    };

    text_from_textish_value(content.get(field)?)
}

fn visual_role_bbox(block_type: &str, role: &str, content: &Value) -> Option<[f32; 4]> {
    let field = match (block_type, role) {
        ("table", "caption") => "table_caption",
        ("table", "footnote") => "table_footnote",
        ("image", "caption") => "image_caption",
        ("image", "footnote") => "image_footnote",
        ("chart", "caption") => "chart_caption",
        ("chart", "footnote") => "chart_footnote",
        _ => return None,
    };

    bbox_from_textish_value(content.get(field)?)
        .or_else(|| bbox_from_value(content.get(&format!("{field}_bbox"))))
}

fn code_text_from_v2_content(content: &Value, block_type: &str) -> Option<String> {
    let body = match block_type {
        "algorithm" => code_body_field(content, "algorithm_content")
            .or_else(|| code_body_field(content, "algorithm_body"))
            .or_else(|| code_body_field(content, "code_content"))
            .or_else(|| code_body_field(content, "code_body")),
        _ => code_body_field(content, "code_content")
            .or_else(|| code_body_field(content, "code_body"))
            .or_else(|| textish_field(content, "content"))
            .or_else(|| textish_field(content, "text"))
            .or_else(|| textish_field(content, "html")),
    }?;
    let language = string_field(content, "code_language")
        .or_else(|| string_field(content, "language"))
        .or_else(|| string_field(content, "lang"))
        .and_then(non_empty);
    Some(code_markdown(body, language.as_deref()))
}

fn code_text_from_content_list_block(block: &Value) -> Option<String> {
    let body = textish_field(block, "code_body")
        .or_else(|| textish_field(block, "code_content"))
        .or_else(|| textish_field(block, "algorithm_content"))
        .or_else(|| textish_field(block, "algorithm_body"))
        .or_else(|| textish_field(block, "text"))
        .or_else(|| textish_field(block, "content"))
        .or_else(|| textish_field(block, "html"))?;
    let language = string_field(block, "code_language")
        .or_else(|| string_field(block, "language"))
        .or_else(|| string_field(block, "lang"))
        .and_then(non_empty);
    Some(code_markdown(body, language.as_deref()))
}

fn code_body_field(value: &Value, key: &str) -> Option<String> {
    let field = value.get(key)?;
    if field.as_array().is_some() {
        inline_items_plain_text(field).or_else(|| text_from_textish_value(field))
    } else {
        text_from_textish_value(field)
    }
}

fn code_markdown(body: String, language: Option<&str>) -> String {
    if body.trim_start().starts_with("```") {
        return body;
    }

    let language = language.unwrap_or_default().trim();
    format!("```{language}\n{}\n```", body.trim())
}

fn textish_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(text_from_textish_value)
}

fn asset_path_from_v2_content(block_type: &str, content: &Value) -> Option<String> {
    match block_type {
        "table" | "image" | "chart" => string_field(content, "img_path")
            .or_else(|| string_field(content, "image_path"))
            .or_else(|| nested_string_field(content, &["image_source", "path"])),
        _ => None,
    }
    .and_then(non_empty)
}

fn asset_path_from_content_list_block(block_type: &str, block: &Value) -> Option<String> {
    match block_type {
        "table" | "image" | "chart" => {
            string_field(block, "img_path").or_else(|| string_field(block, "image_path"))
        }
        _ => None,
    }
    .and_then(non_empty)
}

fn mineru_metadata_from_v2_block(
    block_type: &str,
    block: &Value,
    content: &Value,
) -> BTreeMap<String, String> {
    let mut metadata = BTreeMap::new();
    insert_metadata_string(&mut metadata, "anchor", block, "anchor");
    insert_metadata_string(&mut metadata, "angle", block, "angle");
    insert_metadata_string(&mut metadata, "index", block, "index");
    insert_metadata_string(&mut metadata, "sub_type", block, "sub_type");

    for key in metadata_keys_for_block_type(block_type) {
        insert_metadata_string(&mut metadata, key, content, key);
    }

    insert_metadata_json(&mut metadata, "content", content);
    metadata
}

fn mineru_metadata_from_content_list(block_type: &str, block: &Value) -> BTreeMap<String, String> {
    let mut metadata = BTreeMap::new();
    insert_metadata_string(&mut metadata, "angle", block, "angle");
    insert_metadata_string(&mut metadata, "index", block, "index");
    insert_metadata_string(&mut metadata, "sub_type", block, "sub_type");

    for key in metadata_keys_for_block_type(block_type) {
        insert_metadata_string(&mut metadata, key, block, key);
    }

    for key in content_list_payload_keys_for_block_type(block_type) {
        insert_metadata_json_field(&mut metadata, key, block, key);
    }
    metadata
}

fn metadata_keys_for_block_type(block_type: &str) -> &'static [&'static str] {
    match block_type {
        "title" => &["level"],
        "code" | "algorithm" => &["code_language", "language", "lang"],
        "table" => &["table_type", "table_nest_level"],
        "list" | "index" => &["list_type"],
        "equation" | "equation_interline" => &["math_type"],
        _ => &[],
    }
}

fn content_list_payload_keys_for_block_type(block_type: &str) -> &'static [&'static str] {
    match block_type {
        "table" => &[
            "table_body",
            "table_caption",
            "table_footnote",
            "img_path",
            "image_path",
        ],
        "image" => &["image_caption", "image_footnote", "img_path", "image_path"],
        "chart" => &[
            "content",
            "chart_caption",
            "chart_footnote",
            "img_path",
            "image_path",
        ],
        "code" => &[
            "code_body",
            "code_content",
            "algorithm_content",
            "algorithm_body",
            "code_caption",
            "algorithm_caption",
            "code_footnote",
            "algorithm_footnote",
        ],
        "list" => &["list_items"],
        "equation" => &["text", "text_format", "img_path"],
        "text" | "header" | "footer" | "aside_text" | "page_footnote" => &["text"],
        "title" => &["text", "level"],
        "page_number" => &["text"],
        _ => &[],
    }
}

fn insert_metadata_string(
    metadata: &mut BTreeMap<String, String>,
    target_key: &str,
    value: &Value,
    source_key: &str,
) {
    if let Some(text) = metadata_string_field(value, source_key) {
        metadata.insert(target_key.to_string(), text);
    }
}

fn insert_metadata_json_field(
    metadata: &mut BTreeMap<String, String>,
    target_key: &str,
    value: &Value,
    source_key: &str,
) {
    if let Some(field) = value.get(source_key) {
        insert_metadata_json(metadata, target_key, field);
    }
}

fn insert_metadata_json(metadata: &mut BTreeMap<String, String>, target_key: &str, value: &Value) {
    if value.is_null() {
        return;
    }
    if let Ok(text) = serde_json::to_string(value) {
        if !text.is_empty() && text != "null" {
            metadata.insert(target_key.to_string(), text);
        }
    }
}

fn metadata_string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|field| {
            field
                .as_str()
                .map(ToString::to_string)
                .or_else(|| field.as_i64().map(|number| number.to_string()))
                .or_else(|| field.as_u64().map(|number| number.to_string()))
                .or_else(|| field.as_f64().map(|number| number.to_string()))
        })
        .and_then(non_empty)
}

fn fallback_visual_text(block_type: &str, bbox: Option<&[f32; 4]>) -> Option<String> {
    if bbox.is_none() {
        return None;
    }
    match block_type {
        "table" => Some("[Table]".to_string()),
        "image" | "chart" => Some("[Figure]".to_string()),
        "equation" | "equation_interline" => Some("[Equation]".to_string()),
        _ => None,
    }
}

fn empty_text_region(block_type: &str, bbox: Option<&[f32; 4]>) -> Option<String> {
    if bbox.is_none() {
        return None;
    }
    match block_type {
        "code" | "algorithm" => Some("[Code]".to_string()),
        "paragraph" | "text" => Some(String::new()),
        _ => None,
    }
}

fn inline_items_text(value: &Value) -> Option<String> {
    let items = value.as_array()?;
    let text = items
        .iter()
        .filter_map(inline_item_markdown)
        .collect::<Vec<_>>()
        .join("");
    non_empty(text)
}

fn inline_items_plain_text(value: &Value) -> Option<String> {
    let items = value.as_array()?;
    let text = items
        .iter()
        .filter_map(inline_item_plain_text)
        .collect::<Vec<_>>()
        .join("");
    non_empty(text)
}

fn inline_item_markdown(item: &Value) -> Option<String> {
    let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
    if item_type == "hyperlink" {
        let text = item
            .get("children")
            .and_then(inline_items_text)
            .or_else(|| {
                item.get("content")
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
            })
            .or_else(|| {
                item.get("text")
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
            })?;
        let Some(url) = item
            .get("url")
            .and_then(Value::as_str)
            .and_then(|url| non_empty(url.to_string()))
        else {
            return Some(text);
        };
        return Some(format!(
            "[{}]({})",
            escape_markdown_link_text(&text),
            url.trim()
        ));
    }

    if item_type == "equation_inline" {
        let text = inline_item_plain_text(item)?;
        if contains_math_delimiter(&text) {
            return Some(text);
        }
        return Some(format!("${}$", text.trim()));
    }

    inline_item_plain_text(item)
}

fn inline_item_plain_text(item: &Value) -> Option<String> {
    item.get("children")
        .and_then(inline_items_plain_text)
        .or_else(|| {
            item.get("content")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .or_else(|| {
            item.get("text")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
}

fn escape_markdown_link_text(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]")
}

fn contains_math_delimiter(text: &str) -> bool {
    text.contains('$') || text.contains("\\(") || text.contains("\\[")
}

fn list_items_markdown(content: &Value) -> Option<String> {
    let items = content.get("list_items")?.as_array()?;
    let ordered = is_ordered_list(content);
    let lines = items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            list_item_text(item).map(|text| {
                let marker = if ordered {
                    format!("{}.", index + 1)
                } else {
                    "-".to_string()
                };
                format!("{marker} {text}")
            })
        })
        .collect::<Vec<_>>();
    non_empty(lines.join("\n"))
}

fn content_list_items_markdown(block: &Value) -> Option<String> {
    let items = block.get("list_items")?;
    if items.as_array()?.iter().all(Value::is_string) {
        let ordered = is_ordered_list(block);
        let lines = items
            .as_array()?
            .iter()
            .enumerate()
            .filter_map(|(index, item)| {
                item.as_str().map(|text| {
                    let marker = if ordered {
                        format!("{}.", index + 1)
                    } else {
                        "-".to_string()
                    };
                    format!("{marker} {text}")
                })
            })
            .collect::<Vec<_>>();
        return non_empty(lines.join("\n"));
    }

    list_items_markdown(block)
}

fn list_item_text(item: &Value) -> Option<String> {
    item.as_str()
        .map(ToString::to_string)
        .or_else(|| item.get("item_content").and_then(inline_items_text))
        .or_else(|| item.get("content").and_then(text_from_textish_value))
        .or_else(|| {
            item.get("text")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .and_then(non_empty)
}

fn is_ordered_list(value: &Value) -> bool {
    ["list_type", "sub_type", "type"]
        .iter()
        .filter_map(|key| value.get(*key).and_then(Value::as_str))
        .any(|kind| {
            let lower = kind.to_ascii_lowercase();
            lower.contains("ordered")
                || lower.contains("number")
                || lower.contains("decimal")
                || lower == "ol"
                || lower == "index"
                || lower == "ref_text"
        })
}

fn text_from_textish_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => non_empty(text.to_string()),
        Value::Array(items) => {
            if items.iter().any(Value::is_object) {
                return inline_items_text(value);
            }
            let text = items
                .iter()
                .filter_map(|item| match item {
                    Value::String(text) => Some(text.to_string()),
                    Value::Object(_) => item
                        .get("content")
                        .and_then(Value::as_str)
                        .or_else(|| item.get("text").and_then(Value::as_str))
                        .map(ToString::to_string)
                        .or_else(|| item.get("item_content").and_then(inline_items_text)),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n");
            non_empty(text)
        }
        Value::Object(_) => value
            .get("content")
            .and_then(Value::as_str)
            .or_else(|| value.get("text").and_then(Value::as_str))
            .map(ToString::to_string)
            .or_else(|| value.get("item_content").and_then(inline_items_text))
            .and_then(non_empty),
        _ => None,
    }
}

fn bbox_from_textish_value(value: &Value) -> Option<[f32; 4]> {
    bbox_from_value(value.get("bbox")).or_else(|| {
        value
            .as_array()?
            .iter()
            .filter_map(|item| bbox_from_value(item.get("bbox")))
            .reduce(union_bbox)
    })
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn string_array_field(value: &Value, key: &str) -> Option<String> {
    let text = value
        .get(key)?
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>()
        .join("\n");
    non_empty(text)
}

fn nested_string_field(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str().map(ToString::to_string)
}

fn bbox_from_value(value: Option<&Value>) -> Option<[f32; 4]> {
    let values = value?.as_array()?;
    if values.len() != 4 {
        return None;
    }
    Some([
        values[0].as_f64()? as f32,
        values[1].as_f64()? as f32,
        values[2].as_f64()? as f32,
        values[3].as_f64()? as f32,
    ])
}

fn union_bbox(left: [f32; 4], right: [f32; 4]) -> [f32; 4] {
    [
        left[0].min(right[0]),
        left[1].min(right[1]),
        left[2].max(right[2]),
        left[3].max(right[3]),
    ]
}

fn find_key<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(map) => map
            .get(key)
            .filter(|nested| !nested.is_string())
            .or_else(|| map.values().find_map(|nested| find_key(nested, key))),
        Value::Array(items) => items.iter().find_map(|item| find_key(item, key)),
        _ => None,
    }
}

fn find_embedded_json_key(value: &Value, key: &str) -> Option<Value> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(Value::as_str)
            .and_then(|text| serde_json::from_str::<Value>(text).ok())
            .or_else(|| {
                map.values()
                    .find_map(|nested| find_embedded_json_key(nested, key))
            }),
        Value::Array(items) => items
            .iter()
            .find_map(|item| find_embedded_json_key(item, key)),
        _ => None,
    }
}

fn looks_like_content_list_v2(value: &Value) -> bool {
    value
        .as_array()
        .and_then(|pages| pages.first())
        .and_then(Value::as_array)
        .is_some()
}

fn document_from_segments(segments: Vec<SourceSegment>) -> Result<NeuinkDocument, ParserError> {
    if segments.is_empty() {
        return Err(ParserError::EmptyDocument);
    }
    Ok(NeuinkDocument::new(segments))
}

fn non_empty(text: String) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use neuink_domain::SegmentType;
    use serde_json::json;

    use super::normalize_parser_response;

    #[test]
    fn normalizes_content_list_v2() {
        let value = json!({
            "content_list_v2": [[{
                "type": "paragraph",
                "content": {"paragraph_content": [{"type": "text", "content": "Hello"}]},
                "bbox": [1, 2, 3, 4]
            }]]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 1);
        assert_eq!(document.segments[0].text, "Hello");
    }

    #[test]
    fn normalizes_v2_hyperlink_and_inline_math_spans() {
        let value = json!({
            "content_list_v2": [[{
                "type": "paragraph",
                "content": {
                    "paragraph_content": [{
                        "type": "hyperlink",
                        "content": "Neuink docs",
                        "url": "https://example.test/docs",
                        "children": [{"type": "text", "content": "Neuink docs"}]
                    }, {
                        "type": "text",
                        "content": " define "
                    }, {
                        "type": "equation_inline",
                        "content": "x^2"
                    }]
                },
                "bbox": [1, 2, 3, 4]
            }]]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(
            document.segments[0].text,
            "[Neuink docs](https://example.test/docs) define $x^2$"
        );
    }

    #[test]
    fn keeps_empty_v2_paragraph_region_without_source_text() {
        let value = json!({
            "content_list_v2": [[{
                "type": "paragraph",
                "content": {"paragraph_content": []},
                "bbox": [90, 119, 905, 150]
            }]]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 1);
        assert_eq!(document.segments[0].segment_type, SegmentType::Paragraph);
        assert_eq!(document.segments[0].text, "");
        assert_eq!(document.segments[0].bbox, Some([90.0, 119.0, 905.0, 150.0]));
    }

    #[test]
    fn copies_previous_paragraph_text_for_same_page_empty_v2_paragraph() {
        let value = json!({
            "content_list_v2": [[
                {
                    "type": "paragraph",
                    "content": {"paragraph_content": [{"type": "text", "content": "split paragraph"}]},
                    "bbox": [90, 100, 450, 180]
                },
                {
                    "type": "paragraph",
                    "content": {"paragraph_content": []},
                    "bbox": [510, 300, 900, 380]
                }
            ]]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 2);
        assert_eq!(document.segments[0].text, "split paragraph");
        assert_eq!(document.segments[1].text, "split paragraph");
        assert_eq!(
            document.segments[0].continuation_group_id,
            document.segments[1].continuation_group_id
        );
        assert!(document.segments[0].continuation_group_id.is_some());
    }

    #[test]
    fn copies_previous_page_paragraph_text_for_page_start_empty_v2_paragraph() {
        let value = json!({
            "content_list_v2": [
                [{
                    "type": "paragraph",
                    "content": {"paragraph_content": [{"type": "text", "content": "cross page paragraph"}]},
                    "bbox": [90, 700, 450, 820]
                }],
                [
                    {
                        "type": "paragraph",
                        "content": {"paragraph_content": []},
                        "bbox": [90, 80, 450, 160]
                    },
                    {
                        "type": "paragraph",
                        "content": {"paragraph_content": [{"type": "text", "content": "next paragraph"}]},
                        "bbox": [90, 180, 450, 260]
                    }
                ]
            ]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 3);
        assert_eq!(document.segments[0].text, "cross page paragraph");
        assert_eq!(document.segments[1].text, "cross page paragraph");
        assert_eq!(
            document.segments[0].continuation_group_id,
            document.segments[1].continuation_group_id
        );
        assert!(document.segments[0].continuation_group_id.is_some());
        assert_eq!(document.segments[2].text, "next paragraph");
        assert!(document.segments[2].continuation_group_id.is_none());
    }

    #[test]
    fn keeps_empty_v2_algorithm_region() {
        let value = json!({
            "content_list_v2": [[{
                "type": "algorithm",
                "content": {"algorithm_content": ""},
                "bbox": [510, 87, 881, 740]
            }]]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 1);
        assert_eq!(document.segments[0].segment_type, SegmentType::Code);
        assert_eq!(document.segments[0].text, "[Code]");
        assert_eq!(document.segments[0].bbox, Some([510.0, 87.0, 881.0, 740.0]));
    }

    #[test]
    fn normalizes_v2_algorithm_caption_when_body_is_missing() {
        let value = json!({
            "content_list_v2": [[{
                "type": "algorithm",
                "content": {
                    "algorithm_caption": [{"type": "text", "content": "Algorithm 1 Modules"}]
                },
                "bbox": [510, 87, 881, 740]
            }]]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 1);
        assert_eq!(document.segments[0].segment_type, SegmentType::Code);
        assert_eq!(document.segments[0].text, "Algorithm 1 Modules");
    }

    #[test]
    fn normalizes_v2_algorithm_body_spans_before_caption() {
        let value = json!({
            "content_list_v2": [[{
                "type": "algorithm",
                "content": {
                    "algorithm_caption": [{"type": "text", "content": "Algorithm 1"}],
                    "algorithm_content": [
                        {"type": "text", "content": "1: "},
                        {"type": "equation_inline", "content": "x \\leftarrow 1"},
                        {"type": "text", "content": "\n2: return x"}
                    ]
                },
                "bbox": [100, 120, 500, 300]
            }]]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 1);
        assert_eq!(document.segments[0].segment_type, SegmentType::Code);
        assert_eq!(
            document.segments[0].text,
            "```\n1: x \\leftarrow 1\n2: return x\n```"
        );
    }

    #[test]
    fn normalizes_v2_code_body_with_language() {
        let value = json!({
            "content_list_v2": [[{
                "type": "code",
                "content": {
                    "code_language": "python",
                    "code_content": [{"type": "text", "content": "def hello():\n    return 1"}]
                },
                "bbox": [100, 120, 500, 300]
            }]]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 1);
        assert_eq!(document.segments[0].segment_type, SegmentType::Code);
        assert_eq!(
            document.segments[0].text,
            "```python\ndef hello():\n    return 1\n```"
        );
        assert_eq!(
            document.segments[0]
                .mineru_metadata
                .get("code_language")
                .map(String::as_str),
            Some("python")
        );
    }

    #[test]
    fn normalizes_content_list_code_body() {
        let value = json!({
            "content_list": [{
                "type": "code",
                "code_body": "x = 1",
                "code_language": "python",
                "page_idx": 0,
                "bbox": [100, 120, 500, 300]
            }]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 1);
        assert_eq!(document.segments[0].segment_type, SegmentType::Code);
        assert_eq!(document.segments[0].text, "```python\nx = 1\n```");
    }

    #[test]
    fn normalizes_v2_image_structured_content() {
        let value = json!({
            "content_list_v2": [[{
                "type": "image",
                "sub_type": "flowchart",
                "content": {
                    "image_source": {"path": "images/flowchart.jpg"},
                    "content": "```mermaid\ngraph TD\nA --> B\n```",
                    "image_caption": [{"type": "text", "content": "Fig. 1 Flow"}]
                },
                "bbox": [10, 20, 300, 400]
            }]]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 2);
        assert_eq!(document.segments[0].segment_type, SegmentType::Figure);
        assert_eq!(
            document.segments[0].text,
            "```mermaid\ngraph TD\nA --> B\n```"
        );
        assert_eq!(
            document.segments[0].asset_path.as_deref(),
            Some("images/flowchart.jpg")
        );
        assert_eq!(document.segments[0].sub_type.as_deref(), Some("flowchart"));
        assert_eq!(document.segments[1].text, "Fig. 1 Flow");
        assert_eq!(document.segments[1].block_role.as_deref(), Some("caption"));
        assert_eq!(document.segments[1].bbox, None);
    }

    #[test]
    fn normalizes_content_list() {
        let value = json!({
            "content_list": [{
                "type": "text",
                "text": "Hello",
                "page_idx": 2,
                "bbox": [1, 2, 3, 4]
            }]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 1);
        assert_eq!(document.segments[0].page_idx, 2);
    }

    #[test]
    fn normalizes_embedded_json_content_list() {
        let value = json!({
            "results": {
                "paper": {
                    "content_list": r#"[{
                        "type": "text",
                        "text": "Hello from LAN MinerU",
                        "page_idx": 0,
                        "bbox": [1, 2, 3, 4]
                    }]"#
                }
            }
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 1);
        assert_eq!(document.segments[0].text, "Hello from LAN MinerU");
    }

    #[test]
    fn keeps_v2_visual_blocks_without_text() {
        let value = json!({
            "content_list_v2": [[{
                "type": "image",
                "content": {"image_caption": []},
                "bbox": [10, 20, 300, 400]
            }]]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 1);
        assert_eq!(document.segments[0].segment_type, SegmentType::Figure);
        assert_eq!(document.segments[0].text, "[Figure]");
    }

    #[test]
    fn splits_v2_image_body_and_caption_when_caption_has_bbox() {
        let value = json!({
            "content_list_v2": [[{
                "type": "image",
                "sub_type": "seal",
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

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 2);
        assert_eq!(document.segments[0].segment_type, SegmentType::Figure);
        assert_eq!(document.segments[0].text, "images/figure.jpg");
        assert_eq!(document.segments[0].raw_type.as_deref(), Some("image"));
        assert_eq!(document.segments[0].sub_type.as_deref(), Some("seal"));
        assert_eq!(document.segments[0].block_role.as_deref(), Some("body"));
        assert_eq!(
            document.segments[0].visual_group_id.as_deref(),
            Some("visual-image-p0-10-20-300-400")
        );
        assert_eq!(document.segments[1].segment_type, SegmentType::Paragraph);
        assert_eq!(document.segments[1].text, "Figure caption");
        assert_eq!(document.segments[1].bbox, Some([10.0, 405.0, 300.0, 430.0]));
        assert_eq!(document.segments[1].raw_type.as_deref(), Some("image"));
        assert_eq!(document.segments[1].block_role.as_deref(), Some("caption"));
        assert_eq!(
            document.segments[1].visual_group_id,
            document.segments[0].visual_group_id
        );
    }

    #[test]
    fn splits_v2_visual_caption_without_bbox() {
        let value = json!({
            "content_list_v2": [[{
                "type": "table",
                "content": {
                    "html": "<table><tr><td>A</td></tr></table>",
                    "table_caption": [{"type": "text", "content": "Table caption"}],
                    "table_footnote": [{"type": "text", "content": "Table note"}]
                },
                "bbox": [10, 20, 300, 400]
            }]]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 3);
        assert_eq!(document.segments[0].segment_type, SegmentType::Table);
        assert_eq!(
            document.segments[0].text,
            "<table><tr><td>A</td></tr></table>"
        );
        assert_eq!(document.segments[1].text, "Table caption");
        assert_eq!(document.segments[1].block_role.as_deref(), Some("caption"));
        assert_eq!(document.segments[1].bbox, None);
        assert_eq!(document.segments[2].text, "Table note");
        assert_eq!(document.segments[2].block_role.as_deref(), Some("footnote"));
        assert_eq!(document.segments[2].bbox, None);
    }

    #[test]
    fn normalizes_v2_visual_content_shapes() {
        let value = json!({
            "content_list_v2": [[{
                "type": "image",
                "content": {
                    "image_source": {"path": "images/figure.jpg"},
                    "image_caption": [{"type": "text", "content": "Figure caption"}]
                },
                "bbox": [10, 20, 300, 400]
            }, {
                "type": "table",
                "content": {
                    "image_source": {"path": "images/table.jpg"},
                    "html": "<table><tr><td>A</td></tr></table>",
                    "table_caption": [{"type": "text", "content": "Table caption"}],
                    "table_type": "simple_table"
                },
                "bbox": [10, 420, 900, 700]
            }, {
                "type": "list",
                "content": {
                    "list_type": "text_list",
                    "list_items": [{
                        "item_content": [{"type": "text", "content": "First"}]
                    }]
                },
                "bbox": [10, 720, 900, 760]
            }]]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 5);
        assert_eq!(document.segments[0].text, "images/figure.jpg");
        assert_eq!(document.segments[0].raw_type.as_deref(), Some("image"));
        assert_eq!(
            document.segments[0].asset_path.as_deref(),
            Some("images/figure.jpg")
        );
        assert_eq!(document.segments[1].text, "Figure caption");
        assert_eq!(document.segments[1].block_role.as_deref(), Some("caption"));
        assert_eq!(
            document.segments[2].text,
            "<table><tr><td>A</td></tr></table>"
        );
        assert_eq!(
            document.segments[2].asset_path.as_deref(),
            Some("images/table.jpg")
        );
        assert_eq!(
            document.segments[2]
                .mineru_metadata
                .get("table_type")
                .map(String::as_str),
            Some("simple_table")
        );
        assert_eq!(document.segments[3].text, "Table caption");
        assert_eq!(document.segments[3].block_role.as_deref(), Some("caption"));
        assert_eq!(document.segments[4].text, "- First");
        assert_eq!(
            document.segments[4]
                .mineru_metadata
                .get("list_type")
                .map(String::as_str),
            Some("text_list")
        );
    }

    #[test]
    fn normalizes_v2_ordered_list_as_markdown() {
        let value = json!({
            "content_list_v2": [[{
                "type": "list",
                "content": {
                    "list_type": "ordered",
                    "list_items": [{
                        "item_content": [{"type": "text", "content": "First"}]
                    }, {
                        "item_content": [{"type": "text", "content": "Second"}]
                    }]
                },
                "bbox": [10, 20, 300, 400],
                "anchor": "list-1",
                "angle": 0
            }]]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments[0].segment_type, SegmentType::List);
        assert_eq!(document.segments[0].text, "1. First\n2. Second");
        assert_eq!(
            document.segments[0]
                .mineru_metadata
                .get("anchor")
                .map(String::as_str),
            Some("list-1")
        );
        assert!(document.segments[0].mineru_metadata.contains_key("content"));
    }

    #[test]
    fn keeps_content_list_visual_blocks_from_image_path() {
        let value = json!({
            "content_list": [{
                "type": "image",
                "img_path": "images/figure-1.jpg",
                "image_caption": [],
                "page_idx": 1,
                "bbox": [10, 20, 300, 400]
            }, {
                "type": "table",
                "img_path": "images/table-1.jpg",
                "table_caption": [],
                "table_footnote": [],
                "page_idx": 1,
                "bbox": [10, 420, 900, 700]
            }]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 2);
        assert_eq!(document.segments[0].segment_type, SegmentType::Figure);
        assert_eq!(document.segments[0].text, "images/figure-1.jpg");
        assert_eq!(
            document.segments[0].asset_path.as_deref(),
            Some("images/figure-1.jpg")
        );
        assert_eq!(document.segments[1].segment_type, SegmentType::Table);
        assert_eq!(document.segments[1].text, "images/table-1.jpg");
        assert_eq!(
            document.segments[1].asset_path.as_deref(),
            Some("images/table-1.jpg")
        );
    }

    #[test]
    fn keeps_v2_page_auxiliary_blocks() {
        let value = json!({
            "content_list_v2": [[{
                "type": "page_header",
                "content": {"page_header_content": [{"type": "text", "content": "Header"}]},
                "bbox": [10, 20, 300, 40]
            }, {
                "type": "page_number",
                "content": {"page_number_content": []},
                "bbox": [490, 930, 510, 950]
            }, {
                "type": "page_aside_text",
                "content": {"page_aside_text_content": [{"type": "text", "content": "Aside"}]},
                "bbox": [20, 200, 50, 700]
            }]]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 3);
        assert_eq!(document.segments[0].segment_type, SegmentType::PageHeader);
        assert_eq!(document.segments[1].segment_type, SegmentType::PageNumber);
        assert_eq!(document.segments[1].text, "[Page Number]");
        assert_eq!(document.segments[2].segment_type, SegmentType::AsideText);
    }

    #[test]
    fn keeps_content_list_page_auxiliary_blocks() {
        let value = json!({
            "content_list": [{
                "type": "header",
                "text": "Header",
                "page_idx": 1,
                "bbox": [10, 20, 300, 40]
            }, {
                "type": "footer",
                "text": "Footer",
                "page_idx": 1,
                "bbox": [10, 900, 300, 930]
            }, {
                "type": "page_footnote",
                "text": "Footnote",
                "page_idx": 1,
                "bbox": [10, 830, 500, 880]
            }]
        });

        let document = normalize_parser_response(&value).unwrap();

        assert_eq!(document.segments.len(), 3);
        assert_eq!(document.segments[0].segment_type, SegmentType::PageHeader);
        assert_eq!(document.segments[1].segment_type, SegmentType::PageFooter);
        assert_eq!(document.segments[2].segment_type, SegmentType::PageFootnote);
    }

    #[test]
    fn assigns_stable_segment_uids_across_repeated_normalization() {
        let value = json!({
            "content_list": [{
                "type": "text",
                "text": "Stable paragraph",
                "page_idx": 2,
                "bbox": [10, 20, 300, 80]
            }]
        });

        let first = normalize_parser_response(&value).unwrap();
        let second = normalize_parser_response(&value).unwrap();

        assert_eq!(first.segments[0].uid, second.segments[0].uid);
        assert!(first.segments[0].uid.as_str().starts_with("seg-"));
    }

    #[test]
    fn changes_segment_uid_when_source_identity_changes() {
        let first = normalize_parser_response(&json!({
            "content_list": [{"type": "text", "text": "First", "page_idx": 0}]
        }))
        .unwrap();
        let second = normalize_parser_response(&json!({
            "content_list": [{"type": "text", "text": "Second", "page_idx": 0}]
        }))
        .unwrap();

        assert_ne!(first.segments[0].uid, second.segments[0].uid);
    }
}
