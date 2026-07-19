use serde::Serialize;

use super::note_apply_store::{MarkdownPatchOperation, ProposalSource, VerifiedNoteProposal};

pub(super) fn apply_markdown_action(
    action: &str,
    current: &str,
    materialized: &str,
    patch_operations: &[MarkdownPatchOperation],
) -> Result<String, String> {
    match action {
        "append" => Ok(join_markdown(current, materialized)),
        "prepend" => Ok(join_markdown(materialized, current)),
        "replace" => Ok(materialized.to_string()),
        "patch" => apply_patch_operations(current, patch_operations),
        "delete" => apply_patch_operations(current, patch_operations),
        action => Err(format!("unsupported note proposal action: {action}")),
    }
}

pub(super) fn proposal_digest(proposal: &VerifiedNoteProposal) -> Result<String, String> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Canonical<'a> {
        action: &'a str,
        base_content_hash: &'a Option<String>,
        entry_id: &'a str,
        markdown: &'a str,
        note_id: &'a Option<String>,
        patch_operations: &'a [MarkdownPatchOperation],
        segment_uid: &'a Option<String>,
        sources: &'a [ProposalSource],
        target_kind: &'a str,
        title: &'a str,
    }
    let json = serde_json::to_string(&Canonical {
        action: &proposal.action,
        base_content_hash: &proposal.base_content_hash,
        entry_id: &proposal.entry_id,
        markdown: &proposal.markdown,
        note_id: &proposal.note_id,
        patch_operations: &proposal.patch_operations,
        segment_uid: &proposal.segment_uid,
        sources: &proposal.sources,
        target_kind: &proposal.target_kind,
        title: &proposal.title,
    })
    .map_err(|error| error.to_string())?;
    Ok(stable_hash(&json))
}

pub(super) fn segment_note_html(markdown: &str, sources: &[ProposalSource]) -> String {
    let body = markdown
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| format!("<p>{}</p>", escape_html(line.trim())))
        .collect::<String>();
    if sources.is_empty() {
        return body;
    }
    let items = sources
        .iter()
        .map(|source| {
            format!(
                "<li><strong>{}</strong> · {} · p.{} · <code>{}</code></li>",
                escape_html(source.marker.as_deref().unwrap_or("S")),
                escape_html(&source.entry_title),
                source.page_idx + 1,
                escape_html(&source.segment_uid),
            )
        })
        .collect::<String>();
    format!("{body}<aside data-neuink-segment-note-sources=\"true\"><ul>{items}</ul></aside>")
}

pub(super) fn stable_hash(value: &str) -> String {
    let mut hash = 2_166_136_261_u32;
    for unit in value.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(16_777_619);
    }
    format!("{hash:08x}")
}

fn apply_patch_operations(
    current: &str,
    operations: &[MarkdownPatchOperation],
) -> Result<String, String> {
    let mut markdown = current.to_string();
    for operation in operations {
        markdown = match operation {
            MarkdownPatchOperation::ReplaceExact { new_text, old_text } => {
                replace_unique(&markdown, old_text, new_text)?
            }
            MarkdownPatchOperation::InsertAfter { anchor_text, text } => {
                replace_unique(&markdown, anchor_text, &format!("{anchor_text}{text}"))?
            }
            MarkdownPatchOperation::InsertBefore { anchor_text, text } => {
                replace_unique(&markdown, anchor_text, &format!("{text}{anchor_text}"))?
            }
            MarkdownPatchOperation::Append { text } => join_markdown(&markdown, text),
        };
    }
    Ok(markdown)
}

fn replace_unique(markdown: &str, old: &str, new: &str) -> Result<String, String> {
    if old.is_empty() || markdown.matches(old).count() != 1 {
        return Err("patch target must match exactly once".to_string());
    }
    Ok(markdown.replacen(old, new, 1))
}

fn join_markdown(current: &str, next: &str) -> String {
    match (current.trim().is_empty(), next.trim().is_empty()) {
        (true, _) => next.trim().to_string(),
        (_, true) => current.trim_end().to_string(),
        _ => format!("{}\n\n{}", current.trim_end(), next.trim()),
    }
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest_matches_typescript_utf16_vector() {
        let proposal = VerifiedNoteProposal {
            action: "append".to_string(),
            base_content_hash: Some("12345678".to_string()),
            before_markdown: Some("old".to_string()),
            entry_id: "entry-1".to_string(),
            id: "proposal-1".to_string(),
            idempotency_key: "apply-1".to_string(),
            markdown: "新增内容".to_string(),
            note_id: Some("note-1".to_string()),
            patch_operations: Vec::new(),
            proposal_digest: "d7644aa4".to_string(),
            segment_uid: None,
            sources: vec![ProposalSource {
                entry_id: "entry-1".to_string(),
                entry_title: "论文".to_string(),
                marker: Some("S1".to_string()),
                page_idx: 0,
                quote: "证据".to_string(),
                segment_uid: "seg-1".to_string(),
            }],
            status: "pending".to_string(),
            target_kind: "markdown_note".to_string(),
            task_id: "task-1".to_string(),
            title: "笔记".to_string(),
            verified_at: "2026-07-14T00:00:00Z".to_string(),
        };
        assert_eq!(proposal_digest(&proposal).expect("digest"), "d7644aa4");
    }

    #[test]
    fn patch_requires_a_unique_target() {
        let operations = [MarkdownPatchOperation::ReplaceExact {
            new_text: "new".to_string(),
            old_text: "old".to_string(),
        }];
        assert_eq!(
            apply_patch_operations("before old after", &operations).expect("patch"),
            "before new after"
        );
        assert!(apply_patch_operations("old and old", &operations).is_err());
    }

    #[test]
    fn prepend_places_new_markdown_before_existing_content() {
        assert_eq!(
            apply_markdown_action("prepend", "# Existing\n\nBody", "# New", &[]).expect("prepend"),
            "# New\n\n# Existing\n\nBody"
        );
        assert_eq!(
            apply_markdown_action("prepend", "", "# New", &[]).expect("empty note"),
            "# New"
        );
    }
}
