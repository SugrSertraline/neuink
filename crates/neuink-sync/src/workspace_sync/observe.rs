use super::wire;
use crate::replica::Replica;
use neuink_workspace::{
    sync_export::{export_entry, export_ideation, export_tags},
    sync_journal::WorkspaceSyncBinding,
    Workspace,
};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
pub(super) struct Observation {
    pub failures: Vec<(String, String)>,
    pub ready: BTreeSet<String>,
}
pub(super) fn observe(
    workspace: &Workspace,
    replica: &mut Replica,
    binding: &WorkspaceSyncBinding,
    stage: bool,
) -> Result<Observation, String> {
    observe_with_progress(workspace, replica, binding, stage, |_, _| {})
}

pub(super) fn observe_with_progress(
    workspace: &Workspace, replica: &mut Replica, binding: &WorkspaceSyncBinding,
    stage: bool, progress: impl Fn(usize, usize),
) -> Result<Observation, String> {
    let mut scan = Observation::default();
    let mut failed = BTreeSet::new();
    let events = if stage {
        workspace
            .pending_content_events()
            .map_err(|e| e.to_string())?
    } else {
        Vec::new()
    };
    let mut documents = BTreeMap::new();
    for tag in export_tags(workspace.layout().root()).map_err(|e| e.to_string())? {
        documents.insert(tag.entity_id.clone(), tag);
    }
    match export_ideation(workspace)
        .map_err(|e| e.to_string())
        .and_then(|doc| {
            doc.map(|document| wire::encode(&document).map(|_| document))
                .transpose()
        }) {
        Ok(Some(document)) => {
            documents.insert(document.entity_id.clone(), document);
        }
        Ok(None) => {}
        Err(error) => {
            failed.insert("board:ideation".into());
            scan.failures.push(("board:ideation".into(), error));
        }
    }
    let entries = workspace
        .list_entries()
        .map_err(|_| "无法读取本地条目清单")?;
    let total = entries.len();
    progress(0, total);
    for (index, entry) in entries.into_iter().enumerate() {
        if neuink_workspace::sync_export::is_source_cache(workspace.layout().root(), entry.id.as_str())
            .map_err(|e| e.to_string())? {
            replica.exclude_source_entry(entry.id.as_str())?;
            progress(index + 1, total);
            continue;
        }
        let result = (|| {
            let bundle = export_entry(workspace.layout().root(), entry.id.as_str())
                .map_err(|e| e.to_string())?;
            let mut needs_staging = false;
            for document in &bundle.manifest().documents {
                let encoded = wire::encode(document)?;
                needs_staging |= !replica.settled_content(&document.entity_id, Some(&encoded))?;
                if documents.contains_key(&document.entity_id) {
                    return Err("不同条目包含重复实体标识，未按标题合并".into());
                }
            }
            // Settled entities already have confirmed remote resources. Export
            // still hashes the current files; changed/pending bundles retain the
            // complete staging verification before publication.
            if stage && needs_staging {
                workspace.stage_sync_bundle(binding, &bundle)?;
            }
            for document in &bundle.manifest().documents {
                documents.insert(document.entity_id.clone(), document.clone());
            }
            Ok::<(), String>(())
        })();
        if let Err(error) = result {
            failed.insert(entry.id.to_string());
            scan.failures.push((entry.id.to_string(), error));
        }
        progress(index + 1, total);
    }
    let mut lifecycle =
        super::lifecycle::Lifecycle::load(workspace, binding, replica, &mut documents, &mut scan)?;
    let deleted_children =
        super::children::observe(workspace, binding, replica, &mut documents, &mut scan)?;
    failed.extend(scan.failures.iter().map(|(owner, _)| owner.clone()));
    for document in documents.values() {
        replica.observe_workspace(
            &document.entity_id,
            document.kind.clone(),
            Some(&wire::encode(document)?),
        )?;
        scan.ready.insert(document.entity_id.clone());
    }
    for (id,kind) in replica.resolved_deletions()? {
        if documents.contains_key(&id) || replica.settled_content(&id,None)? {replica.clear_resolved_deletion(&id)?;} else {
            replica.observe_workspace(&id,kind,None)?;scan.ready.insert(id);
        }
    }
    lifecycle.observe_deletions(workspace, binding, replica, &mut scan)?;
    failed.extend(lifecycle.blocked_owners().iter().cloned());
    let previous = replica.observed_workspace_documents()?;
    for (id, value) in &previous {
        let owner = wire::owner(&wire::decode(value)?)?;
        if !scan.ready.contains(id)
            && !failed.contains(&owner)
            && !lifecycle.owns_absence(id, &owner)
            && !deleted_children.contains(id)
        {
            failed.insert(owner.clone());
            scan.failures.push((
                owner,
                "本地内容缺失但没有可核验的删除意图；已暂停相关上传并保留队列".into(),
            ));
        }
    }
    // Remove a whole entry if a child disappeared, then propagate missing dependencies
    // until a fixed point. Cyclic source links are allowed when the entire set exists.
    loop {
        let mut removed = false;
        for document in documents.values() {
            let owner = wire::owner(document)?;
            if failed.contains(&owner)
                || wire::required_references(document).iter().any(|r| !scan.ready.contains(r))
            {
                if scan.ready.remove(&document.entity_id) {
                    failed.insert(owner.clone());
                    removed = true;
                    scan.failures.push((
                        owner,
                        "来源条目、解析或标签依赖尚未就绪，已保留待同步内容".into(),
                    ));
                }
            }
        }
        if !removed {
            break;
        }
    }
    // Files are staged and observations committed before save-event handoff.
    for event in events {
        let affected = event.affected_entities().map_err(|e| e.to_string())?;
        if !affected.is_empty() && affected.is_subset(&scan.ready) {
            workspace
                .acknowledge_content_event(binding, &event.event_id)
                .map_err(|e| e.to_string())?;
        }
    }
    scan.failures.sort();
    scan.failures.dedup();
    Ok(scan)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_cache_is_local_only_even_with_legacy_outbox_and_remote_echo() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let binding = super::super::test_support::binding();
        workspace.bind_sync(&binding).unwrap();
        let source = workspace.create_entry("Zotero cache").unwrap();
        workspace.create_note(&source.id, "Keep my notes").unwrap();
        let mut replica = super::super::test_support::replica(&workspace, &binding);
        observe(&workspace, &mut replica, &binding, true).unwrap();
        let legacy = replica.pending().unwrap();
        assert!(!legacy.is_empty());
        std::fs::write(workspace.layout().entry_dir(&source.id).join("zotero-source.json"),
            r#"[{"source_id":"library","item_id":"1:ABC12345","attachment_key":null,"collections":[]}]"#).unwrap();
        let scan = observe(&workspace, &mut replica, &binding, true).unwrap();
        assert!(scan.failures.is_empty(), "{:?}", scan.failures);
        assert!(replica.pending().unwrap().is_empty());
        assert!(replica.observed_workspace_documents().unwrap().is_empty());
        assert!(neuink_workspace::sync_inventory::preview(dir.path()).unwrap().files.is_empty());
        assert!(export_entry(dir.path(), source.id.as_str()).is_err());
        for (index, operation) in legacy.iter().enumerate() {
            let neuink_sync_protocol::Mutation::Put { content } = &operation.mutation else { panic!() };
            replica.receive(&crate::replica::RemoteChange { object_id: operation.object_id.clone(),
                kind: operation.kind.clone(), content: Some(content.clone()), deleted: false,
                revision: index as u64 + 1 }).unwrap();
        }
        assert!(replica.pending_projections().unwrap().is_empty());
        assert!(replica.conflicts().unwrap().is_empty());
        assert!(workspace.read_entry(&source.id).is_ok());
        drop(replica);
        let mut replica = super::super::test_support::replica(&workspace, &binding);
        assert!(replica.pending().unwrap().is_empty());
        assert!(replica.pending_projections().unwrap().is_empty());
        let local = workspace.copy_source_to_local(&source.id, false).unwrap();
        let scan = observe(&workspace, &mut replica, &binding, true).unwrap();
        assert!(scan.failures.is_empty(), "{:?}", scan.failures);
        assert!(scan.ready.contains(&format!("entry:{}", local.entry_id)));
        assert!(!scan.ready.contains(&format!("entry:{}", source.id)));
        assert!(!replica.pending().unwrap().is_empty());
    }
    #[test]
    fn malformed_source_identity_never_falls_back_to_local_paper_sync() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let binding = super::super::test_support::binding();
        workspace.bind_sync(&binding).unwrap();
        let source = workspace.create_entry("Broken source marker").unwrap();
        std::fs::write(workspace.layout().entry_dir(&source.id).join("zotero-source.json"), b"invalid").unwrap();
        let mut replica = super::super::test_support::replica(&workspace, &binding);
        assert!(observe(&workspace, &mut replica, &binding, true).is_err());
        assert!(replica.pending().unwrap().is_empty());
        assert!(neuink_workspace::sync_inventory::preview(dir.path()).is_err());
    }
    #[test]
    fn settled_bundles_skip_staging_but_new_content_is_staged_and_reported() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let binding = super::super::test_support::binding();
        workspace.bind_sync(&binding).unwrap();
        let entry = workspace.create_entry("Example").unwrap();
        workspace.create_note(&entry.id, "First").unwrap();
        let mut replica = super::super::test_support::replica(&workspace, &binding);
        observe(&workspace, &mut replica, &binding, true).unwrap();
        for (index, op) in replica.pending().unwrap().iter().enumerate() {
            replica.acknowledge(&op.operation_id, index as u64 + 1).unwrap();
        }
        let bundle = export_entry(workspace.layout().root(), entry.id.as_str()).unwrap();
        let resources: Vec<_> = bundle.manifest().documents.iter().flat_map(|d| &d.resources).collect();
        assert!(!resources.is_empty());
        let cached = workspace.sync_blob_path(&binding, &resources[0].hash).unwrap();
        std::fs::remove_file(&cached).unwrap();
        let progress = std::cell::RefCell::new(Vec::new());
        let scan = observe_with_progress(&workspace, &mut replica, &binding, true,
            |current, total| progress.borrow_mut().push((current, total))).unwrap();
        assert!(scan.failures.is_empty());
        assert!(!cached.exists(), "settled content must not stage attachments again");
        assert!(replica.pending().unwrap().is_empty());
        assert_eq!(*progress.borrow(), vec![(0, 1), (1, 1)]);
        workspace.create_note(&entry.id, "New saved content").unwrap();
        observe(&workspace, &mut replica, &binding, true).unwrap();
        assert!(cached.exists(), "changed bundle must still stage and validate resources");
        assert!(!replica.pending().unwrap().is_empty());
    }
    #[test]
    fn missing_directory_without_explicit_intent_never_queues_a_delete() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(directory.path()).unwrap();
        let binding = WorkspaceSyncBinding {
            server_id: "1".repeat(64),
            account_id: "2".repeat(64),
            library_id: "3".repeat(64),
            epoch: "4".repeat(64),
        };
        workspace.bind_sync(&binding).unwrap();
        let mut replica = Replica::open(
            &workspace.sync_replica_path(&binding).unwrap(),
            &neuink_sync_protocol::Binding {
                server_id: binding.server_id.clone(),
                account_id: binding.account_id.clone(),
                library_id: binding.library_id.clone(),
            },
            &binding.epoch,
        )
        .unwrap();
        let entry = workspace.create_entry("External rename").unwrap();
        let other = workspace.create_entry("Independent").unwrap();
        observe(&workspace, &mut replica, &binding, true).unwrap();
        let pending = replica.pending().unwrap();
        std::fs::rename(
            workspace.layout().entry_dir(&entry.id),
            directory.path().join("external-copy"),
        )
        .unwrap();
        let observation = observe(&workspace, &mut replica, &binding, true).unwrap();
        assert_eq!(replica.pending().unwrap(), pending);
        assert!(!observation.ready.contains(&format!("entry:{}", entry.id)));
        assert!(observation.ready.contains(&format!("entry:{}", other.id)));
        assert!(!observation.failures.is_empty());
    }

    #[test]
    fn deleted_entries_publish_last_saved_snapshot_before_tombstones_and_restore() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let binding = WorkspaceSyncBinding {
            server_id: "1".repeat(64),
            account_id: "2".repeat(64),
            library_id: "3".repeat(64),
            epoch: "4".repeat(64),
        };
        workspace.bind_sync(&binding).unwrap();
        let identity = neuink_sync_protocol::Binding {
            server_id: binding.server_id.clone(),
            account_id: binding.account_id.clone(),
            library_id: binding.library_id.clone(),
        };
        let mut replica = Replica::open(
            &workspace.sync_replica_path(&binding).unwrap(),
            &identity,
            &binding.epoch,
        )
        .unwrap();
        let removed = workspace.create_entry("Delete before upload").unwrap();
        let removed = workspace
            .create_note(&removed.id, "Retained in recycle bin")
            .unwrap();
        let other = workspace.create_entry("Independent").unwrap();
        let first = observe(&workspace, &mut replica, &binding, true).unwrap();
        assert_eq!(first.ready.len(), 3);
        assert!(workspace.pending_content_events().unwrap().is_empty());
        let pending = replica.pending().unwrap();
        let neuink_domain::ContentItem::Note { note_id, .. } = &removed.contents[0];
        workspace
            .update_note(
                &removed.id,
                note_id,
                "Note",
                "New save after the previous scan",
            )
            .unwrap();
        workspace.delete_entry(&removed.id).unwrap();
        let scan = observe(&workspace, &mut replica, &binding, true).unwrap();
        assert!(scan.ready.contains(&format!("entry:{}", other.id)));
        assert!(scan.failures.is_empty());
        assert_eq!(replica.pending().unwrap(), pending);
        let mut revision = 0;
        // A pre-existing in-flight operation is acknowledged first, followed by
        // the newer final note snapshot; deletion cannot overtake either.
        for _ in 0..2 {
            for op in replica.pending().unwrap() {
                revision += 1;
                replica.acknowledge(&op.operation_id, revision).unwrap();
            }
            observe(&workspace, &mut replica, &binding, true).unwrap();
        }
        let deletes = replica.pending().unwrap();
        assert_eq!(deletes.len(), 2);
        assert!(deletes
            .iter()
            .all(|op| matches!(op.mutation, neuink_sync_protocol::Mutation::Delete)));
        for op in deletes {
            revision += 1;
            replica.acknowledge(&op.operation_id, revision).unwrap();
        }
        observe(&workspace, &mut replica, &binding, true).unwrap();
        assert!(workspace
            .pending_entry_lifecycle_events()
            .unwrap()
            .is_empty());
        workspace.restore_entry(&removed.id).unwrap();
        let restored = observe(&workspace, &mut replica, &binding, true).unwrap();
        assert!(restored.failures.is_empty());
        assert_eq!(restored.ready, first.ready);
        assert!(replica
            .pending()
            .unwrap()
            .iter()
            .all(|op| matches!(op.mutation, neuink_sync_protocol::Mutation::Restore { .. })));
        assert!(workspace.pending_content_events().unwrap().is_empty());
    }
}
