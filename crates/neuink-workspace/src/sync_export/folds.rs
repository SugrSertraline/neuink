use super::{decode, entity, invalid, Exporter};
use crate::folding::FoldRecord;
use serde::Deserialize;
use std::{collections::BTreeMap, io};
#[derive(Deserialize)]
struct FoldFile {
    version: u32,
    records: BTreeMap<String, FoldRecord>,
}
impl Exporter {
    pub(super) fn folds(&mut self, entry_id: &str) -> io::Result<()> {
        let Some(bytes) = self
            .files
            .read_optional(&format!("entries/{entry_id}/paper.folds.json"))?
        else {
            return Ok(());
        };
        let file: FoldFile = decode(&bytes)?;
        if file.version != 1 {
            return Err(invalid("阅读详略版本不兼容"));
        }
        for (uid, record) in file.records {
            if uid.is_empty() || uid != record.segment_uid {
                return Err(invalid("阅读详略片段标识不一致"));
            }
            let mut resources = Vec::new();
            for text in [&record.source, &record.key, &record.takeaway, &record.topic]
                .into_iter()
                .chain(record.brief.iter())
                .chain(
                    record
                        .translations
                        .values()
                        .flat_map(|t| [&t.source_text, &t.translated_text]),
                )
            {
                self.markdown_assets(entry_id, None, text, &mut resources)?;
            }
            self.document(
                format!("fold:{entry_id}:{uid}"),
                neuink_sync_protocol::ObjectKind::Fold,
                serde_json::json!({"entry_id":entry_id,"record":record}),
                resources,
                vec![entity("entry", entry_id), entity("parse", entry_id)],
            )?;
        }
        Ok(())
    }
}
