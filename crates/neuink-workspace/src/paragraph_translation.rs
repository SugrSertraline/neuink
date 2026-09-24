use std::{collections::BTreeMap, fs, sync::Mutex};

use neuink_domain::{EntryId, SegmentUid};
use serde::{Deserialize, Serialize};

use crate::{atomic_write_json, Workspace, WorkspaceError};

static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ParagraphView {
    Paragraph,
    Sentences,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ParagraphRequestStatus {
    Running,
    Succeeded,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TranslationPart<T> {
    pub status: ParagraphRequestStatus,
    pub value: Option<T>,
    pub error: Option<String>,
    #[serde(default)]
    pub timing: Option<TranslationTiming>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct TranslationTiming {
    pub queued_ms: u64,
    pub rate_limit_ms: u64,
    pub generation_ms: u64,
    pub total_ms: u64,
}

impl<T> Default for TranslationPart<T> {
    fn default() -> Self {
        Self {
            status: ParagraphRequestStatus::Running,
            value: None,
            error: None,
            timing: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct SentenceTranslation {
    pub id: usize,
    pub source: String,
    pub translation: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ParagraphTranslation {
    pub segment_uid: SegmentUid,
    pub source_text: String,
    pub source_hash: String,
    pub job_id: String,
    pub model: String,
    pub view: ParagraphView,
    pub paragraph: TranslationPart<String>,
    pub sentences: TranslationPart<Vec<SentenceTranslation>>,
}

impl Workspace {
    pub fn read_paragraph_translations(
        &self,
        entry_id: &EntryId,
    ) -> Result<BTreeMap<String, ParagraphTranslation>, WorkspaceError> {
        self.read_entry(entry_id)?;
        let path = self
            .layout()
            .entry_dir(entry_id)
            .join("paper.paragraph-translations.json");
        if !path.exists() {
            return Ok(BTreeMap::new());
        }
        Ok(serde_json::from_slice(&fs::read(path)?)?)
    }

    /// Serialize read-modify-write across both request completions and view changes.
    pub fn update_paragraph_translation(
        &self,
        entry_id: &EntryId,
        segment_uid: &SegmentUid,
        update: impl FnOnce(
            Option<ParagraphTranslation>,
        ) -> Result<ParagraphTranslation, WorkspaceError>,
    ) -> Result<ParagraphTranslation, WorkspaceError> {
        let _guard = WRITE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        let mut records = self.read_paragraph_translations(entry_id)?;
        let record = update(records.remove(segment_uid.as_str()))?;
        records.insert(segment_uid.to_string(), record.clone());
        atomic_write_json(
            self.layout()
                .entry_dir(entry_id)
                .join("paper.paragraph-translations.json"),
            &records,
        )?;
        Ok(record)
    }
}
