//! Fixed, bundled yt-dlp process. Model/page content never becomes an executable or option.
use std::{
    path::{Path, PathBuf},
    process::Stdio,
};

use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};

const LAUNCHER: &str = include_str!("launcher.py");
const OUTPUT_LIMIT: usize = 4 * 1024 * 1024;
const ERROR_LIMIT: usize = 64 * 1024;

struct ReaderRuntime {
    python: PathBuf,
    quickjs: PathBuf,
}

fn runtime_at(root: &Path) -> Option<ReaderRuntime> {
    let python = root.join("python/python.exe");
    let quickjs = root.join("quickjs/qjs.exe");
    [
        python.clone(),
        quickjs.clone(),
        root.join("runtime-manifest.json"),
        root.join("python/Lib/site-packages/yt_dlp/__init__.py"),
        root.join("python/Lib/site-packages/yt_dlp_ejs/__init__.py"),
    ]
    .iter()
    .all(|path| path.is_file())
    .then_some(ReaderRuntime { python, quickjs })
}

fn runtime<R: Runtime>(app: &AppHandle<R>) -> Result<ReaderRuntime, String> {
    let mut roots = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        roots.push(resources.join("resources/browser-reader"));
        roots.push(resources.join("browser-reader"));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            roots.push(parent.join("resources/browser-reader"));
        }
    }
    // Release builds must never run tools from a developer checkout.
    if cfg!(debug_assertions) {
        roots.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../apps/desktop/src-tauri/resources/browser-reader"),
        );
    }
    roots
        .iter()
        .find_map(|root| runtime_at(root))
        .ok_or_else(|| "视频字幕组件未随此版本完整打包，请使用包含网页读取组件的版本。".into())
}

