//! Claude installation detection and opt-in execution. Detection never opens a session.
mod installation;
mod mcp;
mod process;
mod rpc;
pub mod runtime;
#[cfg(windows)]
pub use process::ProcessTree as AppProcessGuard;

#[cfg(windows)]
pub fn guard_app_process() -> Result<AppProcessGuard, String> {
    process::ProcessTree::attach(std::process::id())
}
use installation::{discover, AgentExecutable};
use serde::{Deserialize, Serialize};
use std::{process::Stdio, time::Duration};
use tokio::io::AsyncReadExt;

#[derive(Debug, Serialize)]
pub struct LocalAgentDetection {
    status: &'static str,
    message: String,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    #[default]
    Claude,
    Codex,
    Opencode,
}
impl Provider {
    fn name(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Codex => "Codex",
            Self::Opencode => "OpenCode",
        }
    }
}

#[cfg(test)]
fn candidates() -> Vec<AgentExecutable> {
    discover(Provider::Claude).executables
}

fn is_claude_version(output: &[u8]) -> bool {
    let text = String::from_utf8_lossy(output);
    text.contains("Claude Code")
        && text.split_whitespace().any(|part| {
            part.chars().next().is_some_and(|ch| ch.is_ascii_digit()) && part.contains('.')
        })
}

async fn provider_executable(provider: Provider) -> Result<AgentExecutable, String> {
    probe_candidates(provider, discover(provider)).await
}

async fn probe_candidates(
    provider: Provider,
    candidates: installation::Candidates,
) -> Result<AgentExecutable, String> {
    if candidates.executables.is_empty() {
        return Err(candidates.missing_message(provider));
    }
    let name = provider.name();
    let probe = async {
        let mut failure = "程序无法启动，请检查执行权限和安装完整性。";
        for executable in candidates.executables {
            match tokio::time::timeout(Duration::from_secs(4), probe_version(provider, &executable))
                .await
            {
                Ok(Ok(())) => return Ok(executable),
                Ok(Err(message)) => failure = message,
                Err(_) => failure = "版本检查超时，请检查安装后重试。",
            }
        }
        Err(format!("已找到 {name} 入口，但{failure}"))
    };
    tokio::time::timeout(Duration::from_secs(8), probe)
        .await
        .unwrap_or_else(|_| Err(format!("{name} 检测超时，请重新检测。")))
}

async fn probe_version(
    provider: Provider,
    executable: &AgentExecutable,
) -> Result<(), &'static str> {
    let mut command = executable.command();
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command
        .spawn()
        .map_err(|_| "程序无法启动，请检查执行权限和安装完整性。")?;
    let stdout = child.stdout.take().ok_or("无法读取版本检查结果。")?;
    let mut output = Vec::new();
    stdout
        .take(4096)
        .read_to_end(&mut output)
        .await
        .map_err(|_| "无法读取版本检查结果。")?;
    if !child.wait().await.is_ok_and(|status| status.success()) {
        return Err("版本检查异常退出，请检查安装及其依赖。");
    }
    if !is_provider_version(provider, &output) {
        return Err("版本输出无法识别，请检查是否为该工具的官方 CLI。");
    }
    Ok(())
}

fn is_provider_version(provider: Provider, output: &[u8]) -> bool {
    let text = String::from_utf8_lossy(output);
    match provider {
        Provider::Claude => is_claude_version(output),
        Provider::Codex => {
            text.trim().starts_with("codex-cli ")
                && semver(text.trim().trim_start_matches("codex-cli "))
        }
        Provider::Opencode => semver(text.trim()),
    }
}
fn semver(text: &str) -> bool {
    let version = text.split('-').next().unwrap_or("");
    version.split('.').count() == 3
        && version
            .split('.')
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

#[tauri::command]
pub async fn detect_claude_code() -> LocalAgentDetection {
    detect_local_agent(Provider::Claude).await
}
#[tauri::command]
pub async fn detect_local_agent(provider: Provider) -> LocalAgentDetection {
    match provider_executable(provider).await {
        Ok(executable) => LocalAgentDetection {
            status: "detected",
            message: format!(
                "已检测到 {}{}",
                provider.name(),
                if matches!(executable, AgentExecutable::Node { .. }) {
                    "（npm / Node.js）"
                } else {
                    ""
                }
            ),
        },
        Err(message) => LocalAgentDetection {
            status: if message.starts_with("未检测到") {
                "missing"
            } else {
                "error"
            },
            message,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_accepts_claude_version_output() {
        assert!(is_claude_version(b"2.1.0 (Claude Code)\n"));
        assert!(!is_claude_version(b"node v22.0.0"));
        assert!(!is_claude_version(b"Claude Code failed"));
        assert!(!is_claude_version(b""));
    }

    #[test]
    fn never_executes_shell_shims() {
        for path in [Provider::Claude, Provider::Codex, Provider::Opencode]
            .into_iter()
            .flat_map(|provider| {
                installation::native_candidates(std::path::Path::new("tools"), provider)
            })
        {
            assert!(!matches!(
                path.extension().and_then(|value| value.to_str()),
                Some("cmd" | "ps1" | "bat")
            ));
        }
    }
    #[test]
    fn verifies_official_cli_version_formats() {
        assert!(is_provider_version(Provider::Codex, b"codex-cli 0.137.0\n"));
        assert!(is_provider_version(Provider::Opencode, b"1.2.3\n"));
        assert!(!is_provider_version(Provider::Codex, b"node v22.0.0"));
        assert!(!is_provider_version(Provider::Opencode, b"1.2.3 failed"));
    }
}
