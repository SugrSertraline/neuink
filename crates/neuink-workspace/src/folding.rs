use std::{
    collections::{BTreeMap, HashMap},
    fs, io,
    sync::Mutex,
};

use neuink_domain::{EntryId, SegmentType, SourceSegment};
use serde::{Deserialize, Serialize};

use crate::{atomic_write_json, Workspace, WorkspaceError};

static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct FoldRecord {
    pub segment_uid: String,
    pub source: String,
    pub evidence: Vec<usize>,
    pub brief: Vec<String>,
    pub key: String,
    pub takeaway: String,
    pub topic: String,
    pub model: String,
    pub generated_at: String,
    #[serde(default)]
    pub translations: BTreeMap<String, FoldTranslation>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct FoldTranslation {
    pub source_text: String,
    pub translated_text: String,
    pub model: String,
    pub generated_at: String,
}

fn level_text(record: &FoldRecord, level: &str) -> Option<String> {
    match level {
        "brief" => Some(record.brief.join(" ")),
        "key" => Some(record.key.clone()),
        "takeaway" => Some(record.takeaway.clone()),
        "topic" => Some(record.topic.clone()),
        _ => None,
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct FoldFile {
    version: u32,
    records: BTreeMap<String, FoldRecord>,
}

fn invalid(message: &str) -> WorkspaceError {
    io::Error::new(io::ErrorKind::InvalidInput, message).into()
}

fn eligible(segment: &SourceSegment) -> bool {
    let markup = segment.markdown.as_deref().unwrap_or(&segment.text);
    segment.segment_type == SegmentType::Paragraph
        && segment.continuation_group_id.is_none()
        && segment.asset_path.is_none()
        && segment
            .block_role
            .as_deref()
            .map(|role| role == "body")
            .unwrap_or(true)
        && !markup.contains('$')
        && !markup.contains("\\(")
        && !markup.contains("\\[")
        && !markup.to_lowercase().contains("<math")
        && segment.markdown.as_deref().map_or(true, |markdown| {
            !markdown.contains(['*', '_', '`', '<']) && !markdown.contains("](")
        })
}

fn valid_record(record: &FoldRecord) -> bool {
    if record.segment_uid.is_empty()
        || record.source.trim().is_empty()
        || record.source.chars().count() > 7_500
        || record.evidence.is_empty()
        || record.evidence.len() > 3
        || record.evidence.len() != record.brief.len()
        || record.evidence.windows(2).any(|pair| pair[0] >= pair[1])
        || record.key.trim().is_empty()
        || record.takeaway.trim().is_empty()
        || record.topic.trim().is_empty()
        || !record.key.starts_with(&record.takeaway)
        || !record.takeaway.contains(&record.topic)
        || record.model.trim().is_empty()
        || record.generated_at.trim().is_empty()
    {
        return false;
    }
    let mut remaining = record.source.as_str();
    for phrase in &record.brief {
        if phrase.trim().is_empty() {
            return false;
        }
        match remaining.find(phrase) {
            Some(index) => remaining = &remaining[index + phrase.len()..],
            None => return false,
        }
    }
    true
}

impl Workspace {
    fn read_fold_file(&self, entry_id: &EntryId) -> Result<FoldFile, WorkspaceError> {
        self.read_entry(entry_id)?;
        let path = self.layout().entry_dir(entry_id).join("paper.folds.json");
        if !path.exists() {
            return Ok(FoldFile {
                version: 1,
                records: BTreeMap::new(),
            });
        }
        let file: FoldFile = serde_json::from_slice(&fs::read(path)?)?;
        if file.version != 1 {
            return Err(invalid("不支持的阅读详略数据版本"));
        }
        Ok(file)
    }

    /// Results from changed, ambiguous, or non-paragraph source segments cannot be reused.
    pub fn read_entry_folds(
        &self,
        entry_id: &EntryId,
    ) -> Result<BTreeMap<String, FoldRecord>, WorkspaceError> {
        let mut records = self.read_fold_file(entry_id)?.records;
        let mut sources: HashMap<String, Option<String>> = HashMap::new();
        for segment in self.read_segments(entry_id)? {
            let uid = segment.uid.to_string();
            let source = eligible(&segment).then(|| segment.text.trim().to_string());
            sources
                .entry(uid)
                .and_modify(|value| *value = None)
                .or_insert(source);
        }
        records.retain(|uid, record| {
            uid == &record.segment_uid
                && valid_record(record)
                && sources
                    .get(uid)
                    .and_then(|value| value.as_ref())
                    .is_some_and(|source| source == &record.source)
        });
        for record in records.values_mut() {
            let snapshot = record.clone();
            record.translations.retain(|level, translation| {
                level_text(&snapshot, level).as_deref() == Some(translation.source_text.as_str())
                    && !translation.translated_text.trim().is_empty()
            });
        }
        Ok(records)
    }

    /// Merge a batch atomically, rejecting results produced from an older source.
    pub fn upsert_entry_folds(
        &self,
        entry_id: &EntryId,
        updates: Vec<FoldRecord>,
    ) -> Result<(), WorkspaceError> {
        let _guard = WRITE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        let mut file = self.read_fold_file(entry_id)?;
        let segments = self.read_segments(entry_id)?;
        for record in &updates {
            if !valid_record(record) {
                return Err(invalid("阅读详略结果或原文依据无效"));
            }
            let matches: Vec<_> = segments
                .iter()
                .filter(|segment| segment.uid.as_str() == record.segment_uid)
                .collect();
            if matches.len() != 1 {
                return Err(invalid("原文片段不存在或不唯一"));
            }
            let segment = matches[0];
            if !eligible(segment) || segment.text.trim() != record.source {
                return Err(invalid("原文片段已变化或不适合折叠"));
            }
        }
        for mut record in updates {
            if let Some(previous) = file.records.get(&record.segment_uid) {
                if previous.source == record.source {
                    let snapshot = record.clone();
                    record.translations = previous
                        .translations
                        .iter()
                        .filter(|(level, translation)| {
                            level_text(&snapshot, level).as_deref()
                                == Some(translation.source_text.as_str())
                        })
                        .map(|(key, value)| (key.clone(), value.clone()))
                        .collect();
                }
            }
            file.records.insert(record.segment_uid.clone(), record);
        }
        atomic_write_json(
            self.layout().entry_dir(entry_id).join("paper.folds.json"),
            &file,
        )
    }

    pub fn save_fold_translation(
        &self,
        entry_id: &EntryId,
        segment_uid: &str,
        level: &str,
        translation: FoldTranslation,
    ) -> Result<(), WorkspaceError> {
        let _guard = WRITE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        let current = self.read_entry_folds(entry_id)?;
        let record = current
            .get(segment_uid)
            .ok_or_else(|| invalid("原文已变化，请重新生成阅读详略"))?;
        if level_text(record, level).as_deref() != Some(translation.source_text.as_str())
            || translation.translated_text.trim().is_empty()
            || translation.translated_text.len() > 120_000
            || translation.model.trim().is_empty()
            || translation.generated_at.trim().is_empty()
        {
            return Err(invalid("详略内容已变化或译文无效"));
        }
        let mut file = self.read_fold_file(entry_id)?;
        let saved = file
            .records
            .get_mut(segment_uid)
            .ok_or_else(|| invalid("阅读详略不存在"))?;
        saved.translations.insert(level.to_string(), translation);
        atomic_write_json(
            self.layout().entry_dir(entry_id).join("paper.folds.json"),
            &file,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use neuink_domain::{SegmentType, SourceSegment};
    use tempfile::tempdir;

    #[test]
    fn preserves_rich_paragraph_formatting() {
        let mut segment =
            SourceSegment::new(SegmentType::Paragraph, 0, None, "Important finding.".into());
        assert!(eligible(&segment));
        segment.markdown = Some("**Important** finding.".into());
        assert!(!eligible(&segment));
        segment.markdown = Some("[Important](https://example.com) finding.".into());
        assert!(!eligible(&segment));
    }

    #[test]
    fn translation_requires_current_level_and_survives_unchanged_regeneration() {
        let dir = tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let entry = workspace.create_entry("Paper").unwrap();
        let segment = SourceSegment::new(SegmentType::Paragraph, 0, None, "First. Second.".into());
        workspace
            .write_segments(&entry.id, &[segment.clone()])
            .unwrap();
        let mut record = FoldRecord {
            segment_uid: segment.uid.to_string(),
            source: segment.text.clone(),
            evidence: vec![0],
            brief: vec!["First.".into()],
            key: "First. Reason.".into(),
            takeaway: "First.".into(),
            topic: "First".into(),
            model: "test".into(),
            generated_at: "2026-01-01".into(),
            translations: BTreeMap::new(),
        };
        workspace
            .upsert_entry_folds(&entry.id, vec![record.clone()])
            .unwrap();
        let translation = FoldTranslation {
            source_text: "First.".into(),
            translated_text: "第一。".into(),
            model: "translation".into(),
            generated_at: "2026-01-01".into(),
        };
        workspace
            .save_fold_translation(
                &entry.id,
                &record.segment_uid,
                "takeaway",
                translation.clone(),
            )
            .unwrap();
        assert!(workspace
            .save_fold_translation(&entry.id, &record.segment_uid, "key", translation.clone())
            .is_err());
        workspace
            .upsert_entry_folds(&entry.id, vec![record.clone()])
            .unwrap();
        assert_eq!(
            workspace.read_entry_folds(&entry.id).unwrap()[&record.segment_uid].translations
                ["takeaway"],
            translation
        );
        record.takeaway = "Second.".into();
        record.topic = "Second".into();
        record.key = "Second. Reason.".into();
        workspace
            .upsert_entry_folds(&entry.id, vec![record.clone()])
            .unwrap();
        assert!(
            workspace.read_entry_folds(&entry.id).unwrap()[&record.segment_uid]
                .translations
                .is_empty()
        );
        assert!(workspace
            .save_fold_translation(&entry.id, &record.segment_uid, "takeaway", translation)
            .is_err());
    }

    #[test]
    fn preserves_existing_results_and_refuses_stale_or_fabricated_source() {
        let dir = tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let entry = workspace.create_entry("Paper").unwrap();
        let first = SourceSegment::new(
            SegmentType::Paragraph,
            0,
            None,
            "First. Second.".to_string(),
        );
        let mut record = FoldRecord {
            segment_uid: first.uid.to_string(),
            source: first.text.clone(),
            evidence: vec![0],
            brief: vec!["First.".into()],
            key: "First. Reason.".into(),
            takeaway: "First.".into(),
            topic: "First".into(),
            model: "test".into(),
            generated_at: "2026-01-01".into(),
            translations: BTreeMap::new(),
        };
        workspace
            .write_segments(&entry.id, &[first.clone()])
            .unwrap();
        workspace
            .upsert_entry_folds(&entry.id, vec![record.clone()])
            .unwrap();
        assert_eq!(
            workspace
                .read_entry_folds(&entry.id)
                .unwrap()
                .get(&record.segment_uid),
            Some(&record)
        );
        record.brief = vec!["Invented.".into()];
        assert!(workspace
            .upsert_entry_folds(&entry.id, vec![record.clone()])
            .is_err());
        assert_eq!(workspace.read_entry_folds(&entry.id).unwrap().len(), 1);
        let mut changed = first;
        changed.text = "Changed.".into();
        workspace.write_segments(&entry.id, &[changed]).unwrap();
        assert!(workspace.read_entry_folds(&entry.id).unwrap().is_empty());
        assert!(workspace
            .upsert_entry_folds(&entry.id, vec![record])
            .is_err());
    }
}
