use serde::{Deserialize, Serialize};

use crate::SourceSegment;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct NeuinkDocument {
    pub schema_version: u16,
    pub segments: Vec<SourceSegment>,
}

impl NeuinkDocument {
    pub fn new(segments: Vec<SourceSegment>) -> Self {
        Self {
            schema_version: 1,
            segments,
        }
    }
}
