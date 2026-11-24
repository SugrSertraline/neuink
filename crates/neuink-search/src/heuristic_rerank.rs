//! Model-free rerank: weighted field coverage over the retrieved text.
//!
//! Measured basis (DocVQA page texts, gold page plus nine distractors): this reaches
//! top1 0.725 / MRR@10 0.839, matching the best cross-encoder setting at 0.04 ms per
//! pair. On the production-shaped pool it adds nothing *over the `field_0.5` fusion arm*,
//! because that arm already scores the same signal — which is why it is the fallback
//! stage of the ladder rather than an unconditional extra pass.
//!
//! Numbers, metric words and named entities weigh more than generic content words: a
//! question asking "what F1 does Table 3 report" is decided by the digits, not by "report".

use std::collections::BTreeSet;

use crate::SearchHit;

/// Relative weight of each field family. Mirrors the measured DocVQA weighting.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FieldCoverageWeights {
    pub metric: f32,
    pub number: f32,
    pub entity: f32,
    pub content: f32,
}

impl Default for FieldCoverageWeights {
    fn default() -> Self {
        Self {
            metric: 2.0,
            number: 2.0,
            entity: 1.5,
            content: 1.0,
        }
    }
}

const METRIC_WORDS: &[&str] = &[
    "f1",
    "precision",
    "recall",
    "accuracy",
    "score",
    "auc",
    "roc",
    "map",
    "mrr",
    "bleu",
    "rouge",
    "meteor",
    "perplexity",
    "loss",
    "error",
    "rate",
    "ratio",
    "percentage",
    "percent",
    "value",
    "mean",
    "average",
    "median",
    "std",
    "deviation",
    "count",
    "number",
    "total",
    "sum",
    "difference",
    "delta",
    "metric",
];

const STOPWORDS: &[&str] = &[
    "the", "a", "an", "in", "on", "of", "for", "to", "is", "are", "was", "were", "what", "which",
    "who", "how", "many", "does", "do", "did", "this", "that", "these", "those", "it", "its",
    "from", "by", "at", "or", "and", "not", "no", "be", "been", "has", "have", "had", "will",
    "would", "can", "could", "should", "may", "might", "must", "with", "as", "per", "page",
    "figure", "table", "chart", "section", "document", "paper", "study", "report",
];

/// Query-side fields the coverage score compares against a document.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct QueryFields {
    pub content: BTreeSet<String>,
    pub metrics: BTreeSet<String>,
    pub numbers: BTreeSet<String>,
    pub entities: BTreeSet<String>,
}

impl QueryFields {
    pub fn is_empty(&self) -> bool {
        self.content.is_empty()
            && self.metrics.is_empty()
            && self.numbers.is_empty()
            && self.entities.is_empty()
    }
}

pub fn extract_query_fields(query: &str) -> QueryFields {
    let lowered = query.to_lowercase();
    let mut fields = QueryFields::default();
    for token in crate::token::tokenize(&lowered) {
        if STOPWORDS.contains(&token.as_str()) {
            continue;
        }
        if METRIC_WORDS.contains(&token.as_str()) {
            fields.metrics.insert(token);
            continue;
        }
        if token.chars().any(|character| character.is_ascii_digit()) {
            if is_numeric(&token) {
                fields.numbers.insert(token);
                continue;
            }
        }
        if token.chars().count() > 2 {
            fields.content.insert(token);
        }
    }
    for word in query.split_whitespace() {
        let trimmed = word.trim_matches(|character: char| !character.is_alphanumeric());
        let mut characters = trimmed.chars();
        let Some(first) = characters.next() else {
            continue;
        };
        if first.is_uppercase() && trimmed.chars().count() > 1 {
            let lowered = trimmed.to_lowercase();
            if !STOPWORDS.contains(&lowered.as_str()) {
                fields.entities.insert(lowered);
            }
        }
    }
    fields
}

fn is_numeric(token: &str) -> bool {
    let mut digits = 0usize;
    let mut others = 0usize;
    for character in token.chars() {
        if character.is_ascii_digit() {
            digits += 1;
        } else if character == '.' || character == '%' || character == ',' {
            others += 1;
        } else {
            return false;
        }
    }
    let _ = others;
    digits > 0
}

/// Weighted share of query fields present in the document, in `0.0..=1.0`.
///
/// Returns `0.0` when the query carries no field at all: a question with nothing to match
/// must not be reordered by an absent signal.
pub fn field_coverage(query: &str, document: &str, weights: &FieldCoverageWeights) -> f32 {
    let fields = extract_query_fields(query);
    if fields.is_empty() {
        return 0.0;
    }
    let lowered = document.to_lowercase();
    let document_tokens: BTreeSet<String> = crate::token::tokenize(&lowered).into_iter().collect();

    let content_hit = fields.content.intersection(&document_tokens).count() as f32;
    let metric_hit = fields.metrics.intersection(&document_tokens).count() as f32;
    let entity_hit = fields.entities.intersection(&document_tokens).count() as f32;
    let number_hit = fields
        .numbers
        .iter()
        .filter(|number| lowered.contains(number.as_str()))
        .count() as f32;

    let weight = weights.metric * metric_hit
        + weights.number * number_hit
        + weights.entity * entity_hit
        + weights.content * content_hit;
    let maximum = weights.metric * fields.metrics.len() as f32
        + weights.number * fields.numbers.len() as f32
        + weights.entity * fields.entities.len() as f32
        + weights.content * fields.content.len() as f32;
    if maximum <= 0.0 {
        return 0.0;
    }
    (weight / maximum).clamp(0.0, 1.0)
}

