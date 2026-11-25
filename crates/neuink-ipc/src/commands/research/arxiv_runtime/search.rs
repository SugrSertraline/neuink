use super::{fetch, Failure, Outcome};
use crate::commands::research::{
    arxiv_http::Transport,
    arxiv_query::{normalize_id, PreparedQuery, SearchPlan},
};
use std::collections::HashSet;

pub async fn run(
    plan: &SearchPlan,
    transport: &impl Transport,
    output: &mut Outcome,
) -> Result<(), Failure> {
    let mut start = plan.start;
    let mut seen = HashSet::new();
    for _ in 0..10 {
        if start >= 30000 {
            return Err(Failure::new("search_window_limit"));
        }
        let count = plan
            .page_size
            .min(plan.max_results - output.papers.len() as u64)
            .min(30000 - start);
        let mut request = plan.clone();
        request.start = start;
        request.max_results = count;
        let url = PreparedQuery::Search { plan: request }
            .initial_url()
            .map_err(|_| Failure::new("invalid_arguments"))?;
        let mut page = fetch::page(url, transport, output).await?;
        let (Some(total), Some(offset), Some(size)) = (page.total, page.start, page.page_size)
        else {
            return Err(Failure::new("pagination_metadata_missing"));
        };
        let raw = page.papers.len() as u64;
        if offset != start
            || raw > count
            || size > count
            || raw > size
            || (raw > 0 && start.saturating_add(raw) > total)
            || (raw == 0 && start < total)
        {
            return Err(Failure::new("pagination_metadata_invalid"));
        }
        // Validate the whole page before accepting any of it.
        for paper in &page.papers {
            let id = normalize_id(&paper.id).map_err(|_| Failure::new("invalid_identity"))?;
            if id.version.is_none() {
                return Err(Failure::new("invalid_identity"));
            }
        }
        if output.total_results.is_some_and(|old| old != total) {
            output.warnings.push("upstream_total_changed".into());
        }
        output.total_results = Some(total);
        let before = output.papers.len();
        for (index, mut paper) in page.papers.drain(..).enumerate() {
            if seen.insert(paper.id.clone()) {
                paper.arxiv.rank = Some(start + index as u64 + 1);
                output.papers.push(paper);
            } else if !output.warnings.iter().any(|w| w == "duplicate_entries") {
                output.warnings.push("duplicate_entries".into());
            }
        }
        if raw > 0 && output.papers.len() == before {
            return Err(Failure::new("no_progress"));
        }
        start += raw;
        output.next_start = Some(start);
        output.has_more = Some(start < total);
        if start >= total || output.papers.len() as u64 >= plan.max_results {
            return Ok(());
        }
    }
    Err(Failure::new("page_limit"))
}
