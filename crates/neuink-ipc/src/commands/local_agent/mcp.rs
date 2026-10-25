//! Run-scoped, authenticated Streamable HTTP MCP bridge. No workspace write endpoint.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{mpsc, oneshot, watch},
    task::JoinSet,
};

pub const MAX_BODY: usize = 2 * 1024 * 1024;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Message {
        value: Value,
    },
    Tool {
        id: String,
        name: String,
        input: Value,
    },
}
pub type Replies = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

#[derive(Clone)]
pub struct Bridge {
    pub connected: Arc<AtomicBool>,
    pub token: String,
    pub tools: Vec<Tool>,
    pub events: mpsc::Sender<Event>,
    pub replies: Replies,
    pub cancel: watch::Receiver<bool>,
}

pub async fn serve(listener: TcpListener, bridge: Bridge) {
    let mut tasks = JoinSet::new();
    let mut cancel = bridge.cancel.clone();
    loop {
        tokio::select! {
            _ = cancel.changed() => break,
            Some(_) = tasks.join_next(), if !tasks.is_empty() => {},
            incoming = listener.accept() => {
                let Ok((stream, _)) = incoming else { break; };
                // Connections, request bodies and pending UI callbacks are all bounded.
                if tasks.len() >= 16 { drop(stream); continue; }
                let bridge = bridge.clone();
                tasks.spawn(async move { let _ = handle(stream, bridge).await; });
            }
        }
    }
    tasks.abort_all();
    if let Ok(mut replies) = bridge.replies.lock() {
        replies.clear();
    }
}

async fn handle(mut stream: TcpStream, bridge: Bridge) -> Result<(), String> {
    let request = tokio::time::timeout(Duration::from_secs(10), read_request(&mut stream))
        .await
        .map_err(|_| "Request timeout")??;
    let (headers, body) = request;
    let authorized = headers.lines().skip(1).any(|line| {
        line.split_once(':').is_some_and(|(key, value)| {
            key.eq_ignore_ascii_case("authorization")
                && value.trim() == format!("Bearer {}", bridge.token)
        })
    });
    let origin = headers.lines().skip(1).any(|line| {
        line.split_once(':')
            .is_some_and(|(key, _)| key.eq_ignore_ascii_case("origin"))
    });
    if !authorized || origin {
        return respond(&mut stream, 403, None).await;
    }
    if !headers.starts_with("POST /mcp HTTP/1.1\r\n") {
        return respond(&mut stream, 405, None).await;
    }
    let value: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return respond(&mut stream, 400, None).await,
    };
    let Some(id) = value.get("id").cloned() else {
        return respond(&mut stream, 202, None).await;
    };
    let method = value["method"].as_str().unwrap_or("");
    let result = match method {
        "initialize" => Ok(
            json!({"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"neuink","version":"1.0.0"}}),
        ),
        "ping" => Ok(json!({})),
        "tools/list" => {
            bridge.connected.store(true, Ordering::Release);
            Ok(json!({"tools":bridge.tools}))
        }
        "tools/call" => {
            let name = value["params"]["name"].as_str().unwrap_or("");
            if !bridge.tools.iter().any(|tool| tool.name == name) {
                Err("Unknown tool")
            } else {
                let output = call(&bridge, name, value["params"]["arguments"].clone()).await;
                match output {
                    Ok(value) => Ok(value),
                    Err(_) => Ok(
                        json!({"isError":true,"content":[{"type":"text","text":"工具调用已结束或被取消，请查看对话状态。"}]}),
                    ),
                }
            }
        }
        _ => Err("Unsupported method"),
    };
    let output = match result {
        Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
        Err(message) => json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":message}}),
    };
    respond(&mut stream, 200, Some(&output)).await
}

async fn call(bridge: &Bridge, name: &str, input: Value) -> Result<Value, String> {
    if *bridge.cancel.borrow() {
        return Err("Cancelled".into());
    }
    let id = neuink_domain::ConversationId::new().to_string();
    let (tx, rx) = oneshot::channel();
    {
        let mut replies = bridge.replies.lock().map_err(|_| "Bridge unavailable")?;
        if replies.len() >= 16 {
            return Err("Too many requests".into());
        }
        replies.insert(id.clone(), tx);
    }
    // Guard cleans up a dropped HTTP client, timeout or run cancellation.
    struct Pending(Replies, String);
    impl Drop for Pending {
        fn drop(&mut self) {
            if let Ok(mut map) = self.0.lock() {
                map.remove(&self.1);
            }
        }
    }
    let _pending = Pending(bridge.replies.clone(), id.clone());
    bridge
        .events
        .send(Event::Tool {
            id,
            name: name.to_string(),
            input,
        })
        .await
        .map_err(|_| "Bridge closed")?;
    let mut cancel = bridge.cancel.clone();
    tokio::select! {
        _ = cancel.changed() => Err("Cancelled".into()),
        result = tokio::time::timeout(Duration::from_secs(20 * 60), rx) => result.map_err(|_| "Approval expired".to_string())?.map_err(|_| "Bridge closed".to_string()),
    }
}

async fn read_request(stream: &mut TcpStream) -> Result<(String, Vec<u8>), String> {
    let mut bytes = Vec::new();
    let boundary;
    loop {
        if bytes.len() > 16_384 {
            return Err("Headers too large".into());
        }
        let mut buf = [0; 1024];
        let n = stream.read(&mut buf).await.map_err(|_| "Read failed")?;
        if n == 0 {
            return Err("Disconnected".into());
        }
        bytes.extend_from_slice(&buf[..n]);
        if let Some(pos) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
            boundary = pos + 4;
            break;
        }
    }
    let headers = String::from_utf8(bytes[..boundary].to_vec()).map_err(|_| "Invalid headers")?;
    let lengths: Vec<_> = headers
        .lines()
        .filter_map(|line| line.split_once(':'))
        .filter(|(key, _)| key.eq_ignore_ascii_case("content-length"))
        .collect();
    if lengths.len() != 1
        || headers.lines().any(|line| {
            line.split_once(':')
                .is_some_and(|(key, _)| key.eq_ignore_ascii_case("transfer-encoding"))
        })
    {
        return Err("Invalid length".into());
    }
    let length: usize = lengths[0].1.trim().parse().map_err(|_| "Invalid length")?;
    if length > MAX_BODY {
        return Err("Body too large".into());
    }
    let mut body = bytes[boundary..].to_vec();
    if body.len() > length {
        return Err("Invalid body".into());
    }
    let received = body.len();
    body.resize(length, 0);
    stream
        .read_exact(&mut body[received..])
        .await
        .map_err(|_| "Read failed")?;
    Ok((headers, body))
}

async fn respond(stream: &mut TcpStream, status: u16, body: Option<&Value>) -> Result<(), String> {
    let bytes = body.map(|v| v.to_string()).unwrap_or_default();
    let header = format!("HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", bytes.len());
    stream
        .write_all(header.as_bytes())
        .await
        .map_err(|_| "Write failed")?;
    stream
        .write_all(bytes.as_bytes())
        .await
        .map_err(|_| "Write failed")?;
    stream.shutdown().await.map_err(|_| "Write failed".into())
}

#[cfg(test)]
mod tests;
