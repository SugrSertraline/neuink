#[cfg(test)]
mod boundary_tests;
#[cfg(test)]
mod execution_tests;
mod fetch;
mod ids;
#[cfg(test)]
mod live_tests;
mod search;
#[cfg(test)]
mod tests;

use super::{
    arxiv_http::Transport,
    arxiv_query::{self, PreparedQuery},
    arxiv_paper::ArxivPaper as Paper,
};
use serde::Serialize;
use std::{path::Path, time::Duration};

#[derive(Clone)]
pub struct Cancellation(tokio::sync::watch::Sender<bool>);
impl Default for Cancellation {
    fn default() -> Self {
        Self(tokio::sync::watch::channel(false).0)
    }
}
impl Cancellation {
    pub fn cancel(&self) {
        self.0.send_replace(true);
    }
    pub fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }
    async fn cancelled(&self) {
        let mut rx = self.0.subscribe();
        loop {
            if *rx.borrow_and_update() {
                return;
            }
            if rx.changed().await.is_err() {
                return;
            }
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Failure {
    pub code: String,
    pub http_status: Option<u16>,
    #[serde(skip_serializing_if="Option::is_none")]
    pub gate: Option<super::arxiv_gate::GateError>,
}
impl Failure {
    pub fn new(code: &str) -> Self {
        let gate=if matches!(code,"total_timeout"|"cancelled") {
            let context=super::arxiv_gate::context("arxiv_search");
            let mut error=super::arxiv_gate::GateError::new(code);
            error.phase="task".into();error.request_id=context.request_id;error.source=context.source.into();Some(error)
        } else {None};
        Self {
            code: code.into(),
            http_status: None,
            gate,
        }
    }
}

#[derive(Serialize)]
pub struct Outcome {
    pub schema_version: u32,
    pub status: &'static str,
    pub papers: Vec<Paper>,
    pub returned_count: usize,
    pub errors: Vec<Failure>,
    pub warnings: Vec<String>,
    pub effective_query: Option<String>,
    pub search_plan: Option<arxiv_query::SearchPlan>,
    pub date_filter: Option<arxiv_query::DateFilter>,
    pub total_results: Option<u64>,
    pub next_start: Option<u64>,
    pub has_more: Option<bool>,
    pub missing_ids: Vec<String>,
    pub unresolved_ids: Vec<String>,
    pub transport_calls: u32,
    pub retrieved_at: String,
    pub notice: &'static str,
}
impl Outcome {
    fn new(query: &PreparedQuery) -> Self {
        let (effective_query, date_filter, unresolved_ids) = match query {
            PreparedQuery::Search { plan } => (
                Some(plan.effective_query.clone()),
                plan.date_filter.clone(),
                vec![],
            ),
            PreparedQuery::Ids { ids } => {
                (None, None, ids.iter().map(|id| id.id.clone()).collect())
            }
        };
        Self {
            schema_version: 1,
            status: "ok",
            papers: vec![],
            returned_count: 0,
            errors: vec![],
            warnings: vec![],
            effective_query,
            search_plan: match query { PreparedQuery::Search { plan } => Some(plan.clone()), _ => None },
            date_filter,
            total_results: None,
            next_start: None,
            has_more: None,
            missing_ids: vec![],
            unresolved_ids,
            transport_calls: 0,
            retrieved_at: String::new(),
            notice: "Search metadata and abstracts only; not full text. Download requires separate user confirmation.",
        }
    }
}

pub async fn execute(
    query: &PreparedQuery,
    transport: &impl Transport,
    cancel: &Cancellation,
) -> Result<Outcome, Failure> {
    let mut output = Outcome::new(query);
    let work = async {
        match query {
            PreparedQuery::Search { plan } => search::run(plan, transport, &mut output).await,
            PreparedQuery::Ids { ids } => ids::run(ids, transport, &mut output).await,
        }
    };
    let result = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(Failure::new("cancelled")),
        result = tokio::time::timeout(Duration::from_secs(180), work) => {
            result.unwrap_or_else(|_| Err(Failure::new("total_timeout")))
        }
    };
    if cancel.is_cancelled() {
        return Err(Failure::new("cancelled"));
    }
    if let Err(error) = result {
        if output.papers.is_empty() {
            return Err(error);
        }
        output.status = "partial";
        output.errors.push(error);
        output.has_more = None;
    }
    output.returned_count = output.papers.len();
    output.retrieved_at = chrono::Utc::now().to_rfc3339();
    Ok(output)
}

pub async fn read_only(
    root: &Path,
    args: &serde_json::Value,
    transport: &impl Transport,
    cancel: &Cancellation,
) -> Result<Outcome, Failure> {
    let query = arxiv_query::prepare(args, chrono::Utc::now())
        .map_err(|error| Failure::new(&error.code))?;
    let validate = || {
        neuink_workspace::validate_workspace_read_only(root)
            .map_err(|_| Failure::new("workspace_unavailable"))
    };
    let canonical = validate()?;
    let result = super::arxiv_gate::scope("arxiv_search",180,execute(&query, transport, cancel)).await?;
    if validate()? != canonical {
        return Err(Failure::new("workspace_changed"));
    }
    if cancel.is_cancelled() {
        return Err(Failure::new("cancelled"));
    }
    super::arxiv_cache::remember(&canonical, &result.papers).map_err(|_| Failure::new("cache_unavailable"))?;
    Ok(result)
}
