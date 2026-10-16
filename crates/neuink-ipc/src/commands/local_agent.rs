//! Claude installation detection and opt-in execution. Detection never opens a session.
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
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};

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
pub(super) fn candidates() -> Vec<PathBuf> {
    provider_candidates(Provider::Claude)
}
fn provider_candidates(provider: Provider) -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        directories.push(PathBuf::from(&home).join(".local").join("bin"));
        if provider == Provider::Opencode {
            directories.push(PathBuf::from(home).join(".opencode").join("bin"));
        }
    }
    if let Some(app_data) = std::env::var_os("APPDATA") {
        directories.push(PathBuf::from(app_data).join("npm"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        directories.extend(std::env::split_paths(&path).filter(|path| path.is_absolute()));
    }
    let mut result = Vec::new();
    for directory in directories {
        for path in provider_executable_candidates(directory, provider) {
            if !result.contains(&path) && path.is_file() {
                result.push(path);
            }
        }
    }
    result
}

fn provider_executable_candidates(directory: PathBuf, provider: Provider) -> Vec<PathBuf> {
    // Resolve the native npm payload rather than evaluating a .cmd/.ps1 shell wrapper.
    if cfg!(windows) {
        match provider {
            Provider::Claude => vec![
                directory.join("claude.exe"),
                directory.join("node_modules/@anthropic-ai/claude-code/bin/claude.exe"),
            ],
            Provider::Codex => {
                let platform = if cfg!(target_arch = "aarch64") {
                    "arm64"
                } else {
                    "x64"
                };
                let triple = if cfg!(target_arch = "aarch64") {
                    "aarch64-pc-windows-msvc"
                } else {
                    "x86_64-pc-windows-msvc"
                };
                vec![directory.join("codex.exe"),
                directory.join(format!("node_modules/@openai/codex/node_modules/@openai/codex-win32-{platform}/vendor/{triple}/bin/codex.exe")),
                directory.join(format!("node_modules/@openai/codex-win32-{platform}/vendor/{triple}/bin/codex.exe")),
                directory.join(format!("node_modules/@openai/codex/vendor/{triple}/codex/codex.exe"))]
            }
            Provider::Opencode => {
                let platform = if cfg!(target_arch = "aarch64") {
                    "arm64"
                } else {
                    "x64"
                };
                vec![directory.join("opencode.exe"),
                directory.join(format!("node_modules/opencode-ai/node_modules/opencode-windows-{platform}/bin/opencode.exe")),
                directory.join(format!("node_modules/opencode-windows-{platform}/bin/opencode.exe"))]
            }
        }
    } else {
        vec![directory.join(match provider {
            Provider::Claude => "claude",
            Provider::Codex => "codex",
            Provider::Opencode => "opencode",
        })]
    }
}

fn is_claude_version(output: &[u8]) -> bool {
    let text = String::from_utf8_lossy(output);
    text.contains("Claude Code")
        && text.split_whitespace().any(|part| {
            part.chars().next().is_some_and(|ch| ch.is_ascii_digit()) && part.contains('.')
        })
}

pub(super) async fn provider_executable(provider: Provider) -> Result<PathBuf, String> {
    let candidates = provider_candidates(provider);
    let name = provider.name();
    if candidates.is_empty() {
        return Err(format!("未检测到 {name}，请安装后重新检测。"));
    }
    let probe = async {
        for path in candidates {
            let mut command = Command::new(&path);
            command
                .arg("--version")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .kill_on_drop(true);
            #[cfg(windows)]
            command.creation_flags(0x08000000);
            let Ok(mut child) = command.spawn() else {
                continue;
            };
            let Some(stdout) = child.stdout.take() else {
                continue;
            };
            let mut output = Vec::new();
            if stdout.take(4096).read_to_end(&mut output).await.is_err() {
                continue;
            }
            if child.wait().await.is_ok_and(|status| status.success())
                && is_provider_version(provider, &output)
            {
                return Ok(path);
            }
        }
        Err(format!("{name} 无法启动，请检查安装。"))
    };
    tokio::time::timeout(Duration::from_secs(8), probe)
        .await
        .unwrap_or_else(|_| Err(format!("{name} 检测超时，请重新检测。")))
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
        Ok(_) => LocalAgentDetection {
            status: "detected",
            message: format!("已检测到 {}", provider.name()),
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
            .flat_map(|provider| provider_executable_candidates(PathBuf::from("tools"), provider))
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
