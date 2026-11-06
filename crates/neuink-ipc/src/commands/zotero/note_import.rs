use neuink_domain::EntryId;
use neuink_workspace::{source_notes::SourceNoteSelection, Workspace};
use neuink_zotero::{read_library, SourceSettings};
use serde_json::{json, Value};
use std::path::Path;

/// Read committed source data without requiring the Zotero process or writing its database.
pub(super) fn execute(root: &Path, source_entry: &EntryId, target: &EntryId, settings: &SourceSettings, selected: Option<&[SourceNoteSelection]>) -> Result<Value, String> {
    let workspace = Workspace::open_existing(root).map_err(|e| e.to_string())?;
    let library = read_library(settings).map_err(|e| e.to_string())?;
    let sources = workspace.zotero_sources(source_entry).map_err(|e| e.to_string())?;
    let origin = sources.iter().find(|source| source.source_id == library.source_id).ok_or("当前 Zotero 数据目录与来源条目不匹配，请检查设置。")?;
    let paper = library.papers.iter().find(|paper| paper.id == origin.item_id).ok_or("来源论文已不在当前 Zotero 列表中，未修改本地笔记。")?;
    match selected {
        Some(selected) => workspace.import_source_notes(&library.source_id, paper, target, selected).map(|result| json!(result)).map_err(|e| e.to_string()),
        None => workspace.source_note_candidates(&library.source_id, paper, target).map(|notes| json!({"notes": notes, "source_title": paper.title})).map_err(|e| e.to_string()),
    }
}