/// Reorders hits by field coverage. Ties keep their incoming order, so a query without
/// fields leaves the list untouched rather than shuffling it.
pub fn rerank_hits_by_coverage(
    hits: &[SearchHit],
    query: &str,
    weights: &FieldCoverageWeights,
) -> Vec<SearchHit> {
    let mut scored = hits
        .iter()
        .enumerate()
        .map(|(index, hit)| {
            (
                field_coverage(query, &hit.snippet, weights),
                index,
                hit.clone(),
            )
        })
        .collect::<Vec<_>>();
    scored.sort_by(|left, right| {
        right
            .0
            .total_cmp(&left.0)
            .then_with(|| left.1.cmp(&right.1))
    });
    let mut ordered = scored
        .into_iter()
        .map(|(_, _, hit)| hit)
        .collect::<Vec<_>>();
    crate::rerank_hits::stamp_rank_scores(&mut ordered);
    ordered
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::result::{SearchDocumentSource, SearchTarget};
    use neuink_domain::{EntryId, SegmentUid};

    fn hit(uid: &str, snippet: &str) -> SearchHit {
        SearchHit {
            entry_id: EntryId::from_string("entry"),
            entry_title: "Paper".to_string(),
            source: SearchDocumentSource::default(),
            target: SearchTarget::Segment {
                entry_id: EntryId::from_string("entry"),
                segment_uid: SegmentUid::from_string(uid),
                page_idx: 0,
            },
            title: "Paper".to_string(),
            snippet: snippet.to_string(),
            score: 1.0,
            matched_terms: Vec::new(),
            surrounding_context: None,
        }
    }

    #[test]
    fn numbers_and_metric_words_outweigh_generic_content() {
        let weights = FieldCoverageWeights::default();
        let numeric = field_coverage(
            "what f1 value does table 3 report",
            "F1 value: 87.5",
            &weights,
        );
        let prose = field_coverage(
            "what f1 value does table 3 report",
            "the report discusses several qualitative cases",
            &weights,
        );
        assert!(numeric > prose, "{numeric} vs {prose}");
    }

    #[test]
    fn a_query_without_fields_scores_zero_and_keeps_the_order() {
        let weights = FieldCoverageWeights::default();
        assert_eq!(field_coverage("the of and", "anything", &weights), 0.0);
        let hits = vec![hit("a", "first"), hit("b", "second")];
        let ordered = rerank_hits_by_coverage(&hits, "the of and", &weights);
        assert_eq!(
            ordered
                .iter()
                .map(|hit| hit.snippet.as_str())
                .collect::<Vec<_>>(),
            ["first", "second"]
        );
    }

    #[test]
    fn ties_keep_the_incoming_order() {
        let weights = FieldCoverageWeights::default();
        let hits = vec![
            hit("a", "same text"),
            hit("b", "same text"),
            hit("c", "same text"),
        ];
        let ordered = rerank_hits_by_coverage(&hits, "f1 value", &weights);
        assert_eq!(
            ordered
                .iter()
                .filter_map(|hit| match &hit.target {
                    SearchTarget::Segment { segment_uid, .. } => Some(segment_uid.to_string()),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            ["a", "b", "c"]
        );
    }

    #[test]
    fn the_matching_hit_moves_first() {
        let weights = FieldCoverageWeights::default();
        let hits = vec![
            hit("a", "no fields here"),
            hit("b", "accuracy 91.2 percent"),
        ];
        let ordered = rerank_hits_by_coverage(&hits, "what accuracy percent", &weights);
        assert_eq!(ordered[0].snippet, "accuracy 91.2 percent");
    }

    #[test]
    fn entity_mentions_are_detected_from_capitalisation() {
        let fields = extract_query_fields("does BERT beat RoBERTa on GLUE?");
        assert!(fields.entities.contains("bert"));
        assert!(fields.entities.contains("roberta"));
        assert!(fields.entities.contains("glue"));
    }

    #[test]
    fn stamped_scores_keep_the_coverage_order_after_results_are_rebuilt() {
        let mut plain = hit("a", "no fields here");
        plain.score = 0.95;
        let mut numeric = hit("b", "accuracy 91.2 percent");
        numeric.score = 0.10;
        let ordered = rerank_hits_by_coverage(
            &[plain, numeric],
            "what accuracy percent",
            &FieldCoverageWeights::default(),
        );
        assert!(ordered[0].score > ordered[1].score);
        let results = crate::retrieval_pipeline::results_from_hits(
            "what accuracy percent".to_string(),
            "hybrid".to_string(),
            1,
            ordered,
            Vec::new(),
        );
        let again = crate::retrieval_pipeline::ordered_hits(&results);
        assert!(again[0].snippet.contains("91.2"));
    }
}
