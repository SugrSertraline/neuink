use serde::Serialize;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

#[derive(Default)]
struct Schedule {
    stamp: Option<String>,
    changed_at: u64,
    dirty: bool,
    started: bool,
    last_run: u64,
    next_attempt: u64,
    failures: u32,
    retry_pending: bool,
    blocked: bool,
    generation: u64,
}

#[derive(Default, Serialize)]
pub(super) struct View {
    pub blocked: bool,
    pub retry_at: Option<u64>,
}

fn schedules() -> &'static Mutex<BTreeMap<PathBuf, Schedule>> {
    static SCHEDULES: OnceLock<Mutex<BTreeMap<PathBuf, Schedule>>> = OnceLock::new();
    SCHEDULES.get_or_init(Default::default)
}

pub(super) fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

impl Schedule {
    fn new() -> Self {
        static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        Self {
            generation: GENERATION.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            ..Self::default()
        }
    }

    fn claim(&mut self, stamp: String, now: u64) -> bool {
        if self.stamp.as_ref() != Some(&stamp) {
            self.stamp = Some(stamp);
            self.changed_at = now;
            self.dirty = true;
        }
        if self.blocked || now < self.next_attempt {
            return false;
        }
        let due = !self.started
            || self.retry_pending
            || (self.dirty && now.saturating_sub(self.changed_at) >= 3000)
            || now.saturating_sub(self.last_run) >= 60000;
        if due {
            self.started = true;
            self.dirty = false;
            self.retry_pending = false;
            self.last_run = now;
        }
        due
    }
    fn complete(&mut self, failed: bool, retryable: bool, now: u64, jitter: u64) {
        self.last_run = now;
        self.retry_pending = failed && retryable;
        self.blocked = failed && !retryable;
        if self.retry_pending {
            self.failures = self.failures.saturating_add(1);
            let delay = 3000u64.saturating_mul(1u64 << self.failures.min(7));
            self.next_attempt = now.saturating_add((delay + jitter % 3000).min(300000));
        } else {
            self.failures = 0;
            self.next_attempt = now;
        }
    }
}

pub(super) fn claim(root: &Path, stamp: String) -> Result<bool, String> {
    let mut schedules = schedules().lock().map_err(|_| "自动同步状态不可用")?;
    Ok(schedules
        .entry(root.into())
        .or_insert_with(Schedule::new)
        .claim(stamp, now()))
}

pub(super) fn complete(
    root: &Path,
    generation: u64,
    failed: bool,
    retryable: bool,
) -> Result<(), String> {
    let mut schedules = schedules().lock().map_err(|_| "自动同步状态不可用")?;
    let clock = now();
    let jitter = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos() as u64;
    if let Some(schedule) = schedules
        .get_mut(root)
        .filter(|s| s.generation == generation)
    {
        schedule.complete(failed, retryable, clock, jitter);
    }
    Ok(())
}
pub(super) fn reset(root: &Path) -> Result<(), String> {
    schedules()
        .lock()
        .map_err(|_| "自动同步状态不可用")?
        .insert(root.into(), Schedule::new());
    Ok(())
}
pub(super) fn reset_all() -> Result<(), String> {
    schedules()
        .lock()
        .map_err(|_| "自动同步状态不可用")?
        .clear();
    Ok(())
}
pub(super) fn cancelled(root: &Path, generation: u64) -> Result<(), String> {
    let mut schedules = schedules().lock().map_err(|_| "自动同步状态不可用")?;
    let Some(schedule) = schedules
        .get_mut(root)
        .filter(|s| s.generation == generation)
    else {
        return Ok(());
    };
    schedule.started = true;
    schedule.next_attempt = now().saturating_add(60000);
    schedule.last_run = now();
    schedule.retry_pending = false;
    Ok(())
}
pub(super) fn view(root: &Path) -> Result<View, String> {
    let schedules = schedules().lock().map_err(|_| "自动同步状态不可用")?;
    Ok(schedules
        .get(root)
        .map(|s| View {
            blocked: s.blocked,
            retry_at: if s.retry_pending {
                Some(s.next_attempt)
            } else {
                None
            },
        })
        .unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_changes_remote_poll_and_business_failures_have_distinct_schedules() {
        let mut schedule = Schedule::default();
        assert!(schedule.claim("a".into(), 10000));
        schedule.complete(false, false, 11000, 0);
        assert!(!schedule.claim("b".into(), 12000));
        assert!(!schedule.claim("b".into(), 14999));
        assert!(schedule.claim("b".into(), 15000));
        schedule.complete(false, false, 16000, 0);
        assert!(!schedule.claim("b".into(), 75999));
        assert!(schedule.claim("b".into(), 76000));
        schedule.complete(true, false, 77000, 0);
        assert!(!schedule.claim("c".into(), 200000));
    }
    #[test]
    fn retry_backoff_is_bounded_and_success_resets_it() {
        let mut schedule = Schedule::default();
        for i in 0..30 {
            schedule.complete(true, true, i * 400000, 1234);
            assert!(schedule.next_attempt - i * 400000 <= 300000);
            assert!(!schedule.claim("a".into(), schedule.next_attempt - 1));
            assert!(schedule.claim("a".into(), schedule.next_attempt));
        }
        schedule.complete(false, false, 13000000, 0);
        assert_eq!(schedule.failures, 0);
        assert!(!schedule.retry_pending);
    }
}

pub(super) fn generation(root: &Path) -> Result<u64, String> {
    Ok(schedules()
        .lock()
        .map_err(|_| "自动同步状态不可用")?
        .entry(root.into())
        .or_insert_with(Schedule::new)
        .generation)
}
