use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

fn server(
    reply: impl FnOnce(Value) -> String + Send + 'static,
) -> (LlmClient, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    let handle = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut socket = loop {
            if let Ok((socket, _)) = listener.accept() {
                break socket;
            }
            assert!(Instant::now() < deadline, "request not received");
            thread::sleep(Duration::from_millis(5));
        };
        socket.set_nonblocking(false).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut bytes = Vec::new();
        let request = loop {
            let mut buffer = [0; 4096];
            let n = socket.read(&mut buffer).unwrap();
            assert!(n > 0);
            bytes.extend_from_slice(&buffer[..n]);
            if let Some(end) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                let length: usize = headers
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
        for field in ["thinking", "reasoning_effort", "response_format", "temperature", "top_p", "max_tokens"] {
            assert!(request.get(field).is_none(), "unexpected injected field: {field}");
        }
        assert_eq!(request["stream"], true);
        let response = reply(request);
        write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
    });
    let profile = serde_json::from_value(json!({
        "id":format!("glm-test-{}", address.port()), "name":"test", "model":"glm-4.7",
        "base_url":format!("http://open.bigmodel.cn:{}/api/paas/v4", address.port())
    }))
    .unwrap();
    let mut client = LlmClient::new(profile);
    // Resolve the documented host to our stub: no external service or real key.
    client.client = Client::builder()
        .no_proxy()
        .resolve("open.bigmodel.cn", address)
        .build()
        .unwrap();
    (client, handle)
}

#[tokio::test]
async fn single_and_batch_translation_accept_final_json_without_forced_json_mode() {
    for count in [1, 3] {
        let (client, handle) = server(|request| {
            let prompt: Value =
                serde_json::from_str(request["messages"][1]["content"].as_str().unwrap()).unwrap();
            let segments: Vec<_> = prompt["segments"].as_array().unwrap().iter().map(|segment| json!({
                "segment_uid":segment["segment_uid"], "translated_text":"示例：```text\n{中文内容}\n```"
            })).collect();
            let output = format!(
                "<think>```json\n{{\"segments\":[]}}\n```</think>\n```json\n{}\n```",
                json!({"segments":segments})
            );
            format!(
                "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
                json!({"choices":[{"delta":{"reasoning_content":"private analysis"}}]}),
                json!({"choices":[{"delta":{"content":output},"finish_reason":"stop"}]})
            )
        });
        let segments: Vec<_> = (0..count)
            .map(|i| SourceSegment::new(SegmentType::Paragraph, i, None, "Academic text.".into()))
            .collect();
        let context = TranslationPaperContext {
            summary: String::new(),
            terminology: vec![],
            generated_at: Utc::now(),
        };
        let result = client
            .translate_batch("Test", &context, &segments)
            .await
            .unwrap();
        handle.join().unwrap();
        assert_eq!(result.len(), count as usize);
        for segment in segments {
            assert_eq!(result[&segment.uid], "示例：```text\n{中文内容}\n```");
        }
    }
}

#[tokio::test]
async fn glm_truncated_or_reasoning_only_stream_is_not_saved_or_repeated_as_non_streaming() {
    for (finish, content, expected) in [
        ("length", "{\"translation\":\"partial", response::TRUNCATED),
        ("stop", "", response::REASONING_ONLY),
    ] {
        let (client, handle) = server(move |_| {
            format!(
                "data: {}\n\ndata: [DONE]\n\n",
                json!({"choices":[{"delta":{"reasoning_content":"private analysis", "content":content},"finish_reason":finish}]})
            )
        });
        assert_eq!(
            client.generate_text("Translate", "test").await.unwrap_err(),
            expected
        );
        handle.join().unwrap();
    }
}

#[tokio::test]
async fn malformed_paper_context_falls_back_to_direct_model_translation() {
    let (client, handle) = server(|_| {
        format!(
            "data: {}\n\ndata: [DONE]\n\n",
            json!({"choices":[{"delta":{"content":"This is not the requested JSON."},"finish_reason":"stop"}]})
        )
    });
    let task = TranslationTask {
        control: Arc::new(TranslationTaskControl::default()),
        entry_id: EntryId::new(),
        force: false,
        job_total: 1,
        profile: client.profile.clone(),
        root: PathBuf::new(),
        selected_segment_uids: None,
        strategy: RunTranslationStrategy::Restart,
    };
    let segment = SourceSegment::new(SegmentType::Paragraph, 0, None, "A source paragraph.".into());
    let (context, ready) = TranslationPipeline::new(task)
        .build_context(&client, "Test paper", &[segment])
        .await
        .unwrap();
    handle.join().unwrap();
    assert!(!ready);
    assert!(context.summary.is_empty());
    assert!(context.terminology.is_empty());
}
