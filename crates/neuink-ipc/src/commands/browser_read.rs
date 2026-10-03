//! One-shot native evaluation. Remote documents never receive an IPC capability or callback.
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

use serde::Deserialize;
use tauri::{Manager, Runtime};
use tokio::sync::{oneshot, watch, Semaphore};

use super::snapshot::{self, parse_snapshot, BrowserSnapshot};
#[cfg(test)]
use super::snapshot::{RAW_LIMIT, TEXT_LIMIT};
pub(super) const CHANGED: &str = "网页已切换、重新加载或关闭，请重新发送请求。";
pub(super) const LOADING: &str = "网页仍在加载，请等待加载完成后重试。";
const SCRIPT: &str = include_str!("browser_read.js");
const READABILITY: &str = include_str!("vendor/readability/Readability.js");
#[path = "browser_read_calls.rs"]
mod calls;

#[derive(Deserialize)]
pub struct ReadBrowserRequest {
    id: String,
    expected_url: String,
    expected_navigation_id: Option<String>,
    #[serde(default)]
    selection_only: bool,
    #[serde(default)]
    validate_only: bool,
    call_id: Option<String>,
}

#[derive(Clone, Copy)]
struct ReadStatus {
    generation: u64,
    loading: bool,
    closed: bool,
}

pub(super) struct TabReadState {
    status: watch::Sender<ReadStatus>,
    reader: Arc<Semaphore>,
}

impl TabReadState {
    pub(super) fn new() -> Arc<Self> {
        let (status, _) = watch::channel(ReadStatus {
            generation: NEXT_GENERATION.fetch_add(1, Ordering::Relaxed),
            loading: true,
            closed: false,
        });
        Arc::new(Self {
            status,
            reader: Arc::new(Semaphore::new(1)),
        })
    }

    pub(super) fn navigate(&self) {
        self.status.send_modify(|status| {
            status.generation = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed);
            status.loading = true;
        });
    }

    pub(super) fn finish(&self) {
        self.status.send_modify(|status| status.loading = false);
    }

    fn close(&self) {
        self.status.send_modify(|status| status.closed = true);
    }
}

type Tabs = Mutex<HashMap<String, Arc<TabReadState>>>;
static TABS: OnceLock<Tabs> = OnceLock::new();
static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);
static PROCESS_EPOCH: OnceLock<String> = OnceLock::new();

fn generation_id(generation: u64) -> String {
    let epoch = PROCESS_EPOCH.get_or_init(|| {
        format!(
            "{}-{}",
            chrono::Utc::now().timestamp_micros(),
            std::process::id()
        )
    });
    format!("{epoch}-{generation}")
}

pub(super) fn navigation_id(id: &str) -> Option<String> {
    let states = tabs().lock().ok()?;
    let state = states.get(id)?;
    let status = *state.status.borrow();
    (!status.closed).then(|| generation_id(status.generation))
}

fn tabs() -> &'static Tabs {
    TABS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(super) fn remember(id: &str, state: Arc<TabReadState>) -> Result<(), String> {
    if let Some(previous) = tabs()
        .lock()
        .map_err(|_| "网页状态不可用")?
        .insert(id.into(), state)
    {
        previous.close();
    }
    Ok(())
}

pub(super) fn forget(id: &str) -> Result<(), String> {
    if let Some(state) = tabs().lock().map_err(|_| "网页状态不可用")?.remove(id) {
        state.close();
    }
    Ok(())
}

fn trusted_url(url: &tauri::Url, dev_url: Option<&tauri::Url>) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    matches!(
        (url.scheme(), url.host_str(), url.port()),
        ("tauri", Some("localhost"), None) | ("http" | "https", Some("tauri.localhost"), None)
    ) || (cfg!(debug_assertions)
        && dev_url.is_some_and(|dev| {
            matches!(dev.scheme(), "http" | "https")
                && matches!(dev.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
                && dev.origin() == url.origin()
        }))
}

