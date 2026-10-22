use super::files::{hash, Manifest};
use neuink_domain::{ContentItem, EntryMeta};
use serde_json::Value;
use std::{collections::BTreeSet, fs, path::Path};

pub(super) fn workspace_marker(root: &Path) -> Result<Value, String> {
    let value: Value = read(&root.join("neuink.workspace.json"))?;
    let _: crate::workspace::WorkspaceFile =
        serde_json::from_value(value.clone()).map_err(|_| "旧资料库索引损坏，原目录已保留。")?;
    if value["schema_version"].as_u64() != Some(1) {
        return Err("旧资料库版本无效，原目录已保留。".into());
    }
    Ok(value)
}

fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|_| "资料描述文件不可读，原目录已保留。")?;
    serde_json::from_slice(&bytes).map_err(|_| "资料描述文件损坏，原目录已保留。".into())
}

/// Parsed output is a bundle. Do not mix outputs from different PDFs or different segment sets.
pub(super) fn importable(
    source: &Path,
    target: &Path,
    manifest: &Manifest,
) -> Result<Manifest, String> {
    let mut blocked = Vec::new();
    for relative in manifest
        .keys()
        .filter(|p| p.file_name().is_some_and(|n| n == "entry.meta.json"))
    {
        let parent = relative.parent().ok_or("条目目录无效。")?;
        let source_meta: EntryMeta = read(&source.join(relative))?;
        source_meta.validate().map_err(|_| "旧条目格式无效。")?;
        if parent.file_name().and_then(|name| name.to_str()) != Some(source_meta.id.as_str()) {
            return Err("旧条目编号与目录不一致，原目录已保留。".into());
        }
        if target.join(relative).is_file() {
            let current: EntryMeta = read(&target.join(relative))?;
            if current.id != source_meta.id { blocked.push(parent.to_path_buf()); continue; }
        }
        let opposite = if parent.starts_with("entries") {
            target.join("trash/entries").join(source_meta.id.as_str())
        } else {
            target.join("entries").join(source_meta.id.as_str())
        };
        if opposite.exists() {
            blocked.push(parent.to_path_buf());
            continue;
        }
        for file in ["paper.pdf", "paper.segments.json"] {
            let old = source.join(parent).join(file);
            let current = target.join(parent).join(file);
            if old.is_file() && current.is_file() && hash(&old)? != hash(&current)? {
                blocked.push(parent.to_path_buf());
                break;
            }
        }
    }
    Ok(manifest
        .iter()
        .filter(|(path, _)| !blocked.iter().any(|prefix| path.starts_with(prefix)))
        .map(|(path, hash)| (path.clone(), *hash))
        .collect())
}

fn merge_array(current: &mut Value, old: &Value, field: &str, key: &str) -> Result<(), String> {
    let Some(items) = old[field].as_array() else {
        return Ok(());
    };
    if current[field].is_null() {
        current[field] = Value::Array(Vec::new());
    }
    let result = current[field]
        .as_array_mut()
        .ok_or("资料库索引格式无效。")?;
    let mut seen: BTreeSet<String> = result
        .iter()
        .filter_map(|item| item[key].as_str().map(str::to_owned))
        .collect();
    for item in items {
        let id = item[key].as_str().ok_or("资料库索引缺少编号。")?;
        if seen.insert(id.into()) {
            result.push(item.clone());
        }
    }
    Ok(())
}

pub(super) fn merge(
    source: &Path,
    target: &Path,
    stage: &Path,
    imported: &Manifest,
) -> Result<(), String> {
    let old = workspace_marker(source)?;
    let mut current = if target.join("neuink.workspace.json").exists() {
        workspace_marker(target)?
    } else {
        old.clone()
    };
    merge_array(&mut current, &old, "tags", "id")?;
    merge_array(&mut current, &old, "tag_archives", "archive_id")?;
    crate::atomic_write_json(stage.join("neuink.workspace.json"), &current)
        .map_err(|_| "无法保存合并标签。")?;
    for relative in imported
        .keys()
        .filter(|p| p.file_name().is_some_and(|n| n == "entry.meta.json"))
    {
        if !target.join(relative).is_file() {
            continue;
        }
        let old: EntryMeta = read(&source.join(relative))?;
        let mut current: EntryMeta = read(&target.join(relative))?;
        if old.id != current.id {
            continue;
        }
        for (key, value) in old.fields {
            current.fields.entry(key).or_insert(value);
        }
        for content in old.contents {
            let ContentItem::Note { note_id, .. } = &content;
            if !current.contents.iter().any(
                |item| matches!(item, ContentItem::Note { note_id: other, .. } if other == note_id),
            ) {
                current.contents.push(content);
            }
        }
        let parent = relative.parent().ok_or("条目目录无效。")?;
        if current.pdf.is_none() {
            current.pdf = old.pdf;
        } else if !target.join(parent).join("paper.segments.json").exists()
            && source.join(parent).join("paper.segments.json").is_file()
        {
            if let (Some(current_pdf), Some(old_pdf)) = (&mut current.pdf, old.pdf) {
                if current_pdf.content_hash == old_pdf.content_hash {
                    current_pdf.parse = old_pdf.parse;
                }
            }
        }
        crate::atomic_write_json(stage.join(relative), &current)
            .map_err(|_| "无法保存合并条目。")?;
    }
    Ok(())
}
