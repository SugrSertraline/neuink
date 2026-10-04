//! Public media reading for a host-validated, frozen browser target. No library writes.
//! The caller must keep its tab/navigation guard alive until extraction is complete.
use std::{future::Future, time::Duration};

use tauri::{AppHandle, Runtime};

use crate::commands::research::network;

#[path = "browser_media/process.rs"]
mod process;
#[path = "browser_media/transcript.rs"]
mod transcript;

const PDF_LIMIT: usize = 12 * 1024 * 1024;
const SUBTITLE_LIMIT: usize = 2 * 1024 * 1024;
const PDF_DOWNLOAD_TIMEOUT: &str = "公开 PDF 下载超时，请稍后重试。";
const PDF_DOWNLOAD_CONNECTION: &str = "公开 PDF 下载连接失败，请稍后重试。";
const PDF_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(30);
const PDF_BODY_TIMEOUT: Duration = Duration::from_secs(10);

pub(super) struct MediaText {
    pub text: String,
    pub content_type: String,
    pub extractor: String,
    pub truncated: bool,
    pub limitations: Vec<String>,
}

pub(super) async fn read_pdf(url: &str) -> Result<Vec<u8>, String> {
    read_pdf_with_fetch(|| network::fetch_with_body_timeout(url, PDF_LIMIT, PDF_BODY_TIMEOUT)).await
}

async fn read_pdf_with_fetch<F, Fut>(mut fetch: F) -> Result<Vec<u8>, String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<network::Response, String>>,
{
    let mut retry_available = true;
    loop {
        // Each attempt revalidates/pins every redirect and owns its response/partial bytes.
        // Dropping this future on tab navigation or cancellation drops the current attempt.
        let (retryable, error) = match tokio::time::timeout(PDF_ATTEMPT_TIMEOUT, fetch()).await {
            Ok(Ok(response)) => {
                validate_pdf(&response.bytes)?;
                return Ok(response.bytes);
            }
            Ok(Err(error)) => (
                matches!(error.as_str(), "远程连接失败或超时" | "读取远程内容失败"),
                pdf_download_error(error),
            ),
            Err(_) => (true, PDF_DOWNLOAD_TIMEOUT.to_string()),
        };
        if !retryable || !retry_available {
            return Err(error);
        }
        retry_available = false;
        // No detached task, cookie replay, cached partial body, or extra fallback URL.
    }
}

fn pdf_download_error(error: String) -> String {
    // Preserve actionable, fixed public-transport reasons, never arbitrary future error text.
    // The stage prefix distinguishes native download from the later PDF.js text extraction.
    match error.as_str() {
        "网址过长"
        | "网址无效"
        | "网址缺少主机"
        | "仅允许不含凭据的公开 HTTPS 网址（443 端口）"
        | "服务地址解析到非公开网络，已阻止访问"
        | "响应超过大小限制"
        | "跳转地址无效"
        | "远程跳转次数过多" => format!("公开 PDF 下载失败：{error}。"),
        _ => {
            if let Some(status) = error.strip_prefix("远程服务返回 HTTP ") {
                if status.len() == 3 && status.bytes().all(|byte| byte.is_ascii_digit()) {
                    return format!("公开 PDF 下载失败：远程服务返回 HTTP {status}。");
                }
            }
            PDF_DOWNLOAD_CONNECTION.into()
        }
    }
}

fn validate_pdf(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > PDF_LIMIT || !bytes.starts_with(b"%PDF-") {
        return Err("该网页未返回有效 PDF，可能需要登录、下载确认或已失效。".into());
    }
    Ok(())
}

/// Retain only video identity. Tracking, signed parameters and playlist IDs never reach yt-dlp.
pub(super) fn video_url(raw: &str) -> Option<String> {
    canonical_video_url(raw).ok()
}