fn check_status(status: ReadStatus, expected_generation: u64) -> Result<(), String> {
    if status.closed || status.generation != expected_generation {
        return Err(CHANGED.into());
    }
    if status.loading {
        return Err(LOADING.into());
    }
    Ok(())
}

fn check_frozen_target(status: ReadStatus, expected_id: Option<&str>) -> Result<(), String> {
    check_status(status, status.generation)?;
    if expected_id.is_some_and(|id| id != generation_id(status.generation)) {
        return Err(CHANGED.into());
    }
    Ok(())
}

pub(super) async fn capture<R: Runtime>(
    app: &tauri::AppHandle<R>,
    caller: &tauri::Webview<R>,
    request: ReadBrowserRequest,
) -> Result<BrowserSnapshot, String> {
    let caller_url = caller.url().map_err(|_| "网页读取未授权")?;
    if caller.label() != "main"
        || !trusted_url(&caller_url, app.config().build.dev_url.as_ref())
        || !super::valid_id(&request.id)
    {
        return Err("网页读取未授权".into());
    }
    let expected = super::remote_url(&request.expected_url)?;
    let state = tabs()
        .lock()
        .map_err(|_| "网页状态不可用")?
        .get(&request.id)
        .cloned()
        .ok_or(CHANGED)?;
    let _permit = state
        .reader
        .clone()
        .try_acquire_owned()
        .map_err(|_| "该网页正在读取，请稍后重试。")?;
    let mut changes = state.status.subscribe();
    let initial = *changes.borrow_and_update();
    check_frozen_target(initial, request.expected_navigation_id.as_deref())?;
    let label = format!("{}{}", super::PREFIX, request.id);
    let view = app.get_webview(&label).ok_or(CHANGED)?;
    if view.url().map_err(|_| CHANGED)? != expected {
        return Err(CHANGED.into());
    }
    if request.validate_only {
        return Ok(snapshot::empty(&expected));
    }
    let (_registration, mut cancelled) = calls::register(request.call_id.as_deref())?;
    let known_pdf = !request.selection_only && is_pdf_url(&expected);
    let started = tokio::time::Instant::now();
    let (deadline, deadline_changes) = watch::channel(started + initial_capture_budget(known_pdf));
    let evaluation_changes = changes.clone();
    let read = async {
        if known_pdf {
            let bytes = super::media::read_pdf(expected.as_str()).await?;
            return Ok(snapshot::pdf(&expected, &bytes));
        }
        if !request.selection_only && super::media::video_url(expected.as_str()).is_some() {
            let media = super::media::read_video(app, expected.as_str()).await?;
            let mut result = snapshot::empty(&expected);
            result.text = media.text;
            result.content_type = media.content_type;
            result.extractor = media.extractor;
            result.truncated = media.truncated;
            result.limitations = media.limitations;
            return Ok(result);
        }
        let raw = evaluate(&view, &expected, evaluation_changes).await?;
        let decoded = snapshot::decode(&raw)?;
        if decoded.status == "pdf"
            && tauri::Url::parse(&decoded.url).ok().as_ref() == Some(&expected)
        {
            if request.selection_only {
                return Err("网页 PDF 查看器不提供可读取选区；可以读取 PDF 正文。".into());
            }
            // Extensionless PDFs may first spend up to 8s identifying the native viewer.
            // Other pages keep their existing budget; only this validated PDF stage extends it.
            deadline.send_replace(started + Duration::from_secs(75));
            let bytes = super::media::read_pdf(expected.as_str()).await?;
            return Ok(snapshot::pdf(&expected, &bytes));
        }
        parse_snapshot(&raw, &expected)
    };
    let result = tokio::select! {
        result = read => result,
        _ = changes.changed() => Err(CHANGED.into()),
        _ = &mut cancelled => Err("网页读取已取消。".into()),
        _ = await_read_deadline(deadline_changes) => Err("网页读取超时，请稍后重试。".into()),
    };
    check_status(*changes.borrow(), initial.generation)?;
    if app.get_webview(&label).is_none() || view.url().map_err(|_| CHANGED)? != expected {
        return Err(CHANGED.into());
    }
    result.map(|mut snapshot| {
        snapshot.navigation_id = Some(generation_id(initial.generation));
        snapshot
    })
}

