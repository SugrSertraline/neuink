use super::*;

#[test]
fn allowed_popup_only_emits_a_new_tab_request_without_changing_source_state() {
    let requests = PopupRequests::default();
    let mut emitted = None;
    let mut error = None;
    forward_new_window(
        &requests,
        "source-browser",
        "HTTPS://Example.ORG:443/paper/../abs?id=7#section",
        |event| {
            emitted = Some(serde_json::to_value(event).unwrap());
            Ok(())
        },
        |message| error = Some(message),
    );
    assert!(error.is_none());
    let payload = emitted.unwrap();
    assert_eq!(payload["id"], "source-browser");
    assert_eq!(payload["url"], "https://example.org/abs?id=7#section");
    assert!(payload["request_id"]
        .as_str()
        .unwrap()
        .starts_with("popup-"));
    assert_eq!(payload.as_object().unwrap().len(), 3);
    // No browser-state URL/loading mutation is emitted on success; the source page stays put.
}

#[test]
fn rejects_non_web_credentials_and_local_app_urls_without_changing_source_state() {
    let requests = PopupRequests::default();
    for url in [
        "file:///C:/secret",
        "javascript:alert(1)",
        "data:text/html,x",
        "about:blank",
        "tauri://localhost",
        "http://tauri.localhost/",
        "https://localhost./",
        "http://127.1:1420",
        "http://[::1]/",
        "http://0.0.0.0/",
        "https://user:secret@example.org/",
        "https://user@example.org/",
        "not a URL",
    ] {
        let mut emitted = None;
        let mut state_error = None;
        forward_new_window(
            &requests,
            "source-browser",
            url,
            |event| {
                emitted = Some(serde_json::to_value(event).unwrap());
                Ok(())
            },
            |message| state_error = Some(message),
        );
        assert!(state_error.is_none(), "{url}");
        let payload = emitted.unwrap();
        assert_eq!(payload["id"], "source-browser");
        assert!(payload.get("url").is_none(), "{url}");
        assert!(payload["error"].as_str().is_some(), "{url}");
        assert!(payload["request_id"].as_str().is_some(), "{url}");
        assert_eq!(payload.as_object().unwrap().len(), 3);
    }
    assert!(requests
        .prepare_at("source-browser", "http://example.org/", Instant::now())
        .is_ok());
}

#[test]
fn throttled_request_reports_open_tab_error_without_invalidating_source_navigation() {
    let requests = PopupRequests::default();
    let now = Instant::now();
    for _ in 0..BURST_LIMIT {
        requests
            .prepare_at("source-browser", "https://example.org/", now)
            .unwrap();
    }
    let mut emitted = None;
    let mut state_error = None;
    forward_new_window(
        &requests,
        "source-browser",
        "https://example.org/",
        |event| {
            emitted = Some(event.clone());
            Ok(())
        },
        |message| state_error = Some(message),
    );
    assert!(state_error.is_none());
    let event = emitted.unwrap();
    assert!(event.url.is_none());
    assert!(event.error.unwrap().contains("过于频繁"));
}

#[test]
fn burst_limit_is_bounded_recovers_and_keeps_ordinary_clicks_distinct() {
    let requests = PopupRequests::default();
    let now = Instant::now();
    let mut ids = std::collections::HashSet::new();
    for _ in 0..BURST_LIMIT {
        ids.insert(
            requests
                .prepare_at("source-browser", "https://example.org/", now)
                .unwrap()
                .request_id,
        );
    }
    assert_eq!(ids.len(), BURST_LIMIT);
    assert!(requests
        .prepare_at("source-browser", "https://example.org/", now)
        .unwrap_err()
        .contains("过于频繁"));
    assert!(requests
        .prepare_at("source-browser", "https://example.org/", now + BURST_WINDOW)
        .is_ok());
    assert!(PopupRequests::default()
        .prepare_at("other-browser", "https://example.org/", now)
        .is_ok());
}

#[test]
fn forwarding_failure_is_reported() {
    let mut error = None;
    forward_new_window(
        &PopupRequests::default(),
        "source-browser",
        "https://example.org/",
        |_| Err("无法打开新网页标签，请重试。".into()),
        |message| error = Some(message),
    );
    assert_eq!(error.as_deref(), Some("无法打开新网页标签，请重试。"));
}
