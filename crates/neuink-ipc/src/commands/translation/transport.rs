use super::*;

#[cfg(test)]
mod tests;

impl LlmClient {
    pub(super) async fn generate_text(&self, system: &str, prompt: &str) -> Result<String, String> {
        match self.generate_text_streaming(system, prompt).await {
            Ok(text) => Ok(text),
            Err(RequestError::RateLimited) => Err(RequestError::RateLimited.to_string()),
            Err(stream_error) => self
                .generate_text_once(system, prompt)
                .await
                .map_err(|error| match error {
                    RequestError::RateLimited => error.to_string(),
                    _ => format!("{error}（流式回退前错误：{stream_error}）"),
                }),
        }
    }

    async fn generate_text_once(&self, system: &str, prompt: &str) -> Result<String, RequestError> {
        let (url, headers, body) = crate::commands::llm_http::build_chat_request(
            &self.profile,
            system,
            prompt,
            crate::commands::llm_http::ChatFallbacks {
                max_tokens: Some(8_192),
                temperature: Some(0.2),
                top_p: Some(1.0),
            },
        )?;
        // 超时最多重试 3 次并逐步放宽；429 在共享请求入口等待重试，耗尽后不切换传输方式。
        let mut last_timeout_error = String::new();
        for attempt in 0..LLM_REQUEST_MAX_ATTEMPTS {
            if let Some(output) = &self.output {
                output("");
            }
            let timeout_duration = request_timeout_for_attempt(attempt);
            let (response, _slot) = match self
                .send_translation_request(&url, &headers, &body, timeout_duration)
                .await
            {
                Ok(response) => response,
                Err(RequestError::Timeout) => {
                    last_timeout_error = format!(
                        "LLM request timed out after {} seconds.",
                        timeout_duration.as_secs()
                    );
                    continue;
                }
                Err(error) => return Err(error),
            };
            let status = response.status();
            let body = response.text().await.map_err(|error| error.to_string())?;
            if !status.is_success() {
                return Err(format!("LLM request failed ({status}): {body}").into());
            }
            let text =
                crate::commands::llm_http::parse_chat_response(self.profile.api_protocol, &body)?;
            if let Some(output) = &self.output {
                output(&text);
            }
            return Ok(text);
        }
        Err(format!(
            "LLM request timed out {LLM_REQUEST_MAX_ATTEMPTS} times (last limit {} seconds): {last_timeout_error}",
            request_timeout_for_attempt(LLM_REQUEST_MAX_ATTEMPTS - 1).as_secs(),
        ).into())
    }

    /// SSE 流式接收一次 LLM 调用。空闲超时（连续 {timeout} 秒收不到任何字节）
    /// 与整体超时同样触发递增重试；已收到部分内容后中断则直接报错，
    /// 由上层回退到非流式重试。
    async fn generate_text_streaming(
        &self,
        system: &str,
        prompt: &str,
    ) -> Result<String, RequestError> {
        let (url, headers, body) = crate::commands::llm_http::build_chat_stream_request(
            &self.profile,
            system,
            prompt,
            crate::commands::llm_http::ChatFallbacks {
                max_tokens: Some(8_192),
                temperature: Some(0.2),
                top_p: Some(1.0),
            },
        )?;

        let mut last_timeout_error = String::new();
        for attempt in 0..LLM_REQUEST_MAX_ATTEMPTS {
            if let Some(output) = &self.output {
                output("");
            }
            let idle_timeout = request_timeout_for_attempt(attempt);
            let (response, _slot) = match self
                .send_translation_request(&url, &headers, &body, idle_timeout)
                .await
            {
                Ok(response) => response,
                Err(RequestError::Timeout) => {
                    last_timeout_error = format!(
                        "LLM request timed out after {} seconds.",
                        idle_timeout.as_secs()
                    );
                    continue;
                }
                Err(error) => return Err(error),
            };
            let status = response.status();
            if !status.is_success() {
                let body = response.text().await.unwrap_or_default();
                return Err(format!("LLM request failed ({status}): {body}").into());
            }

            let mut stream = response.bytes_stream();
            let mut accumulated = String::new();
            let mut line_buffer = Vec::new();
            let mut raw_body = Vec::new();
            let mut saw_sse_data = false;
            let mut received_chars = 0usize;
            loop {
                let chunk =
                    match timeout(idle_timeout, tokio_stream::StreamExt::next(&mut stream)).await {
                        Ok(chunk) => chunk,
                        Err(_) => {
                            // 空闲超时：还没收到任何内容就升级超时重试；已有内容则报错，
                            // 让上层用非流式路径重新完整请求。
                            if received_chars == 0 {
                                last_timeout_error = format!(
                                    "LLM stream idle after {} seconds.",
                                    idle_timeout.as_secs()
                                );
                                break;
                            }
                            return Err(format!(
                                "LLM stream stalled after {received_timeout} seconds of silence.",
                                received_timeout = idle_timeout.as_secs()
                            )
                            .into());
                        }
                    };
                let Some(chunk) = chunk else {
                    break;
                };
                let chunk = chunk.map_err(|error| error.to_string())?;
                received_chars += chunk.len();
                raw_body.extend_from_slice(&chunk);
                line_buffer.extend_from_slice(&chunk);
                // Decode only complete SSE lines; UTF-8 codepoints may span network chunks.
                while let Some(newline) = line_buffer.iter().position(|byte| *byte == b'\n') {
                    let bytes: Vec<_> = line_buffer.drain(..=newline).collect();
                    let line = std::str::from_utf8(&bytes).map_err(|error| error.to_string())?;
                    if let Some(data) = line.trim_end().strip_prefix("data:") {
                        saw_sse_data = true;
                        crate::commands::llm_http::append_chat_stream_delta(
                            self.profile.api_protocol,
                            data,
                            &mut accumulated,
                        )?;
                    }
                }
                if let Some(output) = &self.output {
                    output(&accumulated);
                }
                if let Some(progress) = &self.progress {
                    progress(received_chars);
                }
            }
            // Flush an unterminated final SSE line exactly once, after EOF.
            let tail = std::str::from_utf8(&line_buffer).map_err(|error| error.to_string())?;
            if let Some(data) = tail.trim().strip_prefix("data:") {
                saw_sse_data = true;
                crate::commands::llm_http::append_chat_stream_delta(
                    self.profile.api_protocol,
                    data,
                    &mut accumulated,
                )?;
                if let Some(output) = &self.output {
                    output(&accumulated);
                }
            }

            if !last_timeout_error.is_empty() && received_chars == 0 && accumulated.is_empty() {
                continue;
            }
            let trimmed = accumulated.trim().to_string();
            if !trimmed.is_empty() {
                return Ok(trimmed);
            }
            // 服务端忽略了 stream 参数、直接返回了完整的普通 JSON 响应：
            // 就地解析，避免非流式路径再完整请求一遍（否则每次调用耗时翻倍）。
            if !saw_sse_data && !raw_body.is_empty() {
                let body = std::str::from_utf8(&raw_body).map_err(|error| error.to_string())?;
                let text = crate::commands::llm_http::parse_chat_response(
                    self.profile.api_protocol,
                    body.trim(),
                )?;
                if let Some(output) = &self.output {
                    output(&text);
                }
                return Ok(text);
            }
            if !last_timeout_error.is_empty() {
                continue;
            }
            return Err("LLM stream ended without content.".to_string().into());
        }
        Err(format!(
            "LLM streaming timed out {LLM_REQUEST_MAX_ATTEMPTS} times: {last_timeout_error}"
        )
        .into())
    }
}
