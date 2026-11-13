use futures_util::{stream, TryStreamExt};
use std::future::Future;

pub(super) async fn run<T, F, Fut>(
    items: impl IntoIterator<Item = T>,
    transfer: F,
) -> Result<(), String>
where
    F: FnMut(T) -> Fut,
    Fut: Future<Output = Result<(), String>>,
{
    stream::iter(items.into_iter().map(Ok::<_, String>))
        .try_for_each_concurrent(3, transfer)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn transfers_overlap_without_exceeding_three() {
        let running = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);
        let finished = AtomicUsize::new(0);
        run(0..12, |_| async {
            let current = running.fetch_add(1, Ordering::SeqCst) + 1;
            peak.fetch_max(current, Ordering::SeqCst);
            tokio::task::yield_now().await;
            running.fetch_sub(1, Ordering::SeqCst);
            finished.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(peak.load(Ordering::SeqCst), 3);
        assert_eq!(finished.load(Ordering::SeqCst), 12);
    }
}
