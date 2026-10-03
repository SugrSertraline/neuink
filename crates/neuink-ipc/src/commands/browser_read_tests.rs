use super::*;

fn url() -> tauri::Url {
    tauri::Url::parse("https://example.org/article?token=private#secret").unwrap()
}

fn raw(text: &str) -> String {
    serde_json::json!({ "status": "ok", "url": url().as_str(), "title": "A paper", "text": text,
        "selection": "selected", "truncated": false })
    .to_string()
}

#[test]
fn snapshot_sanitizes_source_url_and_bounds_untrusted_text() {
    let result = parse_snapshot(&raw(&"文".repeat(TEXT_LIMIT + 20)), &url()).unwrap();
    assert_eq!(result.url, "https://example.org/article");
    assert_eq!(result.text.chars().count(), TEXT_LIMIT);
    assert_eq!(result.selection, "selected");
    assert!(result.truncated);
    assert!(!result.captured_at.is_empty());
    assert!(!result.limitations.is_empty());
}

#[test]
fn snapshot_rejects_navigation_loading_empty_and_malformed_results() {
    let different = tauri::Url::parse("https://example.org/other").unwrap();
    assert_eq!(
        parse_snapshot(&raw("body"), &different).unwrap_err(),
        CHANGED
    );
    assert_eq!(
        parse_snapshot(r#"{"status":"loading"}"#, &url()).unwrap_err(),
        LOADING
    );
    for payload in ["null", "undefined", r#"{"status":"unsupported"}"#] {
        assert!(parse_snapshot(payload, &url()).is_err());
    }
    let empty = serde_json::json!({"status":"ok", "url":url(), "text":" ", "selection":""});
    assert!(parse_snapshot(&empty.to_string(), &url()).is_err());
    assert!(parse_snapshot(&" ".repeat(RAW_LIMIT + 1), &url()).is_err());
}

#[test]
fn local_origin_is_required_even_for_a_webview_named_main() {
    let dev = tauri::Url::parse("http://127.0.0.1:1420").unwrap();
    for target in [
        "https://example.org",
        "https://tauri.localhost.example.org",
        "file:///C:/secret",
        "http://127.0.0.1:1421",
        "https://user:password@tauri.localhost",
    ] {
        assert!(
            !trusted_url(&tauri::Url::parse(target).unwrap(), Some(&dev)),
            "{target}"
        );
    }
    for target in [
        "tauri://localhost/index.html",
        "http://tauri.localhost/",
        "https://tauri.localhost/",
    ] {
        assert!(
            trusted_url(&tauri::Url::parse(target).unwrap(), Some(&dev)),
            "{target}"
        );
    }
}

#[tokio::test]
async fn navigation_and_close_cancel_pending_reads_and_same_url_reload_changes_generation() {
    let state = TabReadState::new();
    state.finish();
    let mut changes = state.status.subscribe();
    let initial = *changes.borrow_and_update();
    let frozen_id = generation_id(initial.generation);
    assert!(check_frozen_target(initial, Some(&frozen_id)).is_ok());
    assert!(check_status(initial, initial.generation).is_ok());
    state.navigate();
    changes.changed().await.unwrap();
    state.finish();
    assert_eq!(
        check_frozen_target(*changes.borrow(), Some(&frozen_id)).unwrap_err(),
        CHANGED
    );
    assert_eq!(
        check_status(*changes.borrow(), initial.generation).unwrap_err(),
        CHANGED
    );
    let refreshed = *changes.borrow_and_update();
    state.close();
    changes.changed().await.unwrap();
    assert_eq!(
        check_status(*changes.borrow(), refreshed.generation).unwrap_err(),
        CHANGED
    );
}

#[tokio::test]
async fn timeout_and_close_discard_the_native_callback_without_retaining_page_content() {
    for close in [false, true] {
        let state = TabReadState::new();
        state.finish();
        let mut changes = state.status.subscribe();
        let (sender, receiver) = oneshot::channel();
        let pending = Arc::new(Mutex::new(Some(sender)));
        if close {
            state.close();
        }
        let result = await_capture(
            receiver,
            &mut changes,
            pending.clone(),
            Duration::from_millis(1),
        )
        .await;
        assert!(result.is_err());
        if close {
            assert_eq!(result.unwrap_err(), CHANGED);
        }
        assert!(pending.lock().unwrap().is_none());
    }
}

#[tokio::test]
async fn dropping_capture_future_clears_callback_after_outer_cancellation() {
    let state = TabReadState::new();
    state.finish();
    let mut changes = state.status.subscribe();
    let (sender, receiver) = oneshot::channel();
    let pending = Arc::new(Mutex::new(Some(sender)));
    {
        let capture = await_capture(
            receiver,
            &mut changes,
            pending.clone(),
            Duration::from_secs(8),
        );
        tokio::pin!(capture);
        tokio::select! {
            _ = &mut capture => panic!("native callback has not delivered"),
            _ = tokio::time::sleep(Duration::from_millis(1)) => (),
        }
        assert!(pending.lock().unwrap().is_some());
    }
    assert!(pending.lock().unwrap().is_none());
}

#[test]
fn concurrent_read_is_bounded_and_retry_releases_slot() {
    let state = TabReadState::new();
    let permit = state.reader.clone().try_acquire_owned().unwrap();
    assert!(state.reader.clone().try_acquire_owned().is_err());
    drop(permit);
    assert!(state.reader.clone().try_acquire_owned().is_ok());
}

#[test]
fn close_removes_target_and_recreation_does_not_reuse_old_state() {
    let state = TabReadState::new();
    remember("snapshot-test", state.clone()).unwrap();
    let first_id = navigation_id("snapshot-test").unwrap();
    state.navigate();
    assert_ne!(navigation_id("snapshot-test").unwrap(), first_id);
    forget("snapshot-test").unwrap();
    assert!(state.status.borrow().closed);
    assert!(!tabs().lock().unwrap().contains_key("snapshot-test"));
    let replacement = TabReadState::new();
    remember("snapshot-test", replacement.clone()).unwrap();
    assert!(!replacement.status.borrow().closed);
    assert_ne!(navigation_id("snapshot-test").unwrap(), first_id);
    forget("snapshot-test").unwrap();
}

#[test]
fn pdf_route_recognizes_documents_without_trusting_arxiv_lookalikes() {
    for value in [
        "https://example.org/document.PDF?token=private",
        "https://arxiv.org/pdf/2309.10108",
        "https://arxiv.org/pdf/2401.00001",
        "https://export.arxiv.org/pdf/2401.00001",
    ] {
        assert!(is_pdf_url(&tauri::Url::parse(value).unwrap()), "{value}");
    }
    for value in [
        "https://arxiv.org.evil.test/pdf/2401.00001",
        "https://example.org/pdf/2401.00001",
        "https://arxiv.org/abs/2401.00001",
        "https://arxiv.org/pdf-not-a-document",
    ] {
        assert!(!is_pdf_url(&tauri::Url::parse(value).unwrap()), "{value}");
    }
}

#[tokio::test(start_paused = true)]
async fn native_capture_preserves_normal_budget_and_allows_two_pdf_attempts() {
    for (known_pdf, expected_seconds) in [(false, 45), (true, 65)] {
        let started = tokio::time::Instant::now();
        let (deadline, receiver) = watch::channel(started + initial_capture_budget(known_pdf));
        await_read_deadline(receiver).await;
        assert_eq!(started.elapsed(), Duration::from_secs(expected_seconds));
        drop(deadline);
    }
}

#[tokio::test(start_paused = true)]
async fn identifying_an_extensionless_pdf_extends_only_to_seventy_five_seconds_total() {
    let started = tokio::time::Instant::now();
    let (deadline, receiver) = watch::channel(started + initial_capture_budget(false));
    let identify_pdf = async {
        tokio::time::sleep(Duration::from_secs(8)).await;
        deadline.send_replace(started + Duration::from_secs(75));
    };
    tokio::join!(await_read_deadline(receiver), identify_pdf);
    assert_eq!(started.elapsed(), Duration::from_secs(75));
}

#[tokio::test(start_paused = true)]
async fn closing_the_deadline_channel_keeps_the_existing_time_bound() {
    let started = tokio::time::Instant::now();
    let (deadline, receiver) = watch::channel(started + initial_capture_budget(false));
    drop(deadline);
    await_read_deadline(receiver).await;
    assert_eq!(started.elapsed(), Duration::from_secs(45));
}

#[test]
fn pdf_snapshot_keeps_bytes_in_transport_field_and_redacts_citation_query() {
    use base64::Engine;
    let target = tauri::Url::parse("https://example.org/paper.pdf?token=private#secret").unwrap();
    let bytes = b"%PDF-1.7\nexample";
    let result = snapshot::pdf(&target, bytes);
    assert_eq!(result.content_type, "pdf");
    assert_eq!(result.extractor, "pdfjs");
    assert_eq!(result.url, "https://example.org/paper.pdf");
    assert!(result.text.is_empty() && result.selection.is_empty());
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(result.pdf_base64.unwrap())
            .unwrap(),
        bytes
    );
    let plain = serde_json::to_value(snapshot::empty(&target)).unwrap();
    assert!(plain.get("pdfBase64").is_none());
}

