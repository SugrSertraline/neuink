use super::{bounded, bounded_with_body_timeout};
use futures_util::stream;
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::time::Instant;

const IDLE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Default)]
struct StreamState {
    polls: AtomicUsize,
    chunks: AtomicUsize,
    dropped: AtomicBool,
}

struct DropSignal(Arc<StreamState>);

impl Drop for DropSignal {
    fn drop(&mut self) {
        self.0.dropped.store(true, Ordering::SeqCst);
    }
}

fn streamed_response(
    status: u16,
    declared_size: Option<usize>,
    chunks: Vec<(Duration, Vec<u8>)>,
    pending_after_chunks: bool,
) -> (reqwest::Response, Arc<StreamState>) {
    let state = Arc::new(StreamState::default());
    let signal = DropSignal(Arc::clone(&state));
    let body = reqwest::Body::wrap_stream(stream::unfold(
        (VecDeque::from(chunks), signal),
        move |(mut chunks, signal)| async move {
            signal.0.polls.fetch_add(1, Ordering::SeqCst);
            let Some((delay, bytes)) = chunks.pop_front() else {
                if pending_after_chunks {
                    std::future::pending::<()>().await;
                }
                return None;
            };
            tokio::time::sleep(delay).await;
            signal.0.chunks.fetch_add(1, Ordering::SeqCst);
            Some((Ok::<_, std::io::Error>(bytes), (chunks, signal)))
        },
    ));
    let mut response = tauri::http::Response::builder().status(status);
    if let Some(size) = declared_size {
        response = response.header("content-length", size);
    }
    (reqwest::Response::from(response.body(body).unwrap()), state)
}

#[tokio::test(start_paused = true)]
async fn idle_body_timeout_discards_partial_content_and_releases_stream() {
    let (response, state) = streamed_response(
        200,
        None,
        vec![(Duration::ZERO, b"partial-private-content".to_vec())],
        true,
    );
    let start = Instant::now();
    assert_eq!(
        bounded_with_body_timeout(response, 100, Some(IDLE_TIMEOUT))
            .await
            .unwrap_err(),
        "读取远程内容失败"
    );
    assert_eq!(state.chunks.load(Ordering::SeqCst), 1);
    assert!(state.dropped.load(Ordering::SeqCst));
    assert_eq!(start.elapsed(), IDLE_TIMEOUT);
}

#[tokio::test(start_paused = true)]
async fn each_progressing_chunk_resets_the_idle_deadline() {
    let (response, state) = streamed_response(
        200,
        None,
        vec![
            (Duration::from_secs(4), b"one".to_vec()),
            (Duration::from_secs(4), b"two".to_vec()),
            (Duration::from_secs(4), b"three".to_vec()),
        ],
        false,
    );
    let start = Instant::now();
    assert_eq!(
        bounded_with_body_timeout(response, 100, Some(IDLE_TIMEOUT))
            .await
            .unwrap(),
        b"onetwothree"
    );
    assert_eq!(start.elapsed(), Duration::from_secs(12));
    assert_eq!(state.chunks.load(Ordering::SeqCst), 3);
    assert!(state.dropped.load(Ordering::SeqCst));
}

#[tokio::test(start_paused = true)]
async fn status_and_declared_size_rejections_precede_body_timeout() {
    for (status, size, expected) in [
        (401, Some(100), "远程服务返回 HTTP 401"),
        (200, Some(100), "响应超过大小限制"),
    ] {
        let (response, state) = streamed_response(status, size, vec![], true);
        assert_eq!(
            bounded_with_body_timeout(response, 10, Some(Duration::ZERO))
                .await
                .unwrap_err(),
            expected
        );
        assert_eq!(state.polls.load(Ordering::SeqCst), 0);
        assert!(state.dropped.load(Ordering::SeqCst));
    }
}

#[tokio::test(start_paused = true)]
async fn received_size_limit_still_stops_a_progressing_body() {
    let (response, state) = streamed_response(
        200,
        None,
        vec![
            (Duration::from_secs(1), vec![b'x'; 8]),
            (Duration::from_secs(1), vec![b'y'; 8]),
        ],
        true,
    );
    assert_eq!(
        bounded_with_body_timeout(response, 10, Some(IDLE_TIMEOUT))
            .await
            .unwrap_err(),
        "响应超过大小限制"
    );
    assert_eq!(state.chunks.load(Ordering::SeqCst), 2);
    assert!(state.dropped.load(Ordering::SeqCst));
}

#[tokio::test(start_paused = true)]
async fn ordinary_bounded_transport_has_no_new_idle_timeout() {
    let (response, state) = streamed_response(
        200,
        None,
        vec![(Duration::from_secs(30), b"slow-but-valid".to_vec())],
        false,
    );
    let start = Instant::now();
    assert_eq!(bounded(response, 100).await.unwrap(), b"slow-but-valid");
    assert_eq!(start.elapsed(), Duration::from_secs(30));
    assert!(state.dropped.load(Ordering::SeqCst));
}
