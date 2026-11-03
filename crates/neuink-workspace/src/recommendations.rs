use crate::{
    atomic_write_json,
    daily::{invalid, validate_date},
    Workspace, WorkspaceError,
};
use neuink_domain::recommendations::Recommendations;
use std::fs;

impl Workspace {
    pub fn read_recommendations(&self) -> Result<Recommendations, WorkspaceError> {
        let path = self.daily_dir()?.join("recommendations.json");
        self.validate_note_workspace_path(&path)?;
        if !path.exists() {
            return Ok(Recommendations::default());
        }
        if fs::metadata(&path)?.len() > 32 * 1024 * 1024 {
            return Err(invalid("推荐历史过大"));
        }
        let state: Recommendations = serde_json::from_slice(&fs::read(path)?)?;
        validate(&state)?;
        Ok(state)
    }
    pub fn update_recommendations(
        &self,
        change: impl FnOnce(&mut Recommendations) -> Result<(), WorkspaceError>,
    ) -> Result<Recommendations, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let mut state = self.read_recommendations()?;
        change(&mut state)?;
        validate(&state)?;
        atomic_write_json(self.daily_dir()?.join("recommendations.json"), &state)?;
        Ok(state)
    }
}
fn validate(state: &Recommendations) -> Result<(), WorkspaceError> {
    if serde_json::to_vec(state)?.len() > 32 * 1024 * 1024 {
        return Err(invalid("推荐历史过大"));
    }
    if state.version != 1 || state.batches.len() > 366 || state.feedback.len() > 20_000 {
        return Err(invalid("推荐历史版本或数量不兼容"));
    }
    let mut dates = std::collections::BTreeSet::new();
    for batch in &state.batches {
        validate_date(&batch.date)?;
        if !dates.insert(&batch.date) || batch.papers.len() > 10 || batch.interests.len() > 30 {
            return Err(invalid("推荐批次无效"));
        }
        let mut ids = std::collections::BTreeSet::new();
        for p in &batch.papers {
            if !ids.insert(&p.paper.id)
                || !p.paper.id.starts_with("arxiv:")
                || p.paper.id.len() > 110
                || !p.paper.url.starts_with("https://arxiv.org/abs/")
                || p.paper.title.len() > 4000
                || p.paper.abstract_text.len() > 24_000
                || p.reasons.len() > 10
                || p.categories.len() > 100
            {
                return Err(invalid("推荐论文记录无效"));
            }
        }
    }
    Ok(())
}
