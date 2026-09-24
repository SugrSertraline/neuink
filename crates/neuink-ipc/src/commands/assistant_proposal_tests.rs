use super::*;
use crate::commands::conversation::*;

fn fixture() -> (PathBuf, Conversation, Value) {
    let root = std::env::temp_dir().join(format!("neuink-approval-{}", ConversationId::new()));
    Workspace::create(&root).expect("workspace");
    let conversation = create_conversation(CreateConversationRequest {
        root: root.clone(),
        title: "Approval".into(),
        scope_snapshot: ScopeSnapshot::default(),
    })
    .expect("conversation");
    let proposal = json!({"id":"tag-1", "action":"create", "name":"Approved tag", "entryIds":[], "status":"pending"});
    let conversation = append_conversation_messages(AppendConversationMessagesRequest {
        root: root.clone(),
        conversation_id: conversation.id,
        messages: vec![ConversationMessageInput {
            role: ConversationRole::Assistant,
            content: String::new(),
            source_links: vec![],
            tool_events: vec![],
            note_proposals: vec![],
            parts: vec![json!({"type":"tag-proposal", "proposal":proposal})],
        }],
    })
    .expect("message");
    (root, conversation, proposal)
}
fn request(
    root: &std::path::Path,
    conversation: &Conversation,
    proposal: &Value,
    decision: &str,
) -> DecideAssistantProposalRequest {
    DecideAssistantProposalRequest {
        root: root.into(),
        conversation_id: conversation.id.clone(),
        message_id: conversation.messages[0].message_id.clone(),
        proposal_id: "tag-1".into(),
        expected_proposal: proposal.clone(),
        decision: decision.into(),
    }
}

#[test]
fn stored_pending_proposal_does_not_write_until_confirmed_and_duplicate_apply_is_idempotent() {
    let (root, conversation, proposal) = fixture();
    let workspace = Workspace::open_existing(&root).expect("workspace");
    assert!(workspace.list_tags().expect("tags").is_empty());
    assert_eq!(
        decide_assistant_proposal(request(&root, &conversation, &proposal, "apply"))
            .expect("apply")
            .status,
        "applied"
    );
    assert_eq!(
        decide_assistant_proposal(request(&root, &conversation, &proposal, "apply"))
            .expect("repeat receipt")
            .tags
            .len(),
        1
    );
    assert!(decide_assistant_proposal(request(&root, &conversation, &proposal, "reject")).is_err());
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn rejection_is_durable_and_cannot_be_approved_from_a_stale_window() {
    let (root, conversation, proposal) = fixture();
    assert_eq!(
        decide_assistant_proposal(request(&root, &conversation, &proposal, "reject"))
            .expect("reject")
            .status,
        "rejected"
    );
    assert!(decide_assistant_proposal(request(&root, &conversation, &proposal, "apply")).is_err());
    assert!(Workspace::open_existing(&root)
        .expect("workspace")
        .list_tags()
        .expect("tags")
        .is_empty());
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn client_cannot_change_the_saved_payload_or_use_an_unsaved_proposal() {
    let (root, conversation, mut proposal) = fixture();
    proposal["name"] = json!("Tampered");
    assert!(decide_assistant_proposal(request(&root, &conversation, &proposal, "apply")).is_err());
    let mut missing = request(&root, &conversation, &proposal, "apply");
    missing.message_id = "missing".into();
    assert!(decide_assistant_proposal(missing).is_err());
    assert!(Workspace::open_existing(&root)
        .expect("workspace")
        .list_tags()
        .expect("tags")
        .is_empty());
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn interrupted_attempt_is_not_replayed() {
    let (root, conversation, proposal) = fixture();
    let key = serde_json::to_vec(&(
        &conversation.id,
        &conversation.messages[0].message_id,
        "tag-1",
    ))
    .expect("key");
    let directory = root.join("agent-runtime/proposal-decisions");
    fs::create_dir_all(&directory).expect("directory");
    atomic_write_json(
        directory.join(format!("{}.json", blake3::hash(&key).to_hex())),
        &DecisionRecord {
            proposal: proposal.clone(),
            status: "applying".into(),
        },
    )
    .expect("interrupted record");
    assert!(
        decide_assistant_proposal(request(&root, &conversation, &proposal, "apply"))
            .expect_err("blocked")
            .contains("结果不明")
    );
    assert!(Workspace::open_existing(&root)
        .expect("workspace")
        .list_tags()
        .expect("tags")
        .is_empty());
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn two_concurrent_windows_cannot_apply_twice() {
    let (root, conversation, proposal) = fixture();
    let a = request(&root, &conversation, &proposal, "apply");
    let b = request(&root, &conversation, &proposal, "apply");
    let first = std::thread::spawn(move || decide_assistant_proposal(a));
    let second = std::thread::spawn(move || decide_assistant_proposal(b));
    let results = [first.join().expect("join"), second.join().expect("join")];
    assert!(results.iter().any(Result::is_ok));
    assert_eq!(
        Workspace::open_existing(&root)
            .expect("workspace")
            .list_tags()
            .expect("tags")
            .len(),
        1
    );
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn metadata_confirmation_preserves_user_edits_and_reports_conflicts_durably() {
    let (root, mut conversation, _) = fixture();
    let workspace = Workspace::open_existing(&root).expect("workspace");
    let entry = workspace.create_entry("Before").expect("entry");
    let proposal = json!({"id":"tag-1", "entryId":entry.id, "baseUpdatedAt":entry.updated_at, "beforeTitle":"Before", "beforeDescription":"", "afterTitle":"Approved title", "afterDescription":"Approved description", "fields":["title","description"], "status":"pending"});
    conversation = update_conversation_message(UpdateConversationMessageRequest {
        root: root.clone(),
        conversation_id: conversation.id.clone(),
        message_id: conversation.messages[0].message_id.clone(),
        content: None,
        source_links: None,
        tool_events: None,
        note_proposals: None,
        parts: Some(vec![
            json!({"type":"entry-meta-proposal", "proposal":proposal}),
        ]),
    })
    .expect("save");
    workspace
        .update_entry_meta(
            &entry.id,
            "User edited meanwhile",
            Default::default(),
            vec![],
        )
        .expect("edit");
    assert!(decide_assistant_proposal(request(&root, &conversation, &proposal, "apply")).is_err());
    assert_eq!(
        workspace.read_entry(&entry.id).expect("entry").title,
        "User edited meanwhile"
    );
    let saved = load_conversation(ConversationRequest {
        root: root.clone(),
        conversation_id: conversation.id.clone(),
    })
    .expect("load");
    assert_eq!(saved.messages[0].parts[0]["proposal"]["status"], "applying");
    assert!(
        decide_assistant_proposal(request(&root, &conversation, &proposal, "apply"))
            .expect_err("no retry")
            .contains("禁止重复")
    );
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn confirmation_storage_failure_prevents_business_writes() {
    let (root, conversation, proposal) = fixture();
    fs::create_dir_all(root.join("agent-runtime")).expect("directory");
    fs::write(root.join("agent-runtime/proposal-decisions"), b"blocked").expect("block storage");
    assert!(decide_assistant_proposal(request(&root, &conversation, &proposal, "apply")).is_err());
    assert!(Workspace::open_existing(&root)
        .expect("workspace")
        .list_tags()
        .expect("tags")
        .is_empty());
    fs::remove_dir_all(root).expect("cleanup");
}
