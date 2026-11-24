//! Scope-Rerank v6 tail swap, ported from the frozen decision rule.
//!
//! Locks ranks 1..=8. Slots 9 and 10 may each trade with one challenger from ranks
//! 11..=20. A missing model, a bad citation, a protected incumbent, or a failed
//! request keeps the cross-encoder order. The character budget overestimates
//! bge-m3 tokens, so a swap that would exceed 4096 is never sent.

use std::collections::BTreeSet;
use std::time::Duration;

use serde::Serialize;

use crate::result::{SearchHit, SearchTarget};

const THRESHOLD: f64 = 0.80;
const TOKEN_BUDGET: usize = 4096;
const LETTERS: [char; 3] = ['A', 'B', 'T'];
const LEVELS: [&str; 4] = ["L0", "L1", "L2", "L3"];
const SURVEY: [&str; 5] = [
    "introduction",
    "related work",
    "background",
    "conclusion",
    "future work",
];
const ABBREVIATIONS: [&str; 14] = [
    "et al.", "Fig.", "Eq.", "Dr.", "Mr.", "Mrs.", "Ms.", "U.S.", "e.g.", "i.e.", "vs.", "No.",
    "approx.", "cf.",
];
const NAME_STOP: &[&str] = &[
    "THE", "AND", "FOR", "WITH", "FROM", "THIS", "THAT", "THESE", "THOSE", "FIGURE", "TABLE",
    "SECTION", "USING", "INTO", "OVER", "SUCH", "THAN", "THEN", "ALSO", "ONLY", "BOTH", "EACH",
    "ALL", "NOT", "ARE", "WAS", "WERE", "HAS", "HAVE", "CAN", "MAY", "ONE", "TWO", "NEW", "OUR",
    "VIA", "PER", "TOP", "LOW", "HIGH", "OTHER", "SAME", "PAPER", "TASK", "DATA", "NOTE", "FIRST",
    "SECOND", "THIRD", "GIVEN", "WHERE", "WHEN", "WHAT", "WHICH", "WHILE", "AFTER", "BEFORE",
    "BETWEEN", "AMONG", "WITHIN",
];
const WORD_STOP: &[&str] = &[
    "which", "their", "there", "about", "other", "based", "these", "those", "using", "paper",
    "study", "table", "figure", "where", "while", "after", "before", "would", "could", "should",
    "under", "between",
];
const GENERIC_TOPIC: &[&str] = &[
    "question",
    "questions",
    "performance",
    "information",
    "different",
    "language",
    "example",
    "description",
    "properties",
    "results",
    "result",
    "system",
    "method",
    "methods",
    "model",
    "models",
    "dataset",
    "datasets",
    "approach",
    "approaches",
    "paper",
    "task",
    "tasks",
    "using",
    "based",
    "other",
    "these",
    "those",
];

const SYSTEM_PROMPT: &str =
    "You fill one JSON object. Copy the keys exactly. Do not add an explanation.";
const PASSAGE_USER: &str = "Question: {question}\nChapter: {chapter}\nAnchor: {anchor}\nValid_Sentences: {valid}\nSentences:\n{sentences}\n\nReturn one JSON object with these keys: target_object, passage_object, dataset_setting_match, metric_target_match, scope_label, evidence_level, evidence_label, cited_sentences.\npassage_object is \"paper's own\", \"cited baseline\", \"other\", or \"unspecified\".\ndataset_setting_match and metric_target_match are each \"match\", \"conflict\", or \"unspecified\".\nscope_label A: same object, dataset, condition, and metric. A missing value is still A.\nscope_label B: a different object, dataset, condition, or metric, including a cited baseline when the question asks about this paper.\nscope_label T: the object or dataset is not named, and the anchor does not supply it.\nevidence_level L3: a number, a numbered finding, several named items, or a table or figure caption that names the asked object or metric.\nevidence_level L2: one concrete name or one mechanism outside introduction, related work, background, conclusion, and future work.\nevidence_level L1: a survey preview, or a qualitative claim without a number, a numbered item, or a specific name.\nevidence_level L0: a conflict, or no relevant statement.\nIf an anchor is present, the passage may use the anchor's object and dataset. A subclass, a data split, a new dataset item, or a parallel result is L3.\nevidence_label A: L2 or L3, and the cited sentence states the asked fact.\nevidence_label B: same scope, but the value or name is missing.\nevidence_label T: no asked fact.\ncited_sentences is a list of S numbers copied from Valid_Sentences when evidence_label is A. Use an empty list when evidence_label is B or T.";
const MISSING_CHAPTER: &str = "(none)";
const MISSING_ANCHOR: &str = "(none)";

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LetterProbs {
    pub a: f64,
    pub b: f64,
    pub t: f64,
}

impl LetterProbs {
    fn get(self, letter: char) -> f64 {
        match letter {
            'A' => self.a,
            'B' => self.b,
            'T' => self.t,
            _ => 0.0,
        }
    }
}

/// One incumbent/challenger pair in the shape the frozen rule reads.
#[derive(Clone, Debug)]
pub struct ScopeItem {
    pub question: String,
    pub chapter_incumbent: String,
    pub chapter_challenger: String,
    pub chapter_anchor: String,
    pub text_incumbent: String,
    pub text_challenger: String,
    pub text_anchor: String,
    pub text_top8: String,
    pub adjacent: bool,
    pub delta_s: Option<i64>,
    pub over_budget: bool,
    pub duplicate: bool,
    pub empty: bool,
    pub position: i32,
    pub bge_rank: i32,
    pub challenger_uid: String,
    pub incumbent_uid: String,
    pub scope_incumbent: Option<char>,
    pub scope_incumbent_probs: Option<LetterProbs>,
    pub scope_challenger: Option<char>,
    pub scope_challenger_probs: Option<LetterProbs>,
    pub evidence_incumbent: Option<char>,
    pub evidence_incumbent_probs: Option<LetterProbs>,
    pub evidence_challenger: Option<char>,
    pub evidence_challenger_probs: Option<LetterProbs>,
    pub level_incumbent: Option<String>,
    pub level_challenger: Option<String>,
    pub cite_incumbent: Option<Vec<i64>>,
    pub cite_challenger: Option<Vec<i64>>,
}

