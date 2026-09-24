use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use reqwest::{
    header::{HeaderMap, RETRY_AFTER},
    Response, StatusCode,
};
use tokio::time::{sleep_until, timeout, Instant};

use super::{LlmClient, LlmProfile, RequestActivity, Value};

const MAX_RETRIES: u32 = 5;
const MAX_SERVER_WAIT: Duration = Duration::from_secs(300);

#[derive(Debug, thiserror::Error)]
pub(super) enum RequestError {
    #[error("翻译服务仍在限流，请稍后重试失败的翻译。")]
    RateLimited,
    #[error("翻译请求超时。")]
    Timeout,
    #[error("{0}")]
    Other(String),
}

impl From<String> for RequestError {
    fn from(value: String) -> Self {
        Self::Other(value)
    }
}

struct Cooldown {
    until: Instant,
    pace_until: Instant,
    revision: u64,
}

pub(super) struct RateLimitGate {
    cooldown: Mutex<Cooldown>,
    base_delay: Duration,
    spacing: Duration,
}

impl RateLimitGate {
    fn new(base_delay: Duration, spacing: Duration) -> Self {
        let now = Instant::now();
        Self {
            cooldown: Mutex::new(Cooldown {
                until: now,
                pace_until: now,
                revision: 0,
            }),
            base_delay,
            spacing,
        }
    }

    pub(super) fn for_profile(profile: &LlmProfile) -> Arc<Self> {
        static GATES: OnceLock<Mutex<HashMap<String, Arc<RateLimitGate>>>> = OnceLock::new();
        // Models/profiles using the same endpoint and credential share the provider quota.
        // Store only a digest, never an API key, as the in-memory identity.
        let identity = format!(
            "{}\0{}",
            profile.base_url.trim().trim_end_matches('/'),
            profile.api_key.as_deref().unwrap_or_default()
        );
        let key = blake3::hash(identity.as_bytes()).to_hex().to_string();
        let mut gates = GATES
            .get_or_init(Mutex::default)
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        gates.retain(|_, gate| {
            Arc::strong_count(gate) > 1
                || gate
                    .cooldown
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .pace_until
                    > Instant::now()
        });
        if let Some(gate) = gates.get(&key) {
            return gate.clone();
        }
        let gate = Arc::new(Self::new(Duration::from_secs(2), Duration::from_secs(1)));
        gates.insert(key, gate.clone());
        gate
    }

    #[cfg(test)]
    async fn wait_turn(&self) -> Result<u64, RequestError> {
        self.wait_turn_with_progress(|_| {}).await
    }

    async fn wait_turn_with_progress(&self, report: impl Fn(u64)) -> Result<u64, RequestError> {
        loop {
            let deadline = {
                let mut cooldown = self
                    .cooldown
                    .lock()
                    .unwrap_or_else(|error| error.into_inner());
                let now = Instant::now();
                if cooldown.until <= now {
                    // After a rejection, release waiting requests gradually, not as a burst.
                    if now < cooldown.pace_until {
                        cooldown.until = now + self.spacing;
                    }
                    return Ok(cooldown.revision);
                }
                cooldown.until
            };
            if deadline.saturating_duration_since(Instant::now()) > MAX_SERVER_WAIT {
                return Err(RequestError::RateLimited);
            }
            report(
                deadline
                    .saturating_duration_since(Instant::now())
                    .as_millis() as u64,
            );
            sleep_until(deadline).await;
        }
    }

    fn defer(&self, attempt: u32, headers: &HeaderMap) -> bool {
        let delay = self.base_delay * (1 << attempt.min(MAX_RETRIES));
        let delay = delay.max(retry_after(headers).unwrap_or_default());
        let mut cooldown = self
            .cooldown
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let now = Instant::now();
        cooldown.until = cooldown
            .until
            .max(now.checked_add(delay).unwrap_or(now + MAX_SERVER_WAIT));
        cooldown.pace_until = cooldown.until + Duration::from_secs(60);
        cooldown.revision += 1;
        // Never retry sooner than a long Retry-After requested by the provider.
        delay <= MAX_SERVER_WAIT
    }
}

fn retry_after(headers: &HeaderMap) -> Option<Duration> {
    let value = headers.get(RETRY_AFTER)?.to_str().ok()?.trim();
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }
    let at = chrono::DateTime::parse_from_rfc2822(value).ok()?;
    Some(
        (at.with_timezone(&chrono::Utc) - chrono::Utc::now())
            .to_std()
            .unwrap_or_default(),
    )
}

impl LlmClient {
    pub(super) async fn send_translation_request(
        &self,
        url: &str,
        headers: &HeaderMap,
        body: &Value,
        request_timeout: Duration,
    ) -> Result<(Response, tokio::sync::OwnedSemaphorePermit), RequestError> {
        for attempt in 0..=MAX_RETRIES {
            let slot = loop {
                let revision = self
                    .rate_limit
                    .wait_turn_with_progress(|ms| {
                        if let Some(report) = &self.activity {
                            report(RequestActivity::RateLimited(ms));
                        }
                    })
                    .await?;
                if let Some(report) = &self.activity {
                    report(RequestActivity::Queued);
                }
                let slot = self.scheduler.acquire(self.interactive).await?;
                let current = self
                    .rate_limit
                    .cooldown
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .revision;
                if current == revision {
                    break slot;
                }
                drop(slot);
            };
            if let Some(report) = &self.activity {
                report(RequestActivity::Generating);
            }
            let response = timeout(
                request_timeout,
                self.client
                    .post(url)
                    .headers(headers.clone())
                    .json(body)
                    .send(),
            )
            .await
            .map_err(|_| RequestError::Timeout)?
            .map_err(|error| RequestError::Other(error.to_string()))?;
            if response.status() != StatusCode::TOO_MANY_REQUESTS {
                return Ok((response, slot));
            }
            let retry_allowed = self.rate_limit.defer(attempt, response.headers());
            // Release the HTTP response before waiting. A 429 is never a stream-format error.
            drop(response);
            drop(slot);
            if attempt == MAX_RETRIES || !retry_allowed {
                return Err(RequestError::RateLimited);
            }
        }
        Err(RequestError::RateLimited)
    }
}

#[cfg(test)]
mod tests;
