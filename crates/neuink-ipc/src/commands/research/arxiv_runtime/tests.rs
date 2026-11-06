use super::*;
use crate::commands::research::{
    arxiv_feed,
    arxiv_http::{Gate, Reply},
    network::StatusResponse,
};
use serde_json::json;
use std::{collections::VecDeque, future::Future, pin::Pin, sync::Mutex};

pub(super) struct Mock {
    replies: Mutex<VecDeque<Reply>>,
    pub urls: Mutex<Vec<reqwest::Url>>,
}
impl Mock {
    pub fn new(replies: Vec<Reply>) -> Self {
        Self {
            replies: Mutex::new(replies.into()),
            urls: Mutex::new(vec![]),
        }
    }
}
impl Transport for Mock {
    fn get(&self, url: reqwest::Url) -> Pin<Box<dyn Future<Output = Reply> + Send + '_>> {
        self.urls.lock().unwrap().push(url);
        let response = self
            .replies
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected request");
        Box::pin(async { response })
    }
}
// A fixture transported through the real gate. New tests distinguish raw page parsing from scheduling.
pub(super) struct Gated<T> { pub gate:std::sync::Arc<crate::commands::research::arxiv_gate::ArxivGate>, pub raw:T }
impl<T> Gated<T> { pub fn new(raw:T)->Self{Self{gate:std::sync::Arc::new(crate::commands::research::arxiv_gate::ArxivGate::new(None)),raw}} }
impl<T:Transport> crate::commands::research::arxiv_gate::Sender for Gated<T> {
    fn send(&self,url:reqwest::Url)->Pin<Box<dyn Future<Output=Result<StatusResponse,crate::commands::research::arxiv_gate::GateError>>+Send+'_>> {
        Box::pin(async move {self.raw.get(url).await.map_err(Into::into)})
    }
}
impl<T:Transport> Transport for Gated<T> {
    fn get(&self,url:reqwest::Url)->Pin<Box<dyn Future<Output=Reply>+Send+'_>>{self.raw.get(url)}
    fn get_gate(&self,url:reqwest::Url)->Pin<Box<dyn Future<Output=Result<StatusResponse,crate::commands::research::arxiv_gate::GateError>>+Send+'_>>{
        Box::pin(async move { self.gate.request_with(url,crate::commands::research::arxiv_gate::context("fixture"),self).await })
    }
}
pub(super) fn reply(status: u16, xml: String) -> Reply {
    Ok(StatusResponse {
        status,
        bytes: xml.into_bytes(),
        retry_after: None,
        location: None,
    })
}
pub(super) fn xml(start: u64, total: u64, size: u64, ids: &[&str]) -> String {
    let entries: String = ids.iter().map(|id| format!("<entry><id>http://arxiv.org/abs/{id}</id><title>Fixture</title><summary>Summary</summary><published>2024-01-01T00:00:00Z</published></entry>")).collect();
    format!("<feed xmlns=\"http://www.w3.org/2005/Atom\" xmlns:opensearch=\"http://a9.com/-/spec/opensearch/1.1/\"><opensearch:totalResults>{total}</opensearch:totalResults><opensearch:startIndex>{start}</opensearch:startIndex><opensearch:itemsPerPage>{size}</opensearch:itemsPerPage>{entries}</feed>")
}
pub(super) fn query(size: u64, count: u64) -> PreparedQuery {
    arxiv_query::prepare(
        &json!({"mode":"structured","query":"test","page_size":size,"max_results":count}),
        chrono::Utc::now(),
    )
    .unwrap()
}
pub(super) fn observe(case: &str, result: &Outcome) {
    println!("STEP3_JSON {}", json!({"case":case,"actual":result}));
}

#[test]
fn atom_metadata_root_and_error_entry() {
    let page = arxiv_feed::parse_page(&xml(2, 5, 1, &["2401.00001v2"])).unwrap();
    assert_eq!(
        (page.start, page.total, page.page_size),
        (Some(2), Some(5), Some(1))
    );
    for bad in [
        "<html/>",
        "garbage",
        "<feed><entry></feed>",
        "<feed/><html/>",
        "<feed>",
        "<!DOCTYPE feed><feed/>",
    ] {
        assert_eq!(arxiv_feed::parse_page(bad).err(), Some("invalid_feed"));
    }
    assert!(
        arxiv_feed::parse_page("<atom:feed xmlns:atom=\"http://www.w3.org/2005/Atom\"/>").is_ok()
    );
    assert_eq!(
        arxiv_feed::parse_page(
            &xml(0, 1, 1, &["2401.00001v1"]).replace("2024-01-01T00:00:00Z", "bad-date")
        )
        .err(),
        Some("invalid_feed")
    );
    let error = "<feed><entry><id>http://arxiv.org/api/errors#incorrect_query</id><title>Error</title><summary>secret remote body</summary></entry></feed>";
    assert_eq!(
        arxiv_feed::parse_page(error).err(),
        Some("upstream_query_error")
    );
    println!(
        "STEP3_JSON {}",
        json!({"case":"atom","actual":{"total":page.total,"start":page.start,"items":page.page_size,"error":"upstream_query_error"}})
    );
}

#[tokio::test]
async fn full_last_page_and_empty_result_are_exact() {
    for (ids, total) in [(vec!["2401.00001v1", "2401.00002v2"], 2), (vec![], 0)] {
        let mock = Mock::new(vec![reply(200, xml(0, total, 2, &ids))]);
        let result = execute(&query(2, 2), &mock, &Cancellation::default())
            .await
            .unwrap();
        assert_eq!(result.returned_count, total as usize);
        assert_eq!(result.has_more, Some(false));
        assert_eq!(mock.urls.lock().unwrap().len(), 1);
        observe("exact_last_or_empty", &result);
    }
}

