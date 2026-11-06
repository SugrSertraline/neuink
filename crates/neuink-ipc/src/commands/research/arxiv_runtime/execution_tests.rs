use super::tests::{observe, query, reply, xml, Mock, Gated};
use super::*;
use crate::commands::research::{arxiv_http::Reply, network::StatusResponse};
use serde_json::json;
use std::{future::Future, pin::Pin};

fn id_query(ids: &[&str]) -> PreparedQuery {
    arxiv_query::prepare(&json!({"mode":"ids","ids":ids}), chrono::Utc::now()).unwrap()
}

#[tokio::test]
async fn ids_preserve_order_versions_missing_and_same_base_batches() {
    let mock = Mock::new(vec![
        reply(200, xml(0, 2, 3, &["2401.00002v3", "2401.00001v2"])),
        reply(200, xml(0, 1, 1, &["2401.00001v4"])),
    ]);
    let result = execute(
        &id_query(&["2401.00001v2", "2401.00002", "2401.00003", "2401.00001"]),
        &mock,
        &Cancellation::default(),
    )
    .await
    .unwrap();
    assert_eq!(
        result
            .papers
            .iter()
            .map(|p| p.id.as_str())
            .collect::<Vec<_>>(),
        [
            "arxiv:2401.00001v2",
            "arxiv:2401.00002v3",
            "arxiv:2401.00001v4"
        ]
    );
    assert_eq!(result.missing_ids, ["2401.00003"]);
    assert!(result.unresolved_ids.is_empty());
    assert!(result.papers.iter().all(|p| p.arxiv.rank.is_none()));
    assert_eq!(mock.urls.lock().unwrap().len(), 2);
    observe("ids_order_versions_missing", &result);
}

#[tokio::test]
async fn ids_wrong_version_and_ambiguous_or_incomplete_feed_are_errors() {
    for (body, code) in [
        (xml(0, 1, 1, &["2401.00001v3"]), "unexpected_id_or_version"),
        (
            xml(0, 2, 2, &["2401.00001v2", "2401.00001v2"]),
            "ambiguous_id_response",
        ),
        (xml(0, 1, 1, &[]), "id_metadata_invalid"),
    ] {
        let ids = if code == "ambiguous_id_response" {
            vec!["2401.00001v2", "2401.00002"]
        } else {
            vec!["2401.00001v2"]
        };
        let error = execute(
            &id_query(&ids),
            &Mock::new(vec![reply(200, body)]),
            &Cancellation::default(),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(error.code, code);
        println!(
            "STEP3_JSON {}",
            json!({"case":"id_response_error","actual":error})
        );
    }
}

#[tokio::test]
async fn ids_failed_batch_remains_unresolved_and_batch_size_is_twenty() {
    let mock = Mock::new(vec![
        reply(200, xml(0, 1, 1, &["2401.00001v1"])),
        reply(404, String::new()),
    ]);
    let result = execute(
        &id_query(&["2401.00001v1", "2401.00001v2", "2401.00002"]),
        &mock,
        &Cancellation::default(),
    )
    .await
    .unwrap();
    assert_eq!(result.status, "partial");
    assert_eq!(result.unresolved_ids, ["2401.00001v2", "2401.00002"]);
    assert!(result.missing_ids.is_empty());
    observe("ids_failed_batch", &result);
    let names: Vec<_> = (1..=21).map(|i| format!("2401.{i:05}")).collect();
    let refs: Vec<_> = names.iter().map(String::as_str).collect();
    let mock = Mock::new(vec![
        reply(200, xml(0, 0, 20, &[])),
        reply(200, xml(0, 0, 1, &[])),
    ]);
    let result = execute(&id_query(&refs), &mock, &Cancellation::default())
        .await
        .unwrap();
    assert_eq!(result.missing_ids.len(), 21);
    assert_eq!(mock.urls.lock().unwrap().len(), 2);
    observe("id_batch_twenty", &result);
}

#[tokio::test(start_paused = true)]
async fn retry_backoff_status_and_retry_after_are_bounded() {
    let mock=Gated::new(Mock::new(vec![reply(503,String::new()),reply(200,xml(0,0,1,&[]))]));
    let started=tokio::time::Instant::now();
    let result=execute(&query(1,1),&mock,&Cancellation::default()).await.unwrap();
    assert_eq!(started.elapsed().as_secs(),3);assert_eq!(result.transport_calls,1);
    for status in [400,404,401,429,503] {
        let count=if status==503{2}else{1};
        let mock=Gated::new(Mock::new((0..count).map(|_|reply(status,String::new())).collect()));
        let error=execute(&query(1,1),&mock,&Cancellation::default()).await.err().unwrap();
        assert_eq!(error.http_status,Some(status));assert_eq!(mock.raw.urls.lock().unwrap().len(),count);
        if status==429 {assert_eq!(error.code,"rate_limited");assert_eq!(error.gate.unwrap().retry_after_seconds,Some(300));}
    }
}

struct Hanging;
impl Transport for Hanging {
    fn get(&self, _: reqwest::Url) -> Pin<Box<dyn Future<Output = Reply> + Send + '_>> {
        Box::pin(std::future::pending())
    }
}

