use super::*;

fn profile() -> LlmProfile {
    serde_json::from_value(json!({"id":"test", "name":"private name", "model":"org/model-secret-key", "api_key":"secret-key",
        "base_url":"https://username:password@service.example/private/path?key=secret-key"})).unwrap()
}

#[test]
fn log_is_useful_metadata_without_credentials_source_or_response() {
    let body = r#"{"error":{"code":"unsupported_parameter","param":"temperature","message":"private paper secret-key C:\\private"}}"#;
    let mut details = response_details(body);
    details.http_status = Some(400);
    let value = record(&profile(), Stage::Request, body, details);
    let serialized = value.to_string();
    for private in [
        "secret-key",
        "username",
        "password",
        "private",
        "message",
        "?key",
    ] {
        assert!(!serialized.contains(private));
    }
    assert_eq!(value["service_host"], "service.example");
    assert_eq!(value["model"], "org/model-[redacted]");
    assert_eq!(value["details"]["rejected_parameter"], "temperature");
    assert_eq!(value["details"]["http_status"], 400);
    let details = response_details(r#"{"error":{"code":"secret-key","param":"private paper"}}"#);
    assert!(details.provider_error.is_none());
    assert!(details.rejected_parameter.is_none());
    let details = response_details("{\n invalid private body");
    assert_eq!(details.json_line, Some(2));
    assert!(safe_identifier("C:/private/file", None).contains("omitted"));
}

#[test]
fn concurrent_errors_remain_valid_json_lines_and_rotation_is_bounded() {
    let dir = tempfile::tempdir().unwrap();
    std::thread::scope(|scope| {
        for i in 0..24 {
            let path = dir.path();
            scope.spawn(move || {
                append(path, &json!({"index":i,"details":"metadata"}), 220).unwrap()
            });
        }
    });
    let files: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(files.len(), BACKUPS + 1);
    for file in files {
        let content = fs::read_to_string(file.path()).unwrap();
        assert!(content.len() <= 220);
        for line in content.lines() {
            serde_json::from_str::<Value>(line).unwrap();
        }
    }
}

#[test]
fn write_failure_is_reported_without_a_private_path() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("not-directory");
    fs::write(&file, "existing data").unwrap();
    assert!(append(&file, &json!({"event":"failure"}), MAX_BYTES).is_err());
    assert_eq!(fs::read_to_string(file).unwrap(), "existing data");
    assert_eq!(code("HTTP_429 private response"), "rate_limited");
    assert_eq!(code("LLM_TRANSLATION_OUTPUT_LIMIT"), "output_limit");
}

#[tokio::test]
#[ignore = "requires NEUINK_TRANSLATION_LOG_TEST_DIR; writes a synthetic localhost failure log"]
async fn local_failure_reaches_log_through_actual_translation_transport() {
    let path = PathBuf::from(
        std::env::var("NEUINK_TRANSLATION_LOG_TEST_DIR")
            .expect("set an isolated test log directory"),
    );
    assert!(!path.exists(), "use a new test directory");
    DIRECTORY.set(path.clone()).unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);
    let profile = serde_json::from_value(json!({"id":"smoke", "name":"test", "model":"logging-smoke-test", "api_key":"synthetic-secret",
        "base_url":format!("http://{address}/private?secret=synthetic-secret")})).unwrap();
    let id = crate::commands::translation::diagnostics::prepare_translation_model_test().unwrap();
    let result = crate::commands::translation::diagnostics::test_translation_model(id, profile)
        .await
        .unwrap();
    assert!(!result.ok);
    let log = fs::read_to_string(path.join(FILE)).unwrap();
    assert!(log.lines().count() >= 2);
    assert!(!log.contains("synthetic-secret"));
    assert!(!log.contains("private"));
    let events: Vec<Value> = log
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    // A workstation proxy may return an HTTP error instead of connection refused.
    assert!(events
        .iter()
        .any(|v| v["error_code"] == "network" || v["error_code"] == "http_error"));
    assert!(events.iter().any(|v| v["stage"] == "connection_test"));
}