fn canonical_video_url(raw: &str) -> Result<String, String> {
    let url = network::public_url(raw)?;
    let host = url.host_str().unwrap_or_default();
    let segments: Vec<_> = url.path().trim_matches('/').split('/').collect();
    let youtube_id = match host {
        "youtu.be" if segments.len() == 1 => Some(segments[0].to_string()),
        "youtube.com" | "www.youtube.com" | "m.youtube.com" | "music.youtube.com" => {
            if url.path() == "/watch" {
                let ids: Vec<_> = url.query_pairs().filter(|(key, _)| key == "v").collect();
                (ids.len() == 1).then(|| ids[0].1.to_string())
            } else if segments.len() == 2 && matches!(segments[0], "shorts" | "live" | "embed") {
                Some(segments[1].to_string())
            } else {
                None
            }
        }
        _ => None,
    };
    if let Some(id) = youtube_id {
        if id.len() == 11
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        {
            return Ok(format!("https://www.youtube.com/watch?v={id}"));
        }
    }
    if matches!(host, "bilibili.com" | "www.bilibili.com" | "m.bilibili.com")
        && segments.len() == 2
        && segments[0] == "video"
    {
        let id = segments[1];
        let valid_bv =
            id.starts_with("BV") && id.len() == 12 && id.bytes().all(|b| b.is_ascii_alphanumeric());
        let valid_av = id.strip_prefix("av").is_some_and(|value| {
            !value.is_empty() && value.len() <= 20 && value.bytes().all(|b| b.is_ascii_digit())
        });
        if valid_bv || valid_av {
            let pages: Vec<_> = url.query_pairs().filter(|(key, _)| key == "p").collect();
            let page = match pages.as_slice() {
                [] => None,
                [(_, value)] => Some(
                    value
                        .parse::<u16>()
                        .ok()
                        .filter(|p| (1..=1000).contains(p))
                        .ok_or("视频分集编号无效。")?,
                ),
                _ => return Err("视频分集编号无效。".into()),
            };
            return Ok(format!(
                "https://www.bilibili.com/video/{id}/{}",
                page.map(|p| format!("?p={p}")).unwrap_or_default()
            ));
        }
    }
    Err("视频字幕读取目前支持 YouTube 与哔哩哔哩的具体视频页面。".into())
}

pub(super) async fn read_video<R: Runtime>(
    app: &AppHandle<R>,
    url: &str,
) -> Result<MediaText, String> {
    let url = canonical_video_url(url)?;
    tokio::time::timeout(Duration::from_secs(35), async {
        // yt-dlp's isolated launcher additionally validates every DNS resolution, including
        // extractor API requests and redirects. Subtitle downloads use the pinned Rust transport.
        network::validate_extract_target(&url).await?;
        let metadata = process::extract(app, &url).await?;
        let mut output = transcript::metadata_text(&metadata);
        if metadata["is_live"].as_bool() == Some(true) {
            output
                .limitations
                .push("当前为直播；仅取得视频标题和说明，没有读取实时音视频或完整字幕。".into());
            return Ok(output);
        }
        let Some(subtitle) = transcript::choose_subtitle(&metadata) else {
            output
                .limitations
                .push("未获得可用中文或英文字幕；标题和说明不代表已观看视频。".into());
            return Ok(output);
        };
        let bytes = if let Some(data) = subtitle.data {
            if data.len() > SUBTITLE_LIMIT {
                output
                    .limitations
                    .push("字幕超过读取大小限制，当前仅包含视频说明。".into());
                return Ok(output);
            }
            Ok(data.as_bytes().to_vec())
        } else if let Some(url) = subtitle.url {
            network::fetch(url, SUBTITLE_LIMIT)
                .await
                .map(|response| response.bytes)
        } else {
            Err("字幕没有可读取内容。".into())
        };
        match bytes.and_then(|bytes| transcript::append_subtitle(&mut output, &bytes, &subtitle)) {
            Ok(()) => (),
            Err(_) => output
                .limitations
                .push("字幕暂时无法取得或解析；当前仅包含视频标题和说明，没有观看音视频。".into()),
        }
        Ok(output)
    })
    .await
    .map_err(|_| "视频字幕读取超时；没有下载或观看视频，请稍后重试。".to_string())?
}

#[cfg(test)]
#[path = "browser_media/pdf_retry_tests.rs"]
mod pdf_retry_tests;

#[cfg(test)]
mod tests {
    use super::*;

