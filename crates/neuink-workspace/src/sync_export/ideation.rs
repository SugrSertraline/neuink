use neuink_sync_protocol::{
    document::{EntityDocument, ENTITY_SCHEMA_VERSION},
    ObjectKind,
};
use std::collections::BTreeSet;

use crate::{Workspace, WorkspaceError};

/// Export the confirmed graph as one unit so placements and links retain their endpoints.
pub fn export_ideation(workspace: &Workspace) -> Result<Option<EntityDocument>, WorkspaceError> {
    let snapshot = workspace.read_ideation()?;
    if snapshot.revision == "missing" {
        return Ok(None);
    }

    document(&snapshot.state).map(Some)
}

pub(crate) fn document(
    state: &crate::ideation::IdeationState,
) -> Result<EntityDocument, WorkspaceError> {
    if state
        .cards
        .iter()
        .any(|card| card.origin.as_deref() == Some("ai_draft"))
    {
        return Err(WorkspaceError::ContentTransaction(
            "构思包含尚未确认的 AI 卡片，请先核对后再同步".into(),
        ));
    }
    // Retain source identities for traceability. These are provenance references,
    // not prerequisites for the self-contained confirmed card/relationship snapshot.
    let references = state
        .cards
        .iter()
        .map(|card| card.entry_id.as_str())
        .chain(
            state
                .links
                .iter()
                .filter_map(|link| link.entry_id.as_deref()),
        )
        .filter(|id| !matches!(*id, "ideation-user" | "ideation-preset"))
        .map(|id| format!("entry:{id}"))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    Ok(EntityDocument {
        schema_version: ENTITY_SCHEMA_VERSION,
        entity_id: "board:ideation".into(),
        kind: ObjectKind::Board,
        payload: serde_json::to_value(state)?,
        resources: Vec::new(),
        references,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trashed_source_keeps_card_snapshot_syncable() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let entry = workspace.create_entry("Source paper").unwrap();
        let mut snapshot = workspace.read_ideation().unwrap();
        snapshot.state.cards.push(serde_json::from_value(serde_json::json!({
            "id":"retained-card", "entry_id":entry.id.as_str(), "title":"Retained idea",
            "body":"Retained content", "kind":"method", "origin":"ai_reviewed",
            "sources":[{"segment_uid":"segment-1","page_idx":0,"quote":"Retained quotation"}]
        })).unwrap());
        workspace.save_ideation(&snapshot.revision, snapshot.state).unwrap();
        workspace.delete_entry(&entry.id).unwrap();
        let document = export_ideation(&workspace).unwrap().unwrap();
        assert!(document.references.contains(&format!("entry:{}", entry.id)));
        assert_eq!(document.payload["cards"][0]["entry_id"], entry.id.as_str());
        assert_eq!(document.payload["cards"][0]["sources"][0]["quote"], "Retained quotation");
        let receiver_dir = tempfile::tempdir().unwrap();
        let receiver = Workspace::create(receiver_dir.path()).unwrap();
        let binding = crate::sync_journal::WorkspaceSyncBinding {
            server_id: "1".repeat(64), account_id: "2".repeat(64),
            library_id: "3".repeat(64), epoch: "4".repeat(64),
        };
        receiver.bind_sync(&binding).unwrap();
        receiver.apply_sync_ideation(&binding, &crate::sync_apply::SyncDocumentChange { expected: None, target: document.clone() }).unwrap();
        assert_eq!(export_ideation(&receiver).unwrap(), Some(document));
    }

    #[test]
    fn unconfirmed_cards_are_never_exported_or_removed() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let mut snapshot = workspace.read_ideation().unwrap();
        snapshot.state.cards.push(
            serde_json::from_value(serde_json::json!({
                "id":"draft-card", "entry_id":"paper", "title":"Draft",
                "body":"Unconfirmed content", "kind":"method", "origin":"ai_draft"
            }))
            .unwrap(),
        );
        let saved = workspace
            .save_ideation(&snapshot.revision, snapshot.state)
            .unwrap();
        assert!(export_ideation(&workspace).is_err());
        assert_eq!(workspace.read_ideation().unwrap().revision, saved.revision);
    }

    #[test]
    fn distinguishes_missing_state_from_a_saved_empty_graph() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        assert!(export_ideation(&workspace).unwrap().is_none());

        let initial = workspace.read_ideation().unwrap();
        workspace
            .save_ideation(&initial.revision, initial.state)
            .unwrap();
        let document = export_ideation(&workspace).unwrap().unwrap();
        assert_eq!(document.entity_id, "board:ideation");
        assert_eq!(document.payload["cards"], serde_json::json!([]));
    }
}
