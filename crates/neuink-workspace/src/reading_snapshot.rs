//! Freeze reader enrichment once; downloaded snapshots do not consult stale raw artifacts.
use super::*;

pub(super) fn add_empty_regions(
    segments: &mut Vec<SourceSegment>,
    empty_regions: Vec<EmptyMineruRegion>,
) {
    for empty_region in empty_regions {
        if segments.iter().any(|segment| {
            segment.page_idx == empty_region.page_idx
                && segment.segment_type == SegmentType::Paragraph
                && (bboxes_match(segment.bbox, Some(empty_region.bbox))
                    || non_empty_segment_overlaps_empty_region(segment, empty_region.bbox))
        }) {
            continue;
        }

        segments.push(SourceSegment {
            uid: SegmentUid::from_string(format!(
                "mineru-empty-v2-p{}-{:.0}-{:.0}-{:.0}-{:.0}",
                empty_region.page_idx,
                empty_region.bbox[0],
                empty_region.bbox[1],
                empty_region.bbox[2],
                empty_region.bbox[3]
            )),
            segment_type: SegmentType::Paragraph,
            page_idx: empty_region.page_idx,
            bbox: Some(empty_region.bbox),
            text: String::new(),
            markdown: None,
            asset_path: None,
            raw_type: Some("paragraph".to_string()),
            sub_type: None,
            block_role: None,
            mineru_metadata: Default::default(),
            continuation_group_id: None,
            visual_group_id: None,
        });
    }
}
pub(super) fn add_assets(segments: &mut [SourceSegment], asset_refs: Vec<MineruAssetRef>) {
    for segment in segments.iter_mut() {
        if segment.asset_path.is_none() {
            segment.asset_path = mineru_asset_path_from_text(
                segment.markdown.as_deref().unwrap_or(segment.text.as_str()),
            );
        }
        let existing_asset_path = segment.asset_path.clone();

        let best = asset_refs
            .iter()
            .filter(|asset_ref| {
                asset_ref.page_idx == segment.page_idx
                    && asset_ref.segment_type == segment.segment_type
                    && existing_asset_path
                        .as_deref()
                        .is_none_or(|path| path == asset_ref.asset_path)
            })
            .filter_map(|asset_ref| {
                asset_ref
                    .match_score(segment)
                    .map(|score| (score, asset_ref))
            })
            .min_by_key(|(score, _)| *score);

        if let Some((_, asset_ref)) = best {
            if segment.asset_path.is_none() {
                segment.asset_path = Some(asset_ref.asset_path.clone());
            }
            if segment.raw_type.is_none() {
                segment.raw_type = Some(asset_ref.raw_type.clone());
            }
            if segment.sub_type.is_none() {
                segment.sub_type = asset_ref.sub_type.clone();
            }
            if segment.block_role.is_none() {
                segment.block_role = Some("body".to_string());
            }
            if segment.visual_group_id.is_none() {
                segment.visual_group_id = asset_ref.visual_group_id();
            }
            enrich_visual_segment_text(segment, asset_ref);
        }
    }
}
pub(crate) fn materialize(segments: &mut Vec<SourceSegment>, sources: &[(String, Value)]) {
    let mut empty = Vec::new();
    let mut assets = Vec::new();
    for (name, value) in sources {
        if name.ends_with("_content_list_v2.json") {
            collect_empty_mineru_paragraph_regions(value, &mut empty);
        }
        collect_mineru_asset_refs(value, &mut assets);
    }
    add_empty_regions(segments, empty);
    add_assets(segments, assets);
}
pub(crate) fn marker(bytes: &[u8]) -> Value {
    serde_json::json!({"version":1,"segments_hash":blake3::hash(bytes).to_hex().to_string()})
}
pub(crate) fn matches(marker_bytes: &[u8], segments: &[u8]) -> Result<bool, WorkspaceError> {
    let value: Value = serde_json::from_slice(marker_bytes)?;
    Ok(value == marker(segments))
}
pub(super) fn is_normalized(
    workspace: &Workspace,
    entry: &EntryId,
) -> Result<bool, WorkspaceError> {
    let path = workspace
        .layout
        .entry_dir(entry)
        .join("paper.reading-snapshot.json");
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.into()),
    };
    let segments = match fs::read(workspace.layout.entry_segments_file(entry)) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.into()),
    };
    matches(&bytes, &segments)
}
pub(super) fn invalidate(workspace: &Workspace, entry: &EntryId) -> Result<(), WorkspaceError> {
    match fs::remove_file(
        workspace
            .layout
            .entry_dir(entry)
            .join("paper.reading-snapshot.json"),
    ) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}
