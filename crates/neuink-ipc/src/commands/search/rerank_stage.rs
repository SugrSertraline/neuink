//! Rerank ladder: cross-encoder → field coverage → fused order.
//!
//! The stage exists so a missing or broken model can never break a search. Each rung is
//! reported per task (`used` plus a fixed `reason`), which is what makes the behaviour
//! auditable instead of guessed: "text-only because the reranker was not installed" and
//! "text-only because the reranker failed" must not look the same.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

use neuink_config::{RerankMode, RerankSettings};
use neuink_search::{
    rerank_hits_by_coverage, rerank_hits_with_provider, FieldCoverageWeights, RerankProvider,
    SearchHit,
};

/// Fixed codes reported with a task.
pub(super) const RERANK_OFF: &str = "off";
pub(super) const RERANK_HEURISTIC: &str = "heuristic";
pub(super) const RERANK_CROSS_ENCODER: &str = "cross_encoder";
pub(super) const RERANK_FUSED: &str = "fused";
pub(super) const REASON_MODEL_UNAVAILABLE: &str = "model_unavailable";
pub(super) const REASON_PROVIDER_ERROR: &str = "provider_error";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct RerankOutcome {
    pub used: &'static str,
    pub reason: Option<&'static str>,
}

impl RerankOutcome {
    fn plain(used: &'static str) -> Self {
        Self { used, reason: None }
    }

    fn with_reason(used: &'static str, reason: &'static str) -> Self {
        Self {
            used,
            reason: Some(reason),
        }
    }
}

/// Runs the ladder over the head of `hits`.
///
/// `provider` is the already-loaded cross-encoder, or `None` when it could not be loaded.
/// This function never panics and never returns an error: a rerank stage that fails is a
/// ranking choice, not a failed search.
pub(super) fn apply_rerank(
    hits: Vec<SearchHit>,
    query: &str,
    settings: &RerankSettings,
    provider: Option<&dyn RerankProvider>,
) -> (Vec<SearchHit>, RerankOutcome) {
    if hits.len() <= 1 {
        return (hits, RerankOutcome::plain(RERANK_OFF));
    }
    match settings.mode {
        RerankMode::Off => (hits, RerankOutcome::plain(RERANK_OFF)),
        RerankMode::Heuristic => (
            rerank_hits_by_coverage(&hits, query, &FieldCoverageWeights::default()),
            RerankOutcome::plain(RERANK_HEURISTIC),
        ),
        RerankMode::CrossEncoder => match provider {
            Some(provider) => match rerank_hits_with_provider(
                &hits,
                query,
                provider,
                settings.max_candidates,
            ) {
                Ok(ordered) => (ordered, RerankOutcome::plain(RERANK_CROSS_ENCODER)),
                Err(_) => fall_back(hits, query, settings, REASON_PROVIDER_ERROR),
            },
            None => fall_back(hits, query, settings, REASON_MODEL_UNAVAILABLE),
        },
    }
}

fn fall_back(
    hits: Vec<SearchHit>,
    query: &str,
    settings: &RerankSettings,
    reason: &'static str,
) -> (Vec<SearchHit>, RerankOutcome) {
    if settings.fallback_heuristic {
        (
            rerank_hits_by_coverage(&hits, query, &FieldCoverageWeights::default()),
            RerankOutcome::with_reason(RERANK_HEURISTIC, reason),
        )
    } else {
        (hits, RerankOutcome::with_reason(RERANK_FUSED, reason))
    }
}

/// Single-slot cache: one reranker model at a time, keyed by directory and modification
/// time so a replaced model is reloaded. A failed load is cached too, because retrying a
/// missing or broken 279 MB model on every query would be worse than the failure.
/// Whether a model file exists at the directory, without loading it.
///
/// A settings screen asks "is the model installed", not "does inference work". Loading a
/// 279 MB ONNX graph takes seconds and is a live read that changes nothing about the
/// answer, so presence is answered by the file layout that `LocalReranker` looks for.
pub(super) fn reranker_model_present(model_dir: &Path) -> bool {
    const CANDIDATES: [&str; 3] = ["onnx/model_int8.onnx", "onnx/model.onnx", "model.onnx"];
    CANDIDATES
        .iter()
        .any(|relative| model_dir.join(relative).is_file())
}

