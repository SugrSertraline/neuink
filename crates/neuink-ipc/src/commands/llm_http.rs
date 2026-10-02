use neuink_config::{LlmApiProtocol, LlmProfile};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::Deserialize;
use serde_json::{json, Value};

const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Per-call-site fallbacks applied when the profile leaves a sampling field unset.
/// Each `None` means "omit the key entirely" for every protocol.
pub(crate) struct ChatFallbacks {
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
}

/// Builds the (url, headers, body) triple for a one-shot system+user chat request
/// following the profile's `api_protocol`.
pub(crate) fn build_chat_request(
    profile: &LlmProfile,
    system: &str,
    user: &str,
    fallbacks: ChatFallbacks,
) -> Result<(String, HeaderMap, Value), String> {
    let base = profile.base_url.trim().trim_end_matches('/');
    let api_key = profile
        .api_key
        .as_deref()
        .filter(|key| !key.trim().is_empty());
    let temperature = profile.temperature.or(fallbacks.temperature);
    let top_p = profile.top_p.or(fallbacks.top_p);
    let max_tokens = profile.max_output_tokens.or(fallbacks.max_tokens);

    match profile.api_protocol {
        LlmApiProtocol::Anthropic => {
            let url = if base.ends_with("/messages") {
                base.to_string()
            } else {
                format!("{base}/messages")
            };
            let mut headers = HeaderMap::new();
            if let Some(key) = api_key {
                headers.insert("x-api-key", header_value(key)?);
            }
            headers.insert(
                "anthropic-version",
                header_value(ANTHROPIC_VERSION).expect("static header value"),
            );
            let mut body = json!({
                "model": profile.model,
                // The Messages API rejects requests without max_tokens.
                "max_tokens": max_tokens.unwrap_or(1_024),
                "messages": [{"role": "user", "content": user}]
            });
            if !system.is_empty() {
                body["system"] = json!(system);
            }
            set_optional(&mut body, "temperature", temperature);
            set_optional(&mut body, "top_p", top_p);
            Ok((url, headers, body))
        }
        LlmApiProtocol::Google => {
            let url = if base.ends_with("/models") {
                format!("{base}/{}:generateContent", profile.model)
            } else {
                format!("{base}/models/{}:generateContent", profile.model)
            };
            let mut headers = HeaderMap::new();
            if let Some(key) = api_key {
                headers.insert("x-goog-api-key", header_value(key)?);
            }
            let mut body = json!({
                "contents": [{"role": "user", "parts": [{"text": user}]}]
            });
            if !system.is_empty() {
                body["systemInstruction"] = json!({"parts": [{"text": system}]});
            }
            let mut generation_config = json!({});
            set_optional(&mut generation_config, "temperature", temperature);
            set_optional(&mut generation_config, "topP", top_p);
            if let Some(value) = max_tokens {
                generation_config["maxOutputTokens"] = json!(value);
            }
            if generation_config
                .as_object()
                .is_some_and(|map| !map.is_empty())
            {
                body["generationConfig"] = generation_config;
            }
            Ok((url, headers, body))
        }
        LlmApiProtocol::OpenaiCompatible => {
            let url = if base.ends_with("/chat/completions") {
                base.to_string()
            } else {
                format!("{base}/chat/completions")
            };
            let mut headers = HeaderMap::new();
            if let Some(key) = api_key {
                let value = format!("Bearer {key}");
                headers.insert(AUTHORIZATION, header_value(&value)?);
            }
            let mut body = json!({
                "model": profile.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user}
                ]
            });
            set_optional(&mut body, "temperature", temperature);
            set_optional(&mut body, "top_p", top_p);
            set_optional_u32(&mut body, "max_tokens", max_tokens);
            Ok((url, headers, body))
        }
    }
}

