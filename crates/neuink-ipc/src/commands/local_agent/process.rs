use serde_json::Value;
use tokio::io::{AsyncBufRead, AsyncBufReadExt};

pub const MAX_LINE: usize = 1024 * 1024;

/// Match Windows job cleanup with a dedicated process group on Unix.
#[cfg(unix)]
pub struct ProcessTree(i32);
#[cfg(unix)]
impl ProcessTree {
    pub fn attach(pid: u32) -> Result<Self, String> {
        let pid = i32::try_from(pid).map_err(|_| "无法管理 Claude Code 子进程。")?;
        if pid <= 0 {
            return Err("无法管理 Claude Code 子进程。".into());
        }
        Ok(Self(pid))
    }
}
#[cfg(unix)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            libc::kill(-self.0, libc::SIGKILL);
        }
    }
}

/// Bound allocations before reading: a broken CLI must not exhaust desktop memory.
pub async fn read_line(
    reader: &mut (impl AsyncBufRead + Unpin),
    line: &mut Vec<u8>,
) -> Result<Option<Vec<u8>>, String> {
    loop {
        let buf = reader
            .fill_buf()
            .await
            .map_err(|_| "无法读取 Claude Code 输出。")?;
        if buf.is_empty() {
            return Ok((!line.is_empty()).then(|| std::mem::take(line)));
        }
        let count = buf
            .iter()
            .position(|b| *b == b'\n')
            .map_or(buf.len(), |n| n + 1);
        if line.len() + count > MAX_LINE {
            return Err("Claude Code 输出超过单条消息限制。".into());
        }
        let end = buf[count - 1] == b'\n';
        line.extend_from_slice(&buf[..count]);
        reader.consume(count);
        if end {
            return Ok(Some(std::mem::take(line)));
        }
    }
}

pub fn merge_loopback_no_proxy(
    existing_upper: Option<&str>,
    existing_lower: Option<&str>,
) -> String {
    let mut entries: Vec<String> = Vec::new();
    for source in [existing_upper, existing_lower].into_iter().flatten() {
        for item in source.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            if !entries.iter().any(|seen| seen.eq_ignore_ascii_case(item)) {
                entries.push(item.to_string());
            }
        }
    }
    for host in ["127.0.0.1", "localhost", "::1"] {
        if !entries.iter().any(|seen| seen.eq_ignore_ascii_case(host)) {
            entries.push(host.to_string());
        }
    }
    entries.join(",")
}

/// Ensure local agent processes bypass system/HTTP proxies when calling
/// NeuInk's loopback MCP bridge (`http://127.0.0.1:<port>/mcp`), while keeping
/// user proxy settings intact for upstream model APIs.
pub fn apply_loopback_no_proxy(command: &mut tokio::process::Command) {
    let upper = std::env::var("NO_PROXY").ok();
    let lower = std::env::var("no_proxy").ok();
    let merged = merge_loopback_no_proxy(upper.as_deref(), lower.as_deref());
    command.env("NO_PROXY", &merged).env("no_proxy", &merged);
}

pub fn result_error(value: &Value) -> Option<String> {
    if value["is_error"] != true && value["subtype"].as_str() == Some("success") {
        return None;
    }
    let diagnostic = value.to_string().to_lowercase();
    let message = if diagnostic.contains("auth")
        || diagnostic.contains("login")
        || diagnostic.contains("api key")
        || diagnostic.contains("401")
    {
        "Claude Code 认证失败，请先在 Claude Code 中完成认证后重试。"
    } else if diagnostic.contains("rate_limit") || diagnostic.contains("429") {
        "Claude Code 请求额度不足或被限流，请稍后重试。"
    } else if diagnostic.contains("max_turns") {
        "Claude Code 已达到本次任务的执行步数上限，请缩小任务范围。"
    } else {
        "Claude Code 未完成本次任务，请检查本地配置后重试。"
    };
    Some(message.into())
}

