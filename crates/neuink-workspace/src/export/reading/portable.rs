use crate::{note::NoteDocument, Workspace};
use neuink_domain::{EntryId, EntryMeta};
use std::collections::BTreeMap;

pub(super) fn literal(value: &str) -> String {
    value
        .chars()
        .flat_map(|ch| {
            if "\\`*_{}[]<>()#+-.!|".contains(ch) {
                vec!['\\', ch]
            } else {
                vec![ch]
            }
        })
        .collect()
}

pub(super) fn file_name(value: &str) -> String {
    let clean: String = value
        .chars()
        .filter(|ch| !ch.is_control() && !"<>:\"/\\|?*".contains(*ch))
        .take(55)
        .collect();
    let clean = clean.trim_matches([' ', '.']);
    // Prefix avoids Windows device names (CON, AUX, etc.) as directory or file stems.
    format!("资料-{}", if clean.is_empty() { "未命名" } else { clean })
}

pub(super) fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'-')
}

pub(super) fn source_label(workspace: &Workspace, entry_id: &EntryId, page: Option<u32>) -> String {
    let title = if valid_id(entry_id.as_str()) {
        workspace
            .read_entry(entry_id)
            .map(|entry| entry_label(&entry))
            .unwrap_or_else(|_| if workspace.layout().trashed_entry_dir(entry_id).exists() { "原论文已移入回收站".into() } else { "原论文已删除".into() })
    } else {
        "来源条目标识无效".into()
    };
    format!(
        "{}{}",
        literal(&title),
        page.map(|page| format!(" · PDF 第 {page} 页"))
            .unwrap_or_default()
    )
}

pub(super) fn entry_label(entry: &EntryMeta) -> String {
    let doi = entry.fields.iter().find_map(|(key, value)| {
        let value = value.trim();
        (key.eq_ignore_ascii_case("doi")
            && value.starts_with("10.")
            && !value.chars().any(char::is_whitespace))
        .then_some(value)
    });
    match doi {
        Some(doi) => format!("{} · DOI: {doi}", entry.title),
        None => entry.title.clone(),
    }
}

pub(super) fn note_body(
    workspace: &Workspace,
    note: &NoteDocument,
    warnings: &mut Vec<String>,
) -> String {
    let mut edits = Vec::new();
    let mut references = BTreeMap::new();
    let mut sources = String::new();
    for (range, anchor) in crate::note_catalog::source_reference_ranges(&note.markdown) {
        let (start, end) = (range.start, range.end);
        let anchor = anchor.as_str();
        let number = if let Some(number) = references.get(anchor) {
            *number
        } else {
            let number = references.len() + 1;
            references.insert(anchor.to_owned(), number);
            sources.push_str(&format!("\n\n### 来源 {number}\n\n"));
            if let Some(link) = note.links.iter().find(|link| link.anchor_id == anchor) {
                if link.sources.is_empty() {
                    warnings.push(format!("来源 {number} 没有引用快照"));
                }
                for source in &link.sources {
                    if let Some(status) = workspace.inspect_sources(std::slice::from_ref(source)).first() {
                        if !status.can_locate {
                            warnings.push(format!("来源 {number}：{}，已保留引用快照", status.message));
                            sources.push_str(&format!("{}\n\n", status.message));
                        }
                    }
                    sources.push_str(&source_label(
                        workspace,
                        &source.entry_id,
                        Some(source.page),
                    ));
                    sources.push_str(&format!(
                        "\n\n引用快照：{}\n",
                        literal(&source.snapshot_text)
                    ));
                }
            } else {
                warnings.push(format!("来源 {number} 的记录已缺失"));
                sources.push_str("来源记录缺失，无法恢复引用文字。\n");
            }
            number
        };
        edits.push((start..end, format!("【来源 {number}】")));
    }
    let mut body = note.markdown.clone();
    for (range, text) in edits.into_iter().rev() {
        body.replace_range(range, &text);
    }
    body.push_str(&sources);
    body
}
