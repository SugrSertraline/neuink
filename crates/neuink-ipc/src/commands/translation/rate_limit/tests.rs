use super::*;
use serde_json::json;
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

struct Received {
    body: Value,
    at: std::time::Instant,
}

fn server(
    statuses: Vec<u16>,
    retry_after: Option<&'static str>,
) -> (LlmClient, thread::JoinHandle<Vec<Received>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    let server = thread::spawn(move || {
        let mut requests = Vec::new();
        for status in statuses {
            let deadline = std::time::Instant::now() + Duration::from_secs(10);
            let mut socket = loop {
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            std::time::Instant::now() < deadline,
                            "missing expected request"
                        );
                        thread::sleep(Duration::from_millis(2));
                    }
                    Err(error) => panic!("{error}"),
                }
            };
            socket.set_nonblocking(false).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 4096];
            let body = loop {
                let count = socket.read(&mut buffer).unwrap();
                assert!(count > 0);
                bytes.extend_from_slice(&buffer[..count]);
                if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let length: usize = header
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    if bytes.len() >= end + 4 + length {
                        break serde_json::from_slice::<Value>(&bytes[end + 4..end + 4 + length])
                            .unwrap();
                    }
                }
            };
            requests.push(Received {
                body,
                at: std::time::Instant::now(),
            });
            let response = if status == 200 { json!({"choices":[{"message":{"content":"translated"}}]}) }
                else { json!({"error":{"message":"concurrency reached, current: 11, limit: 10","type":"rate_limited"}}) }.to_string();
            let hint = if status == 429 {
                retry_after
                    .map(|hint| format!("Retry-After: {hint}\r\n"))
                    .unwrap_or_default()
            } else {
                String::new()
            };
            write!(socket, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\n{hint}Content-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
        }
        requests
    });
    let profile: LlmProfile = serde_json::from_value(json!({"id":"retry-test","name":"test","base_url":format!("http://{address}/v1"),"model":"test"})).unwrap();
    let mut client = LlmClient::new(profile);
    client.client = reqwest::Client::builder().no_proxy().build().unwrap();
    client.rate_limit = Arc::new(RateLimitGate::new(
        Duration::from_millis(10),
        Duration::from_millis(5),
    ));
    (client, server)
}

#[tokio::test]
async fn streaming_429_waits_for_retry_after_then_retries_the_same_request() {
    let (client, server) = server(vec![429, 200], Some("1"));
    assert_eq!(
        client
            .generate_text("short instruction", "current paragraph")
            .await
            .unwrap(),
        "translated"
    );
    let received = server.join().unwrap();
    assert_eq!(received.len(), 2);
    assert_eq!(received[0].body, received[1].body);
    assert_eq!(received[1].body["stream"], true);
    assert!(received[1].at.duration_since(received[0].at) >= Duration::from_secs(1));
}

#[tokio::test]
async fn persistent_429_is_bounded_and_never_triggers_non_streaming_fallback() {
    let (client, server) = server(vec![429; 6], None);
    let error = client
        .generate_text("instruction", "paragraph")
        .await
        .unwrap_err();
    assert_eq!(error, RequestError::RateLimited.to_string());
    let received = server.join().unwrap();
    assert_eq!(received.len(), 6);
    assert!(received
        .iter()
        .all(|request| request.body["stream"] == true));
    for (index, pair) in received.windows(2).enumerate() {
        assert!(pair[1].at.duration_since(pair[0].at) >= Duration::from_millis(10 * (1 << index)));
    }
}

#[tokio::test]
async fn non_streaming_compatibility_fallback_also_waits_on_429() {
    let (client, server) = server(vec![400, 429, 200], None);
    assert_eq!(
        client
            .generate_text("instruction", "paragraph")
            .await
            .unwrap(),
        "translated"
    );
    let received = server.join().unwrap();
    assert_eq!(received[0].body["stream"], true);
    assert_ne!(received[1].body["stream"], true);
    assert_eq!(received[1].body, received[2].body);
    assert!(received[2].at.duration_since(received[1].at) >= Duration::from_millis(10));
}

