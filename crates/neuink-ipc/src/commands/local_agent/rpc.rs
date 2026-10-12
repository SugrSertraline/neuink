//! Official Codex App Server and OpenCode ACP transports. No shell wrappers or global config writes.
mod permissions;
mod protocol;
use permissions::{approval_input, approval_result};
use protocol::Protocol;

use super::{
    mcp::{Event, Replies},
    process, Provider,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::{mpsc, oneshot, watch},
    task::JoinSet,
};

pub(super) fn valid_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && !id.starts_with('-')
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn request(provider: Provider, id: i64, method: &str, params: Value) -> Value {
    let mut value = json!({"id":id,"method":method,"params":params});
    if provider == Provider::Opencode {
        value["jsonrpc"] = json!("2.0");
    }
    value
}
fn response(provider: Provider, id: Value, result: Value) -> Value {
    let mut value = json!({"id":id,"result":result});
    if provider == Provider::Opencode {
        value["jsonrpc"] = json!("2.0");
    }
    value
}
pub(super) fn error(provider: Provider, value: &Value) -> String {
    // Categorize only. Never expose raw upstream paths, tokens or response bodies.
    let text = value.to_string().to_lowercase();
    let name = provider.name();
    if [
        "401",
        "unauthorized",
        "authentication",
        "not logged",
        "login",
        "auth_required",
    ]
    .iter()
    .any(|word| text.contains(word))
    {
        format!("{name} 认证失败，请先在 {name} 中完成认证后重试。")
    } else if ["429", "rate limit", "quota", "usage limit"]
        .iter()
        .any(|word| text.contains(word))
    {
        format!("{name} 请求额度不足或被限流，请稍后重试。")
    } else if [
        "unsupported model",
        "model not found",
        "model does not exist",
    ]
    .iter()
    .any(|word| text.contains(word))
    {
        format!("{name} 当前模型不可用，请检查本机模型配置后重试。")
    } else if [
        "connection",
        "connect",
        "network",
        "timed out",
        "timeout",
        "stream disconnected",
    ]
    .iter()
    .any(|word| text.contains(word))
    {
        format!("{name} 服务连接失败，请检查网络和本机服务配置后重试。")
    } else if text.contains("neuink") && (text.contains("mcp") || text.contains("initialize")) {
        "NeuInk 工具连接失败，请重试。".into()
    } else {
        format!("{name} 未完成本次任务，请检查本地配置后重试。")
    }
}

