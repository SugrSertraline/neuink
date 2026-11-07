use super::tests::{fixture, selection};
use super::*;
#[tokio::test]
async fn both_sources_share_download_queue_and_deduplicate_without_http() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    let (_dir, root, p, a) = fixture();
    let old = Selection {
        root: root.clone(),
        paper_ids: vec![p.id.clone()],
    };
    imports::approve(imports::Approval {
        root: root.clone(),
        paper_ids: old.paper_ids.clone(),
        expected: vec![p],
        approval_id: "old-download".into(),
    })
    .unwrap();
    let selections = vec![selection(&a.id, PaperCacheSource::ArxivSearch)];
    approve(Approval {
        root: root.clone(),
        selections: selections.clone(),
        expected: vec![a],
        approval_id: "new-download".into(),
    })
    .unwrap();
    let new = consume(
        Preview {
            root: root.clone(),
            selections,
        },
        "new-download",
    )
    .unwrap()
    .into_iter()
    .map(Into::into)
    .collect();
    let old = imports::consume_for_test(&old, "old-download").unwrap();
    let count = Arc::new(AtomicUsize::new(0));
    let gate = Arc::new(tokio::sync::Notify::new());
    let started = Arc::new(tokio::sync::Notify::new());
    let first_root = root.clone();
    let first_count = count.clone();
    let first_gate = gate.clone();
    let first_started = started.clone();
    let first = tokio::spawn(async move {
        let mut job = ImportJob::new(neuink_job::LocalJobManager::new(), |_| {});
        imports::run_approved_with(
            first_root,
            new,
            &mut job,
            move |_| {
                let gate = first_gate.clone();
                let started = first_started.clone();
                first_count.fetch_add(1, Ordering::SeqCst);
                async move {
                    started.notify_one();
                    gate.notified().await;
                    Ok(b"%PDF-1.4\n%%EOF".to_vec())
                }
            },
            || {},
        )
        .await
        .unwrap()
    });
    started.notified().await;
    let second_count = count.clone();
    let second_root = root.clone();
    let second = tokio::spawn(async move {
        let mut job = ImportJob::new(neuink_job::LocalJobManager::new(), |_| {});
        imports::run_approved_with(
            second_root,
            old,
            &mut job,
            move |_| {
                second_count.fetch_add(1, Ordering::SeqCst);
                async { Ok(b"%PDF-1.4\n%%EOF".to_vec()) }
            },
            || {},
        )
        .await
        .unwrap()
    });
    tokio::task::yield_now().await;
    assert_eq!(count.load(Ordering::SeqCst), 1);
    gate.notify_one();
    assert_eq!(first.await.unwrap()["results"][0]["status"], "imported");
    assert_eq!(
        second.await.unwrap()["results"][0]["status"],
        "already_in_library"
    );
    assert_eq!(count.load(Ordering::SeqCst), 1);
    assert_eq!(
        neuink_workspace::Workspace::open_existing(&root)
            .unwrap()
            .list_entries()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn stopping_one_download_releases_shared_queue_without_canceling_another_job() {
    let (_dir, root, p, mut a) = fixture();
    a.id = "arxiv:2401.00003v1".into();
    arxiv_cache::remember(&root, &[a.clone()]).unwrap();
    let first_manager = neuink_job::LocalJobManager::new();
    let second_manager = neuink_job::LocalJobManager::new();
    let first_state = first_manager.clone();
    let second_state = second_manager.clone();
    let start = std::sync::Arc::new(tokio::sync::Notify::new());
    let started = start.clone();
    let first_root = root.clone();
    let first = tokio::spawn(async move {
        let mut job = ImportJob::new(first_manager, |_| {});
        imports::run_approved_with(
            first_root,
            vec![p],
            &mut job,
            move |_| {
                started.notify_one();
                std::future::pending::<Result<Vec<u8>, String>>()
            },
            || {},
        )
        .await
    });
    start.notified().await;
    let second_root = root.clone();
    let second = tokio::spawn(async move {
        let mut job = ImportJob::new(second_manager, |_| {});
        imports::run_approved_with(
            second_root,
            vec![a.into()],
            &mut job,
            |_| async { Ok(b"%PDF-1.4\n%%EOF".to_vec()) },
            || {},
        )
        .await
        .unwrap()
    });
    tokio::task::yield_now().await;
    first.abort();
    assert!(first.await.unwrap_err().is_cancelled());
    let result = tokio::time::timeout(Duration::from_secs(5), second)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(result["results"][0]["status"], "imported");
    assert_eq!(
        first_state.list()[0].status,
        neuink_job::JobStatus::Canceled
    );
    assert_eq!(
        second_state.list()[0].status,
        neuink_job::JobStatus::Succeeded
    );
    assert_ne!(first_state.list()[0].id, second_state.list()[0].id);
    assert_eq!(
        neuink_workspace::Workspace::open_existing(root)
            .unwrap()
            .list_entries()
            .unwrap()
            .len(),
        1
    );
}
