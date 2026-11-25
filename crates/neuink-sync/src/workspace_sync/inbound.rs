use super::{wire, WorkspaceSyncResult};
use crate::{
    replica::{Projection, Replica},
    SyncClient,
};
use neuink_sync_protocol::{document::EntityDocument, ObjectKind};
use neuink_workspace::{
    sync_apply::SyncDocumentChange, sync_journal::WorkspaceSyncBinding, Workspace,
};
use std::collections::{BTreeMap, BTreeSet};
type Item = (Projection, EntityDocument);
fn changes(items: &[Item]) -> Result<Vec<SyncDocumentChange>, String> {
    items
        .iter()
        .map(|(p, d)| {
            Ok(SyncDocumentChange {
                expected: p.expected.as_ref().map(wire::decode).transpose()?,
                target: d.clone(),
            })
        })
        .collect()
}
fn references(items: &[Item]) -> BTreeSet<String> {
    items
        .iter()
        .flat_map(|(_, d)| &d.references)
        .filter_map(|r| {
            r.strip_prefix("entry:")
                .or_else(|| r.strip_prefix("parse:"))
        })
        .map(str::to_owned)
        .collect()
}
pub(super) async fn apply(
    workspace: &Workspace,
    client: &SyncClient,
    binding: &WorkspaceSyncBinding,
    access: &str,
    replica: &mut Replica,
    result: &mut WorkspaceSyncResult,
) -> Result<(), String> {
    let projections = replica.pending_projections_limit(10000)?;
    if projections.len() == 10000 {
        return Err("入站积压超过当前批次限制，已保留队列等待分批处理".into());
    }
    let mut groups: BTreeMap<String, Vec<Item>> = BTreeMap::new();
    let mut deletions: BTreeMap<String, Vec<(Projection, EntityDocument)>> = BTreeMap::new();
    let mut tags = Vec::new();
    let mut ideation = Vec::new();
    for projection in projections {
        let Some(value) = &projection.target else {
            if let Some(expected) = &projection.expected {
                let document = wire::decode(expected)?;
                if document.kind == ObjectKind::Tag || document.entity_id == "board:ideation" {
                    result.failures.push((
                        projection.object_id,
                        "该实体的删除仍需单独处理，已保留本地内容".into(),
                    ));
                } else {
                    deletions
                        .entry(wire::entry_id(&document)?)
                        .or_default()
                        .push((projection, document));
                }
            }
            continue;
        };
        let document = match wire::decode(value) {
            Ok(d) if d.entity_id == projection.object_id => d,
            _ => {
                result.failures.push((
                    projection.object_id,
                    "远端实体格式或标识无效，未应用".into(),
                ));
                continue;
            }
        };
        if document.kind == ObjectKind::Tag {
            tags.push((projection, document));
        } else if document.entity_id == "board:ideation" {
            ideation.push((projection, document));
        } else {
            groups
                .entry(wire::entry_id(&document)?)
                .or_default()
                .push((projection, document));
        }
    }
    let parent_delete_conflicts: BTreeSet<_> = replica
        .conflicts()?
        .into_iter()
        .filter(|c| c.kind == ObjectKind::Entry && c.deleted)
        .map(|c| c.object_id)
        .collect();
    let mut child_deletions = BTreeMap::new();
    for entry in deletions.keys().cloned().collect::<Vec<_>>() {
        if !parent_delete_conflicts.contains(&format!("entry:{entry}"))
            && deletions
                .get(&entry)
                .is_some_and(|items| items.iter().all(|(_, d)| d.kind != ObjectKind::Entry))
        {
            if let Some(items) = deletions.remove(&entry) {
                child_deletions.insert(entry.clone(), items);
                groups.entry(entry).or_default();
            }
        }
    }
    if !tags.is_empty() {
        client.phase("applying");
        match changes(&tags).and_then(|updates| workspace.apply_sync_tags(binding, &updates)) {
            Ok(_) => {
                for (p, _) in &tags {
                    replica.acknowledge_projection(&p.object_id, &p.token)?;
                }
                result.applied += tags.len();
            }
            Err(error) => result.failures.push(("tags".into(), error)),
        }
    }
    while let Some((first, items)) = groups.pop_first() {
        let mut related = references(&items);
        let mut connected = BTreeMap::from([(first.clone(), items)]);
        loop {
            let keys = groups
                .iter()
                .filter(|(entry, items)| {
                    related.contains(*entry)
                        || references(items).iter().any(|r| connected.contains_key(r))
                })
                .map(|(entry, _)| entry.clone())
                .collect::<Vec<_>>();
            if keys.is_empty() {
                break;
            }
            for key in keys {
                if let Some(items) = groups.remove(&key) {
                    related.extend(references(&items));
                    connected.insert(key, items);
                }
            }
        }
        let applied = async {
            let mut downloaded = BTreeSet::new();
            let mut updates = BTreeMap::new();
            let mut downloads = Vec::new();
            for (entry, items) in &connected {
                for (_, document) in items {
                    for resource in &document.resources {
                        if downloaded.insert(resource.hash.clone()) {
                            let path = workspace.prepare_sync_download(binding, resource)?;
                            downloads.push((resource.clone(), path));
                        }
                    }
                }
                updates.insert(entry.clone(), changes(items)?);
            }
            if !downloads.is_empty() { client.phase("downloading"); }
            for (resource, _) in &downloads {
                client.file_progress(false, &resource.hash, 0, resource.size);
            }
            super::transfer::run(downloads, |(resource, path)| async move {
                client
                    .download_attachment(access, &resource.hash, resource.size, &path)
                    .await
            })
            .await?;
            client.phase("applying");
            let mut removed: BTreeMap<String, Vec<EntityDocument>> = connected
                .keys()
                .filter_map(|entry| {
                    child_deletions.get(entry).map(|items| {
                        (
                            entry.clone(),
                            items.iter().map(|(_, d)| d.clone()).collect(),
                        )
                    })
                })
                .collect();
            for (entry, items) in &connected {
                if items.iter().all(|(p, _)| p.expected.is_none())
                    && items
                        .iter()
                        .any(|(_, d)| d.entity_id == format!("entry:{entry}"))
                {
                    let targets = items.iter().map(|(_, d)| d.clone()).collect::<Vec<_>>();
                    if let Some(previous) =
                        workspace.prepare_sync_entry_restore(binding, entry, &targets)?
                    {
                        for doc in &previous {
                            if !targets
                                .iter()
                                .any(|target| target.entity_id == doc.entity_id)
                            {
                                removed.entry(entry.clone()).or_default().push(doc.clone());
                            }
                        }
                        let previous: BTreeMap<_, _> = previous
                            .into_iter()
                            .map(|d| (d.entity_id.clone(), d))
                            .collect();
                        if let Some(changes) = updates.get_mut(entry) {
                            for change in changes {
                                change.expected = previous.get(&change.target.entity_id).cloned();
                            }
                        }
                    }
                }
            }
            workspace.apply_sync_entries_with_deletions(binding, &updates, &removed)?;
            let mut tokens = connected
                .values()
                .flatten()
                .map(|(p, _)| (p.object_id.clone(), p.token.clone()))
                .collect::<Vec<_>>();
            for entry in connected.keys() {
                if let Some(items) = child_deletions.get(entry) {
                    tokens.extend(
                        items
                            .iter()
                            .map(|(p, _)| (p.object_id.clone(), p.token.clone())),
                    );
                }
            }
            replica.acknowledge_projection_group(&tokens)?;
            Ok::<(), String>(())
        }
        .await;
        match applied {
            Ok(()) => {
                result.applied += connected.values().map(Vec::len).sum::<usize>()
                    + connected
                        .keys()
                        .filter_map(|key| child_deletions.get(key))
                        .map(Vec::len)
                        .sum::<usize>()
            }
            Err(error) => result.failures.push((first, error)),
        }
        client.object_progress(result.published, result.received, result.applied);
    }
    client.phase("applying");
    for (entry, items) in deletions {
        let expected = items.iter().map(|(_, d)| d.clone()).collect::<Vec<_>>();
        match workspace.apply_sync_entry_deletion(binding, &entry, &expected) {
            Ok(()) => {
                replica.acknowledge_projection_group(
                    &items
                        .iter()
                        .map(|(p, _)| (p.object_id.clone(), p.token.clone()))
                        .collect::<Vec<_>>(),
                )?;
                result.applied += items.len();
            }
            Err(error) => result.failures.push((entry, error)),
        }
    }
    for item in &ideation {
        let projection = &item.0;
        match changes(std::slice::from_ref(item))
            .and_then(|updates| workspace.apply_sync_ideation(binding, &updates[0]))
        {
            Ok(()) => {
                replica.acknowledge_projection(&projection.object_id, &projection.token)?;
                result.applied += 1;
            }
            Err(error) => result.failures.push((projection.object_id.clone(), error)),
        }
    }
    client.object_progress(result.published, result.received, result.applied);
    Ok(())
}
