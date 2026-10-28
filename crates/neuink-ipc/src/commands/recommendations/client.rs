//! Only lifecycle and data adaptation live here. Retrieval uses original arxiv.py.
use crate::commands::local_agent::process::{read_line, ProcessTree};
use neuink_domain::recommendations::RecommendedPaper;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncWriteExt, BufReader},
    process::Command,
};

pub const VERSION: &str = "4.0.1";
const SCRIPT: &str =
    include_str!("../../../../../apps/desktop/resources/recommendations/arxiv_client.py");
const REQUIREMENTS: &str =
    include_str!("../../../../../apps/desktop/resources/recommendations/requirements.txt");

pub struct FetchError {
    pub message: String,
    pub retry_after_seconds: i64,
}
impl From<String> for FetchError {
    fn from(message: String) -> Self {
        Self {
            message,
            retry_after_seconds: 60,
        }
    }
}

fn command(path: &Path) -> Command {
    let mut command = Command::new(path);
    command
        .kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    command
}
fn python(environment: &Path) -> PathBuf {
    environment.join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    })
}
async fn quiet(mut cmd: Command, seconds: u64, failure: &str) -> Result<(), String> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .spawn()
        .map_err(|_| failure.to_string())?;
    let _tree = ProcessTree::attach(child.id().ok_or(failure)?)?;
    let status = tokio::time::timeout(Duration::from_secs(seconds), child.wait()).await;
    match status {
        Ok(Ok(status)) if status.success() => Ok(()),
        _ => {
            let _ = child.kill().await;
            Err(failure.to_string())
        }
    }
}
async fn invoke(python: &Path, script: &Path, payload: Value) -> Result<Value, String> {
    let mut child = command(python)
        .args(["-I", "-B"])
        .arg(script)
        .spawn()
        .map_err(|_| "arxiv.py 未能启动，请检查 Python 环境".to_string())?;
    let _tree = ProcessTree::attach(child.id().ok_or("检索进程未启动")?)?;
    let mut input = serde_json::to_vec(&payload).map_err(|_| "检索参数无效")?;
    input.push(b'\n');
    child
        .stdin
        .take()
        .ok_or("检索输入不可用")?
        .write_all(&input)
        .await
        .map_err(|_| "检索请求发送失败")?;
    let mut reader = BufReader::new(child.stdout.take().ok_or("检索输出不可用")?);
    let result = tokio::time::timeout(Duration::from_secs(120), async {
        let mut buffer = Vec::new();
        let line = read_line(&mut reader, &mut buffer)
            .await
            .map_err(|_| "arxiv.py 输出无效")?
            .ok_or("arxiv.py 没有返回结果")?;
        let value: Value = serde_json::from_slice(&line).map_err(|_| "arxiv.py 输出格式无效")?;
        if !child
            .wait()
            .await
            .map_err(|_| "arxiv.py 异常退出")?
            .success()
        {
            return Err("arxiv.py 未能完成检索".to_string());
        }
        Ok(value)
    })
    .await
    .unwrap_or_else(|_| Err("arXiv 连接超时，请稍后重试".into()));
    if result.is_err() {
        let _ = child.kill().await;
    }
    result
}
async fn prepare(cache: &Path) -> Result<(PathBuf, PathBuf), String> {
    let environment = cache.join(format!("arxiv-py-{VERSION}"));
    let script = cache.join("recommendation-adapter").join(format!(
        "arxiv-{}.py",
        blake3::hash(SCRIPT.as_bytes()).to_hex()
    ));
    neuink_workspace::atomic_write(&script, SCRIPT.as_bytes()).map_err(|_| "无法准备推荐工具")?;
    let executable = python(&environment);
    if executable.is_file()
        && invoke(&executable, &script, json!({"action":"check"}))
            .await
            .is_ok_and(|v| v["ready"] == true)
    {
        return Ok((executable, script));
    }
    if !executable.is_file() {
        let mut cmd = command(Path::new(if cfg!(windows) { "py" } else { "python3" }));
        if cfg!(windows) {
            cmd.arg("-3.12");
        }
        cmd.args(["-I", "-m", "venv"]).arg(&environment);
        quiet(
            cmd,
            120,
            "无法创建 arxiv.py 环境；Windows 需要安装 Python 3.12，其他系统需要 Python 3.10 或以上",
        )
        .await?;
    }
    let requirements = cache.join("recommendation-adapter/requirements.txt");
    neuink_workspace::atomic_write(&requirements, REQUIREMENTS.as_bytes())
        .map_err(|_| "无法保存推荐工具安装配置")?;
    let mut cmd = command(&executable);
    cmd.args([
        "-I",
        "-m",
        "pip",
        "--isolated",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "--only-binary=:all:",
        "--index-url",
        "https://pypi.org/simple",
        "-r",
    ])
    .arg(requirements);
    quiet(
        cmd,
        300,
        "arxiv.py 安装未完成，请检查 PyPI 网络和 Python 环境后重试",
    )
    .await?;
    if invoke(&executable, &script, json!({"action":"check"})).await?["ready"] != true {
        return Err("arxiv.py 依赖检查未通过，请重试修复环境".into());
    }
    Ok((executable, script))
}
pub async fn fetch(cache: &Path, query: &str) -> Result<Vec<RecommendedPaper>, FetchError> {
    let (python, script) = prepare(cache).await?;
    // Coordinate with ordinary assistant/Research arXiv calls, including the client's retry.
    let _guard = super::super::research::providers::arxiv_request_slot().await;
    let value = invoke(&python, &script, json!({"query":query})).await?;
    if let Some(code) = value["error"].as_str() {
        let (message, retry_after_seconds) = match code {
            "rate_limited" => ("arXiv 暂时限制请求（HTTP 429），已有推荐已保留。冷却后可重试，恢复时间由 arXiv 决定。".to_string(), value["retry_after_seconds"].as_i64().unwrap_or(300).clamp(60, 86400)),
            "timeout" | "connection" => ("arxiv.py 暂时无法连接 arXiv，请稍后重试；已有推荐已保留。".into(), 60),
            "http_error" => (format!("arXiv 返回 HTTP {}，请稍后重试；已有推荐已保留。", value["status"].as_u64().unwrap_or(0)), 60),
            "dependencies" | "version_mismatch" => ("arxiv.py 依赖不完整，请重试修复环境".into(), 60),
            _ => ("arxiv.py 未取得有效论文数据，请稍后重试；已有推荐已保留。".into(), 60),
        };
        return Err(FetchError {
            message,
            retry_after_seconds,
        });
    }
    serde_json::from_value(value["papers"].clone())
        .map_err(|_| FetchError::from("arxiv.py 返回的论文记录无效".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "Explicit opt-in: installs the original client from PyPI; no arXiv/model calls"]
    async fn installs_and_checks_original_client() {
        let cache = std::env::var_os("NEUINK_RECOMMENDATION_TEST_CACHE")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../../target/recommendation-install-test-cache")
            });
        let (python, script) = prepare(&cache).await.unwrap();
        let result = invoke(&python, &script, json!({"action":"check"}))
            .await
            .unwrap();
        assert_eq!(result["ready"], true);
        assert!(python.is_file());
    }
}
