use std::sync::atomic::{AtomicUsize, Ordering};

use crate::reranking::*;

/// Returns a fixed score list (or error) and counts how often it was called.
struct FakeProvider {
    response: RerankResult<Vec<RerankScore>>,
    calls: AtomicUsize,
}

impl FakeProvider {
    fn scoring(scores: &[(usize, f32)]) -> Self {
        Self {
            response: Ok(scores
                .iter()
                .map(|&(index, score)| RerankScore { index, score })
                .collect()),
            calls: AtomicUsize::new(0),
        }
    }

    fn failing(error: RerankError) -> Self {
        Self {
            response: Err(error),
            calls: AtomicUsize::new(0),
        }
    }

    fn call_count(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl RerankProvider for FakeProvider {
    fn score(&self, _query: &str, documents: &[&str]) -> RerankResult<Vec<RerankScore>> {
        assert!(
            !documents.is_empty(),
            "provider must not be called with no documents"
        );
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.response.clone()
    }
}

fn candidates(entries: &[(&str, &str)]) -> Vec<RerankCandidate> {
    entries
        .iter()
        .map(|(id, text)| RerankCandidate {
            id: (*id).to_string(),
            text: (*text).to_string(),
        })
        .collect()
}

fn three_candidates() -> Vec<RerankCandidate> {
    candidates(&[("a", "alpha"), ("b", "beta"), ("c", "gamma")])
}

fn original_indexes(ordered: &[RerankedCandidate]) -> Vec<usize> {
    ordered.iter().map(|item| item.original_index).collect()
}

#[test]
fn rerank_orders_by_descending_score() {
    let provider = FakeProvider::scoring(&[(0, 0.2), (1, 0.9), (2, 0.5)]);

    let ordered = rerank_candidates(&provider, "query", &three_candidates(), 10).unwrap();

    assert_eq!(original_indexes(&ordered), vec![1, 2, 0]);
    assert_eq!(ordered[0].id, "b");
    assert_eq!(ordered[0].score, 0.9);
    assert_eq!(provider.call_count(), 1);
}

#[test]
fn rerank_ties_keep_original_input_order() {
    let provider = FakeProvider::scoring(&[(0, 0.5), (1, 0.5), (2, 0.9), (3, 0.5)]);
    let input = candidates(&[("a", "1"), ("b", "2"), ("c", "3"), ("d", "4")]);

    let ordered = rerank_candidates(&provider, "query", &input, 10).unwrap();

    assert_eq!(original_indexes(&ordered), vec![2, 0, 1, 3]);
}

#[test]
fn rerank_treats_negative_zero_as_a_tie_with_zero() {
    let provider = FakeProvider::scoring(&[(0, -0.0), (1, 0.0)]);
    let input = candidates(&[("a", "1"), ("b", "2")]);

    let ordered = rerank_candidates(&provider, "query", &input, 10).unwrap();

    assert_eq!(original_indexes(&ordered), vec![0, 1]);
    assert!(ordered.iter().all(|item| item.score.is_sign_positive()));
}

#[test]
fn rerank_keeps_identity_by_original_index_when_ids_repeat() {
    let provider = FakeProvider::scoring(&[(0, 0.1), (1, 0.9), (2, 0.5)]);
    let input = candidates(&[("dup", "first"), ("dup", "second"), ("other", "third")]);

    let ordered = rerank_candidates(&provider, "query", &input, 10).unwrap();

    assert_eq!(original_indexes(&ordered), vec![1, 2, 0]);
    let ids = ordered
        .iter()
        .map(|item| item.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(ids, vec!["dup", "other", "dup"]);
    assert_eq!(ordered[0].score, 0.9);
    assert_eq!(ordered[2].score, 0.1);
}

#[test]
fn rerank_empty_input_returns_empty_without_calling_provider() {
    let provider = FakeProvider::scoring(&[]);

    let ordered = rerank_candidates(&provider, "query", &[], 10).unwrap();

    assert!(ordered.is_empty());
    assert_eq!(provider.call_count(), 0);
}

#[test]
fn rerank_rejects_blank_query_without_calling_provider() {
    let provider = FakeProvider::scoring(&[(0, 1.0)]);
    let input = candidates(&[("a", "text")]);

    let error = rerank_candidates(&provider, "  \t ", &input, 10).unwrap_err();

    assert_eq!(error, RerankError::EmptyQuery);
    assert_eq!(provider.call_count(), 0);
}

#[test]
fn rerank_rejects_input_above_limit_instead_of_truncating() {
    let provider = FakeProvider::scoring(&[(0, 0.1), (1, 0.2)]);

    let error = rerank_candidates(&provider, "query", &three_candidates(), 2).unwrap_err();

    assert_eq!(error, RerankError::TooManyCandidates { count: 3, max: 2 });
    assert_eq!(provider.call_count(), 0);
}

#[test]
fn rerank_accepts_input_exactly_at_limit() {
    let provider = FakeProvider::scoring(&[(0, 0.1), (1, 0.2), (2, 0.3)]);

    let ordered = rerank_candidates(&provider, "query", &three_candidates(), 3).unwrap();

    assert_eq!(ordered.len(), 3);
}

#[test]
fn rerank_rejects_candidate_limit_outside_bounds() {
    let provider = FakeProvider::scoring(&[]);
    let expected_zero = RerankError::InvalidCandidateLimit {
        requested: 0,
        limit: RERANK_MAX_CANDIDATES_LIMIT,
    };
    let expected_high = RerankError::InvalidCandidateLimit {
        requested: RERANK_MAX_CANDIDATES_LIMIT + 1,
        limit: RERANK_MAX_CANDIDATES_LIMIT,
    };

    assert_eq!(
        rerank_candidates(&provider, "query", &[], 0).unwrap_err(),
        expected_zero
    );
    assert_eq!(
        rerank_candidates(&provider, "query", &[], RERANK_MAX_CANDIDATES_LIMIT + 1).unwrap_err(),
        expected_high
    );
    assert_eq!(provider.call_count(), 0);
}

#[test]
fn rerank_rejects_score_list_shorter_than_candidates() {
    let provider = FakeProvider::scoring(&[(0, 0.1), (1, 0.2)]);

    let error = rerank_candidates(&provider, "query", &three_candidates(), 10).unwrap_err();

    assert_eq!(
        error,
        RerankError::InvalidOutput("score count does not match candidate count")
    );
}

#[test]
fn rerank_rejects_score_list_longer_than_candidates() {
    let provider = FakeProvider::scoring(&[(0, 0.1), (1, 0.2), (2, 0.3), (0, 0.4)]);

    let error = rerank_candidates(&provider, "query", &three_candidates(), 10).unwrap_err();

    assert_eq!(
        error,
        RerankError::InvalidOutput("score count does not match candidate count")
    );
}

#[test]
fn rerank_rejects_out_of_range_score_index() {
    let provider = FakeProvider::scoring(&[(0, 0.1), (1, 0.2), (3, 0.3)]);

    let error = rerank_candidates(&provider, "query", &three_candidates(), 10).unwrap_err();

    assert_eq!(
        error,
        RerankError::InvalidOutput("score index is out of range")
    );
}

#[test]
fn rerank_rejects_duplicate_index_even_when_count_matches() {
    let provider = FakeProvider::scoring(&[(0, 0.1), (0, 0.2), (2, 0.3)]);

    let error = rerank_candidates(&provider, "query", &three_candidates(), 10).unwrap_err();

    assert_eq!(
        error,
        RerankError::InvalidOutput("score index is duplicated")
    );
}

#[test]
fn rerank_rejects_non_finite_scores_instead_of_dropping_them() {
    for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        let provider = FakeProvider::scoring(&[(0, 0.1), (1, bad), (2, 0.3)]);

        let error = rerank_candidates(&provider, "query", &three_candidates(), 10).unwrap_err();

        assert_eq!(error, RerankError::InvalidOutput("score is not finite"));
    }
}

#[test]
fn rerank_propagates_provider_errors_unchanged() {
    let provider = FakeProvider::failing(RerankError::InferenceFailed("reranker inference failed"));

    let error = rerank_candidates(&provider, "query", &three_candidates(), 10).unwrap_err();

    assert_eq!(
        error,
        RerankError::InferenceFailed("reranker inference failed")
    );
    assert_eq!(provider.call_count(), 1);
}

#[test]
fn rerank_constants_are_consistent() {
    assert_eq!(RERANK_MAX_LENGTH, 512);
    assert!(DEFAULT_RERANK_MAX_CANDIDATES >= 1);
    assert!(DEFAULT_RERANK_MAX_CANDIDATES <= RERANK_MAX_CANDIDATES_LIMIT);
}

#[test]
fn rerank_local_options_default_keeps_previous_load_behavior() {
    let options = LocalRerankerOptions::default();

    assert_eq!(options.intra_threads, None);
    assert_eq!(options.batch_size, RERANK_DEFAULT_BATCH_SIZE);
    assert_eq!(RERANK_DEFAULT_BATCH_SIZE, 8);
}

#[test]
fn rerank_error_messages_do_not_echo_candidate_text() {
    let provider = FakeProvider::scoring(&[(0, 0.1), (1, f32::NAN), (2, 0.3)]);
    let input = candidates(&[
        ("a", "SECRET-BODY-ONE"),
        ("b", "SECRET-BODY-TWO"),
        ("c", "x"),
    ]);

    let error = rerank_candidates(&provider, "query", &input, 10).unwrap_err();

    assert!(!error.to_string().contains("SECRET-BODY"));
}
