//! Single process-wide API scheduler. No PDF, cache or model dependencies.
mod error;
mod request;
mod scheduler;
#[cfg(test)]
mod acceptance_observer;
#[cfg(test)]
mod acceptance_tests;
use super::network::{self, StatusResponse};
pub use error::{from_wire, retry_seconds, GateError};
use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tokio::{sync::Notify, time::Instant};

pub type GateResponse = StatusResponse;
pub struct GateSuccess {
    pub response: GateResponse,
    pub request_id: String,
    pub source: &'static str,
    pub attempts_started: u32,
}
pub trait Sender: Send + Sync {
    fn send(
        &self,
        url: reqwest::Url,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<GateResponse, GateError>> + Send + '_>,
    >;
}
pub(super) struct NativeSender;
impl Sender for NativeSender {
    fn send(
        &self,
        url: reqwest::Url,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<GateResponse, GateError>> + Send + '_>,
    > {
        Box::pin(async move {
            #[cfg(test)]
            let mut observation = acceptance_observer::begin()?;
            let result = network::get_status(&url, 2 * 1024 * 1024)
                .await
                .map_err(Into::into);
            #[cfg(test)]
            if let Some(observation) = observation.as_mut() {
                observation.finish(&result);
            }
            result
        })
    }
}
#[derive(Clone)]
pub struct Context {
    pub request_id: String,
    pub source: &'static str,
    pub deadline: Instant,
}
impl Context {
    pub fn new(source: &'static str, seconds: u64) -> Self {
        Self {
            request_id: neuink_domain::NoteId::new().to_string(),
            source,
            deadline: Instant::now() + Duration::from_secs(seconds),
        }
    }
}
tokio::task_local! { static CURRENT: Context; }
pub async fn scope<T>(
    source: &'static str,
    seconds: u64,
    future: impl std::future::Future<Output = T>,
) -> T {
    let mut context = Context::new(source, seconds);
    if let Ok(parent) = CURRENT.try_with(Clone::clone) {
        context.deadline = context.deadline.min(parent.deadline);
    }
    CURRENT.scope(context, future).await
}
pub fn context(source: &'static str) -> Context {
    CURRENT
        .try_with(Clone::clone)
        .unwrap_or_else(|_| Context::new(source, 180))
}

struct State {
    queue: VecDeque<u64>,
    next_id: u64,
    active: bool,
    next_send: Option<Instant>,
    cooldown: Option<(Instant, String)>,
    storage_failed: bool,
}
#[derive(Clone, serde::Serialize)]
pub struct RequestTrace {
    pub request_id: String,
    pub source: String,
    pub state: String,
    pub elapsed_ms: u64,
    pub attempts_started: u32,
    pub code: Option<String>,
}
pub struct ArxivGate {
    state: Mutex<State>,
    changed: Notify,
    path: Option<PathBuf>,
    traces: Mutex<VecDeque<RequestTrace>>,
    born: Instant,
}

fn read_state(path: &std::path::Path) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(4097)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 4096 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "gate state too large",
        ));
    }
    Ok(bytes)
}
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Persisted {
    version: u32,
    cooldown_until: String,
}
struct Ticket {
    gate: Arc<ArxivGate>,
    id: u64,
}
impl Drop for Ticket {
    fn drop(&mut self) {
        if self.id != 0 {
            self.gate.lock().queue.retain(|id| *id != self.id);
            self.gate.changed.notify_waiters();
        }
    }
}
struct Lease {
    gate: Arc<ArxivGate>,
}
impl Drop for Lease {
    fn drop(&mut self) {
        let mut s = self.gate.lock();
        s.active = false;
        s.next_send = Some(Instant::now() + Duration::from_secs(3));
        drop(s);
        self.gate.changed.notify_waiters();
    }
}
pub fn validate(url: &reqwest::Url, redirect: bool) -> Result<(), GateError> {
    network::public_url(url.as_str()).map_err(|_| GateError::new("invalid_target"))?;
    if url.path() != "/api/query"
        || url.fragment().is_some()
        || !matches!(url.host_str(), Some("export.arxiv.org"))
            && !(redirect && url.host_str() == Some("arxiv.org"))
    {
        return Err(GateError::new("invalid_target"));
    }
    Ok(())
}
static SHARED: OnceLock<Arc<ArxivGate>> = OnceLock::new();
pub fn initialize<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let gate = match crate::storage::settings_path(app) {
        Ok(path) => ArxivGate::new(Some(path.with_file_name("arxiv-gate-state.json"))),
        Err(_) => {
            let gate = ArxivGate::new(None);
            gate.lock().storage_failed = true;
            gate
        }
    };
    let _ = SHARED.set(Arc::new(gate));
}
pub fn shared() -> Result<Arc<ArxivGate>, GateError> {
    SHARED
        .get()
        .cloned()
        .ok_or_else(|| GateError::new("state_storage_error"))
}

#[cfg(test)]
mod tests;