#[test]
fn retry_after_accepts_seconds_and_dates_and_ignores_invalid_values() {
    let mut headers = HeaderMap::new();
    headers.insert(RETRY_AFTER, "15".parse().unwrap());
    assert_eq!(retry_after(&headers), Some(Duration::from_secs(15)));
    let date = (chrono::Utc::now() + chrono::Duration::seconds(30)).to_rfc2822();
    headers.insert(RETRY_AFTER, date.parse().unwrap());
    let delay = retry_after(&headers).unwrap();
    assert!(delay >= Duration::from_secs(28) && delay <= Duration::from_secs(30));
    headers.insert(RETRY_AFTER, "invalid".parse().unwrap());
    assert_eq!(retry_after(&headers), None);
    headers.insert(RETRY_AFTER, "3600".parse().unwrap());
    assert!(!RateLimitGate::new(Duration::from_millis(1), Duration::ZERO).defer(0, &headers));
}

#[tokio::test]
async fn same_service_shares_cooldown_across_models_and_releases_waiters_gradually() {
    let profile: LlmProfile = serde_json::from_value(json!({"id":"shared-gate","name":"test","base_url":"http://shared-cooldown.test/v1","model":"first"})).unwrap();
    let first = LlmClient::new(profile.clone());
    let mut other = profile.clone();
    other.model = "second".into();
    other.base_url.push('/');
    let second = LlmClient::new(other);
    assert!(Arc::ptr_eq(&first.rate_limit, &second.rate_limit));
    first.rate_limit.defer(0, &HeaderMap::new());
    let old_gate = Arc::downgrade(&first.rate_limit);
    drop(first);
    drop(second);
    let later = LlmClient::new(profile);
    assert!(Arc::ptr_eq(&later.rate_limit, &old_gate.upgrade().unwrap()));

    let gate = RateLimitGate::new(Duration::from_millis(20), Duration::from_millis(20));
    gate.defer(0, &HeaderMap::new());
    let started = Instant::now();
    let wait = || async {
        gate.wait_turn().await.unwrap();
        Instant::now()
    };
    let (one, two) = futures_util::future::join(wait(), wait()).await;
    assert!(one.min(two).duration_since(started) >= Duration::from_millis(19));
    assert!(one.max(two).duration_since(one.min(two)) >= Duration::from_millis(19));
}

#[tokio::test]
async fn successful_requests_have_no_extra_retry_or_initial_cooldown() {
    let (client, server) = server(vec![200], None);
    assert_eq!(
        client
            .generate_text("instruction", "paragraph")
            .await
            .unwrap(),
        "translated"
    );
    assert_eq!(server.join().unwrap().len(), 1);
}

#[tokio::test]
async fn long_retry_after_also_prevents_new_requests_from_retrying_early() {
    let gate = RateLimitGate::new(Duration::from_millis(10), Duration::ZERO);
    let mut headers = HeaderMap::new();
    headers.insert(RETRY_AFTER, "3600".parse().unwrap());
    assert!(!gate.defer(0, &headers));
    assert!(matches!(
        gate.wait_turn().await,
        Err(RequestError::RateLimited)
    ));
}

#[tokio::test]
async fn cooldown_releases_the_slot_and_response_keeps_it_until_consumed() {
    let (mut client, server) = server(vec![429, 200], Some("1"));
    client.scheduler = Arc::new(super::super::scheduler::RequestScheduler::new(1));
    let scheduler = client.scheduler.clone();
    let (notify, mut waiting) = tokio::sync::mpsc::unbounded_channel();
    client.activity = Some(Arc::new(move |phase| {
        if matches!(phase, RequestActivity::RateLimited(_)) {
            let _ = notify.send(());
        }
    }));
    let task = tokio::spawn(async move { client.generate_text("instruction", "paragraph").await });
    tokio::time::timeout(Duration::from_secs(2), waiting.recv())
        .await
        .unwrap()
        .unwrap();
    let other_request = tokio::time::timeout(Duration::from_millis(200), scheduler.acquire(true))
        .await
        .unwrap()
        .unwrap();
    drop(other_request);
    assert_eq!(task.await.unwrap().unwrap(), "translated");
    assert_eq!(server.join().unwrap().len(), 2);
}
