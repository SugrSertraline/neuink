//! Bounded stdio MCP client. Commands are trusted local configuration, never model input.
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::Path,
    process::Stdio,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, ChildStdout, Command},
    sync::Notify,
};

struct Call {
    signal: Arc<Notify>,
    started: bool,
}
static CALLS: OnceLock<Mutex<HashMap<String, Call>>> = OnceLock::new();
const MAX_MESSAGE: u64 = 2 * 1024 * 1024;

pub fn cancel(id: &str) {
    let mut calls = CALLS.get_or_init(Default::default).lock().unwrap();
    // Keep a bounded pending-cancel tombstone if IPC cancellation overtakes startup.
    if !calls.contains_key(id) && calls.len() >= 128 {
        return;
    }
    calls
        .entry(id.to_string())
        .or_insert_with(|| Call {
            signal: Arc::new(Notify::new()),
            started: false,
        })
        .signal
        .notify_one();
}

pub async fn request(
    root: &Path,
    command: &str,
    id: String,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let signal = {
        let mut calls = CALLS.get_or_init(Default::default).lock().unwrap();
        if calls.get(&id).is_some_and(|call| call.started) {
            return Err("Duplicate MCP call id".into());
        }
        let call = calls.entry(id.clone()).or_insert_with(|| Call {
            signal: Arc::new(Notify::new()),
            started: false,
        });
        call.started = true;
        call.signal.clone()
    };
    let result = tokio::select! {
        biased;
        _ = signal.notified() => Err("MCP call cancelled".into()),
        result = tokio::time::timeout(Duration::from_secs(60), exchange(root, command, method, params)) =>
            result.unwrap_or_else(|_| Err("MCP request timed out".into())),
    };
    CALLS.get().unwrap().lock().unwrap().remove(&id);
    result
}

async fn exchange(
    root: &Path,
    command: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let parts = command_parts(command)?;
    let mut process = Command::new(&parts[0]);
    process
        .args(&parts[1..])
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    process.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let mut child = process
        .spawn()
        .map_err(|_| "Could not start configured MCP server".to_string())?;
    let mut input = child.stdin.take().ok_or("MCP stdin unavailable")?;
    let mut output = BufReader::new(child.stdout.take().ok_or("MCP stdout unavailable")?);
    send(&mut input, json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"Neuink","version":"0.1.0"}
    }})).await?;
    let initialized = receive(&mut output, &mut input, 1).await?;
    let version = initialized["protocolVersion"].as_str().unwrap_or("");
    if !["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"].contains(&version) {
        return Err("Unsupported MCP protocol version".into());
    }
    if !initialized["capabilities"]["tools"].is_object() {
        return Err("MCP server does not support tools".into());
    }
    send(
        &mut input,
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
    )
    .await?;
    let result = operation(&mut input, &mut output, method, params).await;
    drop(input);
    if tokio::time::timeout(Duration::from_millis(250), child.wait())
        .await
        .is_err()
    {
        let _ = child.kill().await;
    }
    result
}

async fn operation(
    input: &mut ChildStdin,
    output: &mut BufReader<ChildStdout>,
    method: &str,
    mut params: Value,
) -> Result<Value, String> {
    let mut tools = Vec::new();
    for id in 2..10 {
        send(
            input,
            json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}),
        )
        .await?;
        let response = receive(output, input, id).await?;
        if method != "tools/list" {
            return Ok(response);
        }
        let items = response["tools"]
            .as_array()
            .ok_or("Invalid MCP tools catalog")?;
        tools.extend(items.iter().cloned());
        match response["nextCursor"].as_str() {
            Some(cursor) => params = json!({"cursor":cursor}),
            None => return Ok(json!({"tools":tools})),
        }
    }
    Err("MCP tool catalog exceeds pagination limit".into())
}

async fn send(input: &mut ChildStdin, message: Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(&message).map_err(|_| "Invalid MCP request")?;
    bytes.push(b'\n');
    input
        .write_all(&bytes)
        .await
        .map_err(|_| "MCP input closed".to_string())?;
    input
        .flush()
        .await
        .map_err(|_| "MCP input closed".to_string())
}

