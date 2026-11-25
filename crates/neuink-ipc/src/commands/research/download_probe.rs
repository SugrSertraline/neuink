//! Explicit probes only: synthetic local HTTP and temporary libraries; no real user data.
//! Keep these probes together to share the private import seam and fixture contract.
use super::*;
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
const MAX: usize = 64 * 1024 * 1024;

fn output(name: &str, value: Value) {
    println!("DOWNLOAD_PROBE {}", json!({"case":name,"actual":value}));
    let Ok(directory) = std::env::var("NEUINK_DOWNLOAD_EVIDENCE") else {
        return;
    };
    let path = PathBuf::from(directory).join(format!("{name}.json"));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .unwrap();
    file.write_all(serde_json::to_string_pretty(&value).unwrap().as_bytes())
        .unwrap();
}

#[test]
#[ignore = "Explicit serialized probe: the existing cache is process-global"]
fn download_probe_authorization_boundaries() {
    use super::super::{arxiv_cache, arxiv_imports as route, arxiv_paper::ArxivPaper};
    let temp = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(temp.path()).unwrap();
    let root = temp.path().canonicalize().unwrap();
    let papers: Vec<ArxivPaper> = (1..=11)
        .map(|n| {
            paper(
                &format!("arxiv:2401.{n:05}v1"),
                format!("https://arxiv.org/pdf/2401.{n:05}v1"),
            )
            .into()
        })
        .collect();
    arxiv_cache::remember(&root, &papers).unwrap();
    let selections: Vec<_> = papers
        .iter()
        .map(|p| route::PaperSelection {
            paper_id: p.id.clone(),
            cache_source: route::PaperCacheSource::ArxivSearch,
        })
        .collect();
    let preview = |items: Vec<route::PaperSelection>| {
        route::preview(route::Preview {
            root: root.clone(),
            selections: items,
        })
    };
    assert!(preview(vec![]).is_err());
    assert_eq!(preview(selections[..1].to_vec()).unwrap().len(), 1);
    assert_eq!(preview(selections[..10].to_vec()).unwrap().len(), 10);
    assert!(preview(selections.clone()).is_err());
    assert!(preview(vec![selections[0].clone(), selections[0].clone()]).is_err());
    assert!(
        preview(vec![route::PaperSelection {
            paper_id: "missing-probe-id".into(),
            cache_source: route::PaperCacheSource::ArxivSearch
        }])
        .is_err()
    );
    let id = format!("probe-{}", neuink_domain::NoteId::new());
    let request = || route::Preview {
        root: root.clone(),
        selections: selections[..1].to_vec(),
    };
    assert!(route::consume(request(), &id).is_err());
    let mut wrong = papers[0].clone();
    wrong.title = "Changed after click".into();
    assert!(
        route::approve(route::Approval {
            root: root.clone(),
            selections: selections[..1].to_vec(),
            expected: vec![wrong],
            approval_id: id.clone()
        })
        .is_err()
    );
    route::approve(route::Approval {
        root: root.clone(),
        selections: selections[..1].to_vec(),
        expected: papers[..1].to_vec(),
        approval_id: id.clone(),
    })
    .unwrap();
    assert!(
        route::consume(
            route::Preview {
                root: root.clone(),
                selections: vec![route::PaperSelection {
                    paper_id: papers[0].id.clone(),
                    cache_source: route::PaperCacheSource::Research
                }]
            },
            &id
        )
        .is_err()
    );
    assert_eq!(route::consume(request(), &id).unwrap(), papers[..1]);
    assert!(route::consume(request(), &id).is_err());
    assert!(
        neuink_workspace::Workspace::open_existing(&root)
            .unwrap()
            .list_entries()
            .unwrap()
            .is_empty()
    );
    output(
        "authorization-boundaries",
        json!({"empty_rejected":true,"one_accepted":true,"ten_accepted":true,"eleven_rejected":true,
        "duplicate_rejected":true,"missing_cache_record_rejected":true,"no_grant_rejected":true,
        "changed_snapshot_rejected":true,"wrong_cache_source_rejected":true,"grant_consumed_once":true,"entries_created":0}),
    );
}
fn local() -> String {
    assert_eq!(
        std::env::var("NEUINK_DOWNLOAD_PROBE_MODE").as_deref(),
        Ok("LOCAL")
    );
    let root = std::env::var("NEUINK_DOWNLOAD_PROBE_URL").unwrap();
    assert_eq!(
        reqwest::Url::parse(&root).unwrap().host_str(),
        Some("127.0.0.1")
    );
    root
}
fn paper(id: &str, url: String) -> Paper {
    Paper {
        id: id.into(),
        title: format!("Download probe {id}"),
        authors: vec![],
        year: "2026".into(),
        abstract_text: String::new(),
        doi: String::new(),
        url: url.clone(),
        pdf_url: Some(url),
        provider: "probe".into(),
        evidence_level: "abstract".into(),
    }
}
async fn fixture(url: String) -> Result<Vec<u8>, String> {
    let response = reqwest::Client::builder()
        .no_proxy()
        .use_rustls_tls()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|_| "fixture client")?
        .get(url)
        .send()
        .await
        .map_err(|_| "fixture HTTP")?;
    network::download_probe_body(response, MAX).await
}
fn memory() -> Value {
    #[cfg(windows)]
    {
        #[repr(C)]
        struct Counters {
            cb: u32,
            faults: u32,
            peak: usize,
            working: usize,
            peak_paged: usize,
            paged: usize,
            peak_nonpaged: usize,
            nonpaged: usize,
            pagefile: usize,
            peak_pagefile: usize,
            private: usize,
        }
        #[link(name = "psapi")]
        unsafe extern "system" {
            fn GetProcessMemoryInfo(
                process: *mut std::ffi::c_void,
                counters: *mut Counters,
                size: u32,
            ) -> i32;
        }
        let mut info: Counters = unsafe { std::mem::zeroed() };
        info.cb = std::mem::size_of::<Counters>() as u32;
        let ok = unsafe {
            GetProcessMemoryInfo(
                -1isize as *mut _,
                &mut info,
                std::mem::size_of::<Counters>() as u32,
            )
        };
        return json!({"available":ok!=0,"working_set":info.working,"peak_working_set":info.peak,"private_bytes":info.private});
    }
    #[cfg(not(windows))]
    json!({"available":false})
}

