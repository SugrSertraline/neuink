//! Offline conflict inspection and version-checked choices share the sync lock.
mod notes;
pub mod group;
use super::{active, observe::observe};
use crate::replica::{ConflictDetail, Replica};
use neuink_sync_protocol::Binding;
use neuink_workspace::{sync_journal::WorkspaceSyncBinding, Workspace};
pub use notes::{download_notes, merge_note, NoteComparison};

/// Display-only count: no exclusive task lock, journal creation or observation.
pub fn count(workspace: &Workspace, binding: &WorkspaceSyncBinding) -> Result<usize, String> {
    let path = workspace.sync_replica_path(binding)?;
    if !path.exists() { return Ok(0); }
    let replica = Replica::read_snapshot(&path, &Binding {
        server_id: binding.server_id.clone(), account_id: binding.account_id.clone(), library_id: binding.library_id.clone(),
    }, &binding.epoch)?;
    replica.conflict_count()
}

fn open(workspace: &Workspace, binding: &WorkspaceSyncBinding) -> Result<Replica, String> {
    Replica::open(
        &workspace.sync_replica_path(binding)?,
        &Binding {
            server_id: binding.server_id.clone(),
            account_id: binding.account_id.clone(),
            library_id: binding.library_id.clone(),
        },
        &binding.epoch,
    )
}

pub fn list(workspace: &Workspace, binding: &WorkspaceSyncBinding) -> Result<Vec<String>, String> {
    let _active = active::acquire(workspace.layout().root())?;
    let replica = open(workspace, binding)?;
    Ok(replica
        .conflicts()?
        .into_iter()
        .map(|c| c.object_id)
        .collect())
}

