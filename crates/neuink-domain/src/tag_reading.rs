use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{EntryId, NoteTarget, ReadingAuxiliaryView, TagId};

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TagMemberStatus {
    #[default]
    Unread,
    Reading,
    Done,
    Skipped,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct TagMemberReadingState {
    pub status: TagMemberStatus,
    pub order: u32,
    pub updated_at: DateTime<Utc>,
}

/// Membership remains derived from tags. This file holds only user task state.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct TagReadingWorkspace {
    pub version: u16,
    pub revision: u64,
    pub tag_id: TagId,
    pub include_descendants: bool,
    pub active_entry_id: Option<EntryId>,
    pub compare_entry_id: Option<EntryId>,
    #[serde(default)]
    pub active_note: Option<NoteTarget>,
    #[serde(default)]
    pub auxiliary_view: ReadingAuxiliaryView,
    pub queue_collapsed: bool,
    pub split_ratio: f64,
    pub member_states: BTreeMap<EntryId, TagMemberReadingState>,
    pub updated_at: DateTime<Utc>,
}

impl TagReadingWorkspace {
    pub fn new(tag_id: TagId) -> Self {
        Self {
            version: 1,
            revision: 0,
            tag_id,
            include_descendants: true,
            active_entry_id: None,
            compare_entry_id: None,
            active_note: None,
            auxiliary_view: ReadingAuxiliaryView::Compare,
            queue_collapsed: false,
            split_ratio: 0.5,
            member_states: BTreeMap::new(),
            updated_at: Utc::now(),
        }
    }
}
