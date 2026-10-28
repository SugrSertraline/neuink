//! Research snapshots contain only the selected evidence, never provider credentials.
use crate::{
    atomic_write_json,
    daily::{invalid, valid_id},
    Workspace, WorkspaceError,
};
use neuink_domain::deep_research::ResearchTask;
use serde_json::Value;
use std::{fs, path::PathBuf};

impl Workspace {
    fn research_path(&self, id: &str, proposal: bool) -> Result<PathBuf, WorkspaceError> {
        valid_id(id)?;
        let path = self
            .daily_dir()?
            .join("research")
            .join(if proposal { "proposals" } else { "tasks" })
            .join(format!("{id}.json"));
        self.validate_note_workspace_path(&path)?;
        Ok(path)
    }
    pub fn read_research_task(&self, id: &str) -> Result<ResearchTask, WorkspaceError> {
        let path = self.research_path(id, false)?;
        if fs::metadata(&path)?.len() > 4 * 1024 * 1024 {
            return Err(invalid("研究任务超过支持大小"));
        }
        let task: ResearchTask = serde_json::from_slice(&fs::read(path)?)?;
        validate(&task)?;
        if task.id != id {
            return Err(invalid("研究任务身份不一致"));
        }
        Ok(task)
    }
    pub fn write_research_task(&self, task: &ResearchTask) -> Result<(), WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        validate(task)?;
        let path = self.research_path(&task.id, false)?;
        if path.exists() {
            let previous = self.read_research_task(&task.id)?;
            if previous.query != task.query
                || previous.created_at != task.created_at
                || previous.profile_id != task.profile_id
                || previous.model != task.model
                || previous.retriever != task.retriever
                || previous.depth != task.depth
                || previous.timeout_seconds != task.timeout_seconds
                || previous.documents != task.documents
                || previous.parent_id != task.parent_id
                || previous.engine != task.engine
                || previous.engine_version != task.engine_version
            {
                return Err(invalid("研究任务快照不可替换"));
            }
        }
        atomic_write_json(path, task)
    }
    pub fn list_research_tasks(&self) -> Result<Vec<ResearchTask>, WorkspaceError> {
        let dir = self.daily_dir()?.join("research/tasks");
        self.validate_note_workspace_path(&dir)?;
        if !dir.exists() {
            return Ok(vec![]);
        }
        let mut files = fs::read_dir(dir)?.collect::<Result<Vec<_>, _>>()?;
        files.sort_by_key(|f| std::cmp::Reverse(f.file_name()));
        let mut tasks = Vec::new();
        for file in files {
            let path = file.path();
            if path.extension().is_some_and(|e| e == "json") {
                let id = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .ok_or_else(|| invalid("研究文件名无效"))?;
                tasks.push(self.read_research_task(id)?);
            }
        }
        tasks.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(tasks)
    }
    pub fn read_research_proposal(&self, id: &str) -> Result<Option<Value>, WorkspaceError> {
        let path = self.research_path(id, true)?;
        if !path.exists() {
            return Ok(None);
        }
        if fs::metadata(&path)?.len() > 2 * 1024 * 1024 {
            return Err(invalid("研究笔记预览过大"));
        }
        Ok(Some(serde_json::from_slice(&fs::read(path)?)?))
    }
    pub fn save_research_proposal(
        &self,
        id: &str,
        proposal: &Value,
    ) -> Result<Value, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        if let Some(previous) = self.read_research_proposal(id)? {
            return Ok(previous);
        }
        if serde_json::to_vec(proposal)?.len() > 2 * 1024 * 1024 {
            return Err(invalid("研究笔记预览过大"));
        }
        atomic_write_json(self.research_path(id, true)?, proposal)?;
        Ok(proposal.clone())
    }
}
fn validate(task: &ResearchTask) -> Result<(), WorkspaceError> {
    valid_id(&task.id)?;
    if let Some(parent) = &task.parent_id { valid_id(parent)?; if parent == &task.id { return Err(invalid("研究对话不能引用自身")); } }
    if task.version != 1
        || task.query.trim().is_empty()
        || task.query.len() > 10_000
        || task.report.len() > 1024 * 1024
        || task.documents.len() > 10
        || task.documents.iter().map(|d| d.text.len()).sum::<usize>() > 512_000
        || task.source_urls.len() > 100
        || task.source_urls.iter().any(|s| s.len() > 4096)
        || !["running", "completed", "failed", "cancelled", "interrupted"]
            .contains(&task.status.as_str())
    {
        return Err(invalid("研究任务格式或大小无效"));
    }
    Ok(())
}
/// Preserve the original text, but flag references not backed by returned sources.
pub fn unverified_links(markdown: &str, sources: &[String]) -> Vec<String> {
    fn identity(url: &str) -> String {
        let url = url.split('#').next().unwrap_or(url).trim_end_matches('/');
        for prefix in [
            "https://arxiv.org/abs/",
            "https://arxiv.org/pdf/",
            "https://arxiv.org/html/",
        ] {
            if let Some(id) = url.strip_prefix(prefix) {
                let id = id.trim_end_matches(".pdf");
                let id = id
                    .rsplit_once('v')
                    .filter(|(_, v)| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
                    .map(|(id, _)| id)
                    .unwrap_or(id);
                return format!("arxiv:{id}");
            }
        }
        url.to_owned()
    }
    let known: std::collections::BTreeSet<_> = sources.iter().map(|s| identity(s)).collect();
    let mut missing = std::collections::BTreeSet::new();
    for event in pulldown_cmark::Parser::new_ext(markdown, pulldown_cmark::Options::all()) {
        if let pulldown_cmark::Event::Start(pulldown_cmark::Tag::Link { dest_url, .. }) = event {
            if (dest_url.starts_with("https://") || dest_url.starts_with("http://"))
                && !known.contains(&identity(&dest_url))
            {
                missing.insert(dest_url.to_string());
            }
        }
    }
    missing.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_history_is_read_only_and_proposals_are_immutable() {
        let dir = tempfile::tempdir().unwrap();
        let ws = Workspace::create(dir.path()).unwrap();
        assert!(ws.list_research_tasks().unwrap().is_empty());
        assert!(!dir.path().join("daily").exists());
        assert!(ws.read_research_task("../secret").is_err());
        let first = serde_json::json!({"markdown":"reviewed"});
        ws.save_research_proposal("research-1", &first).unwrap();
        assert_eq!(
            ws.save_research_proposal("research-1", &serde_json::json!({"markdown":"replaced"}))
                .unwrap(),
            first
        );
    }
    #[test]
    fn citation_mapping_accepts_arxiv_versions_and_flags_invented_references() {
        let missing = unverified_links(
            "[A](https://arxiv.org/pdf/1706.03762v2.pdf) [B](https://example.com/missing)",
            &["https://arxiv.org/abs/1706.03762".into()],
        );
        assert_eq!(missing, vec!["https://example.com/missing"]);
    }
}