#[tokio::test]
#[ignore = "Explicit local synthetic transfer benchmark, temporary library only"]
async fn download_probe_local_transfer() {
    let base = local();
    let mib: usize = std::env::var("NEUINK_DOWNLOAD_PROBE_SIZE")
        .unwrap()
        .parse()
        .unwrap();
    assert!([1, 8, 64].contains(&mib));
    let size = mib * 1024 * 1024;
    let temp = tempfile::tempdir().unwrap();
    let workspace = neuink_workspace::Workspace::create(temp.path()).unwrap();
    let p = paper("local", format!("{base}/pdf?size={size}"));
    let network_ms = Arc::new(AtomicU64::new(0));
    let allocated = Arc::new(AtomicU64::new(0));
    let timing = network_ms.clone();
    let capacity = allocated.clone();
    let manager = neuink_job::LocalJobManager::new();
    let mut job = ImportJob::new(manager.clone(), |_| {});
    let before = memory();
    let start = Instant::now();
    let value = run_approved_with(
        temp.path().to_path_buf(),
        vec![p.clone()],
        &mut job,
        move |url| {
            let timing = timing.clone();
            let capacity = capacity.clone();
            async move {
                let start = Instant::now();
                let bytes = fixture(url).await?;
                timing.store(start.elapsed().as_micros() as u64, Ordering::SeqCst);
                capacity.store(bytes.capacity() as u64, Ordering::SeqCst);
                Ok(bytes)
            }
        },
        || {},
    )
    .await
    .unwrap();
    let elapsed_us = start.elapsed().as_micros() as u64;
    let after = memory();
    assert_eq!(value["results"][0]["status"], "imported");
    let entries = workspace.list_entries().unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries[0].pdf.is_some());
    let mut duplicate = ImportJob::new(manager.clone(), |_| {});
    let duplicate_start = Instant::now();
    let again = run_approved_with(
        temp.path().to_path_buf(),
        vec![p],
        &mut duplicate,
        |_| async { panic!("duplicate must not make HTTP") },
        || {},
    )
    .await
    .unwrap();
    assert_eq!(again["results"][0]["status"], "already_in_library");
    let transfer_us = network_ms.load(Ordering::SeqCst);
    output(
        &format!("local-transfer-{mib}mib"),
        json!({"bytes":size,"allocated_vec_capacity":allocated.load(Ordering::SeqCst),
        "total_us":elapsed_us,"local_http_body_us":transfer_us,"persistence_and_job_us":elapsed_us.saturating_sub(transfer_us),
        "local_http_mib_per_second":mib as f64/(transfer_us as f64/1_000_000.0),"duplicate_us":duplicate_start.elapsed().as_micros() as u64,
        "memory_before":before,"memory_after":after,"temporary_entries":entries.len(),"build":"debug","synthetic_pdf_envelope":true,
        "job_reports_completed_papers_not_bytes":manager.list().iter().all(|job|job.progress.total==1)}),
    );
}

