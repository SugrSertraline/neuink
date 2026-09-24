use super::*;

#[derive(Deserialize)]
pub(super) struct AlignedSentence {
    pub id: usize,
    pub translation: String,
}

/// Conservative English sentence boundaries. Ambiguous spans stay together rather than
/// splitting formulas, initials, citations or Markdown constructs into broken sentences.
pub(super) fn split_sentences(source: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut start = 0;
    let mut cursor = 0;
    let mut depth = 0usize;
    while cursor < source.len() {
        let rest = &source[cursor..];
        let delimiter = if rest.starts_with("$$") {
            Some(("$$", "$$"))
        } else if rest.starts_with('$') {
            Some(("$", "$"))
        } else if rest.starts_with("\\(") {
            Some(("\\(", "\\)"))
        } else if rest.starts_with("\\[") {
            Some(("\\[", "\\]"))
        } else {
            None
        };
        if let Some((open, close)) = delimiter {
            cursor += rest[open.len()..]
                .find(close)
                .map(|offset| open.len() + offset + close.len())
                .unwrap_or(rest.len());
            continue;
        }
        if rest.starts_with('`') {
            let count = rest.bytes().take_while(|byte| *byte == b'`').count();
            let marker = &rest[..count];
            cursor += rest[count..]
                .find(marker)
                .map(|offset| count + offset + count)
                .unwrap_or(rest.len());
            continue;
        }
        let ch = rest.chars().next().unwrap_or_default();
        if ch == '[' || ch == '(' {
            depth += 1;
        }
        if ch == ']' || ch == ')' {
            depth = depth.saturating_sub(1);
        }
        let mut end = cursor + ch.len_utf8();
        if depth == 0 && matches!(ch, '.' | '?' | '!') {
            while let Some(next) = source[end..]
                .chars()
                .next()
                .filter(|c| matches!(c, '.' | '?' | '!' | '"' | '\'' | '”' | '’'))
            {
                end += next.len_utf8();
            }
            // Attach citations following punctuation to the preceding sentence.
            loop {
                let trimmed = source[end..].trim_start();
                if !trimmed.starts_with('[') {
                    break;
                }
                let Some(close) = trimmed.find(']') else {
                    break;
                };
                if !trimmed[..close].chars().any(|c| c.is_ascii_digit()) {
                    break;
                }
                end = source.len() - trimmed.len() + close + 1;
            }
            let followed_by_space = source[end..].chars().next().is_none_or(char::is_whitespace);
            if followed_by_space && (ch != '.' || !abbreviation(&source[..cursor])) {
                let sentence = source[start..end].trim();
                if !sentence.is_empty() {
                    result.push(sentence.to_string());
                }
                start = end;
                cursor = end;
                continue;
            }
        }
        cursor += ch.len_utf8();
    }
    if !source[start..].trim().is_empty() {
        result.push(source[start..].trim().to_string());
    }
    result
}

fn abbreviation(prefix: &str) -> bool {
    let word = prefix
        .rsplit(|c: char| !c.is_ascii_alphabetic() && c != '.')
        .next()
        .unwrap_or_default();
    let lower = word.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "dr" | "mr"
            | "mrs"
            | "ms"
            | "prof"
            | "fig"
            | "figs"
            | "eq"
            | "eqs"
            | "sec"
            | "secs"
            | "ref"
            | "refs"
            | "vol"
            | "no"
            | "vs"
            | "e.g"
            | "i.e"
            | "cf"
            | "approx"
            | "al"
            | "st"
    ) || (word.len() == 1 && word.chars().all(|c| c.is_ascii_uppercase()))
        || (word.contains('.')
            && word
                .split('.')
                .all(|part| part.len() == 1 && part.chars().all(|c| c.is_ascii_alphabetic())))
}

pub(super) fn align(
    sources: &[String],
    translated: Vec<AlignedSentence>,
    complete: bool,
) -> Result<Vec<SentenceTranslation>, String> {
    if complete && translated.len() != sources.len() {
        return Err("逐句译文数量不完整，请重试。".into());
    }
    translated
        .into_iter()
        .enumerate()
        .map(|(index, sentence)| {
            if sentence.id != index + 1
                || index >= sources.len()
                || sentence.translation.trim().is_empty()
            {
                return Err("逐句编号或译文不完整，请重试。".into());
            }
            Ok(SentenceTranslation {
                id: sentence.id,
                source: sources[index].clone(),
                translation: sentence.translation,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn splits_sentences_without_rewriting_source_or_splitting_academic_spans() {
        let cases = [
            ("Dr. A. Smith measured 3.5 cm [1]. It worked! Why?", 3),
            (
                "See Fig. 2 and Eq. 3, i.e. the U.S. dataset. Next result.",
                2,
            ),
            ("It worked. [12, 14] Next sentence.", 2),
            ("A model uses $x = 1. 2$ and `a. b`. Next sentence.", 2),
            (
                "See [the link](https://example.test/a.b). Next sentence.",
                2,
            ),
            ("He said \"It works.\" Next sentence.", 2),
            ("One sentence without punctuation", 1),
        ];
        for (source, count) in cases {
            let sources = split_sentences(source);
            assert_eq!(sources.len(), count, "{source}: {sources:?}");
            let translated = sources
                .iter()
                .enumerate()
                .map(|(i, _)| AlignedSentence {
                    id: i + 1,
                    translation: "译文".into(),
                })
                .collect();
            assert!(
                validate_sentences(source, &align(&sources, translated, true).unwrap()).is_ok()
            );
        }
    }
    #[test]
    fn rejects_missing_duplicate_and_out_of_order_ids() {
        let sources = split_sentences("First. Second.");
        assert!(align(
            &sources,
            vec![AlignedSentence {
                id: 1,
                translation: "一".into()
            }],
            true
        )
        .is_err());
        assert!(align(
            &sources,
            vec![AlignedSentence {
                id: 2,
                translation: "二".into()
            }],
            false
        )
        .is_err());
        assert!(align(
            &sources,
            vec![
                AlignedSentence {
                    id: 1,
                    translation: "一".into()
                },
                AlignedSentence {
                    id: 1,
                    translation: "二".into()
                }
            ],
            true
        )
        .is_err());
    }
}
