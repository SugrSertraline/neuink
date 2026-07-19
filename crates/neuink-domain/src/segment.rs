use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::SegmentUid;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SourceSegment {
    pub uid: SegmentUid,
    pub segment_type: SegmentType,
    pub page_idx: u32,
    pub bbox: Option<[f32; 4]>,
    pub text: String,
    pub markdown: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sub_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_role: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub mineru_metadata: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuation_group_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visual_group_id: Option<String>,
}

impl SourceSegment {
    pub fn new(
        segment_type: SegmentType,
        page_idx: u32,
        bbox: Option<[f32; 4]>,
        text: String,
    ) -> Self {
        Self {
            uid: SegmentUid::new(),
            segment_type,
            page_idx,
            bbox,
            text,
            markdown: None,
            asset_path: None,
            raw_type: None,
            sub_type: None,
            block_role: None,
            mineru_metadata: BTreeMap::new(),
            continuation_group_id: None,
            visual_group_id: None,
        }
    }

    pub fn with_asset_path(mut self, asset_path: Option<String>) -> Self {
        self.asset_path = asset_path;
        self
    }

    pub fn with_mineru_metadata(
        mut self,
        raw_type: Option<String>,
        sub_type: Option<String>,
        block_role: Option<String>,
    ) -> Self {
        self.raw_type = raw_type;
        self.sub_type = sub_type;
        self.block_role = block_role;
        self
    }

    pub fn with_mineru_metadata_fields(mut self, metadata: BTreeMap<String, String>) -> Self {
        self.mineru_metadata = metadata;
        self
    }

    pub fn with_relation_groups(
        mut self,
        continuation_group_id: Option<String>,
        visual_group_id: Option<String>,
    ) -> Self {
        self.continuation_group_id = continuation_group_id;
        self.visual_group_id = visual_group_id;
        self
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SegmentType {
    Paragraph,
    Heading,
    Table,
    Math,
    Figure,
    Code,
    List,
    PageHeader,
    PageFooter,
    PageNumber,
    AsideText,
    PageFootnote,
}
