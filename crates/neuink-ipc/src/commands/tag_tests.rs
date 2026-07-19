use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use neuink_domain::{EntryId, TagId};
use neuink_workspace::Workspace;

use super::tag::{apply_tag_proposal_impl, ApplyTagProposalRequest};

#[test]
fn attaches_and_detaches_a_tag_for_multiple_entries() {
    let root = test_root("batch");
    let workspace = Workspace::create(&root).expect("workspace");
    let first = workspace.create_entry("First").expect("first entry");
    let second = workspace.create_entry("Second").expect("second entry");
    let tag = workspace.create_tag("Reviewed", None).expect("tag");

    apply_tag_proposal_impl(request(
        &root,
        "attach",
        vec![first.id.clone(), second.id.clone()],
        Some("Reviewed"),
        Some(tag.id.clone()),
    ))
    .expect("attach");
    assert!(workspace
        .read_entry(&first.id)
        .expect("first")
        .tags
        .contains(&tag.id));
    assert!(workspace
        .read_entry(&second.id)
        .expect("second")
        .tags
        .contains(&tag.id));

    apply_tag_proposal_impl(request(
        &root,
        "detach",
        vec![first.id.clone(), second.id.clone()],
        Some("Reviewed"),
        Some(tag.id.clone()),
    ))
    .expect("detach");
    assert!(!workspace
        .read_entry(&first.id)
        .expect("first")
        .tags
        .contains(&tag.id));
    assert!(!workspace
        .read_entry(&second.id)
        .expect("second")
        .tags
        .contains(&tag.id));
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn creates_a_tag_without_an_entry_target() {
    let root = test_root("create");
    Workspace::create(&root).expect("workspace");
    let response = apply_tag_proposal_impl(request(
        &root,
        "create",
        Vec::new(),
        Some("Important"),
        None,
    ))
    .expect("create");
    assert!(response.tags.iter().any(|tag| tag.name == "Important"));
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn attaches_a_hierarchical_tag_path() {
    let root = test_root("hierarchy");
    let workspace = Workspace::create(&root).expect("workspace");
    let entry = workspace.create_entry("Paper").expect("entry");

    apply_tag_proposal_impl(request(
        &root,
        "attach",
        vec![entry.id.clone()],
        Some("机器学习/大语言模型/智能体"),
        None,
    ))
    .expect("attach hierarchy");

    let tags = workspace.list_tags().expect("tags");
    assert_eq!(tags.len(), 3);
    let leaf = tags.iter().find(|tag| tag.name == "智能体").expect("leaf");
    assert!(workspace
        .read_entry(&entry.id)
        .expect("entry")
        .tags
        .contains(&leaf.id));
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn invalid_entry_leaves_no_created_tag_or_partial_attachment() {
    let root = test_root("preflight");
    let workspace = Workspace::create(&root).expect("workspace");
    let first = workspace.create_entry("First").expect("first entry");
    let result = apply_tag_proposal_impl(request(
        &root,
        "attach",
        vec![first.id.clone(), EntryId::from_string("missing")],
        Some("New tag"),
        None,
    ));
    assert!(result.is_err());
    assert!(workspace
        .read_entry(&first.id)
        .expect("first")
        .tags
        .is_empty());
    assert!(workspace.list_tags().expect("tags").is_empty());
    fs::remove_dir_all(root).expect("cleanup");
}

fn request(
    root: &Path,
    action: &str,
    entry_ids: Vec<EntryId>,
    name: Option<&str>,
    tag_id: Option<TagId>,
) -> ApplyTagProposalRequest {
    ApplyTagProposalRequest {
        action: action.to_string(),
        entry_ids,
        name: name.map(str::to_string),
        new_name: None,
        root: root.to_path_buf(),
        tag_id,
    }
}

fn test_root(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "neuink-tag-{label}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ))
}
