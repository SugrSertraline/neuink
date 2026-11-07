use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct GateError {
    pub code: String,
    pub request_id: String,
    pub source: String,
    pub phase: String,
    pub attempts_started: u32,
    pub http_status: Option<u16>,
    pub retry_after_seconds: Option<u64>,
    pub cooldown_until: Option<String>,
}
impl GateError {
    pub fn new(code: &str) -> Self {
        Self {
            code: code.into(),
            request_id: String::new(),
            source: String::new(),
            phase: "request".into(),
            attempts_started: 0,
            http_status: None,
            retry_after_seconds: None,
            cooldown_until: None,
        }
    }
    pub fn message(&self) -> String {
        match self.code.as_str() {
            "rate_limited" | "cooldown" => {
                let seconds = self.retry_after_seconds.unwrap_or(300);
                format!(
                    "arXiv 暂时限制了请求，约 {} 分 {} 秒后可重试；到期不保证网站已恢复。",
                    seconds / 60,
                    seconds % 60
                )
            }
            "queue_timeout" => "arXiv 排队超时，本次未获得发送机会。".into(),
            "queue_full" => "arXiv 等待请求过多，本次未入队。".into(),
            "total_timeout" => "arXiv 检索总时间已用完。".into(),
            "request_timeout" => "arXiv 单次请求超时，允许的一次重试已结束。".into(),
            "cancelled" => "arXiv 请求已取消。".into(),
            "state_storage_error" => "arXiv 冷却状态无法读取或保存，本次检索已停止。".into(),
            _ => format!(
                "arXiv 请求未完成（{}）{}。",
                self.code,
                self.http_status
                    .map(|s| format!(" HTTP {s}"))
                    .unwrap_or_default()
            ),
        }
    }
    // Compatibility wrappers carry only this host-produced JSON, never remote errors.
    pub fn wire(&self) -> String {
        serde_json::to_string(&serde_json::json!({"arxiv_gate":self}))
            .unwrap_or_else(|_| "arXiv 状态编码失败".into())
    }
}
pub fn from_wire(value: &str) -> Option<GateError> {
    if value.len() > 8192 {
        return None;
    }
    serde_json::from_str::<serde_json::Value>(value)
        .ok()?
        .get("arxiv_gate")
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
}
impl From<&str> for GateError {
    fn from(code: &str) -> Self {
        Self::new(code)
    }
}
impl std::fmt::Display for GateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message())
    }
}

pub fn retry_seconds(value: Option<&str>, now: chrono::DateTime<chrono::Utc>) -> u64 {
    let seconds = value
        .and_then(|s| {
            s.trim().parse::<i64>().ok().or_else(|| {
                chrono::DateTime::parse_from_rfc2822(s)
                    .ok()
                    .map(|at| (at.with_timezone(&chrono::Utc) - now).num_seconds())
            })
        })
        .unwrap_or(300);
    seconds.clamp(60, 86400) as u64
}
