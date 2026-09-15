mod collect;
mod portable;

use super::{
    model::PreparedExport, resources, writers, PaperExportFormat, PaperExportInspection,
    PaperExportOptions,
};
use crate::{atomic_write, Workspace};
use neuink_domain::{EntryId, TagId};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{Cursor, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, ZipWriter};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ReadingExportKind {
    Note,
    SegmentNote,
    Annotation,
    Translation,
}

impl ReadingExportKind {
    fn prefix(self) -> &'static str {
        match self {
            Self::Note => "note:",
            Self::SegmentNote => "segment_note:",
            Self::Annotation => "annotation:",
            Self::Translation => "translation:",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Note => "文档笔记",
            Self::SegmentNote => "片段记录",
            Self::Annotation => "批注",
            Self::Translation => "片段译文",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ReadingExportItem {
    pub id: String,
    pub kind: ReadingExportKind,
    pub title: String,
    pub page: Option<u32>,
    pub note_id: Option<String>,
    pub preview: String,
    pub fingerprint: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ReadingExportCatalog {
    pub entry_title: String,
    pub items: Vec<ReadingExportItem>,
    pub scope_applied: bool,
}

#[derive(Debug, Deserialize)]
pub struct ReadingExportSelection {
    pub id: String,
    pub fingerprint: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ReadingExportFormat {
    Docx,
    Txt,
    TxtZip,
    DocxZip,
}

impl ReadingExportFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Docx => "docx",
            Self::Txt => "txt",
            _ => "zip",
        }
    }
    fn document(self) -> PaperExportFormat {
        match self {
            Self::Docx | Self::DocxZip => PaperExportFormat::Docx,
            _ => PaperExportFormat::Txt,
        }
    }
}

#[derive(Debug, Default, Deserialize)]
pub struct ReadingExportScope {
    pub kinds: Option<Vec<ReadingExportKind>>,
    pub item_ids: Option<Vec<String>>,
    pub segment_uids: Option<Vec<String>>,
}

pub struct ReadingExportRequest<'a> {
    pub selected: &'a [ReadingExportSelection],
    pub format: ReadingExportFormat,
    pub target: &'a Path,
    pub allow_incomplete: bool,
}

struct PreparedItem {
    item: ReadingExportItem,
    document: PreparedExport,
}

pub fn inspect(
    workspace: &Workspace,
    entry_id: &EntryId,
    note_id: Option<&str>,
) -> Result<ReadingExportCatalog, String> {
    inspect_scoped(workspace, entry_id, note_id, &ReadingExportScope::default())
}

pub fn inspect_scoped(
    workspace: &Workspace,
    entry_id: &EntryId,
    note_id: Option<&str>,
    scope: &ReadingExportScope,
) -> Result<ReadingExportCatalog, String> {
    let id = note_id.map(|id| format!("note:{id}"));
    let selected = id.as_deref().map(|id| BTreeSet::from([id]));
    let (entry_title, items) = collect::collect(workspace, entry_id, selected.as_ref(), scope)?;
    Ok(ReadingExportCatalog {
        entry_title,
        items: items.into_iter().map(|item| item.item).collect(),
        scope_applied: true,
    })
}

pub fn export(
    workspace: &Workspace,
    entry_id: &EntryId,
    request: ReadingExportRequest<'_>,
) -> Result<(), String> {
    export_collection(workspace, request, |ids| {
        collect::collect(
            workspace,
            entry_id,
            Some(ids),
            &ReadingExportScope::default(),
        )
    })
}

pub fn inspect_tag_notes(
    workspace: &Workspace,
    tag_id: &TagId,
    note_id: Option<&str>,
) -> Result<ReadingExportCatalog, String> {
    let id = note_id.map(|id| format!("note:{id}"));
    let selected = id.as_deref().map(|id| BTreeSet::from([id]));
    let (entry_title, items) = collect::collect_tag_notes(workspace, tag_id, selected.as_ref())?;
    Ok(ReadingExportCatalog {
        entry_title,
        items: items.into_iter().map(|item| item.item).collect(),
        scope_applied: true,
    })
}

pub fn export_tag_notes(
    workspace: &Workspace,
    tag_id: &TagId,
    request: ReadingExportRequest<'_>,
) -> Result<(), String> {
    export_collection(workspace, request, |ids| {
        collect::collect_tag_notes(workspace, tag_id, Some(ids))
    })
}

