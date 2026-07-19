use neuink_domain::{EntryId, NoteId, SegmentUid, TagId};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SearchDocument {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub source: SearchDocumentSource,
    pub target: SearchTarget,
    pub title: String,
    pub sections: Vec<SearchTextSection>,
    pub boost: f32,
}

impl SearchDocument {
    pub fn text_for_snippet(&self) -> String {
        self.sections
            .iter()
            .find(|section| section.label == "body" && !section.text.trim().is_empty())
            .or_else(|| {
                self.sections
                    .iter()
                    .find(|section| !section.text.trim().is_empty())
            })
            .map(|section| section.text.clone())
            .unwrap_or_else(|| self.title.clone())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SearchTextSection {
    pub label: String,
    pub text: String,
    pub boost: f32,
}

impl SearchTextSection {
    pub fn title(text: impl Into<String>) -> Self {
        Self {
            label: "title".to_string(),
            text: text.into(),
            boost: 2.4,
        }
    }

    pub fn body(text: impl Into<String>) -> Self {
        Self {
            label: "body".to_string(),
            text: text.into(),
            boost: 1.0,
        }
    }

    pub fn with_boost(label: impl Into<String>, text: impl Into<String>, boost: f32) -> Self {
        Self {
            label: label.into(),
            text: text.into(),
            boost,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct SearchDocumentSource {
    pub kind: SearchDocumentSourceKind,
    pub label: String,
    #[serde(default)]
    pub field_name: Option<String>,
    #[serde(default)]
    pub tag_id: Option<TagId>,
    #[serde(default)]
    pub note_id: Option<NoteId>,
    #[serde(default)]
    pub segment_uid: Option<SegmentUid>,
    #[serde(default)]
    pub page_idx: Option<u32>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchDocumentSourceKind {
    #[default]
    EntryTitle,
    EntryField,
    EntryTag,
    NoteTitle,
    NoteBody,
    SegmentNote,
    Annotation,
    PdfPage,
    Segment,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SearchTarget {
    Entry {
        entry_id: EntryId,
    },
    Note {
        entry_id: EntryId,
        note_id: NoteId,
    },
    Page {
        entry_id: EntryId,
        page_idx: u32,
    },
    Segment {
        entry_id: EntryId,
        segment_uid: SegmentUid,
        page_idx: u32,
    },
}

impl Default for SearchTarget {
    fn default() -> Self {
        Self::Entry {
            entry_id: EntryId::from_string(String::new()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SearchResults {
    pub query: String,
    pub mode: String,
    pub index_generation: u64,
    pub total_hit_count: usize,
    pub entries: Vec<SearchEntryGroup>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SearchEntryGroup {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub hit_count: usize,
    pub max_score: f32,
    pub hits: Vec<SearchHit>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SearchHit {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub source: SearchDocumentSource,
    pub target: SearchTarget,
    pub title: String,
    pub snippet: String,
    pub score: f32,
    pub matched_terms: Vec<String>,
}
