use super::{error, Result, SyncDocumentChange};
use crate::{
    ideation::IdeationState, sync_export::ideation::document, sync_journal::WorkspaceSyncBinding,
    Workspace,
};

impl Workspace {
    pub fn apply_sync_ideation(
        &self,
        binding: &WorkspaceSyncBinding,
        change: &SyncDocumentChange,
    ) -> Result<()> {
        self.check_sync_binding(binding)?;
        let state: IdeationState =
            serde_json::from_value(change.target.payload.clone()).map_err(error)?;
        if state.version != 2 || document(&state).map_err(error)? != change.target {
            return Err("远端构思格式或引用不一致".into());
        }
        let snapshot = self.read_ideation().map_err(error)?;
        let current = if snapshot.revision == "missing" {
            None
        } else {
            Some(document(&snapshot.state).map_err(error)?)
        };
        if current.as_ref() == Some(&change.target) {
            return Ok(());
        }
        if current != change.expected {
            return Err("本地构思已修改，已保留冲突版本".into());
        }
        for reference in &change.target.references {
            let id = reference.strip_prefix("entry:").ok_or("构思引用无效")?;
            crate::tag_reading::validate_id(id).map_err(error)?;
            // Preserve provenance even when the paper was trashed, purged, or has
            // not arrived on this device. Card bodies and quoted evidence travel
            // in the validated board payload; opening the source remains optional.
        }
        self.save_ideation(&snapshot.revision, state)
            .map_err(error)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_export::export_ideation;

    #[test]
    fn applies_confirmed_state_and_preserves_divergent_local_edits() {
        let left = tempfile::tempdir().unwrap();
        let right = tempfile::tempdir().unwrap();
        let source = Workspace::create(left.path()).unwrap();
        let receiver = Workspace::create(right.path()).unwrap();
        let binding = WorkspaceSyncBinding {
            server_id: "1".repeat(64),
            account_id: "2".repeat(64),
            library_id: "3".repeat(64),
            epoch: "4".repeat(64),
        };
        receiver.bind_sync(&binding).unwrap();

        let mut snapshot = source.read_ideation().unwrap();
        snapshot.state.boards.push(crate::ideation::IdeationBoard {
            id: "board-1".into(),
            title: "Confirmed research".into(),
            description: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
            deleted_at: None,
            viewport: None,
        });
        for (id, entry_id, origin) in [
            ("local-idea-board-1", "ideation-user", None),
            ("preset-method", "ideation-preset", Some("preset")),
        ] {
            snapshot.state.cards.push(crate::ideation::IdeationCard {
                id: id.into(),
                entry_id: entry_id.into(),
                title: id.into(),
                body: "Retained user text".into(),
                kind: "idea".into(),
                origin: origin.map(str::to_owned),
                pattern_ids: Vec::new(),
                sources: Vec::new(),
            });
            snapshot
                .state
                .placements
                .push(crate::ideation::IdeationPlacement {
                    id: format!("placement-{id}"),
                    card_id: id.into(),
                    board_id: Some("board-1".into()),
                    title: None,
                    body: None,
                    x: 10.0,
                    y: 20.0,
                    slot: None,
                    locked: false,
                });
        }
        source
            .save_ideation(&snapshot.revision, snapshot.state)
            .unwrap();
        let change = SyncDocumentChange {
            expected: None,
            target: export_ideation(&source).unwrap().unwrap(),
        };
        assert!(change.target.references.is_empty());
        receiver.apply_sync_ideation(&binding, &change).unwrap();
        receiver.apply_sync_ideation(&binding, &change).unwrap();
        assert_eq!(
            export_ideation(&receiver).unwrap(),
            Some(change.target.clone())
        );

        let mut local = receiver.read_ideation().unwrap();
        local.state.boards[0].title = "Local edit".into();
        receiver
            .save_ideation(&local.revision, local.state)
            .unwrap();
        assert!(receiver.apply_sync_ideation(&binding, &change).is_err());
        assert_eq!(
            receiver.read_ideation().unwrap().state.boards[0].title,
            "Local edit"
        );
    }
}
