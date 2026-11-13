//! Saved workspace content versus the server-acknowledged replica baseline.
use super::wire;
use crate::replica::Replica;
use neuink_workspace::{sync_export, Workspace};
use std::collections::BTreeMap;
#[path = "entry_status_cache.rs"]
mod cache;

pub fn inspect(workspace: &Workspace) -> Result<BTreeMap<String, &'static str>, String> {
    let binding = workspace.sync_binding().map_err(|e| e.to_string())?;
    let replica = if let Some(b) = &binding {
        let path = workspace.sync_replica_path(b)?;
        if path.exists() { Some(Replica::read_snapshot(&path,
            &neuink_sync_protocol::Binding { server_id:b.server_id.clone(), account_id:b.account_id.clone(), library_id:b.library_id.clone() }, &b.epoch)?) }
        else { None }
    } else { None };
    let conflicts: std::collections::BTreeSet<_> = replica.as_ref().map(|r| r.conflicts()).transpose()?.unwrap_or_default().into_iter().map(|c|c.object_id).collect();
    let previous = replica.as_ref().map(|r|r.observed_workspace_documents()).transpose()?.unwrap_or_default();
    let mut previous_by_owner: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (old_id, value) in previous {
        previous_by_owner.entry(wire::owner(&wire::decode(&value)?)?).or_default().push(old_id);
    }
    let mut states = BTreeMap::new();
    for entry in workspace.list_entries().map_err(|e|e.to_string())? {
        let id = entry.id.to_string();
        let state = match sync_export::is_source_cache(workspace.layout().root(), &id) {
            Ok(true) => "source",
            Err(_) => "error",
            Ok(false) => if let Some(replica) = &replica {
                match cache::documents(workspace, &id) {
                    Err(_) => "error",
                    Ok(docs) => {
                        if docs.keys().any(|id|conflicts.contains(id)) { "conflict" }
                        else {
                            let mut settled = true;
                            for old_id in previous_by_owner.get(&id).into_iter().flatten() {
                                if !docs.contains_key(old_id) { settled = false; }
                            }
                            for (id, value) in &docs { settled &= replica.settled_content(id, Some(value))?; }
                            if settled { "synced" } else { "pending" }
                        }
                    }
                }
            } else if binding.is_some() { "pending" } else { "local" },
        };
        states.insert(id, state);
    }
    Ok(states)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn status_inspection_does_not_compete_with_an_active_sync_task() {
        let dir = tempfile::tempdir().unwrap();
        let ws = Workspace::create(dir.path()).unwrap();
        let b = super::super::test_support::binding();
        ws.bind_sync(&b).unwrap();
        ws.create_entry("Paper").unwrap();
        let mut writer = super::super::test_support::replica(&ws, &b);
        super::super::observe::observe(&ws, &mut writer, &b, true).unwrap();
        let _sync = super::super::active::acquire(dir.path()).unwrap();
        assert_eq!(super::super::conflicts::count(&ws, &b).unwrap(), 0);
        assert!(inspect(&ws).is_ok(), "reading status must not require the sync task lock");
        let snapshot = Replica::read_snapshot(&ws.sync_replica_path(&b).unwrap(),
            &neuink_sync_protocol::Binding { server_id:b.server_id.clone(),account_id:b.account_id.clone(),library_id:b.library_id.clone() }, &b.epoch).unwrap();
        for (i, op) in writer.pending().unwrap().iter().enumerate() {
            writer.acknowledge(&op.operation_id, i as u64 + 1).unwrap();
        }
        drop(snapshot);
        assert!(inspect(&ws).unwrap().values().all(|state| *state == "synced"));
    }
    #[test]
    fn only_current_confirmed_content_is_synced_and_sources_are_excluded() {
        let dir = tempfile::tempdir().unwrap();
        let ws = Workspace::create(dir.path()).unwrap();
        let entry = ws.create_entry("Local").unwrap();
        assert_eq!(inspect(&ws).unwrap()[entry.id.as_str()], "local");
        let b = super::super::test_support::binding();
        ws.bind_sync(&b).unwrap();
        assert_eq!(inspect(&ws).unwrap()[entry.id.as_str()], "pending");
        let mut replica = super::super::test_support::replica(&ws,&b);
        super::super::observe::observe(&ws,&mut replica,&b,true).unwrap();
        for (i,op) in replica.pending().unwrap().iter().enumerate() { replica.acknowledge(&op.operation_id,i as u64+1).unwrap(); }
        assert_eq!(inspect(&ws).unwrap()[entry.id.as_str()], "synced");
        ws.create_note(&entry.id,"New unsynced note").unwrap();
        assert_eq!(inspect(&ws).unwrap()[entry.id.as_str()], "pending");
        std::fs::write(ws.layout().entry_dir(&entry.id).join("zotero-source.json"),b"[{}]").unwrap();
        assert_eq!(inspect(&ws).unwrap()[entry.id.as_str()], "source");
    }
}
