use super::control;
use crate::commands::local_agent::process::{read_line, ProcessTree};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncWriteExt, BufReader},
    process::Command,
    sync::oneshot,
};

pub const VERSION: &str = "2.1.0";
const RUNNER: &str = include_str!("../../../../../apps/desktop/resources/research/runner.py");
pub fn environment(cache: &Path) -> PathBuf { super::component::environment(cache) }
fn python(root: &Path) -> PathBuf { root.join("python/python.exe") }
pub fn command(executable: &Path) -> Command {
    let mut command = Command::new(executable);
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
fn script(cache: &Path) -> Result<PathBuf, String> {
    let path = cache.join("research-adapter").join(format!(
        "runner-{}.py",
        blake3::hash(RUNNER.as_bytes()).to_hex()
    ));
    neuink_workspace::atomic_write(&path, RUNNER.as_bytes())
        .map_err(|_| "无法保存 Research 接口文件")?;
    Ok(path)
}
pub async fn check(cache: &Path) -> Result<(), String> {
    check_at(&environment(cache), cache).await
}
pub async fn check_at(environment: &Path, cache: &Path) -> Result<(), String> {
    if !python(environment).is_file() {
        return Err("需要安装研究组件，请点击“安装并启用”。".into());
    }
    let mut child = command(&python(&environment))
        .arg("-I").arg(script(cache)?)
        .current_dir(cache)
        .spawn()
        .map_err(|_| "无法启动 Research 环境")?;
    let _tree = ProcessTree::attach(child.id().ok_or("子进程未启动")?)?;
    child
        .stdin
        .take()
        .ok_or("启动输入不可用")?
        .write_all(b"{\"action\":\"check\"}\n")
        .await
        .map_err(|_| "环境检测失败")?;
    let output = tokio::time::timeout(Duration::from_secs(45), child.wait_with_output())
        .await
        .map_err(|_| "环境检测超时")?
        .map_err(|_| "环境检测失败")?;
    if !output.status.success() || !output.stdout.windows(7).any(|v| v == b"\"ready\"") {
        return Err("研究组件不完整或版本不匹配，请重新安装组件。".into());
    }
    Ok(())
}
pub async fn run(
    cache: &Path,
    id: &str,
    mut payload: Value,
    seconds: u64,
    cancel: &mut oneshot::Receiver<()>,
    mut event: impl FnMut(Value) -> Result<(), String>,
) -> Result<Value, String> {
    if cancel.try_recv().is_ok() { return Err("已取消研究".into()); }
    std::fs::create_dir_all(cache).map_err(|_| "Research 缓存目录不可写")?;
    // Host owns cleanup even when cancellation kills Python before its finally block.
    let temporary = tempfile::tempdir_in(cache).map_err(|_| "无法准备临时资料目录")?;
    payload["temporary_parent"] = serde_json::json!(temporary.path());
    let mut child = command(&python(&environment(cache)))
        .arg("-I").arg(script(cache)?)
        .current_dir(cache)
        .env("PYTHONUTF8", "1")
        .env("NO_PROXY", "localhost,127.0.0.1")
        .spawn()
        .map_err(|_| "Research 未能启动，请先检测运行环境")?;
    let tree = Arc::new(ProcessTree::attach(
        child.id().ok_or("Research 进程不可用")?,
    )?);
    if let Ok(mut c) = control().lock() {
        if let Some(active) = c.active.as_mut().filter(|r| r.id == id) {
            active.tree = Some(tree.clone());
        }
    }
    let mut input = serde_json::to_vec(&payload).map_err(|_| "研究请求无效")?;
    input.push(b'\n');
    child
        .stdin
        .take()
        .ok_or("研究请求通道不可用")?
        .write_all(&input)
        .await
        .map_err(|_| "研究请求未发送")?;
    drop(input);
    drop(payload);
    let mut reader = BufReader::new(child.stdout.take().ok_or("研究输出通道不可用")?);
    let mut buffer = Vec::new();
    let deadline = tokio::time::sleep(Duration::from_secs(seconds));
    tokio::pin!(deadline);
    let result = async {
        let mut result = None;
        loop {
            let line = tokio::select! {
                _ = &mut *cancel => return Err("已取消研究，已保存此前的任务进度".to_string()),
                _ = &mut deadline => return Err("研究达到时间上限，已停止；可缩小范围后重试".to_string()),
                line = read_line(&mut reader, &mut buffer) => line?,
            };
            let Some(line) = line else { break; };
            let value: Value = serde_json::from_slice(&line).map_err(|_| "Research 输出格式不兼容")?;
            match value["type"].as_str() {
                Some("result") => result = Some(value),
                Some("error") => return Err(error_message(value["code"].as_str().unwrap_or("unknown")).into()),
                Some("progress" | "report_delta" | "report_snapshot") => event(value)?,
                _ => {},
            }
        }
        let status = tokio::select! { _ = &mut *cancel => return Err("已取消研究".into()), _ = &mut deadline => return Err("研究达到时间上限".into()), s = child.wait() => s.map_err(|_| "Research 进程异常退出")? };
        if !status.success() { return Err("Research 进程异常退出，请检查模型和检索配置后重试".into()); }
        result.ok_or_else(|| "Research 没有返回报告".into())
    }.await;
    if result.is_err() {
        let _ = child.kill().await;
    }
    if let Ok(mut c) = control().lock() {
        if let Some(active) = c.active.as_mut().filter(|r| r.id == id) {
            active.tree = None;
        }
    }
    drop(tree);
    result
}
fn error_message(code: &str) -> &'static str {
    match code {
        "AuthenticationError" | "provider_auth" => "模型认证失败，请检查所选模型的 API Key",
        "provider_quota" => "所选模型余额或额度不足，请在模型服务商处处理，或选择其他模型",
        "provider_rate" => "所选模型服务暂时限流，请稍后重试",
        "RateLimitError" => "模型额度不足或请求受限，请检查额度后重试",
        "TimeoutError" | "APITimeoutError" => "模型或检索请求超时，请稍后重试",
        "APIConnectionError" => "无法连接模型服务，请检查地址与网络",
        "no_sources" => "没有取得可用来源，请调整检索词或选择本地资料",
        "version_mismatch" | "PackageNotFoundError" | "ModuleNotFoundError" => {
            "研究组件不完整或版本不匹配，请重新安装组件"
        }
        "GraphRecursionError" => "研究已达到本次执行上限，已保留部分回答；可继续追问",
        "unsupported_protocol" => "当前 Research 支持 OpenAI 兼容模型接口，请选择兼容配置",
        _ => "研究未完成，请检查所选模型的连接后重试",
    }
}
