//! Named-carrier binding for question-driven scope narrowing.
//!
//! Measured basis: on MultiHopRAG, questions that name a carrier ("Table 3",
//! "§4.2", a named source) were answered far better by *cutting the candidate
//! pool to that carrier and then ranking inside it* than by ranking the whole
//! corpus and taking the head — e5-small R@1 0.4352 -> 0.5623 (+12.71 pp,
//! 198 improved / 0 regressed), and the direction held for BM25 and BGE-M3.
//!
//! So this module does one thing: turn an explicit reference in the question
//! into a narrowing constraint. It never guesses. A carrier word without a
//! number, or two different carriers in one question, is reported and the
//! constraint stays absent, which leaves the caller's own filters in force.

use std::collections::BTreeSet;

use neuink_domain::SegmentType;
use serde::{Deserialize, Serialize};

use crate::SearchQuery;

/// Carrier families a question can name.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CarrierKind {
    Section,
    Table,
    Figure,
}

impl CarrierKind {
    /// Segment types a carrier is made of. A section is not a segment type, so it
    /// restricts by path only.
    pub fn segment_types(self) -> Vec<SegmentType> {
        match self {
            Self::Table => vec![SegmentType::Table],
            Self::Figure => vec![SegmentType::Figure],
            Self::Section => Vec::new(),
        }
    }

