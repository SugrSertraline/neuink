//! Rerank ladder: cross-encoder → field coverage → fused order.
//!
//! The stage exists so a missing or broken model can never break a search. Each rung is
//! reported per task (`used` plus a fixed `reason`), which is what makes the behaviour
//! auditable instead of guessed: "text-only because the reranker was not installed" and
//! "text-only because the reranker failed" must not look the same.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
#[cfg(feature = "local-embedding")]
use std::time::SystemTime;

use neuink_config::{LlmApiProtocol, LlmProfile, RerankMode, RerankSettings};
use neuink_search::{
    apply_structural_soft_demotion, apply_structural_soft_demotion_head, format_structured_hit,
    fuse_pool_rrf_with_profile, fuse_rankings_rrf, is_single_paper_hits, refine_tail_with_scope_v6,
    reorder_listwise_hits, PoolRrfProfile,
    rerank_hits_by_coverage, rerank_hits_with_provider_raw,
    stamp_rank_scores, FieldCoverageWeights, HttpListwiseReranker, HttpScopeJudge,
    ListwisePromptStyle, ListwiseRerankProvider, RerankProvider, ScopeJudgeProvider,
    ScopeSwapSummary, SearchHit,
};

/// Fixed codes reported with a task.
pub(super) const RERANK_OFF: &str = "off";
pub(super) const RERANK_STRUCTURAL_SOFT: &str = "structural_soft";
pub(super) const RERANK_HEURISTIC: &str = "heuristic";
pub(super) const RERANK_CROSS_ENCODER: &str = "cross_encoder";
pub(super) const RERANK_CROSS_ENCODER_SCOPE_V6: &str = "cross_encoder+scope_v6";
pub(super) const RERANK_FUSED: &str = "fused";
pub(super) const REASON_MODEL_UNAVAILABLE: &str = "model_unavailable";
pub(super) const REASON_PROVIDER_ERROR: &str = "provider_error";
/// The hosted transport is selected but endpoint, key or model is missing.
pub(super) const REASON_API_UNCONFIGURED: &str = "api_unconfigured";
pub(super) const REASON_SCOPE_REFINE_UNCONFIGURED: &str = "scope_refine_unconfigured";
pub(super) const REASON_SCOPE_REFINE_ERROR: &str = "scope_refine_error";
pub(super) const RERANK_POOL_RRF: &str = "cross_encoder+pool_rrf";
pub(super) const REASON_LISTWISE_UNCONFIGURED: &str = "listwise_unconfigured";
pub(super) const REASON_LISTWISE_ERROR: &str = "listwise_error";

#[derive(Clone, Debug, PartialEq)]
pub(super) struct RerankOutcome {
    pub used: &'static str,
    pub reason: Option<&'static str>,
    pub swaps: Vec<ScopeSwapSummary>,
    /// Raw Cross-Encoder confidence. Set only after a successful encoder pass.
    pub ce_confidence: Option<neuink_search::CeConfidence>,
}

impl RerankOutcome {
    fn plain(used: &'static str) -> Self {
        Self {
            used,
            reason: None,
            swaps: Vec::new(),
            ce_confidence: None,
        }
    }

    fn with_reason(used: &'static str, reason: &'static str) -> Self {
        Self {
            used,
            reason: Some(reason),
            swaps: Vec::new(),
            ce_confidence: None,
        }
    }
}

/// How many hits to recall before the ladder. Scope refine needs ranks 11..=20 on the page.
pub(super) fn recall_window(requested: usize, settings: &RerankSettings) -> usize {
    let requested = requested.clamp(1, 20);
    if settings.mode == RerankMode::Off && !settings.listwise.enabled {
        return requested;
    }
    let mut window = requested;
    if settings.mode != RerankMode::Off {
        window = window.max(settings.max_candidates.max(1));
    }
    if settings.mode == RerankMode::CrossEncoder && settings.scope_refine.enabled {
        window = window.max(20);
    }
    if settings.listwise.enabled {
        window = window.max(settings.listwise.top_n);
    }
    window.min(200)
}

/// First-stage recall window accounting for an enabled BGE-M3 multi-vector pool.
pub(super) fn effective_recall_window(
    requested: usize,
    settings: &RerankSettings,
    multivector: &neuink_config::MultivectorPoolSettings,
) -> usize {
    let mut window = recall_window(requested, settings);
    if multivector.enabled {
        window = window.max(multivector.rescore_window.max(1));
    }
    window.min(200)
}

#[cfg(test)]
pub(super) fn resolved_rerank_dir(settings: &RerankSettings, bundled: &Path) -> PathBuf {
    settings
        .model_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| bundled.to_path_buf())
}

/// How many head hits the cross-encoder scores. Scope refine needs ranks 11..=20
/// to be encoder order, even when the user set a smaller `max_candidates`.
fn encoder_head(settings: &RerankSettings) -> usize {
    let mut head = settings.max_candidates.max(1);
    if settings.scope_refine.enabled {
        head = head.max(20);
    }
    head.min(neuink_search::RERANK_MAX_CANDIDATES_LIMIT)
}

/// Local model directory. A custom directory wins. A missing bundled directory is `None`
/// so the ladder degrades instead of failing the search.
pub(super) fn local_model_dir(settings: &RerankSettings, bundled: Option<&Path>) -> Option<PathBuf> {
    if let Some(custom) = settings
        .model_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(PathBuf::from(custom));
    }
    bundled.map(Path::to_path_buf)
}

fn truncate_hits(mut hits: Vec<SearchHit>, top_k: usize) -> Vec<SearchHit> {
    if top_k > 0 && hits.len() > top_k {
        hits.truncate(top_k);
    }
    hits
}

/// Runs the ladder over the head of `hits`.
///
/// `provider` is the already-loaded cross-encoder, or `None` when it could not be loaded.
/// This function never panics and never returns an error: a rerank stage that fails is a
/// ranking choice, not a failed search.
#[cfg(test)]
pub(super) fn apply_rerank(
    hits: Vec<SearchHit>,
    query: &str,
    settings: &RerankSettings,
    provider: Option<&dyn RerankProvider>,
) -> (Vec<SearchHit>, RerankOutcome) {
    apply_rerank_with_scope(hits, query, settings, provider, None, None, 0)
}

/// Chooses the effective query passed to Cross-Encoder / Heuristic / Listwise rerankers.
/// When the user asks in Chinese (`question` contains CJK), an `english_query` is provided,
/// and the recalled head passages are predominantly English (>70% Latin letters vs CJK),
/// rerankers score against `english_query` to avoid cross-lingual scoring degradation
/// (especially critical for local `bge-reranker-base` and English-vocabulary `heuristic`).
pub(super) fn effective_rerank_query<'a>(
    question: &'a str,
    english_query: Option<&'a str>,
    hits: &[SearchHit],
) -> &'a str {
    let Some(english) = english_query.map(str::trim).filter(|value| !value.is_empty()) else {
        return question;
    };
    if !super::contains_cjk(question) {
        return question;
    }
    let mut latin = 0usize;
    let mut cjk = 0usize;
    for hit in hits.iter().take(5) {
        for ch in hit.snippet.chars() {
            if ch.is_ascii_alphabetic() {
                latin += 1;
            } else if matches!(ch, '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}') {
                cjk += 1;
            }
        }
    }
    if latin > 0 && latin * 10 > (latin + cjk) * 7 {
        english
    } else {
        question
    }
}