impl Default for ScopeItem {
    fn default() -> Self {
        Self {
            question: String::new(),
            chapter_incumbent: String::new(),
            chapter_challenger: String::new(),
            chapter_anchor: String::new(),
            text_incumbent: String::new(),
            text_challenger: String::new(),
            text_anchor: String::new(),
            text_top8: String::new(),
            adjacent: false,
            delta_s: None,
            over_budget: false,
            duplicate: false,
            empty: false,
            position: 10,
            bge_rank: 12,
            challenger_uid: "challenger".to_string(),
            incumbent_uid: "incumbent".to_string(),
            scope_incumbent: None,
            scope_incumbent_probs: None,
            scope_challenger: None,
            scope_challenger_probs: None,
            evidence_incumbent: None,
            evidence_incumbent_probs: None,
            evidence_challenger: None,
            evidence_challenger_probs: None,
            level_incumbent: None,
            level_challenger: None,
            cite_incumbent: Some(Vec::new()),
            cite_challenger: Some(Vec::new()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScopeDecision {
    pub position: i32,
    pub bge_rank: i32,
    pub challenger_uid: String,
    pub incumbent_uid: String,
    pub path: String,
    pub min_score: f64,
}

/// One tail swap the product reports. Empty when the cross-encoder order stands.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ScopeSwapSummary {
    pub slot: i32,
    pub path: String,
    pub challenger_uid: String,
    pub incumbent_uid: String,
}

#[derive(Clone, Debug)]
pub struct ScopeJudgeRequest {
    pub key: String,
    pub question: String,
    pub chapter: String,
    pub anchor: String,
    pub text: String,
}

#[derive(Clone, Debug)]
pub struct PassageJudgment {
    pub scope: Option<LetterProbs>,
    pub evidence: Option<LetterProbs>,
    pub level: Option<String>,
    pub cites: Option<Vec<i64>>,
    pub api_error: bool,
}

impl PassageJudgment {
    fn blank() -> Self {
        Self {
            scope: None,
            evidence: None,
            level: None,
            cites: None,
            api_error: false,
        }
    }
}

#[derive(Debug)]
pub struct ScopeJudgeError;

pub trait ScopeJudgeProvider: Send + Sync {
    fn judge_batch(
        &self,
        requests: &[ScopeJudgeRequest],
    ) -> Result<Vec<PassageJudgment>, ScopeJudgeError>;
}

/// What the tail stage did. `errored` keeps the incoming order.
#[derive(Clone, Debug)]
pub struct ScopeRefineReport {
    pub hits: Vec<SearchHit>,
    pub ran: bool,
    pub errored: bool,
    pub swaps: Vec<ScopeSwapSummary>,
}

#[derive(Clone)]
pub struct HttpScopeJudge {
    client: reqwest::blocking::Client,
    endpoint: String,
    model: String,
    api_key: String,
    max_concurrency: usize,
}

impl std::fmt::Debug for HttpScopeJudge {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HttpScopeJudge")
            .field("endpoint", &self.endpoint)
            .field("model", &self.model)
            .field("max_concurrency", &self.max_concurrency)
            .finish()
    }
}

impl HttpScopeJudge {
    pub fn new(
        endpoint: String,
        model: String,
        api_key: String,
        timeout_ms: u64,
        max_concurrency: usize,
    ) -> Result<Self, ScopeJudgeError> {
        let endpoint = endpoint.trim().to_string();
        if endpoint.is_empty() || model.trim().is_empty() || api_key.trim().is_empty() {
            return Err(ScopeJudgeError);
        }
        let https = endpoint.starts_with("https://");
        let loopback =
            endpoint.starts_with("http://") && neuink_config::is_loopback_endpoint(&endpoint);
        if !https && !loopback {
            return Err(ScopeJudgeError);
        }
        let mut builder =
            reqwest::blocking::Client::builder().timeout(Duration::from_millis(timeout_ms.max(1)));
        if loopback {
            builder = builder.no_proxy();
        }
        let client = builder.build().map_err(|_| ScopeJudgeError)?;
        Ok(Self {
            client,
            endpoint,
            model: model.trim().to_string(),
            api_key,
            max_concurrency: max_concurrency.clamp(1, 16),
        })
    }
}

impl ScopeJudgeProvider for HttpScopeJudge {
    fn judge_batch(
        &self,
        requests: &[ScopeJudgeRequest],
    ) -> Result<Vec<PassageJudgment>, ScopeJudgeError> {
        if requests.is_empty() {
            return Ok(Vec::new());
        }
        let workers = self.max_concurrency.min(requests.len()).max(1);
        if workers == 1 {
            return collapse_attempts(
                requests
                    .iter()
                    .map(|request| self.judge_one(request))
                    .collect(),
            );
        }
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(workers)
            .build()
            .map_err(|_| ScopeJudgeError)?;
        let attempts: Vec<Result<PassageJudgment, ()>> = pool.install(|| {
            use rayon::prelude::*;
            requests
                .par_iter()
                .map(|request| self.judge_one(request))
                .collect()
        });
        collapse_attempts(attempts)
    }
}

fn is_word_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

fn boundary_before(chars: &[char], index: usize) -> bool {
    index == 0 || !is_word_char(chars[index - 1])
}

fn boundary_after(chars: &[char], index: usize) -> bool {
    index >= chars.len() || !is_word_char(chars[index])
}

fn blank_span(chars: &mut [char], start: usize, end: usize) {
    for ch in &mut chars[start..end] {
        *ch = ' ';
    }
}

fn consume_number(chars: &[char], start: usize) -> Option<usize> {
    if start >= chars.len() || !chars[start].is_ascii_digit() {
        return None;
    }
    let mut index = start + 1;
    while index < chars.len() && chars[index].is_ascii_digit() {
        index += 1;
    }
    if index + 1 < chars.len() && chars[index] == '.' && chars[index + 1].is_ascii_digit() {
        index += 2;
        while index < chars.len() && chars[index].is_ascii_digit() {
            index += 1;
        }
    }
    Some(index)
}

fn unit_end(chars: &[char], index: usize) -> Option<usize> {
    const UNITS: [&str; 5] = ["em", "pt", "px", "cm", "mm"];
    for unit in UNITS {
        let unit_chars: Vec<char> = unit.chars().collect();
        let end = index + unit_chars.len();
        if end <= chars.len() && chars[index..end] == unit_chars[..] && boundary_after(chars, end) {
            return Some(end);
        }
    }
    None
}

fn scrub_units_and_hours(chars: &mut [char]) {
    let mut index = 0;
    while index < chars.len() {
        if let Some(number_end) = consume_number(chars, index) {
            if let Some(end) = unit_end(chars, number_end) {
                blank_span(chars, index, end);
                index = end;
                continue;
            }
            if number_end < chars.len()
                && chars[number_end] == 'h'
                && boundary_after(chars, number_end + 1)
            {
                blank_span(chars, index, number_end + 1);
                index = number_end + 1;
                continue;
            }
        }
        index += 1;
    }
}

fn scrub_labeled_decimal(chars: &mut [char]) {
    let mut index = 0;
    while index < chars.len() {
        if chars[index].is_ascii_uppercase() && boundary_before(chars, index) {
            let mut cursor = index + 1;
            while cursor < chars.len() && chars[cursor].is_ascii_alphanumeric() {
                cursor += 1;
            }
            if cursor < chars.len() && (chars[cursor] == '-' || chars[cursor] == ' ') {
                let digits = cursor + 1;
                if let Some(number_end) = consume_number(chars, digits) {
                    if number_end >= digits + 2
                        && chars[number_end - 2] == '.'
                        && chars[number_end - 1] == '0'
                        && boundary_after(chars, number_end)
                        && chars[digits..number_end].contains(&'.')
                    {
                        let whole = &chars[digits..number_end];
                        if whole.ends_with(&['.', '0']) && !whole[..whole.len() - 2].contains(&'.')
                        {
                            blank_span(chars, index, number_end);
                            index = number_end;
                            continue;
                        }
                    }
                }
            }
        }
        index += 1;
    }
}

fn is_year(token: &str) -> bool {
    let bytes = token.as_bytes();
    bytes.len() == 4
        && bytes[2].is_ascii_digit()
        && bytes[3].is_ascii_digit()
        && ((bytes[0] == b'1' && bytes[1] == b'9') || (bytes[0] == b'2' && bytes[1] == b'0'))
}

pub fn metric_numbers(text: &str) -> BTreeSet<String> {
    let mut chars: Vec<char> = text.chars().collect();
    scrub_units_and_hours(&mut chars);
    scrub_labeled_decimal(&mut chars);
    let mut found = BTreeSet::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index].is_ascii_digit() && boundary_before(&chars, index) {
            if let Some(mut end) = consume_number(&chars, index) {
                let mut token: String = chars[index..end].iter().collect();
                if end < chars.len() && chars[end] == '%' {
                    token.push('%');
                    end += 1;
                }
                let keep = token.ends_with('%')
                    || token.contains('.')
                    || (!is_year(&token) && token.parse::<i64>().unwrap_or(0) >= 10);
                if keep {
                    found.insert(token);
                }
                index = end;
                continue;
            }
        }
        index += 1;
    }
    found
}

fn take_camel(chars: &[char], start: usize) -> Option<usize> {
    if !boundary_before(chars, start) || !chars[start].is_ascii_uppercase() {
        return None;
    }
    let mut cursor = start + 1;
    let lower_start = cursor;
    while cursor < chars.len() && chars[cursor].is_ascii_lowercase() {
        cursor += 1;
    }
    if cursor == lower_start {
        return None;
    }
    let mut groups = 0;
    loop {
        if cursor >= chars.len() || !chars[cursor].is_ascii_uppercase() {
            break;
        }
        let body = cursor + 1;
        let mut next = body;
        while next < chars.len()
            && (chars[next].is_ascii_lowercase() || chars[next].is_ascii_digit())
        {
            next += 1;
        }
        if next == body {
            break;
        }
        cursor = next;
        groups += 1;
    }
    if groups == 0 || !boundary_after(chars, cursor) {
        None
    } else {
        Some(cursor)
    }
}

