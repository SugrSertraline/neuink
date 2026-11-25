use super::{bounded, client, public_url};
use reqwest::Url;

#[derive(Debug)]
pub struct StatusResponse {
    pub status: u16,
    pub retry_after: Option<String>,
    pub location: Option<String>,
    pub bytes: Vec<u8>,
}

// A single hop lets the arXiv scheduler account for redirects and retries separately.
pub async fn get_status(url: &Url, max: usize) -> Result<StatusResponse, &'static str> {
    public_url(url.as_str()).map_err(|_| "invalid_target")?;
    let response = client(url)
        .await
        .map_err(|message| match message.as_str() {
            "无法解析服务地址" => "dns_failed",
            "服务地址解析到非公开网络，已阻止访问" => "blocked_address",
            _ => "client_failed",
        })?
        .get(url.clone())
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "request_timeout"
            } else if error.is_connect() {
                "connection_failed"
            } else {
                "request_failed"
            }
        })?;
    status_response(response, max).await
}

async fn status_response(
    response: reqwest::Response,
    max: usize,
) -> Result<StatusResponse, &'static str> {
    let status = response.status().as_u16();
    let header = |name| {
        response
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    let retry_after = header("retry-after");
    let location = header("location");
    let bytes = if response.status().is_success() {
        bounded(response, max).await.map_err(|message| {
            if message == "响应超过大小限制" {
                "response_size_limit"
            } else {
                "response_body_failed"
            }
        })?
    } else {
        Vec::new()
    };
    Ok(StatusResponse {
        status,
        retry_after,
        location,
        bytes,
    })
}

#[cfg(test)]
#[path = "network_status_tests.rs"]
mod tests;
