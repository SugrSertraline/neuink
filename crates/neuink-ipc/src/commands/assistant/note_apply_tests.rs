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

#[test]
fn note_citations_stay_in_content_and_patch_payloads() {
    use super::note_apply_store::{MarkdownPatchOperation, ProposalSource};
    let root = std::env::temp_dir().join(format!(
        "neuink-inline-citations-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    let workspace = Workspace::create(&root).expect("workspace");
    let entry = workspace.create_entry("Paper").expect("entry");
    let segment = neuink_domain::SourceSegment::new(
        neuink_domain::SegmentType::Paragraph,
        2,
        Some([1.0, 2.0, 3.0, 4.0]),
        "Grounded evidence".to_string(),
    );
    let source = ProposalSource {
        entry_id: entry.id.to_string(),
        entry_title: "Paper".to_string(),
        marker: Some("S1".to_string()),
        page_idx: 2,
        quote: "Grounded evidence".to_string(),
        segment_uid: segment.uid.to_string(),
    };
    workspace
        .write_segments(&entry.id, &[segment])
        .expect("segments");
    let mut proposal = VerifiedNoteProposal {
        action: "create".to_string(),
        base_content_hash: Some(stable_hash("")),
        before_markdown: Some(String::new()),
        entry_id: entry.id.to_string(),
        id: "inline".to_string(),
        idempotency_key: "inline-create".to_string(),
        markdown: "First claim [S1].\n\n- Second claim [S2].\n\nRepeated [S1].\n\nEnd.".to_string(),
        note_id: None,
        patch_operations: vec![],
        proposal_digest: String::new(),
        segment_uid: None,
        sources: vec![
            source.clone(),
            ProposalSource {
                marker: Some("S2".to_string()),
                ..source
            },
        ],
        status: "pending".to_string(),
        target_kind: "markdown_note".to_string(),
        task_id: "inline-task".to_string(),
        title: "Inline note".to_string(),
        verified_at: "2026-09-22T00:00:00Z".to_string(),
    };
    let persist = |proposal: &mut VerifiedNoteProposal| {
        proposal.proposal_digest = proposal_digest(proposal).expect("digest");
        fs::write(
            workspace.layout().conversations_dir().join("inline.json"),
            serde_json::to_vec(&json!({ "messages": [{ "parts": [
                { "type": "note-proposal", "proposal": proposal }
            ] }] }))
            .expect("json"),
        )
        .expect("persist proposal");
    };
    let request = || ApplyNoteProposalRequest {
        root: root.clone(),
        proposal_id: "inline".to_string(),
        task_id: "inline-task".to_string(),
    };
    persist(&mut proposal);
    let note_id = applied_note_id(apply_note_proposal_impl(request()).expect("create"));
    let links = workspace
        .read_note_source_links(&entry.id, &note_id)
        .expect("links");
    assert_eq!(links.len(), 1, "aliases for one segment share a snapshot");
    assert_eq!(links[0].sources[0].snapshot_text, "Grounded evidence");
    assert_eq!(links[0].sources[0].page, 3);
    assert_eq!(links[0].sources[0].bbox, Some([1.0, 2.0, 3.0, 4.0]));
    let anchor = format!("[^{}]", links[0].anchor_id);
    let current = workspace.read_note(&entry.id, &note_id).expect("note");
    assert_eq!(
        current.markdown.trim(),
        format!("First claim {anchor}.\n\n- Second claim {anchor}.\n\nRepeated {anchor}.\n\nEnd.")
    );
    assert_eq!(
        applied_note_id(apply_note_proposal_impl(request()).expect("replay")),
        note_id
    );

    proposal.action = "patch".to_string();
    proposal.note_id = Some(note_id.to_string());
    proposal.idempotency_key = "inline-patch".to_string();
    proposal.before_markdown = Some(current.markdown.clone());
    proposal.base_content_hash = Some(stable_hash(&current.markdown));
    proposal.markdown = "Human-readable patch summary without citations".to_string();
    proposal.sources.truncate(1);
    proposal.patch_operations = vec![MarkdownPatchOperation::ReplaceExact {
        old_text: "End.".to_string(),
        new_text: "Final claim [S1].".to_string(),
    }];
    persist(&mut proposal);
    apply_note_proposal_impl(request()).expect("patch citation from payload, not preview");
    let patched = workspace.read_note(&entry.id, &note_id).expect("patched");
    assert!(patched.markdown.contains("Final claim [^sl-"));
    assert!(!patched.markdown.contains("[S1]"));
    let patched_links = workspace
        .read_note_source_links(&entry.id, &note_id)
        .expect("patch links");
    assert_eq!(patched_links.len(), 2);

    proposal.action = "create".to_string();
    proposal.note_id = None;
    proposal.idempotency_key = "inline-invalid".to_string();
    proposal.markdown = "Uncited claim".to_string();
    persist(&mut proposal);
    assert!(apply_note_proposal_impl(request())
        .unwrap_err()
        .contains("缺少正文引用位置"));
    assert_eq!(
        workspace
            .read_entry(&entry.id)
            .expect("entry")
            .contents
            .len(),
        1
    );

    proposal.action = "patch".to_string();
    proposal.markdown = "Preview has [S1] but the actual patch does not".to_string();
    proposal.patch_operations = vec![MarkdownPatchOperation::ReplaceExact {
        old_text: "First claim".to_string(),
        new_text: "Different claim".to_string(),
    }];
    persist(&mut proposal);
    assert!(apply_note_proposal_impl(request())
        .unwrap_err()
        .contains("缺少正文引用位置"));
    assert_eq!(
        workspace
            .read_note(&entry.id, &note_id)
            .expect("unchanged")
            .markdown,
        patched.markdown
    );
    fs::remove_dir_all(root).expect("cleanup isolated test workspace");
}
