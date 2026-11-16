//! Batch-level rerank: the ladder must reach every successful item and leave failures
//! untouched, without changing the error shape callers already handle.

use neuink_config::{RerankMode, RerankSettings};
use neuink_search::{results_from_hits, SearchDocumentSource, SearchHit, SearchTarget};
use neuink_domain::{EntryId, SegmentUid};

use super::{apply_batch_rerank, SearchSegmentsBatchItem, SearchSegmentsTaskError};

fn hit(snippet: &str) -> SearchHit {
    SearchHit {
        entry_id: EntryId::from_string("entry"),
        entry_title: "Paper".to_string(),
        source: SearchDocumentSource::default(),
        target: SearchTarget::Segment {
            entry_id: EntryId::from_string("entry"),
            segment_uid: SegmentUid::from_string("seg"),
            page_idx: 0,
        },
        title: "Paper".to_string(),
        snippet: snippet.to_string(),
        score: 1.0,
        matched_terms: Vec::new(),
    }
}

fn item(task_id: &str, snippets: &[&str]) -> SearchSegmentsBatchItem {
    let hits = snippets.iter().map(|snippet| hit(snippet)).collect::<Vec<_>>();
    SearchSegmentsBatchItem {
        task_id: task_id.to_string(),
        results: Some(results_from_hits(
            "what accuracy percent".to_string(),
            "hybrid".to_string(),
            1,
            hits,
            Vec::new(),
        )),
        error: None,
        rerank_used: None,
        rerank_reason: None,
    }
}

fn settings(mode: RerankMode, fallback: bool) -> RerankSettings {
    RerankSettings {
        mode,
        model_dir: None,
        max_candidates: 20,
        fallback_heuristic: fallback,
        transport: neuink_config::RerankTransport::Local,
        api_endpoint: None,
        api_key: None,
        api_model: None,
    }
}

#[test]
fn the_heuristic_rung_reorders_every_successful_batch_item() {
    let items = vec![
        item("t1", &["prose about several cases", "accuracy 91.2 percent"]),
        item("t2", &["no fields here", "value 12 total"]),
    ];
    let applied = apply_batch_rerank(items, &settings(RerankMode::Heuristic, true), None);
    assert_eq!(applied.len(), 2);
    for entry in &applied {
        assert_eq!(entry.rerank_used, Some("heuristic"));
        assert_eq!(entry.rerank_reason, None);
    }
    // The numeric page moves first in the first task.
    let first = applied[0].results.as_ref().expect("results");
    let ordered = neuink_search::ordered_hits(first);
    assert!(ordered[0].snippet.contains("91.2"));
}

#[test]
fn a_failed_item_is_untouched_and_keeps_its_fixed_error() {
    let error_item = SearchSegmentsBatchItem {
        task_id: "bad".to_string(),
        results: None,
        error: Some(SearchSegmentsTaskError {
            code: "search_failed",
            message: "search task failed",
        }),
        rerank_used: None,
        rerank_reason: None,
    };
    let applied = apply_batch_rerank(
        vec![item("t1", &["value 12"]), error_item],
        &settings(RerankMode::Heuristic, true),
        None,
    );
    assert_eq!(applied[1].error.as_ref().map(|error| error.code), Some("search_failed"));
    assert_eq!(applied[1].rerank_used, None);
}

#[test]
fn the_off_mode_reports_off_and_does_not_reorder() {
    let items = vec![item("t1", &["prose about several cases", "accuracy 91.2 percent"])];
    let applied = apply_batch_rerank(items, &settings(RerankMode::Off, true), None);
    assert_eq!(applied[0].rerank_used, Some("off"));
    let ordered = neuink_search::ordered_hits(applied[0].results.as_ref().expect("results"));
    assert!(ordered[0].snippet.contains("prose"));
}

#[test]
fn a_missing_cross_encoder_reports_the_fallback_reason_per_item() {
    // Two hits: a single hit never reaches the ladder, it returns `off` by design.
    let items = vec![item("t1", &["value 12", "no fields here"])];
    let applied = apply_batch_rerank(items, &settings(RerankMode::CrossEncoder, true), None);
    assert_eq!(applied[0].rerank_used, Some("heuristic"));
    assert_eq!(applied[0].rerank_reason, Some("model_unavailable"));
}

