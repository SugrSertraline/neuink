use neuink_config::LlmApiProtocol;
use serde_json::Value;

pub(super) const TRUNCATED: &str = "LLM_TRANSLATION_OUTPUT_LIMIT";
pub(super) const REASONING_ONLY: &str = "LLM_TRANSLATION_REASONING_ONLY";
pub(super) const REJECTED: &str = "LLM_TRANSLATION_PROVIDER_ERROR";
pub(super) const FILTERED: &str = "LLM_TRANSLATION_CONTENT_FILTERED";

// Inspect completion status before accepting any text. In particular, a JSON
// prefix emitted before finish_reason=length is not a successful translation.
fn validate(value: &Value) -> Result<(), String> {
    if value.get("error").is_some_and(|error| !error.is_null()) {
        // Provider errors may echo prompts or credentials: never persist the body.
        return Err(REJECTED.into());
    }
    match value
        .pointer("/choices/0/finish_reason")
        .or_else(|| value.get("stop_reason"))
        .or_else(|| value.pointer("/delta/stop_reason"))
        .or_else(|| value.pointer("/candidates/0/finishReason"))
        .and_then(Value::as_str)
    {
        Some("length" | "max_tokens" | "MAX_TOKENS") => Err(TRUNCATED.into()),
        Some(
            "content_filter" | "sensitive" | "refusal" | "SAFETY" | "RECITATION"
            | "PROHIBITED_CONTENT",
        ) => Err(FILTERED.into()),
        _ => Ok(()),
    }
}

pub(super) fn parse(protocol: LlmApiProtocol, body: &str) -> Result<String, String> {
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        validate(&value)?;
    }
    if protocol == LlmApiProtocol::Google {
        if let Ok(mut value) = serde_json::from_str::<Value>(body) {
            let mut thought = false;
            remove_google_thoughts(&mut value, &mut thought);
            let result =
                crate::commands::llm_http::parse_chat_response(protocol, &value.to_string());
            return if thought && result.is_err() {
                Err(REASONING_ONLY.into())
            } else {
                result
            };
        }
    }
    if protocol == LlmApiProtocol::Anthropic {
        if let Ok(value) = serde_json::from_str::<Value>(body) {
            if let Some(blocks) = value.get("content").and_then(Value::as_array) {
                if blocks.iter().any(|b| b["type"] == "thinking")
                    && !blocks.iter().any(|b| {
                        b["type"] == "text"
                            && b["text"].as_str().is_some_and(|s| !s.trim().is_empty())
                    })
                {
                    return Err(REASONING_ONLY.into());
                }
            }
        }
    }
    if protocol == LlmApiProtocol::OpenaiCompatible {
        if let Ok(value) = serde_json::from_str::<Value>(body) {
            validate(&value)?;
            if value
                .pointer("/choices/0/message/content")
                .and_then(Value::as_str)
                .is_none_or(|text| text.trim().is_empty())
                && has_reasoning(value.pointer("/choices/0/message"))
            {
                return Err(REASONING_ONLY.into());
            }
        }
    }
    crate::commands::llm_http::parse_chat_response(protocol, body)
}

pub(super) fn append(
    protocol: LlmApiProtocol,
    data: &str,
    accumulated: &mut String,
    saw_reasoning: &mut bool,
) -> Result<(), String> {
    if let Ok(value) = serde_json::from_str::<Value>(data.trim()) {
        validate(&value)?;
    }
    if protocol == LlmApiProtocol::Google {
        if let Ok(mut value) = serde_json::from_str::<Value>(data.trim()) {
            remove_google_thoughts(&mut value, saw_reasoning);
            return crate::commands::llm_http::append_chat_stream_delta(
                protocol,
                &value.to_string(),
                accumulated,
            );
        }
    }
    if protocol == LlmApiProtocol::Anthropic {
        if let Ok(value) = serde_json::from_str::<Value>(data.trim()) {
            *saw_reasoning |=
                value.pointer("/delta/type").and_then(Value::as_str) == Some("thinking_delta");
        }
    }
    if protocol == LlmApiProtocol::OpenaiCompatible {
        if let Ok(value) = serde_json::from_str::<Value>(data.trim()) {
            validate(&value)?;
            *saw_reasoning |= has_reasoning(value.pointer("/choices/0/delta"));
        }
    }
    crate::commands::llm_http::append_chat_stream_delta(protocol, data, accumulated)
}

fn has_reasoning(message: Option<&Value>) -> bool {
    ["reasoning_content", "reasoning"].iter().any(|key| {
        message
            .and_then(|m| m.get(key))
            .and_then(Value::as_str)
            .is_some_and(|s| !s.trim().is_empty())
    })
}

