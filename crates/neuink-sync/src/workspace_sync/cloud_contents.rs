//! A server snapshot for browsing, without observing or applying local changes.
use super::{rebaseline, wire};
use crate::{replica::RemoteChange, SyncClient};
use neuink_sync_protocol::{document::Resource, Binding, ObjectKind};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize)]
pub struct Item {
    id: String,
    kind: ObjectKind,
    title: String,
    parent_title: String,
    revision: u64,
    deleted: bool,
    fields: BTreeMap<String, String>,
    resources: Vec<Resource>,
}
#[derive(Serialize)]
pub struct Contents {
    revision: u64,
    items: Vec<Item>,
    attachment_bytes: u64,
    attachment_count: usize,
}
pub async fn inspect(client: &SyncClient, binding: &neuink_workspace::sync_journal::WorkspaceSyncBinding, access: &str) -> Result<Contents, String> {
    let identity = Binding { server_id: binding.server_id.clone(), account_id: binding.account_id.clone(), library_id: binding.library_id.clone() };
    let (_, revision, changes) = rebaseline::snapshot(client, &identity, access).await?;
    summarize(revision, changes)
}
fn summarize(revision: u64, changes: Vec<RemoteChange>) -> Result<Contents, String> {
    let mut titles = BTreeMap::new();
    let mut note_titles = BTreeMap::new();
    for change in &changes {
        if let Some(value) = &change.content {
            let doc = wire::decode(value)?;
            if doc.kind == ObjectKind::Entry {
                titles.insert(wire::entry_id(&doc)?, doc.payload["entry"]["title"].as_str().unwrap_or("未命名论文").to_owned());
                if let Some(notes) = doc.payload["entry"]["contents"].as_array() {
                    for note in notes {
                        if let (Some(id), Some(title)) = (note["note_id"].as_str(), note["title"].as_str()) {
                            note_titles.insert(format!("note:{id}"), title.to_owned());
                        }
                    }
                }
            }
        }
    }
    let mut files = BTreeMap::new();
    let mut items = Vec::new();
    for change in changes {
        let mut item = Item { id: change.object_id.clone(), kind: change.kind, title: change.object_id,
            parent_title: String::new(), revision: change.revision, deleted: change.deleted,
            fields: BTreeMap::new(), resources: Vec::new() };
        if let Some(value) = change.content {
            let doc = wire::decode(&value)?;
            item.parent_title = wire::owner(&doc).ok().and_then(|id| titles.get(&id).cloned()).unwrap_or_default();
            let source = match doc.kind {
                ObjectKind::Entry => &doc.payload["entry"],
                ObjectKind::Tag => &doc.payload["tag"],
                ObjectKind::Annotation => &doc.payload["annotation"],
                ObjectKind::SegmentNote => &doc.payload["note"],
                _ => &doc.payload,
            };
            item.title = source["title"].as_str().or_else(|| source["name"].as_str())
                .map(str::to_owned).or_else(|| note_titles.get(&item.id).cloned()).unwrap_or_else(|| match doc.kind {
                    ObjectKind::Entry => "未命名论文", ObjectKind::Note => "笔记", ObjectKind::Annotation => "批注",
                    ObjectKind::Tag => "标签", ObjectKind::SegmentNote => "片段笔记", ObjectKind::Card => "研究卡片",
                    ObjectKind::Board => "已确认构思", ObjectKind::Translation => "译文", ObjectKind::Fold => "阅读详略",
                    ObjectKind::ParseSnapshot => "阅读快照",
                }.into());
            for (key, label) in [("text", "内容"), ("markdown", "正文"), ("quote", "引用原文"), ("segment_count", "片段数量")] {
                if let Some(v) = source.get(key) {
                    if let Some(s) = v.as_str() { item.fields.insert(label.into(), s.into()); }
                    else if v.is_number() { item.fields.insert(label.into(), v.to_string()); }
                }
            }
            if let Some(fields) = source["fields"].as_object() {
                for (key, v) in fields { if let Some(s) = v.as_str() { item.fields.insert(key.clone(), s.into()); } }
            }
            for (key, label) in [("cards", "卡片数量"), ("links", "关联数量")] {
                if let Some(values) = source[key].as_array() { item.fields.insert(label.into(), values.len().to_string()); }
            }
            for resource in &doc.resources { files.insert(resource.hash.clone(), resource.size); }
            item.resources = doc.resources;
        }
        items.push(item);
    }
    Ok(Contents { revision, items, attachment_count: files.len(), attachment_bytes: files.values().sum() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use neuink_sync_protocol::document::EntityDocument;
    use serde_json::json;
    #[tokio::test]
    async fn browsing_uses_only_get_requests_and_does_not_acquire_sync_lock() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let client = SyncClient::new(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
        let binding = super::super::test_support::binding();
        let discovery = json!({"protocol_version":1,"server_id":binding.server_id,"epoch":binding.epoch});
        let account = binding.account_id.clone();
        let epoch = binding.epoch.clone();
        let server = std::thread::spawn(move || {
            for (path, body) in [
                ("/.well-known/neuink-sync", discovery.clone()),
                ("/.well-known/neuink-sync", discovery),
                ("/v1/me", json!({"account_id":account})),
                ("/snapshot?", json!({"objects":[],"revision":12,"epoch":epoch,"has_more":false,"after":""})),
            ] {
                let (mut stream, _) = listener.accept().unwrap();
                stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
                let mut request = Vec::new(); let mut byte = [0];
                while !request.ends_with(b"\r\n\r\n") { stream.read_exact(&mut byte).unwrap(); request.push(byte[0]); }
                let headers = String::from_utf8(request).unwrap();
                assert!(headers.starts_with("GET "));
                assert!(headers.lines().next().unwrap().contains(path));
                let body = body.to_string();
                write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            }
        });
        let dir = tempfile::tempdir().unwrap();
        let _sync = super::super::active::acquire(dir.path()).unwrap();
        let result = inspect(&client, &binding, "test-token").await.unwrap();
        assert_eq!(result.revision, 12);
        assert!(result.items.is_empty());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        server.join().unwrap();
    }
    #[test]
    fn summarizes_remote_titles_deletions_and_deduplicated_resources() {
        let doc = EntityDocument { schema_version: 1, entity_id: "entry:a".into(), kind: ObjectKind::Entry,
            payload: json!({"entry":{"id":"a","title":"Cloud title","fields":{"doi":"10/test"}}}), references: vec![],
            resources: vec![Resource{name:"paper.pdf".into(),hash:"a".repeat(64),size:42}] };
        let remote = |id: &str, content| RemoteChange {object_id:id.into(),kind:ObjectKind::Entry,revision:7,content,deleted:false};
        let mut second = doc.clone(); second.entity_id = "entry:b".into(); second.payload["entry"]["id"] = json!("b");
        let mut deleted = remote("entry:gone", None); deleted.deleted = true;
        let value = summarize(7, vec![remote("entry:a",Some(wire::encode(&doc).unwrap())),remote("entry:b",Some(wire::encode(&second).unwrap())),deleted]).unwrap();
        assert_eq!(value.items[0].title,"Cloud title");
        assert_eq!(value.items[0].fields["doi"],"10/test");
        assert!(value.items[2].deleted);
        assert_eq!((value.attachment_count,value.attachment_bytes),(1,42));
    }
}
