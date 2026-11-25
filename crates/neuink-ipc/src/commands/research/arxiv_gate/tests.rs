use super::*;
use std::{
    collections::VecDeque,
    sync::atomic::{AtomicUsize, Ordering},
};
struct Mock {
    replies: Mutex<VecDeque<Result<u16, &'static str>>>,
    starts: Mutex<Vec<Instant>>,
    active: AtomicUsize,
}
impl Mock {
    fn new(rows: Vec<Result<u16, &'static str>>) -> Self {
        Self {
            replies: Mutex::new(rows.into()),
            starts: Mutex::new(vec![]),
            active: AtomicUsize::new(0),
        }
    }
}
impl Sender for Mock {
    fn send(
        &self,
        _: reqwest::Url,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<GateResponse, GateError>> + Send + '_>,
    > {
        Box::pin(async move {
            assert_eq!(self.active.fetch_add(1, Ordering::SeqCst), 0);
            self.starts.lock().unwrap().push(Instant::now());
            tokio::time::sleep(Duration::from_secs(1)).await;
            self.active.fetch_sub(1, Ordering::SeqCst);
            let code = self.replies.lock().unwrap().pop_front().unwrap()?;
            Ok(StatusResponse {
                status: code,
                retry_after: (code == 429).then(|| "120".into()),
                location: None,
                bytes: b"feed".to_vec(),
            })
        })
    }
}
fn url() -> reqwest::Url {
    reqwest::Url::parse("https://export.arxiv.org/api/query?search_query=test").unwrap()
}
#[tokio::test(start_paused = true)]
async fn retry_fifo_spacing_and_cooldown_are_shared() {
    let gate = Arc::new(ArxivGate::new(None));
    let mock = Arc::new(Mock::new(vec![Ok(503), Ok(200), Ok(429)]));
    let start = Instant::now();
    gate.request_with(url(), Context::new("chat", 180), mock.as_ref())
        .await
        .unwrap();
    assert_eq!(
        mock.starts.lock().unwrap()[1] - start,
        Duration::from_secs(4)
    );
    let err = gate
        .request_with(url(), Context::new("legacy", 180), mock.as_ref())
        .await
        .unwrap_err();
    assert_eq!(err.code, "rate_limited");
    assert_eq!(err.attempts_started, 1);
    assert_eq!(err.retry_after_seconds, Some(120));
    let err = gate
        .request_with(url(), Context::new("python", 180), mock.as_ref())
        .await
        .unwrap_err();
    assert_eq!(err.code, "cooldown");
    assert_eq!(err.http_status, None);
    assert_eq!(err.attempts_started, 0);
    assert_eq!(mock.starts.lock().unwrap().len(), 3);
}
struct Hang;
impl Sender for Hang {
    fn send(
        &self,
        _: reqwest::Url,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<GateResponse, GateError>> + Send + '_>,
    > {
        Box::pin(std::future::pending())
    }
}
#[tokio::test(start_paused = true)]
async fn timeouts_cancel_and_capacity_release_tickets() {
    let gate = Arc::new(ArxivGate::new(None));
    let lease = gate.acquire(&Context::new("hold", 180)).await.unwrap();
    let error = gate
        .request_with(url(), Context::new("queue", 180), &Hang)
        .await
        .unwrap_err();
    assert_eq!(error.code, "queue_timeout");
    assert_eq!(error.attempts_started, 0);
    let g = gate.clone();
    let task = tokio::spawn(async move {
        g.request_with(url(), Context::new("cancel", 180), &Hang)
            .await
    });
    tokio::task::yield_now().await;
    task.abort();
    let _ = task.await;
    assert!(gate.lock().queue.is_empty());
    gate.lock().queue.extend(100..108);
    assert_eq!(
        gate.acquire(&Context::new("full", 180))
            .await
            .err()
            .unwrap()
            .code,
        "queue_full"
    );
    gate.lock().queue.clear();
    drop(lease);
    let error = gate
        .request_with(url(), Context::new("total", 1), &Hang)
        .await
        .unwrap_err();
    assert_eq!(error.code, "total_timeout");
    let error = gate
        .request_with(url(), Context::new("request", 180), &Hang)
        .await
        .unwrap_err();
    assert_eq!(error.code, "request_timeout");
    assert_eq!(error.attempts_started, 2);
    assert!(!gate.lock().active);
}
#[tokio::test(start_paused = true)]
async fn waiting_call_is_released_by_cooldown_and_persistence_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.json");
    let gate = Arc::new(ArxivGate::new(Some(path.clone())));
    let lease = gate.acquire(&Context::new("hold", 180)).await.unwrap();
    let g = gate.clone();
    let task = tokio::spawn(async move {
        g.request_with(url(), Context::new("wait", 180), &Hang)
            .await
    });
    tokio::task::yield_now().await;
    gate.cooling(300).unwrap();
    drop(lease);
    assert_eq!(task.await.unwrap().unwrap_err().code, "cooldown");
    let reopened = ArxivGate::new(Some(path.clone()));
    assert!(
        ArxivGate::blocked(&reopened.lock())
            .unwrap()
            .retry_after_seconds
            .unwrap()
            > 290
    );
    std::fs::write(&path, "broken").unwrap();
    assert_eq!(
        ArxivGate::blocked(&ArxivGate::new(Some(path)).lock())
            .unwrap()
            .code,
        "state_storage_error"
    );
}
#[test]
fn daily_retry_after_rules_and_api_targets() {
    assert_eq!(retry_seconds(None, chrono::Utc::now()), 300);
    assert_eq!(retry_seconds(Some("10"), chrono::Utc::now()), 60);
    assert_eq!(retry_seconds(Some("999999"), chrono::Utc::now()), 86400);
    let now = chrono::Utc::now();
    assert!((119..=120).contains(&retry_seconds(
        Some(&(now + chrono::Duration::seconds(120)).to_rfc2822()),
        now
    )));
    for target in [
        "https://arxiv.org/pdf/a",
        "https://example.org/api/query",
        "https://export.arxiv.org/api/query#bad",
    ] {
        assert!(validate(&reqwest::Url::parse(target).unwrap(), false).is_err());
    }
}

#[tokio::test(start_paused = true)]
async fn concurrent_sources_are_fifo_and_retries_rejoin_behind_existing_waiters() {
    let gate = Arc::new(ArxivGate::new(None));
    let sender = Arc::new(Mock::new(vec![Ok(503), Ok(200), Ok(200), Ok(200)]));
    let mut tasks = vec![];
    for source in ["python", "legacy", "chat"] {
        let g = gate.clone();
        let s = sender.clone();
        tasks.push(tokio::spawn(async move {
            g.request_with(url(), Context::new(source, 180), s.as_ref())
                .await
        }));
        tokio::task::yield_now().await;
    }
    for task in tasks {
        task.await.unwrap().unwrap();
    }
    let traces = gate.traces();
    let started: Vec<_> = traces
        .iter()
        .filter(|r| r.state == "sending")
        .map(|r| r.source.as_str())
        .collect();
    assert_eq!(started, vec!["python", "legacy", "chat", "python"]);
    let times = sender.starts.lock().unwrap();
    for pair in times.windows(2) {
        assert!(pair[1] - pair[0] >= Duration::from_secs(4));
    }
    assert_eq!(traces.iter().filter(|r| r.state == "completed").count(), 3);
}

struct Redirects(std::sync::atomic::AtomicUsize);
impl Sender for Redirects {
    fn send(
        &self,
        _: reqwest::Url,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<GateResponse, GateError>> + Send + '_>,
    > {
        let count = self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            Ok(StatusResponse {
                status: if count == 1 { 503 } else { 302 },
                location: Some("https://arxiv.org/api/query".into()),
                retry_after: None,
                bytes: vec![],
            })
        })
    }
}
#[tokio::test(start_paused = true)]
async fn redirects_and_retry_share_budget_and_storage_failure_blocks_future_requests() {
    let gate = Arc::new(ArxivGate::new(None));
    let sender = Redirects(Default::default());
    let error = gate
        .request_with(url(), Context::new("redirect", 180), &sender)
        .await
        .unwrap_err();
    assert_eq!(error.code, "redirect_limit");
    assert_eq!(sender.0.load(Ordering::SeqCst), 7);
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("missing/state.json");
    let gate = Arc::new(ArxivGate::new(Some(missing)));
    // atomic_write_json can create its parent, so make that parent a file to force failure.
    std::fs::write(dir.path().join("missing"), b"file").unwrap();
    let error = gate
        .request_with(
            url(),
            Context::new("storage", 180),
            &Mock::new(vec![Ok(429)]),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, "state_storage_error");
    assert_eq!(
        gate.request_with(url(), Context::new("later", 180), &Hang)
            .await
            .unwrap_err()
            .code,
        "state_storage_error"
    );
}

