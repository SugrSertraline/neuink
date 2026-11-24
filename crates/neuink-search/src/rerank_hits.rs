//! Apply a cross-encoder to retrieved hits with an explicit bound.
//!
//! `rerank_candidates` rejects input above the cap rather than truncating silently. This
//! wrapper makes the bound explicit instead: the first `max_candidates` hits are scored,
//! and the remainder keep their incoming order behind them. Nothing is dropped, and the
//! caller can see that only the head was judged.

use crate::reranking::{rerank_candidates, RerankCandidate, RerankProvider, RerankResult};
use crate::structural_prior::format_structured_hit;
use crate::SearchHit;

pub fn rerank_hits_with_provider(
    hits: &[SearchHit],
    query: &str,
    provider: &dyn RerankProvider,
    max_candidates: usize,
) -> RerankResult<Vec<SearchHit>> {
    rerank_hits_with_provider_structured(hits, query, provider, max_candidates, false)
}

pub fn rerank_hits_with_provider_structured(
    hits: &[SearchHit],
    query: &str,
    provider: &dyn RerankProvider,
    max_candidates: usize,
    structured_input: bool,
) -> RerankResult<Vec<SearchHit>> {
    let mut ordered =
        rerank_hits_with_provider_raw(hits, query, provider, max_candidates, structured_input)?;
    stamp_rank_scores(&mut ordered);
    Ok(ordered)
}

/// Reorders the head while preserving the provider's raw finite scores on scored hits
/// so a subsequent score-based prior (`B0-sec-soft`) is independent of pool length `N`.
pub fn rerank_hits_with_provider_raw(
    hits: &[SearchHit],
    query: &str,
    provider: &dyn RerankProvider,
    max_candidates: usize,
    structured_input: bool,
) -> RerankResult<Vec<SearchHit>> {
    if hits.is_empty() {
        return Ok(Vec::new());
    }
    let head = hits.len().min(max_candidates.max(1));
    let candidates = hits[..head]
        .iter()
        .map(|hit| RerankCandidate {
            id: String::new(),
            text: if structured_input {
                format_structured_hit(hit)
            } else {
                hit.snippet.clone()
            },
        })
        .collect::<Vec<_>>();
    let reranked = rerank_candidates(provider, query, &candidates, head)?;
    let mut ordered = Vec::with_capacity(hits.len());
    for candidate in reranked {
        let mut item = hits[candidate.original_index].clone();
        item.score = candidate.score;
        ordered.push(item);
    }
    ordered.extend(hits[head..].iter().cloned());
    Ok(ordered)
}

/// Writes a strictly decreasing score from rank so a later score sort cannot restore
/// the pre-rerank order. Rank 0 keeps the highest score.
pub fn stamp_rank_scores(hits: &mut [SearchHit]) {
    let total = hits.len();
    if total == 0 {
        return;
    }
    let total = total as f32;
    for (rank, hit) in hits.iter_mut().enumerate() {
        hit.score = (total - rank as f32) / total;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reranking::{RerankError, RerankScore};
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

    /// Prefers documents containing "target" and rejects anything else.
    struct KeywordReranker;

    impl RerankProvider for KeywordReranker {
        fn score(&self, _query: &str, documents: &[&str]) -> RerankResult<Vec<RerankScore>> {
            Ok(documents
                .iter()
                .enumerate()
                .map(|(index, document)| RerankScore {
                    index,
                    score: if document.contains("target") {
                        1.0
                    } else {
                        0.0
                    },
                })
                .collect())
        }
    }

    struct AlwaysFails;

    impl RerankProvider for AlwaysFails {
        fn score(&self, _query: &str, _documents: &[&str]) -> RerankResult<Vec<RerankScore>> {
            Err(RerankError::InferenceFailed("boom"))
        }
    }

    #[test]
    fn the_head_is_reordered_and_the_tail_keeps_its_order() {
        let hits = vec![
            hit("a", "nothing here"),
            hit("b", "a target value"),
            hit("c", "tail one"),
            hit("d", "tail two"),
        ];
        let ordered = rerank_hits_with_provider(&hits, "q", &KeywordReranker, 2).expect("rerank");
        assert_eq!(
            ordered
                .iter()
                .map(|hit| hit.snippet.as_str())
                .collect::<Vec<_>>(),
            ["a target value", "nothing here", "tail one", "tail two"]
        );
    }

    #[test]
    fn a_provider_error_is_returned_rather_than_swallowed() {
        let hits = vec![hit("a", "text")];
        assert!(rerank_hits_with_provider(&hits, "q", &AlwaysFails, 10).is_err());
    }

    #[test]
    fn an_empty_list_needs_no_provider_call() {
        assert!(rerank_hits_with_provider(&[], "q", &AlwaysFails, 10)
            .expect("empty")
            .is_empty());
    }

    #[test]
    fn stamped_scores_keep_the_provider_order_after_results_are_rebuilt() {
        let mut first = hit("a", "plain prose");
        first.score = 0.95;
        let mut second = hit("b", "a target value");
        second.score = 0.10;
        let ordered =
            rerank_hits_with_provider(&[first, second], "q", &KeywordReranker, 20).expect("rerank");
        assert!(ordered[0].score > ordered[1].score);
        let results = crate::retrieval_pipeline::results_from_hits(
            "q".to_string(),
            "hybrid".to_string(),
            1,
            ordered,
            Vec::new(),
        );
        let again = crate::retrieval_pipeline::ordered_hits(&results);
        assert!(
            again[0].snippet.contains("target"),
            "score sort restored the old order"
        );
    }
}
