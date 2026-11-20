//! Account-scoped parsing transport. The caller must persist request_id before
//! submitting so a lost response can be retried without creating another task.
use crate::SyncClient;
use reqwest::Method;
use serde_json::{json, Value};

fn valid_id(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

impl SyncClient {
    pub async fn submit_parse_task(&self, token: &str, blob_hash: &str, request_id: &str) -> Result<Value, String> {
        if !valid_id(blob_hash) || !valid_id(request_id) {
            return Err("解析任务标识无效".into());
        }
        self.request(Method::POST, "/v1/parse/tasks", Some(token), Some(&json!({
            "blob_hash": blob_hash, "request_id": request_id
        }))).await
    }

    pub async fn parse_task_status(&self, token: &str, id: &str) -> Result<Value, String> {
        if !valid_id(id) { return Err("解析任务标识无效".into()); }
        self.request(Method::GET, &format!("/v1/parse/tasks/{id}"), Some(token), None).await
    }

    pub async fn cancel_parse_task(&self, token: &str, id: &str) -> Result<Value, String> {
        if !valid_id(id) { return Err("解析任务标识无效".into()); }
        self.request(Method::DELETE, &format!("/v1/parse/tasks/{id}"), Some(token), None).await
    }

    pub async fn parse_task_result(&self, token: &str, id: &str) -> Result<Vec<u8>, String> {
        const MAX_RESULT: usize = 256 * 1024 * 1024;
        if !valid_id(id) { return Err("解析任务标识无效".into()); }
        let url = self.base.join(&format!("/v1/parse/tasks/{id}/result")).map_err(|_| "解析结果地址无效")?;
        let mut response = self.client.get(url).bearer_auth(token).send().await.map_err(|_| "读取解析结果失败")?;
        if !response.status().is_success() { return Err(format!("读取解析结果失败（HTTP {}）", response.status().as_u16())); }
        if response.content_length().is_some_and(|size| size > MAX_RESULT as u64) { return Err("解析结果超过大小限制".into()); }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "读取解析结果失败")? {
            if chunk.len() > MAX_RESULT.saturating_sub(bytes.len()) { return Err("解析结果超过大小限制".into()); }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::valid_id;

    #[test]
    fn rejects_invalid_identifiers_before_building_urls() {
        assert!(valid_id(&"a1".repeat(32)));
        assert!(!valid_id("../tasks"));
        assert!(!valid_id(&"A".repeat(64)));
        assert!(!valid_id(&"a".repeat(63)));
    }
}
