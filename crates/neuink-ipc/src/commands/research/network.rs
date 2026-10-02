//! Bounded public-network transport. Revalidate and pin DNS on EVERY redirect.
use reqwest::{redirect::Policy, Client, Url};
use serde_json::Value;
use std::{
    net::{IpAddr, SocketAddr},
    time::Duration,
};

pub fn public_url(value: &str) -> Result<Url, String> {
    if value.len() > 4096 {
        return Err("网址过长".into());
    }
    let url = Url::parse(value).map_err(|_| "网址无效".to_string())?;
    let host = url
        .host_str()
        .ok_or("网址缺少主机")?
        .trim_matches(['[', ']']);
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
        || host.ends_with('.')
        || host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.parse::<IpAddr>().is_ok_and(|ip| !public_ip(ip))
    {
        return Err("仅允许不含凭据的公开 HTTPS 网址（443 端口）".into());
    }
    Ok(url)
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let [a, b, _, _] = v.octets();
            !v.is_private()
                && !v.is_loopback()
                && !v.is_link_local()
                && !v.is_broadcast()
                && !v.is_documentation()
                && a != 0
                && a < 224
                && !(a == 100 && (64..128).contains(&b))
                && !(a == 198 && (b == 18 || b == 19))
                && !(a == 192 && b == 0)
        }
        IpAddr::V6(v) => v
            .to_ipv4_mapped()
            .map(|ip| public_ip(IpAddr::V4(ip)))
            .unwrap_or_else(|| {
                (v.segments()[0] & 0xe000) == 0x2000
                    && !(v.segments()[0] == 0x2001
                        && (v.segments()[1] < 0x200 || v.segments()[1] == 0xdb8))
                    && v.segments()[0] != 0x2002
                    && !(v.segments()[0] == 0x3fff && v.segments()[1] < 0x1000)
            }),
    }
}

pub async fn validate_extract_target(value: &str) -> Result<(), String> {
    let url = public_url(value)?;
    if url.query_pairs().any(|(name, _)| {
        [
            "token",
            "access_token",
            "api_key",
            "apikey",
            "key",
            "password",
            "authorization",
            "signature",
            "sig",
            "x-amz-signature",
        ]
        .contains(&name.to_ascii_lowercase().as_str())
    }) {
        return Err("请勿将包含访问密钥或签名的网址发送给网页提取服务".into());
    }
    client(&url).await?;
    Ok(())
}

async fn client(url: &Url) -> Result<Client, String> {
    let host = url
        .host_str()
        .ok_or("网址缺少主机")?
        .trim_matches(['[', ']']);
    let addresses: Vec<SocketAddr> = tokio::net::lookup_host((host, 443))
        .await
        .map_err(|_| "无法解析服务地址".to_string())?
        .collect();
    if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) {
        return Err("服务地址解析到非公开网络，已阻止访问".into());
    }
    Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(90))
        .user_agent("Neuink/0.1 (research reader)")
        .resolve_to_addrs(host, &addresses)
        .build()
        .map_err(|_| "无法创建检索连接".into())
}

async fn bounded(mut response: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
    if !response.status().is_success() {
        return Err(format!("远程服务返回 HTTP {}", response.status().as_u16()));
    }
    let declared = response
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    if response.content_length().is_some_and(|n| n > max as u64)
        || declared.is_some_and(|n| n > max as u64)
    {
        return Err("响应超过大小限制".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "读取远程内容失败".to_string())?
    {
        if bytes.len() + chunk.len() > max {
            return Err("响应超过大小限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub async fn get(value: &str, max: usize) -> Result<Vec<u8>, String> {
    Ok(fetch(value, max).await?.bytes)
}

pub struct Response {
    pub url: Url,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

pub async fn fetch(value: &str, max: usize) -> Result<Response, String> {
    let mut url = public_url(value)?;
    for _ in 0..6 {
        let response = client(&url)
            .await?
            .get(url.clone())
            .send()
            .await
            .map_err(|_| "远程连接失败或超时".to_string())?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or("跳转地址无效")?;
            url = public_url(url.join(location).map_err(|_| "跳转地址无效")?.as_str())?;
        } else {
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();
            return Ok(Response {
                url,
                content_type,
                bytes: bounded(response, max).await?,
            });
        }
    }
    Err("远程跳转次数过多".into())
}

pub async fn tavily(endpoint: &str, key: &str, body: Value) -> Result<Value, String> {
    let url = public_url(&format!("https://api.tavily.com/{endpoint}"))?;
    let response = client(&url)
        .await?
        .post(url.clone())
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|_| "网页检索连接失败或超时".to_string())?;
    serde_json::from_slice(&bounded(response, 2 * 1024 * 1024).await?)
        .map_err(|_| "网页检索响应格式无效".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn response_limits_and_errors_do_not_expose_remote_content() {
        let body = reqwest::Body::wrap_stream(futures_util::stream::iter([
            Ok::<_, std::io::Error>(vec![b'x'; 8]),
            Ok(vec![b'y'; 8]),
        ]));
        let response = reqwest::Response::from(
            tauri::http::Response::builder()
                .status(200)
                .body(body)
                .unwrap(),
        );
        assert_eq!(bounded(response, 10).await.unwrap_err(), "响应超过大小限制");
        let response = reqwest::Response::from(
            tauri::http::Response::builder()
                .status(200)
                .body(vec![b'x'; 20])
                .unwrap(),
        );
        assert_eq!(bounded(response, 10).await.unwrap_err(), "响应超过大小限制");
        let response = reqwest::Response::from(
            tauri::http::Response::builder()
                .status(200)
                .header("content-length", "100")
                .body(Vec::<u8>::new())
                .unwrap(),
        );
        assert_eq!(bounded(response, 10).await.unwrap_err(), "响应超过大小限制");
        let response = reqwest::Response::from(
            tauri::http::Response::builder()
                .status(401)
                .body("token=do-not-print")
                .unwrap(),
        );
        assert_eq!(
            bounded(response, 100).await.unwrap_err(),
            "远程服务返回 HTTP 401"
        );
        let response = reqwest::Response::from(
            tauri::http::Response::builder()
                .status(200)
                .body("ok")
                .unwrap(),
        );
        assert_eq!(bounded(response, 100).await.unwrap(), b"ok");
    }
    #[tokio::test]
    async fn rejects_private_and_credential_bearing_extract_targets_before_dns() {
        assert!(
            validate_extract_target("https://example.org/?api_key=private")
                .await
                .is_err()
        );
        assert!(validate_extract_target("https://127.0.0.1/test")
            .await
            .is_err());
    }
    #[test]
    fn rejects_local_credentials_and_protocols() {
        for s in [
            "http://example.com",
            "https://127.1/",
            "https://[::ffff:127.0.0.1]/",
            "https://[::1]/",
            "https://10.0.0.1",
            "https://100.64.0.1",
            "https://example.com:8443",
            "https://u:p@example.com",
            "file:///x",
            "https://foo.local",
        ] {
            assert!(public_url(s).is_err(), "{s}");
        }
        assert!(public_url("https://arxiv.org/pdf/2401.00001").is_ok());
        assert!(public_ip("2001:4860:4860::8888".parse().unwrap()));
        for address in ["2001:db8::1", "2001:2::1", "2002::1", "3fff::1", "fd00::1"] {
            assert!(!public_ip(address.parse().unwrap()));
        }
    }
}
