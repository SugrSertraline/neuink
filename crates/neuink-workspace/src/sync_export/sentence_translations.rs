use super::{decode, entity, invalid, Exporter};
use crate::sentence_translation::SavedSentenceTranslation;
use std::{collections::BTreeMap, io};

impl Exporter {
    pub(super) fn sentence_translations(&mut self, entry_id: &str) -> io::Result<()> {
        let Some(bytes) = self.files.read_optional(&format!(
            "entries/{entry_id}/paper.sentence-translations.json"
        ))?
        else {
            return Ok(());
        };
        let records: BTreeMap<String, SavedSentenceTranslation> = decode(&bytes)?;
        let mut resources = Vec::new();
        for (key, record) in &records {
            if key != &format!("{}:{}", record.segment_uid, record.source_start)
                || record.segment_uid.is_empty()
                || record.source.trim().is_empty()
                || record.translation.trim().is_empty()
                || record.translation.len() > 200_000
                || record
                    .paragraph_source
                    .get(record.source_start..)
                    .is_none_or(|text| !text.starts_with(&record.source))
            {
                return Err(invalid("单句译文标识或原文范围无效"));
            }
            self.markdown_assets(entry_id, None, &record.paragraph_source, &mut resources)?;
            self.markdown_assets(entry_id, None, &record.translation, &mut resources)?;
        }
        resources.push(self.files.generated(
            "sentence-translations.json",
            serde_json::to_vec(&records).map_err(io::Error::other)?,
        ));
        let mut references = vec![entity("entry", entry_id)];
        if !records.is_empty() {
            references.push(entity("parse", entry_id));
        }
        self.document(
            entity("sentence-translation", entry_id),
            neuink_sync_protocol::ObjectKind::Translation,
            serde_json::json!({"entry_id":entry_id,"content_resource":"sentence-translations.json"}),
            resources,
            references,
        )
    }
}
