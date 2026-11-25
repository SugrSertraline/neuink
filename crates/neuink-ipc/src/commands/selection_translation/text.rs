/// Lossless UTF-8 chunks, preferring sentence/word boundaries. The byte cap is also
/// safely below providers' character limits, including NiuTrans's 5000 limit.
pub(super) fn chunks(mut text: &str, limit: usize) -> Vec<&str> {
    let mut result = Vec::new();
    while text.len() > limit {
        let mut end = limit;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        if let Some((index, ch)) = text[..end].char_indices().rev().find(|(i, c)| {
            *i > end / 2 && (c.is_whitespace() || matches!(c, '.' | '!' | '?' | '。' | '！' | '？'))
        }) {
            end = index + ch.len_utf8();
        }
        result.push(&text[..end]);
        text = &text[end..];
    }
    if !text.is_empty() {
        result.push(text);
    }
    result
}

/// Keep structured syntax and non-prose spans outside translation requests.
pub(super) fn parts(source: &str) -> Vec<(&str, bool)> {
    let mut result = Vec::new();
    let mut start = 0;
    let mut cursor = 0;
    while cursor < source.len() {
        let rest = &source[cursor..];
        let pair = if rest.starts_with("$$") {
            Some(("$$", "$$"))
        } else if rest.starts_with('$') && !source[..cursor].ends_with('\\') {
            Some(("$", "$"))
        } else if rest.starts_with("\\[") {
            Some(("\\[", "\\]"))
        } else if rest.starts_with("\\(") {
            Some(("\\(", "\\)"))
        } else if rest.starts_with("```") {
            Some(("```", "```"))
        } else if rest.starts_with('`') {
            Some(("`", "`"))
        } else if rest.starts_with("](") {
            Some(("](", ")"))
        } else if rest.starts_with('<') {
            Some(("<", ">"))
        } else {
            None
        };
        let span = pair
            .and_then(|(open, close)| {
                rest[open.len()..]
                    .find(close)
                    .map(|n| open.len() + n + close.len())
            })
            .or_else(|| {
                if rest.starts_with("https://") || rest.starts_with("http://") {
                    Some(rest.find(char::is_whitespace).unwrap_or(rest.len()))
                } else {
                    None
                }
            });
        let ch = rest.chars().next().unwrap_or_default();
        // Line breaks, table separators and Markdown delimiters remain byte-for-byte stable.
        let span = span.or_else(|| {
            matches!(ch, '\n' | '\r' | '|' | '*' | '#' | '[' | ']' | '_').then_some(ch.len_utf8())
        });
        if let Some(len) = span {
            if cursor > start {
                result.push((&source[start..cursor], true));
            }
            result.push((&source[cursor..cursor + len], false));
            cursor += len;
            start = cursor;
        } else {
            cursor += ch.len_utf8();
        }
    }
    if start < source.len() {
        result.push((&source[start..], true));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chunking_is_lossless_and_unicode_safe() {
        let text = "长段落🦀 with words. ".repeat(1200);
        let values = chunks(&text, 4500);
        assert!(values.iter().all(|s| s.len() <= 4500));
        assert_eq!(values.concat(), text);
    }
    #[test]
    fn protects_math_code_links_and_table_structure() {
        let text = "A $x=2$ and \\(y=3\\).\n| cell | `code` | [link](https://example.org/a)\n```mermaid\na-->b\n```";
        let spans = parts(text);
        assert_eq!(spans.iter().map(|(v, _)| *v).collect::<String>(), text);
        let prose = spans
            .iter()
            .filter(|(_, translate)| *translate)
            .map(|(v, _)| *v)
            .collect::<String>();
        assert!(!prose.contains("x=2"));
        assert!(!prose.contains("https"));
        assert!(!prose.contains("mermaid"));
        assert!(!prose.contains('|'));
    }
}
