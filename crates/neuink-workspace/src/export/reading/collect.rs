use super::{
    empty_document, portable, PreparedItem, ReadingExportItem, ReadingExportKind,
    ReadingExportScope,
};
use crate::{
    export::{
        prepare::{source_text, translation_source_hash},
        resources, word_text,
    },
    TranslatedSegmentStatus, Workspace,
};
use neuink_domain::{ContentItem, EntryId, TagId};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

pub(super) fn collect(
    workspace: &Workspace,
    entry_id: &EntryId,
    selected: Option<&BTreeSet<&str>>,
    scope: &ReadingExportScope,
) -> Result<(String, Vec<PreparedItem>), String> {
    if !portable::valid_id(entry_id.as_str()) {
        return Err("条目标识无效".into());
    }
    let root = workspace
        .layout()
        .root()
        .canonicalize()
        .map_err(|_| "资料库不可用")?;
    let entry_root = workspace
        .layout()
        .entry_dir(entry_id)
        .canonicalize()
        .map_err(|_| "条目目录不存在")?;
    if !entry_root.starts_with(root.join("entries")) {
        return Err("条目目录越过资料库边界".into());
    }
    let entry = workspace
        .read_entry(entry_id)
        .map_err(|error| error.to_string())?;
    let entry_label = portable::entry_label(&entry);
    let mut result = Vec::new();
    let wants = |id: &str| {
        selected.is_none_or(|ids| ids.contains(id))
            && scope
                .item_ids
                .as_ref()
                .is_none_or(|ids| ids.iter().any(|item| item == id))
    };
    let category = |kind: &str| {
        selected.is_none_or(|ids| ids.iter().any(|id| id.starts_with(kind)))
            && scope
                .item_ids
                .as_ref()
                .is_none_or(|ids| ids.iter().any(|id| id.starts_with(kind)))
            && scope
                .kinds
                .as_ref()
                .is_none_or(|kinds| kinds.iter().any(|item| item.prefix() == kind))
            && (kind != "note:" || scope.segment_uids.is_none())
    };
    if category("note:") {
        for ContentItem::Note { note_id, .. } in &entry.contents {
            let id = format!("note:{note_id}");
            if !wants(&id) {
                continue;
            }
            if !portable::valid_id(note_id.as_str()) {
                return Err("笔记标识无效".into());
            }
            let path = workspace
                .layout()
                .entry_note_file(entry_id, note_id)
                .canonicalize()
                .map_err(|_| "笔记文件缺失，请恢复后刷新清单")?;
            if !path.starts_with(&entry_root) {
                return Err("笔记文件越过条目目录边界".into());
            }
            let note = workspace
                .read_note(entry_id, note_id)
                .map_err(|error| error.to_string())?;
            let mut warnings = Vec::new();
            let body = portable::note_body(workspace, &note, &mut warnings);
            result.push(prepare_item(
                ItemInput {
                    id,
                    kind: ReadingExportKind::Note,
                    title: note.title,
                    page: None,
                    note_id: Some(note_id.to_string()),
                    body,
                    warnings,
                },
                &entry_label,
                &workspace.layout().entry_notes_dir(entry_id),
            )?);
        }
    }
    let fragments =
        category("segment_note:") || category("annotation:") || category("translation:");
    let segments = if fragments {
        workspace
            .read_segments(entry_id)
            .map_err(|error| error.to_string())?
    } else {
        Vec::new()
    };
    let segment_by_id: BTreeMap<_, _> = segments
        .iter()
        .map(|segment| (segment.uid.as_str(), segment))
        .collect();
    let assets_root = workspace.layout().entry_mineru_output_dir(entry_id);
    let wants_segment = |uid: &str| {
        scope.segment_uids.as_ref().is_none_or(|ids| {
            ids.iter().any(|id| {
                id == uid
                    || segment_by_id
                        .get(uid)
                        .is_some_and(|segment| segment.continuation_group_id.as_ref() == Some(id))
            })
        })
    };
    if category("segment_note:") {
        for note in workspace
            .read_segment_notes(entry_id)
            .map_err(|error| error.to_string())?
        {
            let id = format!("segment_note:{}", note.segment_uid);
            if !wants(&id)
                || !wants_segment(note.segment_uid.as_str())
                || note.text.trim().is_empty()
            {
                continue;
            }
            let source = segment_by_id.get(note.segment_uid.as_str());
            let page = source.map(|source| source.page_idx.saturating_add(1));
            let warnings = if source.is_none() {
                vec!["原片段已不可用，仅保留片段记录".into()]
            } else {
                Vec::new()
            };
            let mut body = format!("### 片段记录\n\n{}\n", note.text);
            if let Some(source) = source {
                body.push_str(&format!(
                    "\n### 关联原文（当前解析）\n\n{}\n",
                    source_text(source)
                ));
            }
            result.push(prepare_item(
                ItemInput {
                    id,
                    kind: ReadingExportKind::SegmentNote,
                    title: format!("片段记录 {}", page_label(page)),
                    page,
                    note_id: None,
                    body,
                    warnings,
                },
                &entry_label,
                &assets_root,
            )?);
        }
    }
    if category("annotation:") {
        for annotation in workspace
            .read_annotations(entry_id)
            .map_err(|error| error.to_string())?
        {
            let id = format!("annotation:{}", annotation.annotation_id);
            if !wants(&id) || !wants_segment(annotation.segment_uid.as_str()) {
                continue;
            }
            let source = segment_by_id.get(annotation.segment_uid.as_str());
            let snapshot = annotation.segment_snapshot.as_ref();
            let page = annotation
                .text_selection
                .as_ref()
                .map(|selection| selection.page_idx)
                .or_else(|| snapshot.map(|snapshot| snapshot.page_idx))
                .or_else(|| source.map(|source| source.page_idx))
                .map(|page| page.saturating_add(1));
            let quote = annotation
                .text_selection
                .as_ref()
                .map(|selection| selection.text.as_str())
                .or_else(|| snapshot.map(|snapshot| snapshot.text.as_str()))
                .or_else(|| source.map(|source| source_text(source)));
            let mut warnings = Vec::new();
            if quote.is_none() {
                warnings.push("批注的原文和快照均已不可用".into());
            }
            let body = format!("### 批注\n\n{}\n\n类型：{} · 重要程度：{}\n\n### 引用文字（保存的选择/快照）\n\n{}\n",
                annotation.content, portable::literal(&annotation.kind),
                match annotation.importance { neuink_domain::AnnotationImportance::Core => "核心", neuink_domain::AnnotationImportance::Important => "重要", neuink_domain::AnnotationImportance::Normal => "一般" },
                portable::literal(quote.unwrap_or("原文缺失")));
            result.push(prepare_item(
                ItemInput {
                    id,
                    kind: ReadingExportKind::Annotation,
                    title: format!("批注 {}", page_label(page)),
                    page,
                    note_id: None,
                    body,
                    warnings,
                },
                &entry_label,
                &assets_root,
            )?);
        }
    }
    if category("translation:") {
        if let Some(translation) = workspace
            .read_entry_translation(entry_id)
            .map_err(|error| error.to_string())?
        {
            if translation.entry_id != *entry_id {
                return Err("译文与当前条目不匹配".into());
            }
            for translation in translation.segments {
                let id = format!("translation:{}", translation.segment_uid);
                if !wants(&id)
                    || !wants_segment(translation.segment_uid.as_str())
                    || !matches!(translation.status, TranslatedSegmentStatus::Translated)
                {
                    continue;
                }
                let Some(text) = translation
                    .translated_text
                    .as_deref()
                    .filter(|text| !text.trim().is_empty())
                else {
                    continue;
                };
                let source = segment_by_id.get(translation.segment_uid.as_str());
                let mut warnings = Vec::new();
                if source.is_none_or(|source| {
                    translation.source_hash != translation_source_hash(source_text(source))
                        || translation.source_text != source_text(source)
                }) {
                    warnings
                        .push("译文对应旧版或已删除原文，以下保留翻译时的原文快照，请核对".into());
                }
                let page = Some(translation.page_idx.saturating_add(1));
                let body = format!(
                    "### 已保存译文\n\n{text}\n\n### 翻译时的原文\n\n{}\n",
                    translation.source_text
                );
                result.push(prepare_item(
                    ItemInput {
                        id,
                        kind: ReadingExportKind::Translation,
                        title: format!("片段译文 {}", page_label(page)),
                        page,
                        note_id: None,
                        body,
                        warnings,
                    },
                    &entry_label,
                    &assets_root,
                )?);
            }
        }
    }
    let ids: BTreeSet<_> = result.iter().map(|item| &item.item.id).collect();
    if ids.len() != result.len() {
        return Err("阅读成果存在重复标识，请修复数据后重试".into());
    }
    if result.len() > 1000
        || result
            .iter()
            .map(|item| item.document.markdown.len())
            .sum::<usize>()
            > 32 * 1024 * 1024
    {
        return Err(
            "阅读成果超过单次导出限制（1000 项 / 32 MB 文字），请从单篇笔记导出或拆分条目".into(),
        );
    }
    if result
        .iter()
        .flat_map(|item| item.document.assets.values())
        .map(|asset| asset.png.len())
        .sum::<usize>()
        > 192 * 1024 * 1024
    {
        return Err("所选图片总量超过 192 MB，请拆分导出".into());
    }
    Ok((entry.title, result))
}

