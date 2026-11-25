use super::*;
use crate::commands::selection_translation::{
    registry::{self, ServiceClient},
    tests::server,
};
use neuink_config::{AppSettings, SelectionTranslationProvider as Provider};

fn service(endpoint: String) -> TranslationClient {
    let mut settings = registry::preset(Provider::Niutrans);
    settings.endpoint = endpoint;
    TranslationClient::Service(ServiceClient::for_test(settings))
}

#[tokio::test]
async fn ordinary_segment_is_one_request_even_with_multiple_sentences_and_newlines() {
    let (endpoint, received) = server("200 OK", r#"{"tgt_text":"第一句。第二句。"}"#);
    let segment = SourceSegment::new(SegmentType::Paragraph, 0, None, "First sentence.\nSecond sentence.".into());
    let output = service(endpoint).translate_batch("", &empty_paper_context(), &[segment.clone()]).await.unwrap();
    assert_eq!(output[&segment.uid], "第一句。第二句。");
    let request = received.join().unwrap();
    assert!(request.contains("First sentence.\\nSecond sentence."));
}

#[tokio::test]
async fn protected_formula_stays_local_without_placeholder_validation() {
    let (endpoint, received) = sequence_server(vec![serde_json::json!({"tgt_text":"我们使用"}), serde_json::json!({"tgt_text":"。有效。"})]);
    let segment = SourceSegment::new(SegmentType::Paragraph, 0, None, "We use $x=2$. It works.".into());
    let output = service(endpoint).translate_batch("", &empty_paper_context(), &[segment.clone()]).await.unwrap();
    assert_eq!(output[&segment.uid], "我们使用 $x=2$。有效。");
    let requests = received.join().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(!requests.join("").contains("NEUINK"));
    assert!(!requests.join("").contains("$x=2$"));
}

#[tokio::test]
async fn service_batch_persists_each_segment_and_stops_dispatch_on_pause() {
    let (endpoint, received) = server("200 OK", r#"{"tgt_text":"已翻译"}"#);
    let client = service(endpoint);
    let control = TranslationTaskControl::default();
    let segments = vec![
        SourceSegment::new(SegmentType::Paragraph, 0, None, "First paragraph.".into()),
        SourceSegment::new(SegmentType::Paragraph, 1, None, "Must not be sent.".into()),
    ];
    let mut saved = Vec::new();
    client
        .translate_batch_recovering(
            "Private title",
            &empty_paper_context(),
            segments,
            &control,
            |items| {
                saved.extend(items);
                control.request_stop(TranslationStop::Pause);
                Ok(())
            },
        )
        .await
        .unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].translated_text.as_deref(), Some("已翻译"));
    let request = received.join().unwrap();
    assert!(!request.contains("Private title"));
    assert!(!request.contains("messages"));
}

#[tokio::test]
async fn service_failures_are_saved_locally_without_aborting_the_batch() {
    let (endpoint, received) = server(
        "401 Unauthorized",
        r#"{"apikey":"secret","src_text":"private"}"#,
    );
    let client = service(endpoint);
    let mut saved = Vec::new();
    client
        .translate_batch_recovering(
            "",
            &empty_paper_context(),
            vec![SourceSegment::new(
                SegmentType::Paragraph,
                0,
                None,
                "Source".into(),
            )],
            &TranslationTaskControl::default(),
            |items| {
                saved.extend(items);
                Ok(())
            },
        )
        .await
        .unwrap();
    assert!(saved[0].error.as_deref().unwrap().contains("401"));
    assert!(!saved[0].error.as_deref().unwrap().contains("secret"));
    assert!(matches!(saved[0].status, TranslatedSegmentStatus::Failed));
    received.join().unwrap();
}

