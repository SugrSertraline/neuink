use super::{decode, entity, invalid, Exporter};
use crate::paragraph_translation::{ParagraphRequestStatus, ParagraphTranslation, TranslationPart};
use std::{collections::BTreeMap, io};

fn stored_part<T>(part: &mut TranslationPart<T>) {
    part.error = None;
    part.timing = None;
    part.status = if part.value.is_some() {
        ParagraphRequestStatus::Succeeded
    } else {
        ParagraphRequestStatus::Failed
    };
}

impl Exporter {
    pub(super) fn paragraph_translations(&mut self, entry_id: &str) -> io::Result<()> {
        let Some(bytes) = self.files.read_optional(&format!(
            "entries/{entry_id}/paper.paragraph-translations.json"
        ))?
        else {
            return Ok(());
        };
        let mut records: BTreeMap<String, ParagraphTranslation> = decode(&bytes)?;
        records.retain(|_, record| {
            record.paragraph.value.is_some() || record.sentences.value.is_some()
        });
        let mut resources = Vec::new();
        for (key, record) in &mut records {
            if key != record.segment_uid.as_str() || key.is_empty() {
                return Err(invalid("历史段落译文标识无效"));
            }
            record.job_id.clear();
            record.model.clear();
            stored_part(&mut record.paragraph);
            stored_part(&mut record.sentences);
            self.markdown_assets(entry_id, None, &record.source_text, &mut resources)?;
            if let Some(text) = &record.paragraph.value {
                self.markdown_assets(entry_id, None, text, &mut resources)?;
            }
            for sentence in record.sentences.value.iter().flatten() {
                self.markdown_assets(entry_id, None, &sentence.source, &mut resources)?;
                self.markdown_assets(entry_id, None, &sentence.translation, &mut resources)?;
            }
        }
        resources.push(self.files.generated(
            "paragraph-translations.json",
            serde_json::to_vec(&records).map_err(io::Error::other)?,
        ));
        let mut references = vec![entity("entry", entry_id)];
        if !records.is_empty() {
            references.push(entity("parse", entry_id));
        }
        self.document(entity("paragraph-translation", entry_id),
            neuink_sync_protocol::ObjectKind::Translation,
            serde_json::json!({"entry_id":entry_id,"content_resource":"paragraph-translations.json"}),
            resources, references)
    }
}
