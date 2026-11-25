//! Host-routed mixed selections; approval snapshots never fall back to another cache.
use super::{arxiv_cache, arxiv_paper::ArxivPaper, import_job::ImportJob, imports, Selection};
use serde::Deserialize;
use serde_json::Value;
use std::{
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Runtime};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PaperCacheSource {
    Research,
    ArxivSearch,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperSelection {
    pub paper_id: String,
    pub cache_source: PaperCacheSource,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preview {
    pub root: PathBuf,
    pub selections: Vec<PaperSelection>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Approval {
    pub root: PathBuf,
    pub selections: Vec<PaperSelection>,
    pub expected: Vec<ArxivPaper>,
    pub approval_id: String,
}
struct Grant {
    root: PathBuf,
    selections: Vec<PaperSelection>,
    papers: Vec<ArxivPaper>,
    id: String,
    expires_at: Instant,
}
fn grants() -> &'static Mutex<Vec<Grant>> {
    static GRANTS: OnceLock<Mutex<Vec<Grant>>> = OnceLock::new();
    GRANTS.get_or_init(|| Mutex::new(Vec::new()))
}
fn root(path: &std::path::Path) -> Result<PathBuf, String> {
    neuink_workspace::validate_workspace_read_only(path).map_err(|_| "资料库不可用".into())
}
pub fn preview(request: Preview) -> Result<Vec<ArxivPaper>, String> {
    let canonical = root(&request.root)?;
    if request.selections.is_empty() || request.selections.len() > 10 {
        return Err("每批请选择 1–10 篇论文".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut papers = vec![];
    for item in request.selections {
        if !seen.insert(item.paper_id.clone()) {
            return Err("论文选择重复".into());
        }
        let selection = Selection {
            root: canonical.clone(),
            paper_ids: vec![item.paper_id],
        };
        papers.push(match item.cache_source {
            PaperCacheSource::Research => super::selected(&selection)?.remove(0).into(),
            PaperCacheSource::ArxivSearch => arxiv_cache::selected(&selection)?.remove(0),
        });
    }
    Ok(papers)
}
pub fn approve(request: Approval) -> Result<(), String> {
    if request.approval_id.is_empty() || request.approval_id.len() > 100 {
        return Err("确认标识无效".into());
    }
    let canonical = root(&request.root)?;
    let papers = preview(Preview {
        root: canonical.clone(),
        selections: request.selections.clone(),
    })?;
    if papers != request.expected {
        return Err("论文信息已变化，请重新预览后确认".into());
    }
    let mut rows = grants().lock().map_err(|_| "确认状态不可用")?;
    rows.retain(|g| Instant::now() < g.expires_at);
    if rows.len() >= 32 || rows.iter().any(|g| g.id == request.approval_id) {
        return Err("确认状态冲突".into());
    }
    rows.push(Grant {
        root: canonical,
        selections: request.selections,
        papers,
        id: request.approval_id,
        expires_at: Instant::now() + Duration::from_secs(300),
    });
    Ok(())
}
pub(super) fn consume(request: Preview, id: &str) -> Result<Vec<ArxivPaper>, String> {
    let canonical = root(&request.root)?;
    let mut rows = grants().lock().map_err(|_| "确认状态不可用")?;
    rows.retain(|g| Instant::now() < g.expires_at);
    let index = rows
        .iter()
        .position(|g| g.root == canonical && g.id == id && g.selections == request.selections)
        .ok_or("下载尚未经用户确认，或确认已使用／过期")?;
    Ok(rows.remove(index).papers)
}
pub async fn run<R: Runtime>(
    app: &AppHandle<R>,
    request: Preview,
    id: &str,
    job: &mut ImportJob,
) -> Result<Value, String> {
    let canonical = root(&request.root)?;
    let papers = consume(request, id)?;
    imports::run_approved(
        app,
        canonical,
        papers.into_iter().map(Into::into).collect(),
        job,
    )
    .await
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod download_tests;
#[cfg(test)]
mod memory_tests;