#[test]
fn pdf_transport_is_not_constrained_by_the_dom_snapshot_size_limit() {
    use base64::Engine;
    let target = tauri::Url::parse("https://arxiv.org/pdf/2309.10108").unwrap();
    assert!(is_pdf_url(&target));
    // Public PDFs use the direct native route, not the small, untrusted DOM result decoder.
    let mut bytes = vec![b' '; RAW_LIMIT + 1];
    bytes[..9].copy_from_slice(b"%PDF-1.7\n");
    let snapshot = snapshot::pdf(&target, &bytes);
    let payload = serde_json::to_value(snapshot).unwrap();
    assert_eq!(payload["contentType"], "pdf");
    assert_eq!(payload["text"], "");
    let encoded = payload["pdfBase64"].as_str().unwrap();
    assert!(encoded.len() > RAW_LIMIT);
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap(),
        bytes
    );
}

#[test]
fn player_page_text_cannot_claim_subtitles_or_visual_understanding() {
    let target =
        tauri::Url::parse("https://www.youtube.com/watch?v=dQw4w9WgXcQ&token=private").unwrap();
    let raw = serde_json::json!({"status":"ok", "url":target.as_str(), "text":"Video description",
        "isVideo":true, "contentType":"video_subtitles", "extractor":"yt-dlp"})
    .to_string();
    let result = parse_snapshot(&raw, &target).unwrap();
    assert_eq!(result.content_type, "video_metadata");
    assert_eq!(result.extractor, "visible-text");
    assert_eq!(result.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert!(result
        .limitations
        .iter()
        .any(|limit| limit.contains("不能声称观看")));
}
