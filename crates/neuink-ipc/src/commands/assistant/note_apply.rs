use std::{collections::BTreeSet, fs, path::PathBuf};

use neuink_domain::{ContentItem, EntryId, NoteId, SegmentUid};
use neuink_workspace::Workspace;
use serde::{Deserialize, Serialize};

use super::note_apply_content::{
    apply_markdown_action, proposal_digest, segment_note_html, stable_hash,
};
use super::note_apply_store::{
    journal_path, load_verified_proposal, read_json, receipt_path, write_json, ApplyJournal,
    ApplyReceipt, VerifiedNoteProposal,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyNoteProposalRequest {
    pub root: PathBuf,
    pub proposal_id: String,
    pub task_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ApplyNoteProposalResponse {
    Applied { receipt: ApplyReceipt },
    Conflict { current_content_hash: String },
}

pub(super) fn apply_note_proposal_impl(
    request: ApplyNoteProposalRequest,
) -> Result<ApplyNoteProposalResponse, String> {
    let workspace = Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let proposal = load_verified_proposal(&request.root, &request.task_id, &request.proposal_id)?;
    validate_proposal(&proposal, &request)?;
    let receipt_file = receipt_path(&request.root, &proposal.idempotency_key);
    if receipt_file.exists() {
        return Ok(ApplyNoteProposalResponse::Applied {
            receipt: read_json(&receipt_file)?,
        });
    }
    let journal_file = journal_path(&request.root, &proposal.idempotency_key);
    if journal_file.exists() {
        recover_journal(&workspace, &journal_file)?;
    }

    if proposal.target_kind == "segment_note" {
        return apply_segment_proposal(&workspace, &proposal, &journal_file, &receipt_file);
    }
    apply_markdown_proposal(&workspace, &proposal, &journal_file, &receipt_file)
}

fn apply_markdown_proposal(
    workspace: &Workspace,
    proposal: &VerifiedNoteProposal,
    journal_file: &std::path::Path,
    receipt_file: &std::path::Path,
) -> Result<ApplyNoteProposalResponse, String> {
    let entry_id = EntryId::from_string(&proposal.entry_id);
    if proposal.action == "create" {
        let journal = ApplyJournal::MarkdownCreate {
            created_note_id: None,
            entry_id: proposal.entry_id.clone(),
        };
        write_json(journal_file, &journal)?;
        let before_ids = note_ids(workspace, &entry_id)?;
        let entry = workspace
            .create_note(&entry_id, &proposal.title)
            .map_err(|error| error.to_string())?;
        let note_id = entry
            .contents
            .iter()
            .find_map(|content| match content {
                ContentItem::Note { note_id, .. } if !before_ids.contains(note_id.as_str()) => {
                    Some(note_id.clone())
                }
                _ => None,
            })
            .ok_or_else(|| "created note id could not be resolved".to_string())?;
        write_json(
            journal_file,
            &ApplyJournal::MarkdownCreate {
                created_note_id: Some(note_id.to_string()),
                entry_id: proposal.entry_id.clone(),
            },
        )?;
        let (markdown, _) = materialize_sources(workspace, proposal, &entry_id, &note_id)?;
        let result = workspace.update_note(&entry_id, &note_id, &proposal.title, markdown.clone());
        if let Err(error) = result {
            recover_journal(workspace, journal_file)?;
            return Err(error.to_string());
        }
        return commit_receipt(
            proposal,
            Some(note_id.to_string()),
            &markdown,
            receipt_file,
            journal_file,
        );
    }

    let note_id = proposal
        .note_id
        .as_ref()
        .map(NoteId::from_string)
        .ok_or_else(|| "verified proposal has no noteId".to_string())?;
    let current = workspace
        .read_note(&entry_id, &note_id)
        .map_err(|error| error.to_string())?;
    if !base_matches(proposal, &current.markdown) {
        return Ok(ApplyNoteProposalResponse::Conflict {
            current_content_hash: stable_hash(&current.markdown),
        });
    }
    let links = workspace
        .read_note_source_links(&entry_id, &note_id)
        .map_err(|error| error.to_string())?;
    write_json(
        journal_file,
        &ApplyJournal::MarkdownUpdate {
            entry_id: proposal.entry_id.clone(),
            links,
            markdown: current.markdown.clone(),
            note_id: note_id.to_string(),
            title: current.title.clone(),
        },
    )?;
    let (materialized, patch_operations) =
        materialize_sources(workspace, proposal, &entry_id, &note_id)?;
    let markdown = apply_markdown_action(
        &proposal.action,
        &current.markdown,
        &materialized,
        &patch_operations,
    )?;
    if let Err(error) = workspace.update_note(&entry_id, &note_id, &proposal.title, &markdown) {
        recover_journal(workspace, journal_file)?;
        return Err(error.to_string());
    }
    commit_receipt(
        proposal,
        Some(note_id.to_string()),
        &markdown,
        receipt_file,
        journal_file,
    )
}

fn apply_segment_proposal(
    workspace: &Workspace,
    proposal: &VerifiedNoteProposal,
    journal_file: &std::path::Path,
    receipt_file: &std::path::Path,
) -> Result<ApplyNoteProposalResponse, String> {
    let entry_id = EntryId::from_string(&proposal.entry_id);
    let segment_uid = proposal
        .segment_uid
        .as_ref()
        .map(SegmentUid::from_string)
        .ok_or_else(|| "verified proposal has no segmentUid".to_string())?;
    let current = workspace
        .read_segment_notes(&entry_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|note| note.segment_uid == segment_uid)
        .map(|note| note.text)
        .unwrap_or_default();
    if !base_matches(proposal, &current) {
        return Ok(ApplyNoteProposalResponse::Conflict {
            current_content_hash: stable_hash(&current),
        });
    }
    write_json(
        journal_file,
        &ApplyJournal::SegmentUpdate {
            entry_id: proposal.entry_id.clone(),
            segment_uid: segment_uid.to_string(),
            text: current.clone(),
        },
    )?;
    let proposed = segment_note_html(&proposal.markdown, &proposal.sources);
    let text = match proposal.action.as_str() {
        "prepend" if !current.trim().is_empty() => {
            format!("{}<hr>{}", proposed.trim(), current.trim())
        }
        "append" if !current.trim().is_empty() => {
            format!("{}<hr>{}", current.trim(), proposed.trim())
        }
        "prepend" | "append" | "replace" | "patch" | "delete" => proposed,
        action => {
            return Err(format!(
                "unsupported segment note proposal action: {action}"
            ))
        }
    };
    workspace
        .upsert_segment_note(&entry_id, segment_uid, text.clone())
        .map_err(|error| error.to_string())?;
    commit_receipt(proposal, None, &text, receipt_file, journal_file)
}

fn materialize_sources(
    workspace: &Workspace,
    proposal: &VerifiedNoteProposal,
    entry_id: &EntryId,
    note_id: &NoteId,
) -> Result<(String, Vec<super::note_apply_store::MarkdownPatchOperation>), String> {
    let mut markdown = proposal.markdown.clone();
    let mut patch_operations = proposal.patch_operations.clone();
    let mut seen = BTreeSet::new();
    for (index, source) in proposal.sources.iter().enumerate() {
        let key = format!("{}:{}", source.entry_id, source.segment_uid);
        if !seen.insert(key) {
            continue;
        }
        let link = workspace
            .create_note_source_link(
                entry_id,
                note_id,
                &EntryId::from_string(&source.entry_id),
                SegmentUid::from_string(&source.segment_uid),
            )
            .map_err(|error| error.to_string())?;
        let marker = source
            .marker
            .clone()
            .unwrap_or_else(|| format!("S{}", index + 1));
        let needle = format!("[{marker}]");
        let anchor = format!("[^{}]", link.anchor_id);
        let used = markdown.contains(&needle);
        markdown = markdown.replace(&needle, &anchor);
        materialize_patch_markers(&mut patch_operations, &needle, &anchor);
        if !used && !markdown.contains(&anchor) {
            markdown = format!("{}\n\n{}", markdown.trim_end(), anchor);
        }
    }
    Ok((markdown, patch_operations))
}

fn materialize_patch_markers(
    operations: &mut [super::note_apply_store::MarkdownPatchOperation],
    marker: &str,
    anchor: &str,
) {
    use super::note_apply_store::MarkdownPatchOperation;
    for operation in operations {
        match operation {
            MarkdownPatchOperation::ReplaceExact { new_text, .. } => {
                *new_text = new_text.replace(marker, anchor);
            }
            MarkdownPatchOperation::InsertAfter { text, .. }
            | MarkdownPatchOperation::InsertBefore { text, .. }
            | MarkdownPatchOperation::Append { text }
            | MarkdownPatchOperation::InsertLines { text, .. } => {
                *text = text.replace(marker, anchor);
            }
            MarkdownPatchOperation::ReplaceLines { new_text, .. } => {
                *new_text = new_text.replace(marker, anchor);
            }
            MarkdownPatchOperation::DeleteLines { .. } => {}
        }
    }
}

fn validate_proposal(
    proposal: &VerifiedNoteProposal,
    request: &ApplyNoteProposalRequest,
) -> Result<(), String> {
    if proposal.id != request.proposal_id || proposal.task_id != request.task_id {
        return Err("proposal identity mismatch".to_string());
    }
    if proposal.status != "pending" || proposal.verified_at.trim().is_empty() {
        return Err("only a pending verified proposal can be applied".to_string());
    }
    if let (Some(before), Some(base_hash)) = (
        proposal.before_markdown.as_deref(),
        proposal.base_content_hash.as_deref(),
    ) {
        if stable_hash(before) != base_hash {
            return Err("proposal base content hash mismatch".to_string());
        }
    }
    let digest = proposal_digest(proposal)?;
    if digest != proposal.proposal_digest {
        return Err("verified proposal digest mismatch".to_string());
    }
    Ok(())
}

fn recover_journal(workspace: &Workspace, path: &std::path::Path) -> Result<(), String> {
    let journal: ApplyJournal = read_json(path)?;
    match journal {
        ApplyJournal::MarkdownCreate {
            created_note_id,
            entry_id,
        } => {
            if let Some(note_id) = created_note_id {
                let _ = workspace.delete_note(
                    &EntryId::from_string(entry_id),
                    &NoteId::from_string(note_id),
                );
            }
        }
        ApplyJournal::MarkdownUpdate {
            entry_id,
            links,
            markdown,
            note_id,
            title,
        } => {
            let entry_id = EntryId::from_string(entry_id);
            let note_id = NoteId::from_string(note_id);
            workspace
                .update_note(&entry_id, &note_id, title, markdown)
                .map_err(|error| error.to_string())?;
            workspace
                .replace_note_source_links(&entry_id, &note_id, &links)
                .map_err(|error| error.to_string())?;
        }
        ApplyJournal::SegmentUpdate {
            entry_id,
            segment_uid,
            text,
        } => {
            workspace
                .upsert_segment_note(
                    &EntryId::from_string(entry_id),
                    SegmentUid::from_string(segment_uid),
                    text,
                )
                .map_err(|error| error.to_string())?;
        }
    }
    fs::remove_file(path).map_err(|error| error.to_string())
}

fn commit_receipt(
    proposal: &VerifiedNoteProposal,
    note_id: Option<String>,
    content: &str,
    receipt_file: &std::path::Path,
    journal_file: &std::path::Path,
) -> Result<ApplyNoteProposalResponse, String> {
    let receipt = ApplyReceipt {
        action: proposal.action.clone(),
        content_hash: stable_hash(content),
        entry_id: proposal.entry_id.clone(),
        note_id,
        proposal_id: proposal.id.clone(),
        segment_uid: proposal.segment_uid.clone(),
        task_id: proposal.task_id.clone(),
    };
    write_json(receipt_file, &receipt)?;
    fs::remove_file(journal_file).map_err(|error| error.to_string())?;
    Ok(ApplyNoteProposalResponse::Applied { receipt })
}

fn note_ids(workspace: &Workspace, entry_id: &EntryId) -> Result<BTreeSet<String>, String> {
    Ok(workspace
        .read_entry(entry_id)
        .map_err(|error| error.to_string())?
        .contents
        .iter()
        .map(|content| match content {
            ContentItem::Note { note_id, .. } => note_id.to_string(),
        })
        .collect())
}

fn base_matches(proposal: &VerifiedNoteProposal, current: &str) -> bool {
    proposal
        .base_content_hash
        .as_deref()
        .is_some_and(|hash| hash == stable_hash(current))
}