    fn save_probe_artifact(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
        use std::io::Write;
        if !path.is_absolute() || !path.parent().is_some_and(std::path::Path::is_dir) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Probe output needs an absolute file path in an existing isolated directory",
            ));
        }
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)?;
        file.write_all(bytes)?;
        file.sync_all()
    }

    #[test]
    fn explicit_probe_artifact_never_overwrites_an_existing_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("public-pdf-probe.pdf");
        save_probe_artifact(&path, b"%PDF-1.7\nfirst").unwrap();
        assert_eq!(
            save_probe_artifact(&path, b"%PDF-1.7\nsecond")
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::AlreadyExists
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"%PDF-1.7\nfirst");
        assert!(save_probe_artifact(std::path::Path::new("relative.pdf"), b"ignored").is_err());
    }

    #[test]
    fn canonical_video_identity_discards_secrets_and_playlists() {
        assert_eq!(
            video_url(
                "https://www.youtube.com/watch?v=dQw4w9WgXcQ&token=secret&list=private#secret"
            )
            .unwrap(),
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        );
        assert_eq!(
            video_url("https://youtu.be/dQw4w9WgXcQ?si=secret").unwrap(),
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        );
        assert_eq!(
            video_url("https://m.bilibili.com/video/BV1xx411c7mD?p=2&access_key=secret").unwrap(),
            "https://www.bilibili.com/video/BV1xx411c7mD/?p=2"
        );
    }

    #[test]
    fn video_targets_are_specific_public_supported_videos() {
        for raw in [
            "https://www.youtube.com/playlist?list=anything",
            "https://www.youtube.com/@channel",
            "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
            "http://youtu.be/dQw4w9WgXcQ",
            "https://user:secret@youtu.be/dQw4w9WgXcQ",
            "https://127.0.0.1/video/BV1xx411c7mD",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=AAAAAAAAAAA",
            "https://b23.tv/short",
            "https://www.bilibili.com/video/BV1xx411c7mD?p=0",
            "https://www.bilibili.com/video/BV1xx411c7mD?p=2&p=3",
        ] {
            assert!(video_url(raw).is_none(), "{raw}");
        }
    }

    #[test]
    fn pdf_magic_and_size_are_checked_independently_of_extension() {
        assert!(validate_pdf(b"%PDF-1.7\nbody").is_ok());
        assert_eq!(
            validate_pdf(b"<html>login</html>").unwrap_err(),
            "该网页未返回有效 PDF，可能需要登录、下载确认或已失效。"
        );
        let mut huge = vec![b' '; PDF_LIMIT + 1];
        huge[..5].copy_from_slice(b"%PDF-");
        assert!(validate_pdf(&huge).is_err());
    }

    #[test]
    fn pdf_download_errors_keep_the_stage_and_safe_actionable_reasons() {
        assert_eq!(PDF_DOWNLOAD_TIMEOUT, "公开 PDF 下载超时，请稍后重试。");
        for error in [
            "无法解析服务地址",
            "无法创建检索连接",
            "远程连接失败或超时",
            "读取远程内容失败",
        ] {
            assert_eq!(pdf_download_error(error.into()), PDF_DOWNLOAD_CONNECTION);
        }
        for reason in [
            "网址过长",
            "网址无效",
            "网址缺少主机",
            "仅允许不含凭据的公开 HTTPS 网址（443 端口）",
            "服务地址解析到非公开网络，已阻止访问",
            "响应超过大小限制",
            "跳转地址无效",
            "远程跳转次数过多",
            "远程服务返回 HTTP 403",
            "远程服务返回 HTTP 429",
        ] {
            assert_eq!(
                pdf_download_error(reason.into()),
                format!("公开 PDF 下载失败：{reason}。")
            );
        }
    }

    #[test]
    fn pdf_download_errors_never_echo_arbitrary_response_details() {
        for error in [
            "token=private response body",
            "远程服务返回 HTTP 403 token=private",
            "远程服务返回 HTTP ４０３",
            "响应超过大小限制 token=private",
        ] {
            assert_eq!(pdf_download_error(error.into()), PDF_DOWNLOAD_CONNECTION);
        }
    }

    #[tokio::test]
    async fn pdf_download_rejection_keeps_the_reason_without_starting_network_work() {
        assert_eq!(
            read_pdf("https://127.0.0.1/paper.pdf").await.unwrap_err(),
            "公开 PDF 下载失败：仅允许不含凭据的公开 HTTPS 网址（443 端口）。"
        );
    }

    #[tokio::test]
    #[ignore = "Explicit public arXiv transport probe; no network in ordinary tests"]
    async fn public_arxiv_pdf_transport_probe() {
        let url = std::env::var("NEUINK_PDF_PROBE_URL")
            .expect("Set NEUINK_PDF_PROBE_URL to a public arXiv PDF URL");
        let target = network::public_url(&url).unwrap();
        assert_eq!(target.host_str(), Some("arxiv.org"));
        assert!(target.path().starts_with("/pdf/"));
        assert!(target.query().is_none() && target.fragment().is_none());
        let started = std::time::Instant::now();
        let result = read_pdf(&url).await;
        // Do not log the URL, document text, request headers or response bytes.
        match &result {
            Ok(bytes) => eprintln!(
                "public_pdf bytes={} elapsed_ms={}",
                bytes.len(),
                started.elapsed().as_millis()
            ),
            Err(error) => eprintln!(
                "public_pdf error={error} elapsed_ms={}",
                started.elapsed().as_millis()
            ),
        }
        assert!(result.is_ok(), "Public PDF transport probe failed");
        if let Some(path) = std::env::var_os("NEUINK_PDF_PROBE_OUTPUT_PATH") {
            save_probe_artifact(std::path::Path::new(&path), &result.unwrap())
                .expect("Unable to save the explicitly requested, new PDF probe artifact");
            eprintln!("public_pdf artifact_saved=true");
        }
    }
}
