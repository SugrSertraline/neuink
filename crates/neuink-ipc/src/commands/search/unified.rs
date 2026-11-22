//! Host-facing unified retrieval.
//!
//! One call runs the composed pipeline from `neuink_search::run_unified`:
//! document routing, named-carrier binding, the visual sidecar vote, and evidence
//! inside the routed documents. Every stage stays inside the caller's frozen
//! scope, and the visual channel reports `visual_disabled` until an index exists.
//!
//! The evidence channel is built from the same prepared keyword and semantic
//! indexes as the batch path, so ordering, fallback and warnings keep their
//! existing meaning.

use std::path::PathBuf;
use std::sync::Arc;

use neuink_domain::EntryId;
use neuink_search::{
    embed_query_vector, finalize_candidates, recall_candidates, run_unified, Degradation,
    HybridPolicy, SearchError, SearchMode, SearchQuery, SearchResults, SearchScope, UnifiedLimits,
    UnifiedPlan, UnifiedRequest,
};
use serde::{Deserialize, Serialize};

use super::{keyword_fallback, parse_segment_types, prepare_search, PreparedSearch};

#[derive(Debug, Deserialize)]
pub struct UnifiedSearchRequest {
    pub root: PathBuf,
    pub question: String,
    #[serde(default)]
    pub english_query: Option<String>,
    #[serde(default)]
    pub sub_questions: Vec<String>,
    /// Entries the question may report. Empty means the whole library.
    #[serde(default)]
    pub scope_entry_ids: Vec<EntryId>,
    /// Papers the user named; kept ahead of the document cap.
    #[serde(default)]
    pub mandated_entry_ids: Vec<EntryId>,
    #[serde(default)]
    pub section_filter: Option<String>,
    #[serde(default)]
    pub segment_types: Vec<String>,
    #[serde(default)]
    pub mode: SearchMode,
    #[serde(default)]
    pub top_k: Option<usize>,
    #[serde(default)]
    pub head_units: Option<usize>,
    #[serde(default)]
    pub max_documents: Option<usize>,
    #[serde(default)]
    pub bind_carriers: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct UnifiedSearchResponse {
    pub question: String,
    pub routed_documents: Vec<String>,
    pub routing_skip: Option<&'static str>,
    pub truncated: bool,
    pub text_entries: usize,
    pub visual_entries: usize,
    /// Fixed channel state: `ready`, `disabled`, `model_unavailable`, `index_missing`.
    pub visual_status: &'static str,
    /// Present only under gated append: whether the gate admitted visual entries.
    pub visual_gate_open: Option<bool>,
    pub carriers: Vec<CarrierOutput>,
    pub tasks: Vec<UnifiedTaskOutput>,
    pub degradations: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
pub struct CarrierOutput {
    pub kind: &'static str,
    pub label: String,
}

#[derive(Debug, Serialize)]
pub struct UnifiedTaskOutput {
    pub question: String,
    pub carrier_applied: bool,
    #[serde(default)]
    pub visual_evidence_applied: bool,
    pub mode: String,
    pub total_hit_count: usize,
    /// Which rerank rung ran: `off`, `heuristic`, `cross_encoder`, `cross_encoder+scope_v6`, `fused`.
    pub rerank_used: &'static str,
    /// Why a rung was skipped: `model_unavailable`, `provider_error`, `scope_refine_unconfigured`, `scope_refine_error`.
    pub rerank_reason: Option<&'static str>,
    /// Tail swaps applied after the cross-encoder. Empty when the encoder order stands.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub scope_swaps: Vec<neuink_search::ScopeSwapSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pool_used: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pool_reason: Option<&'static str>,
    pub results: SearchResults,
}

#[allow(clippy::too_many_arguments)]
pub fn run_unified_search(
    provider: Arc<dyn neuink_search::EmbeddingProvider>,
    visual_provider: Arc<dyn neuink_search::VisualEmbeddingProvider>,
    fusion: neuink_config::VisualFusionSettings,
    rerank: neuink_config::RerankSettings,
    rerank_provider: Option<Arc<dyn neuink_search::RerankProvider>>,
    scope_judge: Option<Arc<dyn neuink_search::ScopeJudgeProvider>>,
    listwise: Option<Arc<dyn neuink_search::ListwiseRerankProvider>>,
    multivector: neuink_config::MultivectorPoolSettings,
    request: UnifiedSearchRequest,
) -> Result<UnifiedSearchResponse, String> {
    let question = request.question.trim().to_string();
    if question.is_empty() {
        return Err("query is required".into());
    }
    let requested_top_k = request.top_k.unwrap_or(20).clamp(1, 20);
    let pool_provider = provider.clone();
    let prepared = prepare_search(
        provider,
        &request.root,
        true,
        request.mode != SearchMode::Keyword,
    )?;
    let english_query_for_visual = request.english_query.clone();
    let section_filter_for_visual = request.section_filter.clone();
    let segment_types_for_visual = parse_segment_types(&request.segment_types);
    let template = SearchQuery {
        text: question.clone(),
        mode: request.mode,
        scope: SearchScope {
            entry_ids: request.scope_entry_ids.clone(),
        },
        include: prepared.include.clone(),
        section_filter: request.section_filter.clone(),
        segment_types: segment_types_for_visual.clone(),
        segments_only: true,
        filter_stopwords: false,
        limit: request.top_k.unwrap_or(20).clamp(1, 20),
    };
    // An empty request scope means the whole prepared corpus, not an empty boundary:
    // otherwise the visual channel would refuse to vote for every "search my library"
    // call, and the guard against unfrozen votes would look like a broken channel.
    let allowed_entries = if request.scope_entry_ids.is_empty() {
        prepared.entries.clone()
    } else {
        request
            .scope_entry_ids
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
    };
    let mandated_entries = request
        .mandated_entry_ids
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let plan = UnifiedPlan {
        limits: UnifiedLimits {
            head_units: request.head_units.unwrap_or(20).max(1),
            max_documents: request.max_documents.unwrap_or(20).max(1),
            route_window: neuink_search::candidate_window(requested_top_k),
            evidence_window: neuink_search::candidate_window(requested_top_k).max(
                super::rerank_stage::effective_recall_window(
                    requested_top_k,
                    &rerank,
                    &multivector,
                ),
            ),
            evidence_limit: request.top_k.unwrap_or(20).clamp(1, 20),
        },
        bind_carriers: request.bind_carriers.unwrap_or(true),
        text_weight: fusion.text_weight,
        visual_weight: fusion.visual_weight,
        rrf_k: fusion.rrf_k,
        visual_fusion: match fusion.mode {
            neuink_config::VisualFusionMode::Weighted => {
                neuink_search::VisualFusionPolicy::Weighted {
                    visual_weight: fusion.visual_weight,
                }
            }
            neuink_config::VisualFusionMode::AppendGated => {
                neuink_search::VisualFusionPolicy::AppendGated {
                    gate: neuink_search::AppendGate {
                        min_head_entries: fusion.gate.min_head_entries,
                        max_snippet_overlap: fusion.gate.max_snippet_overlap,
                    },
                }
            }
        },
        ..UnifiedPlan::default()
    };

    let mut text = evidence_channel(&prepared);
    // The visual channel inspects the snapshot and the model only; it never encodes an
    // asset here. A missing model or snapshot degrades to the text channel.
    let mut visual = super::visual::visual_channel(&request.root, visual_provider);
    let visual_status = visual.status_code();
    let output = run_unified(
        &mut text,
        &mut visual,
        &plan,
        &UnifiedRequest {
            question: question.clone(),
            english_question: request.english_query,
            sub_questions: request.sub_questions,
            mandated_entries,
            allowed_entries,
            in_scope_documents: prepared.document_count,
            template,
        },
    )
    .map_err(|error| error.to_string())?;

    let routed_documents = output.routing.documents;
    let visual_parents = output.routing.visual_parents;
    let binding_for_visual = output.binding.clone();
    let visual_options = neuink_search::WithinPaperVisualOptions {
        text_weight: fusion.text_weight,
        visual_weight: fusion.visual_weight,
        rrf_k: fusion.rrf_k,
        max_snippet_overlap: fusion.gate.max_snippet_overlap,
    };

    let rerank_active =
        rerank.mode == neuink_config::RerankMode::CrossEncoder || rerank.listwise.enabled;
    let rerank_window = if rerank_active {
        let mut head = 0usize;
        if rerank.mode == neuink_config::RerankMode::CrossEncoder {
            head = head.max(rerank.max_candidates.max(1));
            if rerank.scope_refine.enabled {
                head = head.max(20);
            }
        }
        if rerank.listwise.enabled {
            head = head.max(rerank.listwise.top_n.max(1));
        }
        head.min(neuink_search::RERANK_MAX_CANDIDATES_LIMIT)
    } else {
        0
    };

    Ok(UnifiedSearchResponse {
        question,
        routed_documents: routed_documents.clone(),
        routing_skip: output.routing.skipped.map(skip_code),
        truncated: output.routing.truncated,
        text_entries: output.routing.text_entries,
        visual_entries: output.routing.visual_entries,
        visual_status,
        visual_gate_open: output.routing.visual_gate_open,
        carriers: output
            .binding
            .carriers
            .into_iter()
            .map(|carrier| CarrierOutput {
                kind: carrier_kind_code(carrier.kind),
                label: carrier.label,
            })
            .collect(),
        tasks: output
            .tasks
            .into_iter()
            .map(|task| {
                let (visual_fused, visual_evidence_applied) =
                    neuink_search::apply_within_paper_visual_evidence(
                        task.results,
                        &visual_parents,
                        &prepared.visual_page_segments,
                        &routed_documents,
                        &task.question,
                        english_query_for_visual.as_deref(),
                        &binding_for_visual,
                        &segment_types_for_visual,
                        section_filter_for_visual.as_deref(),
                        visual_options,
                    );
                // Rerank-gated zero-extra-embedding chapter-subtree supplementation:
                // proven +1.55~1.60pp Recall@10 / +1.26pp nDCG@10 on DAPR 652-doc when
                // a reranker scores the pool; strict no-op when rerank is off.
                let chapter_enriched = if rerank_active && rerank_window >= 6 {
                    if let (Some(semantic), Ok(query_vec)) = (
                        prepared.semantic.as_deref(),
                        embed_query_vector(pool_provider.as_ref(), &task.question),
                    ) {
                        neuink_search::supplement_hits_from_chapters(
                            visual_fused,
                            semantic,
                            &query_vec,
                            &routed_documents,
                            &segment_types_for_visual,
                            section_filter_for_visual.as_deref(),
                            rerank_window,
                            3,
                            4,
                            10,
                        )
                    } else {
                        visual_fused
                    }
                } else {
                    visual_fused
                };
                let cache_root = request.root.join(".neuink").join("cache");
                let (pooled, pool) = super::multivector_stage::rescore_results_with_cache(
                    chapter_enriched,
                    &multivector,
                    pool_provider.as_ref(),
                    Some(&cache_root),
                );
                let mut reranked = rerank_task_results(
                    pooled,
                    &task.question,
                    &rerank,
                    rerank_provider.as_deref(),
                    scope_judge.as_deref(),
                    listwise.as_deref(),
                    requested_top_k,
                );
                neuink_search::attach_surrounding_context(
                    &mut reranked.0,
                    &prepared.surrounding_contexts,
                    neuink_search::DEFAULT_SURROUNDING_CONTEXT_TOP_N,
                );
                UnifiedTaskOutput {
                    question: task.question,
                    carrier_applied: task.carrier_applied,
                    visual_evidence_applied,
                    mode: reranked.0.mode.clone(),
                    total_hit_count: reranked.0.total_hit_count,
                    rerank_used: reranked.1.used,
                    rerank_reason: reranked.1.reason,
                    scope_swaps: reranked.1.swaps,
                    pool_used: pool.map(|mark| mark.used),
                    pool_reason: pool.and_then(|mark| mark.reason),
                    results: reranked.0,
                }
            })
            .collect(),
        degradations: output
            .degradations
            .into_iter()
            .map(Degradation::code)
            .collect(),
    })
}

/// Applies the rerank ladder to one task's hits and rebuilds the grouped results.
///
/// The ladder never fails a search: a missing or broken encoder falls back to field
/// coverage (or to the fused order), and the rung that ran is reported on the task.
pub(super) fn rerank_task_results(
    results: SearchResults,
    question: &str,
    settings: &neuink_config::RerankSettings,
    provider: Option<&dyn neuink_search::RerankProvider>,
    scope_judge: Option<&dyn neuink_search::ScopeJudgeProvider>,
    listwise: Option<&dyn neuink_search::ListwiseRerankProvider>,
    top_k: usize,
) -> (SearchResults, super::rerank_stage::RerankOutcome) {
    if settings.mode == neuink_config::RerankMode::Off
        && !settings.listwise.enabled
        && !settings.structural_soft_demotion
    {
        let trimmed = if top_k > 0 && results.total_hit_count > top_k {
            let query = results.query.clone();
            let mode = results.mode.clone();
            let generation = results.index_generation;
            let warnings = results.warnings.clone();
            let mut hits = neuink_search::ordered_hits(&results);
            hits.truncate(top_k);
            neuink_search::results_from_hits(query, mode, generation, hits, warnings)
        } else {
            results
        };
        return (
            trimmed,
            super::rerank_stage::RerankOutcome {
                used: super::rerank_stage::RERANK_OFF,
                reason: None,
                swaps: Vec::new(),
            },
        );
    }
    let query = results.query.clone();
    let mode = results.mode.clone();
    let generation = results.index_generation;
    let warnings = results.warnings.clone();
    let hits = neuink_search::ordered_hits(&results);
    let (ordered, outcome) = super::rerank_stage::apply_rerank_with_scope(
        hits,
        question,
        settings,
        provider,
        scope_judge,
        listwise,
        top_k,
    );
    (
        neuink_search::results_from_hits(query, mode, generation, ordered, warnings),
        outcome,
    )
}

/// The evidence channel over the prepared indexes: one query, both channels,
/// the existing final cut, and the existing keyword fallback. `run_unified`
/// supplies the window and the restriction, so only the query is read here.
fn evidence_channel(
    prepared: &PreparedSearch,
) -> impl FnMut(&SearchQuery, usize) -> Result<SearchResults, SearchError> + '_ {
    move |query: &SearchQuery, window: usize| {
        let mut query = query.clone();
        query.limit = window.max(1);
        let semantic = prepared
            .semantic
            .as_deref()
            .filter(|_| query.mode != SearchMode::Keyword);
        let vector = semantic.and_then(|_| embed_query_vector(prepared.provider.as_ref(), &query.text).ok());
        match recall_candidates(
            prepared.keyword.as_ref(),
            semantic,
            &query,
            vector.as_deref(),
            HybridPolicy::Legacy,
            window.max(1),
        ) {
            // Chapter rerank stays off (alpha 0) exactly as the production path,
            // so this call does not add a second ranking policy.
            Ok(results) => Ok(finalize_candidates(
                results,
                &query,
                vector.as_deref(),
                None,
                0.0,
                true,
            )),
            Err(error) => keyword_fallback(prepared.keyword.as_ref(), query, error)
                .map_err(SearchError::EmbeddingUnavailable),
        }
    }
}

fn skip_code(skip: neuink_search::HeadSkip) -> &'static str {
    match skip {
        neuink_search::HeadSkip::NoDocuments => "no_documents",
        neuink_search::HeadSkip::SingleDocument => "single_document",
        neuink_search::HeadSkip::EmptyRanking => "empty_ranking",
    }
}

fn carrier_kind_code(kind: neuink_search::CarrierKind) -> &'static str {
    match kind {
        neuink_search::CarrierKind::Section => "section",
        neuink_search::CarrierKind::Table => "table",
        neuink_search::CarrierKind::Figure => "figure",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use neuink_search::CarrierKind;

    #[test]
    fn skip_and_carrier_codes_are_stable() {
        assert_eq!(skip_code(neuink_search::HeadSkip::NoDocuments), "no_documents");
        assert_eq!(
            skip_code(neuink_search::HeadSkip::SingleDocument),
            "single_document"
        );
        assert_eq!(
            skip_code(neuink_search::HeadSkip::EmptyRanking),
            "empty_ranking"
        );
        assert_eq!(carrier_kind_code(CarrierKind::Table), "table");
        assert_eq!(carrier_kind_code(CarrierKind::Figure), "figure");
        assert_eq!(carrier_kind_code(CarrierKind::Section), "section");
    }
}


