use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
};

#[tokio::test]
#[ignore = "requires explicitly configured NEUINK_LIVE_SETTINGS and sends one model request"]
async fn live_mermaid_translation_preserves_graph_structure() {
    let path = std::env::var("NEUINK_LIVE_SETTINGS").expect("set NEUINK_LIVE_SETTINGS");
    let settings: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let selected = settings["translation_llm_profile_id"]
        .as_str()
        .or_else(|| settings["active_llm_profile_id"].as_str())
        .unwrap();
    let value = settings["llm_profiles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|profile| profile["id"].as_str() == Some(selected))
        .unwrap();
    let profile: LlmProfile = serde_json::from_value(value.clone()).unwrap();
    let segment = SourceSegment::new(
        SegmentType::Figure,
        0,
        None,
        "```mermaid\ngraph TD\nA[Input data] -->|Process| B[Output result]\n```".into(),
    );
    let context = TranslationPaperContext {
        summary: String::new(),
        terminology: vec![],
        generated_at: Utc::now(),
    };
    let result = LlmClient::new(profile)
        .translate_batch(
            "Translation verification",
            &context,
            std::slice::from_ref(&segment),
        )
        .await
        .expect("live translation request failed");
    let translated = &result[&segment.uid];
    assert!(translated.starts_with("```mermaid\ngraph TD\nA["));
    assert!(translated.contains("] -->|") && translated.contains("| B["));
    assert!(translated
        .chars()
        .any(|character| ('\u{4e00}'..='\u{9fff}').contains(&character)));
    assert!(!translated.contains("NEUINK_DIAGRAM"));
}

#[tokio::test]
async fn batch_requests_use_type_rules_and_restore_mermaid_after_json_transport() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0; 4096];
        let body = loop {
            let count = socket.read(&mut buffer).unwrap();
            assert!(count > 0);
            bytes.extend_from_slice(&buffer[..count]);
            if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                let header = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                let length: usize = header
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length:"))
                    .unwrap()
                    .trim()
                    .parse()
                    .unwrap();
                if bytes.len() >= end + 4 + length {
                    break serde_json::from_slice::<Value>(&bytes[end + 4..end + 4 + length])
                        .unwrap();
                }
            }
        };
        let prompt: Value =
            serde_json::from_str(body["messages"][1]["content"].as_str().unwrap()).unwrap();
        let results: Vec<_> = prompt["segments"].as_array().unwrap().iter().map(|segment| {
            json!({
                "segment_uid": segment["segment_uid"],
                "translated_text": segment["source_text"],
                "diagram_labels": segment["diagram_labels"].as_array().unwrap().iter()
                    .map(|label| json!({"label_id": label["label_id"], "translated_text": "中文文字"})).collect::<Vec<_>>()
            })
        }).collect();
        let output = json!({"segments": results}).to_string();
        let response = json!({"choices":[{"message":{"content":output}}]}).to_string();
        write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
        prompt
    });
    let profile: LlmProfile = serde_json::from_value(json!({
        "id":"batch-test", "name":"test", "base_url":format!("http://{address}/v1"), "model":"test"
    }))
    .unwrap();
    let kinds = [
        SegmentType::Paragraph,
        SegmentType::Heading,
        SegmentType::Table,
        SegmentType::Figure,
        SegmentType::Math,
        SegmentType::Code,
        SegmentType::List,
        SegmentType::PageHeader,
        SegmentType::PageFooter,
        SegmentType::PageNumber,
        SegmentType::AsideText,
        SegmentType::PageFootnote,
    ];
    let batch: Vec<_> = kinds
        .into_iter()
        .map(|kind| {
            SourceSegment::new(
                kind,
                0,
                None,
                match kind {
                    SegmentType::Figure => "```mermaid\ngraph TD\nA[Input] --> B[Output]\n```",
                    SegmentType::Math => "$$\\frac{x}{y}$$",
                    SegmentType::Table => "<table><tr><td>Result</td><td>3.5</td></tr></table>",
                    _ => "Academic content [1].",
                }
                .into(),
            )
        })
        .collect();
    let context = TranslationPaperContext {
        summary: "test".into(),
        terminology: vec![],
        generated_at: Utc::now(),
    };
    let result = LlmClient::new(profile)
        .translate_batch("test", &context, &batch)
        .await
        .unwrap();
    let prompt = server.join().unwrap();
    assert_eq!(result.len(), kinds.len());
    for (index, input) in prompt["segments"].as_array().unwrap().iter().enumerate() {
        assert_eq!(input["translation_rules"], prompts::rules(kinds[index]));
    }
    assert!(result[&batch[3].uid].contains("A[中文文字] --> B[中文文字]"));
    assert_eq!(prompt["segments"][3]["content_format"], "mermaid");
    assert_eq!(prompt["segments"][0]["content_format"], "text");
    assert_eq!(result[&batch[4].uid], "$$\\frac{x}{y}$$");
    assert_eq!(result[&batch[2].uid], source_text(&batch[2]));
}
