use super::*;
fn protocol(provider: Provider) -> Protocol<'static> {
    Protocol {
        provider,
        cwd: Path::new("C:/scratch"),
        session: "session_abc".into(),
        resume: false,
        prompt: "test",
        url: "http://127.0.0.1:1/mcp",
        token: "fixture",
        ready: false,
        active: false,
        answer: String::new(),
        message: String::new(),
        file_changes: HashMap::new(),
        upstream_failures: 0,
    }
}
#[test]
fn session_ids_cannot_be_paths_or_options() {
    for id in ["thread_abc-123", "019aaa23-4444-7777-8888-012345678900"] {
        assert!(valid_session_id(id));
    }
    for id in ["", "../private", "C:/data", "--resume", "thread\nsecret"] {
        assert!(!valid_session_id(id));
    }
}
#[test]
fn codex_uses_required_scoped_mcp_and_user_approvals() {
    let mut state = protocol(Provider::Codex);
    let setup = state.setup(&json!({})).unwrap();
    assert_eq!(setup["method"], "thread/start");
    assert_eq!(
        setup["params"]["config"]["mcp_servers"]["neuink"]["required"],
        true
    );
    assert_eq!(setup["params"]["approvalPolicy"], "untrusted");
    assert_eq!(setup["params"]["approvalsReviewer"], "user");
    assert_eq!(setup["params"]["sandbox"], "read-only");
    assert!(setup["params"].get("baseInstructions").is_none());
    state.resume = true;
    assert_eq!(
        state.setup(&json!({})).unwrap()["params"]["threadId"],
        "session_abc"
    );
}
#[test]
fn acp_checks_http_and_resume_capabilities_and_ignores_history() {
    let mut state = protocol(Provider::Opencode);
    assert!(state.setup(&json!({})).is_err());
    let caps = json!({"agentCapabilities":{"mcpCapabilities":{"http":true}}});
    assert_eq!(state.setup(&caps).unwrap()["method"], "session/new");
    state.resume = true;
    assert!(state.setup(&caps).is_err());
    assert!(!state.observe(&json!({"method":"session/update","params":{"sessionId":"session_abc","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"old answer"}}}})).unwrap());
    assert!(state.answer.is_empty());
}
#[test]
fn codex_final_message_and_failure_are_authoritative() {
    let mut state = protocol(Provider::Codex);
    state.active = true;
    state.observe(&json!({"method":"item/agentMessage/delta","params":{"threadId":"session_abc","itemId":"a","delta":"early"}})).unwrap();
    state.observe(&json!({"method":"item/agentMessage/delta","params":{"threadId":"other","itemId":"b","delta":"wrong"}})).unwrap();
    assert_eq!(state.answer, "early");
    state.observe(&json!({"method":"item/completed","params":{"item":{"type":"agentMessage","text":"final"}}})).unwrap();
    assert_eq!(state.answer, "final");
    assert!(state
        .observe(&json!({"method":"turn/completed","params":{"turn":{"status":"completed"}}}))
        .unwrap());
    let failure=state.observe(&json!({"method":"turn/completed","params":{"turn":{"status":"failed","error":{"message":"401 secret-file"}}}})).unwrap_err();
    assert!(failure.contains("认证"));
    assert!(!failure.contains("secret"));
}
#[test]
fn only_single_call_permission_options_are_selected() {
    let request = json!({"method":"session/request_permission","params":{"options":[{"optionId":"always","kind":"allow_always"},{"optionId":"once","kind":"allow_once"}]}});
    let allow = json!({"content":[{"text":"{\"behavior\":\"allow\"}"}]});
    assert_eq!(
        approval_result(Provider::Opencode, &request, &allow)["outcome"]["optionId"],
        "once"
    );
    let request = json!({"method":"session/request_permission","params":{"options":[{"optionId":"always","kind":"allow_always"}]}});
    assert_eq!(
        approval_result(Provider::Opencode, &request, &allow)["outcome"]["outcome"],
        "cancelled"
    );
    assert_eq!(
        approval_result(
            Provider::Codex,
            &json!({"method":"item/fileChange/requestApproval"}),
            &Value::Null
        )["decision"],
        "decline"
    );
}
#[test]
fn unknown_requests_are_never_treated_as_native_approvals() {
    assert!(approval_input(Provider::Codex, &json!({"method":"fs/write_text_file"})).is_none());
    assert_eq!(
        approval_result(
            Provider::Codex,
            &json!({"method":"item/permissions/requestApproval"}),
            &Value::Null
        )["permissions"],
        json!({})
    );
}
#[test]
fn codex_mcp_tool_approval_routes_only_declared_neuink_tools() {
    let request = json!({"method":"mcpServer/elicitation/request","params":{
        "serverName":"neuink","mode":"form","_meta":{
            "codex_approval_kind":"mcp_tool_call","tool_name":"read_entry_assistant_context",
            "tool_params":{"entry_id":"paper-1","limit":8000}
        },"message":"Allow tool?","requestedSchema":{"type":"object","properties":{}}
    }});
    assert_eq!(approval_input(Provider::Codex, &request).unwrap(),
        json!({"tool_name":"mcp__neuink__read_entry_assistant_context",
            "input":{"entry_id":"paper-1","limit":8000}}));
    let allow = json!({"content":[{"text":"{\"behavior\":\"allow\"}"}]});
    assert_eq!(approval_result(Provider::Codex, &request, &allow),
        json!({"action":"accept","content":{}}));
    assert_eq!(approval_result(Provider::Codex, &request, &Value::Null),
        json!({"action":"decline","content":null}));

    let mut without_name = request.clone();
    without_name["params"]["_meta"].as_object_mut().unwrap().remove("tool_name");
    assert_eq!(approval_input(Provider::Codex, &without_name).unwrap()["tool_name"], "mcp__neuink__");

    let mut foreign = request.clone();
    foreign["params"]["serverName"] = json!("other");
    assert_eq!(approval_input(Provider::Codex, &foreign).unwrap()["tool_name"], "McpElicitation");
    let mut form = request.clone();
    form["params"]["_meta"]["codex_approval_kind"] = json!("user_input");
    assert_eq!(approval_input(Provider::Codex, &form).unwrap()["tool_name"], "McpElicitation");
}
#[test]
fn acp_non_success_stop_reasons_fail() {
    let mut state = protocol(Provider::Opencode);
    state.active = true;
    assert!(state
        .observe(&json!({"id":2,"result":{"stopReason":"max_tokens"}}))
        .is_err());
    assert!(state
        .observe(&json!({"id":2,"result":{"stopReason":"end_turn"}}))
        .unwrap());
}
#[test]
fn repeated_connection_errors_do_not_leave_the_chat_waiting_indefinitely() {
    let mut state = protocol(Provider::Codex);
    state.active = true;
    let value = json!({"method":"error","params":{"willRetry":true,"error":{"message":"stream disconnected secret-token"}}});
    for _ in 0..6 {
        assert!(!state.observe(&value).unwrap());
    }
    let error = state.observe(&value).unwrap_err();
    assert!(error.contains("服务连接失败"));
    assert!(!error.contains("secret"));
}
