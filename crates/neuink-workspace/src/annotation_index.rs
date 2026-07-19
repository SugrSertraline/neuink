use serde::{Deserialize, Serialize};

use neuink_domain::{
    Annotation, AnnotationSegmentSnapshot, EntryId, SegmentType, SegmentUid, SourceSegment, TagId,
};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AnnotationSegmentContext {
    pub asset_path: Option<String>,
    pub bbox: Option<[f32; 4]>,
    pub markdown: Option<String>,
    pub page_idx: u32,
    pub segment_type: SegmentType,
    pub segment_uid: SegmentUid,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AnnotationIndexRecord {
    pub annotation: Annotation,
    pub entry_id: EntryId,
    pub entry_tag_ids: Vec<TagId>,
    pub entry_title: String,
    pub segment: Option<AnnotationSegmentContext>,
    pub segment_status: AnnotationSegmentStatus,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AnnotationSegmentStatus {
    Current,
    Orphaned,
    Missing,
}

impl AnnotationIndexRecord {
    pub fn new(
        entry_id: EntryId,
        entry_title: String,
        entry_tag_ids: Vec<TagId>,
        annotation: Annotation,
        segment: Option<SourceSegment>,
    ) -> Self {
        let snapshot_segment = annotation
            .segment_snapshot
            .as_ref()
            .map(AnnotationSegmentContext::from);
        let live_segment = segment.map(AnnotationSegmentContext::from);
        let segment_status = if live_segment.is_some() {
            AnnotationSegmentStatus::Current
        } else if snapshot_segment.is_some() {
            AnnotationSegmentStatus::Orphaned
        } else {
            AnnotationSegmentStatus::Missing
        };

        Self {
            annotation,
            entry_id,
            entry_tag_ids,
            entry_title,
            segment: live_segment.or(snapshot_segment),
            segment_status,
        }
    }
}

impl From<SourceSegment> for AnnotationSegmentContext {
    fn from(segment: SourceSegment) -> Self {
        Self {
            asset_path: segment.asset_path,
            bbox: segment.bbox,
            markdown: segment.markdown,
            page_idx: segment.page_idx,
            segment_type: segment.segment_type,
            segment_uid: segment.uid,
            text: segment.text,
        }
    }
}

impl From<&AnnotationSegmentSnapshot> for AnnotationSegmentContext {
    fn from(segment: &AnnotationSegmentSnapshot) -> Self {
        Self {
            asset_path: segment.asset_path.clone(),
            bbox: segment.bbox,
            markdown: segment.markdown.clone(),
            page_idx: segment.page_idx,
            segment_type: segment.segment_type,
            segment_uid: segment.segment_uid.clone(),
            text: segment.text.clone(),
        }
    }
}
