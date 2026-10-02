use std::future::Future;
use tokio::sync::watch;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TranslationStop {
    Pause,
    Cancel,
}

#[derive(Debug)]
pub(super) struct TranslationTaskControl {
    stop: watch::Sender<Option<TranslationStop>>,
}

impl Default for TranslationTaskControl {
    fn default() -> Self {
        Self {
            stop: watch::channel(None).0,
        }
    }
}

impl TranslationTaskControl {
    pub(super) fn request_stop(&self, reason: TranslationStop) {
        // The first accepted action wins, including before the runner subscribes.
        self.stop.send_if_modified(|current| {
            if current.is_some() {
                return false;
            }
            *current = Some(reason);
            true
        });
    }

    pub(super) fn reason(&self) -> Option<TranslationStop> {
        *self.stop.borrow()
    }

    pub(super) fn pause_requested(&self) -> bool {
        self.reason().is_some()
    }

    pub(super) async fn run_until_stopped<F: Future>(&self, work: F) -> Option<F::Output> {
        let mut stop = self.stop.subscribe();
        tokio::select! {
            biased;
            _ = async {
                loop {
                    if stop.borrow_and_update().is_some() { break; }
                    if stop.changed().await.is_err() { break; }
                }
            } => None,
            result = work => Some(result),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::StreamExt;
    use std::{sync::Arc, time::Duration};
    use tokio::{sync::Semaphore, time::timeout};

    #[tokio::test]
    async fn stop_before_start_is_not_lost_and_first_action_wins() {
        for reason in [TranslationStop::Pause, TranslationStop::Cancel] {
            let control = TranslationTaskControl::default();
            control.request_stop(reason);
            control.request_stop(TranslationStop::Cancel);
            assert_eq!(control.reason(), Some(reason));
            assert_eq!(
                control
                    .run_until_stopped(async { panic!("must not start") })
                    .await,
                None::<()>
            );
        }
    }

    #[tokio::test]
    async fn stopping_drops_all_inflight_batches_and_releases_slots() {
        for reason in [TranslationStop::Pause, TranslationStop::Cancel] {
            let control = Arc::new(TranslationTaskControl::default());
            let slots = Arc::new(Semaphore::new(4));
            let started = Arc::new(Semaphore::new(0));
            let task = {
                let control = control.clone();
                let slots = slots.clone();
                let started = started.clone();
                tokio::spawn(async move {
                    control
                        .run_until_stopped(futures_util::stream::iter(0..8).for_each_concurrent(
                            4,
                            |_| {
                                let slots = slots.clone();
                                let started = started.clone();
                                async move {
                                    let _permit = slots.acquire_owned().await.unwrap();
                                    started.add_permits(1);
                                    std::future::pending::<()>().await;
                                }
                            },
                        ))
                        .await
                })
            };
            timeout(Duration::from_secs(2), started.acquire_many(4))
                .await
                .unwrap()
                .unwrap()
                .forget();
            assert_eq!(slots.available_permits(), 0);
            control.request_stop(reason);
            assert_eq!(
                timeout(Duration::from_secs(2), task)
                    .await
                    .unwrap()
                    .unwrap(),
                None
            );
            assert_eq!(slots.available_permits(), 4);
            assert_eq!(started.available_permits(), 0, "no later batch starts");
        }
    }

    #[tokio::test]
    async fn normal_completion_keeps_its_result() {
        let control = TranslationTaskControl::default();
        assert_eq!(control.run_until_stopped(async { 42 }).await, Some(42));
    }
}