fn take_mixed(chars: &[char], start: usize) -> Option<usize> {
    if !boundary_before(chars, start) || !chars[start].is_ascii_uppercase() {
        return None;
    }
    let mut cursor = start + 1;
    while cursor < chars.len() && chars[cursor].is_ascii_uppercase() {
        cursor += 1;
    }
    if cursor < start + 2 {
        return None;
    }
    let lower_start = cursor;
    while cursor < chars.len() && chars[cursor].is_ascii_lowercase() {
        cursor += 1;
    }
    if cursor == lower_start || cursor >= chars.len() || !chars[cursor].is_ascii_uppercase() {
        return None;
    }
    cursor += 1;
    while cursor < chars.len() && chars[cursor].is_ascii_alphanumeric() {
        cursor += 1;
    }
    if boundary_after(chars, cursor) {
        Some(cursor)
    } else {
        None
    }
}

fn take_acronym(chars: &[char], start: usize) -> Option<usize> {
    if !boundary_before(chars, start) || !chars[start].is_ascii_uppercase() {
        return None;
    }
    let mut cursor = start + 1;
    while cursor < chars.len() && chars[cursor].is_ascii_uppercase() {
        cursor += 1;
    }
    if cursor < start + 3 {
        return None;
    }
    let mut end = cursor;
    if cursor < chars.len() && chars[cursor] == '-' {
        let mut digits = cursor + 1;
        let digit_start = digits;
        while digits < chars.len() && chars[digits].is_ascii_digit() {
            digits += 1;
        }
        if digits > digit_start {
            end = digits;
        }
    }
    if boundary_after(chars, end) {
        Some(end)
    } else {
        None
    }
}

pub fn names(text: &str) -> BTreeSet<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut found = BTreeSet::new();
    let mut index = 0;
    while index < chars.len() {
        if let Some(end) = take_camel(&chars, index) {
            found.insert(chars[index..end].iter().collect());
            index = end;
            continue;
        }
        if let Some(end) = take_mixed(&chars, index) {
            found.insert(chars[index..end].iter().collect());
            index = end;
            continue;
        }
        if let Some(end) = take_acronym(&chars, index) {
            let token: String = chars[index..end].iter().collect();
            if !NAME_STOP.contains(&token.as_str()) && !token.starts_with("BIB") {
                found.insert(token);
            }
            index = end;
            continue;
        }
        index += 1;
    }
    found
}

fn content_words(text: &str) -> BTreeSet<String> {
    let chars: Vec<char> = text.to_lowercase().chars().collect();
    let mut found = BTreeSet::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index].is_ascii_lowercase() {
            let start = index;
            while index < chars.len() && chars[index].is_ascii_lowercase() {
                index += 1;
            }
            if index - start >= 5 {
                let word: String = chars[start..index].iter().collect();
                if !WORD_STOP.contains(&word.as_str()) {
                    found.insert(word);
                }
            }
        } else {
            index += 1;
        }
    }
    found
}

pub fn split_sentences(text: &str) -> Vec<String> {
    let cleaned = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        return Vec::new();
    }
    let mut protected = cleaned;
    let mut replacements = Vec::new();
    for abbreviation in ABBREVIATIONS {
        if !protected.contains(abbreviation) {
            continue;
        }
        let token = format!("\u{0}{}\u{0}", replacements.len());
        protected = protected.replace(abbreviation, &token);
        replacements.push((token, abbreviation));
    }
    let chars: Vec<char> = protected.chars().collect();
    let mut parts = Vec::new();
    let mut start = 0;
    let mut index = 0;
    while index < chars.len() {
        if matches!(chars[index], '.' | '!' | '?') {
            let mut cursor = index + 1;
            let whitespace = cursor;
            while cursor < chars.len() && chars[cursor].is_whitespace() {
                cursor += 1;
            }
            if cursor > whitespace
                && cursor < chars.len()
                && (chars[cursor].is_ascii_uppercase() || chars[cursor].is_ascii_digit())
            {
                parts.push(chars[start..=index].iter().collect::<String>());
                start = cursor;
                index = cursor;
                continue;
            }
        }
        index += 1;
    }
    if start < chars.len() {
        parts.push(chars[start..].iter().collect::<String>());
    }
    parts
        .into_iter()
        .filter_map(|mut part| {
            for (token, abbreviation) in &replacements {
                part = part.replace(token, abbreviation);
            }
            let part = part.trim().to_string();
            if part.is_empty() {
                None
            } else {
                Some(part)
            }
        })
        .collect()
}

pub fn lookup_sentence(text: &str, index: i64) -> Option<String> {
    if index < 1 {
        return None;
    }
    split_sentences(text).into_iter().nth((index as usize) - 1)
}

fn is_survey(chapter: &str) -> bool {
    let text = chapter.to_lowercase();
    SURVEY.iter().any(|part| text.contains(part))
}

fn asked_named(question: &str, caption: &str) -> bool {
    let specific: BTreeSet<String> = content_words(question)
        .intersection(&content_words(caption))
        .filter(|word| !GENERIC_TOPIC.contains(&word.as_str()))
        .cloned()
        .collect();
    specific.len() >= 2 || specific.iter().any(|word| word.chars().count() >= 7)
}

fn is_table_caption(text: &str) -> bool {
    let raw = text.trim_start();
    let lower = raw.to_ascii_lowercase();
    let rest = if let Some(rest) = lower.strip_prefix("table") {
        &raw[raw.len() - rest.len()..]
    } else if let Some(rest) = lower.strip_prefix("figure") {
        &raw[raw.len() - rest.len()..]
    } else {
        return false;
    };
    let chars: Vec<char> = rest.chars().collect();
    let mut index = 0;
    if index >= chars.len() || !chars[index].is_whitespace() {
        return false;
    }
    while index < chars.len() && chars[index].is_whitespace() {
        index += 1;
    }
    if index >= chars.len() || !chars[index].is_ascii_digit() {
        return false;
    }
    while index < chars.len() && chars[index].is_ascii_digit() {
        index += 1;
    }
    while index < chars.len() && chars[index].is_whitespace() {
        index += 1;
    }
    index < chars.len() && (chars[index] == ':' || chars[index] == '.')
}

fn anchor_bound(item: &ScopeItem) -> bool {
    if item.text_anchor.is_empty() || is_survey(&item.chapter_challenger) {
        return false;
    }
    if item.chapter_anchor != item.chapter_challenger {
        return false;
    }
    if let Some(delta) = item.delta_s {
        delta.abs() <= 2
    } else {
        item.adjacent
    }
}

fn table_bound(item: &ScopeItem) -> bool {
    is_table_caption(&item.text_challenger) && asked_named(&item.question, &item.text_challenger)
}

fn set_without(source: &BTreeSet<String>, others: &[&BTreeSet<String>]) -> BTreeSet<String> {
    source
        .iter()
        .filter(|value| others.iter().all(|other| !other.contains(*value)))
        .cloned()
        .collect()
}

fn enum_ready(item: &ScopeItem) -> bool {
    if is_survey(&item.chapter_challenger) {
        return false;
    }
    let top_names = names(&item.text_top8);
    let top_metrics = metric_numbers(&item.text_top8);
    if top_names.is_empty() && top_metrics.is_empty() {
        return false;
    }
    let incumbent_names = names(&item.text_incumbent);
    let incumbent_metrics = metric_numbers(&item.text_incumbent);
    if !incumbent_names.is_subset(&top_names) || !incumbent_metrics.is_subset(&top_metrics) {
        return false;
    }
    let challenger_names = names(&item.text_challenger);
    let challenger_metrics = metric_numbers(&item.text_challenger);
    !set_without(&challenger_names, &[&top_names, &incumbent_names]).is_empty()
        || !set_without(&challenger_metrics, &[&top_metrics, &incumbent_metrics]).is_empty()
}

fn strong_metrics(text: &str) -> BTreeSet<String> {
    metric_numbers(text)
        .into_iter()
        .filter(|token| token.contains('.') || token.ends_with('%'))
        .collect()
}

pub fn protected(item: &ScopeItem) -> bool {
    if is_survey(&item.chapter_incumbent) {
        return false;
    }
    let incumbent_metrics = strong_metrics(&item.text_incumbent);
    let top_metrics = strong_metrics(&item.text_top8);
    let challenger_metrics = strong_metrics(&item.text_challenger);
    let incumbent_names = names(&item.text_incumbent);
    let top_names = names(&item.text_top8);
    let challenger_names = names(&item.text_challenger);
    !set_without(&incumbent_metrics, &[&top_metrics, &challenger_metrics]).is_empty()
        || !set_without(&incumbent_names, &[&top_names, &challenger_names]).is_empty()
}

