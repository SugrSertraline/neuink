use std::collections::BTreeSet;

pub fn tokenize_unique(text: &str) -> Vec<String> {
    let mut seen = BTreeSet::new();
    for token in tokenize(text) {
        seen.insert(token);
    }
    seen.into_iter().collect()
}

/// Only the query changes. Preserve all-stopword queries and CJK tokens.
pub fn tokenize_content_query(text: &str) -> Vec<String> {
    let original = tokenize_unique(text);
    let filtered = original
        .iter()
        .filter(|term| !is_english_stopword(term))
        .cloned()
        .collect::<Vec<_>>();
    if filtered.is_empty() {
        original
    } else {
        filtered
    }
}

fn is_english_stopword(term: &str) -> bool {
    matches!(
        term,
        "a" | "an"
            | "and"
            | "are"
            | "as"
            | "at"
            | "be"
            | "been"
            | "being"
            | "by"
            | "can"
            | "could"
            | "did"
            | "do"
            | "does"
            | "for"
            | "from"
            | "had"
            | "has"
            | "have"
            | "how"
            | "if"
            | "in"
            | "into"
            | "is"
            | "it"
            | "its"
            | "of"
            | "on"
            | "or"
            | "that"
            | "the"
            | "their"
            | "these"
            | "they"
            | "this"
            | "those"
            | "to"
            | "was"
            | "were"
            | "what"
            | "when"
            | "where"
            | "which"
            | "who"
            | "why"
            | "will"
            | "with"
            | "would"
    )
}

pub fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut latin = String::new();
    let mut cjk = String::new();

    for character in text.chars() {
        if is_cjk(character) {
            flush_latin(&mut latin, &mut tokens);
            cjk.push(character);
        } else if character.is_alphanumeric() {
            flush_cjk(&mut cjk, &mut tokens);
            for lowered in character.to_lowercase() {
                latin.push(lowered);
            }
        } else {
            flush_latin(&mut latin, &mut tokens);
            flush_cjk(&mut cjk, &mut tokens);
        }
    }

    flush_latin(&mut latin, &mut tokens);
    flush_cjk(&mut cjk, &mut tokens);
    tokens
}

fn flush_latin(buffer: &mut String, tokens: &mut Vec<String>) {
    let value = buffer.trim();
    if value.len() >= 2 {
        tokens.push(value.to_string());
    }
    buffer.clear();
}

fn flush_cjk(buffer: &mut String, tokens: &mut Vec<String>) {
    let chars = buffer.chars().collect::<Vec<_>>();
    match chars.len() {
        0 => {}
        1 => tokens.push(chars[0].to_string()),
        _ => {
            for pair in chars.windows(2) {
                tokens.push(pair.iter().collect());
            }
        }
    }
    buffer.clear();
}

fn is_cjk(character: char) -> bool {
    matches!(
        character as u32,
        0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0x20000..=0x2A6DF
            | 0x2A700..=0x2B73F
            | 0x2B740..=0x2B81F
            | 0x2B820..=0x2CEAF
            | 0x3040..=0x309F
            | 0x30A0..=0x30FF
            | 0xAC00..=0xD7AF
    )
}

#[cfg(test)]
mod tests {
    use super::tokenize;

    #[test]
    fn tokenizes_latin_words() {
        assert_eq!(
            tokenize("Fast Search, fast!"),
            vec!["fast", "search", "fast"]
        );
    }

    #[test]
    fn tokenizes_cjk_bigrams() {
        assert_eq!(tokenize("关键词搜索"), vec!["关键", "键词", "词搜", "搜索"]);
    }
}