#[tokio::test(start_paused = true)]
async fn attempt_timeout_and_total_timeout_preserve_truth() {
    let started = tokio::time::Instant::now();
    let error = execute(&query(1, 1), &Gated::new(Hanging), &Cancellation::default())
        .await
        .err()
        .unwrap();
    assert_eq!(error.code, "request_timeout");
    assert_eq!(started.elapsed().as_secs(), 53);
    let mock=OneThenHanging(std::sync::atomic::AtomicBool::new(false));
    let started = tokio::time::Instant::now();
    let result = execute(&query(1, 2), &mock, &Cancellation::default())
        .await
        .unwrap();
    assert_eq!(started.elapsed().as_secs(), 180);
    assert_eq!(result.errors[0].code, "total_timeout");
    assert_eq!(result.returned_count, 1);
    assert_eq!(result.next_start, Some(1));
    observe("total_timeout_partial", &result);
}

#[tokio::test(start_paused = true)]
async fn cancellation_before_active_and_retry_never_returns_success() {
    let cancel = Cancellation::default();
    cancel.cancel();
    let mock = Mock::new(vec![]);
    assert_eq!(
        execute(&query(1, 1), &mock, &cancel)
            .await
            .err()
            .unwrap()
            .code,
        "cancelled"
    );
    assert!(mock.urls.lock().unwrap().is_empty());
    for retry in [false, true] {
        let cancel = Cancellation::default();
        let copy = cancel.clone();
        let task = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(500)).await;
            copy.cancel();
        });
        let error = if retry {
            execute(
                &query(1, 1),
                &Gated::new(Mock::new(vec![reply(503, String::new())])),
                &cancel,
            )
            .await
            .err()
            .unwrap()
        } else {
            execute(&query(1, 1), &Hanging, &cancel)
                .await
                .err()
                .unwrap()
        };
        task.await.unwrap();
        assert_eq!(error.code, "cancelled");
        println!(
            "STEP3_JSON {}",
            json!({"case":"cancel","actual":{"during_retry":retry,"error":error}})
        );
    }
}

pub(super) fn snapshot(root: &Path) -> Vec<(String, String)> {
    fn walk(root: &Path, path: &Path, rows: &mut Vec<(String, String)>) {
        for entry in std::fs::read_dir(path).unwrap() {
            let path = entry.unwrap().path();
            let name = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .into_owned();
            if path.is_dir() {
                rows.push((name, "directory".into()));
                walk(root, &path, rows);
            } else {
                rows.push((
                    name,
                    blake3::hash(&std::fs::read(path).unwrap()).to_string(),
                ));
            }
        }
    }
    let mut rows = vec![];
    walk(root, root, &mut rows);
    rows.sort();
    rows
}

#[tokio::test]
async fn readonly_success_partial_failure_cancel_and_invalid_workspace() {
    for mode in ["ok", "partial", "failure", "cancel", "invalid"] {
        let temp = tempfile::tempdir().unwrap();
        if mode != "invalid" {
            neuink_workspace::Workspace::create(temp.path()).unwrap();
        }
        let canonical = temp.path().canonicalize().unwrap();
        let before = snapshot(temp.path());
        let cancel = Cancellation::default();
        if mode == "cancel" {
            cancel.cancel();
        }
        let responses = match mode {
            "ok" => vec![reply(200, xml(0, 1, 1, &["2401.00001v1"]))],
            "partial" => vec![
                reply(200, xml(0, 2, 1, &["2401.00001v1"])),
                reply(404, String::new()),
            ],
            "failure" => vec![reply(404, String::new())],
            _ => vec![],
        };
        let mock = Mock::new(responses);
        let result = read_only(
            temp.path(),
            &json!({"mode":"structured","query":"test","page_size":1,"max_results":2}),
            &mock,
            &cancel,
        )
        .await;
        assert_eq!(snapshot(temp.path()), before);
        let cached = crate::commands::research::arxiv_cache::cache()
            .lock()
            .unwrap()
            .iter()
            .filter(|p| p.root == canonical)
            .count();
        assert_eq!(
            cached,
            if matches!(mode, "ok" | "partial") {
                1
            } else {
                0
            }
        );
        println!(
            "STEP3_JSON {}",
            json!({"case":"readonly","actual":{"mode":mode,"unchanged":true,"cached":cached,"error":result.as_ref().err(),"status":result.as_ref().ok().map(|r|r.status)}})
        );
    }
}

#[tokio::test]
async fn redirect_validation_and_error_bodies_are_not_exposed() {
    let url = reqwest::Url::parse("https://export.arxiv.org/api/query").unwrap();
    for target in [
        "http://arxiv.org/api/query",
        "https://127.0.0.1/api/query",
        "https://evil.example/api/query",
        "https://arxiv.org/pdf/x",
    ] {
        assert!(crate::commands::research::arxiv_http::redirect(&url, Some(target)).is_err());
    }
    let mock = Mock::new(vec![
        Ok(StatusResponse {
            status: 302,
            location: Some("https://arxiv.org/api/query".into()),
            retry_after: None,
            bytes: vec![],
        }),
        reply(200, xml(0, 0, 1, &[])),
    ]);
    let result = execute(&query(1, 1), &Gated::new(mock), &Cancellation::default())
        .await
        .unwrap();
    assert_eq!(result.transport_calls, 1);
    observe("redirect", &result);
}

pub(super) struct OneThenHanging(pub std::sync::atomic::AtomicBool);
impl Transport for OneThenHanging {
    fn get(&self,_:reqwest::Url)->Pin<Box<dyn Future<Output=Reply>+Send+'_>> {
        if !self.0.swap(true,std::sync::atomic::Ordering::SeqCst) {Box::pin(async {reply(200,xml(0,2,1,&["2401.00001v1"]))})}
        else {Box::pin(std::future::pending())}
    }
}
