use neuink_domain::{deep_research::ResearchDocument, EntryId, NoteId};
use neuink_workspace::Workspace;
use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Selection {
    Entry {
        entry_id: String,
    },
    Note {
        entry_id: String,
        note_id: String,
    },
    Segment {
        entry_id: String,
        segment_uid: String,
    },
}
fn id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 100
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("资料标识无效".into());
    }
    Ok(())
}
pub fn freeze(ws: &Workspace, selected: &[Selection]) -> Result<Vec<ResearchDocument>, String> {
    if selected.len() > 10 {
        return Err("一次最多选择 10 份资料".into());
    }
    let mut documents = Vec::new();
    for selection in selected {
        let (Selection::Entry { entry_id }
        | Selection::Note { entry_id, .. }
        | Selection::Segment { entry_id, .. }) = selection;
        id(entry_id)?;
        let eid = EntryId::from_string(entry_id);
        let entry = ws
            .read_entry(&eid)
            .map_err(|_| "选中的条目不存在或已删除")?;
        let (key, level, text) = match selection {
            Selection::Entry { .. } => {
                let segments = ws.read_segments(&eid).map_err(|_| "读取论文正文失败")?;
                if segments.is_empty() {
                    let abstract_text = entry
                        .fields
                        .get("abstract")
                        .map(String::as_str)
                        .unwrap_or("");
                    if abstract_text.trim().is_empty() {
                        return Err(format!(
                            "「{}」没有可用正文或摘要，请先解析 PDF 或选择片段",
                            entry.title
                        ));
                    }
                    (entry_id.clone(), "abstract", abstract_text.to_owned())
                } else {
                    (
                        entry_id.clone(),
                        "parsed_text",
                        segments
                            .iter()
                            .map(|s| format!("[第 {} 页] {}", s.page_idx + 1, s.text))
                            .collect::<Vec<_>>()
                            .join("\n\n"),
                    )
                }
            }
            Selection::Note { note_id, .. } => {
                id(note_id)?;
                let note = ws
                    .read_note(&eid, &NoteId::from_string(note_id))
                    .map_err(|_| "所选笔记不可用")?;
                (format!("{entry_id}:{note_id}"), "user_note", note.markdown)
            }
            Selection::Segment { segment_uid, .. } => {
                let segments = ws.read_segments(&eid).map_err(|_| "读取片段失败")?;
                let segment = segments
                    .iter()
                    .find(|s| s.uid.as_str() == segment_uid)
                    .ok_or("选中的片段已失效")?;
                (
                    format!("{entry_id}:{segment_uid}"),
                    "selected_text",
                    format!("[第 {} 页] {}", segment.page_idx + 1, segment.text),
                )
            }
        };
        if documents.iter().any(|d: &ResearchDocument| d.id == key) {
            continue;
        }
        if text.trim().is_empty() {
            return Err("所选资料为空".into());
        }
        // Reject oversized scope explicitly; never silently pretend a prefix is the whole paper.
        if text.len() > 160_000
            || documents.iter().map(|d| d.text.len()).sum::<usize>() + text.len() > 512_000
        {
            return Err("所选资料较长，请缩小到相关片段或笔记（单份上限约 160 KB）".into());
        }
        documents.push(ResearchDocument {
            id: key,
            title: entry.title,
            evidence_level: level.into(),
            text,
        });
    }
    Ok(documents)
}
