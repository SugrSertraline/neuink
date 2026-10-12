use super::*;
use std::sync::atomic::{AtomicBool, Ordering};

/// An explicit model round trip with synthetic content, never a workspace task.
#[tauri::command]
pub async fn test_local_agent_connection<R: tauri::Runtime>(
    window: WebviewWindow<R>,
    provider: super::super::Provider,
    run_id: String,
) -> Result<(), String> {
    if !uuid(&run_id) {
        return Err("本地 Agent 请求无效。".into());
    }
    let (cancel_tx, cancel_rx) = watch::channel(false);
    let replies: Replies = Arc::new(Mutex::new(HashMap::new()));
    let key = format!("connection:{}:{provider:?}", window.label());
    {
        let mut registry = registry().lock().map_err(|_| "运行状态不可用")?;
        if registry.cancelled.remove(&run_id).is_some() {
            return Err("任务已停止。".into());
        }
        if registry.runs.len() >= 8
            || registry.runs.contains_key(&run_id)
            || registry.runs.values().any(|run| run.key == key)
        {
            return Err("连接测试正在进行，请稍后重试。".into());
        }
        registry.runs.insert(
            run_id.clone(),
            Control {
                owner: window.label().into(),
                cancel: cancel_tx,
                replies: replies.clone(),
                key,
            },
        );
    }
    let _guard = RunGuard(run_id.clone());
    probe(provider, run_id, cancel_rx, replies).await
}

async fn probe(
    provider: super::super::Provider,
    run_id: String,
    cancel: watch::Receiver<bool>,
    replies: Replies,
) -> Result<(), String> {
    let work = async {
        let directory = tempfile::tempdir().map_err(|_| "无法准备连接测试。")?;
        let path = super::super::provider_executable(provider).await?;
        let token = blake3::hash(directory.path().to_string_lossy().as_bytes())
            .to_hex()
            .to_string();
        let observed = Arc::new(AtomicBool::new(false));
        let received = observed.clone();
        let expected = token.clone();
        let request = Request {
            provider, run_id: run_id.clone(), root: directory.path().into(),
            conversation_id: format!("connection-{run_id}"), session_id: run_id, resume: false,
            prompt: "This is an isolated connection test with no user documents. Locate and call the neuink connection_probe MCP tool exactly once with {}. If tools are deferred, first use ToolSearch with query select:mcp__neuink__connection_probe to load it. Reply only with the exact token returned by connection_probe. Do not read files, use shell, browse, change anything, or call other content tools.".into(),
            tools: vec![
                Tool { name: "connection_probe".into(), description: "Return the synthetic connection test token.".into(),
                    input_schema: json!({"type":"object","properties":{},"additionalProperties":false}) },
                Tool { name: "approve_tool".into(), description: "Host permission callback only.".into(),
                    input_schema: json!({"type":"object","properties":{"tool_name":{"type":"string"},"input":{"type":"object"}},"required":["tool_name","input"]}) },
            ],
        };
        let result = execute(
            &request,
            directory.path(),
            path,
            cancel.clone(),
            replies.clone(),
            Arc::new(move |event| {
                if let Event::Tool { id, name, input } = event {
                    let output = probe_reply(&name, &input, &expected, &received);
                    if let Some(sender) = replies
                        .lock()
                        .map_err(|_| "连接测试响应失败。")?
                        .remove(&id)
                    {
                        sender.send(output).map_err(|_| "连接测试响应失败。")?;
                    }
                }
                Ok(())
            }),
        )
        .await?;
        if !observed.load(Ordering::SeqCst) {
            return Err("模型已响应，但没有调用 NeuInk 测试工具，请重试。".into());
        }
        if !result
            .get("result")
            .and_then(Value::as_str)
            .is_some_and(|answer| answer.contains(&token))
        {
            return Err("模型已响应，但未完成 NeuInk 工具验证，请重试。".into());
        }
        Ok(())
    };
    let mut stopped = cancel.clone();
    if *cancel.borrow() {
        return Err("任务已停止。".into());
    }
    tokio::select! {
        _ = stopped.changed() => Err("任务已停止。".into()),
        result = tokio::time::timeout(Duration::from_secs(90), work) =>
            result.unwrap_or_else(|_| Err("连接测试超时，请检查本机登录、模型和网络配置后重试。".into())),
    }
}

fn probe_reply(name: &str, input: &Value, token: &str, observed: &AtomicBool) -> Value {
    if name == "connection_probe" && input.as_object().is_some_and(|object| object.is_empty()) {
        observed.store(true, Ordering::SeqCst);
        return json!({"content":[{"type":"text","text":token}]});
    }
    let tool = input.get("tool_name").and_then(Value::as_str).unwrap_or("");
    let lookup =
        tool == "ToolSearch" && input["input"]["query"] == "select:mcp__neuink__connection_probe";
    let decision = if name == "approve_tool"
        && (tool == "mcp__neuink__connection_probe" || tool == "neuink_connection_probe" || lookup)
    {
        json!({"behavior":"allow","updatedInput": if lookup { input["input"].clone() } else {json!({})}})
    } else {
        json!({"behavior":"deny","message":"连接测试不允许其他操作。"})
    };
    json!({"content":[{"type":"text","text":decision.to_string()}]})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn connection_probe_only_serves_synthetic_content() {
        let observed = AtomicBool::new(false);
        let reply = probe_reply(
            "approve_tool",
            &json!({"tool_name":"Bash","input":{"command":"private"}}),
            "token",
            &observed,
        );
        assert!(reply.to_string().contains("deny"));
        assert!(!observed.load(Ordering::SeqCst));
        assert!(!reply.to_string().contains("private"));
        let lookup = probe_reply(
            "approve_tool",
            &json!({"tool_name":"ToolSearch","input":{"query":"select:mcp__neuink__connection_probe"}}),
            "token",
            &observed,
        );
        assert!(lookup.to_string().contains("allow"));
        assert!(!observed.load(Ordering::SeqCst));
        assert!(!probe_reply(
            "connection_probe",
            &json!({"path":"private"}),
            "token",
            &observed
        )
        .to_string()
        .contains("token"));
        assert_eq!(
            probe_reply("connection_probe", &json!({}), "token", &observed)["content"][0]["text"],
            "token"
        );
        assert!(observed.load(Ordering::SeqCst));
    }
    #[tokio::test]
    #[ignore = "Requires a configured local Claude Code model; sends only synthetic data"]
    async fn real_claude_connection_probe() {
        real_probe(crate::commands::local_agent::Provider::Claude).await;
    }
    #[tokio::test]
    #[ignore = "Requires a configured local Codex model; sends only synthetic data"]
    async fn real_codex_connection_probe() {
        real_probe(crate::commands::local_agent::Provider::Codex).await;
    }
    #[tokio::test]
    #[ignore = "Requires a configured local OpenCode model; sends only synthetic data"]
    async fn real_opencode_connection_probe() {
        real_probe(crate::commands::local_agent::Provider::Opencode).await;
    }
    async fn real_probe(provider: crate::commands::local_agent::Provider) {
        let (_cancel, receiver) = watch::channel(false);
        let seed = tempfile::NamedTempFile::new().unwrap();
        let hash = blake3::hash(seed.path().to_string_lossy().as_bytes())
            .to_hex()
            .to_string();
        let run = format!(
            "{}-{}-{}-{}-{}",
            &hash[..8],
            &hash[8..12],
            &hash[12..16],
            &hash[16..20],
            &hash[20..32]
        );
        probe(
            provider,
            run,
            receiver,
            Arc::new(Mutex::new(HashMap::new())),
        )
        .await
        .unwrap();
    }
}
