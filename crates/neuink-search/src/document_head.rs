//! Rank-only head selection for a document stage.
//!
//! Retrieval scores are not comparable across channels: a 0.05 margin is most of the
//! keyword score range and almost nothing in an RRF list. Any threshold on a score
//! therefore stops working when the mode changes, while document ranks keep their
//! meaning. This module reads ranks only, so one rule serves dense, keyword and hybrid
//! retrieval without recalibration.

/// Why the document stage produced nothing to do.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HeadSkip {
    /// Scope holds no parsed document.
    NoDocuments,
    /// Scope holds one document, so there is no document choice to make.
    SingleDocument,
    /// No ranking and no named paper.
    EmptyRanking,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DocumentHead {
    /// Entry ids in the order the caller should consider them.
    pub documents: Vec<String>,
    pub skipped: Option<HeadSkip>,
    /// True when the cap kept a named paper and dropped ranked ones.
    pub truncated: bool,
    /// Ranked documents that survived the cap.
    pub ranked_selected: usize,
    /// Named documents that survived the cap.
    pub mandated_selected: usize,
    /// Ranked documents the cap dropped.
    pub ranked_dropped: usize,
    /// Named documents the cap dropped.
    pub mandated_dropped: usize,
}

impl DocumentHead {
    /// A head that produced nothing, carrying the reason.
    fn skipped_with(reason: HeadSkip) -> Self {
        Self {
            documents: Vec::new(),
            skipped: Some(reason),
            truncated: false,
            ranked_selected: 0,
            mandated_selected: 0,
            ranked_dropped: 0,
            mandated_dropped: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DocumentHeadConfig {
    /// Ranked units inspected from the head of the ranking.
    pub head_units: usize,
    /// Upper bound on documents the caller can afford to pair.
    pub max_documents: usize,
    /// Upper bound on named documents kept ahead of the cap. `usize::MAX` keeps every
    /// named paper, which is the historical behavior: dropping one answers a different
    /// question. A finite value lets a caller bound the cost graph candidates can add.
    pub max_mandated: usize,
}

/// Ranked hits the document head reads before deduplicating into documents.
///
/// Twenty is the measured default: on DAPR dev it lifts document-level recall from 95.2 % to
/// 97.05 % at an average of 22.6 pairs per query (120 worst case). Raising the document cap
/// alone was worth only 0.74 pp, so the head width is the knob that matters.
pub const DEFAULT_HEAD_UNITS: usize = 20;

impl Default for DocumentHeadConfig {
    fn default() -> Self {
        Self {
            head_units: DEFAULT_HEAD_UNITS,
            max_documents: DEFAULT_MAX_DOCUMENTS,
            max_mandated: usize::MAX,
        }
    }
}

/// Documents the document stage pairs by default.
///
/// Six came from `documents_for_pairs(15)`, a pair-scoring budget chosen when only single-document
/// questions were measured. Multi-document corpora need more: on HotpotQA-style questions a cap of
/// six reaches ~71 % of gold documents while twenty reaches ~94 %, and on DAPR raising the head
/// width alone took document recall from 94.5 % to 97.1 %. Twenty documents is 190 pairs.
pub const DEFAULT_MAX_DOCUMENTS: usize = 20;

/// Selects the documents a document stage may consider.
///
/// `ranked_entry_ids` is the final ranking in rank order, one entry per hit. Only the
/// first `config.head_units` hits are read, so the head is exactly the evidence a caller
/// would otherwise return. `mandated` holds papers the question named; they are always
/// kept because dropping one would answer a different question.
pub fn document_head(
    ranked_entry_ids: &[&str],
    mandated: &[String],
    in_scope_documents: usize,
    config: DocumentHeadConfig,
) -> DocumentHead {
    if in_scope_documents == 0 {
        return DocumentHead::skipped_with(HeadSkip::NoDocuments);
    }
    let mut ranked: Vec<String> = Vec::new();
    for entry in ranked_entry_ids.iter().take(config.head_units) {
        if entry.trim().is_empty() || ranked.iter().any(|seen| seen == entry) {
            continue;
        }
        ranked.push((*entry).to_string());
    }
    // Named papers are a question constraint, so by default every one of them is kept.
    // `max_mandated` exists only so a caller can bound what graph candidates may add.
    let mut named: Vec<String> = Vec::new();
    let mut mandated_dropped = 0usize;
    for entry in mandated {
        let entry = entry.trim();
        if entry.is_empty()
            || ranked.iter().any(|seen| seen == entry)
            || named.iter().any(|seen| seen == entry)
        {
            continue;
        }
        if named.len() >= config.max_mandated {
            mandated_dropped += 1;
            continue;
        }
        named.push(entry.to_string());
    }
    let mut documents: Vec<String> = ranked.clone();
    documents.extend(named.iter().cloned());
    if in_scope_documents == 1 {
        return DocumentHead {
            documents,
            skipped: Some(HeadSkip::SingleDocument),
            truncated: false,
            ranked_selected: ranked.len(),
            mandated_selected: named.len(),
            ranked_dropped: 0,
            mandated_dropped,
        };
    }
    if documents.is_empty() {
        return DocumentHead::skipped_with(HeadSkip::EmptyRanking);
    }
    // Required papers are a question constraint, not a compute budget. Retain all of
    // them even when pair scoring must be separately capped by the caller.
    let mandated_set: std::collections::BTreeSet<String> = named.iter().cloned().collect();
    let cap = config
        .max_documents
        .min(in_scope_documents)
        .max(mandated_set.len())
        .max(1);
    let mut truncated = false;
    let mut ranked_selected = ranked.len();
    let mut mandated_selected = named.len();
    let mut ranked_dropped = 0usize;
    if documents.len() > cap {
        // Named papers survive the cap; ranked ones fill the rest in rank order.
        let mut kept: Vec<String> = Vec::with_capacity(cap);
        for entry in &documents {
            if kept.len() < cap && mandated_set.contains(entry) {
                kept.push(entry.clone());
            }
        }
        for entry in &documents {
            if kept.len() >= cap {
                break;
            }
            if !kept.contains(entry) {
                kept.push(entry.clone());
            }
        }
        truncated = kept.len() < documents.len();
        // A document that the ranking also holds counts as ranked: that is its origin.
        ranked_selected = kept.iter().filter(|entry| ranked.contains(entry)).count();
        mandated_selected = kept.len() - ranked_selected;
        ranked_dropped = ranked.len() - ranked_selected;
        documents = kept;
    }
    DocumentHead {
        documents,
        skipped: None,
        truncated,
        ranked_selected,
        mandated_selected,
        ranked_dropped,
        mandated_dropped,
    }
}

/// Number of unordered pairs a document stage would judge for `documents` documents.
pub fn document_pairs(documents: usize) -> usize {
    let (left, right) = if documents % 2 == 0 {
        (documents / 2, documents.saturating_sub(1))
    } else {
        (documents, documents.saturating_sub(1) / 2)
    };
    left.checked_mul(right).unwrap_or(usize::MAX)
}

/// Largest document count whose pair count fits `max_pairs`; one fits a zero budget.
/// Binary search avoids work proportional to the square root of an arbitrary usize budget.
pub fn documents_for_pairs(max_pairs: usize) -> usize {
    let fits = |n: usize| {
        let (a, b) = if n % 2 == 0 {
            (n / 2, n.saturating_sub(1))
        } else {
            (n, n.saturating_sub(1) / 2)
        };
        a.checked_mul(b).is_some_and(|pairs| pairs <= max_pairs)
    };
    let mut low = 1usize;
    let mut high = usize::MAX;
    while low < high {
        let distance = high - low;
        let middle = low + distance / 2 + distance % 2;
        if fits(middle) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    low
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(head_units: usize, max_documents: usize) -> DocumentHeadConfig {
        DocumentHeadConfig {
            head_units,
            max_documents,
            max_mandated: usize::MAX,
        }
    }

    #[test]
    fn diagnostics_count_what_the_cap_kept_and_dropped() {
        let ranked = ["a", "b", "c", "d"];
        let mandated = vec!["z".to_string(), "y".to_string()];
        let head = document_head(&ranked, &mandated, 40, cfg(10, 3));
        assert_eq!(head.documents.len(), 3);
        // Both named papers are kept, so only one ranked document survives.
        assert_eq!(head.mandated_selected, 2);
        assert_eq!(head.ranked_selected, 1);
        assert_eq!(head.ranked_dropped, 3);
        assert_eq!(head.mandated_dropped, 0);
        assert!(head.truncated);
    }

    #[test]
    fn an_uncapped_head_reports_no_drops() {
        let ranked = ["a", "b"];
        let head = document_head(&ranked, &["z".to_string()], 40, cfg(10, 6));
        assert_eq!(head.ranked_selected, 2);
        assert_eq!(head.mandated_selected, 1);
        assert_eq!(head.ranked_dropped, 0);
        assert_eq!(head.mandated_dropped, 0);
        assert!(!head.truncated);
    }

    #[test]
    fn max_mandated_bounds_named_papers_and_is_unbounded_by_default() {
        let ranked = ["a"];
        let mandated = vec!["z".to_string(), "y".to_string(), "x".to_string()];
        let bounded = DocumentHeadConfig {
            head_units: 10,
            max_documents: 6,
            max_mandated: 2,
        };
        let head = document_head(&ranked, &mandated, 40, bounded);
        assert_eq!(head.mandated_selected, 2);
        assert_eq!(head.mandated_dropped, 1);
        assert_eq!(head.documents, ["a", "z", "y"]);

        let unbounded = document_head(&ranked, &mandated, 40, cfg(10, 6));
        assert_eq!(unbounded.mandated_selected, 3);
        assert_eq!(unbounded.mandated_dropped, 0);
    }

    #[test]
    fn the_head_is_the_distinct_documents_of_the_first_ranked_units() {
        let ranked = ["a", "a", "b", "c", "c", "d"];
        let head = document_head(&ranked, &[], 40, cfg(10, 6));
        assert_eq!(head.documents, ["a", "b", "c", "d"]);
        assert_eq!(head.skipped, None);
        assert!(!head.truncated);
    }

    #[test]
    fn only_the_configured_head_is_read() {
        let ranked = ["a", "b", "c", "d", "e"];
        assert_eq!(
            document_head(&ranked, &[], 40, cfg(2, 6)).documents,
            ["a", "b"]
        );
        assert_eq!(
            document_head(&ranked, &[], 40, cfg(10, 6)).documents,
            ["a", "b", "c", "d", "e"]
        );
    }

    #[test]
    fn a_named_paper_is_kept_even_when_the_ranking_never_reaches_it() {
        let ranked = ["a", "b"];
        let mandated = vec!["z".to_string()];
        let head = document_head(&ranked, &mandated, 40, cfg(10, 6));
        assert_eq!(head.documents, ["a", "b", "z"]);
        assert_eq!(head.skipped, None);
    }

    #[test]
    fn the_cap_keeps_named_papers_and_drops_ranked_ones_in_rank_order() {
        let ranked = ["a", "b", "c", "d", "e", "f", "g"];
        let mandated = vec!["z".to_string()];
        let head = document_head(&ranked, &mandated, 40, cfg(10, 3));
        assert!(head.truncated);
        assert_eq!(head.documents.len(), 3);
        assert!(head.documents.contains(&"z".to_string()));
        // Ranked documents keep their relative order.
        let ranked_kept: Vec<&String> = head
            .documents
            .iter()
            .filter(|entry| entry.as_str() != "z")
            .collect();
        let mut sorted = ranked_kept.clone();
        sorted.sort_by_key(|entry| ranked.iter().position(|r| r == &entry.as_str()).unwrap());
        assert_eq!(ranked_kept, sorted);
    }

    #[test]
    fn a_single_document_scope_is_skipped_without_losing_it() {
        let ranked = ["only", "only", "only"];
        let head = document_head(&ranked, &[], 1, cfg(10, 6));
        assert_eq!(head.skipped, Some(HeadSkip::SingleDocument));
        assert_eq!(head.documents, ["only"]);
        assert!(!head.truncated);
    }

    #[test]
    fn an_empty_scope_or_an_empty_ranking_reports_why() {
        let empty: [&str; 0] = [];
        assert_eq!(
            document_head(&empty, &[], 0, cfg(10, 6)).skipped,
            Some(HeadSkip::NoDocuments)
        );
        assert_eq!(
            document_head(&empty, &[], 12, cfg(10, 6)).skipped,
            Some(HeadSkip::EmptyRanking)
        );
        // Blank ids never become documents, so a ranking of blanks is empty too.
        assert_eq!(
            document_head(&["", "  "], &[], 12, cfg(10, 6)).skipped,
            Some(HeadSkip::EmptyRanking)
        );
    }

    #[test]
    fn the_cap_never_exceeds_the_scope_size() {
        let ranked = ["a", "b", "c"];
        let head = document_head(&ranked, &[], 2, cfg(10, 6));
        assert_eq!(head.documents.len(), 2);
        assert!(head.truncated);
    }

    #[test]
    fn the_rule_reads_ranks_only_so_it_does_not_depend_on_a_score_scale() {
        // The same rank shape produces the same head no matter which channel produced it:
        // nothing here takes a score, so dense, keyword and hybrid lists agree by construction.
        let dense_order = ["a", "b", "a", "c"];
        let keyword_order = ["a", "b", "a", "c"];
        let hybrid_order = ["a", "b", "a", "c"];
        let expected = document_head(&dense_order, &[], 40, cfg(10, 6)).documents;
        assert_eq!(
            document_head(&keyword_order, &[], 40, cfg(10, 6)).documents,
            expected
        );
        assert_eq!(
            document_head(&hybrid_order, &[], 40, cfg(10, 6)).documents,
            expected
        );
    }

    #[test]
    fn all_mandated_documents_survive_a_smaller_budget() {
        let named = vec!["a".into(), "b".into(), "c".into(), "a".into()];
        let head = document_head(&["x", "y"], &named, 8, cfg(10, 2));
        assert_eq!(head.documents, ["a", "b", "c"]);
        assert!(head.truncated);
    }

    #[test]
    fn extreme_pair_budgets_do_not_overflow_or_loop() {
        assert_eq!(document_pairs(usize::MAX), usize::MAX);
        let cap = documents_for_pairs(usize::MAX);
        assert!(cap > 1);
        // The next count exceeds representable pair counts rather than wrapping.
        assert_eq!(document_pairs(cap + 1), usize::MAX);
    }

    #[test]
    fn pair_budget_and_document_cap_agree() {
        assert_eq!(document_pairs(0), 0);
        assert_eq!(document_pairs(1), 0);
        assert_eq!(document_pairs(2), 1);
        assert_eq!(document_pairs(6), 15);
        assert_eq!(documents_for_pairs(15), 6);
        assert_eq!(documents_for_pairs(14), 5);
        assert_eq!(documents_for_pairs(0), 1);
        for budget in [1usize, 3, 10, 15, 28, 45, 66] {
            let documents = documents_for_pairs(budget);
            assert!(document_pairs(documents) <= budget);
            assert!(document_pairs(documents + 1) > budget);
        }
    }
}
