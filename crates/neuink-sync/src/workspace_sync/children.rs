use super::{observe::Observation, wire};
use crate::replica::Replica;
use neuink_sync_protocol::document::EntityDocument;
use neuink_workspace::{sync_journal::WorkspaceSyncBinding, trash::ChildEvent, Workspace};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn observe(
    workspace: &Workspace,
    binding: &WorkspaceSyncBinding,
    replica: &mut Replica,
    documents: &mut BTreeMap<String, EntityDocument>,
    scan: &mut Observation,
) -> Result<BTreeSet<String>, String> {
    let all = workspace
        .pending_child_lifecycle_events()
        .map_err(|e| e.to_string())?;
    let mut latest = BTreeMap::new();
    for event in &all {
        if replica.lifecycle_resolved(&event.event_id)? {
            workspace.acknowledge_child_lifecycle_event(binding,&event.event_id).map_err(|e|e.to_string())?;
            continue;
        }

        latest.insert(event.entity_id.clone(), event);
    }
    let mut groups: BTreeMap<String, Vec<&ChildEvent>> = BTreeMap::new();
    for (id, event) in latest {
        if event.restored {
            if documents.contains_key(&id) {
                for old in all.iter().filter(|e| e.entity_id == id) {
                    workspace
                        .acknowledge_child_lifecycle_event(binding, &old.event_id)
                        .map_err(|e| e.to_string())?;
                }
            }
        } else {
            groups
                .entry(event.entry_id.to_string())
                .or_default()
                .push(event);
        }
    }
    let conflicts: BTreeSet<_> = replica
        .conflicts()?
        .into_iter()
        .map(|c| c.object_id)
        .collect();
    let mut deleted = BTreeSet::new();
    for (entry, events) in groups {
        // Whole-entry lifecycle owns its group while the parent is in trash.
        let Some(parent) = documents.get(&format!("entry:{entry}")).cloned() else {
            continue;
        };
        if conflicts.contains(&parent.entity_id)
            || events.iter().any(|e| conflicts.contains(&e.entity_id))
        {
            scan.failures.push((
                entry.clone(),
                "子内容删除与云端版本冲突，已保留已保存内容和回收站".into(),
            ));
            continue;
        }
        if events
            .iter()
            .any(|e| e.issue.is_some() || e.documents.iter().all(|d| d.entity_id != e.entity_id))
        {
            scan.failures.push((
                entry.clone(),
                "子内容删除快照未就绪，已保留本地回收站".into(),
            ));
            continue;
        }
        let mut snapshot = parent.clone();
        for event in &events {
            if event.entity_id.starts_with("note:") {
                let source = event
                    .documents
                    .iter()
                    .find(|d| d.entity_id == parent.entity_id)
                    .ok_or("笔记删除缺少目录基线")?;
                let note = event
                    .entity_id
                    .strip_prefix("note:")
                    .ok_or("笔记标识无效")?;
                let item = source.payload["entry"]["contents"]
                    .as_array()
                    .and_then(|items| items.iter().find(|i| i["note_id"].as_str() == Some(note)))
                    .ok_or("笔记删除目录项缺失")?
                    .clone();
                let contents = snapshot.payload["entry"]["contents"]
                    .as_array_mut()
                    .ok_or("条目目录无效")?;
                if !contents.iter().any(|i| i["note_id"].as_str() == Some(note)) {
                    contents.push(item);
                }
                if !snapshot.references.contains(&event.entity_id) {
                    snapshot.references.push(event.entity_id.clone());
                    snapshot.references.sort();
                }
            }
        }
        let mut already_deleting = true;
        for event in &events {
            already_deleting &= replica.lifecycle_deleting(&event.event_id)?;
        }
        let mut settled =
            replica.settled_content(&snapshot.entity_id, Some(&wire::encode(&snapshot)?))?;
        for event in &events {
            for doc in event
                .documents
                .iter()
                .filter(|d| d.entity_id == event.entity_id)
            {
                settled &= replica.settled_content(&doc.entity_id, Some(&wire::encode(doc)?))?;
            }
        }
        if already_deleting || settled {
            for event in &events {
                replica.begin_lifecycle_delete(&event.event_id)?;
                let doc = event
                    .documents
                    .iter()
                    .find(|d| d.entity_id == event.entity_id)
                    .ok_or("删除快照缺失")?;
                replica.observe_workspace(&doc.entity_id, doc.kind.clone(), None)?;
                deleted.insert(doc.entity_id.clone());
                scan.ready.insert(doc.entity_id.clone());
                if replica.settled_content(&doc.entity_id, None)? {
                    for older in all
                        .iter()
                        .filter(|e| e.entity_id == event.entity_id && e.sequence <= event.sequence)
                    {
                        workspace
                            .acknowledge_child_lifecycle_event(binding, &older.event_id)
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
        } else {
            documents.insert(snapshot.entity_id.clone(), snapshot);
            for event in events {
                for doc in event
                    .documents
                    .iter()
                    .filter(|d| d.entity_id == event.entity_id)
                {
                    documents.insert(doc.entity_id.clone(), doc.clone());
                }
            }
        }
    }
    Ok(deleted)
}
