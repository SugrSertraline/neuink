use super::sentences::{align, AlignedSentence};
use super::SentenceTranslation;

/// Only the requested top-level JSON value is previewed, never model metadata or reasoning.
pub(super) fn paragraph_preview(text: &str) -> Option<String> {
    let rest = text
        .split_once("\"translation\"")?
        .1
        .trim_start()
        .strip_prefix(':')?
        .trim_start()
        .strip_prefix('"')?;
    let mut out = String::new();
    let mut chars = rest.chars();
    while let Some(ch) = chars.next() {
        if ch == '"' {
            break;
        }
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('"') => out.push('"'),
            Some('\\') => out.push('\\'),
            Some('/') => out.push('/'),
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('b') => out.push('\u{0008}'),
            Some('f') => out.push('\u{000c}'),
            Some('u') => {
                let hex: String = chars.by_ref().take(4).collect();
                if hex.len() != 4 {
                    break;
                }
                let Ok(mut value) = u32::from_str_radix(&hex, 16) else {
                    break;
                };
                if (0xD800..=0xDBFF).contains(&value) {
                    if chars.next() != Some('\\') || chars.next() != Some('u') {
                        break;
                    }
                    let low: String = chars.by_ref().take(4).collect();
                    let Ok(low) = u32::from_str_radix(&low, 16) else {
                        break;
                    };
                    if !(0xDC00..=0xDFFF).contains(&low) {
                        break;
                    }
                    value = 0x10000 + ((value - 0xD800) << 10) + low - 0xDC00;
                }
                let Some(value) = char::from_u32(value) else {
                    break;
                };
                out.push(value);
            }
            _ => break,
        }
    }
    Some(out)
}

pub(super) fn sentence_preview(text: &str, sources: &[String]) -> Vec<SentenceTranslation> {
    let Some((_, rest)) = text.split_once("\"sentences\"") else {
        return Vec::new();
    };
    let Some(mut rest) = rest
        .trim_start()
        .strip_prefix(':')
        .and_then(|s| s.trim_start().strip_prefix('['))
    else {
        return Vec::new();
    };
    let mut translated = Vec::new();
    loop {
        let mut stream =
            serde_json::Deserializer::from_str(rest.trim_start()).into_iter::<AlignedSentence>();
        let Some(Ok(sentence)) = stream.next() else {
            break;
        };
        let consumed = stream.byte_offset();
        translated.push(sentence);
        rest = &rest.trim_start()[consumed..];
        let Some(next) = rest.trim_start().strip_prefix(',') else {
            break;
        };
        rest = next;
    }
    align(sources, translated, false).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partial_json_decodes_escapes_without_exposing_incomplete_escape_sequences() {
        assert_eq!(
            paragraph_preview(r#"{"translation":"你好\n世界\u4e"#).as_deref(),
            Some("你好\n世界")
        );
        assert_eq!(
            paragraph_preview(r#"{"translation":"hi\uD83D\uDE00"}"#).as_deref(),
            Some("hi😀")
        );
        assert_eq!(
            paragraph_preview(r#"{"translation":"x\uD83D"#).as_deref(),
            Some("x")
        );
        assert!(paragraph_preview("metadata only").is_none());
    }
    #[test]
    fn only_complete_sentence_objects_are_displayed_in_order() {
        let source = vec!["First.".into(), "Second.".into()];
        let partial = r#"{"sentences":[{"id":1,"translation":"第一句"},{"id":2,"translation":"第"#;
        let result = sentence_preview(partial, &source);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].source, "First.");
        assert!(sentence_preview(
            r#"{"sentences":[{"id":2,"translation":"错误顺序"}]"#,
            &source
        )
        .is_empty());
    }
}
