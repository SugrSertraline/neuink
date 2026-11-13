//! HTTP transport for the private synchronization API. Credentials never enter URLs.
pub mod attachments;
pub mod failure;
pub mod progress;
pub mod replica;
pub mod synchronize;
pub mod workspace_sync;
use failure::SyncFailure;
use reqwest::{Client, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

#[derive(Clone)]
pub struct SyncClient {
    client: Client,
    base: Url,
    progress: Option<progress::Reporter>,
    quota_exceeded: std::sync::Arc<std::sync::atomic::AtomicBool>,
    retryable: std::sync::Arc<std::sync::atomic::AtomicU8>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Session {
    pub account_id: String,
    pub session_id: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

pub fn normalize_endpoint(value: &str) -> Result<Url, String> {
    let mut url = Url::parse(value.trim()).map_err(|_| "服务器地址无效".to_string())?;
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("同步服务器必须使用 HTTPS；HTTP 仅允许本机测试".into());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("请填写不含账号、路径或参数的服务器地址".into());
    }
    url.set_path("/");
    Ok(url)
}
impl SyncClient {
    pub fn quota_exceeded(&self) -> bool {
        self.quota_exceeded
            .load(std::sync::atomic::Ordering::Relaxed)
    }
    pub fn retryable_failure(&self) -> bool {
        self.retryable.load(std::sync::atomic::Ordering::Relaxed) == 1
    }
    pub(crate) fn network_failure(&self) {
        self.retryable
            .fetch_max(1, std::sync::atomic::Ordering::Relaxed);
    }
    pub(crate) fn http_failure(&self, status: u16) {
        if status == 507 {
            self.quota_exceeded
                .store(true, std::sync::atomic::Ordering::Relaxed);
        }
        self.retryable.fetch_max(
            if status == 429 || (status >= 500 && status != 507) {
                1
            } else {
                2
            },
            std::sync::atomic::Ordering::Relaxed,
        );
    }

    pub fn new(endpoint: &str) -> Result<Self, String> {
        Self::build(endpoint, None)
    }

    /// Explicit trust for a self-hosted certificate; hostname and TLS checks stay enabled.
    pub fn with_trusted_certificate(endpoint: &str, pem: &[u8]) -> Result<Self, String> {
        let certificate = reqwest::Certificate::from_pem(pem).map_err(|_| "服务器证书格式无效")?;
        Self::build(endpoint, Some(certificate))
    }

    fn build(endpoint: &str, certificate: Option<reqwest::Certificate>) -> Result<Self, String> {
        let mut builder = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60));
        if let Some(certificate) = certificate {
            builder = builder.add_root_certificate(certificate);
        }
        Ok(Self {
            base: normalize_endpoint(endpoint)?,
            retryable: Default::default(),
            quota_exceeded: Default::default(),
            progress: None,
            client: builder.build().map_err(|_| "无法初始化连接".to_string())?,
        })
    }
    pub async fn request(
        &self,
        method: Method,
        path: &str,
        token: Option<&str>,
        body: Option<&Value>,
    ) -> Result<Value, String> {
        self.request_detailed(method, path, token, body)
            .await
            .map_err(|e| e.message)
    }
    pub async fn request_detailed(
        &self,
        method: Method,
        path: &str,
        token: Option<&str>,
        body: Option<&Value>,
    ) -> Result<Value, SyncFailure> {
        if !path.starts_with('/') || path.starts_with("//") {
            return Err("无效请求路径".into());
        }
        let url = self
            .base
            .join(path)
            .map_err(|_| "无效请求路径".to_string())?;
        if url.origin() != self.base.origin() {
            return Err("拒绝向其他服务器发送凭据".into());
        }
        let mut request = self.client.request(method, url);
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        if let Some(body) = body {
            request = request.json(body);
        }
        let mut response = request.send().await.map_err(|e| {
            self.network_failure();
            if e.is_timeout() {
                "连接超时，本地资料已保留".to_string()
            } else {
                "无法安全连接服务器，请检查地址、网络和证书".to_string()
            }
        })?;
        let status = response.status();
        if !status.is_success() {
            let mut error_body = Vec::new();
            while let Ok(Some(chunk)) = response.chunk().await {
                if chunk.len() > 8192usize.saturating_sub(error_body.len()) {
                    error_body.clear();
                    break;
                }
                error_body.extend_from_slice(&chunk);
            }
            let failure = SyncFailure::http(status.as_u16(), &error_body);
            if !failure.is_revision_conflict() {
                self.http_failure(status.as_u16());
            }
            return Err(failure);
        }
        const MAX_RESPONSE: usize = 16 * 1024 * 1024;
        if response
            .content_length()
            .is_some_and(|size| size > MAX_RESPONSE as u64)
        {
            return Err("服务器响应过大".into());
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| {
            self.network_failure();
            "读取服务器响应失败".to_string()
        })? {
            if chunk.len() > MAX_RESPONSE.saturating_sub(body.len()) {
                return Err("服务器响应过大".into());
            }
            body.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&body).map_err(|_| "服务器返回了无效响应".into())
    }
    pub async fn discovery(&self) -> Result<Value, String> {
        let result = self
            .request(Method::GET, "/.well-known/neuink-sync", None, None)
            .await?;
        let valid_id = |field: &str| {
            result[field].as_str().is_some_and(|id| {
                id.len() == 64
                    && id
                        .bytes()
                        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            })
        };
        if result["protocol_version"] != 1 || !valid_id("server_id") || !valid_id("epoch") {
            return Err("服务器协议不兼容".into());
        }
        Ok(result)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_credentials_and_insecure_remote_endpoints() {
        for v in [
            "http://192.168.1.2:8790",
            "https://user:password@example.com",
            "https://example.com?token=a",
            "file:///tmp/test",
            "https://example.com/other",
        ] {
            assert!(normalize_endpoint(v).is_err(), "{v}");
        }
    }
    #[test]
    fn allows_https_and_explicit_loopback_testing() {
        assert!(normalize_endpoint("https://sync.example.com").is_ok());
        assert!(normalize_endpoint("http://127.0.0.1:8790").is_ok());
    }
}
