use neuink_domain::{EntryId, NoteId};
use neuink_workspace::Workspace;
use serde_json::{json, Value};
use std::{path::Path, time::Duration};

const API: &str = "http://127.0.0.1:23119/api";

struct Origin { note_key: String, parent_key: String }

fn find_origin(root: &Path, entry_id: &EntryId, note_id: &NoteId) -> Result<Option<Origin>, String> {
    let workspace = Workspace::open_existing(root).map_err(|_| "NeuInk 资料库不可用。")?;
    workspace.read_entry(entry_id).map_err(|_| "论文条目不存在。")?;
    for source in workspace.zotero_sources(entry_id).map_err(|_| "无法读取 Zotero 来源记录。")? {
        if let Some((note_key, _)) = source.note_ids.iter().find(|(_, local_id)| *local_id == note_id) {
            let parent_key = source.item_id.split_once(':').map(|(_, key)| key).ok_or("Zotero 来源记录不完整。")?;
            if !valid_key(note_key) || !valid_key(parent_key) { return Err("Zotero 笔记标识无效。".into()); }
            return Ok(Some(Origin { note_key: note_key.clone(), parent_key: parent_key.to_owned() }));
        }
    }
    Ok(None)
}

fn valid_key(key: &str) -> bool { key.len() == 8 && key.bytes().all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit()) }

pub(super) fn origin(root: &Path, entry_id: &EntryId, note_id: &NoteId) -> Result<Option<Value>, String> {
    let workspace = Workspace::open_existing(root).map_err(|_| "NeuInk 资料库不可用。")?;
    workspace.zotero_note_status(entry_id, note_id).map(|status| status.map(|status| json!(status))).map_err(|_| "无法读取 Zotero 笔记的本地修改记录。".into())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(120)).build().map_err(|_| "无法连接 Zotero 本地 API。".into())
}

async fn read_note(client: &reqwest::Client, origin: &Origin) -> Result<Value, String> {
    let response = client.get(format!("{API}/users/0/items/{}", origin.note_key))
        .timeout(Duration::from_secs(5))
        .header("Zotero-API-Version", "3").send().await.map_err(|_| "无法连接 Zotero。请确认 Zotero 正在运行，并允许本机应用访问。")?;
    if !response.status().is_success() { return Err(format!("无法读取 Zotero 原笔记（HTTP {}）。群组资料库或未开启本地 API 时，请在 Zotero 中编辑。", response.status())); }
    let server_id = response.headers().get("Zotero-Server-ID").and_then(|value| value.to_str().ok()).ok_or("Zotero 版本过旧，无法安全写入笔记。")?.to_owned();
    let value: Value = response.json().await.map_err(|_| "Zotero 笔记响应无效。")?;
    if value.pointer("/data/itemType").and_then(Value::as_str) != Some("note") ||
       value.pointer("/data/parentItem").and_then(Value::as_str) != Some(origin.parent_key.as_str()) {
        return Err("Zotero 原笔记与当前论文的对应关系已变化，已停止写入。".into());
    }
    let version = value.get("version").and_then(Value::as_u64).ok_or("Zotero 笔记缺少版本号。")?;
    let html = value.pointer("/data/note").and_then(Value::as_str).unwrap_or("");
    Ok(json!({ "server_id": server_id, "version": version, "html": html }))
}

pub(super) async fn preview(root: &Path, entry_id: &EntryId, note_id: &NoteId) -> Result<Value, String> {
    let origin = find_origin(root, entry_id, note_id)?.ok_or("这不是从 Zotero 导入的笔记。")?;
    read_note(&client()?, &origin).await
}

pub(super) async fn overwrite(root: &Path, entry_id: &EntryId, note_id: &NoteId, html: &str,
    expected_version: u64, expected_server_id: &str, confirmed: bool) -> Result<Value, String> {
    if !confirmed { return Err("需要先确认覆盖 Zotero 原笔记。".into()); }
    if html.len() > 2_000_000 { return Err("笔记过大，无法写回 Zotero。".into()); }
    let origin = find_origin(root, entry_id, note_id)?.ok_or("这不是从 Zotero 导入的笔记。")?;
    let client = client()?;
    let current = read_note(&client, &origin).await?;
    if current["version"].as_u64() != Some(expected_version) || current["server_id"].as_str() != Some(expected_server_id) {
        return Err("Zotero 原笔记在确认后已变化。NeuInk 草稿已保留，请重新预览再确认。".into());
    }
    let backup = Workspace::open_existing(root).map_err(|_| "NeuInk 资料库不可用，未写入 Zotero。")?
        .backup_zotero_note_original(entry_id, note_id, expected_server_id, expected_version,
            current["html"].as_str().unwrap_or(""))
        .map_err(|_| "无法备份 Zotero 原笔记，已停止写入。请检查 NeuInk 资料库。")?;
    let auth = client.post(format!("{API}/local/authorize"))
        .header("Zotero-Server-ID", expected_server_id)
        .json(&json!({ "appName": "NeuInk" })).send().await.map_err(|_| "Zotero 授权请求失败，请确认 Zotero 正在运行。")?;
    if !auth.status().is_success() { return Err(format!("Zotero 没有授权写入（HTTP {}）。NeuInk 草稿已保留。", auth.status())); }
    let auth: Value = auth.json().await.map_err(|_| "Zotero 授权响应无效。")?;
    let key = auth.get("key").and_then(Value::as_str).ok_or("Zotero 未返回写入授权。")?;
    let response = client.patch(format!("{API}/users/0/items/{}", origin.note_key))
        .header("Zotero-API-Version", "3")
        .header("Zotero-Server-ID", expected_server_id)
        .header("Zotero-API-Key", key)
        .header("If-Unmodified-Since-Version", expected_version.to_string())
        .json(&json!({ "note": html })).send().await.map_err(|_| "Zotero 写入请求失败。NeuInk 草稿已保留。")?;
    if response.status() == reqwest::StatusCode::PRECONDITION_FAILED {
        return Err("Zotero 原笔记已变化。NeuInk 草稿已保留，请重新预览再确认。".into());
    }
    if !response.status().is_success() { return Err(format!("Zotero 拒绝写入（HTTP {}）。NeuInk 草稿已保留。", response.status())); }
    Workspace::open_existing(root).map_err(|_| "Zotero 已写入，但 NeuInk 同步记录保存失败，请重新检查来源。")?
        .record_zotero_note_write(entry_id, note_id, html).map_err(|_| "Zotero 已写入，但 NeuInk 同步记录保存失败，请重新检查来源。")?;
    Ok(json!({ "written": true, "backup_path": backup }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn refuses_unconfirmed_writes_before_opening_workspace_or_network() {
        let result = overwrite(Path::new("missing-workspace"), &EntryId::new(), &NoteId::new(),
            "<p>draft</p>", 1, "server", false).await;
        assert_eq!(result.unwrap_err(), "需要先确认覆盖 Zotero 原笔记。");
    }
}