/// Extracts the assistant text from a successful chat response body.
pub(crate) fn parse_chat_response(protocol: LlmApiProtocol, body: &str) -> Result<String, String> {
    let content = match protocol {
        LlmApiProtocol::OpenaiCompatible => {
            let payload: ChatCompletionResponse =
                serde_json::from_str(body).map_err(|error| error.to_string())?;
            payload
                .choices
                .into_iter()
                .find_map(|choice| choice.message.content)
                .unwrap_or_default()
        }
        LlmApiProtocol::Anthropic => {
            let payload: AnthropicResponse =
                serde_json::from_str(body).map_err(|error| error.to_string())?;
            payload
                .content
                .into_iter()
                .filter(|block| block.r#type.as_deref().map_or(true, |kind| kind == "text"))
                .filter_map(|block| block.text)
                .collect::<Vec<_>>()
                .join("\n")
        }
        LlmApiProtocol::Google => {
            let payload: GoogleResponse =
                serde_json::from_str(body).map_err(|error| error.to_string())?;
            payload
                .candidates
                .into_iter()
                .next()
                .and_then(|candidate| candidate.content)
                .and_then(|content| content.parts)
                .unwrap_or_default()
                .into_iter()
                .filter_map(|part| part.text)
                .collect::<Vec<_>>()
                .join("")
        }
    };
    let trimmed = content.trim().to_string();
    (!trimmed.is_empty()).then_some(trimmed).ok_or_else(|| {
        format!("LLM response did not contain message content (protocol {protocol:?}).")
    })
}

/// Streaming variant of [`build_chat_request`]: same body plus the protocol's
/// stream switch. Returns the SSE endpoint (Google needs a different URL).
pub(crate) fn build_chat_stream_request(
    profile: &LlmProfile,
    system: &str,
    user: &str,
    fallbacks: ChatFallbacks,
) -> Result<(String, HeaderMap, Value), String> {
    let (url, headers, mut body) = build_chat_request(profile, system, user, fallbacks)?;
    match profile.api_protocol {
        LlmApiProtocol::Google => {
            let url = url.trim_end_matches(":generateContent").to_string();
            Ok((
                format!("{url}:streamGenerateContent?alt=sse"),
                headers,
                body,
            ))
        }
        LlmApiProtocol::Anthropic | LlmApiProtocol::OpenaiCompatible => {
            body["stream"] = json!(true);
            Ok((url, headers, body))
        }
    }
}

/// Appends the text delta carried by one SSE `data:` payload to `acc`.
/// Unknown/keepalive events are ignored; malformed JSON returns Ok (the stream
/// may interleave non-message events we do not model).
pub(crate) fn append_chat_stream_delta(
    protocol: LlmApiProtocol,
    data: &str,
    acc: &mut String,
) -> Result<(), String> {
    let trimmed = data.trim();
    if trimmed.is_empty() || trimmed == "[DONE]" {
        return Ok(());
    }
    let value: Value = match serde_json::from_str(trimmed) {
        Ok(value) => value,
        Err(_) => return Ok(()),
    };
    match protocol {
        LlmApiProtocol::OpenaiCompatible => {
            if let Some(delta) = value
                .get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("delta"))
                .and_then(|delta| delta.get("content"))
                .and_then(Value::as_str)
            {
                acc.push_str(delta);
            }
        }
        LlmApiProtocol::Anthropic => {
            // event: content_block_delta → {"delta":{"type":"text_delta","text":"..."}}
            let is_text_delta = value
                .get("delta")
                .and_then(|delta| delta.get("type"))
                .and_then(Value::as_str)
                .is_some_and(|kind| kind == "text_delta")
                || value
                    .get("type")
                    .and_then(Value::as_str)
                    .is_some_and(|kind| kind == "content_block_delta");
            if is_text_delta {
                if let Some(text) = value
                    .get("delta")
                    .and_then(|delta| delta.get("text"))
                    .and_then(Value::as_str)
                {
                    acc.push_str(text);
                }
            }
        }
        LlmApiProtocol::Google => {
            if let Some(parts) = value
                .get("candidates")
                .and_then(|candidates| candidates.get(0))
                .and_then(|candidate| candidate.get("content"))
                .and_then(|content| content.get("parts"))
                .and_then(Value::as_array)
            {
                for part in parts {
                    if let Some(text) = part.get("text").and_then(Value::as_str) {
                        acc.push_str(text);
                    }
                }
            }
        }
    }
    Ok(())
}

fn set_optional(body: &mut Value, key: &str, value: Option<f32>) {
    if let Some(value) = value {
        body[key] = json!(value);
    }
}

fn set_optional_u32(body: &mut Value, key: &str, value: Option<u32>) {
    if let Some(value) = value {
        body[key] = json!(value);
    }
}

fn header_value(value: &str) -> Result<HeaderValue, String> {
    HeaderValue::from_str(value).map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    #[serde(default)]
    content: Vec<AnthropicBlock>,
}

#[derive(Debug, Deserialize)]
struct AnthropicBlock {
    #[serde(default)]
    r#type: Option<String>,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleResponse {
    #[serde(default)]
    candidates: Vec<GoogleCandidate>,
}

#[derive(Debug, Deserialize)]
struct GoogleCandidate {
    content: Option<GoogleContent>,
}

#[derive(Debug, Deserialize)]
struct GoogleContent {
    #[serde(default)]
    parts: Option<Vec<GooglePart>>,
}

