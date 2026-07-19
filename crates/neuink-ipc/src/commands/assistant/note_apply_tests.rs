use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use neuink_workspace::Workspace;
use serde_json::json;

use super::{
    note_apply::{apply_note_proposal_impl, ApplyNoteProposalRequest, ApplyNoteProposalResponse},
    note_apply_content::{proposal_digest, stable_hash},
    note_apply_store::VerifiedNoteProposal,
};

#[test]
fn creates_a_note_once_from_a_persisted_verified_proposal() {
    let root = std::env::temp_dir().join(format!(
        "neuink-note-apply-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    let workspace = Workspace::create(&root).expect("workspace");
    let entry = workspace.create_entry("Paper").expect("entry");
    let mut proposal = VerifiedNoteProposal {
        action: "create".to_string(),
        base_content_hash: Some(stable_hash("")),
        before_markdown: Some(String::new()),
        entry_id: entry.id.to_string(),
        id: "proposal-1".to_string(),
        idempotency_key: "apply-task-1-proposal-1".to_string(),
        markdown: "# Generated note".to_string(),
        note_id: None,
        patch_operations: Vec::new(),
        proposal_digest: String::new(),
        segment_uid: None,
        sources: Vec::new(),
        status: "pending".to_string(),
        target_kind: "markdown_note".to_string(),
        task_id: "task-1".to_string(),
        title: "Generated note".to_string(),
        verified_at: "2026-07-14T00:00:00Z".to_string(),
    };
    proposal.proposal_digest = proposal_digest(&proposal).expect("digest");
    let conversation = json!({
        "messages": [{
            "parts": [{ "proposal": proposal, "type": "note-proposal" }]
        }]
    });
    fs::write(
        workspace
            .layout()
            .conversations_dir()
            .join("conversation-1.json"),
        serde_json::to_vec(&conversation).expect("conversation json"),
    )
    .expect("conversation file");
    let request = || ApplyNoteProposalRequest {
        proposal_id: "proposal-1".to_string(),
        root: root.clone(),
        task_id: "task-1".to_string(),
    };

    let first = apply_note_proposal_impl(request()).expect("first apply");
    let second = apply_note_proposal_impl(request()).expect("idempotent apply");
    let first_note_id = applied_note_id(first);
    assert_eq!(applied_note_id(second), first_note_id);
    assert_eq!(
        workspace
            .read_note(&entry.id, &first_note_id)
            .expect("note")
            .markdown
            .trim(),
        "# Generated note"
    );
    assert_eq!(
        workspace
            .read_entry(&entry.id)
            .expect("entry")
            .contents
            .len(),
        1
    );
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn rejects_a_stale_existing_note_proposal() {
    let root = std::env::temp_dir().join(format!(
        "neuink-note-conflict-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    let workspace = Workspace::create(&root).expect("workspace");
    let entry = workspace.create_entry("Paper").expect("entry");
    let created = workspace
        .create_note(&entry.id, "Note")
        .expect("create note");
    let note_id = created
        .contents
        .iter()
        .find_map(|content| match content {
            neuink_domain::ContentItem::Note { note_id, .. } => Some(note_id.clone()),
        })
        .expect("note id");
    let base = workspace
        .update_note(&entry.id, &note_id, "Note", "base")
        .expect("base note")
        .markdown;
    let mut proposal = VerifiedNoteProposal {
        action: "append".to_string(),
        base_content_hash: Some(stable_hash(&base)),
        before_markdown: Some(base),
        entry_id: entry.id.to_string(),
        id: "proposal-conflict".to_string(),
        idempotency_key: "apply-conflict".to_string(),
        markdown: "append".to_string(),
        note_id: Some(note_id.to_string()),
        patch_operations: Vec::new(),
        proposal_digest: String::new(),
        segment_uid: None,
        sources: Vec::new(),
        status: "pending".to_string(),
        target_kind: "markdown_note".to_string(),
        task_id: "task-conflict".to_string(),
        title: "Note".to_string(),
        verified_at: "2026-07-14T00:00:00Z".to_string(),
    };
    proposal.proposal_digest = proposal_digest(&proposal).expect("digest");
    let conversation = json!({ "messages": [{
        "parts": [{ "proposal": proposal, "type": "note-proposal" }]
    }] });
    fs::write(
        workspace.layout().conversations_dir().join("conflict.json"),
        serde_json::to_vec(&conversation).expect("json"),
    )
    .expect("conversation");
    workspace
        .update_note(&entry.id, &note_id, "Note", "changed")
        .expect("concurrent edit");

    let response = apply_note_proposal_impl(ApplyNoteProposalRequest {
        proposal_id: "proposal-conflict".to_string(),
        root: root.clone(),
        task_id: "task-conflict".to_string(),
    })
    .expect("apply response");
    assert!(matches!(
        response,
        ApplyNoteProposalResponse::Conflict { .. }
    ));
    assert_eq!(
        workspace
            .read_note(&entry.id, &note_id)
            .expect("note")
            .markdown
            .trim(),
        "changed"
    );
    fs::remove_dir_all(root).expect("cleanup");
}

fn applied_note_id(response: ApplyNoteProposalResponse) -> neuink_domain::NoteId {
    match response {
        ApplyNoteProposalResponse::Applied { receipt } => {
            neuink_domain::NoteId::from_string(receipt.note_id.expect("note id"))
        }
        ApplyNoteProposalResponse::Conflict { .. } => panic!("unexpected conflict"),
    }
}