#[tokio::test]
#[ignore = "Explicit local PDF byte limits and malformed download boundaries"]
async fn download_probe_local_boundaries() {
    let base = local();
    let declared = fixture(format!("{base}/declared-over")).await.unwrap_err();
    assert!(declared.contains("大小限制"));
    let streamed = fixture(format!("{base}/stream-over?size={}", MAX + 1))
        .await
        .unwrap_err();
    assert!(streamed.contains("大小限制"));
    let temp = tempfile::tempdir().unwrap();
    let workspace = neuink_workspace::Workspace::create(temp.path()).unwrap();
    let p = paper("invalid", format!("{base}/pdf"));
    let mut failures = vec![];
    for (name, bytes) in [
        ("html", b"<html>login</html>".as_slice()),
        ("missing_eof", b"%PDF-1.7\nincomplete".as_slice()),
        ("empty", b"".as_slice()),
    ] {
        failures.push(json!({"case":name,"error":persist(&workspace,&p,bytes).unwrap_err()}));
    }
    assert!(workspace.list_entries().unwrap().is_empty());
    for url in [
        "http://arxiv.org/pdf/1706.03762",
        "https://127.0.0.1/secret",
        "https://user:secret@example.com/file",
        "file:///local.pdf",
    ] {
        assert!(network::public_url(url).is_err());
    }
    output(
        "local-boundaries",
        json!({"maximum_bytes":MAX,"declared_over_error":declared,"streamed_over_error":streamed,
        "invalid_pdf_results":failures,"entries_created_on_invalid_pdf":0,"invalid_urls_rejected":4,
        "valid_maximum_case":"separate local-transfer-64mib","note":"Local fixture bypass exists only at test body seam; production URL checks unchanged"}),
    );
}

