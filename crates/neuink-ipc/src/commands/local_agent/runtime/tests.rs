use super::*;
#[tokio::test]
#[ignore = "Requires installed Codex; connects actual MCP and cancels before model invocation"]
async fn real_codex_mcp_handshake_and_cancel_smoke() {
    let cwd = tempfile::tempdir().unwrap();
    let path = super::super::provider_executable(super::super::Provider::Codex)
        .await
        .unwrap();
    let request:Request=serde_json::from_value(json!({"provider":"codex","runId":"550e8400-e29b-41d4-a716-446655440090","root":cwd.path(),"conversationId":"handshake",
        "sessionId":"550e8400-e29b-41d4-a716-446655440091","resume":false,"prompt":"Must never reach the model","tools":[]})).unwrap();
    let (cancel, rx) = watch::channel(false);
    let initialized = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let ready = initialized.clone();
    let result = tokio::time::timeout(
        Duration::from_secs(60),
        execute(
            &request,
            cwd.path(),
            path,
            rx,
            Arc::new(Mutex::new(HashMap::new())),
            Arc::new(move |event| {
                if let Event::Message { value } = &event {
                    if value["type"] == "local_agent_init" {
                        ready.store(true, std::sync::atomic::Ordering::SeqCst);
                        cancel.send(true).unwrap();
                    }
                }
                Ok(())
            }),
        ),
    )
    .await
    .unwrap();
    assert_eq!(result.unwrap_err(), "任务已停止。");
    assert!(initialized.load(std::sync::atomic::Ordering::SeqCst));
}
#[tokio::test]
#[ignore = "Requires configured Codex; performs real MCP and resume requests"]
async fn real_codex_mcp_and_resume_smoke() {
    real_rpc_fixture(super::super::Provider::Codex).await;
}
#[tokio::test]
#[ignore = "Requires configured OpenCode; performs real MCP and resume requests"]
async fn real_opencode_mcp_and_resume_smoke() {
    real_rpc_fixture(super::super::Provider::Opencode).await;
}
async fn real_rpc_fixture(provider: super::super::Provider) {
    let cwd = tempfile::tempdir().unwrap();
    let path = super::super::provider_executable(provider).await.unwrap();
    let mut request:Request=serde_json::from_value(json!({"provider":provider,"runId":"550e8400-e29b-41d4-a716-446655440080","root":cwd.path(),"conversationId":"fixture",
        "sessionId":"550e8400-e29b-41d4-a716-446655440081","resume":false,
        "prompt":"Use the neuink read_fixture tool exactly once. Return only the word it returns. Never use shell commands. This is an isolated MCP integration test.",
        "tools":[{"name":"read_fixture","description":"Read the test word. Takes no arguments.","inputSchema":{"type":"object","properties":{}}}]})).unwrap();
    let mut session = String::new();
    for turn in 0..2 {
        if turn == 1 {
            request.resume = true;
            request.session_id = session.clone();
            request.prompt="What word did read_fixture return in the previous turn? Do not use tools. Reply with only that word.".into();
        }
        let replies: Replies = Arc::new(Mutex::new(HashMap::new()));
        let pending = replies.clone();
        let log = Arc::new(Mutex::new(Vec::new()));
        let events = log.clone();
        let (_tx, rx) = watch::channel(false);
        let result = tokio::time::timeout(
            Duration::from_secs(90),
            execute(
                &request,
                cwd.path(),
                path.clone(),
                rx,
                replies,
                Arc::new(move |event| {
                    match &event {
                        Event::Tool { name, .. } => eprintln!("RPC host tool: {name}"),
                        Event::Message { value } => {
                            if value["method"] == "error" {
                                eprintln!(
                                    "RPC upstream error: {}",
                                    super::super::rpc::error(provider, &value["params"])
                                );
                            } else if let Some(kind) =
                                value["method"].as_str().or(value["type"].as_str())
                            {
                                eprintln!("RPC event: {kind}");
                            }
                        }
                    }
                    if let Event::Tool { id, name, .. } = &event {
                        let sender = pending.lock().unwrap().remove(id).unwrap();
                        let output = if name == "read_fixture" {
                            json!({"content":[{"type":"text","text":"NEUINK_MCP_FIXTURE_OK"}]})
                        } else {
                            json!({"content":[{"type":"text","text":"{\"behavior\":\"deny\"}"}]})
                        };
                        sender.send(output).unwrap();
                    }
                    events.lock().unwrap().push(event);
                    Ok(())
                }),
            ),
        )
        .await
        .expect("RPC smoke timeout")
        .expect("RPC integration failed");
        assert!(
            result["result"]
                .as_str()
                .unwrap()
                .contains("NEUINK_MCP_FIXTURE_OK"),
            "Fixture word was not returned"
        );
        if turn == 0 {
            let log = log.lock().unwrap();
            assert!(
                log.iter()
                    .any(|event| matches!(event,Event::Tool{name,..} if name=="read_fixture")),
                "Must call MCP, not guess the word"
            );
            session = log
                .iter()
                .find_map(|event| match event {
                    Event::Message { value } if value["type"] == "local_agent_init" => {
                        value["session_id"].as_str().map(String::from)
                    }
                    _ => None,
                })
                .unwrap();
        }
    }
}
#[test]
fn session_ids_are_not_paths_or_options() {
    assert!(uuid("550e8400-e29b-41d4-a716-446655440000"));
    assert!(!uuid("../../private"));
    assert!(!uuid("--continue"));
}
#[test]
fn rejects_unbounded_or_ambiguous_tool_catalogs() {
    let mut request:Request = serde_json::from_value(json!({"runId":"550e8400-e29b-41d4-a716-446655440000","root":"fixture","conversationId":"c1","sessionId":"550e8400-e29b-41d4-a716-446655440001","resume":false,"prompt":"test","tools":[{"name":"external-search","description":"test","inputSchema":{"type":"object"}}]})).unwrap();
    assert!(validate(&request).is_ok());
    request.tools.push(request.tools[0].clone());
    assert!(validate(&request).is_err());
    request.tools.pop();
    request.tools[0].input_schema = json!([]);
    assert!(validate(&request).is_err());
    request.tools.clear();
    request.prompt = "x".repeat(mcp::MAX_BODY + 1);
    assert!(validate(&request).is_err());
}
#[tokio::test]
async fn pre_cancelled_run_never_spawns_a_process() {
    let request:Request = serde_json::from_value(json!({"runId":"550e8400-e29b-41d4-a716-446655440000","root":"fixture","conversationId":"c1","sessionId":"550e8400-e29b-41d4-a716-446655440001","resume":false,"prompt":"test","tools":[]})).unwrap();
    let (_tx, rx) = watch::channel(true);
    let replies = Arc::new(Mutex::new(HashMap::new()));
    let result = execute(
        &request,
        std::path::Path::new("nonexistent"),
        PathBuf::from("nonexistent.exe"),
        rx,
        replies,
        Arc::new(|_| panic!("No event before startup")),
    )
    .await;
    assert_eq!(result.unwrap_err(), "任务已停止。");
}

