//! Own the local encoder while its model loads, before it opens a listening port.

use std::process::{Child, Command};
use std::sync::{Mutex, OnceLock};

static PROCESS: OnceLock<Mutex<ManagedProcess>> = OnceLock::new();

#[derive(Default)]
struct ManagedProcess {
    child: Option<Child>,
}

impl ManagedProcess {
    fn start(&mut self, command: &mut Command) -> Result<u32, String> {
        if let Some(child) = self.child.as_mut() {
            match child
                .try_wait()
                .map_err(|_| "无法检查视觉服务进程状态".to_string())?
            {
                None => return Ok(child.id()),
                Some(_) => self.child = None,
            }
        }
        let child = command
            .spawn()
            .map_err(|_| "无法启动视觉服务".to_string())?;
        let pid = child.id();
        self.child = Some(child);
        Ok(pid)
    }
}

impl Drop for ManagedProcess {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub(super) fn start(command: &mut Command) -> Result<u32, String> {
    PROCESS
        .get_or_init(|| Mutex::new(ManagedProcess::default()))
        .lock()
        .map_err(|_| "视觉服务进程状态不可用".to_string())?
        .start(command)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Stdio;

    fn child_command() -> Command {
        let mut command = Command::new(std::env::current_exe().expect("test executable"));
        command
            .args([
                "--exact",
                "commands::search::visual_process::tests::loading_child",
            ])
            .env("NEUINK_VISUAL_PROCESS_TEST_CHILD", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        command
    }

    #[test]
    fn loading_child() {
        if std::env::var_os("NEUINK_VISUAL_PROCESS_TEST_CHILD").is_some() {
            std::thread::sleep(std::time::Duration::from_secs(30));
        }
    }

    #[test]
    fn retries_reuse_loading_process_before_port_is_bound() {
        let mut process = ManagedProcess::default();
        let first = process
            .start(&mut child_command())
            .expect("start loading child");
        // A retry after a caller's readiness timeout must not launch another model.
        let second = process
            .start(&mut child_command())
            .expect("retry loading child");
        assert_eq!(first, second);
        assert!(process
            .child
            .as_mut()
            .expect("owned child")
            .try_wait()
            .expect("status")
            .is_none());
    }

    #[test]
    fn exited_process_can_be_started_again() {
        let mut process = ManagedProcess::default();
        process.start(&mut child_command()).expect("start child");
        let child = process.child.as_mut().expect("owned child");
        child.kill().expect("stop child");
        child.wait().expect("reap child");
        process.start(&mut child_command()).expect("restart child");
        assert!(process
            .child
            .as_mut()
            .expect("replacement child")
            .try_wait()
            .expect("status")
            .is_none());
    }
}
