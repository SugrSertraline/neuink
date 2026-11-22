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
            // Conversational pronouns, modals, and high-DF English function words
            // (query-side only; never strips CJK or domain/academic nouns).
            | "my"
            | "me"
            | "we"
            | "us"
            | "our"
            | "you"
            | "your"
            | "he"
            | "him"
            | "his"
            | "she"
            | "her"
            | "not"
            | "no"
            | "nor"
            | "but"
            | "so"
            | "just"
            | "about"
            | "after"
            | "before"
            | "also"
            | "only"
            | "should"
            | "must"
            | "may"
            | "might"
            | "am"
            | "get"
            | "got"
            | "want"
            | "need"
            | "know"
            | "there"
            | "here"
            | "some"
            | "any"
            | "more"
            | "most"
            | "very"
            | "than"
            | "then"
            | "now"
            | "out"
            | "up"
            | "over"
            | "such"
            | "all"
            | "both"
            | "each"
            | "other"
            | "own"
            | "same"
            | "too"
            | "because"
            | "while"
            | "during"
            | "through"
            | "between"
            | "under"
            | "again"
            | "further"
            | "once"
    )
}

pub fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut latin = String::new();
    let mut cjk = String::new();
    let mut hyphen_parts: Vec<String> = Vec::new();

    for character in text.chars() {
        if is_cjk(character) {
            flush_latin_group(&mut latin, &mut hyphen_parts, &mut tokens);
            cjk.push(character);
        } else if character.is_alphanumeric() {
            flush_cjk(&mut cjk, &mut tokens);
            for lowered in character.to_lowercase() {
                latin.push(lowered);
            }
        } else if character == '-' && !latin.is_empty() {
            hyphen_parts.push(std::mem::take(&mut latin));
        } else {
            flush_latin_group(&mut latin, &mut hyphen_parts, &mut tokens);
            flush_cjk(&mut cjk, &mut tokens);
        }
    }

    flush_latin_group(&mut latin, &mut hyphen_parts, &mut tokens);
    flush_cjk(&mut cjk, &mut tokens);
    tokens
}

fn flush_latin_group(buffer: &mut String, hyphen_parts: &mut Vec<String>, tokens: &mut Vec<String>) {
    if !buffer.is_empty() {
        hyphen_parts.push(std::mem::take(buffer));
    }
    if hyphen_parts.is_empty() {
        return;
    }
    if hyphen_parts.len() >= 2 && hyphen_parts.len() <= 3 {
        let keep_compound = hyphen_parts.iter().any(|part| {
            part.len() == 1 || part.chars().any(|ch| ch.is_ascii_digit())
        });
        if keep_compound {
            let compound = hyphen_parts
                .iter()
                .map(|part| normalize_latin_token(part))
                .collect::<Vec<_>>()
                .join("-");
            if compound.len() >= 3 {
                tokens.push(compound);
            }
        }
    }
    for part in hyphen_parts.drain(..) {
        let value = part.trim();
        if value.len() >= 2 {
            tokens.push(normalize_latin_token(value));
        }
    }
}

/// Conservative academic English plural singularizer. Normalizes regular plurals
/// (`datasets` -> `dataset`, `queries` -> `query`, `approaches` -> `approach`) while
/// preserving words ending in `-ss/-us/-is/-os/-as/-ous/-sis/-ics` and digit-bearing terms.
fn normalize_latin_token(token: &str) -> String {
    if token.len() < 4 || !token.bytes().all(|byte| byte.is_ascii_lowercase()) {
        return token.to_string();
    }
    if matches!(
        token,
        "this" | "does" | "goes" | "lens" | "news" | "series" | "species" | "means"
    ) {
        return token.to_string();
    }
    if token.len() >= 5 && token.ends_with("ies") {
        let mut stem = token[..token.len() - 3].to_string();
        stem.push('y');
        return stem;
    }
    if token.len() >= 5
        && (token.ends_with("ches")
            || token.ends_with("shes")
            || token.ends_with("xes")
            || token.ends_with("zes"))
    {
        return token[..token.len() - 2].to_string();
    }
    if token.ends_with('s')
        && !token.ends_with("ss")
        && !token.ends_with("us")
        && !token.ends_with("is")
        && !token.ends_with("os")
        && !token.ends_with("as")
        && !token.ends_with("ous")
        && !token.ends_with("sis")
        && !token.ends_with("ics")
        && !token.ends_with("ees")
    {
        return token[..token.len() - 1].to_string();
    }
    token.to_string()
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

    #[test]
    fn preserves_academic_hyphen_compounds_and_normalizes_regular_plurals() {
        let tokens = tokenize("k-means clusters on bge-m3 datasets with p-value queries");
        assert!(tokens.contains(&"k-means".to_string()));
        assert!(tokens.contains(&"bge-m3".to_string()));
        assert!(tokens.contains(&"p-value".to_string()));
        assert!(tokens.contains(&"cluster".to_string()));
        assert!(tokens.contains(&"dataset".to_string()));
        assert!(tokens.contains(&"query".to_string()));
        assert_eq!(tokenize("approaches"), vec!["approach"]);
        // Academic singular nouns ending in -s must not be over-stemmed.
        assert_eq!(
            tokenize("loss bias analysis corpus series means"),
            vec!["loss", "bias", "analysis", "corpus", "series", "means"]
        );
    }

    #[test]
    fn content_query_filters_english_stopwords_and_preserves_cjk_and_all_stopword_queries() {
        let terms = super::tokenize_content_query("My brother and I want to know what accuracy bge-m3 gets");
        assert!(terms.contains(&"brother".to_string()));
        assert!(terms.contains(&"accuracy".to_string()));
        assert!(terms.contains(&"bge-m3".to_string()));
        assert!(!terms.contains(&"my".to_string()));
        assert!(!terms.contains(&"want".to_string()));
        assert!(!terms.contains(&"what".to_string()));
        // CJK tokens stay untouched.
        assert_eq!(super::tokenize_content_query("关键词搜索"), vec!["关键", "搜索", "词搜", "键词"]);
        // All-stopword query falls back to original tokens instead of emptying.
        assert!(!super::tokenize_content_query("what is it").is_empty());
    }
}