#[tokio::test]
async fn formulas_and_code_do_not_need_a_service_request() {
    let client = service("http://127.0.0.1:1/translate".into());
    let segments = vec![
        SourceSegment::new(SegmentType::Math, 0, None, "x = y + 1".into()),
        SourceSegment::new(SegmentType::Code, 0, None, "const x = 1".into()),
    ];
    let result = client
        .translate_batch("", &empty_paper_context(), &segments)
        .await
        .unwrap();
    for segment in segments {
        assert_eq!(result[&segment.uid], source_text(&segment));
    }
}

#[test]
fn resume_does_not_replace_a_changed_service_with_the_new_default() {
    let config = registry::preset(Provider::Niutrans);
    let id = registry::identity(&config);
    let mut app = AppSettings::default();
    let mut changed = config;
    changed.endpoint = "https://other.example/translate".into();
    app.translation_services.push(changed);
    let error = TranslationClient::resume(&app, &id, Some("小牛翻译"))
        .err()
        .unwrap();
    assert!(error.contains("配置已更改"));
}

// Local fixture only: never contacts a paid provider or loads real credentials.
fn sequence_server(replies: Vec<serde_json::Value>) -> (String, std::thread::JoinHandle<Vec<String>>) {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = format!("http://{}/translate", listener.local_addr().unwrap());
    let thread = std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        let mut requests = Vec::new();
        for reply in replies {
            let mut stream = loop {
                if let Ok((stream, _)) = listener.accept() { break stream; }
                assert!(std::time::Instant::now() < deadline, "expected translation request");
                std::thread::sleep(Duration::from_millis(10));
            };
            stream.set_nonblocking(false).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut bytes = Vec::new();
            let body = loop {
                let mut buffer = [0; 8192];
                let n = stream.read(&mut buffer).unwrap();
                assert!(n > 0); bytes.extend_from_slice(&buffer[..n]);
                if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let length: usize = headers.lines().find_map(|line| line.strip_prefix("content-length:")).unwrap().trim().parse().unwrap();
                    if bytes.len() >= end + 4 + length { break bytes[end + 4..end + 4 + length].to_vec(); }
                }
            };
            let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
            let text = json["src_text"].as_str().unwrap().to_string();
            let reply = if reply.is_null() { serde_json::json!({"tgt_text": text}) } else { reply };
            requests.push(text);
            let body = reply.to_string();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        }
        requests
    });
    (address, thread)
}

#[tokio::test]
async fn author_superscripts_remain_local_and_exact() {
    let source = "Qianru Zhang <sup>1</sup>, Xinyi Gao <sup>2</sup>, Haixin Wang <sup>3</sup>, Siu-Ming Yiu <sup>1</sup>*, Hongzhi Yin <sup>2†</sup>";
    let (endpoint, received) = sequence_server(vec![serde_json::Value::Null; 5]);
    let segment = SourceSegment::new(SegmentType::Paragraph, 0, None, source.into());
    let output = service(endpoint).translate_batch("", &empty_paper_context(), &[segment.clone()]).await.unwrap();
    assert_eq!(output[&segment.uid], source);
    let requests = received.join().unwrap();
    assert_eq!(requests.len(), 5);
    assert!(requests.iter().all(|request| !request.contains("<sup>") && !request.contains("NEUINK")));
}

#[tokio::test]
async fn a_content_failure_does_not_block_the_next_segment() {
    let (endpoint, received) = sequence_server(vec![serde_json::json!({"error_code":"13003"}), serde_json::json!({"tgt_text":"后续成功"})]);
    let mut saved = Vec::new();
    service(endpoint).translate_batch_recovering("", &empty_paper_context(), vec![
        SourceSegment::new(SegmentType::Paragraph, 0, None, "Rejected fragment".into()),
        SourceSegment::new(SegmentType::Paragraph, 1, None, "Next fragment".into()),
    ], &TranslationTaskControl::default(), |items| { saved.extend(items); Ok(()) }).await.unwrap();
    assert_eq!(saved.len(), 2);
    assert!(matches!(saved[0].status, TranslatedSegmentStatus::Failed));
    assert!(matches!(saved[1].status, TranslatedSegmentStatus::Translated));
    assert_eq!(received.join().unwrap().len(), 2);
}