fn export_collection(
    workspace: &Workspace,
    request: ReadingExportRequest<'_>,
    collect_items: impl Fn(&BTreeSet<&str>) -> Result<(String, Vec<PreparedItem>), String>,
) -> Result<(), String> {
    if request.selected.is_empty() || request.selected.len() > 1000 {
        return Err("请勾选 1–1000 项阅读成果".into());
    }
    let ids: BTreeSet<_> = request
        .selected
        .iter()
        .map(|item| item.id.as_str())
        .collect();
    if ids.len() != request.selected.len() {
        return Err("导出选择包含重复项目，请重新选择".into());
    }
    let (title, items) = collect_items(&ids)?;
    verify_selection(&items, request.selected)?;
    if !request.allow_incomplete && items.iter().any(|item| !item.item.warnings.is_empty()) {
        return Err("所选内容存在待核对项，请确认保留提示后导出".into());
    }
    let target = resources::validate_target(
        workspace.layout().root(),
        request.target,
        request.format.extension(),
    )?;
    let bytes = match request.format {
        ReadingExportFormat::TxtZip | ReadingExportFormat::DocxZip => {
            write_package(&title, &items, request.format)?
        }
        _ => {
            let mut document = empty_document(
                title.clone(),
                format!("# {}\n\n", portable::literal(&title)),
            );
            for item in items {
                document.markdown.push_str(&item.document.markdown);
                document.markdown.push_str("\n\n---\n\n");
                for (reference, asset) in item.document.assets {
                    resources::insert_asset(&mut document.assets, &reference, asset)?;
                }
            }
            writers::write(&document, request.format.document())?
        }
    };
    // File generation may be slow. Never write a newer, unreviewed source snapshot.
    let (_, latest) = collect_items(&ids)?;
    verify_selection(&latest, request.selected)?;
    resources::validate_target(
        workspace.layout().root(),
        &target,
        request.format.extension(),
    )?;
    atomic_write(&target, &bytes).map_err(|error| error.to_string())
}

fn verify_selection(
    items: &[PreparedItem],
    selected: &[ReadingExportSelection],
) -> Result<(), String> {
    if items.len() != selected.len()
        || selected.iter().any(|selection| {
            !items.iter().any(|item| {
                item.item.id == selection.id && item.item.fingerprint == selection.fingerprint
            })
        })
    {
        return Err("所选内容、来源或图片已变化/删除，请刷新清单并重新确认后导出".into());
    }
    Ok(())
}

fn empty_document(title: String, markdown: String) -> PreparedExport {
    PreparedExport {
        title,
        markdown,
        assets: BTreeMap::new(),
        report: PaperExportInspection::new(0),
        options: PaperExportOptions::default(),
        diagram_sources: BTreeMap::new(),
        issue_content: BTreeMap::new(),
    }
}

fn write_package(
    title: &str,
    items: &[PreparedItem],
    format: ReadingExportFormat,
) -> Result<Vec<u8>, String> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let folder = portable::file_name(title);
    let mut index = format!("{title}\n\n共 {} 项；仅包含手动勾选的阅读成果及其引用文字。\n不含原 PDF、未选笔记、完整译稿、聊天记录、账号设置。\n页码为 PDF 物理页码；引用快照不代表最新原文。\nTXT 不含图片；Word 内嵌可用图片。公式与 Mermaid 保留源码。\n\n", items.len());
    for (order, item) in items.iter().enumerate() {
        let name = format!(
            "{:03}-{}-{}.{}",
            order + 1,
            item.item.kind.label(),
            portable::file_name(&item.item.title),
            format.document().extension()
        );
        index.push_str(&format!("{name}\n"));
        for warning in &item.item.warnings {
            index.push_str(&format!("  待核对：{warning}\n"));
        }
        zip.start_file(format!("{folder}/{name}"), options)
            .map_err(|error| error.to_string())?;
        zip.write_all(&writers::write(&item.document, format.document())?)
            .map_err(|error| error.to_string())?;
    }
    zip.start_file(format!("{folder}/索引.txt"), options)
        .map_err(|error| error.to_string())?;
    zip.write_all(index.as_bytes())
        .map_err(|error| error.to_string())?;
    Ok(zip
        .finish()
        .map_err(|error| error.to_string())?
        .into_inner())
}
