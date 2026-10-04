//! Cancellable reads and short-lived early-cancel records. Active reads are never evicted.
use std::{
    collections::HashMap,
    sync::{atomic::Ordering, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::sync::oneshot;

const MAX_ACTIVE: usize = 8;
const MAX_EARLY_CANCELS: usize = 32;
const CANCEL_TTL: Duration = Duration::from_secs(60);

#[derive(Default)]
struct Registry {
    // A sent cancellation keeps its slot until the original owner's Drop runs. Reusing its
    // ID early cannot let the old owner erase a newer registration.
    active: HashMap<String, Option<oneshot::Sender<()>>>,
    early: HashMap<String, Instant>,
}

fn valid_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 100
        || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("无效读取请求。".into());
    }
    Ok(())
}

impl Registry {
    fn prune(&mut self, now: Instant) {
        self.early
            .retain(|_, at| now.saturating_duration_since(*at) < CANCEL_TTL);
    }

    fn register(&mut self, id: &str, now: Instant) -> Result<oneshot::Receiver<()>, String> {
        valid_id(id)?;
        self.prune(now);
        if self.early.remove(id).is_some() {
            return Err("网页读取已取消。".into());
        }
        if self.active.len() >= MAX_ACTIVE || self.active.contains_key(id) {
            return Err("网页读取任务过多，请稍后重试。".into());
        }
        let (sender, receiver) = oneshot::channel();
        self.active.insert(id.into(), Some(sender));
        Ok(receiver)
    }

    fn cancel(&mut self, id: &str, now: Instant) -> Result<(), String> {
        valid_id(id)?;
        self.prune(now);
        if let Some(pending) = self.active.get_mut(id) {
            if let Some(sender) = pending.take() {
                let _ = sender.send(());
            }
            return Ok(());
        }
        if self.early.contains_key(id) {
            return Ok(());
        }
        // Unknown IDs cannot consume or evict active slots (nor previously recorded cancels).
        if self.early.len() >= MAX_EARLY_CANCELS {
            return Err("提前取消请求过多，请稍后重试。".into());
        }
        self.early.insert(id.into(), now);
        Ok(())
    }
}

static CALLS: OnceLock<Mutex<Registry>> = OnceLock::new();

pub(super) struct Registration(String);
impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut calls) = CALLS.get_or_init(Default::default).lock() {
            calls.active.remove(&self.0);
        }
    }
}

pub(super) fn register(id: Option<&str>) -> Result<(Registration, oneshot::Receiver<()>), String> {
    let id = id.map(str::to_owned).unwrap_or_else(|| {
        format!(
            "legacy-{}",
            super::NEXT_GENERATION.fetch_add(1, Ordering::Relaxed)
        )
    });
    let receiver = CALLS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "读取状态不可用")?
        .register(&id, Instant::now())?;
    Ok((Registration(id), receiver))
}

pub(super) fn cancel(id: &str) -> Result<(), String> {
    CALLS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "读取状态不可用")?
        .cancel(id, Instant::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_before_registration_prevents_work_and_expires() {
        let mut registry = Registry::default();
        let now = Instant::now();
        registry.cancel("early", now).unwrap();
        assert_eq!(
            registry.register("early", now).unwrap_err(),
            "网页读取已取消。"
        );
        assert!(registry.active.is_empty());
        registry.cancel("expired", now).unwrap();
        assert!(registry.register("expired", now + CANCEL_TTL).is_ok());
    }

    #[tokio::test]
    async fn early_cancel_flood_cannot_evict_or_block_an_active_cancellation() {
        let mut registry = Registry::default();
        let now = Instant::now();
        let receiver = registry.register("active", now).unwrap();
        for index in 0..MAX_EARLY_CANCELS {
            registry.cancel(&format!("early-{index}"), now).unwrap();
        }
        assert!(registry.cancel("excess", now).is_err());
        assert_eq!(registry.early.len(), MAX_EARLY_CANCELS);
        assert_eq!(registry.active.len(), 1);
        registry.cancel("active", now).unwrap();
        receiver.await.unwrap();
        assert!(registry.active.contains_key("active"));
        assert!(registry.register("active", now).is_err());
        assert!(registry.register("unrelated", now).is_ok());
        assert_eq!(
            registry.register("early-0", now).unwrap_err(),
            "网页读取已取消。"
        );
    }

    #[test]
    fn invalid_cancel_ids_do_not_allocate_records() {
        let mut registry = Registry::default();
        for id in ["", "../active", "with space", "有中文", &"a".repeat(101)] {
            assert!(registry.cancel(id, Instant::now()).is_err());
            assert!(registry.register(id, Instant::now()).is_err());
        }
        assert!(registry.early.is_empty() && registry.active.is_empty());
    }

    #[test]
    fn registration_drop_releases_active_slot() {
        let (registration, _receiver) = register(Some("registration-drop-test")).unwrap();
        assert!(CALLS
            .get()
            .unwrap()
            .lock()
            .unwrap()
            .active
            .contains_key("registration-drop-test"));
        drop(registration);
        assert!(!CALLS
            .get()
            .unwrap()
            .lock()
            .unwrap()
            .active
            .contains_key("registration-drop-test"));
    }
}