pub(super) fn collect_tag_notes(
    workspace: &Workspace,
    tag_id: &TagId,
    selected: Option<&BTreeSet<&str>>,
) -> Result<(String, Vec<PreparedItem>), String> {
    let title = workspace
        .list_tags()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|tag| &tag.id == tag_id)
        .ok_or("标签不存在，请恢复后重试")?
        .name;
    let summaries = workspace
        .list_tag_notes(tag_id)
        .map_err(|e| e.to_string())?;
    let assets_root = workspace.tag_notes_dir(tag_id).map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for summary in summaries
        .into_iter()
        .filter(|note| note.deleted_at.is_none())
    {
        let id = format!("note:{}", summary.note_id);
        if selected.is_some_and(|ids| !ids.contains(id.as_str())) {
            continue;
        }
        let note = workspace
            .read_tag_note(tag_id, &summary.note_id)
            .map_err(|e| e.to_string())?;
        let mut warnings = Vec::new();
        let body = portable::note_body(workspace, &note, &mut warnings);
        items.push(prepare_item(
            ItemInput {
                id,
                kind: ReadingExportKind::Note,
                title: note.title,
                page: None,
                note_id: Some(summary.note_id.to_string()),
                body,
                warnings,
            },
            &format!("标签综合笔记 · {title}"),
            &assets_root,
        )?);
        if items.len() > 1000
            || items
                .iter()
                .map(|item| item.document.markdown.len())
                .sum::<usize>()
                > 32 * 1024 * 1024
        {
            return Err("综合笔记超过单次导出范围，请分批导出".into());
        }
        if items
            .iter()
            .flat_map(|item| item.document.assets.values())
            .map(|asset| asset.png.len())
            .sum::<usize>()
            > 192 * 1024 * 1024
        {
            return Err("所选图片总量超过 192 MB，请拆分导出".into());
        }
    }
    Ok((title, items))
}

