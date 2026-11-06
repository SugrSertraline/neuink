use std::{collections::BTreeMap, fs, io, sync::Mutex};
use neuink_domain::EntryId;
use serde::{Deserialize, Serialize};
use crate::{atomic_write_json, Workspace, WorkspaceError};

static LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct SavedSentenceTranslation {
    pub segment_uid: String,
    pub paragraph_source: String,
    pub source: String,
    pub source_start: usize,
    pub translation: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use neuink_domain::{SourceSegment, SegmentType};
    #[test]
    fn independent_sentence_roundtrip_and_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let entry = workspace.create_entry("Test").unwrap();
        let segment = SourceSegment::new(SegmentType::Paragraph, 0, None, "前缀。 First. Second.".into());
        workspace.write_segments(&entry.id, &[segment.clone()]).unwrap();
        let record = SavedSentenceTranslation { segment_uid: segment.uid.to_string(), paragraph_source: segment.text.clone(),
            source: "First.".into(), source_start: "前缀。 ".len(), translation: "第一句。".into() };
        workspace.save_sentence_translation(&entry.id, record.clone(), None).unwrap();
        assert_eq!(workspace.read_sentence_translations(&entry.id).unwrap().values().next(), Some(&record));
        assert!(workspace.save_sentence_translation(&entry.id, record.clone(), None).is_err());
        let mut changed = record.clone(); changed.translation = "新译文。".into();
        workspace.save_sentence_translation(&entry.id, changed.clone(), Some(record.translation.clone())).unwrap();
        changed.paragraph_source = "过期原文".into();
        assert!(workspace.save_sentence_translation(&entry.id, changed, Some("新译文。".into())).is_err());
        assert!(workspace.read_entry_translation(&entry.id).unwrap().is_none());
    }
}
impl Workspace {
    pub fn read_sentence_translations(&self, entry: &EntryId) -> Result<BTreeMap<String, SavedSentenceTranslation>, WorkspaceError> {
        self.read_entry(entry)?;
        let path = self.layout().entry_dir(entry).join("paper.sentence-translations.json");
        if !path.exists() { return Ok(BTreeMap::new()); }
        Ok(serde_json::from_slice(&fs::read(path)?)?)
    }
    pub fn save_sentence_translation(&self, entry: &EntryId, record: SavedSentenceTranslation,
        expected: Option<String>) -> Result<(), WorkspaceError> {
        let _guard = LOCK.lock().unwrap_or_else(|error| error.into_inner());
        let invalid = || WorkspaceError::from(io::Error::new(io::ErrorKind::InvalidInput, "原文或已有单句译文已变化，请重新打开后重试。"));
        let segments = self.read_segments(entry)?;
        let segment = segments.iter().find(|item| item.uid.as_str() == record.segment_uid).ok_or_else(invalid)?;
        let source = segment.markdown.as_deref().unwrap_or(&segment.text);
        let start = record.source_start;
        if source != record.paragraph_source || record.source.trim().is_empty() || record.translation.trim().is_empty()
            || record.translation.len() > 200_000 || source.get(start..).is_none_or(|text| !text.starts_with(&record.source)) {
            return Err(invalid());
        }
        let mut records = self.read_sentence_translations(entry)?;
        let key = format!("{}:{}", record.segment_uid, start);
        if records.get(&key).filter(|old| old.paragraph_source == record.paragraph_source)
            .map(|old| old.translation.clone()) != expected { return Err(invalid()); }
        records.insert(key, record);
        atomic_write_json(self.layout().entry_dir(entry).join("paper.sentence-translations.json"), &records)
    }
}