fn letter_probs(letter: char) -> LetterProbs {
    let rest = (1.0 - 0.92) / 2.0;
    LetterProbs {
        a: if letter == 'A' { 0.92 } else { rest },
        b: if letter == 'B' { 0.92 } else { rest },
        t: if letter == 'T' { 0.92 } else { rest },
    }
}

fn resolve_probs(probs: Option<LetterProbs>, letter: Option<char>) -> LetterProbs {
    if let Some(probs) = probs {
        return probs;
    }
    letter.map(letter_probs).unwrap_or(LetterProbs {
        a: 0.0,
        b: 0.0,
        t: 0.0,
    })
}

fn confident(probs: LetterProbs) -> Option<char> {
    let mut best = 'A';
    let mut score = probs.a;
    if probs.b > score {
        best = 'B';
        score = probs.b;
    }
    if probs.t > score {
        best = 'T';
        score = probs.t;
    }
    if score < THRESHOLD {
        None
    } else {
        Some(best)
    }
}

pub fn citation_ok(text: &str, cites: Option<&[i64]>, evidence: Option<char>) -> bool {
    let Some(cites) = cites else {
        return false;
    };
    for index in cites {
        if lookup_sentence(text, *index).is_none() {
            return false;
        }
    }
    !(evidence == Some('A') && cites.is_empty())
}

fn known_level(level: Option<&str>) -> bool {
    level.is_some_and(|level| LEVELS.contains(&level))
}

fn challenger_ready(
    item: &ScopeItem,
    challenger_scope: Option<char>,
    challenger_evidence: Option<char>,
    challenger_level: &str,
) -> bool {
    let survey = is_survey(&item.chapter_challenger);
    let direct = challenger_scope == Some('A')
        && challenger_evidence == Some('A')
        && (challenger_level == "L2" || challenger_level == "L3")
        && (!survey || table_bound(item));
    let structural = (anchor_bound(item) || table_bound(item))
        && challenger_level == "L3"
        && matches!(challenger_evidence, Some('A') | Some('B'))
        && challenger_scope != Some('B');
    direct || structural
}

pub fn decide(item: &ScopeItem) -> Option<ScopeDecision> {
    if item.over_budget || item.duplicate || item.empty {
        return None;
    }
    let scope_incumbent_probs = resolve_probs(item.scope_incumbent_probs, item.scope_incumbent);
    let scope_challenger_probs = resolve_probs(item.scope_challenger_probs, item.scope_challenger);
    let evidence_incumbent_probs =
        resolve_probs(item.evidence_incumbent_probs, item.evidence_incumbent);
    let evidence_challenger_probs =
        resolve_probs(item.evidence_challenger_probs, item.evidence_challenger);
    let incumbent_scope = confident(scope_incumbent_probs);
    let challenger_scope = confident(scope_challenger_probs);
    let incumbent_evidence = confident(evidence_incumbent_probs);
    let challenger_evidence = confident(evidence_challenger_probs);
    if !citation_ok(
        item.text_incumbent.as_str(),
        item.cite_incumbent.as_deref(),
        incumbent_evidence,
    ) || !citation_ok(
        item.text_challenger.as_str(),
        item.cite_challenger.as_deref(),
        challenger_evidence,
    ) || protected(item)
        || !known_level(item.level_incumbent.as_deref())
        || !known_level(item.level_challenger.as_deref())
    {
        return None;
    }
    let mut incumbent_level = item.level_incumbent.clone().unwrap_or_default();
    if incumbent_level == "L1" && incumbent_evidence == Some('A') {
        incumbent_level = "L2".to_string();
    }
    let challenger_level = item.level_challenger.clone().unwrap_or_default();
    if !challenger_ready(
        item,
        challenger_scope,
        challenger_evidence,
        &challenger_level,
    ) {
        return None;
    }
    if incumbent_scope == Some('A')
        && incumbent_evidence == Some('A')
        && (incumbent_level == "L2" || incumbent_level == "L3")
        && !enum_ready(item)
    {
        return None;
    }
    if !is_survey(&item.chapter_incumbent)
        && incumbent_scope == Some('A')
        && incumbent_evidence == Some('B')
        && (incumbent_level == "L2" || incumbent_level == "L3")
        && challenger_level != "L3"
        && !(enum_ready(item) || anchor_bound(item) || table_bound(item))
    {
        return None;
    }
    let anchor_only = anchor_bound(item) && !table_bound(item);
    if anchor_only
        && incumbent_scope != Some('B')
        && !(is_survey(&item.chapter_incumbent) || incumbent_level == "L0")
    {
        return None;
    }
    let path = if incumbent_scope == Some('B') {
        "scope"
    } else if anchor_bound(item) || table_bound(item) {
        "anchor_or_table"
    } else if enum_ready(item) {
        "enum_upgrade"
    } else {
        "coverage"
    };
    if path == "coverage" && challenger_level == "L2" {
        let challenger_text = item.text_challenger.as_str();
        if names(challenger_text).is_empty() && metric_numbers(challenger_text).is_empty() {
            return None;
        }
    }
    let mut required = vec![scope_challenger_probs.get(challenger_scope.unwrap_or('A'))];
    if challenger_evidence == Some('A') {
        required.push(evidence_challenger_probs.get('A'));
    }
    if path == "scope" {
        required.push(scope_incumbent_probs.get('B'));
    }
    let min_score = required.into_iter().fold(f64::INFINITY, f64::min);
    Some(ScopeDecision {
        position: item.position,
        bge_rank: item.bge_rank,
        challenger_uid: item.challenger_uid.clone(),
        incumbent_uid: item.incumbent_uid.clone(),
        path: path.to_string(),
        min_score: if min_score.is_finite() {
            min_score
        } else {
            0.0
        },
    })
}

#[cfg(test)]
pub fn apply_swap(uids: &[&str], position: i32, challenger_uid: &str) -> Vec<String> {
    let mut updated = uids
        .iter()
        .map(|uid| (*uid).to_string())
        .collect::<Vec<_>>();
    if (position != 9 && position != 10) || updated.iter().any(|uid| uid == challenger_uid) {
        return updated;
    }
    let index = (position as usize) - 1;
    if index < updated.len() {
        updated[index] = challenger_uid.to_string();
    }
    updated
}

pub fn select_swaps(candidates: &[ScopeDecision]) -> Vec<ScopeDecision> {
    let mut ranked = candidates.to_vec();
    ranked.sort_by(|left, right| {
        right
            .min_score
            .total_cmp(&left.min_score)
            .then(right.position.cmp(&left.position))
            .then(left.bge_rank.cmp(&right.bge_rank))
            .then(left.challenger_uid.cmp(&right.challenger_uid))
    });
    let mut chosen = Vec::new();
    let mut used_positions = BTreeSet::new();
    for item in ranked {
        if used_positions.contains(&item.position)
            || chosen
                .iter()
                .any(|row: &ScopeDecision| row.challenger_uid == item.challenger_uid)
        {
            continue;
        }
        used_positions.insert(item.position);
        chosen.push(item);
        if chosen.len() == 2 {
            break;
        }
    }
    chosen
}

/// QASPER-style `…:s<digits>` suffix. Other workspace uid shapes have no neighbor index,
/// so the anchor path stays off and the other three paths still run.
fn segment_index(uid: &str) -> Option<i64> {
    let tail = uid.rsplit_once(":s")?.1;
    if tail.is_empty() || !tail.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    tail.parse().ok()
}

fn segment_uid(hit: &SearchHit) -> Option<String> {
    match &hit.target {
        SearchTarget::Segment { segment_uid, .. } => Some(segment_uid.to_string()),
        _ => None,
    }
}

fn hit_key(hit: &SearchHit) -> String {
    crate::retrieval_pipeline::hit_identity(hit)
}

fn chapter_of(hit: &SearchHit) -> String {
    hit.source.section_path.clone().unwrap_or_default()
}

fn choose_anchor(challenger: &SearchHit, top8: &[SearchHit]) -> (String, String, Option<i64>) {
    let chapter = chapter_of(challenger);
    let Some(origin) = segment_uid(challenger).as_deref().and_then(segment_index) else {
        return (String::new(), String::new(), None);
    };
    if chapter.is_empty() || is_survey(&chapter) {
        return (String::new(), String::new(), None);
    }
    let mut best: Option<(usize, String, i64)> = None;
    for (offset, hit) in top8.iter().enumerate() {
        if hit.entry_id != challenger.entry_id || chapter_of(hit) != chapter {
            continue;
        }
        let Some(other) = segment_uid(hit).as_deref().and_then(segment_index) else {
            continue;
        };
        let delta = (other - origin).abs();
        if delta > 2 {
            continue;
        }
        let rank = offset + 1;
        if best
            .as_ref()
            .map(|current| rank < current.0)
            .unwrap_or(true)
        {
            best = Some((rank, hit.snippet.clone(), delta));
        }
    }
    match best {
        Some((_, text, delta)) => (text, chapter, Some(delta)),
        None => (String::new(), String::new(), None),
    }
}

