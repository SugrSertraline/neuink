use std::{collections::BTreeMap, fs, path::PathBuf};

use neuink_domain::segment_note::validate_segment_note_text;
use neuink_domain::{EntryId, NoteId, SegmentUid};
use neuink_workspace::{Workspace, WorkspaceError};
use serde::{Deserialize, Serialize};

use super::note_apply_content::{
    apply_markdown_action, proposal_digest, segment_note_html, stable_hash,
    validate_source_placements,
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
    let _decision_lock = crate::commands::assistant_proposal::decision_lock(&request.root)?;
    let proposal = load_verified_proposal(&request.root, &request.task_id, &request.proposal_id)?;
    validate_proposal(&proposal, &request)?;
    let receipt_file = receipt_path(&request.root, &proposal.idempotency_key);
    if receipt_file.exists() {
        return Ok(ApplyNoteProposalResponse::Applied {
            receipt: read_json(&receipt_file)?,
        });
    }
    if proposal.target_kind == "markdown_note" {
        // Reject unplaced evidence before creating a note or a recovery journal.
        validate_source_placements(&proposal)?;
    }
    let journal_file = journal_path(&request.root, &proposal.idempotency_key);
    if journal_file.exists() {
        return recover_journal(&journal_file, &receipt_file);
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
        let note_id = NoteId::new();
        let journal = ApplyJournal::MarkdownCreate {
            created_note_id: Some(note_id.to_string()),
            entry_id: proposal.entry_id.clone(),
        };
        write_json(journal_file, &journal)?;
        workspace
            .create_note_with_id(&entry_id, note_id.clone(), &proposal.title)
            .map_err(|error| error.to_string())?;
        let current = workspace
            .read_note(&entry_id, &note_id)
            .map_err(|error| error.to_string())?;
        let (markdown, _, links) = materialize_sources(workspace, proposal, &entry_id, &note_id)?;
        let result = workspace.update_note_document_if_revision(
            &entry_id,
            &note_id,
            &proposal.title,
            markdown.clone(),
            &links,
            Some(&current.revision),
        );
        if let Err(error) = result {
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
    let previous_links = workspace
        .read_note_source_links(&entry_id, &note_id)
        .map_err(|error| error.to_string())?;
    let journal = ApplyJournal::MarkdownUpdate {
        entry_id: proposal.entry_id.clone(),
        links: previous_links.clone(),
        markdown: current.markdown.clone(),
        note_id: note_id.to_string(),
        title: current.title.clone(),
    };
    let (materialized, patch_operations, new_links) =
        materialize_sources(workspace, proposal, &entry_id, &note_id)?;
    let markdown = apply_markdown_action(
        &proposal.action,
        &current.markdown,
        &materialized,
        &patch_operations,
    )?;
    let mut links = previous_links;
    links.extend(new_links);
    write_json(journal_file, &journal)?;
    if let Err(error) = workspace.update_note_document_if_revision(
        &entry_id,
        &note_id,
        &proposal.title,
        &markdown,
        &links,
        Some(&current.revision),
    ) {
        // An I/O error can leave a partial multi-file write. Retain the journal
        // and fail closed on retry; never roll back a possibly newer edit.
        if matches!(error, WorkspaceError::NoteRevisionConflict(_)) {
            fs::remove_file(journal_file).map_err(|error| error.to_string())?;
        }
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
    validate_segment_note_text(&text).map_err(|error| error.to_string())?;
    write_json(
        journal_file,
        &ApplyJournal::SegmentUpdate {
            entry_id: proposal.entry_id.clone(),
            segment_uid: segment_uid.to_string(),
            text: current.clone(),
        },
    )?;
    match workspace.upsert_segment_note_if_text(
        &entry_id,
        segment_uid,
        text.clone(),
        Some(&current),
    ) {
        Ok(_) => {}
        Err(WorkspaceError::SegmentNoteConflict(latest)) => {
            fs::remove_file(journal_file).map_err(|error| error.to_string())?;
            return Ok(ApplyNoteProposalResponse::Conflict {
                current_content_hash: stable_hash(&latest),
            });
        }
        Err(error) => return Err(error.to_string()),
    }
    commit_receipt(proposal, None, &text, receipt_file, journal_file)
}

fn materialize_sources(
    workspace: &Workspace,
    proposal: &VerifiedNoteProposal,
    entry_id: &EntryId,
    note_id: &NoteId,
) -> Result<
    (
        String,
        Vec<super::note_apply_store::MarkdownPatchOperation>,
        Vec<neuink_domain::SourceLink>,
    ),
    String,
> {
    let mut markdown = proposal.markdown.clone();
    let mut patch_operations = proposal.patch_operations.clone();
    let mut links = Vec::new();
    let mut anchors = BTreeMap::new();
    for (index, source) in proposal.sources.iter().enumerate() {
        let key = (source.entry_id.clone(), source.segment_uid.clone());
        let anchor = if let Some(anchor) = anchors.get(&key) {
            String::clone(anchor)
        } else {
            let link = workspace
                .build_note_source_link(
                    entry_id,
                    note_id,
                    &EntryId::from_string(&source.entry_id),
                    SegmentUid::from_string(&source.segment_uid),
                )
                .map_err(|error| error.to_string())?;
            let anchor = format!("[^{}]", link.anchor_id);
            anchors.insert(key, anchor.clone());
            links.push(link);
            anchor
        };
        let marker = source
            .marker
            .clone()
            .unwrap_or_else(|| format!("S{}", index + 1));
        let needle = format!("[{marker}]");
        markdown = markdown.replace(&needle, &anchor);
        materialize_patch_markers(&mut patch_operations, &needle, &anchor);
    }
    Ok((markdown, patch_operations, links))
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

pub(super) fn recover_journal(
    path: &std::path::Path,
    receipt_file: &std::path::Path,
) -> Result<ApplyNoteProposalResponse, String> {
    let journal: ApplyJournal = read_json(path)?;
    let ApplyJournal::Completed { receipt } = journal else {
        return Err("上次笔记写入中断，无法确定是否完整保存。为保护后续编辑，已停止重试，未回滚或删除任何笔记。请先查看目标条目的笔记，再基于当前内容生成新提案。".into());
    };
    write_json(receipt_file, &receipt)?;
    fs::remove_file(path).map_err(|error| error.to_string())?;
    Ok(ApplyNoteProposalResponse::Applied { receipt })
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
    write_json(
        journal_file,
        &ApplyJournal::Completed {
            receipt: receipt.clone(),
        },
    )?;
    write_json(receipt_file, &receipt)?;
    fs::remove_file(journal_file).map_err(|error| error.to_string())?;
    Ok(ApplyNoteProposalResponse::Applied { receipt })
}

fn base_matches(proposal: &VerifiedNoteProposal, current: &str) -> bool {
    proposal
        .base_content_hash
        .as_deref()
        .is_some_and(|hash| hash == stable_hash(current))
}
