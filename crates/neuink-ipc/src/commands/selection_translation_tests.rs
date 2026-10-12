use super::*;
fn server(status: &str, body: &str) -> (String, std::thread::JoinHandle<String>) {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}/translate", listener.local_addr().unwrap());
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    let thread = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut chunk = [0; 4096];
            let size = stream.read(&mut chunk).unwrap();
            if size == 0 {
                break;
            }
            bytes.extend_from_slice(&chunk[..size]);
            if let Some(end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.strip_prefix("content-length:")
                            .and_then(|value| value.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if bytes.len() >= end + 4 + length {
                    break;
                }
            }
        }
        stream.write_all(response.as_bytes()).unwrap();
        String::from_utf8(bytes).unwrap()
    });
    (address, thread)
}
#[tokio::test]
async fn sends_provider_auth_and_never_exposes_error_bodies() {
    for (provider, body, auth) in [
        (
            Provider::Azure,
            r#"[{"translations":[{"text":"论文"}]}]"#,
            "ocp-apim-subscription-key: test-key",
        ),
        (
            Provider::Deepl,
            r#"{"translations":[{"text":"论文"}]}"#,
            "authorization: DeepL-Auth-Key test-key",
        ),
        (
            Provider::QwenMt,
            r#"{"choices":[{"message":{"content":"论文"}}]}"#,
            "authorization: Bearer test-key",
        ),
    ] {
        let (endpoint, thread) = server("200 OK", body);
        let settings = Settings {
            provider,
            endpoint,
            model: "test".into(),
            region: "eastasia".into(),
        };
        assert_eq!(
            translate(&settings, "test-key", "Paper").await.unwrap(),
            "论文"
        );
        let request = thread.join().unwrap();
        assert!(request.to_lowercase().contains(&auth.to_lowercase()));
        if provider == Provider::Azure {
            assert!(request.contains("api-version=3.0&to=zh-Hans"));
            assert!(request
                .to_lowercase()
                .contains("ocp-apim-subscription-region: eastasia"));
        }
    }
    for status in [
        "401 Unauthorized",
        "429 Too Many Requests",
        "456 Quota Exceeded",
    ] {
        let (endpoint, thread) = server(status, r#"{"error":"secret-key and private text"}"#);
        let settings = Settings {
            provider: Provider::Deepl,
            endpoint,
            ..Default::default()
        };
        let error = translate(&settings, "test-key", "Paper").await.unwrap_err();
        assert!(error.contains(&status[..3]));
        assert!(!error.contains("secret-key"));
        thread.join().unwrap();
    }
}
#[test]
fn dedicated_translation_contracts() {
    let settings = Settings {
        provider: Provider::QwenMt,
        model: "qwen-mt-flash".into(),
        ..Default::default()
    };
    let request = payload(&settings, "Paper");
    assert_eq!(request["messages"].as_array().unwrap().len(), 1);
    assert_eq!(request["messages"][0]["content"], "Paper");
    assert_eq!(request["translation_options"]["target_lang"], "Chinese");
    assert_eq!(
        extract(
            Provider::Azure,
            &json!([{"translations":[{"text":"论文"}]}])
        )
        .unwrap(),
        "论文"
    );
    assert_eq!(
        extract(Provider::Deepl, &json!({"translations":[{"text":"论文"}]})).unwrap(),
        "论文"
    );
    assert!(
        extract(Provider::Deepl, &json!({"error":"private payload"}))
            .unwrap_err()
            .find("private")
            .is_none()
    );
    assert!(extract(
        Provider::QwenMt,
        &json!({"choices":[{"message":{"content":" "}}]})
    )
    .is_err());
}
#[test]
fn old_settings_keep_reading_model_and_urls_are_checked() {
    let app: neuink_config::AppSettings = serde_json::from_str("{}").unwrap();
    assert_eq!(app.selection_translation.provider, Provider::ReadingModel);
    for endpoint in [
        "file:///tmp/a",
        "http://example.org",
        "https://user:secret@example.org",
    ] {
        assert!(validate(&Settings {
            provider: Provider::Deepl,
            endpoint: endpoint.into(),
            ..Default::default()
        })
        .is_err());
    }
    assert!(validate(&Settings {
        provider: Provider::QwenMt,
        endpoint: "http://localhost:11434/v1/chat/completions".into(),
        model: "local".into(),
        ..Default::default()
    })
    .is_ok());
}

#[test]
fn removed_custom_provider_migrates_only_when_reading_saved_settings() {
    let legacy = json!({"provider":"openai", "endpoint":"https://old.example/v1/chat/completions", "model":"old-model"});
    let app: neuink_config::AppSettings = serde_json::from_value(json!({
        "theme":"dark", "selection_translation":legacy.clone()
    })).unwrap();
    assert_eq!(app.selection_translation, Settings::default());
    assert_eq!(app.theme.as_deref(), Some("dark"));
    assert!(serde_json::from_value::<Save>(legacy).is_err());
    let adapted: neuink_config::AppSettings = serde_json::from_value(json!({
        "selection_translation":{"provider":"deepl", "endpoint":"https://api-free.deepl.com/v2/translate"}
    })).unwrap();
    assert_eq!(adapted.selection_translation.provider, Provider::Deepl);
    assert_eq!(adapted.selection_translation.endpoint, "https://api-free.deepl.com/v2/translate");
}