fn command(runtime: &ReaderRuntime, url: &str, directory: &Path) -> Command {
    let mut command = Command::new(&runtime.python);
    command
        .args(["-I", "-B", "-c", LAUNCHER])
        .args([
            "--ignore-config",
            "--no-plugin-dirs",
            "--no-playlist",
            "--simulate",
            "--write-subs",
            "--write-auto-subs",
            "--dump-single-json",
            "--skip-download",
            "--no-cache-dir",
            "--no-update",
            "--no-remote-components",
            "--no-js-runtimes",
            "--js-runtimes",
        ])
        .arg(format!("quickjs:{}", runtime.quickjs.display()))
        .args([
            "--use-extractors",
            "youtube,bilibili",
            "--proxy",
            "",
            "--socket-timeout",
            "8",
            "--retries",
            "0",
            "--extractor-retries",
            "0",
            "--ignore-no-formats-error",
            "--sub-langs",
            "zh.*,ai-zh.*,en.*,ai-en.*,-danmaku,-live_chat",
            "--sub-format",
            "vtt/srt",
            "--",
        ])
        .arg(url)
        .env_clear()
        .env("TEMP", directory)
        .env("TMP", directory)
        .current_dir(directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // Windows DLL/process setup requires this non-secret OS location, not the user's profile.
    if let Some(root) = std::env::var_os("SystemRoot") {
        command.env("SystemRoot", root);
    }
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    command
}

pub(super) async fn extract<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<Value, String> {
    let runtime = runtime(app)?;
    let directory = tempfile::tempdir().map_err(|_| "无法准备视频字幕读取。")?;
    let mut child = command(&runtime, url, directory.path())
        .spawn()
        .map_err(|_| "无法启动已打包的视频字幕组件。")?;
    let stdout = child.stdout.take().ok_or("视频字幕输出不可用。")?;
    let stderr = child.stderr.take().ok_or("视频字幕状态不可用。")?;
    // try_join drops all branches on any size/read failure; kill_on_drop then stops extraction.
    let (stdout, _, status) = tokio::try_join!(
        bounded_read(stdout, OUTPUT_LIMIT),
        bounded_read(stderr, ERROR_LIMIT),
        async {
            child
                .wait()
                .await
                .map_err(|_| "视频字幕组件未能完成。".to_string())
        }
    )?;
    if !status.success() {
        // Never surface stderr: extractors may include signed URLs or arbitrary remote text.
        return Err("视频字幕读取失败；站点可能要求登录、验证或暂不允许字幕访问。".into());
    }
    let metadata: Value =
        serde_json::from_slice(&stdout).map_err(|_| "视频字幕组件返回了无效结果。")?;
    if !metadata.is_object()
        || metadata.get("entries").is_some()
        || !matches!(
            metadata["extractor_key"].as_str(),
            Some("Youtube" | "BiliBili")
        )
    {
        return Err("返回内容不是受支持的单个视频。".into());
    }
    Ok(metadata)
}

async fn bounded_read(reader: impl AsyncRead + Unpin, limit: usize) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    reader
        .take(limit as u64 + 1)
        .read_to_end(&mut output)
        .await
        .map_err(|_| "视频字幕输出读取失败。".to_string())?;
    if output.len() > limit {
        return Err("视频字幕输出超过大小限制。".into());
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Opt-in smoke probe: known public videos, fixed safe command, no user/browser state.
    #[tokio::test]
    #[ignore = "Requires bundled Windows runtime and live public network; reports site restrictions"]
    async fn public_video_smoke() {
        use super::super::transcript;
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src-tauri/resources/browser-reader");
        let runtime = runtime_at(&root).expect("bundled browser reader runtime");
        for (platform, url) in [
            ("youtube", "https://www.youtube.com/watch?v=UF8uR6Z6KLc"),
            ("bilibili", "https://www.bilibili.com/video/BV1SA4m1c7aJ/"),
        ] {
            let probe = async {
                let directory = tempfile::tempdir().unwrap();
                let mut child = command(&runtime, url, directory.path()).spawn().unwrap();
                let stdout = child.stdout.take().unwrap();
                let stderr = child.stderr.take().unwrap();
                let (out, err, status) = tokio::try_join!(
                    bounded_read(stdout, OUTPUT_LIMIT),
                    bounded_read(stderr, ERROR_LIMIT),
                    async {
                        child
                            .wait()
                            .await
                            .map_err(|_| "process_wait_failed".to_owned())
                    }
                )?;
                if !status.success() {
                    let error = String::from_utf8_lossy(&err);
                    // Only fixed diagnostic categories are exposed, never remote stderr/URLs.
                    let reason = if error.contains("Non-public network") {
                        "dns_not_public"
                    } else if error.contains("timed out") || error.contains("WinError 10060") {
                        "network_timeout"
                    } else if error.contains("HTTP Error 412") {
                        "http_412_site_restriction"
                    } else if error.contains("HTTP Error 403") {
                        "http_403_site_restriction"
                    } else if error.contains("HTTP Error 429") {
                        "http_429_rate_limited"
                    } else if error.contains("Sign in") || error.contains("login") {
                        "login_or_verification_required"
                    } else if error.contains("Only public HTTPS") {
                        "non_https_request_blocked"
                    } else {
                        "extractor_or_network_unavailable"
                    };
                    return Ok::<_, String>(format!("failed:{reason}"));
                }
                let metadata: Value =
                    serde_json::from_slice(&out).map_err(|_| "invalid_metadata")?;
                let mut text = transcript::metadata_text(&metadata);
                if let Some(subtitle) = transcript::choose_subtitle(&metadata) {
                    let bytes = if let Some(data) = subtitle.data {
                        data.as_bytes().to_vec()
                    } else {
                        crate::commands::research::network::fetch(
                            subtitle.url.ok_or("missing_subtitle_url")?,
                            super::super::SUBTITLE_LIMIT,
                        )
                        .await?
                        .bytes
                    };
                    transcript::append_subtitle(&mut text, &bytes, &subtitle)?;
                }
                Ok(format!(
                    "{}:characters={},truncated={}",
                    text.content_type,
                    text.text.chars().count(),
                    text.truncated
                ))
            };
            let result = tokio::time::timeout(std::time::Duration::from_secs(35), probe).await;
            match result {
                Ok(Ok(summary)) => println!("{platform}: {summary}"),
                Ok(Err(error)) => println!("{platform}: unavailable ({error})"),
                Err(_) => println!("{platform}: timeout_after_35s"),
            }
        }
    }

    #[tokio::test]
    async fn process_output_is_bounded_including_stderr() {
        assert_eq!(bounded_read(&b"abc"[..], 3).await.unwrap(), b"abc");
        assert!(bounded_read(&b"abcd"[..], 3).await.is_err());
    }

    #[test]
    fn executable_options_are_fixed_and_external_configuration_is_disabled() {
        let runtime = ReaderRuntime {
            python: PathBuf::from("C:/bundle/python/python.exe"),
            quickjs: PathBuf::from("C:/bundle/quickjs/qjs.exe"),
        };
        let command = command(
            &runtime,
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            Path::new("C:/scratch"),
        );
        let args: Vec<_> = command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy())
            .collect();
        for required in [
            "-I",
            "-B",
            "--ignore-config",
            "--no-plugin-dirs",
            "--simulate",
            "--skip-download",
            "--no-cache-dir",
            "--no-update",
            "--no-remote-components",
            "--no-playlist",
            "--use-extractors",
        ] {
            assert!(args.iter().any(|arg| arg == required), "{required}");
        }
        assert_eq!(args[args.len() - 2], "--");
        assert!(!args
            .iter()
            .any(|arg| arg.contains("cookies") || arg == "--exec"));
        assert!(command
            .as_std()
            .get_envs()
            .all(|(key, _)| matches!(key.to_str(), Some("SystemRoot" | "TEMP" | "TMP"))));
    }
}