async fn write(stdin: &mut tokio::process::ChildStdin, value: &Value) -> Result<(), String> {
    stdin
        .write_all(format!("{value}\n").as_bytes())
        .await
        .map_err(|_| "本地 Agent 连接已关闭，请重试。".into())
}
#[allow(clippy::too_many_arguments)]
pub(super) async fn execute(
    provider: Provider,
    path: PathBuf,
    cwd: &Path,
    session: &str,
    resume: bool,
    prompt: &str,
    url: &str,
    token: &str,
    mut cancel: watch::Receiver<bool>,
    mut events: mpsc::Receiver<Event>,
    replies: Replies,
    connected: Arc<std::sync::atomic::AtomicBool>,
    send: Arc<dyn Fn(Event) -> Result<(), String> + Send + Sync>,
) -> Result<Value, String> {
    if *cancel.borrow() {
        return Err("任务已停止。".into());
    }
    let mut command = Command::new(path);
    command
        .arg(if provider == Provider::Codex {
            "app-server"
        } else {
            "acp"
        })
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if provider == Provider::Opencode {
        // Require single-operation native approval, while retaining every native tool.
        let mut config: Value = match std::env::var("OPENCODE_CONFIG_CONTENT") {
            Ok(text) => {
                serde_json::from_str(&text).map_err(|_| "OpenCode 本机配置无效，请检查后重试。")?
            }
            Err(_) => json!({}),
        };
        if !config.is_object() {
            return Err("OpenCode 本机配置无效，请检查后重试。".into());
        }
        config["permission"] = json!({"*":"ask","neuink_*":"allow"});
        command.env("OPENCODE_CONFIG_CONTENT", config.to_string());
    }
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|_| format!("{} 无法启动，请检查安装。", provider.name()))?;
    #[cfg(any(windows, unix))]
    let _tree = process::ProcessTree::attach(child.id().ok_or("本地 Agent 启动失败。")?)?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or("本地 Agent 连接已关闭，请重试。")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("本地 Agent 连接已关闭，请重试。")?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or("本地 Agent 连接已关闭，请重试。")?;
    let mut tasks = JoinSet::new();
    tasks.spawn(async move {
        let mut buffer = [0; 8192];
        while stderr.read(&mut buffer).await.is_ok_and(|n| n > 0) {}
        None::<Value>
    });
    struct Cleanup(Replies);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            if let Ok(mut replies) = self.0.lock() {
                replies.clear();
            }
        }
    }
    let _cleanup = Cleanup(replies.clone());
    let mut protocol = Protocol {
        provider,
        cwd,
        session: session.into(),
        resume,
        prompt,
        url,
        token,
        ready: false,
        active: false,
        answer: String::new(),
        message: String::new(),
        file_changes: HashMap::new(),
        upstream_failures: 0,
    };
    write(&mut stdin, &protocol.initialize()).await?;
    let mut reader = BufReader::new(stdout);
    let mut buffer = Vec::new();
    let mut bytes = 0;
    let deadline = tokio::time::sleep(Duration::from_secs(20 * 60));
    tokio::pin!(deadline);
    let startup = tokio::time::sleep(Duration::from_secs(60));
    tokio::pin!(startup);
    loop {
        tokio::select! {
            _ = cancel.changed() => { let _=child.kill().await; return Err("任务已停止。".into()); },
            _ = &mut deadline => return Err(format!("{} 执行超时，请缩小任务范围后重试。",provider.name())),
            _ = &mut startup, if !protocol.ready => return Err(format!("{} 连接超时，请检查本地配置后重试。",provider.name())),
            Some(event)=events.recv() => send(event)?,
            Some(completed)=tasks.join_next() => {
                if let Ok(Some(response))=completed { write(&mut stdin,&response).await?; }
            },
            line=process::read_line(&mut reader,&mut buffer) => {
                let Some(line)=line? else {return Err(format!("{} 未返回完整结果，请检查本地认证和配置后重试。",provider.name()));};
                bytes+=line.len(); if bytes>32*1024*1024 {return Err("本地 Agent 输出超过本次任务限制。".into());}
                let value:Value=serde_json::from_slice(&line).map_err(|_|"本地 Agent 输出格式不兼容，请更新工具后重试。")?;
                if value.get("method").is_none() && value.get("error").is_some() {return Err(error(provider,&value["error"]));}
                if value.get("method").is_none() && value["id"] == 0 {
                    if provider == Provider::Codex {write(&mut stdin,&json!({"method":"initialized"})).await?;}
                    write(&mut stdin,&protocol.setup(&value["result"])?).await?; continue;
                }
                if value.get("method").is_none() && value["id"] == 1 {
                    let id = if provider==Provider::Codex {value["result"]["thread"]["id"].as_str()}
                        else if resume {Some(session)} else {value["result"]["sessionId"].as_str()};
                    let id=id.filter(|id|valid_session_id(id)).ok_or("本地 Agent 返回的对话标识无效。")?;
                    let verify=async {
                        while !connected.load(std::sync::atomic::Ordering::Acquire) {tokio::time::sleep(Duration::from_millis(20)).await;}
                    };
                    tokio::select! {
                        _=cancel.changed()=>return Err("任务已停止。".into()),
                        result=tokio::time::timeout(Duration::from_secs(10),verify)=>result.map_err(|_|"NeuInk 工具连接失败，请重试。")?,
                    }
                    protocol.session=id.into(); protocol.ready=true; protocol.active=true;
                    send(Event::Message{value:json!({"type":"local_agent_init","session_id":id})})?;
                    if *cancel.borrow() {return Err("任务已停止。".into());}
                    write(&mut stdin,&protocol.turn()).await?; continue;
                }
                if value.get("method").is_some() && value.get("id").is_some() {
                    let id=value["id"].clone();
                    let mut approval=value.clone();
                    if value["method"] == "item/fileChange/requestApproval" {
                        if let Some(changes)=value["params"]["itemId"].as_str().and_then(|id|protocol.file_changes.get(id)) {approval["params"]["changes"]=changes.clone();}
                    }
                    if let Some(input)=approval_input(provider,&approval) {
                        if !protocol.active {return Err("本地 Agent 在对话准备完成前请求了操作。".into());}
                        let key=format!("rpc:{id}"); let (tx,rx)=oneshot::channel();
                        {let mut pending=replies.lock().map_err(|_|"运行状态不可用")?;
                            if pending.len()>=16 || pending.contains_key(&key) {return Err("本地 Agent 待确认操作过多。".into());} pending.insert(key.clone(),tx);}
                        send(Event::Tool{id:key.clone(),name:"approve_tool".into(),input})?;
                        let pending=replies.clone(); let request=value.clone();
                        tasks.spawn(async move {
                            let output=rx.await.unwrap_or(Value::Null);
                            if let Ok(mut map)=pending.lock(){map.remove(&key);}
                            Some(response(provider,id,approval_result(provider,&request,&output)))
                        });
                    } else {
                        let mut rejected=json!({"id":id,"error":{"code":-32601,"message":"Unsupported client method"}});
                        if provider==Provider::Opencode {rejected["jsonrpc"]=json!("2.0");}
                        write(&mut stdin,&rejected).await?;
                    }
                    continue;
                }
                // Native subagents may emit their own messages; they are not the parent's answer.
                if provider == Provider::Codex && value["params"]["threadId"].as_str().is_some_and(|id|id != protocol.session) {continue;}
                if provider == Provider::Opencode && value["method"] == "session/update" && value["params"]["sessionId"] != protocol.session {continue;}
                let done=protocol.observe(&value)?;
                if protocol.active {send(Event::Message{value})?;}
                if done { return Ok(json!({"result":protocol.answer})); }
            }
        }
    }
}

#[cfg(test)]
mod tests;
