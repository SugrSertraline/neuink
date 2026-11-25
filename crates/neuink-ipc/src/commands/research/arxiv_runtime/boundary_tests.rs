use super::*;
use super::{
    execution_tests::snapshot,
    tests::{observe, query, reply, xml, Mock},
};
use crate::commands::research::{
    arxiv_http::{Gate, Reply},
};
use serde_json::json;
use std::{future::Future, pin::Pin, sync::Arc};

struct Queued(Arc<Gate>);

#[tokio::test(start_paused = true)]
async fn timeout_partial_commits_only_successful_pages_to_new_cache() {
    let temp = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(temp.path()).unwrap();
    let canonical = temp.path().canonicalize().unwrap();
    let mock=super::execution_tests::OneThenHanging(std::sync::atomic::AtomicBool::new(false));
    let result = read_only(temp.path(), &json!({"mode":"structured","query":"test","page_size":1,"max_results":2}),
        &mock, &Cancellation::default()).await.unwrap();
    assert_eq!(result.status,"partial");assert_eq!(result.errors[0].code,"total_timeout");
    let selected=crate::commands::research::arxiv_cache::selected(&crate::commands::research::Selection {
        root:canonical.clone(),paper_ids:vec!["arxiv:2401.00001v1".into()] }).unwrap();
    assert_eq!(selected,result.papers);
    assert!(!crate::commands::research::cache().lock().unwrap().iter().any(|p|p.root==canonical));
}
impl Transport for Queued {
    fn get(&self, _: reqwest::Url) -> Pin<Box<dyn Future<Output = Reply> + Send + '_>> {
        Box::pin(self.0.run(async { reply(200, xml(0, 0, 1, &[])) }))
    }
}

#[tokio::test(start_paused = true)]
async fn queued_cancellation_and_fast_gate_interval() {
    let gate = Arc::new(Gate::default());
    gate.run(async { reply(200, String::new()) }).await.unwrap();
    let cancel = Cancellation::default();
    let copy = cancel.clone();
    let task = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(500)).await;
        copy.cancel();
    });
    let started = tokio::time::Instant::now();
    let error = execute(&query(1, 1), &Queued(gate.clone()), &cancel)
        .await
        .err()
        .unwrap();
    task.await.unwrap();
    assert_eq!(error.code, "cancelled");
    assert_eq!(started.elapsed(), Duration::from_millis(500));
    gate.run(async { reply(200, String::new()) }).await.unwrap();
    assert_eq!(started.elapsed(), Duration::from_secs(3));
    let started = tokio::time::Instant::now();
    gate.run(async { reply(200, String::new()) }).await.unwrap();
    assert_eq!(started.elapsed(), Duration::from_secs(3));
    println!(
        "STEP3_JSON {}",
        json!({"case":"queued_cancel","actual":{"cancel_ms":500,"next_start_ms":3000,"fast_interval_ms":3000}})
    );
}

#[tokio::test]
async fn date_and_sort_are_frozen_across_pages() {
    let now = chrono::DateTime::parse_from_rfc3339("2026-10-20T01:02:59Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    let query=arxiv_query::prepare(&json!({"mode":"structured","query":"test","days_back":7,"sort_by":"lastUpdatedDate","page_size":1,"max_results":2}),now).unwrap();
    let mock = Mock::new(vec![
        reply(200, xml(0, 2, 1, &["2401.00001v1"])),
        reply(200, xml(1, 2, 1, &["2401.00002v1"])),
    ]);
    let result = execute(&query, &mock, &Cancellation::default())
        .await
        .unwrap();
    let urls = mock.urls.lock().unwrap();
    let conditions: Vec<_> = urls
        .iter()
        .map(|u| {
            u.query_pairs()
                .filter(|(k, _)| k == "search_query" || k == "sortBy" || k == "sortOrder")
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect::<Vec<_>>()
        })
        .collect();
    assert_eq!(conditions[0], conditions[1]);
    assert!(conditions[0]
        .iter()
        .any(|(_, v)| v.contains("202610130102 TO 202610200102")));
    observe("frozen_date_sort", &result);
}

#[tokio::test]
async fn duplicated_refill_cannot_escape_search_window() {
    let query = arxiv_query::prepare(
        &json!({"mode":"structured","query":"test","start":29997,"page_size":2,"max_results":3}),
        chrono::Utc::now(),
    )
    .unwrap();
    let mock = Mock::new(vec![
        reply(200, xml(29997, 40000, 2, &["2401.00001v1", "2401.00001v1"])),
        reply(200, xml(29999, 40000, 1, &["2401.00002v1"])),
    ]);
    let result = execute(&query, &mock, &Cancellation::default())
        .await
        .unwrap();
    assert_eq!(result.returned_count, 2);
    assert_eq!(result.errors[0].code, "search_window_limit");
    assert_eq!(mock.urls.lock().unwrap().len(), 2);
    observe("window_guard", &result);
}

struct WorkspaceChanges<'a>(&'a Path);
impl Transport for WorkspaceChanges<'_> {
    fn get(&self, _: reqwest::Url) -> Pin<Box<dyn Future<Output = Reply> + Send + '_>> {
        Box::pin(async move {
            std::fs::write(
                self.0.join("tag-operation.journal.json"),
                b"pending fixture",
            )
            .unwrap();
            reply(200, xml(0, 1, 1, &["2401.00001v1"]))
        })
    }
}

#[tokio::test]
async fn revalidation_rejects_changed_workspace_without_repair_or_cache() {
    let temp = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(temp.path()).unwrap();
    let canonical = temp.path().canonicalize().unwrap();
    let result = read_only(
        temp.path(),
        &json!({"mode":"structured","query":"test","max_results":1}),
        &WorkspaceChanges(temp.path()),
        &Cancellation::default(),
    )
    .await;
    assert_eq!(result.err().unwrap().code, "workspace_unavailable");
    assert_eq!(
        std::fs::read(temp.path().join("tag-operation.journal.json")).unwrap(),
        b"pending fixture"
    );
    assert!(!crate::commands::research::arxiv_cache::cache()
        .lock()
        .unwrap()
        .iter()
        .any(|p| p.root == canonical));
    println!(
        "STEP3_JSON {}",
        json!({"case":"workspace_changed","actual":{"error":"workspace_unavailable","journal_preserved":true,"cached":0}})
    );
}

#[tokio::test(start_paused = true)]
async fn cancellation_after_first_page_discards_uncommitted_records() {
    let temp = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(temp.path()).unwrap();
    let canonical = temp.path().canonicalize().unwrap();
    let before = snapshot(temp.path());
    let mock=super::execution_tests::OneThenHanging(std::sync::atomic::AtomicBool::new(false));
    let cancel = Cancellation::default();
    let copy = cancel.clone();
    let task = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(1)).await;
        copy.cancel();
    });
    let result = read_only(
        temp.path(),
        &json!({"mode":"structured","query":"test","page_size":1,"max_results":2}),
        &mock,
        &cancel,
    )
    .await;
    task.await.unwrap();
    assert_eq!(result.err().unwrap().code, "cancelled");
    assert_eq!(snapshot(temp.path()), before);
    assert!(!crate::commands::research::arxiv_cache::cache()
        .lock()
        .unwrap()
        .iter()
        .any(|p| p.root == canonical));
    println!(
        "STEP3_JSON {}",
        json!({"case":"cancel_after_page","actual":{"error":"cancelled","unchanged":true,"cached":0,"calls":2}})
    );
}
