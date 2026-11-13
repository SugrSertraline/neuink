use serde_json::Value;

#[derive(Debug)]
pub struct SyncFailure {
    pub status: Option<u16>,
    pub code: Option<String>,
    pub message: String,
}
impl From<String> for SyncFailure {
    fn from(message: String) -> Self {
        Self {
            status: None,
            code: None,
            message,
        }
    }
}
impl From<&str> for SyncFailure {
    fn from(message: &str) -> Self {
        message.to_owned().into()
    }
}
impl SyncFailure {
    pub fn is_revision_conflict(&self) -> bool {
        self.status == Some(409) && self.code.as_deref() == Some("revision_conflict")
    }
    pub(crate) fn http(status: u16, body: &[u8]) -> Self {
        let code = serde_json::from_slice::<Value>(body)
            .ok()
            .and_then(|v| v["error"].as_str().map(str::to_owned))
            .filter(|v| {
                !v.is_empty()
                    && v.len() <= 64
                    && v.bytes().all(|c| c.is_ascii_lowercase() || c == b'_')
            });
        let message = match (status, code.as_deref()) {
            (400, Some("invitation_required" | "invalid_invite")) => "此服务器要求邀请码，请联系管理员开通账号",
            (400, Some("invitation_invalid")) => "邀请码无效、已使用或已过期",
            (400, Some("invalid_username")) => "用户名需为 3–64 位英文字母、数字或 . _ @ -",
            (400, Some("password_length")) => "密码至少 12 个字符，且不能超过 1024 字节",
            (409, Some("library_migration_required")) => "账号存在旧版多个云端资料库，原资料及绑定已保留，请先核对迁移，不能自动合并",
            (409, Some("username_taken")) => "用户名已被使用，请换一个或直接登录",
            (409, Some("registration_full")) => "注册名额已满，请联系管理员；已有账号仍可登录",
            (409, Some("attachment_not_ready")) => "附件尚未上传完成，请先完成附件传输",
            (409, Some("rebaseline_required")) => "服务器恢复代际已变化，请重新核对同步基线",
            (409, Some("cursor_expired")) => "设备离线较久，增量记录已过期，请重新核对云端内容",
            (409, Some("snapshot_changed" | "cleanup_preview_changed")) => "云端内容已变化，请重新读取预览",
            (409, Some("operation_reused")) => "同步操作标识被重复使用，已保留待同步记录",
            (409, Some("offset_mismatch")) => "上传偏移已改变，请查询进度后继续",
            (409, _) => "内容版本冲突，需要重新核对",
            (401, _) => "登录已失效或账号密码不正确",
            (403, _) => "当前账号没有权限",
            (404, _) => "资料或接口不存在",
            (429, _) => "请求过于频繁，请稍后重试",
            (507, _) => "服务器存储空间或账号配额不足",
            (413, _) => "同步内容超过服务器允许的大小",
            (400, _) => "提交内容不符合要求，请检查输入",
            _ => "服务器暂时无法完成请求",
        };
        Self {
            status: Some(status),
            code,
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_revision_conflicts_allow_download_reconciliation() {
        assert!(SyncFailure::http(409, br#"{"error":"revision_conflict"}"#).is_revision_conflict());
        for code in [
            "attachment_not_ready",
            "rebaseline_required",
            "operation_reused",
            "offset_mismatch",
        ] {
            assert!(
                !SyncFailure::http(409, format!(r#"{{"error":"{code}"}}"#).as_bytes())
                    .is_revision_conflict()
            );
        }
        assert!(!SyncFailure::http(500, br#"{"error":"revision_conflict"}"#).is_revision_conflict());
        assert!(!SyncFailure::http(409, b"not JSON").is_revision_conflict());
    }
    #[test]
    fn server_content_is_not_echoed_in_user_messages() {
        let error = SyncFailure::http(500, br#"{"error":"private document contents"}"#);
        assert!(error.code.is_none());
        assert!(!error.message.contains("private"));
    }
}
