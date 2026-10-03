use super::*;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

#[derive(Default)]
struct Attempts {
    started: AtomicUsize,
    active: AtomicUsize,
    released: AtomicUsize,
}

struct Attempt(Arc<Attempts>);
impl Attempt {
    fn new(attempts: Arc<Attempts>) -> Self {
        attempts.started.fetch_add(1, Ordering::Relaxed);
        assert_eq!(attempts.active.fetch_add(1, Ordering::Relaxed), 0);
        Self(attempts)
    }
}
impl Drop for Attempt {
    fn drop(&mut self) {
        assert_eq!(self.0.active.fetch_sub(1, Ordering::Relaxed), 1);
        self.0.released.fetch_add(1, Ordering::Relaxed);
    }
}

fn response(bytes: &[u8]) -> network::Response {
    network::Response {
        url: reqwest::Url::parse("https://example.org/paper.pdf").unwrap(),
        content_type: "application/pdf".into(),
        bytes: bytes.to_vec(),
    }
}

fn assert_released(attempts: &Attempts, count: usize) {
    assert_eq!(attempts.started.load(Ordering::Relaxed), count);
    assert_eq!(attempts.released.load(Ordering::Relaxed), count);
    assert_eq!(attempts.active.load(Ordering::Relaxed), 0);
}

#[tokio::test(start_paused = true)]
async fn only_connection_and_body_failures_retry_once_and_release_before_retry() {
    for error in ["远程连接失败或超时", "读取远程内容失败"] {
        let attempts = Arc::new(Attempts::default());
        let started = tokio::time::Instant::now();
        let bytes = read_pdf_with_fetch(|| {
            let guard = Attempt::new(attempts.clone());
            let first = attempts.started.load(Ordering::Relaxed) == 1;
            async move {
                let _guard = guard;
                tokio::time::sleep(Duration::from_secs(2)).await;
                if first {
                    Err(error.into())
                } else {
                    Ok(response(b"%PDF-1.7\ncomplete"))
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(bytes, b"%PDF-1.7\ncomplete");
        assert_eq!(started.elapsed(), Duration::from_secs(4));
        assert_released(&attempts, 2);
    }
}

#[tokio::test(start_paused = true)]
async fn repeated_transport_failure_stops_after_the_single_retry() {
    let attempts = Arc::new(Attempts::default());
    let result = read_pdf_with_fetch(|| {
        let guard = Attempt::new(attempts.clone());
        async move {
            let _guard = guard;
            Err("读取远程内容失败".into())
        }
    })
    .await;
    assert_eq!(result.unwrap_err(), PDF_DOWNLOAD_CONNECTION);
    assert_released(&attempts, 2);
}

#[tokio::test(start_paused = true)]
async fn permanent_errors_never_retry_and_unknown_details_are_not_trusted() {
    for error in [
        "远程服务返回 HTTP 401",
        "远程服务返回 HTTP 403",
        "远程服务返回 HTTP 429",
        "远程服务返回 HTTP 500",
        "响应超过大小限制",
        "服务地址解析到非公开网络，已阻止访问",
        "仅允许不含凭据的公开 HTTPS 网址（443 端口）",
        "无法解析服务地址",
        "无法创建检索连接",
        "远程跳转次数过多",
        "跳转地址无效",
        "网址无效",
        "读取远程内容失败 token=private",
        "unknown remote response body",
    ] {
        let attempts = Arc::new(Attempts::default());
        let result = read_pdf_with_fetch(|| {
            let guard = Attempt::new(attempts.clone());
            async move {
                let _guard = guard;
                Err(error.into())
            }
        })
        .await;
        assert_eq!(result.unwrap_err(), pdf_download_error(error.into()));
        assert_released(&attempts, 1);
    }
}

#[tokio::test(start_paused = true)]
async fn successful_response_is_validated_once_without_retrying_invalid_pdf() {
    for bytes in [b"%PDF-1.7\ncomplete".as_slice(), b"<html>login</html>"] {
        let attempts = Arc::new(Attempts::default());
        let result = read_pdf_with_fetch(|| {
            let guard = Attempt::new(attempts.clone());
            async move {
                let _guard = guard;
                Ok(response(bytes))
            }
        })
        .await;
        assert_eq!(result.is_ok(), bytes.starts_with(b"%PDF-"));
        assert_released(&attempts, 1);
    }
}

#[tokio::test(start_paused = true)]
async fn an_attempt_deadline_releases_partial_work_then_allows_one_success() {
    let attempts = Arc::new(Attempts::default());
    let started = tokio::time::Instant::now();
    let result = read_pdf_with_fetch(|| {
        let guard = Attempt::new(attempts.clone());
        let first = attempts.started.load(Ordering::Relaxed) == 1;
        async move {
            let _guard = guard;
            if first {
                std::future::pending::<()>().await;
            }
            Ok(response(b"%PDF-1.7\ncomplete"))
        }
    })
    .await;
    assert!(result.is_ok());
    assert_eq!(started.elapsed(), Duration::from_secs(30));
    assert_released(&attempts, 2);
}

#[tokio::test(start_paused = true)]
async fn two_stalled_attempts_stop_at_sixty_seconds_without_a_third_attempt() {
    let attempts = Arc::new(Attempts::default());
    let started = tokio::time::Instant::now();
    let result = read_pdf_with_fetch(|| {
        let guard = Attempt::new(attempts.clone());
        async move {
            let _guard = guard;
            std::future::pending::<Result<network::Response, String>>().await
        }
    })
    .await;
    assert_eq!(result.unwrap_err(), PDF_DOWNLOAD_TIMEOUT);
    assert_eq!(started.elapsed(), Duration::from_secs(60));
    assert_released(&attempts, 2);
}

#[tokio::test(start_paused = true)]
async fn cancellation_during_either_attempt_releases_work_and_never_restarts() {
    for (cancel_after, expected_attempts) in [(5, 1), (35, 2)] {
        let attempts = Arc::new(Attempts::default());
        let result = tokio::time::timeout(
            Duration::from_secs(cancel_after),
            read_pdf_with_fetch(|| {
                let guard = Attempt::new(attempts.clone());
                async move {
                    let _guard = guard;
                    std::future::pending::<Result<network::Response, String>>().await
                }
            }),
        )
        .await;
        assert!(result.is_err());
        tokio::time::advance(Duration::from_secs(100)).await;
        assert_released(&attempts, expected_attempts);
    }
}