async fn receive(
    output: &mut BufReader<ChildStdout>,
    input: &mut ChildStdin,
    expected: u64,
) -> Result<Value, String> {
    loop {
        let mut bytes = Vec::new();
        (&mut *output)
            .take(MAX_MESSAGE + 1)
            .read_until(b'\n', &mut bytes)
            .await
            .map_err(|_| "MCP output failed")?;
        if bytes.is_empty() {
            return Err("MCP server closed before responding".into());
        }
        if bytes.len() as u64 > MAX_MESSAGE {
            return Err("MCP response exceeds size limit".into());
        }
        let message: Value =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid MCP JSON-RPC response")?;
        if message["jsonrpc"] != "2.0" {
            return Err("Invalid MCP JSON-RPC version".into());
        }
        if let Some(method) = message["method"].as_str() {
            if let Some(id) = message.get("id") {
                let reply = if method == "ping" {
                    json!({"jsonrpc":"2.0","id":id,"result":{}})
                } else {
                    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Client capability not supported"}})
                };
                send(input, reply).await?;
            }
            continue;
        }
        if message["id"].as_u64() != Some(expected) {
            continue;
        }
        if message.get("error").is_some() {
            return Err("MCP server returned a protocol error".into());
        }
        return message
            .get("result")
            .cloned()
            .ok_or_else(|| "MCP response has no result".into());
    }
}

fn command_parts(command: &str) -> Result<Vec<String>, String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    for ch in command.chars() {
        if Some(ch) == quote {
            quote = None;
        } else if quote.is_none() && (ch == '\'' || ch == '"') {
            quote = Some(ch);
        } else if quote.is_none() && ch.is_whitespace() {
            if !current.is_empty() {
                parts.push(std::mem::take(&mut current));
            }
        } else {
            current.push(ch);
        }
    }
    if quote.is_some() {
        return Err("Unclosed quote in MCP command".into());
    }
    if !current.is_empty() {
        parts.push(current);
    }
    if parts.is_empty() {
        return Err("Empty MCP command".into());
    }
    Ok(parts)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_windows_paths_and_quoted_arguments() {
        assert_eq!(
            command_parts(r#""C:\Program Files\node.exe" "D:\My Tools\server.js" --stdio"#)
                .unwrap(),
            vec![
                r"C:\Program Files\node.exe",
                r"D:\My Tools\server.js",
                "--stdio"
            ]
        );
    }
    #[test]
    fn rejects_invalid_commands() {
        assert!(command_parts("").is_err());
        assert!(command_parts("\"unclosed").is_err());
    }

    fn fixture_command() -> String {
        format!(
            "node \"{}/tests/fixtures/mcp.cjs\"",
            env!("CARGO_MANIFEST_DIR")
        )
    }

    #[tokio::test]
    async fn initializes_discovers_and_calls_real_stdio_server() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let catalog = request(
            root,
            &fixture_command(),
            "mcp-test-list".into(),
            "tools/list",
            json!({}),
        )
        .await
        .unwrap();
        assert_eq!(catalog["tools"][0]["name"], "echo");
        assert_eq!(catalog["tools"][1]["name"], "second");
        let output = request(
            root,
            &fixture_command(),
            "mcp-test-call".into(),
            "tools/call",
            json!({"name":"echo","arguments":{"value":42}}),
        )
        .await
        .unwrap();
        assert_eq!(output["content"][0]["text"], r#"{"value":42}"#);
    }

    #[tokio::test]
    async fn cancellation_stops_a_waiting_server() {
        let task = tokio::spawn(async {
            request(
                Path::new(env!("CARGO_MANIFEST_DIR")),
                &fixture_command(),
                "mcp-test-cancel".into(),
                "tools/call",
                json!({"name":"hang"}),
            )
            .await
        });
        tokio::time::sleep(Duration::from_millis(150)).await;
        cancel("mcp-test-cancel");
        let result = tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(result.unwrap_err(), "MCP call cancelled");
    }
}