#[derive(Debug, Deserialize)]
struct GooglePart {
    #[serde(default)]
    text: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::{build_chat_request, parse_chat_response, ChatFallbacks};
    use neuink_config::{LlmApiProtocol, LlmProfile};

    fn profile(protocol: LlmApiProtocol) -> LlmProfile {
        LlmProfile {
            id: "test".to_string(),
            name: "Test".to_string(),
            base_url: "https://example.test/v1".to_string(),
            model: "test-model".to_string(),
            api_key: Some("secret-key".to_string()),
            max_context_length: None,
            temperature: None,
            top_p: None,
            max_output_tokens: None,
            api_protocol: protocol,
        }
    }

    fn empty_fallbacks() -> ChatFallbacks {
        ChatFallbacks {
            max_tokens: None,
            temperature: None,
            top_p: None,
        }
    }

    fn assert_approx(actual: Option<f64>, expected: f64) {
        let actual = actual.expect("expected a numeric value");
        assert!(
            (actual - expected).abs() < 1e-6,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn openai_request_matches_legacy_shape() {
        let (url, headers, body) = build_chat_request(
            &profile(LlmApiProtocol::OpenaiCompatible),
            "sys",
            "usr",
            empty_fallbacks(),
        )
        .unwrap();
        assert_eq!(url, "https://example.test/v1/chat/completions");
        assert_eq!(
            headers.get("authorization").and_then(|v| v.to_str().ok()),
            Some("Bearer secret-key")
        );
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][0]["content"], "sys");
        assert_eq!(body["messages"][1]["role"], "user");
        assert!(body.get("temperature").is_none());
        assert!(body.get("max_tokens").is_none());
    }

    #[test]
    fn openai_request_passes_through_full_endpoint_and_fallbacks() {
        let mut profile = profile(LlmApiProtocol::OpenaiCompatible);
        profile.base_url = "https://example.test/v1/chat/completions/".to_string();
        let (url, _, body) = build_chat_request(
            &profile,
            "sys",
            "usr",
            ChatFallbacks {
                max_tokens: Some(4_096),
                temperature: Some(0.2),
                top_p: Some(1.0),
            },
        )
        .unwrap();
        assert_eq!(url, "https://example.test/v1/chat/completions");
        assert_eq!(body["max_tokens"], 4_096);
        assert_approx(body["temperature"].as_f64(), 0.2);
        assert_approx(body["top_p"].as_f64(), 1.0);
    }

    #[test]
    fn openai_request_without_key_sends_no_auth_header() {
        let mut profile = profile(LlmApiProtocol::OpenaiCompatible);
        profile.api_key = None;
        let (_, headers, _) =
            build_chat_request(&profile, "sys", "usr", empty_fallbacks()).unwrap();
        assert!(headers.get("authorization").is_none());
    }

