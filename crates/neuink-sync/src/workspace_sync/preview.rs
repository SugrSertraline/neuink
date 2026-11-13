use super::wire;
use crate::SyncClient;
use neuink_workspace::{
    sync_export::{export_entry, export_ideation, export_tags},
    Workspace,
};
use serde::Serialize;
use serde_json::json;
use std::collections::BTreeMap;
#[derive(Serialize)]
pub struct Preview {
    pub token: String,
    pub entities: usize,
    pub new_attachment_bytes: u64,
    pub existing_attachment_bytes: u64,
    pub metadata_estimate_bytes: u64,
    pub overlapping_objects: u64,
    pub available_bytes: u64,
    pub issues: Vec<(String, String)>,
    pub omitted_scope: Vec<&'static str>,
}
pub async fn inspect(
    workspace: &Workspace,
    client: &SyncClient,
    library: &str,
    access: &str,
) -> Result<Preview, String> {
    if library.len() != 64 || !library.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("云端资料库标识无效".into());
    }
    let mut docs = BTreeMap::new();
    let mut issues = Vec::new();
    for doc in export_tags(workspace.layout().root()).map_err(|e| e.to_string())? {
        docs.insert(doc.entity_id.clone(), doc);
    }
    if let Some(doc) = export_ideation(workspace).map_err(|e| e.to_string())? {
        docs.insert(doc.entity_id.clone(), doc);
    }
    for entry in workspace.list_entries().map_err(|e| e.to_string())? {
        if neuink_workspace::sync_export::is_source_cache(workspace.layout().root(), entry.id.as_str())
            .map_err(|e| e.to_string())? { continue; }
        match export_entry(workspace.layout().root(), entry.id.as_str()) {
            Ok(bundle) => {
                for doc in &bundle.manifest().documents {
                    wire::encode(doc)?;
                    if docs.insert(doc.entity_id.clone(), doc.clone()).is_some() {
                        return Err("发现重复实体标识".into());
                    }
                }
            }
            Err(e) => issues.push((entry.id.to_string(), e.to_string())),
        }
    }
    loop {
        let missing: Vec<_> = docs
            .values()
            .filter(|d| wire::required_references(d).iter().any(|r| !docs.contains_key(r)))
            .map(|d| d.entity_id.clone())
            .collect();
        if missing.is_empty() {
            break;
        }
        for id in missing {
            docs.remove(&id);
            issues.push((id, "来源依赖尚未就绪".into()));
        }
    }
    let mut files = BTreeMap::new();
    let mut metadata = 0;
    for doc in docs.values() {
        metadata += wire::encode(doc)?.to_string().len() as u64;
        for resource in &doc.resources {
            if files
                .insert(resource.hash.clone(), resource.size)
                .is_some_and(|size| size != resource.size)
            {
                return Err("附件大小声明不一致".into());
            }
        }
    }
    let files = files
        .into_iter()
        .map(|(hash, size)| json!({"hash":hash,"size":size}))
        .collect::<Vec<_>>();
    let ids = docs.keys().cloned().collect::<Vec<_>>();
    let mut new_attachment_bytes = 0;
    let mut existing_attachment_bytes = 0;
    let mut overlapping_objects = 0;
    let batches = files.len().max(ids.len()).div_ceil(4096).max(1);
    for batch in 0..batches {
        let file_start = (batch * 4096).min(files.len());
        let id_start = (batch * 4096).min(ids.len());
        let value=client.request(reqwest::Method::POST,&format!("/v1/libraries/{library}/preview"),Some(access),Some(&json!({"files":&files[file_start..(file_start+4096).min(files.len())],"ids":&ids[id_start..(id_start+4096).min(ids.len())]}))).await?;
        new_attachment_bytes += value["new_attachment_bytes"]
            .as_u64()
            .ok_or("空间预览响应无效")?;
        existing_attachment_bytes += value["existing_attachment_bytes"]
            .as_u64()
            .ok_or("空间预览响应无效")?;
        overlapping_objects += value["overlapping_objects"]
            .as_u64()
            .ok_or("空间预览响应无效")?;
    }
    let storage = client
        .request(reqwest::Method::GET, "/v1/storage", Some(access), None)
        .await?;
    let available_bytes = storage["available_bytes"].as_u64().ok_or("空间响应无效")?;
    let token=blake3::hash(json!({"library":library,"documents":docs,"issues":issues,"new":new_attachment_bytes,"existing":existing_attachment_bytes,"overlaps":overlapping_objects,"available":available_bytes}).to_string().as_bytes()).to_hex().to_string();
    Ok(Preview{token,entities:ids.len(),new_attachment_bytes,existing_attachment_bytes,metadata_estimate_bytes:metadata,overlapping_objects,available_bytes,issues,omitted_scope:vec!["Zotero / MinerU 来源缓存仅保留本机；明确导入的独立本地副本可同步", "未确认 AI 草稿、聊天、凭据、缓存与运行环境仅保留本地", "原始解析 ZIP 和中间文件仅保留本地；云端同步可重建阅读所需的快照及图片，不承诺恢复原始解析工程", "首次绑定不上传已有本地回收站内容"]})
}