pub(super) fn reranker_for(model_dir: &Path) -> Option<Arc<neuink_search::LocalReranker>> {
    #[cfg(not(feature = "local-embedding"))]
    {
        let _ = model_dir;
        None
    }
    #[cfg(feature = "local-embedding")]
    {
        type Slot = Option<(PathBuf, Option<SystemTime>, Option<Arc<neuink_search::LocalReranker>>)>;
        static CACHE: OnceLock<Mutex<Slot>> = OnceLock::new();
        let modified = std::fs::metadata(model_dir)
            .and_then(|metadata| metadata.modified())
            .ok();
        let mut cache = match CACHE.get_or_init(|| Mutex::new(None)).lock() {
            Ok(cache) => cache,
            Err(_) => return None,
        };
        if let Some((cached_dir, cached_modified, loaded)) = cache.as_ref() {
            if cached_dir == model_dir && *cached_modified == modified {
                return loaded.clone();
            }
        }
        let loaded = neuink_search::LocalReranker::load(model_dir).ok().map(Arc::new);
        *cache = Some((model_dir.to_path_buf(), modified, loaded.clone()));
        loaded
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use neuink_search::{RerankError, RerankResult, RerankScore};
    use neuink_search::{SearchDocumentSource, SearchTarget};
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
        }
    }

    struct PreferNumeric;

    impl RerankProvider for PreferNumeric {
        fn score(&self, _query: &str, documents: &[&str]) -> RerankResult<Vec<RerankScore>> {
            Ok(documents
                .iter()
                .enumerate()
                .map(|(index, document)| RerankScore {
                    index,
                    score: if document.contains("91.2") { 1.0 } else { 0.0 },
                })
                .collect())
        }
    }

    struct Broken;

    impl RerankProvider for Broken {
        fn score(&self, _query: &str, _documents: &[&str]) -> RerankResult<Vec<RerankScore>> {
            Err(RerankError::InferenceFailed("boom"))
        }
    }

    fn hits() -> Vec<SearchHit> {
        vec![
            hit("a", "prose about several cases"),
            hit("b", "accuracy 91.2 percent"),
        ]
    }

    fn settings(mode: RerankMode, fallback: bool) -> RerankSettings {
        RerankSettings {
            mode,
            model_dir: None,
            max_candidates: 20,
            fallback_heuristic: fallback,
        }
    }

    #[test]
    fn off_leaves_the_fused_order_alone() {
        let (ordered, outcome) = apply_rerank(hits(), "what accuracy percent", &settings(RerankMode::Off, true), None);
        assert_eq!(outcome.used, RERANK_OFF);
        assert_eq!(outcome.reason, None);
        assert_eq!(ordered[0].snippet, "prose about several cases");
    }

    #[test]
    fn the_heuristic_mode_orders_by_field_coverage() {
        let (ordered, outcome) = apply_rerank(hits(), "what accuracy percent", &settings(RerankMode::Heuristic, true), None);
        assert_eq!(outcome.used, RERANK_HEURISTIC);
        assert_eq!(ordered[0].snippet, "accuracy 91.2 percent");
    }

    #[test]
    fn a_missing_model_falls_back_to_the_heuristic_with_a_reason() {
        let (ordered, outcome) = apply_rerank(
            hits(),
            "what accuracy percent",
            &settings(RerankMode::CrossEncoder, true),
            None,
        );
        assert_eq!(outcome.used, RERANK_HEURISTIC);
        assert_eq!(outcome.reason, Some(REASON_MODEL_UNAVAILABLE));
        assert_eq!(ordered[0].snippet, "accuracy 91.2 percent");
    }

    #[test]
    fn a_missing_model_without_fallback_keeps_the_fused_order() {
        let (ordered, outcome) = apply_rerank(
            hits(),
            "what accuracy percent",
            &settings(RerankMode::CrossEncoder, false),
            None,
        );
        assert_eq!(outcome.used, RERANK_FUSED);
        assert_eq!(outcome.reason, Some(REASON_MODEL_UNAVAILABLE));
        assert_eq!(ordered[0].snippet, "prose about several cases");
    }

    #[test]
    fn a_working_encoder_is_used_and_reported() {
        let provider = PreferNumeric;
        let (ordered, outcome) = apply_rerank(
            hits(),
            "what accuracy",
            &settings(RerankMode::CrossEncoder, true),
            Some(&provider),
        );
        assert_eq!(outcome.used, RERANK_CROSS_ENCODER);
        assert_eq!(outcome.reason, None);
        assert_eq!(ordered[0].snippet, "accuracy 91.2 percent");
    }

    #[test]
    fn a_provider_error_falls_back_and_is_distinguishable_from_a_missing_model() {
        let provider = Broken;
        let (_, outcome) = apply_rerank(
            hits(),
            "what accuracy",
            &settings(RerankMode::CrossEncoder, true),
            Some(&provider),
        );
        assert_eq!(outcome.used, RERANK_HEURISTIC);
        assert_eq!(outcome.reason, Some(REASON_PROVIDER_ERROR));
    }

    #[test]
    fn a_single_hit_is_never_worth_a_rerank() {
        let single = vec![hit("a", "only")];
        let (_, outcome) = apply_rerank(single, "q", &settings(RerankMode::Heuristic, true), None);
        assert_eq!(outcome.used, RERANK_OFF);
    }

    #[test]
    fn model_presence_is_answered_by_the_file_layout_not_by_loading() {
        let missing = PathBuf::from("definitely-not-a-model-directory");
        assert!(!reranker_model_present(&missing));

        let dir = std::env::temp_dir().join(format!("neuink-rerank-presence-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("onnx")).expect("create dir");
        std::fs::write(dir.join("onnx/model_int8.onnx"), b"stub").expect("write stub");
        assert!(reranker_model_present(&dir));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_missing_model_directory_caches_a_failed_load() {
        let dir = PathBuf::from("definitely-not-a-model-directory");
        assert!(reranker_for(&dir).is_none());
        assert!(reranker_for(&dir).is_none());
    }

    /// Real ONNX proof for the `cross_encoder` rung.
    ///
    /// The rest of this module uses a fake provider, so those tests prove the ladder but
    /// not that a local `.onnx` model loads and reorders. Set `NEUINK_RERANK_ONNX_DIR` to
    /// a directory laid out as `onnx/model_int8.onnx` plus the four tokenizer files.
    #[test]
    fn a_real_onnx_model_loads_and_takes_the_cross_encoder_rung() {
        let Ok(dir) = std::env::var("NEUINK_RERANK_ONNX_DIR") else {
            return;
        };
        let loaded = reranker_for(&PathBuf::from(dir));
        assert!(loaded.is_some(), "the ONNX reranker must load");
        let provider = loaded.expect("loaded");
        let hits = vec![
            hit("a", "prose about several qualitative cases"),
            hit("b", "accuracy 91.2 percent on the test split"),
        ];
        let (ordered, outcome) = apply_rerank(
            hits,
            "what accuracy percent is reported",
            &settings(RerankMode::CrossEncoder, false),
            Some(provider.as_ref() as &dyn RerankProvider),
        );
        assert_eq!(outcome.used, RERANK_CROSS_ENCODER);
        assert_eq!(outcome.reason, None);
        // The cross-encoder must prefer the page that states the number.
        assert_eq!(ordered[0].snippet, "accuracy 91.2 percent on the test split");
    }
}