/// Explicit opt-in: uses the user's configured CLI against an isolated scratch directory.
#[tokio::test]
#[ignore = "Requires configured Claude Code; performs a real model request"]
async fn real_claude_mcp_and_resume_smoke() {
    let cwd = tempfile::tempdir().unwrap();
    let path = super::super::candidates()
        .into_iter()
        .next()
        .expect("Claude installation required");
    let suffix = blake3::hash(cwd.path().to_string_lossy().as_bytes()).to_hex();
    let session_id = format!("550e8400-e29b-41d4-a716-{}", &suffix[..12]);
    let mut request = Request {provider:super::super::Provider::Claude,run_id:"550e8400-e29b-41d4-a716-446655449975".into(),root:cwd.path().into(),conversation_id:"fixture".into(),session_id,
        resume:false, prompt:"Call the neuink read_fixture MCP tool exactly once. Return only the word returned by that tool. This is an isolated integration test.".into(),
        tools:vec![Tool{name:"read_fixture".into(),description:"Read the integration-test word. Takes no arguments.".into(),input_schema:json!({"type":"object","properties":{}})},
            Tool{name:"approve_tool".into(),description:"Host approval callback".into(),input_schema:json!({"type":"object","properties":{"tool_name":{"type":"string"},"input":{"type":"object"}},"required":["tool_name","input"]})}]};
    let replies: Replies = Arc::new(Mutex::new(HashMap::new()));
    let log = Arc::new(Mutex::new(Vec::new()));
    let mode = Arc::new(std::sync::atomic::AtomicU8::new(0));
    let callback_mode = mode.clone();
    let (cancel_tx, signal) = watch::channel(false);
    let callback_cancel = cancel_tx.clone();
    let copied_log = log.clone();
    let copied_replies = replies.clone();
    let send: Arc<dyn Fn(Event) -> Result<(), String> + Send + Sync> = Arc::new(move |event| {
        if let Event::Tool { name, .. } = &event {
            eprintln!("MCP call: {name}");
        }
        if let Event::Tool { id, name, input } = &event {
            let current = callback_mode.load(std::sync::atomic::Ordering::SeqCst);
            if name == "read_fixture" && current == 2 {
                let _ = callback_cancel.send(true);
                copied_log.lock().unwrap().push(event);
                return Ok(());
            }
            let output = if name == "approve_tool" {
                if current == 1 {
                    json!({"behavior":"deny","message":"Integration test denies this operation. Do not retry."})
                } else {
                    json!({"behavior":"allow","updatedInput":input["input"]})
                }
            } else {
                json!({"word":"NEUINK_FIXTURE_PINEAPPLE"})
            };
            if let Some(tx) = copied_replies.lock().unwrap().remove(id) {
                let _ = tx.send(json!({"content":[{"type":"text","text":output.to_string()}]}));
            }
        }
        copied_log.lock().unwrap().push(event);
        Ok(())
    });
    let result = execute(
        &request,
        cwd.path(),
        path.clone(),
        signal.clone(),
        replies.clone(),
        send.clone(),
    )
    .await
    .unwrap();
    assert!(result["result"]
        .as_str()
        .unwrap()
        .contains("NEUINK_FIXTURE_PINEAPPLE"));
    assert!(log
        .lock()
        .unwrap()
        .iter()
        .any(|e| matches!(e, Event::Tool{name,..} if name == "read_fixture")));
    assert!(log
        .lock()
        .unwrap()
        .iter()
        .any(|e| matches!(e, Event::Message{value} if value["type"] == "stream_event")));
    request.resume = true;
    request.prompt = "Without calling tools, repeat the exact integration-test word from the previous turn. Return only that word.".into();
    let result = execute(
        &request,
        cwd.path(),
        path.clone(),
        signal.clone(),
        replies.clone(),
        send.clone(),
    )
    .await
    .unwrap();
    assert!(result["result"]
        .as_str()
        .unwrap()
        .contains("NEUINK_FIXTURE_PINEAPPLE"));
    mode.store(1, std::sync::atomic::Ordering::SeqCst);
    let file = cwd.path().join("denied-test.txt");
    request.prompt = format!("Integration test: attempt the native Write tool exactly once to create {} containing DENIED. Do not use Bash or any other tool to write it. If denied, report the denial and stop.",file.display());
    let previous = log.lock().unwrap().len();
    execute(
        &request,
        cwd.path(),
        path.clone(),
        signal.clone(),
        replies.clone(),
        send.clone(),
    )
    .await
    .unwrap();
    assert!(!file.exists(), "A denied native write must have no effect");
    assert!(log.lock().unwrap()[previous..].iter().any(|e| matches!(e, Event::Tool{name,input,..} if name == "approve_tool" && input["tool_name"] == "Write")));
    mode.store(2, std::sync::atomic::Ordering::SeqCst);
    request.prompt = "Call the neuink read_fixture tool exactly once to freshly read the test word. Do not answer from memory.".into();
    let started = Instant::now();
    let error = execute(&request, cwd.path(), path, signal, replies.clone(), send)
        .await
        .unwrap_err();
    assert!(error.contains("停止"));
    assert!(started.elapsed() < Duration::from_secs(60));
    tokio::time::timeout(Duration::from_secs(2), async {
        while !replies.lock().unwrap().is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("Cancellation must release pending callbacks");
}
