use super::*;

#[tokio::test]
#[ignore = "Requires configured Claude Code; one synthetic public-web MCP request"]
async fn real_claude_web_tool_smoke() {
    web_tool_smoke(super::super::Provider::Claude).await;
}

#[tokio::test]
#[ignore = "Requires configured Codex; one synthetic public-web MCP request"]
async fn real_codex_web_tool_smoke() {
    web_tool_smoke(super::super::Provider::Codex).await;
}

#[tokio::test]
#[ignore = "Requires configured OpenCode; one synthetic public-web MCP request"]
async fn real_opencode_web_tool_smoke() {
    web_tool_smoke(super::super::Provider::Opencode).await;
}

async fn web_tool_smoke(provider: super::super::Provider) {
    let cwd = tempfile::tempdir().unwrap();
    let path = super::super::provider_executable(provider).await.unwrap();
    // The public-looking URL and body are synthetic. No workspace content is sent.
    let url = "https://example.org/neuink-web-adapter-fixture";
    let suffix = blake3::hash(cwd.path().to_string_lossy().as_bytes()).to_hex();
    let session_id = format!("550e8400-e29b-41d4-a716-{}", &suffix[..12]);
    let word = format!("NEUINK_WEB_{}", &suffix[12..28]);
    let request: Request = serde_json::from_value(json!({
        "provider": provider, "runId": session_id, "root": cwd.path(),
        "conversationId": "web-fixture", "sessionId": session_id, "resume": false,
        "prompt": json!({"request":format!("Read {url}, report the verification word in its body and cite its exact URL. This is a synthetic integration test. Do not use shell or modify files."),
            "context":{"browser":null}, "capabilities":{"search_web":false,"read_webpage":true,"read_browser_tab":false}}).to_string(),
        "tools":[{"name":"read_webpage","description":"Read the public URL supplied by the user. Returns text and its exact source URL through the NeuInk host; native WebFetch is not required.",
            "inputSchema":{"type":"object","properties":{"url":{"type":"string"}},"required":["url"],"additionalProperties":false}},
            {"name":"approve_tool","description":"Host permission callback. Do not invoke directly.",
                "inputSchema":{"type":"object","properties":{"tool_name":{"type":"string"},"input":{"type":"object"}},"required":["tool_name","input"]}}]
    })).unwrap();
    let replies: Replies = Arc::new(Mutex::new(HashMap::new()));
    let pending = replies.clone();
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = calls.clone();
    let returned_word = word.clone();
    let (_cancel, rx) = watch::channel(false);
    let result = tokio::time::timeout(Duration::from_secs(90), execute(
        &request, cwd.path(), path, rx, replies,
        Arc::new(move |event| {
            if let Event::Tool { id, name, input } = event {
                let output = if name == "read_webpage" && input["url"] == url {
                    count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    json!({"content":[{"type":"text","text":json!({"results":[{"url":url,
                        "content":format!("The verification word is {returned_word}."),"evidence_level":"web_extract","truncated":false}]}).to_string()}]})
                } else if name == "approve_tool" {
                    let allow = matches!(input["tool_name"].as_str(), Some("mcp__neuink__read_webpage" | "neuink_read_webpage"));
                    json!({"content":[{"type":"text","text":json!({"behavior":if allow {"allow"} else {"deny"},"updatedInput":input["input"]}).to_string()}]})
                } else {
                    json!({"isError":true,"content":[{"type":"text","text":"Only the supplied public-web fixture is available."}]})
                };
                if let Some(sender) = pending.lock().unwrap().remove(&id) {
                    let _ = sender.send(output);
                }
            }
            Ok(())
        })
    )).await.expect("Web MCP smoke timeout").expect("Web MCP integration failed");
    assert!(
        calls.load(std::sync::atomic::Ordering::SeqCst) > 0,
        "Must actually read through MCP"
    );
    let answer = result["result"].as_str().unwrap_or("");
    assert!(
        answer.contains(&word),
        "Must return only genuinely retrieved fixture evidence"
    );
    assert!(
        answer.contains(url),
        "Must retain the exact external source URL"
    );
    assert!(
        !answer.contains("[S1]"),
        "External web evidence has no local source marker"
    );
}