fn remove_google_thoughts(value: &mut Value, saw_reasoning: &mut bool) {
    if let Some(parts) = value
        .pointer_mut("/candidates/0/content/parts")
        .and_then(Value::as_array_mut)
    {
        parts.retain(|part| {
            let thought = part.get("thought").and_then(Value::as_bool) == Some(true);
            *saw_reasoning |= thought;
            !thought
        });
    }
}

pub(super) fn terminal(error: &str) -> bool {
    [TRUNCATED, REASONING_ONLY, REJECTED, FILTERED].contains(&error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const PROTOCOL: LlmApiProtocol = LlmApiProtocol::OpenaiCompatible;

    #[test]
    fn checks_completion_by_protocol_without_model_name_rules() {
        for (protocol, payload) in [
            (
                LlmApiProtocol::Anthropic,
                json!({"content":[{"type":"text","text":"partial"}],"stop_reason":"max_tokens","delta":{"stop_reason":"max_tokens"}}),
            ),
            (
                LlmApiProtocol::Google,
                json!({"candidates":[{"content":{"parts":[{"text":"partial"}]},"finishReason":"MAX_TOKENS"}]}),
            ),
        ] {
            let body = payload.to_string();
            assert_eq!(parse(protocol, &body).unwrap_err(), TRUNCATED);
            assert_eq!(
                append(protocol, &body, &mut String::new(), &mut false).unwrap_err(),
                TRUNCATED
            );
            assert_eq!(
                parse(protocol, r#"{"error":{"message":"secret"}}"#).unwrap_err(),
                REJECTED
            );
        }
    }

    #[test]
    fn excludes_google_and_anthropic_reasoning_from_final_translation() {
        let google = LlmApiProtocol::Google;
        let body = json!({"candidates":[{"content":{"parts":[{"thought":true,"text":"private thought"},{"text":"译文"}]},"finishReason":"STOP"}]}).to_string();
        assert_eq!(parse(google, &body).unwrap(), "译文");
        let mut text = String::new();
        let mut reasoning = false;
        append(google, &body, &mut text, &mut reasoning).unwrap();
        assert_eq!(text, "译文");
        assert!(reasoning);
        let body = json!({"candidates":[{"content":{"parts":[{"thought":true,"text":"private thought"}]}}]}).to_string();
        assert_eq!(parse(google, &body).unwrap_err(), REASONING_ONLY);
        let body =
            r#"{"content":[{"type":"thinking","thinking":"private"}],"stop_reason":"end_turn"}"#;
        assert_eq!(
            parse(LlmApiProtocol::Anthropic, body).unwrap_err(),
            REASONING_ONLY
        );
    }

    #[test]
    fn glm_reasoning_is_never_used_as_translation() {
        let body = json!({"choices":[{"message":{"reasoning_content":"private analysis","content":"译文"},"finish_reason":"stop"}]}).to_string();
        assert_eq!(parse(PROTOCOL, &body).unwrap(), "译文");
        let body = json!({"choices":[{"message":{"reasoning_content":"private analysis","content":null},"finish_reason":"stop"}]}).to_string();
        assert_eq!(parse(PROTOCOL, &body).unwrap_err(), REASONING_ONLY);
        let mut text = String::new();
        let mut saw_reasoning = false;
        append(
            PROTOCOL,
            r#"{"choices":[{"delta":{"reasoning_content":"private analysis"}}]}"#,
            &mut text,
            &mut saw_reasoning,
        )
        .unwrap();
        assert!(saw_reasoning);
        assert!(text.is_empty());
        append(
            PROTOCOL,
            r#"{"choices":[{"delta":{"content":"译文"},"finish_reason":"stop"}]}"#,
            &mut text,
            &mut saw_reasoning,
        )
        .unwrap();
        assert_eq!(text, "译文");
    }

    #[test]
    fn rejects_truncation_filters_and_errors_with_safe_messages() {
        for (finish, expected) in [("length", TRUNCATED), ("sensitive", FILTERED)] {
            let body = json!({"choices":[{"message":{"content":"partial"},"delta":{"content":"partial"},"finish_reason":finish}]}).to_string();
            assert_eq!(parse(PROTOCOL, &body).unwrap_err(), expected);
            assert_eq!(
                append(PROTOCOL, &body, &mut String::new(), &mut false).unwrap_err(),
                expected
            );
        }
        let body = r#"{"error":{"message":"private prompt and sk-secret"}}"#;
        assert_eq!(parse(PROTOCOL, body).unwrap_err(), REJECTED);
        assert_eq!(
            append(PROTOCOL, body, &mut String::new(), &mut false).unwrap_err(),
            REJECTED
        );
    }
}
