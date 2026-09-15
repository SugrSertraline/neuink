//! Availability is a live projection. Saved evidence snapshots are never rewritten on deletion.
use crate::Workspace;
use neuink_domain::{EntryId, SegmentRef, SourceSegment};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourceStatus { Available, EntryTrashed, EntryDeleted, SegmentMissing, ContentChanged, Unavailable }

#[derive(Clone, Debug, Serialize)]
pub struct SourceAvailability {
    pub entry_id: EntryId,
    pub segment_uid: String,
    pub quote_hash: String,
    pub status: SourceStatus,
    pub message: String,
    pub can_locate: bool,
}

enum EntrySource { Segments(Vec<SourceSegment>), Missing(SourceStatus) }

impl Workspace {
    pub fn inspect_sources(&self, sources: &[SegmentRef]) -> Vec<SourceAvailability> {
        let mut cache = BTreeMap::new();
        sources.iter().map(|source| {
            let entry = cache.entry(source.entry_id.clone()).or_insert_with(|| {
                if crate::tag_reading::validate_id(source.entry_id.as_str()).is_err() {
                    return EntrySource::Missing(SourceStatus::Unavailable);
                }
                let path = self.layout().entry_dir(&source.entry_id);
                if self.validate_note_workspace_path(&path).is_err() {
                    return EntrySource::Missing(SourceStatus::Unavailable);
                }
                if !path.exists() {
                    return EntrySource::Missing(if self.layout().trashed_entry_dir(&source.entry_id).exists() {
                        SourceStatus::EntryTrashed
                    } else { SourceStatus::EntryDeleted });
                }
                if self.read_entry(&source.entry_id).is_err() {
                    return EntrySource::Missing(SourceStatus::Unavailable);
                }
                match self.read_segments(&source.entry_id) {
                    Ok(segments) => EntrySource::Segments(segments),
                    Err(_) => EntrySource::Missing(SourceStatus::Unavailable),
                }
            });
            let status = match entry {
                EntrySource::Missing(status) => status.clone(),
                EntrySource::Segments(segments) => match segments.iter().find(|segment|
                    segment.uid == source.segment_uid || segment.continuation_group_id.as_deref() == Some(source.segment_uid.as_str())) {
                    None => SourceStatus::SegmentMissing,
                    Some(segment) => {
                        let text = segment.markdown.as_deref().filter(|text| !text.trim().is_empty()).unwrap_or(&segment.text);
                        if !source.quote_hash.is_empty() && blake3::hash(text.as_bytes()).to_hex().as_str() != source.quote_hash {
                            SourceStatus::ContentChanged
                        } else { SourceStatus::Available }
                    }
                }
            };
            let message = match status {
                SourceStatus::Available => "原文可用",
                SourceStatus::EntryTrashed => "原论文已移入回收站",
                SourceStatus::EntryDeleted => "原论文已删除",
                SourceStatus::SegmentMissing => "原文段落已不存在",
                SourceStatus::ContentChanged => "原文内容已变化，保留引用时的快照",
                SourceStatus::Unavailable => "原论文暂时无法读取",
            }.to_owned();
            SourceAvailability { entry_id: source.entry_id.clone(), segment_uid: source.segment_uid.to_string(),
                quote_hash: source.quote_hash.clone(), can_locate: status == SourceStatus::Available, status, message }
        }).collect()
    }
}