#[tokio::test(start_paused = true)]
async fn successful_response_has_attempt_metrics_and_bad_persisted_state_blocks_only_api() {
    let gate = Arc::new(ArxivGate::new(None));
    let result = gate
        .request_detailed_with(
            url(),
            Context::new("metrics", 180),
            &Mock::new(vec![Ok(503), Ok(200)]),
        )
        .await
        .unwrap();
    assert_eq!(result.attempts_started, 2);
    assert!(!result.request_id.is_empty());
    assert_eq!(result.source, "metrics");
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.json");
    for bytes in [
        vec![b'x'; 4097],
        serde_json::to_vec(&Persisted {
            version: 1,
            cooldown_until: (chrono::Utc::now() + chrono::Duration::days(2)).to_rfc3339(),
        })
        .unwrap(),
    ] {
        std::fs::write(&path, bytes).unwrap();
        let gate = Arc::new(ArxivGate::new(Some(path.clone())));
        assert_eq!(
            gate.request_with(url(), Context::new("invalid-state", 180), &Hang)
                .await
                .unwrap_err()
                .code,
            "state_storage_error"
        );
    }
    std::fs::write(
        &path,
        serde_json::to_vec(&Persisted {
            version: 1,
            cooldown_until: (chrono::Utc::now() - chrono::Duration::seconds(1)).to_rfc3339(),
        })
        .unwrap(),
    )
    .unwrap();
    let gate = Arc::new(ArxivGate::new(Some(path)));
    gate.request_with(
        url(),
        Context::new("expired", 180),
        &Mock::new(vec![Ok(200)]),
    )
    .await
    .unwrap();
}

#[tokio::test(start_paused = true)]
async fn cooldown_expiry_does_not_replay_failed_waiters_and_fresh_request_can_send() {
    let gate = Arc::new(ArxivGate::new(None));
    let hold = gate.acquire(&Context::new("held", 180)).await.unwrap();
    let sender = Arc::new(Mock::new(vec![Ok(200)]));
    let mut tasks = vec![];
    for source in ["chat", "python", "legacy"] {
        let g = gate.clone();
        let s = sender.clone();
        tasks.push(tokio::spawn(async move {
            g.request_with(url(), Context::new(source, 180), s.as_ref())
                .await
        }));
        tokio::task::yield_now().await;
    }
    gate.cooling(60).unwrap();
    drop(hold);
    for task in tasks {
        assert_eq!(task.await.unwrap().unwrap_err().code, "cooldown");
    }
    assert!(gate.lock().queue.is_empty());
    assert!(sender.starts.lock().unwrap().is_empty());
    tokio::time::advance(Duration::from_secs(61)).await;
    assert!(sender.starts.lock().unwrap().is_empty());
    gate.request_with(url(), Context::new("fresh", 180), sender.as_ref())
        .await
        .unwrap();
    assert_eq!(sender.starts.lock().unwrap().len(), 1);
}