fn initial_capture_budget(known_pdf: bool) -> Duration {
    Duration::from_secs(if known_pdf { 65 } else { 45 })
}

async fn await_read_deadline(mut deadlines: watch::Receiver<tokio::time::Instant>) {
    loop {
        let deadline = *deadlines.borrow_and_update();
        tokio::select! {
            _ = tokio::time::sleep_until(deadline) => return,
            changed = deadlines.changed() => {
                if changed.is_err() {
                    tokio::time::sleep_until(deadline).await;
                    return;
                }
            }
        }
    }
}

fn is_pdf_url(url: &tauri::Url) -> bool {
    url.path().to_ascii_lowercase().ends_with(".pdf")
        || (matches!(
            url.host_str(),
            Some("arxiv.org" | "www.arxiv.org" | "export.arxiv.org")
        ) && url.path().starts_with("/pdf/"))
}

async fn evaluate<R: Runtime>(
    view: &tauri::Webview<R>,
    expected: &tauri::Url,
    mut changes: watch::Receiver<ReadStatus>,
) -> Result<String, String> {
    let script = format!(
        "(() => {{ const module = {{exports:{{}}}}; {READABILITY}\n return ({SCRIPT})({}, Readability); }})()",
        serde_json::to_string(expected.as_str()).map_err(|_| "网页读取失败")?
    );
    let (sender, receiver) = oneshot::channel();
    let pending = Arc::new(Mutex::new(Some(sender)));
    let callback_pending = pending.clone();
    // Tauri/Wry returns the ExecuteScript result through its native callback. It is not a
    // Tauri event or window message that another remote page could forge or subscribe to.
    view.eval_with_callback(script, move |payload| {
        if let Ok(mut slot) = callback_pending.lock() {
            if let Some(sender) = slot.take() {
                let _ = sender.send(payload);
            }
        }
    })
    .map_err(|_| "无法读取网页正文")?;
    await_capture(receiver, &mut changes, pending, Duration::from_secs(8)).await
}

type PendingCallback = Arc<Mutex<Option<oneshot::Sender<String>>>>;

struct PendingCallbackGuard(PendingCallback);
impl Drop for PendingCallbackGuard {
    fn drop(&mut self) {
        // Also runs when the outer media/navigation/cancel select drops this future.
        if let Ok(mut slot) = self.0.lock() {
            slot.take();
        }
    }
}

async fn await_capture(
    receiver: oneshot::Receiver<String>,
    changes: &mut watch::Receiver<ReadStatus>,
    pending: PendingCallback,
    timeout: Duration,
) -> Result<String, String> {
    let _callback_guard = PendingCallbackGuard(pending);
    tokio::select! {
        result = receiver => result.map_err(|_| "网页读取已取消".to_string()),
        _ = tokio::time::sleep(timeout) => Err("网页读取超时，请稍后重试。".into()),
        _ = changes.changed() => Err(CHANGED.into()),
    }
}
pub(super) fn cancel<R: Runtime>(
    app: &tauri::AppHandle<R>,
    caller: &tauri::Webview<R>,
    id: &str,
) -> Result<(), String> {
    if caller.label() != "main"
        || !trusted_url(
            &caller.url().map_err(|_| "网页读取未授权")?,
            app.config().build.dev_url.as_ref(),
        )
    {
        return Err("网页读取未授权".into());
    }
    calls::cancel(id)
}

#[cfg(test)]
#[path = "browser_read_tests.rs"]
mod tests;
