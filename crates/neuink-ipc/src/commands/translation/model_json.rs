use serde::de::DeserializeOwned;

const INVALID: &str = "LLM_TRANSLATION_INVALID_FORMAT";

pub(super) fn parse_json_object<T: DeserializeOwned>(text: &str) -> Result<T, String> {
    let mut text = text.trim();
    // Some compatible endpoints put reasoning in content instead of its own
    // field. Never parse examples inside that trace as the final answer.
    while let Some(tag) = ["think", "analysis"]
        .into_iter()
        .find(|tag| text.starts_with(&format!("<{tag}>")))
    {
        let end_tag = format!("</{tag}>");
        let end = text.find(&end_tag).ok_or(INVALID)?;
        text = text[end + end_tag.len()..].trim_start();
    }
    // Scan the JSON object itself, not Markdown fences: valid translated text
    // can contain fenced code, braces and escaped quotes inside JSON strings.
    let start = text.find('{').ok_or(INVALID)?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (offset, character) in text[start..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        match character {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let object = &text[start..=start + offset];
                    // Multiple answers are ambiguous; don't pick an example.
                    if text[start + offset + 1..].contains('{') {
                        return Err(INVALID.into());
                    }
                    return serde_json::from_str(object)
                        .or_else(|_| serde_json::from_str(&repair_invalid_json_escapes(object)))
                        .map_err(|_| INVALID.into());
                }
            }
            _ => {}
        }
    }
    Err(INVALID.into())
}

fn repair_invalid_json_escapes(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut in_string = false;
    let mut escaped = false;
    let mut chars = value.chars().peekable();
    while let Some(character) = chars.next() {
        if escaped {
            escaped = false;
        } else if character == '"' {
            in_string = !in_string;
        } else if in_string && character == '\\' {
            if !matches!(
                chars.peek(),
                Some('"' | '\\' | '/' | 'b' | 'f' | 'n' | 'r' | 't' | 'u')
            ) {
                output.push('\\');
            } else {
                escaped = true;
            }
        }
        output.push(character);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use serde_json::json;

    #[derive(Debug, Deserialize)]
    struct Answer {
        translation: String,
    }

    #[test]
    fn parses_json_with_code_fences_and_braces_inside_translation() {
        let translated = "示例：```python\nprint(\"{hello}\")\n```";
        let body = json!({"translation":translated}).to_string();
        for response in [
            body.clone(),
            format!("```json\n{body}\n```"),
            format!("译文如下：\n{body}"),
        ] {
            assert_eq!(
                parse_json_object::<Answer>(&response).unwrap().translation,
                translated
            );
        }
    }

    #[test]
    fn skips_reasoning_examples_but_rejects_unfinished_reasoning() {
        let body = "<think>Example: ```json\n{\"translation\":\"猜测\"}\n```</think>\n```json\n{\"translation\":\"最终译文\"}\n```";
        assert_eq!(
            parse_json_object::<Answer>(body).unwrap().translation,
            "最终译文"
        );
        assert!(parse_json_object::<Answer>("<think>{\"translation\":\"猜测\"}").is_err());
    }

    #[test]
    fn preserves_latex_escape_repair_and_rejects_incomplete_or_ambiguous_results() {
        assert_eq!(
            parse_json_object::<Answer>(r#"{"translation":"公式 \alpha 与 \_"}"#)
                .unwrap()
                .translation,
            "公式 \\alpha 与 \\_"
        );
        for body in [
            "",
            "plain text",
            r#"{"translation":"unfinished""#,
            r#"{"wrong_field":"private"}"#,
            r#"{"translation":"one"}{"translation":"two"}"#,
        ] {
            assert_eq!(parse_json_object::<Answer>(body).unwrap_err(), INVALID);
        }
    }
}