fn combined_intent_query(question: &str, english_query: Option<&str>) -> String {
    match english_query.map(str::trim).filter(|value| !value.is_empty()) {
        Some(english) if english != question.trim() => format!("{question} {english}"),
        _ => question.to_string(),
    }
}

/// Runs the ladder, then the optional v6 tail, then cuts back to the requested `top_k`.
///
/// `top_k == 0` leaves the recalled list intact. That is what the older call sites use.
/// Scope refine never fails the search: a missing judge or a failed batch keeps the
/// cross-encoder order and records why.
#[cfg(test)]
pub(super) fn apply_rerank_with_scope(
    hits: Vec<SearchHit>,
    query: &str,
    settings: &RerankSettings,
    provider: Option<&dyn RerankProvider>,
    scope_judge: Option<&dyn ScopeJudgeProvider>,
    listwise: Option<&dyn ListwiseRerankProvider>,
    top_k: usize,
) -> (Vec<SearchHit>, RerankOutcome) {
    apply_rerank_with_scope_and_english(
        hits,
        query,
        None,
        settings,
        provider,
        scope_judge,
        listwise,
        top_k,
    )
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(super) fn apply_rerank_with_scope_and_english(
    hits: Vec<SearchHit>,
    query: &str,
    english_query: Option<&str>,
    settings: &RerankSettings,
    provider: Option<&dyn RerankProvider>,
    scope_judge: Option<&dyn ScopeJudgeProvider>,
    listwise: Option<&dyn ListwiseRerankProvider>,
    top_k: usize,
) -> (Vec<SearchHit>, RerankOutcome) {
    apply_rerank_with_supplements(
        hits,
        query,
        english_query,
        settings,
        provider,
        scope_judge,
        listwise,
        top_k,
        &HashSet::new(),
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn apply_rerank_with_supplements(
    hits: Vec<SearchHit>,
    query: &str,
    english_query: Option<&str>,
    settings: &RerankSettings,
    provider: Option<&dyn RerankProvider>,
    scope_judge: Option<&dyn ScopeJudgeProvider>,
    listwise: Option<&dyn ListwiseRerankProvider>,
    top_k: usize,
    pre_ce_supplement_ids: &HashSet<String>,
) -> (Vec<SearchHit>, RerankOutcome) {
    if hits.len() <= 1
        || (settings.mode == RerankMode::Off
            && !settings.listwise.enabled
            && !settings.structural_soft_demotion)
    {
        return (hits, RerankOutcome::plain(RERANK_OFF));
    }
    let stage1 = hits.clone();
    let rerank_q = effective_rerank_query(query, english_query, &hits);
    let intent_q = combined_intent_query(query, english_query);
    let mut soft_head: Option<usize> = None;
    let (mut ordered, mut outcome) = match settings.mode {
        RerankMode::Off => (hits, RerankOutcome::plain(RERANK_OFF)),
        RerankMode::Heuristic => (
            rerank_hits_by_coverage(&hits, rerank_q, &FieldCoverageWeights::default()),
            RerankOutcome::plain(RERANK_HEURISTIC),
        ),
        RerankMode::CrossEncoder => match provider {
            Some(provider) => {
                // Keep raw cross-encoder scores whenever B0-sec-soft will run right after
                // (including when `fuse_with_pool` is also enabled), so soft demotion scales
                // with true encoder score margins rather than candidate pool length `N`.
                let keep_raw_for_soft =
                    settings.structural_soft_demotion && !settings.scope_refine.enabled;
                let head = encoder_head(settings);
                let rerank_result = rerank_hits_with_provider_raw(
                    &hits,
                    rerank_q,
                    provider,
                    head,
                    settings.structured_input,
                );
                match rerank_result {
                Ok(mut ordered) => {
                    let scored = ordered.len().min(head);
                    let raw_scores = ordered
                        .iter()
                        .take(scored)
                        .map(|hit| hit.score)
                        .collect::<Vec<_>>();
                    let ce_confidence = neuink_search::CeConfidence::from_raw_scores(&raw_scores);
                    if keep_raw_for_soft {
                        soft_head = Some(scored);
                    } else {
                        stamp_rank_scores(&mut ordered);
                    }
                    let mut outcome = RerankOutcome::plain(RERANK_CROSS_ENCODER);
                    outcome.ce_confidence = ce_confidence;
                    if settings.scope_refine.enabled && !settings.listwise.enabled && ordered.len() > 10 {
                        match scope_judge {
                            None => {
                                outcome = RerankOutcome::with_reason(
                                    RERANK_CROSS_ENCODER,
                                    REASON_SCOPE_REFINE_UNCONFIGURED,
                                );
                                outcome.ce_confidence = ce_confidence;
                            }
                            Some(judge) => {
                                let report = refine_tail_with_scope_v6(&ordered, rerank_q, judge);
                                if report.errored {
                                    outcome = RerankOutcome::with_reason(
                                        RERANK_CROSS_ENCODER,
                                        REASON_SCOPE_REFINE_ERROR,
                                    );
                                    outcome.ce_confidence = ce_confidence;
                                } else {
                                    ordered = report.hits;
                                    stamp_rank_scores(&mut ordered);
                                    outcome = RerankOutcome {
                                        used: RERANK_CROSS_ENCODER_SCOPE_V6,
                                        reason: None,
                                        swaps: report.swaps,
                                        ce_confidence: outcome.ce_confidence,
                                    };
                                }
                            }
                        }
                    }
                    (ordered, outcome)
                }
                Err(_) => fall_back(hits, rerank_q, settings, REASON_PROVIDER_ERROR),
                }
            }
            None => fall_back(hits, rerank_q, settings, unavailable_reason(settings)),
        },
    };
    // Apply B0-sec-soft BEFORE optional pool RRF so soft demotion runs on raw Cross-Encoder
    // scores (pool-length independent) rather than stamped linear rank scores `(N - r) / N`.
    if settings.structural_soft_demotion && outcome.used != RERANK_CROSS_ENCODER_SCOPE_V6 {
        ordered = match soft_head {
            Some(head) => apply_structural_soft_demotion_head(&ordered, &intent_q, head),
            None => apply_structural_soft_demotion(&ordered, &intent_q),
        };
        if outcome.used == RERANK_OFF {
            outcome.used = RERANK_STRUCTURAL_SOFT;
        }
    }
    if settings.fuse_with_pool && outcome.used == RERANK_CROSS_ENCODER {
        let profile = if is_single_paper_hits(&stage1) {
            if pre_ce_supplement_ids.is_empty() {
                PoolRrfProfile::pure_text_single()
            } else {
                PoolRrfProfile::supplemented_single()
            }
        } else {
            PoolRrfProfile::multi_doc()
        };
        ordered = fuse_pool_rrf_with_profile(&stage1, &ordered, profile, pre_ce_supplement_ids);
        outcome.used = RERANK_POOL_RRF;
    }
    if settings.listwise.enabled && !settings.scope_refine.enabled {
        outcome = apply_listwise(rerank_q, settings, listwise, &mut ordered, outcome);
    }
    (truncate_hits(ordered, top_k), outcome)
}

fn apply_listwise(
    query: &str,
    settings: &RerankSettings,
    listwise: Option<&dyn ListwiseRerankProvider>,
    ordered: &mut Vec<SearchHit>,
    outcome: RerankOutcome,
) -> RerankOutcome {
    let Some(listwise) = listwise else {
        return RerankOutcome {
            used: outcome.used,
            reason: Some(REASON_LISTWISE_UNCONFIGURED),
            swaps: outcome.swaps,
            ce_confidence: outcome.ce_confidence,
        };
    };
    let head = ordered.len().min(settings.listwise.top_n.max(1));
    let single_paper = settings.listwise.single_paper_mode && is_single_paper_hits(ordered);
    let documents = ordered[..head]
        .iter()
        .map(|hit| {
            if single_paper {
                format_structured_hit(hit)
            } else {
                hit.snippet.clone()
            }
        })
        .collect::<Vec<_>>();
    let result = if single_paper {
        let paper_title = ordered
            .first()
            .map(|hit| hit.entry_title.clone())
            .unwrap_or_default();
        listwise.reorder_with_style(
            query,
            &documents,
            &ListwisePromptStyle::SinglePaper { paper_title },
        )
    } else {
        listwise.reorder(query, &documents)
    };
    match result {
        Ok(parsed) if !parsed.fallback => {
            let reranked = reorder_listwise_hits(ordered, &parsed, head);
            // Single-paper mode outputs direct L1 order: RRF with B0 re-injects Abstract
            // false positives (-9.32pp P@1 measured in single-paper-precision-v3).
            let fuse = !single_paper && settings.listwise.fuse_rrf;
            if fuse {
                *ordered = fuse_rankings_rrf(ordered, &reranked);
            } else {
                *ordered = reranked;
            }
            RerankOutcome {
                used: listwise_used(outcome.used, fuse, single_paper),
                reason: None,
                swaps: outcome.swaps,
                ce_confidence: outcome.ce_confidence,
            }
        }
        _ => RerankOutcome {
            used: outcome.used,
            reason: Some(REASON_LISTWISE_ERROR),
            swaps: outcome.swaps,
            ce_confidence: outcome.ce_confidence,
        },
    }
}

fn listwise_used(base: &'static str, fuse: bool, single_paper: bool) -> &'static str {
    if single_paper {
        return match base {
            RERANK_OFF | RERANK_STRUCTURAL_SOFT => "listwise_single",
            RERANK_HEURISTIC => "heuristic+listwise_single",
            RERANK_CROSS_ENCODER => "cross_encoder+listwise_single",
            RERANK_POOL_RRF => "cross_encoder+pool_rrf+listwise_single",
            _ => "listwise_single",
        };
    }
    match (base, fuse) {
        (RERANK_OFF | RERANK_STRUCTURAL_SOFT, false) => "listwise",
        (RERANK_OFF | RERANK_STRUCTURAL_SOFT, true) => "listwise+rrf",
        (RERANK_HEURISTIC, false) => "heuristic+listwise",
        (RERANK_HEURISTIC, true) => "heuristic+listwise+rrf",
        (RERANK_CROSS_ENCODER, false) => "cross_encoder+listwise",
        (RERANK_CROSS_ENCODER, true) => "cross_encoder+listwise+rrf",
        (RERANK_POOL_RRF, false) => "cross_encoder+pool_rrf+listwise",
        (RERANK_POOL_RRF, true) => "cross_encoder+pool_rrf+listwise+rrf",
        (_, false) => "listwise",
        (_, true) => "listwise+rrf",
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
const RERANK_MODEL_CANDIDATES: [&str; 4] = [
    "onnx/model_int8.onnx",
    "onnx/model.onnx",
    // Xenova exports name their int8 file this way; the loader accepts it.
    "onnx/model_quantized.onnx",
    "model.onnx",
];

pub fn reranker_model_present(model_dir: &Path) -> bool {
    RERANK_MODEL_CANDIDATES
        .iter()
        .any(|relative| model_dir.join(relative).is_file())
}

#[cfg(feature = "local-embedding")]
#[derive(Clone, Debug, PartialEq, Eq)]
struct LocalModelFingerprint {
    dir: PathBuf,
    dir_modified: Option<SystemTime>,
    model_file: Option<PathBuf>,
    file_len: Option<u64>,
    file_modified: Option<SystemTime>,
}

#[cfg(feature = "local-embedding")]
fn local_model_fingerprint(model_dir: &Path) -> LocalModelFingerprint {
    let dir_modified = std::fs::metadata(model_dir)
        .and_then(|metadata| metadata.modified())
        .ok();
    let model_file = RERANK_MODEL_CANDIDATES
        .iter()
        .map(|relative| model_dir.join(relative))
        .find(|path| path.is_file());
    let (file_len, file_modified) = model_file
        .as_deref()
        .and_then(|path| std::fs::metadata(path).ok())
        .map(|meta| (Some(meta.len()), meta.modified().ok()))
        .unwrap_or((None, None));
    LocalModelFingerprint {
        dir: model_dir.to_path_buf(),
        dir_modified,
        model_file,
        file_len,
        file_modified,
    }
}

pub fn reranker_for(model_dir: &Path) -> Option<Arc<dyn RerankProvider>> {
    #[cfg(not(feature = "local-embedding"))]
    {
        let _ = model_dir;
        None
    }
    #[cfg(feature = "local-embedding")]
    {
        type Slot = Option<(LocalModelFingerprint, Option<Arc<neuink_search::LocalReranker>>)>;
        static CACHE: OnceLock<Mutex<Slot>> = OnceLock::new();
        let fingerprint = local_model_fingerprint(model_dir);
        let mut cache = match CACHE.get_or_init(|| Mutex::new(None)).lock() {
            Ok(cache) => cache,
            Err(_) => return None,
        };
        if let Some((cached_fp, loaded)) = cache.as_ref() {
            if *cached_fp == fingerprint {
                return loaded.clone().map(|value| value as Arc<dyn RerankProvider>);
            }
        }
        let loaded = neuink_search::LocalReranker::load(model_dir).ok().map(Arc::new);
        *cache = Some((fingerprint, loaded.clone()));
        loaded.map(|value| value as Arc<dyn RerankProvider>)
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
            surrounding_context: None,
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
            fallback_heuristic: fallback,
            fuse_with_pool: false,
            structured_input: false,
            structural_soft_demotion: false,
            ..RerankSettings::default()
        }
    }

    struct PreferSecond;

    impl RerankProvider for PreferSecond {
        fn score(&self, _query: &str, documents: &[&str]) -> RerankResult<Vec<RerankScore>> {
            Ok(documents
                .iter()
                .enumerate()
                .map(|(index, _)| RerankScore {
                    index,
                    score: index as f32,
                })
                .collect())
        }
    }

    struct Reverse;

    impl ListwiseRerankProvider for Reverse {
        fn reorder(&self, _query: &str, documents: &[String]) -> Result<neuink_search::ListwiseOrder, String> {
            Ok(neuink_search::ListwiseOrder {
                indexes: (0..documents.len()).rev().collect(),
                fallback: false,
            })
        }
    }

    fn multi_entry_hits() -> Vec<SearchHit> {
        let mut second = hit("b", "accuracy 91.2 percent");
        second.entry_id = EntryId::from_string("entry-2");
        vec![hit("a", "prose about several cases"), second]
    }

    #[test]
    fn listwise_without_a_cross_encoder_reorders_the_head() {
        let mut settings = settings(RerankMode::Off, true);
        settings.listwise.enabled = true;
        settings.listwise.fuse_rrf = false;
        settings.listwise.top_n = 10;
        let (ordered, outcome) = apply_rerank_with_scope(
            multi_entry_hits(),
            "accuracy",
            &settings,
            None,
            None,
            Some(&Reverse),
            0,
        );
        assert_eq!(outcome.used, "listwise");
        assert_eq!(ordered[0].snippet, "accuracy 91.2 percent");
    }

    #[test]
    fn cross_encoder_fusion_and_listwise_rrf_report_their_rungs() {
        let mut settings = settings(RerankMode::CrossEncoder, false);
        settings.fuse_with_pool = true;
        settings.listwise.enabled = true;
        settings.listwise.fuse_rrf = true;
        settings.listwise.top_n = 10;
        let (ordered, outcome) = apply_rerank_with_scope(
            multi_entry_hits(),
            "accuracy",
            &settings,
            Some(&PreferSecond),
            None,
            Some(&Reverse),
            0,
        );
        assert_eq!(outcome.used, "cross_encoder+pool_rrf+listwise+rrf");
        assert!(!ordered.is_empty());
    }

    #[test]
    fn single_paper_listwise_uses_structured_direct_l1_without_rrf() {
        struct CaptureSinglePaper(Mutex<Option<(ListwisePromptStyle, Vec<String>)>>);
        impl ListwiseRerankProvider for CaptureSinglePaper {
            fn reorder(&self, _query: &str, documents: &[String]) -> Result<neuink_search::ListwiseOrder, String> {
                Ok(neuink_search::ListwiseOrder {
                    indexes: (0..documents.len()).collect(),
                    fallback: false,
                })
            }
            fn reorder_with_style(
                &self,
                _query: &str,
                documents: &[String],
                style: &ListwisePromptStyle,
            ) -> Result<neuink_search::ListwiseOrder, String> {
                *self.0.lock().unwrap() = Some((style.clone(), documents.to_vec()));
                Ok(neuink_search::ListwiseOrder {
                    indexes: (0..documents.len()).rev().collect(),
                    fallback: false,
                })
            }
        }
        let mut abs = hit("a", "Abstract overview");
        abs.source.section_path = Some("Abstract".into());
        abs.source.segment_type = Some(neuink_domain::SegmentType::Paragraph);
        let mut res = hit("b", "Accuracy is 91.2%");
        res.source.section_path = Some("Results".into());
        res.source.segment_type = Some(neuink_domain::SegmentType::Paragraph);
        let mut settings = settings(RerankMode::Off, false);
        settings.listwise.enabled = true;
        settings.listwise.fuse_rrf = true;
        settings.listwise.single_paper_mode = true;
        let capture = CaptureSinglePaper(Mutex::new(None));
        let (ordered, outcome) = apply_rerank_with_scope(
            vec![abs, res],
            "What is the accuracy?",
            &settings,
            None,
            None,
            Some(&capture),
            0,
        );
        assert_eq!(outcome.used, "listwise_single");
        assert_eq!(ordered[0].snippet, "Accuracy is 91.2%");
        let (style, docs) = capture.0.lock().unwrap().clone().expect("captured");
        assert_eq!(
            style,
            ListwisePromptStyle::SinglePaper {
                paper_title: "Paper".into()
            }
        );
        assert!(docs[0].starts_with("[Section: Abstract] [Type: Paragraph]\n"));
        assert!(docs[1].starts_with("[Section: Results] [Type: Paragraph]\n"));
    }

    #[test]
    fn structural_soft_demotion_runs_offline_even_when_rerank_mode_is_off() {
        let mut abs = hit("a", "We study sarcasm.");
        abs.source.section_role = Some(neuink_domain::CanonicalSectionRole::Abstract);
        abs.score = 0.90;
        let mut exp = hit("b", "Dataset has 120,000 tweets.");
        exp.source.section_path = Some("Dataset".into());
        exp.score = 0.80;
        let mut settings = settings(RerankMode::Off, false);
        settings.structural_soft_demotion = true;
        let (ordered, outcome) =
            apply_rerank_with_scope(vec![abs, exp], "What is the dataset size?", &settings, None, None, None, 0);
        assert_eq!(outcome.used, RERANK_STRUCTURAL_SOFT);
        assert_eq!(ordered[0].snippet, "Dataset has 120,000 tweets.");
    }

    #[test]
    fn structured_input_passes_section_and_type_to_cross_encoder() {
        struct PreferResultsSection;
        impl RerankProvider for PreferResultsSection {
            fn score(&self, _query: &str, documents: &[&str]) -> RerankResult<Vec<RerankScore>> {
                Ok(documents
                    .iter()
                    .enumerate()
                    .map(|(index, doc)| RerankScore {
                        index,
                        score: if doc.starts_with("[Section: Results] [Type: Paragraph]") {
                            1.0
                        } else {
                            0.0
                        },
                    })
                    .collect())
            }
        }
        let mut first = hit("a", "same words");
        first.source.section_path = Some("Abstract".into());
        first.source.segment_type = Some(neuink_domain::SegmentType::Paragraph);
        let mut second = hit("b", "same words");
        second.source.section_path = Some("Results".into());
        second.source.segment_type = Some(neuink_domain::SegmentType::Paragraph);
        let mut settings = settings(RerankMode::CrossEncoder, false);
        settings.structured_input = true;
        let (ordered, outcome) = apply_rerank_with_scope(
            vec![first, second],
            "results",
            &settings,
            Some(&PreferResultsSection),
            None,
            None,
            0,
        );
        assert_eq!(outcome.used, RERANK_CROSS_ENCODER);
        assert_eq!(ordered[0].source.section_path.as_deref(), Some("Results"));
    }

    #[test]
    fn effective_recall_window_expands_for_multivector_pool_only_when_enabled() {
        let rerank = RerankSettings::default();
        let mut mv = neuink_config::MultivectorPoolSettings::default();
        assert_eq!(effective_recall_window(10, &rerank, &mv), 10);
        mv.enabled = true;
        mv.rescore_window = 100;
        assert_eq!(effective_recall_window(10, &rerank, &mv), 100);
        mv.rescore_window = 500;
        assert_eq!(effective_recall_window(10, &rerank, &mv), 200);
    }

    #[test]
    fn structural_soft_demotion_uses_raw_cross_encoder_scores_independent_of_pool_size() {
        struct CloseLogits;
        impl RerankProvider for CloseLogits {
            fn score(&self, _query: &str, documents: &[&str]) -> RerankResult<Vec<RerankScore>> {
                Ok(documents
                    .iter()
                    .enumerate()
                    .map(|(index, doc)| RerankScore {
                        index,
                        score: if doc.contains("Abstract") {
                            2.0
                        } else if doc.contains("Results") {
                            1.5
                        } else {
                            -2.0 - index as f32 * 0.01
                        },
                    })
                    .collect())
            }
        }
        let mut s = settings(RerankMode::CrossEncoder, false);
        s.structural_soft_demotion = true;
        s.max_candidates = 100;
        for filler_count in [2usize, 60usize] {
            let mut pool = Vec::new();
            let mut abs = hit("abs", "Abstract overview");
            abs.source.section_role = Some(neuink_domain::CanonicalSectionRole::Abstract);
            pool.push(abs);
            let mut res = hit("res", "Results show 91.2%");
            res.source.section_path = Some("Results".into());
            pool.push(res);
            for i in 0..filler_count {
                pool.push(hit(&format!("f{i}"), &format!("filler paragraph {i}")));
            }
            let (ordered, outcome) = apply_rerank_with_scope(
                pool,
                "What accuracy was reported?",
                &s,
                Some(&CloseLogits),
                None,
                None,
                0,
            );
            assert_eq!(outcome.used, RERANK_CROSS_ENCODER);
            assert_eq!(ordered[0].snippet, "Results show 91.2%");
            assert_eq!(ordered[1].snippet, "Abstract overview");
        }
    }

    #[test]
    fn negative_cross_encoder_logits_never_allow_unscored_tail_to_leapfrog_scored_head() {
        struct AllNegativeLogits;
        impl RerankProvider for AllNegativeLogits {
            fn score(&self, _query: &str, documents: &[&str]) -> RerankResult<Vec<RerankScore>> {
                Ok(documents
                    .iter()
                    .enumerate()
                    .map(|(index, doc)| RerankScore {
                        index,
                        score: if doc.contains("Abstract") {
                            -1.0
                        } else if doc.contains("Results") {
                            -1.1
                        } else {
                            -4.0 - index as f32
                        },
                    })
                    .collect())
            }
        }
        let mut s = settings(RerankMode::CrossEncoder, false);
        s.structural_soft_demotion = true;
        s.max_candidates = 3;

        let mut abs = hit("h0", "Abstract overview");
        abs.source.section_role = Some(neuink_domain::CanonicalSectionRole::Abstract);
        abs.score = 0.032;
        let mut res = hit("h1", "Results show 91.2%");
        res.source.section_path = Some("Results".into());
        res.score = 0.031;
        let mut other = hit("h2", "Methods detail");
        other.score = 0.030;
        let mut tail1 = hit("t0", "Unscored tail 0");
        tail1.score = 0.029;
        let mut tail2 = hit("t1", "Unscored tail 1");
        tail2.score = 0.028;

        let (ordered, outcome) = apply_rerank_with_scope(
            vec![abs, res, other, tail1, tail2],
            "What accuracy was reported?",
            &s,
            Some(&AllNegativeLogits),
            None,
            None,
            0,
        );
        assert_eq!(outcome.used, RERANK_CROSS_ENCODER);
        assert_eq!(ordered[0].snippet, "Results show 91.2%");
        assert_eq!(ordered[1].snippet, "Abstract overview");
        assert_eq!(ordered[2].snippet, "Methods detail");
        assert_eq!(ordered[3].snippet, "Unscored tail 0");
        assert_eq!(ordered[4].snippet, "Unscored tail 1");
        assert!(ordered.windows(2).all(|w| w[0].score > w[1].score));
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

        let default_ce = RerankSettings {
            mode: RerankMode::CrossEncoder,
            ..RerankSettings::default()
        };
        let (_, default_outcome) = apply_rerank(hits(), "what accuracy", &default_ce, Some(&provider));
        assert_eq!(default_outcome.used, RERANK_POOL_RRF);
        assert_eq!(default_outcome.reason, None);
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

    #[cfg(not(feature = "local-embedding"))]
    #[test]
    fn local_reranker_disabled_build_uses_the_configured_fallback() {
        let settings = settings(RerankMode::CrossEncoder, true);
        let provider = provider_for(&settings, Path::new("unused"));
        assert!(provider.is_none());
        let (_, outcome) = apply_rerank(hits(), "accuracy", &settings, provider.as_deref());
        assert_eq!(outcome.used, RERANK_HEURISTIC);
        assert_eq!(outcome.reason, Some(REASON_MODEL_UNAVAILABLE));
    }

    /// Real ONNX proof for the `cross_encoder` rung.
    ///
    /// The rest of this module uses a fake provider, so those tests prove the ladder but
    /// not that a local `.onnx` model loads and reorders. Set `NEUINK_RERANK_ONNX_DIR` to
    /// a directory laid out as `onnx/model_int8.onnx` plus the four tokenizer files.
    #[cfg(feature = "local-embedding")]
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


/// Builds the model-backed rerank provider for the configured transport.
///
/// Local runs load ONNX through a directory cache; the hosted path constructs a request
/// adapter. Both return `None` when they cannot be built, so the ladder keeps its
/// documented fallback instead of failing the search.
pub fn provider_for(
    settings: &RerankSettings,
    local_dir: &Path,
) -> Option<Arc<dyn neuink_search::RerankProvider>> {
    match settings.transport {
        neuink_config::RerankTransport::Local => reranker_for(local_dir),
        neuink_config::RerankTransport::Api => {
            let endpoint = settings.api_endpoint.clone()?;
            let model = settings.api_model.clone()?;
            let key = settings
                .api_key
                .clone()
                .filter(|key| !key.trim().is_empty())?;
            cached_http_reranker(
                endpoint,
                key,
                model,
                settings.api_style,
                settings.api_instruction.clone(),
            )
        }
    }
}

fn cached_http_reranker(
    endpoint: String,
    api_key: String,
    model: String,
    style: neuink_config::RemoteApiStyle,
    instruction: Option<String>,
) -> Option<Arc<dyn neuink_search::RerankProvider>> {
    #[derive(PartialEq, Eq)]
    struct Key {
        endpoint: String,
        api_key: String,
        model: String,
        style: neuink_config::RemoteApiStyle,
        instruction: Option<String>,
    }
    static CACHE: OnceLock<Mutex<Option<(Key, Arc<dyn neuink_search::RerankProvider>)>>> =
        OnceLock::new();
    let fresh = || {
        neuink_search::HttpReranker::new(endpoint.clone(), api_key.clone(), model.clone(), style)
            .ok()
            .map(|reranker| reranker.with_instruction(instruction.clone()))
            .map(|reranker| Arc::new(reranker) as Arc<dyn neuink_search::RerankProvider>)
    };
    let key = Key {
        endpoint: endpoint.clone(),
        api_key: api_key.clone(),
        model: model.clone(),
        style,
        instruction: instruction.clone(),
    };
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let Ok(mut guard) = cache.lock() else {
        return fresh();
    };
    if let Some((cached, provider)) = guard.as_ref() {
        if *cached == key {
            return Some(provider.clone());
        }
    }
    let provider = fresh()?;
    *guard = Some((key, provider.clone()));
    Some(provider)
}
/// Builds the v6 judge from explicit overrides, then from an OpenAI-compatible assistant.
///
/// Anthropic and Google profiles are not adapted. A blank required field returns `None`,
/// and the ladder keeps the cross-encoder order.
pub fn scope_judge_for(
    settings: &RerankSettings,
    assistant: Option<&LlmProfile>,
) -> Option<HttpScopeJudge> {
    if !settings.scope_refine.enabled {
        return None;
    }
    let scope = &settings.scope_refine;
    let mut endpoint = scope.api_endpoint.clone().unwrap_or_default();
    let mut model = scope.api_model.clone().unwrap_or_default();
    let mut key = scope.api_key.clone().unwrap_or_default();
    if scope.use_assistant_llm {
        if let Some(profile) = assistant.filter(|profile| profile.api_protocol == LlmApiProtocol::OpenaiCompatible)
        {
            if endpoint.trim().is_empty() {
                endpoint = profile.base_url.clone();
            }
            if model.trim().is_empty() {
                model = profile.model.clone();
            }
            if key.trim().is_empty() {
                key = profile.api_key.clone().unwrap_or_default();
            }
        }
    }
    cached_scope_judge(endpoint, model, key, scope.timeout_ms, scope.max_concurrency)
}

/// Builds the single-call listwise client (with TLS pool reuse). Scope refine wins the mutex.
pub fn listwise_reranker_for(
    settings: &RerankSettings,
    assistant: Option<&LlmProfile>,
) -> Option<Arc<HttpListwiseReranker>> {
    if !settings.listwise.enabled || settings.scope_refine.enabled {
        return None;
    }
    let listwise = &settings.listwise;
    let mut endpoint = listwise.api_endpoint.clone().unwrap_or_default();
    let mut model = listwise.api_model.clone().unwrap_or_default();
    let mut key = listwise.api_key.clone().unwrap_or_default();
    if listwise.use_assistant_llm {
        if let Some(profile) = assistant.filter(|profile| profile.api_protocol == neuink_config::LlmApiProtocol::OpenaiCompatible)
        {
            if endpoint.trim().is_empty() {
                endpoint = profile.base_url.clone();
            }
            if model.trim().is_empty() {
                model = profile.model.clone();
            }
            if key.trim().is_empty() {
                key = profile.api_key.clone().unwrap_or_default();
            }
        }
    }
    cached_listwise_reranker(endpoint, model, key, listwise.timeout_ms)
}

fn cached_listwise_reranker(
    endpoint: String,
    model: String,
    api_key: String,
    timeout_ms: u64,
) -> Option<Arc<HttpListwiseReranker>> {
    #[derive(PartialEq, Eq)]
    struct Key {
        endpoint: String,
        model: String,
        api_key: String,
        timeout_ms: u64,
    }
    static CACHE: OnceLock<Mutex<Option<(Key, Arc<HttpListwiseReranker>)>>> = OnceLock::new();
    let fresh = || {
        HttpListwiseReranker::new(endpoint.clone(), model.clone(), api_key.clone(), timeout_ms)
            .ok()
            .map(Arc::new)
    };
    let key = Key {
        endpoint: endpoint.clone(),
        model: model.clone(),
        api_key: api_key.clone(),
        timeout_ms,
    };
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let Ok(mut guard) = cache.lock() else {
        return fresh();
    };
    if let Some((cached, client)) = guard.as_ref() {
        if *cached == key {
            return Some(client.clone());
        }
    }
    let client = fresh()?;
    *guard = Some((key, client.clone()));
    Some(client)
}

fn cached_scope_judge(
    endpoint: String,
    model: String,
    api_key: String,
    timeout_ms: u64,
    max_concurrency: usize,
) -> Option<HttpScopeJudge> {
    struct Key {
        endpoint: String,
        model: String,
        api_key: String,
        timeout_ms: u64,
        max_concurrency: usize,
    }
    static CACHE: OnceLock<Mutex<Option<(Key, HttpScopeJudge)>>> = OnceLock::new();
    let fresh = |endpoint: &str, model: &str, api_key: &str| {
        HttpScopeJudge::new(
            endpoint.to_string(),
            model.to_string(),
            api_key.to_string(),
            timeout_ms,
            max_concurrency,
        )
        .ok()
    };
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let Ok(mut guard) = cache.lock() else {
        return fresh(&endpoint, &model, &api_key);
    };
    if let Some((cached, judge)) = guard.as_ref() {
        if cached.endpoint == endpoint
            && cached.model == model
            && cached.api_key == api_key
            && cached.timeout_ms == timeout_ms
            && cached.max_concurrency == max_concurrency
        {
            return Some(judge.clone());
        }
    }
    let judge = fresh(&endpoint, &model, &api_key)?;
    *guard = Some((
        Key {
            endpoint,
            model,
            api_key,
            timeout_ms,
            max_concurrency,
        },
        judge.clone(),
    ));
    Some(judge)
}

/// Reason to report when the provider could not be built.
pub(super) fn unavailable_reason(settings: &RerankSettings) -> &'static str {
    match settings.transport {
        neuink_config::RerankTransport::Local => REASON_MODEL_UNAVAILABLE,
        neuink_config::RerankTransport::Api => REASON_API_UNCONFIGURED,
    }
}

#[cfg(test)]
mod api_transport_tests {
    use super::*;
    use neuink_config::{RerankMode, RerankSettings, RerankTransport};

    fn settings(key: Option<&str>) -> RerankSettings {
        RerankSettings {
            mode: RerankMode::CrossEncoder,
            transport: RerankTransport::Api,
            api_endpoint: Some("https://api.jina.ai/v1/rerank".to_string()),
            api_key: key.map(str::to_string),
            api_model: Some("jina-reranker-v2-base-multilingual".to_string()),
            ..RerankSettings::default()
        }
    }

    #[test]
    fn without_a_key_the_ladder_reports_api_unconfigured() {
        let configured = settings(None);
        assert!(provider_for(&configured, Path::new("unused")).is_none());
        assert_eq!(unavailable_reason(&configured), REASON_API_UNCONFIGURED);
    }

    #[test]
    fn with_endpoint_key_and_model_the_api_provider_is_built() {
        let configured = settings(Some("token"));
        assert!(provider_for(&configured, Path::new("unused")).is_some());
    }
}

#[cfg(test)]
mod scope_refine_tests {
    use super::*;
    use neuink_config::{LlmApiProtocol, LlmProfile, RerankMode, ScopeRefineSettings};
    use neuink_domain::{EntryId, SegmentUid};
    use neuink_search::{
        PassageJudgment, ScopeJudgeError, ScopeJudgeProvider, ScopeJudgeRequest, SearchDocumentSource,
        SearchTarget,
    };

    struct KeepOrder;

    impl neuink_search::RerankProvider for KeepOrder {
        fn score(
            &self,
            _query: &str,
            documents: &[&str],
        ) -> neuink_search::RerankResult<Vec<neuink_search::RerankScore>> {
            Ok(documents
                .iter()
                .enumerate()
                .map(|(index, _document)| neuink_search::RerankScore {
                    index,
                    score: (documents.len() - index) as f32,
                })
                .collect())
        }
    }

    struct BrokenJudge;

    impl ScopeJudgeProvider for BrokenJudge {
        fn judge_batch(
            &self,
            _requests: &[ScopeJudgeRequest],
        ) -> Result<Vec<PassageJudgment>, ScopeJudgeError> {
            Err(ScopeJudgeError)
        }
    }

    fn hit(uid: &str, chapter: &str, snippet: &str) -> SearchHit {
        SearchHit {
            entry_id: EntryId::from_string("entry"),
            entry_title: "Paper".into(),
            source: SearchDocumentSource {
                section_path: Some(chapter.into()),
                ..SearchDocumentSource::default()
            },
            target: SearchTarget::Segment {
                entry_id: EntryId::from_string("entry"),
                segment_uid: SegmentUid::from_string(uid),
                page_idx: 0,
            },
            title: "Paper".into(),
            snippet: snippet.into(),
            score: 0.9,
            matched_terms: Vec::new(),
            surrounding_context: None,
        }
    }

    fn uid(hit: &SearchHit) -> String {
        match &hit.target {
            SearchTarget::Segment { segment_uid, .. } => segment_uid.to_string(),
            _ => String::new(),
        }
    }

    fn cross_settings(scope: bool) -> RerankSettings {
        let mut settings = RerankSettings {
            mode: RerankMode::CrossEncoder,
            fuse_with_pool: false,
            ..RerankSettings::default()
        };
        settings.scope_refine = ScopeRefineSettings {
            enabled: scope,
            ..ScopeRefineSettings::default()
        };
        settings
    }

    fn profile(protocol: LlmApiProtocol) -> LlmProfile {
        LlmProfile {
            id: "assistant".into(),
            name: "Assistant".into(),
            base_url: "https://api.siliconflow.cn/v1".into(),
            model: "deepseek-ai/DeepSeek-V4.1-Flash".into(),
            api_key: Some("stored-key".into()),
            max_context_length: None,
            temperature: None,
            top_p: None,
            max_output_tokens: None,
            api_protocol: protocol,
        }
    }

    #[test]
    fn recall_window_widens_for_the_encoder_and_the_tail() {
        let mut off = RerankSettings::default();
        off.mode = RerankMode::Off;
        assert_eq!(recall_window(10, &off), 10);
        let mut encoder = cross_settings(false);
        encoder.max_candidates = 20;
        assert_eq!(recall_window(10, &encoder), 20);
        let mut scoped = cross_settings(true);
        scoped.max_candidates = 8;
        assert_eq!(recall_window(10, &scoped), 20);
        assert_eq!(
            resolved_rerank_dir(&scoped, Path::new("bundled")),
            PathBuf::from("bundled")
        );
        scoped.model_dir = Some(r"D:\models\custom".into());
        assert_eq!(
            resolved_rerank_dir(&scoped, Path::new("bundled")),
            PathBuf::from(r"D:\models\custom")
        );
        assert_eq!(
            local_model_dir(&scoped, None).as_deref(),
            Some(Path::new(r"D:\models\custom"))
        );
        scoped.model_dir = None;
        assert!(local_model_dir(&scoped, None).is_none());
        assert_eq!(
            local_model_dir(&scoped, Some(Path::new("bundled"))).as_deref(),
            Some(Path::new("bundled"))
        );
    }

    #[test]
    fn scope_refine_scores_at_least_twenty_when_the_cap_is_smaller() {
        let hits = (0..25)
            .map(|index| hit(&format!("u{index}"), "Experiments", "plain"))
            .collect::<Vec<_>>();
        let seen = std::sync::atomic::AtomicUsize::new(0);
        struct CountHead<'a>(&'a std::sync::atomic::AtomicUsize);
        impl neuink_search::RerankProvider for CountHead<'_> {
            fn score(
                &self,
                _query: &str,
                documents: &[&str],
            ) -> neuink_search::RerankResult<Vec<neuink_search::RerankScore>> {
                self.0.store(documents.len(), std::sync::atomic::Ordering::SeqCst);
                Ok(documents
                    .iter()
                    .enumerate()
                    .map(|(index, _document)| neuink_search::RerankScore {
                        index,
                        score: (documents.len() - index) as f32,
                    })
                    .collect())
            }
        }
        let mut scoped = cross_settings(true);
        scoped.max_candidates = 8;
        let _ = apply_rerank_with_scope(hits.clone(), "question", &scoped, Some(&CountHead(&seen)), None, None, 10);
        assert_eq!(seen.load(std::sync::atomic::Ordering::SeqCst), 20);
        let mut plain = cross_settings(false);
        plain.max_candidates = 8;
        let _ = apply_rerank_with_scope(hits, "question", &plain, Some(&CountHead(&seen)), None, None, 10);
        assert_eq!(seen.load(std::sync::atomic::Ordering::SeqCst), 8);
    }

    #[test]
    fn the_scope_judge_uses_an_openai_assistant_and_refuses_other_protocols() {
        let mut settings = cross_settings(true);
        assert!(scope_judge_for(&settings, None).is_none());
        assert!(scope_judge_for(&settings, Some(&profile(LlmApiProtocol::Anthropic))).is_none());
        assert!(scope_judge_for(&settings, Some(&profile(LlmApiProtocol::Google))).is_none());
        assert!(scope_judge_for(&settings, Some(&profile(LlmApiProtocol::OpenaiCompatible))).is_some());
        settings.scope_refine.api_endpoint = Some("https://override.example/v1".into());
        settings.scope_refine.api_model = Some("override-model".into());
        settings.scope_refine.api_key = Some("override-key".into());
        settings.scope_refine.use_assistant_llm = false;
        assert!(scope_judge_for(&settings, None).is_some());
    }

    #[test]
    fn a_requested_top_k_cuts_after_the_encoder_and_keeps_that_order() {
        let hits = (0..12)
            .map(|index| hit(&format!("u{index}"), "Experiments", "plain"))
            .collect::<Vec<_>>();
        let (ordered, outcome) = apply_rerank_with_scope(
            hits,
            "question",
            &cross_settings(false),
            Some(&KeepOrder),
            None,
            None,
            10,
        );
        assert_eq!(outcome.used, RERANK_CROSS_ENCODER);
        assert_eq!(outcome.reason, None);
        assert_eq!(ordered.len(), 10);
        assert_eq!(uid(&ordered[0]), "u0");
        assert!(ordered[0].score > ordered[1].score);
    }

    #[test]
    fn a_missing_or_failed_scope_judge_keeps_the_encoder_order() {
        let mut hits = (0..12)
            .map(|index| hit(&format!("u{index}"), "Experiments", "plain"))
            .collect::<Vec<_>>();
        hits[8] = hit(
            "p9",
            "Related Work",
            "The cited BuoyFormer model reaches 71.4 F1. That figure is from earlier work.",
        );
        hits[10] = hit("c11", "Results", "HarborNet reaches 84.6 F1 on the held-out week.");
        let (missing, outcome) = apply_rerank_with_scope(
            hits.clone(),
            "What F1 does HarborNet reach?",
            &cross_settings(true),
            Some(&KeepOrder),
            None,
            None,
            10,
        );
        assert_eq!(outcome.used, RERANK_CROSS_ENCODER);
        assert_eq!(outcome.reason, Some(REASON_SCOPE_REFINE_UNCONFIGURED));
        assert_eq!(uid(&missing[8]), "p9");
        assert_eq!(missing.len(), 10);
        let (failed, outcome) = apply_rerank_with_scope(
            hits,
            "What F1 does HarborNet reach?",
            &cross_settings(true),
            Some(&KeepOrder),
            Some(&BrokenJudge),
            None,
            10,
        );
        assert_eq!(outcome.reason, Some(REASON_SCOPE_REFINE_ERROR));
        assert_eq!(uid(&failed[8]), "p9");
        assert!(outcome.swaps.is_empty());
    }

    #[test]
    fn cjk_query_uses_english_query_for_english_hits_while_keeping_cjk_summary_intent() {
        struct CaptureQuery(Mutex<String>);
        impl neuink_search::RerankProvider for CaptureQuery {
            fn score(
                &self,
                query: &str,
                documents: &[&str],
            ) -> neuink_search::RerankResult<Vec<neuink_search::RerankScore>> {
                *self.0.lock().unwrap() = query.to_string();
                Ok(documents
                    .iter()
                    .enumerate()
                    .map(|(index, _)| neuink_search::RerankScore {
                        index,
                        score: if index == 0 { 0.90 } else { 0.85 },
                    })
                    .collect())
            }
        }
        let hits = vec![
            hit("abs", "Abstract", "This paper introduces HarborNet for forecasting."),
            hit("exp", "Experiments", "HarborNet achieves 84.6 F1 on the benchmark."),
        ];
        let mut settings = cross_settings(false);
        settings.structural_soft_demotion = true;
        let provider = CaptureQuery(Mutex::new(String::new()));
        let (ordered, outcome) = apply_rerank_with_scope_and_english(
            hits,
            "整篇论文干什么了",
            Some("What is HarborNet?"),
            &settings,
            Some(&provider),
            None,
            None,
            10,
        );
        assert_eq!(outcome.used, RERANK_CROSS_ENCODER);
        assert_eq!(*provider.0.lock().unwrap(), "What is HarborNet?");
        // Because the original Chinese query asks "整篇论文干什么了", Abstract stays #1
        // even though the English translation did not include the word "summary".
        assert_eq!(uid(&ordered[0]), "abs");
    }

    #[test]
    fn fuse_with_pool_applies_structural_soft_demotion_on_raw_ce_scores_before_pool_rrf() {
        struct CloseMarginEncoder;
        impl neuink_search::RerankProvider for CloseMarginEncoder {
            fn score(
                &self,
                _query: &str,
                documents: &[&str],
            ) -> neuink_search::RerankResult<Vec<neuink_search::RerankScore>> {
                Ok(documents
                    .iter()
                    .enumerate()
                    .map(|(index, doc)| neuink_search::RerankScore {
                        index,
                        score: if doc.contains("Abstract") {
                            0.90
                        } else if doc.contains("Table 2") {
                            0.85
                        } else {
                            0.10
                        },
                    })
                    .collect())
            }
        }
        let hits = vec![
            hit("abs", "Abstract", "High-level overview of the paper."),
            hit("exp", "Experiments", "Table 2 reports 91.4 F1."),
            hit("other", "Related Work", "Prior work overview."),
        ];
        let mut settings = cross_settings(false);
        settings.structural_soft_demotion = true;
        settings.fuse_with_pool = true;
        let (ordered, outcome) = apply_rerank_with_scope(
            hits,
            "What F1 does Table 2 report?",
            &settings,
            Some(&CloseMarginEncoder),
            None,
            None,
            10,
        );
        assert_eq!(outcome.used, RERANK_POOL_RRF);
        // Raw CE: Abstract 0.90*0.80=0.72 < Table 2 0.85 -> Table 2 wins CE head before RRF;
        // stage1 had Abstract #1 / Table 2 #2, CE has Table 2 #1 / Abstract #2 -> equal RRF,
        // and ties follow primary/secondary cleanly without N-dependent rank collapse.
        assert_eq!(ordered.len(), 3);
    }

    #[test]
    fn pool_rrf_keeps_ce_confidence_computed_from_raw_logits() {
        struct LogitEncoder;
        impl neuink_search::RerankProvider for LogitEncoder {
            fn score(
                &self,
                _query: &str,
                documents: &[&str],
            ) -> neuink_search::RerankResult<Vec<neuink_search::RerankScore>> {
                Ok(documents
                    .iter()
                    .enumerate()
                    .map(|(index, _)| neuink_search::RerankScore {
                        index,
                        score: match index {
                            0 => 2.2,
                            1 => 0.4,
                            _ => -1.0,
                        },
                    })
                    .collect())
            }
        }
        let hits = vec![
            hit("a", "Experiments", "Table 2 reports 91.4 F1."),
            hit("b", "Experiments", "Another measured result is 88.0."),
            hit("c", "Experiments", "A third measured result is 70.1."),
        ];
        let mut settings = cross_settings(false);
        settings.structural_soft_demotion = true;
        settings.fuse_with_pool = true;
        let (_, outcome) = apply_rerank_with_scope(
            hits,
            "What F1 does Table 2 report?",
            &settings,
            Some(&LogitEncoder),
            None,
            None,
            10,
        );
        assert_eq!(outcome.used, RERANK_POOL_RRF);
        let expected = neuink_search::CeConfidence::from_raw_scores(&[2.2, 0.4, -1.0]).unwrap();
        assert_eq!(outcome.ce_confidence, Some(expected));
        let top_two = neuink_search::CeConfidence::from_raw_scores(&[2.2, 0.4]).unwrap();
        assert!((expected.top1_gap_z - top_two.top1_gap_z).abs() > 1e-3);
        assert_eq!(
            outcome.ce_confidence.unwrap().top1_gap_z,
            expected.top1_gap_z
        );
        let stamped = neuink_search::CeConfidence::from_raw_scores(&[1.0, 2.0 / 3.0, 1.0 / 3.0]);
        assert_ne!(outcome.ce_confidence, stamped);
    }
}

