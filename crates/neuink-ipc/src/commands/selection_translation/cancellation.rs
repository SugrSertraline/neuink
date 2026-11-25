use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::sync::watch;

struct Entry {
    created: Instant,
    running: bool,
    stop: watch::Sender<bool>,
}
fn requests() -> &'static Mutex<HashMap<String, Entry>> {
    static VALUES: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    VALUES.get_or_init(Default::default)
}
fn valid(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}
fn prune(values: &mut HashMap<String, Entry>) {
    values.retain(|_, entry| entry.running || entry.created.elapsed() < Duration::from_secs(120));
}

pub(super) struct Request {
    id: String,
    stop: watch::Receiver<bool>,
}
impl Request {
    pub(super) fn register(id: String) -> Result<Self, String> {
        if !valid(&id) {
            return Err("翻译请求标识无效。".into());
        }
        let mut values = requests().lock().map_err(|_| "翻译请求状态不可用")?;
        prune(&mut values);
        if values.len() >= 512 {
            return Err("翻译请求过多，请稍后重试。".into());
        }
        let entry = values.entry(id.clone()).or_insert_with(|| Entry {
            created: Instant::now(),
            running: false,
            stop: watch::channel(false).0,
        });
        if entry.running {
            return Err("翻译请求已在执行。".into());
        }
        entry.running = true;
        Ok(Self {
            id,
            stop: entry.stop.subscribe(),
        })
    }
    pub(super) async fn run<T>(
        mut self,
        work: impl std::future::Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        tokio::select! {
            biased;
            _ = async { loop { if *self.stop.borrow_and_update() { break; } if self.stop.changed().await.is_err() { break; } } } => Err("翻译请求已取消。".into()),
            result = work => result,
        }
    }
}
impl Drop for Request {
    fn drop(&mut self) {
        if let Ok(mut values) = requests().lock() {
            values.remove(&self.id);
        }
    }
}

#[tauri::command]
pub fn cancel_service_translation(request_id: String) -> Result<(), String> {
    if !valid(&request_id) {
        return Err("翻译请求标识无效。".into());
    }
    let mut values = requests().lock().map_err(|_| "翻译请求状态不可用")?;
    prune(&mut values);
    if let Some(entry) = values.get(&request_id) {
        entry.stop.send_replace(true);
    } else if values.len() < 512 {
        // Cancellation may reach native IPC before the async translation command.
        values.insert(
            request_id,
            Entry {
                created: Instant::now(),
                running: false,
                stop: watch::channel(true).0,
            },
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn cancellation_before_start_prevents_work_and_releases_registration() {
        cancel_service_translation("service-cancel-before".into()).unwrap();
        let request = Request::register("service-cancel-before".into()).unwrap();
        let result: Result<(), _> = request.run(async { panic!("must not send") }).await;
        assert!(result.unwrap_err().contains("取消"));
        assert!(!requests()
            .lock()
            .unwrap()
            .contains_key("service-cancel-before"));
    }
    #[tokio::test]
    async fn cancellation_drops_an_inflight_request() {
        let request = Request::register("service-cancel-running".into()).unwrap();
        let task = tokio::spawn(request.run(std::future::pending::<Result<(), String>>()));
        cancel_service_translation("service-cancel-running".into()).unwrap();
        assert!(tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap()
            .is_err());
    }
}
