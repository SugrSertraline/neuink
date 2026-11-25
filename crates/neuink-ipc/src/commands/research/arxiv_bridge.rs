//! Per-child loopback transport. Never a general proxy; all outbound requests use ArxivGate.
use super::arxiv_gate::{self, ArxivGate, Context, GateError};
use base64::Engine;
use serde::Deserialize;
use std::{collections::BTreeMap, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    task::{JoinHandle, JoinSet},
};

pub struct Bridge {
    pub endpoint: String,
    pub token: String,
    task: JoinHandle<()>,
}
impl Drop for Bridge {
    fn drop(&mut self) {
        self.task.abort();
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    url: String,
    method: String,
    #[serde(default)]
    headers: BTreeMap<String, String>,
}
impl Bridge {
    pub async fn start(context: Context) -> Result<Self, GateError> {
        Self::start_with(arxiv_gate::shared()?, context).await
    }
    pub async fn start_with(gate: Arc<ArxivGate>, context: Context) -> Result<Self, GateError> {
        Self::start_sender(gate, context, Arc::new(arxiv_gate::NativeSender)).await
    }
    pub async fn start_sender(
        gate: Arc<ArxivGate>,
        context: Context,
        sender: Arc<dyn arxiv_gate::Sender>,
    ) -> Result<Self, GateError> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| GateError::new("bridge_unavailable"))?;
        let endpoint = format!(
            "http://{}/arxiv-request",
            listener
                .local_addr()
                .map_err(|_| GateError::new("bridge_unavailable"))?
        );
        let token = format!(
            "{}{}",
            neuink_domain::NoteId::new(),
            neuink_domain::NoteId::new()
        );
        let secret = token.clone();
        let task = tokio::spawn(async move {
            let mut connections = JoinSet::new();
            loop {
                tokio::select! {
                    _=tokio::time::sleep_until(context.deadline+Duration::from_secs(1))=>break,
                    Some(_)=connections.join_next(), if !connections.is_empty()=>{},
                    accepted=listener.accept()=>match accepted {
                        Ok((socket,peer)) if peer.ip().is_loopback() && connections.len()<8=>{
                            let gate=gate.clone();let token=secret.clone();let context=context.clone();let sender=sender.clone();
                            connections.spawn(async move {let _=serve(socket,&token,gate,context,sender).await;});
                        },
                        Ok(_)=>{},Err(_)=>break,
                    }
                }
            }
            // Dropping JoinSet cancels in-flight Gate futures and removes their queue tickets.
        });
        Ok(Self {
            endpoint,
            token,
            task,
        })
    }
}
async fn respond(socket: &mut TcpStream, status: &str, body: &[u8]) -> Result<(), ()> {
    let header=format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len());
    socket.write_all(header.as_bytes()).await.map_err(|_| ())?;
    socket.write_all(body).await.map_err(|_| ())
}
async fn line(reader: &mut BufReader<TcpStream>, remaining: usize) -> Result<String, ()> {
    let mut buf = vec![];
    (&mut *reader)
        .take((remaining + 1) as u64)
        .read_until(b'\n', &mut buf)
        .await
        .map_err(|_| ())?;
    if buf.len() > remaining || !buf.ends_with(b"\r\n") {
        return Err(());
    }
    String::from_utf8(buf).map_err(|_| ())
}
async fn parse(reader: &mut BufReader<TcpStream>, token: &str) -> Result<Request, &'static str> {
    let first = line(reader, 8192).await.map_err(|_| "400 Bad Request")?;
    if first != "POST /arxiv-request HTTP/1.1\r\n" {
        return Err("400 Bad Request");
    }
    let mut used = first.len();
    let mut length = None;
    let mut authorized = false;
    let mut content_type = false;
    loop {
        let row = line(reader, 8192usize.saturating_sub(used))
            .await
            .map_err(|_| "431 Request Header Fields Too Large")?;
        used += row.len();
        if row == "\r\n" {
            break;
        }
        let (key, value) = row.split_once(':').ok_or("400 Bad Request")?;
        let value = value.trim();
        match key.to_ascii_lowercase().as_str() {
            "content-length" => {
                if length.is_some() || !value.bytes().all(|b| b.is_ascii_digit()) {
                    return Err("400 Bad Request");
                }
                length = Some(value.parse::<usize>().map_err(|_| "400 Bad Request")?);
            }
            "x-proxy-token" => {
                if authorized || value != token {
                    return Err("403 Forbidden");
                }
                authorized = true;
            }
            "content-type" => {
                if content_type || value != "application/json" {
                    return Err("400 Bad Request");
                }
                content_type = true;
            }
            "transfer-encoding" | "origin" => return Err("400 Bad Request"),
            _ => {}
        }
    }
    if !authorized {
        return Err("403 Forbidden");
    }
    if !content_type {
        return Err("400 Bad Request");
    }
    let length = length.ok_or("411 Length Required")?;
    if length > 16384 {
        return Err("413 Payload Too Large");
    }
    let mut bytes = vec![0; length];
    reader
        .read_exact(&mut bytes)
        .await
        .map_err(|_| "400 Bad Request")?;
    let request: Request = serde_json::from_slice(&bytes).map_err(|_| "400 Bad Request")?;
    if request.method != "GET"
        || request.headers.iter().any(|(key, value)| {
            !key.eq_ignore_ascii_case("user-agent")
                || value.len() > 256
                || value.chars().any(char::is_control)
        })
    {
        return Err("400 Bad Request");
    }
    let url = reqwest::Url::parse(&request.url).map_err(|_| "400 Bad Request")?;
    arxiv_gate::validate(&url, false).map_err(|_| "400 Bad Request")?;
    Ok(request)
}
async fn serve(
    socket: TcpStream,
    token: &str,
    gate: Arc<ArxivGate>,
    mut context: Context,
    sender: Arc<dyn arxiv_gate::Sender>,
) -> Result<(), ()> {
    let mut reader = BufReader::new(socket);
    let request =
        match tokio::time::timeout(Duration::from_secs(5), parse(&mut reader, token)).await {
            Ok(Ok(request)) => request,
            result => {
                return respond(
                    reader.get_mut(),
                    result
                        .ok()
                        .and_then(Result::err)
                        .unwrap_or("408 Request Timeout"),
                    b"{}",
                )
                .await
            }
        };
    context.request_id = neuink_domain::NoteId::new().to_string();
    let url = reqwest::Url::parse(&request.url).map_err(|_| ())?;
    let mut disconnect = [0u8; 1];
    let result = tokio::select! {
        biased;
        _=reader.read(&mut disconnect)=>return Err(()),
        result=gate.request_detailed_with(url,context,sender.as_ref())=>result,
    };
    let value = match result {
        Ok(success) => {
            serde_json::json!({"ok":true,"status":success.response.status,"headers":{"content-type":"application/atom+xml"},
            "body_base64":base64::engine::general_purpose::STANDARD.encode(success.response.bytes),
            "request_id":success.request_id,"source":success.source,"attempts_started":success.attempts_started})
        }
        Err(error) => serde_json::json!({"ok":false,"gate_error":error}),
    };
    respond(
        reader.get_mut(),
        "200 OK",
        &serde_json::to_vec(&value).map_err(|_| ())?,
    )
    .await
}

#[cfg(test)]
mod tests;
