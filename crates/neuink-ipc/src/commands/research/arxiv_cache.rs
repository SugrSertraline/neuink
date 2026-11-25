//! Cache owned exclusively by arxiv_search; legacy callers keep research::PAPERS.
use super::{arxiv_paper::ArxivPaper, Selection};
use std::{
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

pub(super) struct CachedPaper {
    pub root: PathBuf,
    pub paper: ArxivPaper,
    pub expires_at: Instant,
}
pub(super) fn cache() -> &'static Mutex<Vec<CachedPaper>> {
    static PAPERS: OnceLock<Mutex<Vec<CachedPaper>>> = OnceLock::new();
    PAPERS.get_or_init(|| Mutex::new(Vec::new()))
}
pub(super) fn remember(root: &PathBuf, papers: &[ArxivPaper]) -> Result<(), String> {
    let mut rows = cache().lock().map_err(|_| "检索缓存不可用")?;
    rows.retain(|p| Instant::now() < p.expires_at);
    for paper in papers {
        rows.retain(|p| p.root != *root || p.paper.id != paper.id);
        rows.push(CachedPaper {
            root: root.clone(),
            paper: paper.clone(),
            expires_at: Instant::now() + Duration::from_secs(3600),
        });
    }
    let excess = rows.len().saturating_sub(512);
    rows.drain(..excess);
    Ok(())
}
pub(super) fn selected(request: &Selection) -> Result<Vec<ArxivPaper>, String> {
    let root = neuink_workspace::validate_workspace_read_only(&request.root)
        .map_err(|_| "资料库不可用，搜索不会修复或创建目录")?;
    if request.paper_ids.is_empty() || request.paper_ids.len() > 10 {
        return Err("每批请选择 1–10 篇论文".into());
    }
    let rows = cache().lock().map_err(|_| "检索缓存不可用")?;
    let mut result: Vec<ArxivPaper> = vec![];
    for id in &request.paper_ids {
        if result.iter().any(|p| p.id == *id) {
            return Err("论文选择重复".into());
        }
        result.push(
            rows.iter()
                .find(|p| {
                    p.root == root
                        && p.paper.id == *id
                        && Instant::now() < p.expires_at
                })
                .ok_or("论文检索结果已过期，请重新检索并确认")?
                .paper
                .clone(),
        );
    }
    Ok(result)
}
