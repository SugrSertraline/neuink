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

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use neuink_domain::EntryId;
use neuink_search::{
    finalize_candidates, recall_candidates, run_unified, Degradation, HybridPolicy, SearchError,
    SearchMode, SearchQuery, SearchResults, SearchScope, UnifiedLimits, UnifiedPlan,
    UnifiedRequest,
};
use serde::{Deserialize, Serialize};

use super::{keyword_fallback, parse_segment_types, prepare_search, PreparedSearch};

#[derive(Debug, Deserialize)]
pub struct UnifiedSearchRequest {
    pub root: PathBuf,
    pub question: String,
    /// Optional whole-question override used strictly for Stage-1 document routing
    /// when `question` is an evidence-layer sub-question.
    #[serde(default)]
    pub routing_question: Option<String>,
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

/// One sub-task inside `search_unified_batch`. Same fields as a single search, without `root`.
#[derive(Debug, Deserialize)]
pub struct UnifiedSearchBatchItem {
    pub question: String,
    #[serde(default)]
    pub routing_question: Option<String>,
    #[serde(default)]
    pub english_query: Option<String>,
    #[serde(default)]
    pub sub_questions: Vec<String>,
    #[serde(default)]
    pub scope_entry_ids: Vec<EntryId>,
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

impl UnifiedSearchBatchItem {
    fn into_request(self, root: PathBuf) -> UnifiedSearchRequest {
        UnifiedSearchRequest {
            root,
            question: self.question,
            routing_question: self.routing_question,
            english_query: self.english_query,
            sub_questions: self.sub_questions,
            scope_entry_ids: self.scope_entry_ids,
            mandated_entry_ids: self.mandated_entry_ids,
            section_filter: self.section_filter,
            segment_types: self.segment_types,
            mode: self.mode,
            top_k: self.top_k,
            head_units: self.head_units,
            max_documents: self.max_documents,
            bind_carriers: self.bind_carriers,
        }
    }
}

/// Several unified searches that share one prepared index and one visual channel.
#[derive(Debug, Deserialize)]
pub struct UnifiedSearchBatchRequest {
    pub root: PathBuf,
    pub tasks: Vec<UnifiedSearchBatchItem>,
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
    let pool_provider = provider.clone();
    let prepared = prepare_search(
        provider,
        &request.root,
        true,
        request.mode != SearchMode::Keyword,
    )?;
    let mut visual = super::visual::visual_channel(&request.root, visual_provider);
    run_unified_search_with_prepared(
        &prepared,
        &mut visual,
        pool_provider,
        fusion,
        rerank,
        rerank_provider,
        scope_judge,
        listwise,
        multivector,
        request,
    )
}

/// Runs every task on one prepared index and one visual channel.
///
/// Preparation (workspace open, record scan, cache fingerprint) and the visual
/// channel happen once. A failure inside one task still fails that task's result
/// the same way `search_unified` would.
#[allow(clippy::too_many_arguments)]
pub fn run_unified_search_batch(
    provider: Arc<dyn neuink_search::EmbeddingProvider>,
    visual_provider: Arc<dyn neuink_search::VisualEmbeddingProvider>,
    fusion: neuink_config::VisualFusionSettings,
    rerank: neuink_config::RerankSettings,
    rerank_provider: Option<Arc<dyn neuink_search::RerankProvider>>,
    scope_judge: Option<Arc<dyn neuink_search::ScopeJudgeProvider>>,
    listwise: Option<Arc<dyn neuink_search::ListwiseRerankProvider>>,
    multivector: neuink_config::MultivectorPoolSettings,
    request: UnifiedSearchBatchRequest,
) -> Result<Vec<UnifiedSearchResponse>, String> {
    if request.tasks.is_empty() {
        return Ok(Vec::new());
    }
    let needs_semantic = request
        .tasks
        .iter()
        .any(|task| task.mode != SearchMode::Keyword);
    let pool_provider = provider.clone();
    let prepared = prepare_search(provider, &request.root, true, needs_semantic)?;
    let mut visual = super::visual::visual_channel(&request.root, visual_provider);
    let root = request.root;
    let mut responses = Vec::with_capacity(request.tasks.len());
    for task in request.tasks {
        responses.push(run_unified_search_with_prepared(
            &prepared,
            &mut visual,
            pool_provider.clone(),
            fusion,
            rerank.clone(),
            rerank_provider.clone(),
            scope_judge.clone(),
            listwise.clone(),
            multivector.clone(),
            task.into_request(root.clone()),
        )?);
    }
    Ok(responses)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn run_unified_search_with_prepared(
    prepared: &PreparedSearch,
    visual: &mut super::visual::VisualChannel,
    pool_provider: Arc<dyn neuink_search::EmbeddingProvider>,
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

    let mut text = evidence_channel(prepared);
    // The caller opened the visual channel once. A missing model or snapshot already
    // degraded to the text channel; this call only reads that status and votes.
    let visual_status = visual.status_code();
    let mut evidence_sub_questions = Vec::new();
    if !request.sub_questions.is_empty() {
        evidence_sub_questions.push(question.clone());
        for sub in request.sub_questions {
            let trimmed = sub.trim();
            if !trimmed.is_empty()
                && !evidence_sub_questions
                    .iter()
                    .any(|existing: &String| existing == trimmed)
            {
                evidence_sub_questions.push(trimmed.to_string());
            }
        }
    }
    let output = run_unified(
        &mut text,
        visual,
        &plan,
        &UnifiedRequest {
            question: question.clone(),
            routing_question: request.routing_question,
            english_question: request.english_query,
            sub_questions: evidence_sub_questions,
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
        head_window: 10,
        ce_confidence: None,
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
                // Pre-CE supplements share one rerank window and one slot budget.
                // Visual runs first so its occupied suffix stays at `window - added .. window`.
                // Chapters then spend only the leftover budget and sit in front of that suffix.
                // A named carrier already narrowed this task, so chapters stay off.
                let before_window_ids = neuink_search::ordered_hits(&task.results)
                    .iter()
                    .take(rerank_window)
                    .map(neuink_search::hit_identity)
                    .collect::<HashSet<_>>();
                let run_visual =
                    rerank_active && rerank_window >= 10 && !visual_parents.is_empty();
                let run_chapters = rerank_active && rerank_window >= 6 && !task.carrier_applied;
                let (total_pre_ce_budget, visual_budget) =
                    pre_ce_supplement_budget(rerank_window, run_chapters);
                let original_hits = if run_visual {
                    neuink_search::ordered_hits(&task.results)
                } else {
                    Vec::new()
                };
                let visual_windowed = if run_visual {
                    neuink_search::supplement_hits_from_visual_pages(
                        task.results,
                        &visual_parents,
                        &prepared.visual_page_segments,
                        &routed_documents,
                        &segment_types_for_visual,
                        section_filter_for_visual.as_deref(),
                        rerank_window,
                        visual_budget,
                    )
                } else {
                    task.results
                };
                let visual_windowed = if run_chapters {
                    let visual_hits = neuink_search::ordered_hits(&visual_windowed);
                    let window = rerank_window.min(visual_hits.len());
                    let shared = if run_visual {
                        visual_prefix_len(&original_hits, &visual_hits, window)
                    } else {
                        window
                    };
                    let added = window.saturating_sub(shared);
                    let chapter_budget = total_pre_ce_budget.saturating_sub(added);
                    if added >= rerank_window || chapter_budget == 0 {
                        visual_windowed
                    } else {
                        let head = rerank_window - added;
                        let protected = visual_hits[shared..window].to_vec();
                        let mut rest =
                            Vec::with_capacity(visual_hits.len() - protected.len());
                        rest.extend_from_slice(&visual_hits[..shared]);
                        rest.extend_from_slice(&visual_hits[window..]);
                        let rest_results = neuink_search::results_from_hits(
                            visual_windowed.query.clone(),
                            visual_windowed.mode.clone(),
                            visual_windowed.index_generation,
                            rest,
                            visual_windowed.warnings.clone(),
                        );
                        let chaptered = {
                            let chapter_query = english_query_for_visual
                                .as_deref()
                                .map(str::trim)
                                .filter(|english| {
                                    !english.is_empty() && super::contains_cjk(&task.question)
                                })
                                .unwrap_or(&task.question);
                            if let (Some(semantic), Ok(query_vec)) = (
                                prepared.semantic.as_deref(),
                                prepared.embed_query(chapter_query),
                            ) {
                                neuink_search::supplement_hits_from_chapters(
                                    rest_results,
                                    semantic,
                                    &query_vec,
                                    &routed_documents,
                                    &segment_types_for_visual,
                                    section_filter_for_visual.as_deref(),
                                    head,
                                    3,
                                    3,
                                    chapter_budget,
                                )
                            } else {
                                rest_results
                            }
                        };
                        if protected.is_empty() {
                            chaptered
                        } else {
                            place_chapters_before_visual_slots(chaptered, protected, head)
                        }
                    }
                } else {
                    visual_windowed
                };
                let pre_ce_supplement_ids = neuink_search::ordered_hits(&visual_windowed)
                    .iter()
                    .take(rerank_window)
                    .map(neuink_search::hit_identity)
                    .filter(|identity| !before_window_ids.contains(identity))
                    .collect::<HashSet<_>>();
                let cache_root = neuink_workspace::WorkspaceLayout::new(request.root.clone())
                    .cache_dir()
                    .join("search");
                let (pooled, pool) = super::multivector_stage::rescore_results_with_cache(
                    visual_windowed,
                    &multivector,
                    pool_provider.as_ref(),
                    Some(&cache_root),
                );
                // When visual parents are present, keep a wider post-CE head before
                // doc-anchored visual rescue (`V3_anchored`) so narrow `top_k` values
                // do not starve Top-2 paper anchoring or RRF fusion, then trim to `top_k`.
                let pre_visual_cut = if !visual_parents.is_empty() && requested_top_k > 0 {
                    requested_top_k.max(15)
                } else {
                    requested_top_k
                };
                let reranked = rerank_task_results_with_supplements(
                    pooled,
                    &task.question,
                    english_query_for_visual.as_deref(),
                    &rerank,
                    rerank_provider.as_deref(),
                    scope_judge.as_deref(),
                    listwise.as_deref(),
                    pre_visual_cut,
                    &pre_ce_supplement_ids,
                );
                // Post-CE doc-anchored visual evidence rescue (V3_anchored, Track C SPIQA):
                // runs AFTER text Cross-Encoder so caption-sparse figures are not re-demoted
                // by text-only CE, and anchors strictly to the top-2 reranked papers to avoid
                // cross-paper figure interference (+7.00pp R@5 vs unanchored, +6.00pp R@1 single-paper).
                let mut task_visual_options = visual_options;
                task_visual_options.ce_confidence = reranked.1.ce_confidence;
                let (mut visual_fused, visual_evidence_applied) =
                    neuink_search::apply_within_paper_visual_evidence(
                        reranked.0,
                        &visual_parents,
                        &prepared.visual_page_segments,
                        &routed_documents,
                        &task.question,
                        english_query_for_visual.as_deref(),
                        &binding_for_visual,
                        &segment_types_for_visual,
                        section_filter_for_visual.as_deref(),
                        task_visual_options,
                    );
                if requested_top_k > 0 && visual_fused.total_hit_count > requested_top_k {
                    let query = visual_fused.query.clone();
                    let mode = visual_fused.mode.clone();
                    let generation = visual_fused.index_generation;
                    let warnings = visual_fused.warnings.clone();
                    let mut hits = neuink_search::ordered_hits(&visual_fused);
                    hits.truncate(requested_top_k);
                    visual_fused =
                        neuink_search::results_from_hits(query, mode, generation, hits, warnings);
                }
                visual_fused.rerank_used = Some(reranked.1.used.to_string());
                neuink_search::attach_surrounding_context(
                    &mut visual_fused,
                    &prepared.surrounding_contexts,
                    neuink_search::DEFAULT_SURROUNDING_CONTEXT_TOP_N,
                );
                UnifiedTaskOutput {
                    question: task.question,
                    carrier_applied: task.carrier_applied,
                    visual_evidence_applied,
                    mode: visual_fused.mode.clone(),
                    total_hit_count: visual_fused.total_hit_count,
                    rerank_used: reranked.1.used,
                    rerank_reason: reranked.1.reason,
                    scope_swaps: reranked.1.swaps,
                    pool_used: pool.map(|mark| mark.used),
                    pool_reason: pool.and_then(|mark| mark.reason),
                    results: visual_fused,
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

/// Joint pre-CE slot budget.
///
/// `total` is the most slots visual and chapter supplements may occupy together,
/// so a window of 25 keeps the Stage-1 native prefix through rank 19.
/// `visual` is the cap passed to the visual supplement: 3 when chapters also run,
/// otherwise 4. Chapter appends then receive `total - added`.
fn pre_ce_supplement_budget(rerank_window: usize, run_chapters: bool) -> (usize, usize) {
    let total = (rerank_window / 4).clamp(4, 6);
    let visual = if run_chapters {
        3.min(total)
    } else {
        4.min(total)
    };
    (total, visual)
}

/// How many leading hits visual supplement left untouched inside `window`.
fn visual_prefix_len(
    before: &[neuink_search::SearchHit],
    after: &[neuink_search::SearchHit],
    window: usize,
) -> usize {
    before
        .iter()
        .zip(after.iter())
        .take(window)
        .take_while(|(left, right)| {
            neuink_search::hit_identity(left) == neuink_search::hit_identity(right)
        })
        .count()
}

/// Puts chapter hits in `0..head` and the already-chosen visual slots immediately
/// after them, so neither splice pushes the other past the rerank window.
fn place_chapters_before_visual_slots(
    chaptered: neuink_search::SearchResults,
    protected: Vec<neuink_search::SearchHit>,
    head: usize,
) -> neuink_search::SearchResults {
    let protected_ids = protected
        .iter()
        .map(neuink_search::hit_identity)
        .collect::<HashSet<_>>();
    let mut chapter_hits = neuink_search::ordered_hits(&chaptered)
        .into_iter()
        .filter(|hit| !protected_ids.contains(&neuink_search::hit_identity(hit)))
        .collect::<Vec<_>>();
    let head_len = head.min(chapter_hits.len());
    let mut combined = Vec::with_capacity(chapter_hits.len() + protected.len());
    combined.extend(chapter_hits.drain(..head_len));
    combined.extend(protected);
    combined.extend(chapter_hits);
    neuink_search::stamp_rank_scores(&mut combined);
    neuink_search::results_from_hits(
        chaptered.query,
        chaptered.mode,
        chaptered.index_generation,
        combined,
        chaptered.warnings,
    )
}

/// Applies the rerank ladder to one task's hits and rebuilds the grouped results.
///
/// The ladder never fails a search: a missing or broken encoder falls back to field
/// coverage (or to the fused order), and the rung that ran is reported on the task.
#[cfg(test)]
pub(super) fn rerank_task_results(
    results: SearchResults,
    question: &str,
    settings: &neuink_config::RerankSettings,
    provider: Option<&dyn neuink_search::RerankProvider>,
    scope_judge: Option<&dyn neuink_search::ScopeJudgeProvider>,
    listwise: Option<&dyn neuink_search::ListwiseRerankProvider>,
    top_k: usize,
) -> (SearchResults, super::rerank_stage::RerankOutcome) {
    rerank_task_results_with_english(
        results,
        question,
        None,
        settings,
        provider,
        scope_judge,
        listwise,
        top_k,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn rerank_task_results_with_english(
    results: SearchResults,
    question: &str,
    english_query: Option<&str>,
    settings: &neuink_config::RerankSettings,
    provider: Option<&dyn neuink_search::RerankProvider>,
    scope_judge: Option<&dyn neuink_search::ScopeJudgeProvider>,
    listwise: Option<&dyn neuink_search::ListwiseRerankProvider>,
    top_k: usize,
) -> (SearchResults, super::rerank_stage::RerankOutcome) {
    rerank_task_results_with_supplements(
        results,
        question,
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
pub(super) fn rerank_task_results_with_supplements(
    results: SearchResults,
    question: &str,
    english_query: Option<&str>,
    settings: &neuink_config::RerankSettings,
    provider: Option<&dyn neuink_search::RerankProvider>,
    scope_judge: Option<&dyn neuink_search::ScopeJudgeProvider>,
    listwise: Option<&dyn neuink_search::ListwiseRerankProvider>,
    top_k: usize,
    pre_ce_supplement_ids: &HashSet<String>,
) -> (SearchResults, super::rerank_stage::RerankOutcome) {
    if settings.mode == neuink_config::RerankMode::Off
        && !settings.listwise.enabled
        && !settings.structural_soft_demotion
    {
        let mut trimmed = if top_k > 0 && results.total_hit_count > top_k {
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
        trimmed.rerank_used = Some(super::rerank_stage::RERANK_OFF.to_string());
        return (
            trimmed,
            super::rerank_stage::RerankOutcome {
                used: super::rerank_stage::RERANK_OFF,
                reason: None,
                swaps: Vec::new(),
                ce_confidence: None,
            },
        );
    }
    let query = results.query.clone();
    let mode = results.mode.clone();
    let generation = results.index_generation;
    let warnings = results.warnings.clone();
    let hits = neuink_search::ordered_hits(&results);
    let (ordered, outcome) = super::rerank_stage::apply_rerank_with_supplements(
        hits,
        question,
        english_query,
        settings,
        provider,
        scope_judge,
        listwise,
        top_k,
        pre_ce_supplement_ids,
    );
    let mut built = neuink_search::results_from_hits(query, mode, generation, ordered, warnings);
    built.rerank_used = Some(outcome.used.to_string());
    (built, outcome)
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
        let vector = semantic.and_then(|_| prepared.embed_query(&query.text).ok());
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

    struct IdleProvider;

    impl neuink_search::EmbeddingProvider for IdleProvider {
        fn status(&self) -> neuink_search::EmbeddingProviderStatus {
            neuink_search::EmbeddingProviderStatus {
                available: false,
                provider: "idle".to_string(),
                model_name: None,
                model_path: None,
                dimensions: None,
                message: None,
            }
        }

        fn embed(
            &self,
            _inputs: &[neuink_search::EmbeddingInput],
        ) -> neuink_search::SearchResult<Vec<neuink_search::EmbeddingVector>> {
            Ok(Vec::new())
        }
    }

    fn keyword_item(question: &str) -> UnifiedSearchBatchItem {
        UnifiedSearchBatchItem {
            question: question.to_string(),
            routing_question: None,
            english_query: None,
            sub_questions: Vec::new(),
            scope_entry_ids: Vec::new(),
            mandated_entry_ids: Vec::new(),
            section_filter: None,
            segment_types: Vec::new(),
            mode: SearchMode::Keyword,
            top_k: Some(5),
            head_units: None,
            max_documents: None,
            bind_carriers: Some(false),
        }
    }

    fn idle_batch(
        request: UnifiedSearchBatchRequest,
    ) -> Result<Vec<UnifiedSearchResponse>, String> {
        let mut rerank = neuink_config::RerankSettings::default();
        rerank.mode = neuink_config::RerankMode::Off;
        rerank.listwise.enabled = false;
        run_unified_search_batch(
            Arc::new(IdleProvider),
            Arc::new(neuink_search::NoVisualProvider::default()),
            neuink_config::VisualFusionSettings::default(),
            rerank,
            None,
            None,
            None,
            neuink_config::MultivectorPoolSettings::default(),
            request,
        )
    }

    #[test]
    fn an_empty_unified_batch_does_not_open_the_workspace() {
        let responses = idle_batch(UnifiedSearchBatchRequest {
            root: PathBuf::from("this-root-must-not-be-opened"),
            tasks: Vec::new(),
        })
        .expect("empty batch");
        assert!(responses.is_empty());
    }

    #[test]
    fn a_unified_batch_returns_one_response_per_task_from_one_workspace() {
        let root = std::env::temp_dir().join(format!(
            "neuink-unified-batch-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("root");
        let _workspace = neuink_workspace::Workspace::create(&root).expect("workspace");
        let responses = idle_batch(UnifiedSearchBatchRequest {
            root: root.clone(),
            tasks: vec![keyword_item("first question"), keyword_item("second question")],
        })
        .expect("batch");
        assert_eq!(responses.len(), 2);
        assert_eq!(responses[0].question, "first question");
        assert_eq!(responses[1].question, "second question");
        std::fs::remove_dir_all(&root).ok();
    }

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

    #[test]
    fn joint_pre_ce_budget_protects_the_stage1_prefix() {
        let (total, visual) = pre_ce_supplement_budget(25, true);
        assert_eq!((total, visual), (6, 3));
        assert_eq!(25 - total, 19);
        assert_eq!(total.saturating_sub(visual), 3);
        assert_eq!(total.saturating_sub(0), 6);
        assert_eq!(pre_ce_supplement_budget(25, false), (6, 4));
        assert_eq!(pre_ce_supplement_budget(20, true), (5, 3));
        assert_eq!(20 - 5, 15);
    }

    #[test]
    fn rerank_task_results_off_mode_returns_the_input() {
        let results = neuink_search::results_from_hits("q".into(), "hybrid".into(), 1, Vec::new(), Vec::new());
        let mut settings = neuink_config::RerankSettings::default();
        settings.mode = neuink_config::RerankMode::Off;
        settings.listwise.enabled = false;
        settings.structural_soft_demotion = false;
        let (out, outcome) = rerank_task_results(results, "q", &settings, None, None, None, 0);
        assert_eq!(outcome.used, "off");
        assert_eq!(out.total_hit_count, 0);
    }
}


