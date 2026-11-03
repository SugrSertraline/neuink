use super::*;
use crate::translation_log::{self, Details, Stage};

#[cfg(test)]
mod tests;

impl LlmClient {
    pub(super) async fn generate_text(&self, system: &str, prompt: &str) -> Result<String, String> {
        let started = Instant::now();
        let stream = self.generate_text_streaming(system, prompt).await;
        if let Err(error) = &stream {
            translation_log::best_effort(
                &self.profile,
                Stage::Stream,
                &error.to_string(),
                Details {
                    elapsed_ms: started.elapsed().as_millis() as u64,
                    input_chars: Some(system.chars().count() + prompt.chars().count()),
                    ..Details::default()
                },
            );
        }
        match stream {
            Ok(text) => Ok(text),
            Err(RequestError::RateLimited) => Err(RequestError::RateLimited.to_string()),
            Err(RequestError::Other(error)) if response::terminal(&error) => Err(error),
            Err(stream_error) => {
                let started = Instant::now();
                self.generate_text_once(system, prompt)
                    .await
                    .map_err(|error| {
                        translation_log::best_effort(
                            &self.profile,
                            Stage::NonStreaming,
                            &error.to_string(),
                            Details {
                                elapsed_ms: started.elapsed().as_millis() as u64,
                                input_chars: Some(system.chars().count() + prompt.chars().count()),
                                ..Details::default()
                            },
                        );
                        match error {
                            RequestError::RateLimited => error.to_string(),
                            _ => format!("{error}（流式回退前错误：{stream_error}）"),
                        }
                    })
            }
        }
    }

    async fn generate_text_once(&self, system: &str, prompt: &str) -> Result<String, RequestError> {
        let (url, headers, body) = crate::commands::llm_http::build_chat_request(
            &self.profile,
            system,
            prompt,
            crate::commands::llm_http::ChatFallbacks {
                max_tokens: (self.profile.api_protocol == neuink_config::LlmApiProtocol::Anthropic)
                    .then_some(4_096),
                temperature: None,
                top_p: None,
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
            let body = match timeout(timeout_duration, response.text()).await {
                Ok(Ok(body)) => body,
                Ok(Err(error)) => return Err(error.without_url().to_string().into()),
                Err(_) => {
                    last_timeout_error = format!(
                        "LLM response body timed out after {} seconds.",
                        timeout_duration.as_secs()
                    );
                    continue;
                }
            };
            if !status.is_success() {
                let error = format!("LLM request failed ({status})");
                let mut details = translation_log::response_details(&body);
                details.http_status = Some(status.as_u16());
                details.attempt = Some(attempt + 1);
                translation_log::best_effort(&self.profile, Stage::NonStreaming, &error, details);
                return Err(error.into());
            }
            let text = response::parse(self.profile.api_protocol, &body).inspect_err(|error| {
                translation_log::best_effort(
                    &self.profile,
                    Stage::NonStreaming,
                    error,
                    translation_log::response_details(&body),
                );
            })?;
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

    /// SSE 流式接收一次 LLM 调用。空闲与整体生成时间都有上限；
    /// 超时后由上层尝试非流式请求，不能因心跳或推理流无限等待。
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
                max_tokens: (self.profile.api_protocol == neuink_config::LlmApiProtocol::Anthropic)
                    .then_some(4_096),
                temperature: None,
                top_p: None,
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
                let error = format!("LLM request failed ({status})");
                let mut details = translation_log::response_details(&body);
                details.http_status = Some(status.as_u16());
                details.attempt = Some(attempt + 1);
                translation_log::best_effort(&self.profile, Stage::Stream, &error, details);
                return Err(error.into());
            }

            let mut stream = response.bytes_stream();
            let mut accumulated = String::new();
            let mut line_buffer = Vec::new();
            let mut raw_body = Vec::new();
            let mut saw_sse_data = false;
            let mut saw_reasoning = false;
            let mut received_chars = 0usize;
            let response_deadline = Instant::now() + STREAM_RESPONSE_TIMEOUT;
            loop {
                let remaining = response_deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(RequestError::Timeout);
                }
                let chunk = match timeout(
                    idle_timeout.min(remaining),
                    tokio_stream::StreamExt::next(&mut stream),
                )
                .await
                {
                    Ok(chunk) => chunk,
                    Err(_) => {
                        if Instant::now() >= response_deadline {
                            return Err(RequestError::Timeout);
                        }
                        // 没收到正文就转为非流式请求；已有部分输出也不能无限等待。
                        if received_chars == 0 {
                            return Err(RequestError::Timeout);
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
                        response::append(
                            self.profile.api_protocol,
                            data,
                            &mut accumulated,
                            &mut saw_reasoning,
                        )?;
                    }
                }
                if let Some(output) = &self.output {
                    output(&accumulated);
                }
                if let Some(progress) = &self.progress {
                    // Count decoded model output, not UTF-8 bytes or SSE envelopes.
                    progress(accumulated.chars().count());
                }
            }
            // Flush an unterminated final SSE line exactly once, after EOF.
            let tail = std::str::from_utf8(&line_buffer).map_err(|error| error.to_string())?;
            if let Some(data) = tail.trim().strip_prefix("data:") {
                saw_sse_data = true;
                response::append(
                    self.profile.api_protocol,
                    data,
                    &mut accumulated,
                    &mut saw_reasoning,
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
                let text = response::parse(self.profile.api_protocol, body.trim()).inspect_err(
                    |error| {
                        translation_log::best_effort(
                            &self.profile,
                            Stage::Stream,
                            error,
                            translation_log::response_details(body),
                        );
                    },
                )?;
                if let Some(output) = &self.output {
                    output(&text);
                }
                return Ok(text);
            }
            if !last_timeout_error.is_empty() {
                continue;
            }
            if saw_reasoning {
                return Err(response::REASONING_ONLY.to_string().into());
            }
            return Err("LLM stream ended without content.".to_string().into());
        }
        Err(format!(
            "LLM streaming timed out {LLM_REQUEST_MAX_ATTEMPTS} times: {last_timeout_error}"
        )
        .into())
    }
}
