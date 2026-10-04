//! Forward native new-window requests to the trusted host's tab workflow.
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

use serde::Serialize;

const BURST_LIMIT: usize = 4;
const BURST_WINDOW: Duration = Duration::from_secs(2);
static NEXT_REQUEST: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Serialize)]
pub(super) struct BrowserOpenTabEvent {
    id: String,
    request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn request_id() -> String {
    format!(
        "popup-{}-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_micros(),
        NEXT_REQUEST.fetch_add(1, Ordering::Relaxed)
    )
}

#[derive(Default)]
pub(super) struct PopupRequests {
    recent: Mutex<VecDeque<Instant>>,
}

impl PopupRequests {
    fn prepare_at(
        &self,
        id: &str,
        raw_url: &str,
        now: Instant,
    ) -> Result<BrowserOpenTabEvent, String> {
        // Apply the same protocol, credentials and local-app protection as ordinary navigation.
        let url = super::remote_url(raw_url)?;
        let mut recent = self
            .recent
            .lock()
            .map_err(|_| "网页新标签状态不可用，请重试。")?;
        while recent
            .front()
            .is_some_and(|time| now.saturating_duration_since(*time) >= BURST_WINDOW)
        {
            recent.pop_front();
        }
        if recent.len() >= BURST_LIMIT {
            return Err("网页打开新标签过于频繁，已暂停此请求；请稍后再次点击链接。".into());
        }
        recent.push_back(now);
        Ok(BrowserOpenTabEvent {
            id: id.into(),
            request_id: request_id(),
            url: Some(url.into()),
            error: None,
        })
    }
}

pub(super) fn forward_new_window(
    requests: &PopupRequests,
    id: &str,
    url: &str,
    forward: impl FnOnce(&BrowserOpenTabEvent) -> Result<(), String>,
    report_delivery_error: impl FnOnce(String),
) {
    // Tauri 2.11.3 / Wry 0.55.1 expose size, position and opener, but no user-gesture
    // metadata. Bound bursts instead of claiming that a script request was a user click.
    let event = requests
        .prepare_at(id, url, Instant::now())
        .unwrap_or_else(|error| BrowserOpenTabEvent {
            id: id.into(),
            request_id: request_id(),
            url: None,
            error: Some(error),
        });
    // Rejections belong to this request, not to the source document's navigation state.
    if let Err(error) = forward(&event) {
        report_delivery_error(error);
    }
    // This helper has no source-view handle and never navigates it or creates a native popup.
    // The native caller always returns Deny; only the host frontend may create a separate tab.
}

#[cfg(test)]
#[path = "browser_popup_tests.rs"]
mod tests;
