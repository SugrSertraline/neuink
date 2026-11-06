//! Lossless request boundaries. A chunk is internal; segment identity never changes.
pub(crate) fn split(text: &str, limit: usize) -> Result<Vec<&str>, String> {
    if text.len() <= limit {
        return Ok(vec![text]);
    }
    let mut boundaries = Vec::new();
    let mut cursor = 0;
    let mut depth = 0usize;
    while cursor < text.len() {
        let rest = &text[cursor..];
        let pair = if rest.starts_with("$$") {
            Some(("$$", "$$"))
        } else if rest.starts_with('$') {
            Some(("$", "$"))
        } else if rest.starts_with("\\(") {
            Some(("\\(", "\\)"))
        } else if rest.starts_with("\\[") {
            Some(("\\[", "\\]"))
        } else if rest.starts_with("```") {
            Some(("```", "```"))
        } else if rest.starts_with('`') {
            Some(("`", "`"))
        } else {
            None
        };
        if let Some((open, close)) = pair {
            cursor += rest[open.len()..]
                .find(close)
                .map(|n| n + open.len() + close.len())
                .unwrap_or(rest.len());
            continue;
        }
        if rest.starts_with("http://") || rest.starts_with("https://") {
            cursor += rest.find(char::is_whitespace).unwrap_or(rest.len());
            continue;
        }
        let ch = rest.chars().next().unwrap_or_default();
        if matches!(ch, '(' | '[' | '（') {
            depth += 1;
        }
        if matches!(ch, ')' | ']' | '）') {
            depth = depth.saturating_sub(1);
        }
        cursor += ch.len_utf8();
        if depth != 0 {
            continue;
        }
        let next = text[cursor..].chars().next();
        let priority = if ch == '\n' && text[..cursor].ends_with("\n\n") {
            4
        } else if matches!(ch, '。' | '！' | '？' | '!' | '?') {
            3
        } else if ch == '.'
            && next.is_none_or(char::is_whitespace)
            && !abbreviation(&text[..cursor - 1])
        {
            3
        } else if matches!(ch, ';' | '；') {
            2
        } else if ch.is_whitespace() {
            1
        } else {
            0
        };
        if priority > 0 {
            boundaries.push((cursor, priority));
        }
    }
    let mut result = Vec::new();
    let mut start = 0;
    while text.len() - start > limit {
        let end = boundaries.iter().filter(|(end, _)| *end > start && *end <= start + limit)
            .max_by_key(|(end, priority)| (if *end - start >= limit / 3 { *priority } else { 0 }, *end))
            .map(|(end, _)| *end)
            .ok_or("片段包含超过请求预算的连续内容或公式，无法安全切分；请提高模型上下文／输出上限或调整解析内容。")?;
        result.push(&text[start..end]);
        start = end;
    }
    if start < text.len() {
        result.push(&text[start..]);
    }
    Ok(result)
}

fn abbreviation(prefix: &str) -> bool {
    let word = prefix
        .rsplit(|c: char| !c.is_ascii_alphabetic() && c != '.')
        .next()
        .unwrap_or("");
    matches!(
        word.to_ascii_lowercase().as_str(),
        "dr" | "mr" | "prof" | "fig" | "eq" | "sec" | "ref" | "vs" | "e.g" | "i.e" | "al"
    ) || (word.len() == 1 && word.chars().all(char::is_uppercase))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_source_and_protected_spans() {
        let text = "Dr. Lee measured 3.5 cm with $x = 1. 2$. 中文句子。 Next result. ".repeat(30);
        let chunks = split(&text, 140).unwrap();
        assert_eq!(chunks.concat(), text);
        assert!(chunks
            .iter()
            .all(|s| s.len() <= 140 && s.matches('$').count() % 2 == 0));
        assert!(chunks.iter().all(|s| !s.ends_with("Dr.")));
    }
    #[test]
    fn leaves_normal_segments_whole_and_rejects_unsafe_cuts() {
        assert_eq!(
            split("First. Second.", 100).unwrap(),
            vec!["First. Second."]
        );
        assert!(split(&format!("${}$", "x".repeat(100)), 40).is_err());
    }
}