struct ItemInput {
    id: String,
    kind: ReadingExportKind,
    title: String,
    page: Option<u32>,
    note_id: Option<String>,
    body: String,
    warnings: Vec<String>,
}

fn prepare_item(
    input: ItemInput,
    entry_title: &str,
    assets_root: &Path,
) -> Result<PreparedItem, String> {
    let ItemInput {
        id,
        kind,
        title,
        page,
        note_id,
        body,
        mut warnings,
    } = input;
    let preview = word_text::plain_text(resources::html_fragment(&body).root_element())
        .trim()
        .chars()
        .take(160)
        .collect();
    let mut document = empty_document(title.clone(), body);
    let mut destinations = BTreeMap::new();
    for (index, reference) in resources::image_references(&document.markdown)
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .enumerate()
    {
        match resources::load_asset(assets_root, &reference) {
            Ok(asset) => {
                destinations.insert(reference, asset.name.clone());
                resources::insert_asset(&mut document.assets, &asset.name.clone(), asset)?;
            }
            Err(_) => {
                // Never fetch remote resources or embed absolute workspace paths in a share.
                warnings.push(format!(
                    "第 {} 张引用图片不可用、为外部链接或超出安全限制；保留图片文字说明",
                    index + 1
                ));
                destinations.insert(reference, format!("assets/unavailable-{}", index + 1));
            }
        }
    }
    document.markdown = resources::rewrite_images(&document.markdown, &destinations);
    let notices = warnings
        .iter()
        .map(|warning| format!("待核对：{}\n\n", portable::literal(warning)))
        .collect::<String>();
    document.markdown = format!(
        "## {}\n\n所属资料：{} · {}\n\n{notices}{}\n",
        portable::literal(&title),
        portable::literal(entry_title),
        page_label(page),
        document.markdown
    );
    let mut hash = blake3::Hasher::new();
    hash.update(id.as_bytes());
    hash.update(document.markdown.as_bytes());
    for asset in document.assets.values() {
        hash.update(&asset.png);
    }
    let item = ReadingExportItem {
        id,
        kind,
        title,
        page,
        note_id,
        preview,
        fingerprint: hash.finalize().to_hex().to_string(),
        warnings,
    };
    Ok(PreparedItem { item, document })
}

fn page_label(page: Option<u32>) -> String {
    page.map(|page| format!("PDF 第 {page} 页"))
        .unwrap_or_else(|| "无页码".into())
}
