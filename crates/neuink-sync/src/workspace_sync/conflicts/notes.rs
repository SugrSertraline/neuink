use super::*;
use crate::workspace_sync::wire;
use crate::SyncClient;
use neuink_sync_protocol::{
    document::{EntityDocument, Resource},
    ObjectKind,
};
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
pub struct NoteComparison {
    #[serde(flatten)]
    pub detail: ConflictDetail,
    pub notes: [Option<Value>; 3],
}
fn resource(value: Option<&Value>) -> Result<Option<Resource>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let document = wire::decode(value)?;
    if document.kind != ObjectKind::Note {
        return Ok(None);
    }
    Ok(document
        .resources
        .into_iter()
        .find(|r| r.name == "note.json"))
}
fn note(
    workspace: &Workspace,
    binding: &WorkspaceSyncBinding,
    value: Option<&Value>,
) -> Result<Option<Value>, String> {
    let Some(resource) = resource(value)? else {
        return Ok(None);
    };
    if !workspace.sync_blob_path(binding, &resource.hash)?.exists() {
        return Ok(None);
    }
    if resource.size > 4 * 1024 * 1024 {
        return Err("正文超过比较窗口大小，请使用原编辑器处理".into());
    }
    let Ok(bytes) = workspace.read_sync_resource(binding, &resource) else {
        return Ok(None);
    };
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| "笔记正文格式无效".into())
}
pub(super) fn comparison(
    workspace: &Workspace,
    binding: &WorkspaceSyncBinding,
    detail: ConflictDetail,
) -> Result<NoteComparison, String> {
    let notes = [
        note(workspace, binding, detail.base.as_ref())?,
        note(workspace, binding, detail.local.as_ref())?,
        note(workspace, binding, detail.remote.content.as_ref())?,
    ];
    Ok(NoteComparison { detail, notes })
}
pub async fn download_notes(
    workspace: &Workspace,
    binding: &WorkspaceSyncBinding,
    id: &str,
    client: &SyncClient,
    access: &str,
) -> Result<NoteComparison, String> {
    let _active = active::acquire(workspace.layout().root())?;
    let mut replica = open(workspace, binding)?;
    observe(workspace, &mut replica, binding, true)?;
    crate::synchronize::validate_session(
        client,
        &Binding {
            server_id: binding.server_id.clone(),
            account_id: binding.account_id.clone(),
            library_id: binding.library_id.clone(),
        },
        &replica.protocol_epoch()?,
        access,
    )
    .await?;
    let detail = replica.conflict_detail(id)?;
    for value in [
        detail.base.as_ref(),
        detail.local.as_ref(),
        detail.remote.content.as_ref(),
    ] {
        if let Some(resource) = resource(value)? {
            if resource.size > 4 * 1024 * 1024 {
                return Err("正文超过比较窗口大小，请使用原编辑器处理".into());
            }
            let path = workspace.prepare_sync_download(binding, &resource)?;
            client
                .download_attachment(access, &resource.hash, resource.size, &path)
                .await?;
        }
    }
    comparison(workspace, binding, detail)
}
pub fn merge_note(
    workspace: &Workspace,
    binding: &WorkspaceSyncBinding,
    id: &str,
    token: &str,
    markdown: &str,
) -> Result<(), String> {
    let _active = active::acquire(workspace.layout().root())?;
    let mut replica = open(workspace, binding)?;
    observe(workspace, &mut replica, binding, true)?;
    let detail = replica.conflict_detail(id)?;
    if detail.token != token {
        return Err("冲突内容已更新，请重新比较后合并".into());
    }
    let local = detail
        .local
        .as_ref()
        .ok_or("本地已删除，请先选择保留版本")?;
    let remote = detail
        .remote
        .content
        .as_ref()
        .ok_or("云端已删除，请先选择保留版本")?;
    let mut merged_note = note(workspace, binding, Some(local))?.ok_or("请先读取双方正文")?;
    let mut other = note(workspace, binding, Some(remote))?.ok_or("请先读取双方正文")?;
    let local_doc = wire::decode(local)?;
    let remote_doc = wire::decode(remote)?;
    if local_doc.kind != ObjectKind::Note || remote_doc.kind != ObjectKind::Note {
        return Err("此对象请在原编辑器手工处理".into());
    }
    let extra = |doc: &EntityDocument| {
        doc.resources
            .iter()
            .filter(|r| r.name != "note.json")
            .cloned()
            .collect::<Vec<_>>()
    };
    let local_fields = merged_note.as_object_mut().ok_or("笔记格式无效")?;
    local_fields.remove("markdown");
    other
        .as_object_mut()
        .ok_or("笔记格式无效")?
        .remove("markdown");
    if merged_note != other
        || local_doc.payload != remote_doc.payload
        || local_doc.references != remote_doc.references
        || extra(&local_doc) != extra(&remote_doc)
    {
        return Err("标题、来源链接或附件也有差异，请在原编辑器核对后保留对应版本".into());
    }
    if markdown.len() > 4 * 1024 * 1024 {
        return Err("合并正文超过大小限制".into());
    }
    merged_note["markdown"] = Value::String(markdown.into());
    let bytes = serde_json::to_vec(&merged_note).map_err(|_| "合并正文编码失败")?;
    let resource = workspace.stage_sync_text(binding, &bytes)?;
    let mut merged_doc = local_doc.clone();
    for current in &mut merged_doc.resources {
        if current.name == "note.json" {
            *current = resource.clone();
        }
    }
    let change = neuink_workspace::sync_apply::SyncDocumentChange {
        expected: Some(local_doc),
        target: merged_doc.clone(),
    };
    let updates = std::collections::BTreeMap::from([(wire::entry_id(&merged_doc)?, vec![change])]);
    // Workspace validation and compare-and-swap happen before acknowledging the
    // choice. A crash at either boundary retains merged text or the conflict.
    workspace.apply_sync_entries(binding, &updates)?;
    replica.resolve_if_current(id, true, token)?;
    observe(workspace, &mut replica, binding, true)?;
    Ok(())
}