    /// Case-insensitive text the carrier must appear as inside a section path.
    pub fn section_hint(self, label: &str) -> String {
        match self {
            Self::Section => label.to_string(),
            Self::Table => format!("table {label}"),
            Self::Figure => format!("figure {label}"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Carrier {
    pub kind: CarrierKind,
    /// Digits as written, for example `3` or `4.2`.
    pub label: String,
}

/// What a question names. Empty is the normal case and means "restrict nothing".
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CarrierBinding {
    pub carriers: Vec<Carrier>,
    /// Carrier words with no number after them. Kept for reporting, never bound.
    pub unnumbered: Vec<String>,
}

impl CarrierBinding {
    pub fn is_empty(&self) -> bool {
        self.carriers.is_empty() && self.unnumbered.is_empty()
    }

    /// Why no constraint was produced, when a caller asked for one.
    pub fn unbound_reason(&self) -> Option<UnboundReason> {
        match self.carriers.len() {
            0 if self.unnumbered.is_empty() => None,
            0 => Some(UnboundReason::Unnumbered),
            1 => None,
            _ => Some(UnboundReason::MultipleCarriers),
        }
    }

    /// A constraint only exists for exactly one resolved carrier. Two carriers
    /// cannot be expressed as one filter, and dropping either would answer a
    /// different question.
    pub fn narrow(&self) -> Option<CarrierConstraint> {
        let [carrier] = self.carriers.as_slice() else {
            return None;
        };
        Some(CarrierConstraint {
            kind: carrier.kind,
            label: carrier.label.clone(),
            section_hint: carrier.kind.section_hint(&carrier.label),
            segment_types: carrier.kind.segment_types(),
        })
    }
}

/// Fixed reasons a mentioned carrier did not narrow anything.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnboundReason {
    Unnumbered,
    MultipleCarriers,
}

impl UnboundReason {
    pub fn code(self) -> &'static str {
        match self {
            Self::Unnumbered => "carrier_unnumbered",
            Self::MultipleCarriers => "carrier_multiple",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CarrierConstraint {
    pub kind: CarrierKind,
    pub label: String,
    pub section_hint: String,
    pub segment_types: Vec<SegmentType>,
}

/// Applies a constraint to a query only where the caller left room for it.
/// Host-provided filters are a question constraint and are never overwritten;
/// the return value says whether anything changed.
pub fn apply_to_query(constraint: &CarrierConstraint, query: &mut SearchQuery) -> bool {
    let mut changed = false;
    if query
        .section_filter
        .as_deref()
        .map_or(true, |filter| filter.trim().is_empty())
    {
        query.section_filter = Some(constraint.section_hint.clone());
        changed = true;
    }
    if query.segment_types.is_empty() && !constraint.segment_types.is_empty() {
        query.segment_types = constraint.segment_types.clone();
        changed = true;
    }
    changed
}

/// Reads named carriers out of a question. Deterministic and language-aware for
/// the two spellings the product needs: `Table 3` / `§4.2` and `表3` / `第4.2节`.
pub fn parse_binding(text: &str) -> CarrierBinding {
    let mut binding = CarrierBinding::default();
    let mut seen = BTreeSet::<(CarrierKind, String)>::new();
    for (kind, label) in latin_mentions(text).into_iter().chain(cjk_mentions(text)) {
        if seen.insert((kind, label.clone())) {
            binding.carriers.push(Carrier { kind, label });
        }
    }
    binding.carriers.sort();
    binding.unnumbered = unnumbered_mentions(text);
    binding
}

fn latin_mentions(text: &str) -> Vec<(CarrierKind, String)> {
    let words = latin_tokens(text);
    let mut found = Vec::new();
    let mut index = 0;
    while index < words.len() {
        let Some(kind) = carrier_word(&words[index]) else {
            index += 1;
            continue;
        };
        // `§4.2` keeps its number in the same token.
        if let Some(label) = label_in_same_token(&words[index]) {
            found.push((kind, label));
            index += 1;
            continue;
        }
        match words.get(index + 1).and_then(|word| numeric_label(word)) {
            Some(label) => {
                found.push((kind, label));
                index += 2;
            }
            None => index += 1,
        }
    }
    found
}

/// Splits on any non-alphanumeric character except a dot between digits, so
/// `4.2` and `3a` survive as one label but `结果.` does not glue to a number.
/// The section sign is its own token so `§4.2` and `§ 4.2` both read.
fn latin_tokens(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let characters = text.chars().collect::<Vec<_>>();
    for (index, character) in characters.iter().enumerate() {
        if *character == '§' {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
            tokens.push("§".to_string());
            continue;
        }
        let keeps_dot = *character == '.'
            && current
                .chars()
                .next_back()
                .is_some_and(|last| last.is_ascii_digit())
            && characters
                .get(index + 1)
                .is_some_and(|next| next.is_ascii_digit());
        if character.is_alphanumeric() || keeps_dot {
            current.extend(character.to_lowercase());
        } else if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn carrier_word(token: &str) -> Option<CarrierKind> {
    match token.trim_end_matches('.') {
        "table" | "tab" | "tbl" => Some(CarrierKind::Table),
        "figure" | "fig" => Some(CarrierKind::Figure),
        "section" | "sec" | "§" => Some(CarrierKind::Section),
        _ => None,
    }
}

fn label_in_same_token(token: &str) -> Option<String> {
    let (_, rest) = token.split_once('§')?;
    numeric_label(rest)
}

/// A label is digits with optional decimal parts and one trailing letter, the
/// shapes a parsed document actually emits ("3", "4.2", "2a").
fn numeric_label(token: &str) -> Option<String> {
    let trimmed = token.trim_matches(|character: char| character == '.' || character == ',');
    let mut digits = 0usize;
    let mut letters = 0usize;
    let mut last_was_dot = false;
    for character in trimmed.chars() {
        if character.is_ascii_digit() {
            digits += 1;
            last_was_dot = false;
        } else if character == '.' {
            if last_was_dot {
                return None;
            }
            last_was_dot = true;
        } else if character.is_ascii_alphabetic() {
            letters += 1;
            if letters > 1 {
                return None;
            }
        } else {
            return None;
        }
    }
    (digits > 0 && !trimmed.ends_with('.')).then(|| trimmed.to_string())
}

/// `表3`, `图2`, `第4.2节`. Scan characters so no whitespace is required.
fn cjk_mentions(text: &str) -> Vec<(CarrierKind, String)> {
    let characters = text.chars().collect::<Vec<_>>();
    let mut found = Vec::new();
    for (index, character) in characters.iter().enumerate() {
        let kind = match character {
            '表' => CarrierKind::Table,
            '图' => CarrierKind::Figure,
            _ => continue,
        };
        if let Some(label) = label_after(&characters, index + 1) {
            found.push((kind, label));
        }
    }
    for (index, character) in characters.iter().enumerate() {
        if *character != '第' {
            continue;
        }
        let Some(label) = label_after(&characters, index + 1) else {
            continue;
        };
        // Require the closing 节/章 so "第3章" and "第4.2节" both count, but a
        // bare ordinal such as "第三点" does not.
        let closing = characters.get(index + 1 + label.chars().count());
        if matches!(closing, Some('节') | Some('章')) {
            found.push((CarrierKind::Section, label));
        }
    }
    found
}

fn label_after(characters: &[char], start: usize) -> Option<String> {
    let mut label = String::new();
    let mut index = start;
    while let Some(character) = characters.get(index) {
        if character.is_ascii_digit() || (*character == '.' && !label.is_empty()) {
            label.push(*character);
            index += 1;
        } else {
            break;
        }
    }
    let trimmed = label.trim_end_matches('.').to_string();
    (!trimmed.is_empty()).then_some(trimmed)
}

fn unnumbered_mentions(text: &str) -> Vec<String> {
    let mut words = Vec::new();
    let tokens = latin_tokens(text);
    for (index, token) in tokens.iter().enumerate() {
        if carrier_word(token).is_none() || label_in_same_token(token).is_some() {
            continue;
        }
        if tokens
            .get(index + 1)
            .and_then(|next| numeric_label(next))
            .is_none()
        {
            words.push(token.trim_end_matches('.').to_string());
        }
    }
    for word in ["表格", "图表"] {
        if text.contains(word) {
            words.push(word.to_string());
        }
    }
    words.sort();
    words.dedup();
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(text: &str) -> Vec<(CarrierKind, String)> {
        parse_binding(text)
            .carriers
            .into_iter()
            .map(|carrier| (carrier.kind, carrier.label))
            .collect()
    }

    #[test]
    fn reads_english_carriers_with_and_without_space() {
        assert_eq!(
            labels("what does Table 3 report for F1?"),
            [(CarrierKind::Table, "3".to_string())]
        );
        assert_eq!(
            labels("compare §4.2 against Figure 2 (b)"),
            [
                (CarrierKind::Section, "4.2".to_string()),
                (CarrierKind::Figure, "2".to_string())
            ]
        );
    }

    #[test]
    fn reads_chinese_carriers() {
        assert_eq!(
            labels("表3里报告的准确率是多少"),
            [(CarrierKind::Table, "3".to_string())]
        );
        assert_eq!(
            labels("第4.2节的方法与图2一致吗"),
            [
                (CarrierKind::Section, "4.2".to_string()),
                (CarrierKind::Figure, "2".to_string())
            ]
        );
    }

    #[test]
    fn a_bare_ordinal_is_not_a_section_carrier() {
        assert!(labels("第三点需要说明").is_empty());
    }

    #[test]
    fn one_carrier_narrows_and_two_do_not() {
        let single = parse_binding("Table 3 results");
        let constraint = single.narrow().expect("one carrier narrows");
        assert_eq!(constraint.section_hint, "table 3");
        assert_eq!(constraint.segment_types, vec![SegmentType::Table]);
        assert_eq!(single.unbound_reason(), None);

        let double = parse_binding("Table 3 and Figure 2");
        assert!(double.narrow().is_none());
        assert_eq!(
            double.unbound_reason(),
            Some(UnboundReason::MultipleCarriers)
        );
        assert_eq!(UnboundReason::MultipleCarriers.code(), "carrier_multiple");
    }

    #[test]
    fn an_unnumbered_carrier_reports_but_never_binds() {
        let binding = parse_binding("what does the table say?");
        assert!(binding.carriers.is_empty());
        assert_eq!(binding.unnumbered, ["table".to_string()]);
        assert_eq!(binding.unbound_reason(), Some(UnboundReason::Unnumbered));
        assert_eq!(UnboundReason::Unnumbered.code(), "carrier_unnumbered");
    }

    #[test]
    fn a_question_without_carriers_binds_nothing() {
        let binding = parse_binding("which dataset did they use?");
        assert!(binding.is_empty());
        assert_eq!(binding.unbound_reason(), None);
        assert!(binding.narrow().is_none());
    }

    #[test]
    fn repeated_mentions_collapse_to_one_carrier() {
        assert_eq!(
            labels("Table 3 vs table 3 again"),
            [(CarrierKind::Table, "3".to_string())]
        );
    }

    #[test]
    fn applying_never_overwrites_a_host_filter() {
        let mut query = SearchQuery::new("q");
        query.section_filter = Some("results".to_string());
        let constraint = parse_binding("Table 3").narrow().unwrap();
        assert!(apply_to_query(&constraint, &mut query));
        assert_eq!(query.section_filter.as_deref(), Some("results"));
        assert_eq!(query.segment_types, vec![SegmentType::Table]);

        let mut narrowed = SearchQuery::new("q");
        assert!(apply_to_query(&constraint, &mut narrowed));
        assert_eq!(narrowed.section_filter.as_deref(), Some("table 3"));
    }

    #[test]
    fn a_section_carrier_restricts_by_path_only() {
        let constraint = parse_binding("§4.2").narrow().unwrap();
        assert!(constraint.segment_types.is_empty());
        assert_eq!(constraint.section_hint, "4.2");
    }
}
