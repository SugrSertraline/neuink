use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::SegmentUid;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SegmentBlockNote {
    pub segment_uid: SegmentUid,
    pub text: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl SegmentBlockNote {
    pub fn new(segment_uid: SegmentUid, text: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            segment_uid,
            text: text.into(),
            created_at: now,
            updated_at: now,
        }
    }

    pub fn update_text(&mut self, text: impl Into<String>) {
        self.text = text.into();
        self.updated_at = Utc::now();
    }
}