    #[test]
    fn anthropic_request_shape() {
        let (url, headers, body) = build_chat_request(
            &profile(LlmApiProtocol::Anthropic),
            "sys",
            "usr",
            empty_fallbacks(),
        )
        .unwrap();
        assert_eq!(url, "https://example.test/v1/messages");
        assert_eq!(
            headers.get("x-api-key").and_then(|v| v.to_str().ok()),
            Some("secret-key")
        );
        assert_eq!(
            headers
                .get("anthropic-version")
                .and_then(|v| v.to_str().ok()),
            Some("2023-06-01")
        );
        assert!(headers.get("authorization").is_none());
        assert_eq!(body["system"], "sys");
        assert_eq!(body["max_tokens"], 1_024);
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][0]["content"], "usr");
    }

    #[test]
    fn anthropic_request_omits_empty_system_and_keeps_max_tokens() {
        let mut profile = profile(LlmApiProtocol::Anthropic);
        profile.max_output_tokens = Some(512);
        let (_, _, body) = build_chat_request(&profile, "", "usr", empty_fallbacks()).unwrap();
        assert!(body.get("system").is_none());
        assert_eq!(body["max_tokens"], 512);
    }

    #[test]
    fn google_request_shape() {
        let (url, headers, body) = build_chat_request(
            &profile(LlmApiProtocol::Google),
            "sys",
            "usr",
            ChatFallbacks {
                max_tokens: Some(2_048),
                temperature: Some(0.4),
                top_p: None,
            },
        )
        .unwrap();
        assert_eq!(
            url,
            "https://example.test/v1/models/test-model:generateContent"
        );
        assert_eq!(
            headers.get("x-goog-api-key").and_then(|v| v.to_str().ok()),
            Some("secret-key")
        );
        assert_eq!(body["contents"][0]["parts"][0]["text"], "usr");
        assert_eq!(body["systemInstruction"]["parts"][0]["text"], "sys");
        assert_approx(body["generationConfig"]["temperature"].as_f64(), 0.4);
        assert_eq!(body["generationConfig"]["maxOutputTokens"], 2_048);
        assert!(body["generationConfig"].get("topP").is_none());
    }

    #[test]
    fn google_request_with_models_base_and_no_params() {
        let mut profile = profile(LlmApiProtocol::Google);
        profile.base_url = "https://example.test/v1beta/models".to_string();
        let (url, _, body) = build_chat_request(&profile, "", "usr", empty_fallbacks()).unwrap();
        assert_eq!(
            url,
            "https://example.test/v1beta/models/test-model:generateContent"
        );
        assert!(body.get("systemInstruction").is_none());
        assert!(body.get("generationConfig").is_none());
    }

    #[test]
    fn parses_openai_response() {
        let body = r#"{"choices":[{"message":{"content":"  hello \n"}}]}"#;
        assert_eq!(
            parse_chat_response(LlmApiProtocol::OpenaiCompatible, body).unwrap(),
            "hello"
        );
    }

    #[test]
    fn parses_anthropic_response_skipping_non_text_blocks() {
        let body = r#"{"content":[
            {"type":"thinking","thinking":"hidden"},
            {"type":"text","text":"hello "},
            {"type":"text","text":"world"}
        ]}"#;
        assert_eq!(
            parse_chat_response(LlmApiProtocol::Anthropic, body).unwrap(),
            "hello \nworld"
        );
    }

    #[test]
    fn parses_google_multi_part_response() {
        let body = r#"{"candidates":[{"content":{"parts":[{"text":"foo"},{"text":"bar"}]}}]}"#;
        assert_eq!(
            parse_chat_response(LlmApiProtocol::Google, body).unwrap(),
            "foobar"
        );
    }

    #[test]
    fn stream_request_enables_protocol_stream_switch() {
        let (url, _, body) = super::build_chat_stream_request(
            &profile(LlmApiProtocol::OpenaiCompatible),
            "sys",
            "usr",
            empty_fallbacks(),
        )
        .unwrap();
        assert_eq!(url, "https://example.test/v1/chat/completions");
        assert_eq!(body["stream"], true);

        let (_, _, body) = super::build_chat_stream_request(
            &profile(LlmApiProtocol::Anthropic),
            "sys",
            "usr",
            empty_fallbacks(),
        )
        .unwrap();
        assert_eq!(body["stream"], true);

        let (url, _, _) = super::build_chat_stream_request(
            &profile(LlmApiProtocol::Google),
            "sys",
            "usr",
            empty_fallbacks(),
        )
        .unwrap();
        assert_eq!(
            url,
            "https://example.test/v1/models/test-model:streamGenerateContent?alt=sse"
        );
    }

    #[test]
    fn stream_deltas_accumulate_per_protocol() {
        let mut acc = String::new();
        super::append_chat_stream_delta(
            LlmApiProtocol::OpenaiCompatible,
            r#"{"choices":[{"delta":{"content":"你好"}}]}"#,
            &mut acc,
        )
        .unwrap();
        super::append_chat_stream_delta(LlmApiProtocol::OpenaiCompatible, "[DONE]", &mut acc)
            .unwrap();
        super::append_chat_stream_delta(LlmApiProtocol::OpenaiCompatible, ": keepalive", &mut acc)
            .unwrap();
        assert_eq!(acc, "你好");

        let mut acc = String::new();
        super::append_chat_stream_delta(
            LlmApiProtocol::Anthropic,
            r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"世界"}}"#,
            &mut acc,
        )
        .unwrap();
        super::append_chat_stream_delta(
            LlmApiProtocol::Anthropic,
            r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#,
            &mut acc,
        )
        .unwrap();
        assert_eq!(acc, "世界");

        let mut acc = String::new();
        super::append_chat_stream_delta(
            LlmApiProtocol::Google,
            r#"{"candidates":[{"content":{"parts":[{"text":"a"},{"text":"b"}]}}]}"#,
            &mut acc,
        )
        .unwrap();
        assert_eq!(acc, "ab");
    }

    #[test]
    fn errors_on_empty_content() {
        let body = r#"{"choices":[{"message":{"content":"  "}}]}"#;
        assert!(parse_chat_response(LlmApiProtocol::OpenaiCompatible, body).is_err());
        assert!(parse_chat_response(LlmApiProtocol::Anthropic, r#"{"content":[]}"#).is_err());
        assert!(parse_chat_response(LlmApiProtocol::Google, r#"{"candidates":[]}"#).is_err());
    }
}
