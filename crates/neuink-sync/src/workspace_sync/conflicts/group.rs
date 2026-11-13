use super::*;
use crate::replica::ResolutionMember;
use crate::workspace_sync::wire;
use serde::Serialize;
use std::collections::BTreeMap;
#[derive(Serialize)]
pub struct GroupComparison {
    pub token: String,
    pub entry_id: String,
    pub members: Vec<ResolutionMember>,
    pub local_deleted: bool,
    pub remote_deleted: bool,
}
fn prepare(
    workspace: &Workspace,
    binding: &WorkspaceSyncBinding,
    replica: &mut Replica,
    id: &str,
) -> Result<(GroupComparison, Vec<String>), String> {
    observe(workspace, replica, binding, true)?;
    let detail = replica.conflict_detail(id)?;
    let value = detail
        .local
        .as_ref()
        .or(detail.remote.content.as_ref())
        .or(detail.base.as_ref())
        .ok_or("冲突没有可识别的条目")?;
    let doc = wire::decode(value)?;
    let entry = wire::entry_id(&doc)?;
    let entry_id = neuink_domain::EntryId::from_string(entry.clone());
    let mut local = BTreeMap::new();
    if workspace.layout().entry_dir(&entry_id).exists() {
        let bundle = neuink_workspace::sync_export::export_entry(workspace.layout().root(), &entry)
            .map_err(|e| e.to_string())?;
        workspace.stage_sync_bundle(binding, &bundle)?;
        for doc in &bundle.manifest().documents {
            local.insert(doc.entity_id.clone(), wire::encode(doc)?);
        }
    }
    let members = replica.resolution_members(&entry, &local)?;
    let parent = members
        .iter()
        .find(|m| m.id == format!("entry:{entry}"))
        .ok_or("删除冲突尚缺条目目录，请先同步完整")?;
    let local_deleted = parent.local.is_none();
    let remote_deleted = parent.remote.is_none();
    if !local_deleted && !remote_deleted && detail.local.is_some() && !detail.remote.deleted {
        return Err("此项不是删除冲突，请使用普通版本比较".into());
    }
    let mut events = workspace
        .pending_entry_lifecycle_events()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|e| e.entry_id == entry_id)
        .map(|e| e.event_id)
        .collect::<Vec<_>>();
    events.extend(
        workspace
            .pending_child_lifecycle_events()
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|e| e.entry_id == entry_id)
            .map(|e| e.event_id),
    );
    events.sort();
    let token = blake3::hash(
        serde_json::to_string(&(&members, &events))
            .map_err(|_| "冲突编码失败")?
            .as_bytes(),
    )
    .to_hex()
    .to_string();
    Ok((
        GroupComparison {
            token,
            entry_id: entry,
            members,
            local_deleted,
            remote_deleted,
        },
        events,
    ))
}
pub fn inspect(
    workspace: &Workspace,
    binding: &WorkspaceSyncBinding,
    id: &str,
) -> Result<GroupComparison, String> {
    let _active = active::acquire(workspace.layout().root())?;
    let mut replica = open(workspace, binding)?;
    Ok(prepare(workspace, binding, &mut replica, id)?.0)
}
pub fn resolve(
    workspace: &Workspace,
    binding: &WorkspaceSyncBinding,
    id: &str,
    token: &str,
    keep_local: bool,
) -> Result<(), String> {
    let _active = active::acquire(workspace.layout().root())?;
    let mut replica = open(workspace, binding)?;
    let (group, events) = prepare(workspace, binding, &mut replica, id)?;
    if group.token != token {
        return Err("整组内容已变化，请重新读取删除冲突".into());
    }
    replica.resolve_members(&group.members, keep_local, &events, token)
}