pub fn detail(
    workspace: &Workspace,
    binding: &WorkspaceSyncBinding,
    id: &str,
) -> Result<NoteComparison, String> {
    let _active = active::acquire(workspace.layout().root())?;
    let mut replica = open(workspace, binding)?;
    observe(workspace, &mut replica, binding, true)?;
    notes::comparison(workspace, binding, replica.conflict_detail(id)?)
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
    // Refresh saved edits before checking the displayed token. Never resolve a
    // stale comparison, including edits saved while the dialog was open.
    observe(workspace, &mut replica, binding, true)?;
    let detail=replica.conflict_detail(id)?;
    if detail.local.is_none() || detail.remote.deleted {return Err("删除冲突涉及条目及子内容，请使用整组删除冲突处理".into());}
    replica.resolve_if_current(id, keep_local, token)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manual_note_merge_is_saved_and_queued_against_remote_revision() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(directory.path()).unwrap();
        let binding = WorkspaceSyncBinding {
            server_id: "1".repeat(64),
            account_id: "2".repeat(64),
            library_id: "3".repeat(64),
            epoch: "4".repeat(64),
        };
        workspace.bind_sync(&binding).unwrap();
        let entry = workspace.create_entry("Paper").unwrap();
        let entry = workspace.create_note(&entry.id, "Note").unwrap();
        let neuink_domain::ContentItem::Note { note_id, .. } = &entry.contents[0];
        workspace
            .update_note(&entry.id, note_id, "Note", "Base")
            .unwrap();
        let id = format!("note:{note_id}");
        let mut replica = open(&workspace, &binding).unwrap();
        observe(&workspace, &mut replica, &binding, true).unwrap();
        for (index, operation) in replica.pending().unwrap().into_iter().enumerate() {
            replica
                .acknowledge(&operation.operation_id, index as u64 + 1)
                .unwrap();
        }
        let mut remote =
            crate::workspace_sync::wire::decode(&replica.content(&id).unwrap().unwrap()).unwrap();
        let resource = remote
            .resources
            .iter_mut()
            .find(|r| r.name == "note.json")
            .unwrap();
        let mut body: serde_json::Value =
            serde_json::from_slice(&workspace.read_sync_resource(&binding, resource).unwrap())
                .unwrap();
        body["markdown"] = serde_json::json!("Remote text");
        *resource = workspace
            .stage_sync_text(&binding, &serde_json::to_vec(&body).unwrap())
            .unwrap();
        workspace
            .update_note(&entry.id, note_id, "Note", "Local text")
            .unwrap();
        observe(&workspace, &mut replica, &binding, true).unwrap();
        replica
            .receive(&crate::replica::RemoteChange {
                object_id: id.clone(),
                kind: neuink_sync_protocol::ObjectKind::Note,
                content: Some(crate::workspace_sync::wire::encode(&remote).unwrap()),
                deleted: false,
                revision: 99,
            })
            .unwrap();
        drop(replica);
        let comparison = detail(&workspace, &binding, &id).unwrap();
        assert_eq!(
            comparison.notes[2].as_ref().unwrap()["markdown"],
            "Remote text"
        );
        merge_note(
            &workspace,
            &binding,
            &id,
            &comparison.detail.token,
            "Local text and remote text",
        )
        .unwrap();
        assert_eq!(
            workspace.read_note(&entry.id, note_id).unwrap().markdown,
            "Local text and remote text"
        );
        assert!(list(&workspace, &binding).unwrap().is_empty());
        let operation = open(&workspace, &binding)
            .unwrap()
            .pending()
            .unwrap()
            .into_iter()
            .find(|op| op.object_id == id)
            .unwrap();
        assert_eq!(operation.base_revision, Some(99));
    }
    #[test]
    fn conflict_choice_rechecks_real_workspace_saves_before_resolving() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(directory.path()).unwrap();
        let binding = WorkspaceSyncBinding {
            server_id: "1".repeat(64),
            account_id: "2".repeat(64),
            library_id: "3".repeat(64),
            epoch: "4".repeat(64),
        };
        workspace.bind_sync(&binding).unwrap();
        let entry = workspace.create_entry("Base").unwrap();
        let id = format!("entry:{}", entry.id);
        let mut replica = open(&workspace, &binding).unwrap();
        observe(&workspace, &mut replica, &binding, true).unwrap();
        let operation = replica.pending().unwrap().remove(0);
        replica.acknowledge(&operation.operation_id, 1).unwrap();
        let mut remote = replica.content(&id).unwrap().unwrap();
        remote["document"]["payload"]["entry"]["title"] = serde_json::json!("Remote");
        workspace
            .update_entry_meta(&entry.id, "Local", Default::default(), vec![])
            .unwrap();
        observe(&workspace, &mut replica, &binding, true).unwrap();
        replica
            .receive(&crate::replica::RemoteChange {
                object_id: id.clone(),
                kind: neuink_sync_protocol::ObjectKind::Entry,
                content: Some(remote),
                deleted: false,
                revision: 2,
            })
            .unwrap();
        drop(replica);
        assert_eq!(list(&workspace, &binding).unwrap(), vec![id.clone()]);
        {
            let _sync = active::acquire(workspace.layout().root()).unwrap();
            assert_eq!(count(&workspace, &binding).unwrap(), 1);
        }
        let comparison = detail(&workspace, &binding, &id).unwrap();
        workspace
            .update_entry_meta(
                &entry.id,
                "Edited while comparing",
                Default::default(),
                vec![],
            )
            .unwrap();
        assert!(resolve(&workspace, &binding, &id, &comparison.detail.token, false).is_err());
        assert_eq!(
            workspace.read_entry(&entry.id).unwrap().title,
            "Edited while comparing"
        );
        let current = detail(&workspace, &binding, &id).unwrap();
        assert_ne!(current.detail.token, comparison.detail.token);
        resolve(&workspace, &binding, &id, &current.detail.token, true).unwrap();
        assert!(list(&workspace, &binding).unwrap().is_empty());
        assert_eq!(count(&workspace, &binding).unwrap(), 0);
        let mut replica = open(&workspace, &binding).unwrap();
        assert_eq!(replica.pending().unwrap()[0].base_revision, Some(2));
    }
}