/// Upper bound on bge-m3 tokens without shipping the tokenizer.
///
/// English is about 4–5 characters per token, so three characters per estimated token
/// still rejects a real 4096-token passage. A CJK character counts as one token.
/// Empty pieces are dropped, then the rest are joined with a newline, matching v6.
fn estimated_tokens(text: &str) -> usize {
    let mut ascii = 0usize;
    let mut other = 0usize;
    for ch in text.chars() {
        if ch.is_ascii() {
            ascii += 1;
        } else {
            other += 1;
        }
    }
    ascii.div_ceil(3) + other
}

fn over_budget(incumbent: &str, challenger: &str, anchor: &str) -> bool {
    let joined = [incumbent, challenger, anchor]
        .into_iter()
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    estimated_tokens(&joined) > TOKEN_BUDGET
}

struct PendingPair {
    item: ScopeItem,
    incumbent_key: String,
    challenger_key: String,
}

fn pending_pairs(hits: &[SearchHit], question: &str) -> (Vec<PendingPair>, Vec<ScopeJudgeRequest>) {
    let top_end = hits.len().min(8);
    let top8 = &hits[..top_end];
    let top8_text = top8
        .iter()
        .map(|hit| hit.snippet.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let mut pairs = Vec::new();
    let mut needed: Vec<ScopeJudgeRequest> = Vec::new();
    let mut seen = BTreeSet::new();
    for slot in [8usize, 9] {
        if slot >= hits.len() {
            continue;
        }
        let incumbent = &hits[slot];
        let incumbent_key = hit_key(incumbent);
        for (offset, challenger) in hits.iter().enumerate().skip(10).take(10) {
            let challenger_key = hit_key(challenger);
            let (anchor_text, anchor_chapter, delta) = choose_anchor(challenger, top8);
            let mut item = ScopeItem {
                question: question.to_string(),
                chapter_incumbent: chapter_of(incumbent),
                chapter_challenger: chapter_of(challenger),
                chapter_anchor: anchor_chapter,
                text_incumbent: incumbent.snippet.clone(),
                text_challenger: challenger.snippet.clone(),
                text_anchor: anchor_text.clone(),
                text_top8: top8_text.clone(),
                adjacent: !anchor_text.is_empty(),
                delta_s: delta,
                position: (slot as i32) + 1,
                bge_rank: (offset as i32) + 1,
                challenger_uid: challenger_key.clone(),
                incumbent_uid: incumbent_key.clone(),
                ..ScopeItem::default()
            };
            if item.text_incumbent.is_empty() || item.text_challenger.is_empty() {
                continue;
            }
            if over_budget(
                &item.text_incumbent,
                &item.text_challenger,
                &item.text_anchor,
            ) {
                item.over_budget = true;
            }
            if item.over_budget || protected(&item) {
                continue;
            }
            for (key, hit) in [(&incumbent_key, incumbent), (&challenger_key, challenger)] {
                if !seen.insert(key.clone()) {
                    continue;
                }
                let (anchor, _chapter, _delta) = choose_anchor(hit, top8);
                needed.push(ScopeJudgeRequest {
                    key: key.clone(),
                    question: question.to_string(),
                    chapter: chapter_of(hit),
                    anchor,
                    text: hit.snippet.clone(),
                });
            }
            pairs.push(PendingPair {
                item,
                incumbent_key: incumbent_key.clone(),
                challenger_key,
            });
        }
    }
    (pairs, needed)
}

fn apply_hit_swaps(hits: &mut [SearchHit], swaps: &[ScopeDecision]) -> Vec<ScopeSwapSummary> {
    let mut ordered = swaps.to_vec();
    ordered.sort_by_key(|item| item.position);
    let mut applied = Vec::new();
    for swap in ordered {
        if swap.position != 9 && swap.position != 10 {
            continue;
        }
        let slot = (swap.position as usize) - 1;
        if slot >= hits.len() {
            continue;
        }
        let Some(index) = hits
            .iter()
            .position(|hit| hit_key(hit) == swap.challenger_uid)
        else {
            continue;
        };
        if index < 10 {
            continue;
        }
        let incumbent_uid = hit_key(&hits[slot]);
        let challenger_uid = hit_key(&hits[index]);
        hits.swap(slot, index);
        applied.push(ScopeSwapSummary {
            slot: swap.position,
            path: swap.path.clone(),
            challenger_uid,
            incumbent_uid,
        });
    }
    applied
}

pub fn refine_tail_with_scope_v6(
    hits: &[SearchHit],
    question: &str,
    judge: &dyn ScopeJudgeProvider,
) -> ScopeRefineReport {
    if hits.len() <= 10 {
        return ScopeRefineReport {
            hits: hits.to_vec(),
            ran: false,
            errored: false,
            swaps: Vec::new(),
        };
    }
    let (pairs, requests) = pending_pairs(hits, question);
    let judged = if requests.is_empty() {
        Vec::new()
    } else {
        match judge.judge_batch(&requests) {
            Ok(judged) => judged,
            Err(_) => {
                return ScopeRefineReport {
                    hits: hits.to_vec(),
                    ran: true,
                    errored: true,
                    swaps: Vec::new(),
                };
            }
        }
    };
    if judged.iter().any(|judgment| judgment.api_error) {
        return ScopeRefineReport {
            hits: hits.to_vec(),
            ran: true,
            errored: true,
            swaps: Vec::new(),
        };
    }
    let by_key = requests
        .iter()
        .zip(judged.iter())
        .map(|(request, judgment)| (request.key.as_str(), judgment))
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut qualified = Vec::new();
    for pair in &pairs {
        let Some(incumbent) = by_key.get(pair.incumbent_key.as_str()) else {
            continue;
        };
        let Some(challenger) = by_key.get(pair.challenger_key.as_str()) else {
            continue;
        };
        if incumbent.api_error || challenger.api_error {
            continue;
        }
        let mut item = pair.item.clone();
        item.scope_incumbent_probs = incumbent.scope;
        item.evidence_incumbent_probs = incumbent.evidence;
        item.level_incumbent = incumbent.level.clone();
        item.cite_incumbent = incumbent.cites.clone();
        item.scope_challenger_probs = challenger.scope;
        item.evidence_challenger_probs = challenger.evidence;
        item.level_challenger = challenger.level.clone();
        item.cite_challenger = challenger.cites.clone();
        item.scope_incumbent = None;
        item.scope_challenger = None;
        item.evidence_incumbent = None;
        item.evidence_challenger = None;
        if let Some(decision) = decide(&item) {
            qualified.push(decision);
        }
    }
    let selected = select_swaps(&qualified);
    let mut ordered = hits.to_vec();
    let swaps = apply_hit_swaps(&mut ordered, &selected);
    ScopeRefineReport {
        hits: ordered,
        ran: true,
        errored: false,
        swaps,
    }
}

enum Attempt {
    Done(PassageJudgment),
    Retry,
    Fail,
}

fn classify_status(status: u16) -> Attempt {
    if status == 200 {
        Attempt::Done(PassageJudgment::blank())
    } else if matches!(status, 429 | 502 | 503 | 0) {
        Attempt::Retry
    } else {
        Attempt::Fail
    }
}

fn collapse_attempts(
    attempts: Vec<Result<PassageJudgment, ()>>,
) -> Result<Vec<PassageJudgment>, ScopeJudgeError> {
    let mut judgments = Vec::with_capacity(attempts.len());
    for attempt in attempts {
        match attempt {
            Ok(judgment) => judgments.push(judgment),
            Err(()) => return Err(ScopeJudgeError),
        }
    }
    Ok(judgments)
}

fn chat_url(endpoint: &str) -> String {
    let trimmed = endpoint.trim().trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else if trimmed.ends_with("/v1") {
        format!("{trimmed}/chat/completions")
    } else {
        format!("{trimmed}/v1/chat/completions")
    }
}

fn fill_prompt(template: &str, pairs: &[(&str, &str)]) -> String {
    let mut text = template.to_string();
    for (key, value) in pairs {
        text = text.replace(&format!("{{{key}}}"), value);
    }
    text
}

fn numbered(text: &str) -> (String, String) {
    let sentences = split_sentences(text);
    if sentences.is_empty() {
        return ("(none)".to_string(), "none".to_string());
    }
    let lines = sentences
        .iter()
        .enumerate()
        .map(|(index, sentence)| format!("S{}: {sentence}", index + 1))
        .collect::<Vec<_>>()
        .join("\n");
    let valid = (1..=sentences.len())
        .map(|index| format!("S{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    (lines, valid)
}

fn parse_cite_numbers(value: &serde_json::Value) -> Vec<i64> {
    let text = match value {
        serde_json::Value::Array(items) => items
            .iter()
            .map(|item| match item {
                serde_json::Value::String(text) => text.clone(),
                other => other.to_string(),
            })
            .collect::<Vec<_>>()
            .join(" "),
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(text) => text.clone(),
        other => other.to_string(),
    };
    let chars: Vec<char> = text.chars().collect();
    let mut cites = Vec::new();
    let mut index = 0;
    while index + 1 < chars.len() {
        if chars[index].eq_ignore_ascii_case(&'S') && chars[index + 1].is_ascii_digit() {
            let start = index + 1;
            let mut end = start;
            while end < chars.len() && chars[end].is_ascii_digit() {
                end += 1;
            }
            if let Ok(number) = chars[start..end].iter().collect::<String>().parse::<i64>() {
                cites.push(number);
            }
            index = end;
            continue;
        }
        index += 1;
    }
    cites
}

fn extract_json(content: &str) -> Option<serde_json::Value> {
    let mut text = content.trim().to_string();
    if let Some(rest) = text.strip_prefix("```") {
        let rest = rest.trim_start();
        let rest = rest
            .strip_prefix("json")
            .or_else(|| rest.strip_prefix("JSON"))
            .unwrap_or(rest);
        text = rest.trim().trim_end_matches('`').trim().to_string();
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
        if value.as_object().is_some() {
            return Some(value);
        }
    }
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end < start {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(&text[start..=end]).ok()?;
    value.as_object().is_some().then_some(value)
}

fn normalize_payload(payload: Option<&serde_json::Value>) -> PassageJudgment {
    let Some(payload) = payload else {
        return PassageJudgment::blank();
    };
    let label = |key: &str| {
        payload
            .get(key)
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_ascii_uppercase()
    };
    let scope = label("scope_label");
    let evidence = label("evidence_label");
    let level = label("evidence_level");
    if !LETTERS.iter().any(|letter| scope == letter.to_string())
        || !LETTERS.iter().any(|letter| evidence == letter.to_string())
        || !LEVELS.contains(&level.as_str())
    {
        return PassageJudgment::blank();
    }
    let scope_letter = scope.chars().next().unwrap_or('A');
    let evidence_letter = evidence.chars().next().unwrap_or('T');
    let cites = if evidence_letter == 'A' {
        Some(parse_cite_numbers(
            payload
                .get("cited_sentences")
                .unwrap_or(&serde_json::Value::Null),
        ))
    } else {
        Some(Vec::new())
    };
    PassageJudgment {
        scope: Some(letter_probs(scope_letter)),
        evidence: Some(letter_probs(evidence_letter)),
        level: Some(level),
        cites,
        api_error: false,
    }
}

fn judgment_from_content(content: &str) -> PassageJudgment {
    normalize_payload(extract_json(content).as_ref())
}

fn user_prompt(request: &ScopeJudgeRequest) -> String {
    let (sentences, valid) = numbered(&request.text);
    let anchor: String = request.anchor.chars().take(400).collect();
    fill_prompt(
        PASSAGE_USER,
        &[
            ("question", request.question.as_str()),
            (
                "chapter",
                if request.chapter.trim().is_empty() {
                    MISSING_CHAPTER
                } else {
                    request.chapter.as_str()
                },
            ),
            (
                "anchor",
                if anchor.is_empty() {
                    MISSING_ANCHOR
                } else {
                    anchor.as_str()
                },
            ),
            ("valid", valid.as_str()),
            ("sentences", sentences.as_str()),
        ],
    )
}

impl HttpScopeJudge {
    fn judge_one(&self, request: &ScopeJudgeRequest) -> Result<PassageJudgment, ()> {
        let waits = [Duration::from_secs(2), Duration::from_secs(5)];
        for attempt in 0..3 {
            match self.once(request) {
                Attempt::Done(judgment) => return Ok(judgment),
                Attempt::Retry if attempt < 2 => std::thread::sleep(waits[attempt]),
                Attempt::Retry | Attempt::Fail => return Err(()),
            }
        }
        Err(())
    }

    fn once(&self, request: &ScopeJudgeRequest) -> Attempt {
        let payload = serde_json::json!({
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt(request)},
            ],
            "temperature": 0,
            "top_p": 1,
            "max_tokens": 256,
            "response_format": {"type": "json_object"},
        });
        let response = self
            .client
            .post(chat_url(&self.endpoint))
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send();
        let Ok(response) = response else {
            return Attempt::Retry;
        };
        let status = response.status().as_u16();
        if status != 200 {
            return match classify_status(status) {
                Attempt::Done(_) => Attempt::Fail,
                other => other,
            };
        }
        let Ok(body) = response.text() else {
            return Attempt::Retry;
        };
        let content = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| {
                value
                    .get("choices")?
                    .get(0)?
                    .get("message")?
                    .get("content")?
                    .as_str()
                    .map(str::to_string)
            });
        Attempt::Done(match content {
            Some(content) => judgment_from_content(&content),
            None => PassageJudgment::blank(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::result::SearchDocumentSource;
    use neuink_domain::{EntryId, SegmentUid};

    fn letter_item(scope_i: char, scope_c: char, evidence_i: char, evidence_c: char) -> ScopeItem {
        ScopeItem {
            scope_incumbent: Some(scope_i),
            scope_challenger: Some(scope_c),
            evidence_incumbent: Some(evidence_i),
            evidence_challenger: Some(evidence_c),
            ..ScopeItem::default()
        }
    }

    #[test]
    fn decision_self_check_matches_the_frozen_rule() {
        assert!(split_sentences("").is_empty());
        assert_eq!(
            split_sentences("The rate is 0.1 after the encoder."),
            vec!["The rate is 0.1 after the encoder."]
        );
        assert_eq!(
            split_sentences("Fig. 1 shows the lidar. The error is 0.47."),
            vec!["Fig. 1 shows the lidar.", "The error is 0.47."]
        );
        assert_eq!(
            lookup_sentence("Alpha ended. Beta began.", 2).as_deref(),
            Some("Beta began.")
        );
        assert_eq!(
            metric_numbers("BERT reaches 84.6 F1 in 2019 and uses 3 seeds."),
            BTreeSet::from(["84.6".to_string()])
        );
        assert!(names("BERT reaches 84.6 F1.").contains("BERT"));
        assert!(names("HarborNet reaches 84.6 F1.").contains("HarborNet"));
        assert!(asked_named(
            "What are the industry classes defined in this paper?",
            "Table 1: Industry categories and number of users per category.",
        ));
        assert!(!asked_named(
            "did they compare with other extractive summarization methods?",
            "Table 3. Average Recall for five sections of the note.",
        ));

        let scope = ScopeItem {
            question: "What F1 does HarborNet reach?".into(),
            chapter_incumbent: "Related Work".into(),
            chapter_challenger: "Results".into(),
            text_incumbent:
                "The cited BuoyFormer model reaches 71.4 F1. That figure is from earlier work."
                    .into(),
            text_challenger: "HarborNet reaches 84.6 F1 on the held-out week.".into(),
            level_incumbent: Some("L0".into()),
            level_challenger: Some("L3".into()),
            cite_challenger: Some(vec![1]),
            ..letter_item('B', 'A', 'T', 'A')
        };
        assert_eq!(decide(&scope).expect("scope").path, "scope");

        let coverage = ScopeItem {
            chapter_incumbent: "Introduction".into(),
            text_incumbent:
                "We run a broad comparison and the method is competitive with prior systems.".into(),
            level_incumbent: Some("L1".into()),
            cite_incumbent: Some(vec![]),
            ..scope.clone()
        };
        let coverage = ScopeItem {
            scope_incumbent: Some('A'),
            evidence_incumbent: Some('B'),
            ..coverage
        };
        assert_eq!(decide(&coverage).expect("coverage").path, "coverage");

        let anchor = ScopeItem {
            text_anchor: "The WikiNotes corpus is the training source for the tagger.".into(),
            chapter_anchor: "Results".into(),
            chapter_challenger: "Results".into(),
            adjacent: true,
            text_challenger: "This corpus uses a 70/15/15 split and dropout of 0.5.".into(),
            cite_challenger: Some(vec![1]),
            ..coverage.clone()
        };
        assert_eq!(decide(&anchor).expect("anchor").path, "anchor_or_table");

        let table = ScopeItem {
            question: "What are the industry classes defined in this paper?".into(),
            chapter_challenger: "Figures and Tables".into(),
            text_challenger: "Table 1: Industry categories and number of users per category."
                .into(),
            cite_challenger: Some(vec![1]),
            level_challenger: Some("L3".into()),
            ..coverage.clone()
        };
        assert_eq!(decide(&table).expect("table").path, "anchor_or_table");

        let enum_item = ScopeItem {
            question: "Which datasets are used?".into(),
            chapter_incumbent: "Experiments".into(),
            chapter_challenger: "Experiments".into(),
            text_incumbent: "The first benchmark in this section is SQuAD.".into(),
            text_challenger: "TriviaQA is the second benchmark, with 95,000 pairs.".into(),
            text_top8: "We evaluate SQuAD in the main experiment.".into(),
            level_incumbent: Some("L2".into()),
            level_challenger: Some("L3".into()),
            cite_incumbent: Some(vec![1]),
            cite_challenger: Some(vec![1]),
            ..letter_item('A', 'A', 'A', 'A')
        };
        assert_eq!(decide(&enum_item).expect("enum").path, "enum_upgrade");

        let complement = ScopeItem {
            text_top8: String::new(),
            text_incumbent: "SQuAD accuracy is 84.6 under the full retrieval setup.".into(),
            text_challenger: "TriviaQA accuracy is 71.2 on the same retrieval setup.".into(),
            level_incumbent: Some("L3".into()),
            ..enum_item.clone()
        };
        assert!(protected(&complement));
        assert!(decide(&complement).is_none());

        let synonym = ScopeItem {
            text_top8: String::new(),
            text_incumbent: "HarborNet reaches 84.6 F1 on the held-out week.".into(),
            text_challenger: "On the held-out week, HarborNet reaches 84.6 F1.".into(),
            level_incumbent: Some("L3".into()),
            ..enum_item.clone()
        };
        assert!(decide(&synonym).is_none());

        let uncertain = ScopeItem {
            text_anchor: String::new(),
            chapter_challenger: "Analysis".into(),
            text_challenger: "This follows the procedure described above.".into(),
            scope_challenger: Some('T'),
            evidence_challenger: Some('T'),
            level_challenger: Some("L0".into()),
            cite_challenger: Some(vec![]),
            ..coverage.clone()
        };
        assert!(decide(&uncertain).is_none());

        let conflict = ScopeItem {
            scope_challenger: Some('B'),
            evidence_challenger: Some('T'),
            level_challenger: Some("L0".into()),
            cite_challenger: Some(vec![]),
            text_incumbent: "HarborNet reaches 84.6 F1 on the held-out week.".into(),
            chapter_incumbent: "Results".into(),
            scope_incumbent: Some('A'),
            evidence_incumbent: Some('A'),
            level_incumbent: Some("L3".into()),
            cite_incumbent: Some(vec![1]),
            chapter_challenger: "Related Work".into(),
            text_challenger: "The cited BuoyFormer model reaches 71.4 F1.".into(),
            ..scope.clone()
        };
        assert!(decide(&conflict).is_none());

        let dead = ScopeItem {
            chapter_incumbent: "Related Work".into(),
            text_incumbent: "Earlier systems discussed the task in general terms.".into(),
            scope_incumbent: Some('T'),
            evidence_incumbent: Some('T'),
            level_incumbent: Some("L1".into()),
            cite_incumbent: Some(vec![]),
            chapter_challenger: "Method".into(),
            text_challenger: "HarborNet encodes the query with a bidirectional encoder.".into(),
            scope_challenger: Some('A'),
            evidence_challenger: Some('A'),
            level_challenger: Some("L2".into()),
            cite_challenger: Some(vec![1]),
            ..scope.clone()
        };
        assert_eq!(decide(&dead).expect("dead").path, "coverage");
        let bare = ScopeItem {
            chapter_incumbent: "Conclusion".into(),
            scope_incumbent: Some('A'),
            evidence_incumbent: Some('B'),
            level_incumbent: Some("L1".into()),
            text_challenger: "The active words were adjusted at that node.".into(),
            cite_challenger: Some(vec![1]),
            ..dead.clone()
        };
        assert!(decide(&bare).is_none());
        let numbered = ScopeItem {
            text_challenger: "The social model uses a learning rate of 0.001.".into(),
            ..bare.clone()
        };
        assert_eq!(decide(&numbered).expect("numbered").path, "coverage");
        let anchored_body = ScopeItem {
            chapter_incumbent: "Experiments".into(),
            scope_incumbent: Some('A'),
            evidence_incumbent: Some('B'),
            level_incumbent: Some("L1".into()),
            ..anchor.clone()
        };
        assert!(decide(&anchored_body).is_none());

        let low = ScopeItem {
            scope_challenger_probs: Some(LetterProbs {
                a: 0.70,
                b: 0.20,
                t: 0.10,
            }),
            ..scope
        };
        assert!(decide(&low).is_none());
        assert!(!citation_ok("Alpha ended.", Some(&[3]), Some('T')));
    }

    #[test]
    fn select_swaps_breaks_ties_by_score_then_slot_then_rank_then_uid() {
        let row = |score: f64, position: i32, rank: i32, uid: &str| ScopeDecision {
            position,
            bge_rank: rank,
            challenger_uid: uid.into(),
            incumbent_uid: "incumbent".into(),
            path: "coverage".into(),
            min_score: score,
        };
        let chosen = select_swaps(&[
            row(0.80, 9, 11, "b"),
            row(0.90, 9, 15, "a"),
            row(0.90, 10, 12, "a"),
            row(0.90, 10, 11, "c"),
        ]);
        assert_eq!(
            chosen
                .iter()
                .map(|item| item.challenger_uid.as_str())
                .collect::<Vec<_>>(),
            vec!["c", "a"]
        );
        assert_eq!(
            apply_swap(
                &["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "old", "ten"],
                9,
                "c"
            ),
            vec!["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "c", "ten"]
        );
        assert_eq!(
            apply_swap(
                &["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "c", "ten"],
                10,
                "c"
            )
            .last()
            .map(String::as_str),
            Some("ten")
        );
    }

    #[test]
    fn a_bad_payload_or_an_out_of_range_cite_keeps_the_pair() {
        assert!(judgment_from_content("not json").level.is_none());
        assert!(judgment_from_content("{\"scope_label\":\"maybe\"}")
            .level
            .is_none());
        let parsed = judgment_from_content(
            "{\"scope_label\":\"A\",\"evidence_label\":\"A\",\"evidence_level\":\"L3\",\"cited_sentences\":[\"S99\"]}",
        );
        assert_eq!(parsed.cites.as_deref(), Some(&[99][..]));
        assert!(!citation_ok(
            "Alpha ended.",
            parsed.cites.as_deref(),
            Some('A')
        ));
        assert!(matches!(classify_status(500), Attempt::Fail));
        assert!(matches!(classify_status(429), Attempt::Retry));
        assert!(collapse_attempts(vec![Err(()), Err(()), Err(())]).is_err());
        assert!(collapse_attempts(vec![Err(())]).is_err());
        assert!(collapse_attempts(vec![
            Ok(PassageJudgment::blank()),
            Err(()),
            Ok(PassageJudgment::blank()),
        ])
        .is_err());
        assert!(collapse_attempts(vec![Ok(PassageJudgment::blank())]).is_ok());
        assert_eq!(
            chat_url("https://api.siliconflow.cn/v1"),
            "https://api.siliconflow.cn/v1/chat/completions"
        );
        assert_eq!(
            chat_url("https://host.example/v1/chat/completions"),
            "https://host.example/v1/chat/completions"
        );
        assert!(HttpScopeJudge::new(
            "http://example.com/v1".into(),
            "m".into(),
            "k".into(),
            1000,
            8
        )
        .is_err());
        assert!(HttpScopeJudge::new(
            "https://api.siliconflow.cn/v1".into(),
            "m".into(),
            "k".into(),
            1000,
            8
        )
        .is_ok());
    }

    fn hit_for(entry: &str, uid: &str, chapter: &str, snippet: &str, score: f32) -> SearchHit {
        SearchHit {
            entry_id: EntryId::from_string(entry),
            entry_title: "Paper".into(),
            source: SearchDocumentSource {
                section_path: Some(chapter.into()),
                ..SearchDocumentSource::default()
            },
            target: SearchTarget::Segment {
                entry_id: EntryId::from_string(entry),
                segment_uid: SegmentUid::from_string(uid),
                page_idx: 0,
            },
            title: "Paper".into(),
            snippet: snippet.into(),
            score,
            matched_terms: Vec::new(),
            surrounding_context: None,
        }
    }

    fn hit(uid: &str, chapter: &str, snippet: &str, score: f32) -> SearchHit {
        hit_for("entry", uid, chapter, snippet, score)
    }

    fn segment_of(hit: &SearchHit) -> String {
        match &hit.target {
            SearchTarget::Segment { segment_uid, .. } => segment_uid.to_string(),
            _ => String::new(),
        }
    }

    struct Scripted {
        judgments: std::collections::BTreeMap<String, PassageJudgment>,
        fail: bool,
        calls: std::sync::atomic::AtomicUsize,
    }

    impl ScopeJudgeProvider for Scripted {
        fn judge_batch(
            &self,
            requests: &[ScopeJudgeRequest],
        ) -> Result<Vec<PassageJudgment>, ScopeJudgeError> {
            self.calls
                .fetch_add(requests.len(), std::sync::atomic::Ordering::SeqCst);
            if self.fail {
                return Err(ScopeJudgeError);
            }
            Ok(requests
                .iter()
                .map(|request| {
                    self.judgments
                        .get(&request.key)
                        .cloned()
                        .unwrap_or_else(PassageJudgment::blank)
                })
                .collect())
        }
    }

    fn labeled(scope: char, evidence: char, level: &str, cites: Vec<i64>) -> PassageJudgment {
        PassageJudgment {
            scope: Some(letter_probs(scope)),
            evidence: Some(letter_probs(evidence)),
            level: Some(level.into()),
            cites: Some(cites),
            api_error: false,
        }
    }

    #[test]
    fn a_related_work_slot_swaps_and_a_protected_slot_makes_no_call() {
        let mut hits = (0..8)
            .map(|index| hit(&format!("e:s{index}"), "Experiments", "locked context", 0.9))
            .collect::<Vec<_>>();
        hits.push(hit(
            "incumbent:s20",
            "Related Work",
            "The cited BuoyFormer model reaches 71.4 F1. That figure is from earlier work.",
            0.2,
        ));
        hits.push(hit(
            "kept:s21",
            "Experiments",
            "AlphaNet reaches 12.5 F1 on this paper's own split.",
            0.1,
        ));
        hits.push(hit(
            "challenger:s30",
            "Results",
            "HarborNet reaches 84.6 F1 on the held-out week.",
            0.05,
        ));
        let judge = Scripted {
            judgments: std::collections::BTreeMap::from([
                (
                    "s:entry:incumbent:s20".into(),
                    labeled('B', 'T', "L0", vec![]),
                ),
                ("s:entry:kept:s21".into(), labeled('A', 'A', "L3", vec![1])),
                (
                    "s:entry:challenger:s30".into(),
                    labeled('A', 'A', "L3", vec![1]),
                ),
            ]),
            fail: false,
            calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let report = refine_tail_with_scope_v6(&hits, "What F1 does HarborNet reach?", &judge);
        assert!(!report.errored);
        assert_eq!(report.swaps.len(), 1);
        assert_eq!(report.swaps[0].path, "scope");
        assert_eq!(report.swaps[0].slot, 9);
        assert_eq!(segment_of(&report.hits[8]), "challenger:s30");
        assert_eq!(segment_of(&report.hits[10]), "incumbent:s20");
        assert!(judge.calls.load(std::sync::atomic::Ordering::SeqCst) >= 2);
    }

    #[test]
    fn both_protected_slots_and_a_failed_judge_leave_the_order() {
        let mut hits = (0..8)
            .map(|index| hit(&format!("e:s{index}"), "Experiments", "locked", 0.5))
            .collect::<Vec<_>>();
        hits.push(hit(
            "p9:s20",
            "Experiments",
            "AlphaNet reaches 11.1 F1.",
            0.4,
        ));
        hits.push(hit(
            "p10:s21",
            "Experiments",
            "BetaNet reaches 22.2 F1.",
            0.3,
        ));
        hits.push(hit("c11:s30", "Results", "Gamma discusses the setup.", 0.2));
        let quiet = Scripted {
            judgments: std::collections::BTreeMap::new(),
            fail: false,
            calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let report = refine_tail_with_scope_v6(&hits, "What F1 is reported?", &quiet);
        assert!(report.swaps.is_empty());
        assert_eq!(quiet.calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert_eq!(segment_of(&report.hits[8]), "p9:s20");
        let failing = Scripted {
            judgments: std::collections::BTreeMap::new(),
            fail: true,
            calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let mut open = hits.clone();
        open[8] = hit(
            "p9:s20",
            "Related Work",
            "The cited BuoyFormer model reaches 71.4 F1. That figure is from earlier work.",
            0.4,
        );
        let failed = refine_tail_with_scope_v6(&open, "What F1 does HarborNet reach?", &failing);
        assert!(failed.errored);
        assert_eq!(segment_of(&failed.hits[8]), "p9:s20");
    }

    #[test]
    fn an_anchor_does_not_cross_papers() {
        let challenger = hit_for("paper-b", "b:s10", "Experiments", "challenger", 0.1);
        let foreign = hit_for("paper-a", "a:s10", "Experiments", "foreign neighbor", 0.9);
        let local = hit_for("paper-b", "b:s11", "Experiments", "local neighbor", 0.2);
        let (text, chapter, delta) = choose_anchor(&challenger, &[foreign, local]);
        assert_eq!(text, "local neighbor");
        assert_eq!(chapter, "Experiments");
        assert_eq!(delta, Some(1));
    }

    #[test]
    fn the_same_segment_uid_in_another_paper_does_not_collide() {
        let mut hits = (0..8)
            .map(|index| {
                hit_for(
                    "paper-a",
                    &format!("a:s{index}"),
                    "Experiments",
                    "locked",
                    0.9,
                )
            })
            .collect::<Vec<_>>();
        hits.push(hit_for(
            "paper-a",
            "dup:s1",
            "Related Work",
            "The cited BuoyFormer model reaches 71.4 F1. That figure is from earlier work.",
            0.2,
        ));
        hits.push(hit_for(
            "paper-a",
            "a:s40",
            "Experiments",
            "AlphaNet reaches 12.5 F1 on this paper's own split.",
            0.1,
        ));
        hits.push(hit_for(
            "paper-b",
            "dup:s1",
            "Results",
            "HarborNet reaches 84.6 F1 on the held-out week.",
            0.05,
        ));
        let judge = Scripted {
            judgments: std::collections::BTreeMap::from([
                (hit_key(&hits[8]), labeled('B', 'T', "L0", vec![])),
                (hit_key(&hits[10]), labeled('A', 'A', "L3", vec![1])),
            ]),
            fail: false,
            calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let report = refine_tail_with_scope_v6(&hits, "What F1 does HarborNet reach?", &judge);
        assert!(!report.errored);
        assert_eq!(report.swaps.len(), 1);
        assert_eq!(report.hits[8].entry_id.as_str(), "paper-b");
        assert_eq!(segment_of(&report.hits[8]), "dup:s1");
        assert_eq!(report.hits[10].entry_id.as_str(), "paper-a");
    }

    #[test]
    fn a_few_thousand_characters_stay_inside_the_token_budget() {
        let passage = "a".repeat(1400);
        assert!(!over_budget(&passage, &passage, &passage));
        assert!(over_budget(&"a".repeat(13_000), "", ""));
        assert!(over_budget(&"测".repeat(5_000), "", ""));
        assert!(!over_budget(&"测".repeat(1_000), "word", ""));
    }
}
