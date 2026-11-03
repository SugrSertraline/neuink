use super::*;

type Tests = HashMap<String, (Instant, Arc<TranslationTaskControl>)>;
fn tests() -> &'static Mutex<Tests> {
    static TESTS: OnceLock<Mutex<Tests>> = OnceLock::new();
    TESTS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Serialize)]
pub struct TranslationTestResult {
    pub ok: bool,
    pub code: String,
}

// Register before starting HTTP so closing the UI during IPC setup cannot
// leave an uncancellable, late-starting request behind.
#[tauri::command]
pub fn prepare_translation_model_test() -> Result<String, String> {
    let mut registry = tests().lock().map_err(|_| "TEST_UNAVAILABLE")?;
    registry.retain(|_, (created, control)| {
        if created.elapsed() < Duration::from_secs(120) {
            return true;
        }
        control.request_stop(TranslationStop::Cancel);
        false
    });
    if registry.len() >= 8 {
        return Err("TEST_BUSY".into());
    }
    let id = EntryId::new().to_string();
    registry.insert(
        id.clone(),
        (Instant::now(), Arc::new(TranslationTaskControl::default())),
    );
    Ok(id)
}

#[tauri::command]
pub fn cancel_translation_model_test(test_id: String) -> Result<(), String> {
    if let Some((_, control)) = tests()
        .lock()
        .map_err(|_| "TEST_UNAVAILABLE")?
        .remove(&test_id)
    {
        control.request_stop(TranslationStop::Cancel);
    }
    Ok(())
}

struct Registration(String);
impl Drop for Registration {
    fn drop(&mut self) {
        let _ = cancel_translation_model_test(self.0.clone());
    }
}

#[tauri::command]
pub async fn test_translation_model(
    test_id: String,
    profile: LlmProfile,
) -> Result<TranslationTestResult, String> {
    let control = tests()
        .lock()
        .map_err(|_| "TEST_UNAVAILABLE")?
        .get(&test_id)
        .map(|(_, control)| control.clone())
        .ok_or("TEST_CANCELLED")?;
    let _registration = Registration(test_id);
    if profile.model.trim().is_empty() || profile.base_url.trim().is_empty() {
        return Ok(TranslationTestResult {
            ok: false,
            code: "TEST_CONFIGURATION".into(),
        });
    }
    let mut client = LlmClient::new(profile);
    client.interactive = true;
    let result = timeout(
        Duration::from_secs(90),
        control.run_until_stopped(check(&client)),
    )
    .await;
    let (ok, code) = match result {
        Ok(Some(Ok(()))) => (true, "OK".into()),
        Ok(Some(Err(error))) => (false, safe_error_code(&error)),
        Ok(None) => (false, "TEST_CANCELLED".into()),
        Err(_) => (false, "TEST_TIMEOUT".into()),
    };
    if !ok && code != "TEST_CANCELLED" {
        crate::translation_log::best_effort(&client.profile, crate::translation_log::Stage::ConnectionTest, &code, Default::default());
    }
    Ok(TranslationTestResult { ok, code })
}

async fn check(client: &LlmClient) -> Result<(), String> {
    let segments = [
        SourceSegment::new(
            SegmentType::Paragraph,
            0,
            None,
            "The model predicts traffic flow using historical observations. The loss is $L = x^2$."
                .into(),
        ),
        SourceSegment::new(
            SegmentType::Heading,
            0,
            None,
            "## Experimental Results".into(),
        ),
    ];
    let context = TranslationPaperContext {
        summary: String::new(),
        terminology: vec![],
        generated_at: Utc::now(),
    };
    // Same transport, protocol, prompt, formula protection and result parser
    // as actual single-segment and full-document translation. No workspace IO.
    let translated = client
        .translate_batch("Translation connection test", &context, &segments)
        .await?;
    if segments.iter().any(|segment| {
        translated.get(&segment.uid).is_none_or(|text| {
            !text
                .chars()
                .any(|ch| ('\u{4e00}'..='\u{9fff}').contains(&ch))
        })
    }) {
        return Err("TEST_INCOMPLETE_TRANSLATION".into());
    }
    if !translated[&segments[0].uid].contains("$L = x^2$") {
        return Err("TEST_INCOMPLETE_TRANSLATION".into());
    }
    Ok(())
}

/// Only fixed codes cross IPC. Raw HTTP errors can contain credentials, URLs,
/// request bodies or provider output, and must not enter a diagnostic report.
fn safe_error_code(error: &str) -> String {
    for code in [
        response::TRUNCATED,
        response::REASONING_ONLY,
        response::REJECTED,
        response::FILTERED,
        "LLM_TRANSLATION_INVALID_FORMAT",
        "TEST_INCOMPLETE_TRANSLATION",
    ] {
        if error.contains(code) {
            return code.into();
        }
    }
    if let Some(status) = error
        .split("LLM request failed (")
        .nth(1)
        .and_then(|s| s.get(..3))
    {
        if status.bytes().all(|b| b.is_ascii_digit()) {
            return format!("HTTP_{status}");
        }
    }
    let lower = error.to_ascii_lowercase();
    if lower.contains("timeout") || lower.contains("timed out") || error.contains("超时") {
        "TEST_TIMEOUT"
    } else if lower.contains("rate limit") || error.contains("限流") {
        "HTTP_429"
    } else if lower.contains("request") || lower.contains("connect") {
        "TEST_NETWORK"
    } else if lower.contains("content") {
        "TEST_EMPTY_RESPONSE"
    } else {
        "TEST_RESPONSE_FORMAT"
    }
    .into()
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn diagnostics_never_return_raw_errors() {
        assert_eq!(
            safe_error_code("LLM request failed (401 Unauthorized): secret-key private body"),
            "HTTP_401"
        );
        assert_eq!(
            safe_error_code("error sending request for url (https://host?key=secret)"),
            "TEST_NETWORK"
        );
        assert_eq!(
            safe_error_code("private unknown response"),
            "TEST_RESPONSE_FORMAT"
        );
        assert_eq!(safe_error_code(response::TRUNCATED), response::TRUNCATED);
    }

    #[tokio::test]
    async fn cancel_before_start_prevents_late_http_and_releases_registration() {
        let id = prepare_translation_model_test().unwrap();
        cancel_translation_model_test(id.clone()).unwrap();
        let profile = serde_json::from_value(
            json!({"id":"test", "name":"test", "model":"test", "base_url":"http://127.0.0.1:1/v1"}),
        )
        .unwrap();
        assert_eq!(
            test_translation_model(id.clone(), profile)
                .await
                .err()
                .unwrap(),
            "TEST_CANCELLED"
        );
        assert!(!tests().lock().unwrap().contains_key(&id));
    }

    #[tokio::test]
    #[ignore = "requires NEUINK_LIVE_SETTINGS; sends synthetic translation diagnostic"]
    async fn live_model_translation_diagnostic() {
        let id = prepare_translation_model_test().unwrap();
        let result =
            test_translation_model(id.clone(), super::super::live_tests::selected_profile())
                .await
                .unwrap();
        assert!(result.ok, "diagnostic code: {}", result.code);
        assert!(!tests().lock().unwrap().contains_key(&id));
    }
}
