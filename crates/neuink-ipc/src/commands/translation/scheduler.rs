use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, OnceLock,
};
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};

pub(super) struct RequestScheduler {
    slots: Arc<Semaphore>,
    interactive_waiters: AtomicUsize,
    changed: Notify,
}

impl RequestScheduler {
    pub(super) fn new(capacity: usize) -> Self {
        Self {
            slots: Arc::new(Semaphore::new(capacity)),
            interactive_waiters: AtomicUsize::new(0),
            changed: Notify::new(),
        }
    }

    pub(super) async fn acquire(&self, interactive: bool) -> Result<OwnedSemaphorePermit, String> {
        if interactive {
            self.interactive_waiters.fetch_add(1, Ordering::SeqCst);
            let _waiting = InteractiveWaiter(self);
            // The scheduler owns the semaphore for its lifetime and never closes it.
            return self
                .slots
                .clone()
                .acquire_owned()
                .await
                .map_err(|error| error.to_string());
        }
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if self.interactive_waiters.load(Ordering::SeqCst) > 0 {
                changed.await;
                continue;
            }
            let permit = self
                .slots
                .clone()
                .acquire_owned()
                .await
                .map_err(|error| error.to_string())?;
            if self.interactive_waiters.load(Ordering::SeqCst) == 0 {
                return Ok(permit);
            }
            // A manual request arriving while this batch queued gets the next free slot.
            drop(permit);
        }
    }
}

struct InteractiveWaiter<'a>(&'a RequestScheduler);
impl Drop for InteractiveWaiter<'_> {
    fn drop(&mut self) {
        self.0.interactive_waiters.fetch_sub(1, Ordering::SeqCst);
        self.0.changed.notify_waiters();
    }
}

pub(super) fn request_scheduler() -> Arc<RequestScheduler> {
    static SCHEDULER: OnceLock<Arc<RequestScheduler>> = OnceLock::new();
    SCHEDULER
        .get_or_init(|| Arc::new(RequestScheduler::new(4)))
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn manual_requests_pass_waiting_batches_without_interrupting_active_requests() {
        let scheduler = Arc::new(RequestScheduler::new(1));
        let active = scheduler.acquire(false).await.unwrap();
        let background = {
            let scheduler = scheduler.clone();
            tokio::spawn(async move { scheduler.acquire(false).await })
        };
        tokio::task::yield_now().await;
        let manual = {
            let scheduler = scheduler.clone();
            tokio::spawn(async move { scheduler.acquire(true).await })
        };
        tokio::task::yield_now().await;
        assert!(!manual.is_finished());
        drop(active);
        let manual_permit = tokio::time::timeout(std::time::Duration::from_secs(1), manual)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(!background.is_finished());
        drop(manual_permit);
        assert!(
            tokio::time::timeout(std::time::Duration::from_secs(1), background)
                .await
                .is_ok()
        );
    }
    #[tokio::test]
    async fn canceling_manual_waiter_does_not_block_batches_or_leak_slots() {
        let scheduler = Arc::new(RequestScheduler::new(1));
        let active = scheduler.acquire(false).await.unwrap();
        let waiting = {
            let scheduler = scheduler.clone();
            tokio::spawn(async move { scheduler.acquire(true).await })
        };
        tokio::task::yield_now().await;
        waiting.abort();
        let _ = waiting.await;
        drop(active);
        let permit =
            tokio::time::timeout(std::time::Duration::from_secs(1), scheduler.acquire(false))
                .await
                .unwrap();
        assert_eq!(scheduler.slots.available_permits(), 0);
        drop(permit);
        assert_eq!(scheduler.slots.available_permits(), 1);
    }
}
