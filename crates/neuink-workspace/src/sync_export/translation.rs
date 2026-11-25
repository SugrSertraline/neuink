use super::{decode, entity, invalid, Exporter};
use crate::{EntryTranslation, TranslatedSegmentStatus, TranslationProgress, TranslationStatus};
use std::{collections::BTreeSet, io};
impl Exporter {
    pub(super) fn translation(&mut self, entry_id: &str) -> io::Result<()> {
        let Some(bytes) = self
            .files
            .read_optional(&format!("entries/{entry_id}/paper.translation.json"))?
        else {
            return Ok(());
        };
        let mut value: EntryTranslation = decode(&bytes)?;
        if value.entry_id.as_str() != entry_id || value.schema_version != 1 {
            return Err(invalid("译文归属或版本无效"));
        }
        value.task = None;
        value.error = None;
        let mut resources = Vec::new();
        let mut seen = BTreeSet::new();
        let mut translated = 0;
        let mut skipped = 0;
        for segment in &mut value.segments {
            if segment.segment_uid.as_str().is_empty()
                || !seen.insert(segment.segment_uid.to_string())
            {
                return Err(invalid("译文片段标识为空或重复"));
            }
            segment.error = None;
            if segment
                .translated_text
                .as_ref()
                .is_some_and(|text| !text.trim().is_empty())
            {
                segment.status = TranslatedSegmentStatus::Translated;
                translated += 1;
            } else if matches!(segment.status, TranslatedSegmentStatus::Skipped) {
                skipped += 1;
            } else {
                segment.status = TranslatedSegmentStatus::Pending;
            }
            self.markdown_assets(entry_id, None, &segment.source_text, &mut resources)?;
            if let Some(text) = &segment.translated_text {
                self.markdown_assets(entry_id, None, text, &mut resources)?;
            }
        }
        value.status = if translated + skipped == value.segments.len() {
            TranslationStatus::Succeeded
        } else {
            TranslationStatus::Partial
        };
        value.progress = TranslationProgress {
            total: value.segments.len(),
            translated,
            skipped,
            failed: 0,
        };
        resources.push(self.files.generated(
            "translation.json",
            serde_json::to_vec(&value).map_err(io::Error::other)?,
        ));
        let mut refs = vec![entity("entry", entry_id)];
        if value.segments.iter().any(|s| {
            !s.segment_uid
                .as_str()
                .starts_with(crate::pdf_text::PDF_TEXT_PREFIX)
        }) {
            refs.push(entity("parse", entry_id));
        }
        self.document(
            entity("translation", entry_id),
            neuink_sync_protocol::ObjectKind::Translation,
            serde_json::json!({"entry_id":entry_id,"content_resource":"translation.json"}),
            resources,
            refs,
        )
    }
}
