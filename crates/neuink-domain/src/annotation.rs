use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{AnnotationId, SegmentType, SegmentUid, SourceSegment};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Annotation {
    pub annotation_id: AnnotationId,
    pub segment_uid: SegmentUid,
    pub kind: String,
    pub content: String,
    pub importance: AnnotationImportance,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_snapshot: Option<AnnotationSegmentSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_selection: Option<AnnotationTextSelection>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct AnnotationSegmentSnapshot {
    pub asset_path: Option<String>,
    pub bbox: Option<[f32; 4]>,
    pub markdown: Option<String>,
    pub page_idx: u32,
    pub segment_type: SegmentType,
    pub segment_uid: SegmentUid,
    pub text: String,
}

impl Annotation {
    pub fn new(
        segment_uid: SegmentUid,
        kind: impl Into<String>,
        content: impl Into<String>,
        importance: AnnotationImportance,
    ) -> Self {
        let now = Utc::now();
        Self {
            annotation_id: AnnotationId::new(),
            segment_uid,
            kind: normalize_kind(kind),
            content: content.into().trim().to_string(),
            importance,
            segment_snapshot: None,
            text_selection: None,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn new_for_segment(
        segment: &SourceSegment,
        kind: impl Into<String>,
        content: impl Into<String>,
        importance: AnnotationImportance,
    ) -> Self {
        let mut annotation = Self::new(segment.uid.clone(), kind, content, importance);
        annotation.segment_snapshot = Some(AnnotationSegmentSnapshot::from(segment));
        annotation
    }

    pub fn update(
        &mut self,
        kind: impl Into<String>,
        content: impl Into<String>,
        importance: AnnotationImportance,
    ) {
        self.kind = normalize_kind(kind);
        self.content = content.into().trim().to_string();
        self.importance = importance;
        self.updated_at = Utc::now();
    }

    pub fn refresh_segment_snapshot(&mut self, segment: &SourceSegment) {
        self.segment_snapshot = Some(AnnotationSegmentSnapshot::from(segment));
        self.updated_at = Utc::now();
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct AnnotationTextSelection {
    #[serde(default = "default_highlight_color")]
    pub color: String,
    pub page_idx: u32,
    pub rects: Vec<[f32; 4]>,
    pub text: String,
}

fn default_highlight_color() -> String {
    "yellow".to_string()
}

impl From<&SourceSegment> for AnnotationSegmentSnapshot {
    fn from(segment: &SourceSegment) -> Self {
        Self {
            asset_path: segment.asset_path.clone(),
            bbox: segment.bbox,
            markdown: segment.markdown.clone(),
            page_idx: segment.page_idx,
            segment_type: segment.segment_type,
            segment_uid: segment.uid.clone(),
            text: segment.text.clone(),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AnnotationImportance {
    Core,
    Important,
    Normal,
}

fn normalize_kind(kind: impl Into<String>) -> String {
    kind.into().trim().to_string()
}