/// A Windows job is owned for the whole run; dropping it terminates child tools too.
#[cfg(windows)]
pub struct ProcessTree(usize);
#[cfg(windows)]
impl ProcessTree {
    pub fn attach(pid: u32) -> Result<Self, String> {
        use windows::Win32::{
            Foundation::CloseHandle,
            System::{JobObjects::*, Threading::*},
        };
        unsafe {
            let job = CreateJobObjectW(None, None).map_err(|_| "无法管理 NeuInk 子进程。")?;
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            )
            .is_err()
            {
                let _ = CloseHandle(job);
                return Err("无法管理 NeuInk 子进程。".into());
            }
            let process = match OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) {
                Ok(p) => p,
                Err(_) => {
                    let _ = CloseHandle(job);
                    return Err("无法管理 NeuInk 子进程。".into());
                }
            };
            let assigned = AssignProcessToJobObject(job, process);
            let _ = CloseHandle(process);
            if assigned.is_err() {
                let _ = CloseHandle(job);
                return Err("无法管理 NeuInk 子进程。".into());
            }
            Ok(Self(job.0 as usize))
        }
    }
}
#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(windows::Win32::Foundation::HANDLE(
                self.0 as *mut _,
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn bounds_lines_and_accepts_final_line_without_newline() {
        let mut input = tokio::io::BufReader::new(&b"one\ntwo"[..]);
        let mut line = Vec::new();
        assert_eq!(
            read_line(&mut input, &mut line).await.unwrap().unwrap(),
            b"one\n"
        );
        assert_eq!(
            read_line(&mut input, &mut line).await.unwrap().unwrap(),
            b"two"
        );
        assert!(read_line(&mut input, &mut line).await.unwrap().is_none());
        let bytes = vec![b'x'; MAX_LINE + 1];
        assert!(
            read_line(&mut tokio::io::BufReader::new(&bytes[..]), &mut line)
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn concurrent_mcp_events_do_not_discard_partial_stdout_lines() {
        use tokio::io::AsyncWriteExt;
        let (mut writer, reader) = tokio::io::duplex(32);
        let mut reader = tokio::io::BufReader::new(reader);
        let mut line = Vec::new();
        writer.write_all(b"par").await.unwrap();
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(10),
            read_line(&mut reader, &mut line)
        )
        .await
        .is_err());
        writer.write_all(b"tial\n").await.unwrap();
        assert_eq!(
            read_line(&mut reader, &mut line).await.unwrap().unwrap(),
            b"partial\n"
        );
    }
    #[test]
    fn merge_loopback_no_proxy_preserves_existing_and_deduplicates_loopback() {
        assert_eq!(merge_loopback_no_proxy(None, None), "127.0.0.1,localhost,::1");
        assert_eq!(
            merge_loopback_no_proxy(Some("internal.corp, LOCALHOST "), Some("127.0.0.1, .local")),
            "internal.corp,LOCALHOST,127.0.0.1,.local,::1"
        );
    }

    #[test]
    fn errors_do_not_leak_credentials_or_paths() {
        let value = serde_json::json!({"is_error":true,"result":"401 API key secret-private-path"});
        let error = result_error(&value).unwrap();
        assert!(error.contains("认证"));
        assert!(!error.contains("secret"));
        assert!(result_error(&serde_json::json!({"subtype":"success","is_error":false})).is_none());
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn dropping_job_terminates_native_tool_descendants() {
        use std::{process::Stdio, time::Duration};
        use tokio::{io::AsyncWriteExt, process::Command};
        use windows::Win32::{
            Foundation::{CloseHandle, WAIT_OBJECT_0},
            System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
        };
        let system_root = std::env::var_os("SystemRoot").unwrap();
        let powershell = std::path::PathBuf::from(system_root)
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let mut child = Command::new(powershell)
            .args(["-NoProfile","-NonInteractive","-Command","[Console]::ReadLine() | Out-Null; $agentTestChild = Start-Process -FilePath \"$env:SystemRoot\\System32\\ping.exe\" -ArgumentList '-n 60 127.0.0.1' -WindowStyle Hidden -PassThru; [Console]::WriteLine($agentTestChild.Id); Start-Sleep -Seconds 60"])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).creation_flags(0x08000000).kill_on_drop(true).spawn().unwrap();
        let job = ProcessTree::attach(child.id().unwrap()).unwrap();
        child
            .stdin
            .as_mut()
            .unwrap()
            .write_all(b"start\n")
            .await
            .unwrap();
        let mut reader = tokio::io::BufReader::new(child.stdout.take().unwrap());
        let line = tokio::time::timeout(
            Duration::from_secs(10),
            read_line(&mut reader, &mut Vec::new()),
        )
        .await
        .unwrap()
        .unwrap()
        .unwrap();
        let pid: u32 = String::from_utf8(line).unwrap().trim().parse().unwrap();
        let descendant = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid).unwrap() };
        drop(job);
        tokio::time::timeout(Duration::from_secs(5), child.wait())
            .await
            .unwrap()
            .unwrap();
        unsafe {
            let status = WaitForSingleObject(descendant, 5000);
            let _ = CloseHandle(descendant);
            assert_eq!(
                status, WAIT_OBJECT_0,
                "Native tool children must not survive cancellation"
            );
        }
    }
}