#[tokio::test]
async fn pagination_advances_raw_offset_and_deduplicates_stably() {
    let mock = Mock::new(vec![
        reply(200, xml(0, 8, 2, &["2401.00001v1", "2401.00002v1"])),
        reply(200, xml(2, 8, 2, &["2401.00002v1", "2401.00003v1"])),
        reply(200, xml(4, 8, 1, &["2401.00004v1"])),
    ]);
    let result = execute(&query(2, 4), &mock, &Cancellation::default())
        .await
        .unwrap();
    assert_eq!(result.returned_count, 4);
    assert_eq!(result.next_start, Some(5));
    assert_eq!(result.has_more, Some(true));
    assert_eq!(
        result
            .papers
            .iter()
            .map(|p| p.arxiv.rank.unwrap())
            .collect::<Vec<_>>(),
        [1, 2, 4, 5]
    );
    let starts: Vec<_> = mock
        .urls
        .lock()
        .unwrap()
        .iter()
        .map(|u| {
            u.query_pairs()
                .find(|(k, _)| k == "start")
                .unwrap()
                .1
                .to_string()
        })
        .collect();
    assert_eq!(starts, ["0", "2", "4"]);
    observe("raw_offsets_dedup", &result);
}

#[tokio::test]
async fn missing_conflicting_and_no_progress_metadata_stop_explicitly() {
    for (body, code) in [
        ("<feed/>".into(), "pagination_metadata_missing"),
        (
            xml(1, 3, 1, &["2401.00002v1"]),
            "pagination_metadata_invalid",
        ),
        (
            xml(0, 0, 1, &["2401.00002v1"]),
            "pagination_metadata_invalid",
        ),
        (xml(0, 3, 1, &[]), "pagination_metadata_invalid"),
        (xml(0, 1, 1, &["2401.00001"]), "invalid_identity"),
    ] {
        let error = execute(
            &query(1, 2),
            &Mock::new(vec![reply(200, body)]),
            &Cancellation::default(),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(error.code, code);
        println!(
            "STEP3_JSON {}",
            json!({"case":"bad_metadata","actual":error})
        );
    }
    let mock = Mock::new(vec![
        reply(200, xml(0, 3, 1, &["2401.00001v1"])),
        reply(200, xml(1, 3, 1, &["2401.00001v1"])),
    ]);
    let result = execute(&query(1, 3), &mock, &Cancellation::default())
        .await
        .unwrap();
    assert_eq!(result.status, "partial");
    assert_eq!(result.errors[0].code, "no_progress");
    assert_eq!(result.has_more, None);
    assert_eq!(result.next_start, Some(1));
    observe("no_progress", &result);
}

#[tokio::test]
async fn changing_total_and_ten_page_guard_are_disclosed() {
    let mock = Mock::new(vec![
        reply(200, xml(0, 2, 1, &["2401.00001v1"])),
        reply(200, xml(1, 3, 1, &["2401.00002v1"])),
    ]);
    let result = execute(&query(1, 2), &mock, &Cancellation::default())
        .await
        .unwrap();
    assert!(result.warnings.contains(&"upstream_total_changed".into()));
    observe("changed_total", &result);
    let responses = (0..10)
        .map(|i| reply(200, xml(i, 20, 1, &[&format!("2401.{:05}v1", i + 1)])))
        .collect();
    let result = execute(
        &query(1, 20),
        &Mock::new(responses),
        &Cancellation::default(),
    )
    .await
    .unwrap();
    assert_eq!(result.returned_count, 10);
    assert_eq!(result.errors[0].code, "page_limit");
    observe("page_guard", &result);
}

#[tokio::test(start_paused = true)]
async fn shared_gate_spaces_starts_serializes_and_releases_on_cancel() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    let gate = Arc::new(Gate::default());
    let active = Arc::new(AtomicUsize::new(0));
    let starts = Arc::new(Mutex::new(vec![]));
    let mut tasks = vec![];
    for _ in 0..3 {
        let (gate, active, starts) = (gate.clone(), active.clone(), starts.clone());
        tasks.push(tokio::spawn(async move {
            gate.run(async {
                assert_eq!(active.fetch_add(1, Ordering::SeqCst), 0);
                starts.lock().unwrap().push(tokio::time::Instant::now());
                tokio::time::sleep(Duration::from_secs(4)).await;
                active.fetch_sub(1, Ordering::SeqCst);
                reply(200, String::new())
            })
            .await
        }));
    }
    for task in tasks {
        task.await.unwrap().unwrap();
    }
    let starts = starts.lock().unwrap();
    let intervals: Vec<_> = starts
        .windows(2)
        .map(|v| v[1].duration_since(v[0]).as_secs())
        .collect();
    assert!(intervals.iter().all(|n| *n >= 4));
    println!(
        "STEP3_JSON {}",
        json!({"case":"gate","actual":{"start_intervals_seconds":intervals,"peak_concurrent":1}})
    );
    drop(starts);
    let task = {
        let gate = gate.clone();
        tokio::spawn(async move { gate.run(std::future::pending()).await })
    };
    tokio::task::yield_now().await;
    task.abort();
    let _ = task.await;
    assert!(gate.run(async { reply(200, String::new()) }).await.is_ok());
}
