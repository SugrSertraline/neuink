//! Immutable attachment transfer. Callers persist the ticket before uploading bytes.
use crate::SyncClient;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

const CHUNK: usize = 4 * 1024 * 1024;
type Result<T> = std::result::Result<T, String>;

pub(crate) const SNAPSHOT_RECOVERY_MESSAGE: &str = "待上传的旧版本快照缺失或损坏。请打开“同步维护 → 重新核对云端内容”，保留当前内容并重建同步队列；本地原文和译文未修改。";

pub(crate) async fn verify_queued_snapshot(path: &Path, hash: &str, size: u64) -> Result<()> {
    match fingerprint(path).await {
        Ok(actual) if actual == (hash.to_owned(), size) => Ok(()),
        Ok(_) => Err(SNAPSHOT_RECOVERY_MESSAGE.into()),
        Err(error) => {
            if !path.try_exists().unwrap_or(true) {
                Err(SNAPSHOT_RECOVERY_MESSAGE.into())
            } else {
                Err(error)
            }
        }
    }
}

#[cfg(test)]
mod snapshot_tests {
    use super::*;
    fn acknowledged_server(hash: &str, complete: bool) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let hash = hash.to_owned();
        let thread = std::thread::spawn(move || {
            listener.set_nonblocking(true).unwrap();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            let mut stream = loop {
                if let Ok((stream, _)) = listener.accept() { break stream; }
                assert!(std::time::Instant::now() < deadline);
                std::thread::sleep(std::time::Duration::from_millis(5));
            };
            stream.set_nonblocking(false).unwrap();
            stream.set_read_timeout(Some(std::time::Duration::from_secs(30))).unwrap();
            let mut request = Vec::new(); let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") { stream.read_exact(&mut byte).unwrap(); request.push(byte[0]); }
            let headers = String::from_utf8(request).unwrap();
            assert!(headers.starts_with("POST /v1/uploads "));
            let length: usize = headers.lines().find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length: ").and_then(|v| v.parse().ok())).unwrap();
            let mut body = vec![0;length]; stream.read_exact(&mut body).unwrap();
            let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(body["hash"], hash);
            let response = json!({"complete":complete,"hash":hash,"id":"5".repeat(64)}).to_string();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",response.len()).unwrap();
        });
        (address, thread)
    }
    #[tokio::test]
    async fn confirmed_remote_resource_avoids_disk_read_but_new_or_missing_remote_requires_snapshot() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("unreadable-snapshot");
        let hash = blake3::hash(b"pdf").to_hex().to_string();
        let (endpoint, server) = acknowledged_server(&hash, true);
        SyncClient::new(&endpoint).unwrap().upload_queued_snapshot("test-token", &path, &hash, 3, true).await.unwrap();
        server.join().unwrap();
        // No server request or reuse is allowed for a newly frozen resource.
        let error = SyncClient::new("http://127.0.0.1:1").unwrap().upload_queued_snapshot("test-token", &path, &hash, 3, false).await.unwrap_err();
        assert_eq!(error, SNAPSHOT_RECOVERY_MESSAGE);
        let (endpoint, server) = acknowledged_server(&hash, false);
        let error = SyncClient::new(&endpoint).unwrap().upload_queued_snapshot("test-token", &path, &hash, 3, true).await.unwrap_err();
        server.join().unwrap();
        assert_eq!(error, SNAPSHOT_RECOVERY_MESSAGE);
    }
    #[tokio::test]
    async fn missing_or_corrupt_queue_snapshot_requires_reconciliation_without_replacing_source() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("snapshot");
        let bytes = b"saved translation";
        let hash = blake3::hash(bytes).to_hex().to_string();
        assert_eq!(verify_queued_snapshot(&path, &hash, bytes.len() as u64).await.unwrap_err(), SNAPSHOT_RECOVERY_MESSAGE);
        std::fs::write(&path, b"different saved translation").unwrap();
        assert_eq!(verify_queued_snapshot(&path, &hash, bytes.len() as u64).await.unwrap_err(), SNAPSHOT_RECOVERY_MESSAGE);
        assert_eq!(std::fs::read(&path).unwrap(), b"different saved translation");
        std::fs::write(&path, bytes).unwrap();
        assert!(verify_queued_snapshot(&path, &hash, bytes.len() as u64).await.is_ok());
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UploadTicket {
    pub id: Option<String>,
    pub hash: String,
    pub size: u64,
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn io_error(_: std::io::Error) -> String {
    "附件读写失败，原始文件未修改".into()
}

pub async fn fingerprint(path: &Path) -> Result<(String, u64)> {
    let mut file = tokio::fs::File::open(path).await.map_err(io_error)?;
    let mut hash = blake3::Hasher::new();
    let mut size = 0u64;
    let mut buffer = vec![0; 65536];
    loop {
        let count = file.read(&mut buffer).await.map_err(io_error)?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > 2 * 1024 * 1024 * 1024 {
            return Err("单个附件不能超过 2 GiB".into());
        }
        hash.update(&buffer[..count]);
    }
    Ok((hash.finalize().to_hex().to_string(), size))
}

impl SyncClient {
    /// Reusing an already acknowledged resource requires a fresh server check.
    /// A changed/new resource or a missing remote blob still takes the complete
    /// immutable-snapshot validation and resumable upload path.
    pub(crate) async fn upload_queued_snapshot(
        &self, token: &str, path: &Path, hash: &str, size: u64, previously_confirmed: bool,
    ) -> Result<()> {
        if !valid_hash(hash) || size > 2 * 1024 * 1024 * 1024 { return Err("附件标识或大小无效".into()); }
        if previously_confirmed {
            let value = self.request(Method::POST, "/v1/uploads", Some(token), Some(&json!({"hash":hash,"size":size}))).await?;
            if value["complete"] == true {
                if value["hash"].as_str() != Some(hash) { return Err("服务器附件确认与排队版本不一致".into()); }
                self.file_progress(true, hash, size, size);
                return Ok(());
            }
        }
        verify_queued_snapshot(path, hash, size).await?;
        let ticket = self.begin_upload(token, path).await?;
        if ticket.hash != hash || ticket.size != size { return Err("排队附件已变化，未发布实体".into()); }
        self.resume_upload(token, path, &ticket).await
    }
    /// Return only the server's acknowledged offset. A lost response is resolved
    /// by querying the upload ticket again, never by guessing the next position.
    pub async fn upload_chunk(
        &self,
        token: &str,
        ticket: &UploadTicket,
        offset: u64,
        bytes: Vec<u8>,
    ) -> Result<u64> {
        let id = ticket
            .id
            .as_deref()
            .filter(|id| valid_hash(id))
            .ok_or("上传标识无效")?;
        let next = offset
            .checked_add(bytes.len() as u64)
            .filter(|n| *n <= ticket.size)
            .ok_or("上传范围无效")?;
        if bytes.is_empty() || bytes.len() > CHUNK || !valid_hash(&ticket.hash) {
            return Err("上传块无效".into());
        }
        let url = self
            .base
            .join(&format!("/v1/uploads/{id}?offset={offset}"))
            .map_err(|_| "上传地址无效")?;
        let mut response = self
            .client
            .put(url)
            .bearer_auth(token)
            .body(bytes)
            .send()
            .await
            .map_err(|_| {
                self.network_failure();
                "附件上传中断，可重试继续"
            })?;
        let status = response.status();
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| {
            self.network_failure();
            "上传进度响应中断，可查询后继续"
        })? {
            if chunk.len() > 8192usize.saturating_sub(body.len()) {
                return Err("上传进度响应过大".into());
            }
            body.extend_from_slice(&chunk);
        }
        if !status.is_success() {
            self.http_failure(status.as_u16());
            return Err(crate::failure::SyncFailure::http(status.as_u16(), &body).message);
        }
        let value: serde_json::Value =
            serde_json::from_slice(&body).map_err(|_| "上传进度响应无效")?;
        if value["offset"].as_u64() != Some(next) {
            return Err("服务器提交偏移与本次上传不一致".into());
        }
        self.file_progress(true, &ticket.hash, next, ticket.size);
        Ok(next)
    }
    pub async fn begin_upload(&self, token: &str, path: &Path) -> Result<UploadTicket> {
        let (hash, size) = fingerprint(path).await?;
        let value = self
            .request(
                Method::POST,
                "/v1/uploads",
                Some(token),
                Some(&json!({"hash":hash,"size":size})),
            )
            .await?;
        let id = if value["complete"] == true {
            None
        } else {
            let id = value["id"]
                .as_str()
                .filter(|id| valid_hash(id))
                .ok_or("上传标识无效")?;
            Some(id.to_owned())
        };
        Ok(UploadTicket { id, hash, size })
    }

    /// Resume from the server's committed offset, including a lost chunk response.
    pub async fn resume_upload(
        &self,
        token: &str,
        path: &Path,
        ticket: &UploadTicket,
    ) -> Result<()> {
        if !valid_hash(&ticket.hash) {
            return Err("附件标识无效".into());
        }
        if fingerprint(path).await? != (ticket.hash.clone(), ticket.size) {
            return Err("附件在排队后发生变化，请重新加入同步".into());
        }
        let Some(id) = &ticket.id else {
            self.file_progress(true, &ticket.hash, ticket.size, ticket.size);
            return Ok(());
        };
        if !valid_hash(id) {
            return Err("上传标识无效".into());
        }
        let route = format!("/v1/uploads/{id}");
        let state = self.request(Method::GET, &route, Some(token), None).await?;
        if state["hash"] != ticket.hash || state["size"].as_u64() != Some(ticket.size) {
            return Err("服务器上传记录与附件不一致".into());
        }
        let mut offset = state["offset"]
            .as_u64()
            .filter(|v| *v <= ticket.size)
            .ok_or("服务器上传进度无效")?;
        self.file_progress(true, &ticket.hash, offset, ticket.size);
        let mut file = tokio::fs::File::open(path).await.map_err(io_error)?;
        file.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(io_error)?;
        while offset < ticket.size {
            let mut bytes = vec![0; (ticket.size - offset).min(CHUNK as u64) as usize];
            file.read_exact(&mut bytes).await.map_err(io_error)?;
            offset = self.upload_chunk(token, ticket, offset, bytes).await?;
        }
        let result = self
            .request(
                Method::POST,
                &format!("{route}/complete"),
                Some(token),
                None,
            )
            .await?;
        if result["hash"] != ticket.hash || result["size"].as_u64() != Some(ticket.size) {
            return Err("附件完成校验失败".into());
        }
        Ok(())
    }

    /// Download into a caller-owned staging file. Never overwrites a workspace attachment.
    /// On interruption its prefix is retained; the complete hash is checked before returning.
    pub async fn download_attachment(
        &self,
        token: &str,
        hash: &str,
        size: u64,
        staging: &Path,
    ) -> Result<()> {
        if !valid_hash(hash) || size > 2 * 1024 * 1024 * 1024 {
            return Err("附件声明无效".into());
        }
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(staging)
            .await
            .map_err(io_error)?;
        let mut offset = file.metadata().await.map_err(io_error)?.len();
        if offset > size {
            return Err("本地暂存附件长度异常，请清除该暂存文件后重试".into());
        }
        file.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(io_error)?;
        while offset < size {
            let url = self
                .base
                .join(&format!("/v1/blobs/{hash}"))
                .map_err(|_| "下载地址无效")?;
            let mut response = self
                .client
                .get(url)
                .bearer_auth(token)
                .header("x-neuink-offset", offset)
                .send()
                .await
                .map_err(|_| {
                    self.network_failure();
                    "附件下载中断，可重试继续"
                })?;
            if !response.status().is_success() {
                self.http_failure(response.status().as_u16());
                return Err("附件下载失败，本地资料未修改".into());
            }
            if response
                .headers()
                .get("x-neuink-size")
                .and_then(|h| h.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                != Some(size)
            {
                return Err("服务器附件长度不一致".into());
            }
            let expected = (size - offset).min(CHUNK as u64) as usize;
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| {
                self.network_failure();
                "附件下载中断，可重试继续"
            })? {
                if chunk.len() > expected.saturating_sub(bytes.len()) {
                    return Err("附件响应超出声明长度".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            if bytes.len() != expected {
                self.network_failure();
                return Err("附件分块不完整，可重试继续".into());
            }
            file.write_all(&bytes).await.map_err(io_error)?;
            file.sync_all().await.map_err(io_error)?;
            offset += bytes.len() as u64;
            self.file_progress(false, hash, offset, size);
        }
        drop(file);
        if fingerprint(staging).await? != (hash.to_owned(), size) {
            return Err("附件校验失败，请清除该暂存文件后重新下载".into());
        }
        self.file_progress(false, hash, size, size);
        Ok(())
    }
}
