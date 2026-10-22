use super::installation::AgentExecutable;
use super::{
    mcp::{self, Bridge, Event, Replies, Tool},
    process,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, Manager, WebviewWindow};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
    sync::{mpsc, watch},
};

#[path = "runtime/connection.rs"]
pub mod connection;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    #[serde(default)]
    provider: super::Provider,
    run_id: String,
    root: PathBuf,
    conversation_id: String,
    prompt: String,
    session_id: String,
    resume: bool,
    tools: Vec<Tool>,
}
struct Control {
    owner: String,
    cancel: watch::Sender<bool>,
    replies: Replies,
    key: String,
}
#[derive(Default)]
struct Registry {
    runs: HashMap<String, Control>,
    cancelled: HashMap<String, Instant>,
}
fn registry() -> &'static Mutex<Registry> {
    static VALUE: OnceLock<Mutex<Registry>> = OnceLock::new();
    VALUE.get_or_init(Default::default)
}
struct RunGuard(String);
impl Drop for RunGuard {
    fn drop(&mut self) {
        if let Ok(mut registry) = registry().lock() {
            if let Some(run) = registry.runs.remove(&self.0) {
                let _ = run.cancel.send(true);
            }
        }
    }
}

#[tauri::command]
pub fn cancel_local_agent<R: tauri::Runtime>(
    window: WebviewWindow<R>,
    run_id: String,
) -> Result<(), String> {
    let mut registry = registry().lock().map_err(|_| "运行状态不可用")?;
    if let Some(run) = registry.runs.get(&run_id) {
        if run.owner != window.label() {
            return Err("运行不属于当前窗口".into());
        }
        let _ = run.cancel.send(true);
    } else {
        registry
            .cancelled
            .retain(|_, time| time.elapsed() < Duration::from_secs(60));
        if registry.cancelled.len() < 256 {
            registry.cancelled.insert(run_id, Instant::now());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn respond_local_agent<R: tauri::Runtime>(
    window: WebviewWindow<R>,
    run_id: String,
    request_id: String,
    output: Value,
) -> Result<(), String> {
    if output.to_string().len() > mcp::MAX_BODY {
        return Err("工具结果过大".into());
    }
    let registry = registry().lock().map_err(|_| "运行状态不可用")?;
    let run = registry.runs.get(&run_id).ok_or("运行已经结束")?;
    if run.owner != window.label() || *run.cancel.borrow() {
        return Err("运行已经结束或不属于当前窗口".into());
    }
    let sender = run
        .replies
        .lock()
        .map_err(|_| "运行状态不可用")?
        .remove(&request_id)
        .ok_or("操作已经结束")?;
    sender.send(output).map_err(|_| "操作已经结束".into())
}

fn validate(request: &Request) -> Result<(), String> {
    if !uuid(&request.run_id)
        || !(if request.provider == super::Provider::Claude {
            uuid(&request.session_id)
        } else {
            super::rpc::valid_session_id(&request.session_id)
        })
        || request.conversation_id.is_empty()
        || request.conversation_id.len() > 128
        || request.prompt.is_empty()
        || request.prompt.len() > mcp::MAX_BODY
        || request.tools.len() > 80
        || request.tools.iter().any(|tool| {
            tool.name.is_empty()
                || tool.name.len() > 100
                || !tool
                    .name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                || tool.description.len() > 16_384
                || !tool.input_schema.is_object()
                || tool.input_schema.to_string().len() > 65_536
        })
        || request
            .tools
            .iter()
            .map(|tool| &tool.name)
            .collect::<std::collections::HashSet<_>>()
            .len()
            != request.tools.len()
    {
        return Err("本地 Agent 请求无效。".into());
    }
    Ok(())
}
fn uuid(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}

#[tauri::command]
pub async fn run_local_agent<R: tauri::Runtime>(
    window: WebviewWindow<R>,
    request: Request,
    on_event: Channel<Event>,
) -> Result<Value, String> {
    validate(&request)?;
    neuink_workspace::Workspace::open(&request.root).map_err(|_| "资料库不可用。")?;
    let root = std::fs::canonicalize(&request.root).map_err(|_| "资料库不可用。")?;
    let key = blake3::hash(format!("{}\0{}", root.display(), request.conversation_id).as_bytes())
        .to_hex()
        .to_string();
    let (cancel_tx, cancel_rx) = watch::channel(false);
    let replies: Replies = Arc::new(Mutex::new(HashMap::new()));
    {
        let mut registry = registry().lock().map_err(|_| "运行状态不可用")?;
        if registry.cancelled.remove(&request.run_id).is_some() {
            return Err("任务已停止。".into());
        }
        if registry.runs.len() >= 8
            || registry.runs.values().any(|run| run.key == key)
            || registry.runs.contains_key(&request.run_id)
        {
            return Err("当前对话仍在执行，或后台任务过多，请稍后重试。".into());
        }
        registry.runs.insert(
            request.run_id.clone(),
            Control {
                owner: window.label().into(),
                cancel: cancel_tx.clone(),
                replies: replies.clone(),
                key: key.clone(),
            },
        );
    }
    let _guard = RunGuard(request.run_id.clone());
    let cwd = crate::storage::cache_dir(window.app_handle())
        .map_err(|_| "无法准备 Agent 工作目录。")?
        .join("local-agent")
        .join(key);
    std::fs::create_dir_all(&cwd).map_err(|_| "无法准备 Agent 工作目录。")?;
    if *cancel_rx.borrow() {
        return Err("任务已停止。".into());
    }
    let mut startup_cancel = cancel_rx.clone();
    let path = tokio::select! {
        _ = startup_cancel.changed() => return Err("任务已停止。".into()),
        path = super::provider_executable(request.provider) => path?,
    };
    execute(
        &request,
        &cwd,
        path,
        cancel_rx,
        replies,
        Arc::new(move |event| {
            on_event
                .send(event)
                .map_err(|_| "对话连接已关闭，任务停止。".into())
        }),
    )
    .await
}

async fn execute(
    request: &Request,
    cwd: &std::path::Path,
    path: AgentExecutable,
    cancel_rx: watch::Receiver<bool>,
    replies: Replies,
    send: Arc<dyn Fn(Event) -> Result<(), String> + Send + Sync>,
) -> Result<Value, String> {
    if *cancel_rx.borrow() {
        return Err("任务已停止。".into());
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "无法启动 NeuInk 工具连接。")?;
    let port = listener
        .local_addr()
        .map_err(|_| "无法启动 NeuInk 工具连接。")?
        .port();
    // Random frontend run UUID plus an unguessable temporary name; neither is logged or persisted.
    let secret = tempfile::NamedTempFile::new().map_err(|_| "无法准备工具连接。")?;
    let token = blake3::hash(format!("{}:{}", request.run_id, secret.path().display()).as_bytes())
        .to_hex()
        .to_string();
    let (events_tx, mut events_rx) = mpsc::channel(32);
    let connected = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let bridge = Bridge {
        connected: connected.clone(),
        token: token.clone(),
        tools: request.tools.clone(),
        events: events_tx,
        replies: replies.clone(),
        cancel: cancel_rx.clone(),
    };
    let server = tokio::spawn(mcp::serve(listener, bridge));
    struct Server(tokio::task::JoinHandle<()>);
    impl Drop for Server {
        fn drop(&mut self) {
            self.0.abort();
        }
    }
    let _server = Server(server);
    let config = json!({"mcpServers":{"neuink":{"type":"http","url":format!("http://127.0.0.1:{port}/mcp"),"headers":{"Authorization":format!("Bearer {token}")}}}});
    if request.provider != super::Provider::Claude {
        return super::rpc::execute(
            request.provider,
            path,
            cwd,
            &request.session_id,
            request.resume,
            &request.prompt,
            &format!("http://127.0.0.1:{port}/mcp"),
            &token,
            cancel_rx,
            events_rx,
            replies,
            connected,
            send,
        )
        .await;
    }
    let mut command = path.command();
    command
        .current_dir(&cwd)
        .args([
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--input-format",
            "stream-json",
            "--permission-mode",
            "manual",
            "--permission-prompt-tool",
            "mcp__neuink__approve_tool",
            "--max-turns",
            "32",
        ])
        .arg("--mcp-config")
        .arg(config.to_string())
        .arg("--settings")
        .arg(json!({"permissions":{"ask":["Bash","Write","Edit"]}}).to_string())
        .arg("--append-system-prompt")
        .arg(include_str!("prompt.md"))
        .arg(if request.resume {
            "--resume"
        } else {
            "--session-id"
        })
        .arg(&request.session_id)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Claude Code 无法启动，请检查安装。")?;
    #[cfg(any(windows, unix))]
    let _tree = process::ProcessTree::attach(child.id().ok_or("Claude Code 启动失败。")?)?;
    if *cancel_rx.borrow() {
        return Err("任务已停止。".into());
    }
    let mut stdin = child.stdin.take().ok_or("无法连接 Claude Code。")?;
    let message = json!({"type":"user","message":{"role":"user","content":request.prompt},"session_id":request.session_id,"parent_tool_use_id":null});
    stdin
        .write_all(format!("{message}\n").as_bytes())
        .await
        .map_err(|_| "无法发送消息给 Claude Code。")?;
    stdin
        .shutdown()
        .await
        .map_err(|_| "无法发送消息给 Claude Code。")?;
    drop(stdin);
    let stdout = child.stdout.take().ok_or("无法连接 Claude Code 输出。")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("无法连接 Claude Code 错误输出。")?;
    let drain = tokio::spawn(async move {
        let mut reader = stderr;
        let mut buffer = [0; 8192];
        while let Ok(n) = reader.read(&mut buffer).await {
            if n == 0 {
                break;
            }
        }
    });
    struct Drain(tokio::task::JoinHandle<()>);
    impl Drop for Drain {
        fn drop(&mut self) {
            self.0.abort();
        }
    }
    let _drain = Drain(drain);
    let mut reader = BufReader::new(stdout);
    // read_line is interrupted whenever MCP dispatch wins select; its buffer
    // must outlive that future, otherwise a partial JSON line would be lost.
    let mut line_buffer = Vec::new();
    let mut cancel = cancel_rx;
    let deadline = tokio::time::sleep(Duration::from_secs(20 * 60));
    tokio::pin!(deadline);
    let mut result = None;
    let mut bytes = 0;
    loop {
        tokio::select! {
            _ = cancel.changed() => { let _ = child.kill().await; return Err("任务已停止。".into()); },
            _ = &mut deadline => { let _ = child.kill().await; return Err("Claude Code 执行超时，请缩小任务范围后重试。".into()); },
            Some(event) = events_rx.recv() => { send(event)?; },
            line = process::read_line(&mut reader, &mut line_buffer) => {
                let Some(line) = line? else { break; };
                bytes += line.len(); if bytes > 32 * 1024 * 1024 { return Err("Claude Code 输出超过本次任务限制。".into()); }
                let value: Value = serde_json::from_slice(&line).map_err(|_| "Claude Code 输出格式不兼容，请更新 Claude Code 后重试。")?;
                if value["type"] == "result" { result = Some(value.clone()); }
                send(Event::Message { value })?;
            }
        }
    }
    let status = tokio::select! {
        _ = cancel.changed() => { let _ = child.kill().await; return Err("任务已停止。".into()); },
        status = tokio::time::timeout(Duration::from_secs(10), child.wait()) => status.map_err(|_| "Claude Code 退出超时。")?.map_err(|_| "无法读取 Claude Code 退出状态。")?,
    };
    let result = result.ok_or("Claude Code 未返回完整结果，请检查本地认证和配置后重试。")?;
    if let Some(error) = process::result_error(&result) {
        return Err(error);
    }
    if !status.success() {
        return Err("Claude Code 异常退出，请检查本地配置后重试。".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests;

#[cfg(test)]
#[path = "runtime/web_tests.rs"]
mod web_tests;

#[cfg(test)]
#[path = "runtime/paper_tests.rs"]
mod paper_tests;
