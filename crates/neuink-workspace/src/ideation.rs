//! Durable research cards and independent idea graphs, guarded by the workspace mutation lock.
mod model;
mod validation;
use crate::{atomic_write_json, daily::revision, Workspace, WorkspaceError};
use model::migrate;
pub use model::*;
use std::fs;
use validation::{valid_id, validate, validate_draft};
fn invalid(message: &str) -> WorkspaceError {
    WorkspaceError::Daily(message.into())
}
impl Workspace {
    fn ideation_draft_path(&self, entry_id: &str) -> Result<std::path::PathBuf, WorkspaceError> {
        if !valid_id(entry_id) {
            return Err(invalid("论文标识无效"));
        }
        let path = self
            .layout()
            .root()
            .join("ideation")
            .join("drafts")
            .join(format!("{entry_id}.json"));
        self.validate_note_workspace_path(&path)?;
        Ok(path)
    }
    pub fn read_ideation_draft(
        &self,
        entry_id: &str,
    ) -> Result<IdeationDraftSnapshot, WorkspaceError> {
        let path = self.ideation_draft_path(entry_id)?;
        if !path.exists() {
            return Ok(IdeationDraftSnapshot {
                revision: "missing".into(),
                draft: None,
            });
        }
        if fs::metadata(&path)?.len() > 10_000_000 {
            return Err(invalid("卡片草稿过大，原文件已保留"));
        }
        let bytes = fs::read(path)?;
        let draft: IdeationDraft = serde_json::from_slice(&bytes)?;
        validate_draft(&draft, entry_id)?;
        Ok(IdeationDraftSnapshot {
            revision: revision(&bytes),
            draft: Some(draft),
        })
    }
    pub fn list_ideation_drafts(&self) -> Result<Vec<IdeationDraftSummary>, WorkspaceError> {
        let dir = self.layout().root().join("ideation").join("drafts");
        self.validate_note_workspace_path(&dir)?;
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut summaries = Vec::new();
        for item in fs::read_dir(dir)? {
            let item = item?;
            let path = item.path();
            if path.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let Some(id) = path
                .file_stem()
                .and_then(|x| x.to_str())
                .filter(|x| valid_id(x))
            else {
                continue;
            };
            let snapshot = self.read_ideation_draft(id)?;
            if let Some(draft) = snapshot.draft {
                summaries.push(IdeationDraftSummary {
                    entry_id: draft.entry_id,
                    status: draft.status,
                    count: draft.cards.len(),
                    partial: draft.partial,
                    revision: snapshot.revision,
                    card_ids: draft.cards.iter().map(|card| card.id.clone()).collect(),
                    cards: draft
                        .cards
                        .iter()
                        .map(|card| IdeationDraftCardPreview {
                            id: card.id.clone(),
                            kind: card.kind.clone(),
                            title: card.title.clone(),
                            body: card.body.chars().take(280).collect(),
                            pattern_ids: card.pattern_ids.clone(),
                        })
                        .collect(),
                    error_code: draft.error_code,
                });
            }
        }
        Ok(summaries)
    }
    pub fn save_ideation_draft(
        &self,
        expected: &str,
        draft: IdeationDraft,
    ) -> Result<IdeationDraftSnapshot, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let path = self.ideation_draft_path(&draft.entry_id)?;
        let current = self.read_ideation_draft(&draft.entry_id)?;
        if current.revision != expected {
            return Err(invalid("卡片草稿已在其他位置更新，本次结果未覆盖"));
        }
        validate_draft(&draft, &draft.entry_id)?;
        if serde_json::to_vec(&draft)?.len() > 10_000_000 {
            return Err(invalid("卡片草稿过大，原文件已保留"));
        }
        atomic_write_json(path, &draft)?;
        self.read_ideation_draft(&draft.entry_id)
    }
    pub fn read_ideation(&self) -> Result<IdeationSnapshot, WorkspaceError> {
        let path = self.layout().root().join("ideation").join("state.json");
        self.validate_note_workspace_path(&path)?;
        if !path.exists() {
            return Ok(IdeationSnapshot {
                revision: "missing".into(),
                state: IdeationState {
                    version: 2,
                    ..Default::default()
                },
            });
        }
        if fs::metadata(&path)?.len() > 8 * 1024 * 1024 {
            return Err(invalid("研究构思数据过大，原文件已保留"));
        }
        let bytes = fs::read(path)?;
        let state: IdeationState = serde_json::from_slice(&bytes)?;
        validate(&state)?;
        Ok(IdeationSnapshot {
            revision: revision(&bytes),
            state: migrate(state),
        })
    }
    pub fn save_ideation(
        &self,
        expected: &str,
        state: IdeationState,
    ) -> Result<IdeationSnapshot, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        if self.read_ideation()?.revision != expected {
            return Err(invalid(
                "研究构思已在其他位置修改，请重新载入；本次修改未覆盖原文件",
            ));
        }
        if state.version == 1 {
            let path = self.layout().root().join("ideation").join("state.json");
            self.validate_note_workspace_path(&path)?;
            if path.exists()
                && serde_json::from_slice::<IdeationState>(&fs::read(path)?)?.version == 2
            {
                return Err(invalid("构思数据已升级，请重新载入后保存"));
            }
        }
        validate(&state)?;
        let state = migrate(state);
        validate(&state)?;
        if serde_json::to_vec(&state)?.len() > 8 * 1024 * 1024 {
            return Err(invalid("研究构思数据过大，原文件已保留"));
        }
        let path = self.layout().root().join("ideation").join("state.json");
        self.validate_note_workspace_path(&path)?;
        // Keep a recoverable copy on the first schema upgrade, before replacing the state.
        if path.exists() {
            let original = fs::read(&path)?;
            let old: IdeationState = serde_json::from_slice(&original)?;
            if old.version == 1 {
                let backup = path.with_file_name("state.v1.backup.json");
                self.validate_note_workspace_path(&backup)?;
                if !backup.exists() {
                    atomic_write_json(&backup, &old)?;
                }
            }
        }
        let change = self.content_change(
            crate::content_transaction::ContentTarget::IdeationState,
            serde_json::to_vec_pretty(&state)?,
        )?;
        self.commit_content_transaction(vec![change])?;
        self.read_ideation()
    }
}

#[cfg(test)]
mod tests;
