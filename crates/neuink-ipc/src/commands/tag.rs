use std::path::PathBuf;

use neuink_domain::{EntryMeta, TagId, TagMeta};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct ApplyTagProposalRequest {
    pub root: PathBuf,
    pub action: String,
    pub entry_ids: Vec<neuink_domain::EntryId>,
    pub name: Option<String>,
    pub new_name: Option<String>,
    pub tag_id: Option<TagId>,
}

#[derive(Debug, Serialize)]
pub struct ApplyTagProposalResponse {
    pub entries: Vec<EntryMeta>,
    pub tags: Vec<TagMeta>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTagRequest {
    pub root: PathBuf,
    pub name: String,
    pub parent_id: Option<TagId>,
}

#[derive(Debug, Deserialize)]
pub struct RenameTagRequest {
    pub root: PathBuf,
    pub tag_id: TagId,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct DeleteTagRequest {
    pub root: PathBuf,
    pub tag_id: TagId,
}

#[derive(Debug, Serialize)]
pub struct DeleteTagResponse {
    pub tags: Vec<TagMeta>,
    pub entries: Vec<EntryMeta>,
}

#[tauri::command]
pub fn create_tag(request: CreateTagRequest) -> Result<TagMeta, String> {
    let workspace =
        neuink_workspace::Workspace::open(&request.root).map_err(|error| error.to_string())?;
    workspace
        .create_tag(request.name, request.parent_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn rename_tag(request: RenameTagRequest) -> Result<TagMeta, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .rename_tag(&request.tag_id, request.name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_tag(request: DeleteTagRequest) -> Result<DeleteTagResponse, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .delete_tag(&request.tag_id)
        .map_err(|error| error.to_string())?;
    Ok(DeleteTagResponse {
        tags: workspace.list_tags().map_err(|error| error.to_string())?,
        entries: workspace
            .list_entries()
            .map_err(|error| error.to_string())?,
    })
}

#[tauri::command]
pub fn apply_tag_proposal(
    request: ApplyTagProposalRequest,
) -> Result<ApplyTagProposalResponse, String> {
    apply_tag_proposal_impl(request)
}

pub(super) fn apply_tag_proposal_impl(
    request: ApplyTagProposalRequest,
) -> Result<ApplyTagProposalResponse, String> {
    let workspace =
        neuink_workspace::Workspace::open(&request.root).map_err(|error| error.to_string())?;
    match request.action.as_str() {
        "create" => create_proposed_tag(&workspace, request.name)?,
        "rename" => rename_proposed_tag(&workspace, request.tag_id, request.new_name)?,
        "attach" | "detach" => apply_entry_tag_change(&workspace, &request)?,
        action => return Err(format!("unsupported Tag proposal action: {action}")),
    }
    Ok(ApplyTagProposalResponse {
        entries: workspace
            .list_entries()
            .map_err(|error| error.to_string())?,
        tags: workspace.list_tags().map_err(|error| error.to_string())?,
    })
}

fn create_proposed_tag(
    workspace: &neuink_workspace::Workspace,
    name: Option<String>,
) -> Result<(), String> {
    let name = required_text(name, "Tag proposal has no name")?;
    workspace
        .create_tag(name, None)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn rename_proposed_tag(
    workspace: &neuink_workspace::Workspace,
    tag_id: Option<TagId>,
    new_name: Option<String>,
) -> Result<(), String> {
    let tag_id = tag_id.ok_or_else(|| "Tag rename has no tagId".to_string())?;
    let name = required_text(new_name, "Tag rename has no newName")?;
    workspace
        .rename_tag(&tag_id, name)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn apply_entry_tag_change(
    workspace: &neuink_workspace::Workspace,
    request: &ApplyTagProposalRequest,
) -> Result<(), String> {
    if request.entry_ids.is_empty() {
        return Err("Entry Tag proposal has no target Entry".to_string());
    }
    let originals = request
        .entry_ids
        .iter()
        .map(|entry_id| {
            workspace
                .read_entry(entry_id)
                .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let (tag_id, created_root) = resolve_tag(workspace, request)?;
    let mut updated = Vec::new();
    for original in &originals {
        let mut next_tags = original.tags.clone();
        if request.action == "attach" && !next_tags.contains(&tag_id) {
            next_tags.push(tag_id.clone());
        } else if request.action == "detach" {
            next_tags.retain(|id| id != &tag_id);
        }
        if let Err(error) = workspace.update_entry_meta(
            &original.id,
            original.title.clone(),
            original.fields.clone(),
            next_tags,
        ) {
            rollback_tag_change(
                workspace,
                &updated,
                created_root.as_ref(),
                error.to_string(),
            )?;
        }
        updated.push(original.clone());
    }
    Ok(())
}

fn resolve_tag(
    workspace: &neuink_workspace::Workspace,
    request: &ApplyTagProposalRequest,
) -> Result<(TagId, Option<TagId>), String> {
    let tags = workspace.list_tags().map_err(|error| error.to_string())?;
    let matched = tags.iter().find(|tag| {
        request.tag_id.as_ref().is_some_and(|id| tag.id == *id)
            || request
                .name
                .as_ref()
                .is_some_and(|name| tag.name.eq_ignore_ascii_case(name))
    });
    match (matched, request.action.as_str()) {
        (Some(tag), _) => Ok((tag.id.clone(), None)),
        (None, "attach") => create_tag_path(workspace, request.name.clone()),
        (None, _) => Err("Tag detach target is unavailable".to_string()),
    }
}

fn create_tag_path(
    workspace: &neuink_workspace::Workspace,
    path: Option<String>,
) -> Result<(TagId, Option<TagId>), String> {
    let path = required_text(path, "Tag attach has no name")?;
    let mut parent_id = None;
    let mut created_root = None;
    for name in path
        .split('/')
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        let tags = workspace.list_tags().map_err(|error| error.to_string())?;
        let existing = tags
            .iter()
            .find(|tag| tag.parent_id == parent_id && tag.name.eq_ignore_ascii_case(name));
        if let Some(tag) = existing {
            parent_id = Some(tag.id.clone());
        } else {
            let tag = workspace
                .create_tag(name, parent_id.clone())
                .map_err(|error| error.to_string())?;
            if created_root.is_none() {
                created_root = Some(tag.id.clone());
            }
            parent_id = Some(tag.id);
        }
    }
    parent_id
        .map(|tag_id| (tag_id, created_root))
        .ok_or_else(|| "Tag attach path is empty".to_string())
}

fn rollback_tag_change(
    workspace: &neuink_workspace::Workspace,
    originals: &[EntryMeta],
    created_tag: Option<&TagId>,
    primary_error: String,
) -> Result<(), String> {
    for entry in originals.iter().rev() {
        workspace
            .update_entry_meta(
                &entry.id,
                entry.title.clone(),
                entry.fields.clone(),
                entry.tags.clone(),
            )
            .map_err(|error| format!("{primary_error}; Tag proposal rollback failed: {error}"))?;
    }
    if let Some(tag_id) = created_tag {
        workspace
            .delete_tag(tag_id)
            .map_err(|error| format!("{primary_error}; Tag cleanup failed: {error}"))?;
    }
    Err(primary_error)
}

fn required_text(value: Option<String>, message: &str) -> Result<String, String> {
    value
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| message.to_string())
}