#[tokio::test]
#[ignore = "Explicit local batch fairness and bounded-concurrency comparison"]
async fn download_probe_local_queue() {
    let base = local();
    let temp = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(temp.path()).unwrap();
    let ready = Arc::new(tokio::sync::Notify::new());
    let first_ready = ready.clone();
    let root = temp.path().to_path_buf();
    let papers = (0..5)
        .map(|i| {
            paper(
                &format!("batch-{i}"),
                format!("{base}/pdf?size=1048576&delay_ms=100"),
            )
        })
        .collect();
    let start = Instant::now();
    let order = Arc::new(Mutex::new(Vec::<String>::new()));
    let a_order = order.clone();
    let first = tokio::spawn(async move {
        let mut job = ImportJob::new(neuink_job::LocalJobManager::new(), |_| {});
        run_approved_with(
            root,
            papers,
            &mut job,
            move |url| {
                first_ready.notify_one();
                a_order.lock().unwrap().push("long_batch".into());
                fixture(url)
            },
            || {},
        )
        .await
        .unwrap()
    });
    ready.notified().await;
    let submitted = Instant::now();
    let waited = Arc::new(AtomicU64::new(0));
    let wait = waited.clone();
    let b_order = order.clone();
    let mut job = ImportJob::new(neuink_job::LocalJobManager::new(), |_| {});
    let second = run_approved_with(
        temp.path().to_path_buf(),
        vec![paper(
            "short",
            format!("{base}/pdf?size=1048576&delay_ms=100"),
        )],
        &mut job,
        move |url| {
            wait.store(submitted.elapsed().as_micros() as u64, Ordering::SeqCst);
            b_order.lock().unwrap().push("short_batch".into());
            fixture(url)
        },
        || {},
    );
    let (first, second) = tokio::join!(first, second);
    assert_eq!(first.unwrap()["results"].as_array().unwrap().len(), 5);
    assert_eq!(second.unwrap()["results"][0]["status"], "imported");
    let pipeline_us = start.elapsed().as_micros() as u64;
    let permits = Arc::new(tokio::sync::Semaphore::new(3));
    let mut joins = tokio::task::JoinSet::new();
    let comparison = Instant::now();
    for _ in 0..6 {
        let url = format!("{base}/pdf?size=1048576&delay_ms=100");
        let permits = permits.clone();
        joins.spawn(async move {
            let _permit = permits.acquire().await.unwrap();
            fixture(url).await.unwrap().len()
        });
    }
    while let Some(value) = joins.join_next().await {
        assert_eq!(value.unwrap(), 1048576);
    }
    output(
        "local-queue",
        json!({"production_pipeline_6_files_us":pipeline_us,
        "short_batch_wait_before_http_us":waited.load(Ordering::SeqCst),"request_order":*order.lock().unwrap(),
        "same_reqwest_transport_3_parallel_6_files_us":comparison.elapsed().as_micros() as u64,
        "comparison_excludes_persistence_and_approval":true,"fixture_delay_ms":100,"build":"debug"}),
    );
}

#[tokio::test]
#[ignore = "Explicit single public PDF via production downloader, temporary workspace only"]
async fn download_probe_public_pdf() {
    assert_eq!(
        std::env::var("NEUINK_DOWNLOAD_PROBE_MODE").as_deref(),
        Ok("PUBLIC_ONE_PDF")
    );
    let temp = tempfile::tempdir().unwrap();
    let workspace = neuink_workspace::Workspace::create(temp.path()).unwrap();
    let mut p = paper(
        "arxiv:1706.03762v1",
        "https://arxiv.org/pdf/1706.03762v1".into(),
    );
    p.provider = "arxiv".into();
    let time = Arc::new(AtomicU64::new(0));
    let bytes_count = Arc::new(AtomicU64::new(0));
    let count = bytes_count.clone();
    let timing = time.clone();
    let mut job = ImportJob::new(neuink_job::LocalJobManager::new(), |_| {});
    let start = Instant::now();
    let result = run_approved_with(
        temp.path().to_path_buf(),
        vec![p],
        &mut job,
        move |url| {
            let count = count.clone();
            let timing = timing.clone();
            async move {
                let start = Instant::now();
                let bytes = network::get(&url, MAX).await?;
                timing.store(start.elapsed().as_micros() as u64, Ordering::SeqCst);
                count.store(bytes.len() as u64, Ordering::SeqCst);
                Ok(bytes)
            }
        },
        || {},
    )
    .await
    .unwrap();
    output(
        "public-pdf",
        json!({"result":result,"total_us":start.elapsed().as_micros() as u64,
        "production_network_us":time.load(Ordering::SeqCst),"bytes":bytes_count.load(Ordering::SeqCst),
        "temporary_entries":workspace.list_entries().unwrap().len(),"real_user_library_touched":false,
        "no_retry_or_alternative_url":true,"build":"debug"}),
    );
    assert_eq!(result["results"][0]["status"], "imported");
}
