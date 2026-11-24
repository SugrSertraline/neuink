//! Within-paper visual sidecar evidence fusion (Direction C).
//!
//! Reuses the `ParentScore`s already produced by `visual.recall()` during unified
//! routing (zero extra visual-encoder calls). Under a gold-free dual gate:
//! - Explicit visual/figure/table intent (Condition A): rescues unrecalled Figure/Table
//!   segments on the top visually-matched pages and fuses them with text hits via RRF.
//! - Weak text overlap (Condition B): keeps the first `head_window - 2` text hits and
//!   inserts at most two Figure/Table segments at ranks 9–10.
//! - Strong pure-text queries without visual intent: strict no-op, leaving validated
//!   pure-text precision untouched.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use neuink_domain::SegmentType;

use crate::carrier_binding::{CarrierBinding, CarrierKind};
use crate::retrieval_pipeline::{hit_identity, ordered_hits, results_from_hits};
use crate::visual_sidecar::ParentScore;
use crate::{
    strip_passage_header, weighted_reciprocal_rank_fusion, SearchDocument,
    SearchDocumentSourceKind, SearchHit, SearchResults, SearchTarget,
};

const MAX_VISUAL_PAGES: usize = 3;
const MAX_SEGMENTS_PER_PAGE: usize = 2;
const MAX_VISUAL_SEGMENTS: usize = 6;
const MAX_ANCHOR_DOCUMENTS: usize = 2;
const SNIPPET_CHAR_LIMIT: usize = 1400;
/// Raw parent cosine below this does not open the pre-CE visual window.
const MIN_VISUAL_PARENT_COSINE: f32 = 0.22;
const CONDITION_B_INSERTS: usize = 2;

#[derive(Clone, Debug, Default)]
struct PageEntrySegments {
    visual: Vec<SearchHit>,
    fallback: Option<SearchHit>,
}

/// Zero-I/O page-to-segment lookup built once from the prepared search documents.
/// Lets the visual sidecar inject visually-matched Figure/Table segments even when
/// sparse OCR/caption text missed Stage-1 text recall.
#[derive(Clone, Debug, Default)]
pub struct VisualPageSegments {
    by_page: HashMap<(String, u32), PageEntrySegments>,
}

impl VisualPageSegments {
    pub fn from_documents(documents: &[SearchDocument]) -> Self {
        let mut by_page: HashMap<(String, u32), PageEntrySegments> = HashMap::new();
        for document in documents {
            if document.source.kind != SearchDocumentSourceKind::Segment {
                continue;
            }
            let SearchTarget::Segment {
                entry_id, page_idx, ..
            } = &document.target
            else {
                continue;
            };
            let snippet = build_visual_snippet(document);
            if snippet.is_empty() {
                continue;
            }
            let hit = SearchHit {
                entry_id: entry_id.clone(),
                entry_title: document.entry_title.clone(),
                source: document.source.clone(),
                target: document.target.clone(),
                title: document.title.clone(),
                snippet,
                score: 0.0,
                matched_terms: Vec::new(),
                surrounding_context: None,
            };
            let bucket = by_page
                .entry((entry_id.as_str().to_string(), *page_idx))
                .or_default();
            if matches!(
                document.source.segment_type,
                Some(SegmentType::Figure | SegmentType::Table)
            ) {
                bucket.visual.push(hit);
            } else if bucket.fallback.is_none()
                && is_substantive_fallback(document.source.segment_type)
            {
                bucket.fallback = Some(hit);
            }
        }
        Self { by_page }
    }

    fn hits_for_page(
        &self,
        entry_id: &str,
        page_idx: u32,
        preferred_type: Option<SegmentType>,
    ) -> Vec<SearchHit> {
        let Some(bucket) = self.by_page.get(&(entry_id.to_string(), page_idx)) else {
            return Vec::new();
        };
        if !bucket.visual.is_empty() {
            let mut ordered = bucket.visual.clone();
            if let Some(pref) = preferred_type {
                ordered.sort_by_key(|hit| usize::from(hit.source.segment_type != Some(pref)));
            }
            return ordered;
        }
        bucket.fallback.iter().cloned().collect()
    }

    fn figure_table_hits(
        &self,
        entry_id: &str,
        page_idx: u32,
        preferred_type: Option<SegmentType>,
    ) -> Vec<SearchHit> {
        let Some(bucket) = self.by_page.get(&(entry_id.to_string(), page_idx)) else {
            return Vec::new();
        };
        let mut ordered = bucket.visual.clone();
        if let Some(pref) = preferred_type {
            ordered.sort_by_key(|hit| usize::from(hit.source.segment_type != Some(pref)));
        }
        ordered
    }
}

/// Scale-invariant confidence summary of a Cross-Encoder head.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CeConfidence {
    pub top1_prob: f32,
    pub margin_prob: f32,
    /// Scale- and shift-invariant top-1 lead: `(raw[0] - raw[1]) / std(raw)`.
    pub top1_gap_z: f32,
}

impl CeConfidence {
    /// `scores` are in rank order. Values outside `[0, 1]` are sigmoid-normalized.
    /// Calibrated probabilities in that range are kept as they are.
    /// `top1_gap_z` uses the raw finite scores, sorted so an unsorted slice still works.
    pub fn from_raw_scores(scores: &[f32]) -> Option<Self> {
        let finite = scores
            .iter()
            .copied()
            .filter(|score| score.is_finite())
            .collect::<Vec<_>>();
        if finite.is_empty() {
            return None;
        }
        let top1_gap_z = population_top1_gap_z(&finite);
        let needs_sigmoid = finite.iter().any(|score| *score < 0.0 || *score > 1.0);
        let probs = if needs_sigmoid {
            finite
                .iter()
                .copied()
                .map(sigmoid_clamped)
                .collect::<Vec<_>>()
        } else {
            finite
        };
        let top1_prob = probs[0];
        let margin_prob = if let Some(second) = probs.get(1) {
            (top1_prob - second).max(0.0)
        } else {
            top1_prob
        };
        Some(Self {
            top1_prob,
            margin_prob,
            top1_gap_z,
        })
    }
}

/// Population `(s0 - s1) / std`. One score cannot show ambiguity.
fn population_top1_gap_z(raw: &[f32]) -> f32 {
    if raw.len() < 2 {
        return f32::INFINITY;
    }
    let mut ordered = raw.to_vec();
    ordered.sort_by(|left, right| right.total_cmp(left));
    let lead = ordered[0] - ordered[1];
    let count = raw.len() as f32;
    let mean = raw.iter().copied().sum::<f32>() / count;
    let variance = raw
        .iter()
        .map(|score| {
            let delta = score - mean;
            delta * delta
        })
        .sum::<f32>()
        / count;
    let std = variance.sqrt();
    if std < 1e-4 {
        0.0
    } else {
        (lead / std).max(0.0)
    }
}

fn sigmoid_clamped(value: f32) -> f32 {
    let clamped = value.clamp(-30.0, 30.0);
    1.0 / (1.0 + (-clamped).exp())
}

/// Scale-invariant CE ambiguity gate for Condition C (`(s0 - s1) / std`).
const CONDITION_C_MAX_GAP_Z: f32 = 1.2;
/// Minimum anchored visual parent cosine required to open Condition C.
const CONDITION_C_MIN_VISUAL_COSINE: f32 = 0.32;
/// Leading text hits locked untouched when Condition C runs without explicit visual intent.
const CONDITION_C_LOCK_HEAD: usize = 3;
const CONDITION_C_VISUAL_WEIGHT: f32 = 0.35;
const CONDITION_C_TOP_VISUAL_PER_PAPER: usize = 2;

/// Configuration for within-paper visual evidence fusion.
#[derive(Clone, Copy, Debug)]
pub struct WithinPaperVisualOptions {
    pub text_weight: f32,
    pub visual_weight: f32,
    pub rrf_k: f32,
    pub max_snippet_overlap: usize,
    /// Condition B keeps this many leading text hits, minus the two insert slots.
    pub head_window: usize,
    /// Raw Cross-Encoder confidence. `None` leaves Condition C off.
    pub ce_confidence: Option<CeConfidence>,
}

impl Default for WithinPaperVisualOptions {
    fn default() -> Self {
        Self {
            text_weight: 1.0,
            visual_weight: 0.5,
            rrf_k: crate::DEFAULT_RRF_K,
            max_snippet_overlap: 2,
            head_window: 10,
            ce_confidence: None,
        }
    }
}

/// Returns true when the question explicitly asks about a figure, table, chart, or visual diagram.
pub fn question_has_visual_intent(
    question: &str,
    english_question: Option<&str>,
    binding: &CarrierBinding,
) -> bool {
    if binding
        .carriers
        .iter()
        .any(|carrier| matches!(carrier.kind, CarrierKind::Figure | CarrierKind::Table))
    {
        return true;
    }
    if binding.unnumbered.iter().any(|word| {
        let lower = word.to_ascii_lowercase();
        lower.contains("fig")
            || lower.contains("table")
            || word.contains('图')
            || word.contains('表')
    }) {
        return true;
    }
    text_has_visual_intent(question) || english_question.is_some_and(text_has_visual_intent)
}

fn text_has_visual_intent(text: &str) -> bool {
    const ZH_PHRASES: &[&str] = &[
        "图表",
        "架构图",
        "流程图",
        "示意图",
        "柱状图",
        "折线图",
        "散点图",
        "热力图",
        "插图",
        "表格",
        "图中",
        "表中",
        "看图",
        "看表",
        "第几张图",
        "这张图",
        "该图",
        "该表",
    ];
    if ZH_PHRASES.iter().any(|phrase| text.contains(phrase)) {
        return true;
    }
    const EN_WORDS: &[&str] = &[
        "figure",
        "figures",
        "fig",
        "table",
        "tables",
        "chart",
        "charts",
        "plot",
        "plots",
        "diagram",
        "diagrams",
        "flowchart",
        "heatmap",
        "histogram",
        "screenshot",
        "visualization",
    ];
    let lower = text.to_ascii_lowercase();
    lower
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .any(|word| EN_WORDS.contains(&word))
}

#[derive(Clone, Debug)]
struct VisualPageVote {
    entry_id: String,
    page_idx: u32,
    score: f32,
    preferred_type: Option<SegmentType>,
}

/// Applies gold-free gated doc-anchored visual evidence fusion (designed to run after
/// text Cross-Encoder reranking so text-only rerankers do not re-demote caption-sparse
/// figures, and anchored strictly to the top-ranked papers to prevent cross-paper figure
/// interference; Track C SPIQA ablation: +7.00pp R@5 vs unanchored, +6.00pp R@1 single-paper).
/// Returns `(results, applied)`. Never widens `routed_documents` or bypasses `segment_types`
/// / `section_filter`.
#[allow(clippy::too_many_arguments)]
pub fn apply_within_paper_visual_evidence(
    results: SearchResults,
    visual_parents: &[ParentScore],
    page_segments: &VisualPageSegments,
    routed_documents: &[String],
    question: &str,
    english_question: Option<&str>,
    binding: &CarrierBinding,
    segment_types: &[SegmentType],
    section_filter: Option<&str>,
    options: WithinPaperVisualOptions,
) -> (SearchResults, bool) {
    if visual_parents.is_empty() || routed_documents.is_empty() || options.visual_weight <= 0.0 {
        return (results, false);
    }
    let text_hits = ordered_hits(&results);
    let anchor_documents = select_anchor_documents(&text_hits, routed_documents);
    let page_votes = top_visual_pages(visual_parents, &anchor_documents);
    if page_votes.is_empty() {
        return (results, false);
    }

    let visual_intent = question_has_visual_intent(question, english_question, binding);
    let weak_text = text_hits.is_empty()
        || max_head_overlap(&text_hits, question, english_question) <= options.max_snippet_overlap;
    let anchor_cosine = best_anchor_cosine(visual_parents, &anchor_documents);
    let condition_c = if visual_intent || text_hits.is_empty() {
        None
    } else {
        options.ce_confidence.filter(|confidence| {
            confidence.top1_gap_z < CONDITION_C_MAX_GAP_Z
                && anchor_cosine >= CONDITION_C_MIN_VISUAL_COSINE
        })
    };
    if !visual_intent && !weak_text && condition_c.is_none() {
        return (results, false);
    }

    let query = results.query.clone();
    let mode = results.mode.clone();
    let generation = results.index_generation;
    let warnings = results.warnings.clone();

    if condition_c.is_some() {
        let visual_lists = condition_c_visual_lists(
            &anchor_documents,
            &page_votes,
            &text_hits,
            page_segments,
            segment_types,
            section_filter,
        );
        let lock_len = text_hits.len().min(CONDITION_C_LOCK_HEAD);
        let locked = text_hits[..lock_len].to_vec();
        let locked_ids = locked.iter().map(hit_identity).collect::<BTreeSet<_>>();
        let tail = text_hits
            .iter()
            .skip(lock_len)
            .filter(|hit| !locked_ids.contains(&hit_identity(hit)))
            .cloned()
            .collect::<Vec<_>>();
        let visual_tail = visual_lists
            .iter()
            .filter_map(|(decay, hits)| {
                let hits = hits
                    .iter()
                    .filter(|hit| !locked_ids.contains(&hit_identity(hit)))
                    .cloned()
                    .collect::<Vec<_>>();
                (!hits.is_empty()).then_some((*decay, hits))
            })
            .collect::<Vec<_>>();
        if !visual_tail.is_empty() {
            let mut fused_tail = fuse_condition_c(&tail, &visual_tail, options);
            fused_tail.retain(|hit| !locked_ids.contains(&hit_identity(hit)));
            let mut combined = locked;
            combined.extend(fused_tail);
            crate::stamp_rank_scores(&mut combined);
            return (
                results_from_hits(query, mode, generation, combined, warnings),
                true,
            );
        }
    }
    if !visual_intent && !weak_text {
        return (results, false);
    }

    let visual_candidates = collect_visual_candidates(
        &page_votes,
        &text_hits,
        page_segments,
        segment_types,
        section_filter,
    );
    if visual_candidates.is_empty() {
        return (results, false);
    }

    if visual_intent && !text_hits.is_empty() {
        let mut by_key = BTreeMap::<String, SearchHit>::new();
        let text_keys = text_hits
            .iter()
            .map(|hit| {
                let key = hit_identity(hit);
                by_key.entry(key.clone()).or_insert_with(|| hit.clone());
                key
            })
            .collect::<Vec<_>>();
        let visual_keys = visual_candidates
            .iter()
            .map(|hit| {
                let key = hit_identity(hit);
                by_key.entry(key.clone()).or_insert_with(|| hit.clone());
                key
            })
            .collect::<Vec<_>>();
        let fused = weighted_reciprocal_rank_fusion(
            &[text_keys, visual_keys],
            &[options.text_weight.max(0.01), options.visual_weight],
            options.rrf_k.max(1.0),
        );
        let hits = fused
            .into_iter()
            .filter_map(|(key, score)| {
                let mut hit = by_key.remove(&key)?;
                hit.score = score;
                Some(hit)
            })
            .collect::<Vec<_>>();
        return (
            results_from_hits(query, mode, generation, hits, warnings),
            true,
        );
    }

    // Condition B: keep the leading text hits, then place at most two Figure/Table
    // segments at the end of `head_window` (ranks 9–10 when the window is 10).
    // Hits already inside that prefix stay put. Later copies of an inserted segment
    // are removed so `truncate(top_k)` cannot drop the rescued chart.
    let keep_head = text_hits
        .len()
        .min(options.head_window.saturating_sub(CONDITION_B_INSERTS).max(1));
    let head_ids = text_hits
        .iter()
        .take(keep_head)
        .map(hit_identity)
        .collect::<BTreeSet<_>>();
    let mut inserts = Vec::new();
    let mut insert_ids = BTreeSet::new();
    for hit in visual_candidates {
        if inserts.len() >= CONDITION_B_INSERTS {
            break;
        }
        if !is_figure_or_table(&hit) {
            continue;
        }
        let key = hit_identity(&hit);
        if head_ids.contains(&key) || !insert_ids.insert(key) {
            continue;
        }
        inserts.push(hit);
    }
    if inserts.is_empty() {
        return (results, false);
    }
    let mut combined = Vec::with_capacity(text_hits.len() + inserts.len());
    combined.extend(text_hits.iter().take(keep_head).cloned());
    combined.extend(inserts);
    for hit in text_hits.into_iter().skip(keep_head) {
        if !insert_ids.contains(&hit_identity(&hit)) {
            combined.push(hit);
        }
    }
    crate::stamp_rank_scores(&mut combined);
    (
        results_from_hits(query, mode, generation, combined, warnings),
        true,
    )
}

/// Moves up to `max_append` Figure/Table segments into the tail of the
/// `0..rerank_head` window before a cross-encoder scores that window.
///
/// Candidates may already sit at `keep_prefix..pool` or be missing from the pool.
/// Displaced text hits stay after `rerank_head`. Nothing is dropped. No-op when
/// the window is under 10, the best anchored parent cosine is below 0.22, or no
/// Figure/Table segment falls outside the preserved prefix.
#[allow(clippy::too_many_arguments)]
pub fn supplement_hits_from_visual_pages(
    results: SearchResults,
    visual_parents: &[ParentScore],
    page_segments: &VisualPageSegments,
    routed_documents: &[String],
    segment_types: &[SegmentType],
    section_filter: Option<&str>,
    rerank_head: usize,
    max_append: usize,
) -> SearchResults {
    let allowed = max_append.min(rerank_head);
    if rerank_head < 10 || allowed == 0 || visual_parents.is_empty() || routed_documents.is_empty()
    {
        return results;
    }
    let existing = ordered_hits(&results);
    let anchors = select_anchor_documents(&existing, routed_documents);
    if best_anchor_cosine(visual_parents, &anchors) < MIN_VISUAL_PARENT_COSINE {
        return results;
    }
    let page_votes = top_visual_pages(visual_parents, &anchors);
    let candidates = collect_figure_table_candidates(
        &page_votes,
        &existing,
        page_segments,
        segment_types,
        section_filter,
    );
    let Some(additions) = select_window_additions(&existing, &candidates, rerank_head, allowed)
    else {
        return results;
    };
    let keep_prefix = existing.len().min(rerank_head.saturating_sub(additions.len()));
    let addition_ids = additions.iter().map(hit_identity).collect::<BTreeSet<_>>();
    let mut combined = Vec::with_capacity(existing.len() + additions.len());
    combined.extend_from_slice(&existing[..keep_prefix]);
    combined.extend(additions);
    for hit in existing.iter().skip(keep_prefix) {
        if !addition_ids.contains(&hit_identity(hit)) {
            combined.push(hit.clone());
        }
    }
    crate::stamp_rank_scores(&mut combined);
    results_from_hits(
        results.query,
        results.mode,
        results.index_generation,
        combined,
        results.warnings,
    )
}

fn best_anchor_cosine(visual_parents: &[ParentScore], anchors: &[String]) -> f32 {
    visual_parents
        .iter()
        .filter(|parent| {
            parent.score.is_finite()
                && parent.page_idx.is_some()
                && anchors.iter().any(|entry| entry == &parent.entry_id)
        })
        .map(|parent| parent.score)
        .fold(f32::NEG_INFINITY, f32::max)
}

fn collect_figure_table_candidates(
    page_votes: &[VisualPageVote],
    text_hits: &[SearchHit],
    page_segments: &VisualPageSegments,
    segment_types: &[SegmentType],
    section_filter: Option<&str>,
) -> Vec<SearchHit> {
    let mut chosen = Vec::new();
    let mut seen = BTreeSet::new();
    for vote in page_votes {
        for hit in text_hits.iter().filter(|hit| {
            hit_matches_page(hit, &vote.entry_id, vote.page_idx)
                && is_figure_or_table(hit)
                && hit_matches_filters(hit, segment_types, section_filter)
        }) {
            if seen.insert(hit_identity(hit)) {
                chosen.push(hit.clone());
            }
        }
        for hit in page_segments.figure_table_hits(&vote.entry_id, vote.page_idx, vote.preferred_type)
        {
            if !hit_matches_filters(&hit, segment_types, section_filter) {
                continue;
            }
            if seen.insert(hit_identity(&hit)) {
                chosen.push(hit);
            }
        }
    }
    chosen
}

/// Largest `k` in `1..=max_append` whose first `k` Figure/Table candidates all sit
/// outside the prefix that `k` itself would preserve.
fn select_window_additions(
    existing: &[SearchHit],
    candidates: &[SearchHit],
    rerank_head: usize,
    max_append: usize,
) -> Option<Vec<SearchHit>> {
    for count in (1..=max_append.min(rerank_head)).rev() {
        let keep = existing.len().min(rerank_head.saturating_sub(count));
        let mut blocked = existing
            .iter()
            .take(keep)
            .map(hit_identity)
            .collect::<BTreeSet<_>>();
        let mut picks = Vec::new();
        for candidate in candidates {
            if picks.len() == count {
                break;
            }
            if blocked.insert(hit_identity(candidate)) {
                picks.push(candidate.clone());
            }
        }
        if picks.len() == count {
            return Some(picks);
        }
    }
    None
}

fn is_figure_or_table(hit: &SearchHit) -> bool {
    matches!(
        hit.source.segment_type,
        Some(SegmentType::Figure | SegmentType::Table)
    )
}

/// Figure/Table hits inside the anchor papers, at most two per paper.
/// The decay is `1 / (1 + 0.5 * doc_rank)`.
fn condition_c_visual_lists(
    anchor_documents: &[String],
    page_votes: &[VisualPageVote],
    text_hits: &[SearchHit],
    page_segments: &VisualPageSegments,
    segment_types: &[SegmentType],
    section_filter: Option<&str>,
) -> Vec<(f32, Vec<SearchHit>)> {
    let mut lists = Vec::new();
    for (doc_rank, entry) in anchor_documents.iter().enumerate() {
        let decay = 1.0 / (1.0 + 0.5 * doc_rank as f32);
        let mut chosen = Vec::new();
        let mut seen = BTreeSet::new();
        for vote in page_votes.iter().filter(|vote| &vote.entry_id == entry) {
            if chosen.len() >= CONDITION_C_TOP_VISUAL_PER_PAPER {
                break;
            }
            for hit in text_hits.iter().filter(|hit| {
                hit_matches_page(hit, entry, vote.page_idx)
                    && is_figure_or_table(hit)
                    && hit_matches_filters(hit, segment_types, section_filter)
            }) {
                if chosen.len() >= CONDITION_C_TOP_VISUAL_PER_PAPER {
                    break;
                }
                if seen.insert(hit_identity(hit)) {
                    chosen.push(hit.clone());
                }
            }
            for hit in page_segments.figure_table_hits(entry, vote.page_idx, vote.preferred_type)
            {
                if chosen.len() >= CONDITION_C_TOP_VISUAL_PER_PAPER {
                    break;
                }
                if !hit_matches_filters(&hit, segment_types, section_filter) {
                    continue;
                }
                if seen.insert(hit_identity(&hit)) {
                    chosen.push(hit);
                }
            }
        }
        if !chosen.is_empty() {
            lists.push((decay, chosen));
        }
    }
    lists
}

fn fuse_condition_c(
    text_hits: &[SearchHit],
    visual_lists: &[(f32, Vec<SearchHit>)],
    options: WithinPaperVisualOptions,
) -> Vec<SearchHit> {
    let mut by_key = BTreeMap::<String, SearchHit>::new();
    let mut lists = Vec::new();
    let mut weights = Vec::new();
    let text_keys = text_hits
        .iter()
        .map(|hit| {
            let key = hit_identity(hit);
            by_key.entry(key.clone()).or_insert_with(|| hit.clone());
            key
        })
        .collect::<Vec<_>>();
    lists.push(text_keys);
    weights.push(options.text_weight.max(0.01));
    let base_visual = CONDITION_C_VISUAL_WEIGHT.min(options.visual_weight);
    for (decay, hits) in visual_lists {
        if *decay <= 0.0 || base_visual <= 0.0 {
            continue;
        }
        let keys = hits
            .iter()
            .map(|hit| {
                let key = hit_identity(hit);
                by_key.entry(key.clone()).or_insert_with(|| hit.clone());
                key
            })
            .collect::<Vec<_>>();
        if keys.is_empty() {
            continue;
        }
        weights.push(base_visual * decay);
        lists.push(keys);
    }
    weighted_reciprocal_rank_fusion(&lists, &weights, options.rrf_k.max(1.0))
        .into_iter()
        .filter_map(|(key, score)| {
            let mut hit = by_key.remove(&key)?;
            hit.score = score;
            Some(hit)
        })
        .collect()
}

/// Selects up to `MAX_ANCHOR_DOCUMENTS` (2) distinct papers from the top of the current
/// text ranking (restricted to `routed_documents`), falling back to the top routed papers
/// when text hits are empty. Prevents cross-paper figure pollution from tail routed papers.
fn select_anchor_documents(text_hits: &[SearchHit], routed_documents: &[String]) -> Vec<String> {
    if routed_documents.len() <= 1 {
        return routed_documents.to_vec();
    }
    let routed_set = routed_documents
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let mut anchors = Vec::with_capacity(MAX_ANCHOR_DOCUMENTS);
    for hit in text_hits {
        let eid = hit.entry_id.as_str();
        if routed_set.contains(eid) && !anchors.iter().any(|existing: &String| existing == eid) {
            anchors.push(eid.to_string());
            if anchors.len() >= MAX_ANCHOR_DOCUMENTS {
                break;
            }
        }
    }
    if anchors.is_empty() {
        routed_documents
            .iter()
            .take(MAX_ANCHOR_DOCUMENTS)
            .cloned()
            .collect()
    } else {
        anchors
    }
}

fn top_visual_pages(
    visual_parents: &[ParentScore],
    anchor_documents: &[String],
) -> Vec<VisualPageVote> {
    let mut by_page: HashMap<(String, u32), VisualPageVote> = HashMap::new();
    for parent in visual_parents {
        if !parent.score.is_finite() {
            continue;
        }
        let Some(doc_rank) = anchor_documents
            .iter()
            .position(|allowed| allowed == &parent.entry_id)
        else {
            continue;
        };
        let Some(page_idx) = parent.page_idx else {
            continue;
        };
        // Apply document-rank decay (1.0 for #1 paper, 0.667 for #2) so higher-ranked
        // anchored papers keep priority while single-paper mode (doc_rank=0) stays 1.0x.
        let decayed_score = parent.score / (1.0 + 0.5 * doc_rank as f32);
        let key = (parent.entry_id.clone(), page_idx);
        match by_page.get_mut(&key) {
            Some(existing) => {
                if decayed_score > existing.score {
                    existing.score = decayed_score;
                    if parent.segment_type.is_some() {
                        existing.preferred_type = parent.segment_type;
                    }
                } else if existing.preferred_type.is_none() && parent.segment_type.is_some() {
                    existing.preferred_type = parent.segment_type;
                }
            }
            None => {
                by_page.insert(
                    key,
                    VisualPageVote {
                        entry_id: parent.entry_id.clone(),
                        page_idx,
                        score: decayed_score,
                        preferred_type: parent.segment_type,
                    },
                );
            }
        }
    }
    let mut votes = by_page.into_values().collect::<Vec<_>>();
    votes.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.entry_id.cmp(&right.entry_id))
            .then_with(|| left.page_idx.cmp(&right.page_idx))
    });
    votes.truncate(MAX_VISUAL_PAGES);
    votes
}

fn collect_visual_candidates(
    page_votes: &[VisualPageVote],
    text_hits: &[SearchHit],
    page_segments: &VisualPageSegments,
    segment_types: &[SegmentType],
    section_filter: Option<&str>,
) -> Vec<SearchHit> {
    let mut chosen = Vec::new();
    let mut seen = BTreeSet::new();
    for vote in page_votes {
        if chosen.len() >= MAX_VISUAL_SEGMENTS {
            break;
        }
        let mut page_added = 0usize;
        // First prefer Figure/Table hits already present on this page in text_hits.
        for hit in text_hits.iter().filter(|hit| {
            hit_matches_page(hit, &vote.entry_id, vote.page_idx)
                && matches!(
                    hit.source.segment_type,
                    Some(SegmentType::Figure | SegmentType::Table)
                )
                && hit_matches_filters(hit, segment_types, section_filter)
        }) {
            if page_added >= MAX_SEGMENTS_PER_PAGE || chosen.len() >= MAX_VISUAL_SEGMENTS {
                break;
            }
            if seen.insert(hit_identity(hit)) {
                chosen.push(hit.clone());
                page_added += 1;
            }
        }
        // Rescue any unrecalled Figure/Table (or fallback substantive) segments on this page.
        for hit in page_segments.hits_for_page(&vote.entry_id, vote.page_idx, vote.preferred_type) {
            if page_added >= MAX_SEGMENTS_PER_PAGE || chosen.len() >= MAX_VISUAL_SEGMENTS {
                break;
            }
            if !hit_matches_filters(&hit, segment_types, section_filter) {
                continue;
            }
            if seen.insert(hit_identity(&hit)) {
                chosen.push(hit);
                page_added += 1;
            }
        }
        // If nothing came from page_segments (e.g. unit test with synthetic hits), promote
        // the highest-scoring text hit already on that visually-matched page.
        if page_added == 0 {
            if let Some(hit) = text_hits.iter().find(|hit| {
                hit_matches_page(hit, &vote.entry_id, vote.page_idx)
                    && hit_matches_filters(hit, segment_types, section_filter)
            }) {
                if seen.insert(hit_identity(hit)) {
                    chosen.push(hit.clone());
                }
            }
        }
    }
    chosen
}

fn hit_matches_page(hit: &SearchHit, entry_id: &str, page_idx: u32) -> bool {
    match &hit.target {
        SearchTarget::Segment {
            entry_id: target_entry,
            page_idx: target_page,
            ..
        } => target_entry.as_str() == entry_id && *target_page == page_idx,
        _ => false,
    }
}

fn hit_matches_filters(
    hit: &SearchHit,
    segment_types: &[SegmentType],
    section_filter: Option<&str>,
) -> bool {
    if !segment_types.is_empty()
        && !hit
            .source
            .segment_type
            .is_some_and(|kind| segment_types.contains(&kind))
    {
        return false;
    }
    if let Some(filter) = section_filter
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let lower = filter.to_ascii_lowercase();
        let id_match = hit.source.section_id.as_deref() == Some(filter);
        let path_match = hit
            .source
            .section_path
            .as_deref()
            .is_some_and(|path| path.to_ascii_lowercase().contains(&lower));
        if !id_match && !path_match {
            return false;
        }
    }
    true
}

fn max_head_overlap(hits: &[SearchHit], question: &str, english_question: Option<&str>) -> usize {
    let Some(best) = hits.first() else {
        return 0;
    };
    let overlap_for = |query: &str| {
        let q_tokens = crate::token::tokenize(query)
            .into_iter()
            .collect::<BTreeSet<_>>();
        if q_tokens.is_empty() {
            return 0;
        }
        crate::token::tokenize(&best.snippet)
            .into_iter()
            .filter(|token| q_tokens.contains(token))
            .collect::<BTreeSet<_>>()
            .len()
    };
    overlap_for(question).max(english_question.map_or(0, overlap_for))
}

fn is_substantive_fallback(segment_type: Option<SegmentType>) -> bool {
    !matches!(
        segment_type,
        Some(
            SegmentType::Heading
                | SegmentType::PageHeader
                | SegmentType::PageFooter
                | SegmentType::PageNumber
                | SegmentType::AsideText
                | SegmentType::PageFootnote
        )
    )
}

fn build_visual_snippet(document: &SearchDocument) -> String {
    let mut parts = Vec::new();
    if let Some(caption) = document
        .sections
        .iter()
        .find(|section| section.label == "caption")
        .map(|section| section.text.trim())
        .filter(|value| !value.is_empty())
    {
        parts.push(caption.to_string());
    }
    if let Some(body) = document
        .sections
        .iter()
        .find(|section| section.label == "body")
        .map(|section| strip_passage_header(&section.text))
        .filter(|value| !value.is_empty())
    {
        if parts.first().map(String::as_str) != Some(body) {
            parts.push(body.to_string());
        }
    }
    let joined = parts
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    clip_visual_text(&joined)
}

/// Keeps caption and table rows up to 1400 characters, cutting at a sentence end
/// or whitespace when the body is longer.
fn clip_visual_text(text: &str) -> String {
    let limit = SNIPPET_CHAR_LIMIT;
    let mut end = text.len();
    let mut seen = 0usize;
    for (index, _) in text.char_indices() {
        if seen == limit {
            end = index;
            break;
        }
        seen += 1;
    }
    if seen < limit {
        return text.to_string();
    }
    let window = &text[..end];
    let sentence = [". ", "! ", "? ", "。", "！", "？"]
        .iter()
        .filter_map(|mark| window.rfind(mark).map(|pos| pos + mark.trim_end().len()))
        .filter(|byte| window[..*byte].chars().count() >= limit / 2)
        .max();
    let cut = sentence.unwrap_or_else(|| {
        window
            .rfind(char::is_whitespace)
            .filter(|byte| window[..*byte].chars().count() >= limit / 2)
            .unwrap_or(window.len())
    });
    format!("{}...", window[..cut].trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::carrier_binding::parse_binding;
    use crate::{
        SearchDocument, SearchDocumentSource, SearchDocumentSourceKind, SearchTarget,
        SearchTextSection,
    };
    use neuink_domain::{EntryId, SegmentType, SegmentUid};

    fn seg_doc(
        entry: &str,
        uid: &str,
        page_idx: u32,
        kind: SegmentType,
        body: &str,
    ) -> SearchDocument {
        SearchDocument {
            entry_id: EntryId::from_string(entry),
            entry_title: "Paper".to_string(),
            source: SearchDocumentSource {
                kind: SearchDocumentSourceKind::Segment,
                segment_uid: Some(SegmentUid::from_string(uid)),
                page_idx: Some(page_idx),
                section_path: Some("Experiments".to_string()),
                segment_type: Some(kind),
                ..SearchDocumentSource::default()
            },
            target: SearchTarget::Segment {
                entry_id: EntryId::from_string(entry),
                segment_uid: SegmentUid::from_string(uid),
                page_idx,
            },
            title: "Paper".to_string(),
            sections: vec![SearchTextSection::body(body)],
            boost: 1.0,
        }
    }

    fn seg_hit(
        entry: &str,
        uid: &str,
        page_idx: u32,
        kind: SegmentType,
        snippet: &str,
        score: f32,
    ) -> SearchHit {
        SearchHit {
            entry_id: EntryId::from_string(entry),
            entry_title: "Paper".to_string(),
            source: SearchDocumentSource {
                kind: SearchDocumentSourceKind::Segment,
                segment_uid: Some(SegmentUid::from_string(uid)),
                page_idx: Some(page_idx),
                section_path: Some("Experiments".to_string()),
                segment_type: Some(kind),
                ..SearchDocumentSource::default()
            },
            target: SearchTarget::Segment {
                entry_id: EntryId::from_string(entry),
                segment_uid: SegmentUid::from_string(uid),
                page_idx,
            },
            title: "Paper".to_string(),
            snippet: snippet.to_string(),
            score,
            matched_terms: Vec::new(),
            surrounding_context: None,
        }
    }

    fn parent(entry: &str, page_idx: u32, score: f32, kind: Option<SegmentType>) -> ParentScore {
        ParentScore {
            entry_id: entry.to_string(),
            parent_id: format!("page:{page_idx}"),
            score,
            page_idx: Some(page_idx),
            segment_type: kind,
        }
    }

    #[test]
    fn visual_snippet_keeps_table_rows_beyond_the_old_320_character_cut() {
        let row = "col_a col_b 91.4 ";
        let body = row.repeat(40);
        assert!(body.chars().count() > 320);
        assert!(body.chars().count() <= 1400);
        let document = SearchDocument {
            entry_id: EntryId::from_string("e1"),
            entry_title: "Paper".to_string(),
            source: SearchDocumentSource {
                kind: SearchDocumentSourceKind::Segment,
                segment_uid: Some(SegmentUid::from_string("table")),
                page_idx: Some(1),
                segment_type: Some(SegmentType::Table),
                ..SearchDocumentSource::default()
            },
            target: SearchTarget::Segment {
                entry_id: EntryId::from_string("e1"),
                segment_uid: SegmentUid::from_string("table"),
                page_idx: 1,
            },
            title: "Paper".to_string(),
            sections: vec![
                SearchTextSection::with_boost("caption", "Table 2: main results.", 1.0),
                SearchTextSection::body(body),
            ],
            boost: 1.0,
        };
        let snippet = build_visual_snippet(&document);
        assert!(snippet.contains("Table 2: main results."));
        assert!(snippet.matches("91.4").count() > 8);
        assert!(!snippet.ends_with("..."));
        assert!(snippet.chars().count() <= 1400);
    }

    #[test]
    fn pure_text_strong_overlap_query_stays_strict_noop() {
        let docs = vec![
            seg_doc(
                "e1",
                "p1",
                1,
                SegmentType::Paragraph,
                "AdamW optimizer learning rate schedule.",
            ),
            seg_doc(
                "e1",
                "fig4",
                4,
                SegmentType::Figure,
                "Figure 4: latency curve.",
            ),
        ];
        let segments = VisualPageSegments::from_documents(&docs);
        let text = results_from_hits(
            "optimizer learning rate".to_string(),
            "hybrid".to_string(),
            1,
            vec![seg_hit(
                "e1",
                "p1",
                1,
                SegmentType::Paragraph,
                "AdamW optimizer learning rate schedule.",
                0.95,
            )],
            Vec::new(),
        );
        let (out, applied) = apply_within_paper_visual_evidence(
            text,
            &[parent("e1", 4, 0.99, Some(SegmentType::Figure))],
            &segments,
            &["e1".to_string()],
            "optimizer learning rate",
            None,
            &parse_binding("optimizer learning rate"),
            &[],
            None,
            WithinPaperVisualOptions::default(),
        );
        assert!(!applied);
        assert_eq!(ordered_hits(&out).len(), 1);
        assert_eq!(ordered_hits(&out)[0].score, 0.95);
    }

    #[test]
    fn visual_intent_rescues_unrecalled_figure_and_fuses_with_rrf() {
        let docs = vec![
            seg_doc(
                "e1",
                "p1",
                1,
                SegmentType::Paragraph,
                "We compare model architectures.",
            ),
            seg_doc(
                "e1",
                "fig4",
                4,
                SegmentType::Figure,
                "Figure 4: Encoder-decoder architecture.",
            ),
        ];
        let segments = VisualPageSegments::from_documents(&docs);
        let text = results_from_hits(
            "What does Figure 4 architecture diagram show?".to_string(),
            "hybrid".to_string(),
            1,
            vec![seg_hit(
                "e1",
                "p1",
                1,
                SegmentType::Paragraph,
                "We compare model architectures.",
                0.8,
            )],
            Vec::new(),
        );
        let question = "What does Figure 4 architecture diagram show?";
        let (out, applied) = apply_within_paper_visual_evidence(
            text,
            &[parent("e1", 4, 0.95, Some(SegmentType::Figure))],
            &segments,
            &["e1".to_string()],
            question,
            None,
            &parse_binding(question),
            &[],
            None,
            WithinPaperVisualOptions::default(),
        );
        assert!(applied);
        let hits = ordered_hits(&out);
        assert_eq!(hits.len(), 2);
        assert!(hits
            .iter()
            .any(|hit| matches!(&hit.target, SearchTarget::Segment { segment_uid, .. } if segment_uid.as_str() == "fig4")));
    }

    #[test]
    fn weak_text_gate_appends_visual_segment_behind_text_head() {
        let docs = vec![
            seg_doc(
                "e1",
                "p1",
                1,
                SegmentType::Paragraph,
                "Unrelated introduction text.",
            ),
            seg_doc(
                "e1",
                "tab2",
                3,
                SegmentType::Table,
                "Latency at batch 32 is 4.2ms.",
            ),
        ];
        let segments = VisualPageSegments::from_documents(&docs);
        let text = results_from_hits(
            "batch 32 latency".to_string(),
            "hybrid".to_string(),
            1,
            vec![seg_hit(
                "e1",
                "p1",
                1,
                SegmentType::Paragraph,
                "Unrelated introduction text.",
                0.6,
            )],
            Vec::new(),
        );
        let (out, applied) = apply_within_paper_visual_evidence(
            text,
            &[parent("e1", 3, 0.92, Some(SegmentType::Table))],
            &segments,
            &["e1".to_string()],
            "batch 32 latency",
            None,
            &CarrierBinding::default(),
            &[],
            None,
            WithinPaperVisualOptions::default(),
        );
        assert!(applied);
        let hits = ordered_hits(&out);
        assert_eq!(hits.len(), 2);
        // Existing text hit stays #1; visually rescued table is appended at #2.
        assert_eq!(hits[0].snippet, "Unrelated introduction text.");
        assert!(hits[1].snippet.contains("4.2ms"));
    }

    #[test]
    fn drops_out_of_scope_visual_scores_and_respects_segment_type_filter() {
        let docs = vec![
            seg_doc("e1", "fig1", 2, SegmentType::Figure, "Figure 1 overview."),
            seg_doc("e2", "tab1", 2, SegmentType::Table, "Out of scope table."),
        ];
        let segments = VisualPageSegments::from_documents(&docs);
        let empty = results_from_hits(
            "show table".to_string(),
            "hybrid".to_string(),
            1,
            Vec::new(),
            Vec::new(),
        );
        let (out, applied) = apply_within_paper_visual_evidence(
            empty,
            &[
                parent("e2", 2, 0.99, Some(SegmentType::Table)),
                parent("e1", 2, 0.90, Some(SegmentType::Figure)),
            ],
            &segments,
            &["e1".to_string()],
            "show table",
            None,
            &parse_binding("show table"),
            &[SegmentType::Table],
            None,
            WithinPaperVisualOptions::default(),
        );
        assert!(!applied);
        assert!(ordered_hits(&out).is_empty());
    }

    #[test]
    fn cross_paper_visual_evidence_anchors_to_top_two_papers_and_ignores_tail_papers() {
        let docs = vec![
            seg_doc("e1", "p1", 1, SegmentType::Paragraph, "Paper 1 method overview."),
            seg_doc("e1", "fig1", 2, SegmentType::Figure, "Figure 1: Paper 1 accuracy curve."),
            seg_doc("e2", "p2", 1, SegmentType::Paragraph, "Paper 2 baseline setup."),
            seg_doc("e3", "fig3", 4, SegmentType::Figure, "Figure 3: Unrelated tail paper plot."),
        ];
        let segments = VisualPageSegments::from_documents(&docs);
        let text = results_from_hits(
            "What does the accuracy curve figure show?".to_string(),
            "hybrid".to_string(),
            1,
            vec![
                seg_hit("e1", "p1", 1, SegmentType::Paragraph, "Paper 1 method overview.", 0.95),
                seg_hit("e2", "p2", 1, SegmentType::Paragraph, "Paper 2 baseline setup.", 0.85),
            ],
            Vec::new(),
        );
        let question = "What does the accuracy curve figure show?";
        let (out, applied) = apply_within_paper_visual_evidence(
            text,
            &[
                parent("e3", 4, 0.99, Some(SegmentType::Figure)),
                parent("e1", 2, 0.82, Some(SegmentType::Figure)),
            ],
            &segments,
            &["e1".to_string(), "e2".to_string(), "e3".to_string()],
            question,
            None,
            &parse_binding(question),
            &[],
            None,
            WithinPaperVisualOptions::default(),
        );
        assert!(applied);
        let hits = ordered_hits(&out);
        assert!(hits
            .iter()
            .any(|hit| matches!(&hit.target, SearchTarget::Segment { segment_uid, .. } if segment_uid.as_str() == "fig1")));
        assert!(!hits
            .iter()
            .any(|hit| matches!(&hit.target, SearchTarget::Segment { segment_uid, .. } if segment_uid.as_str() == "fig3")));
    }

    #[test]
    fn generic_academic_words_do_not_count_as_visual_intent() {
        for question in [
            "What is the model architecture?",
            "How is the knowledge graph constructed?",
            "Which visual features are used?",
            "What does the accuracy curve show?",
            "曲线怎么变化",
            "可视化分析显示了什么",
        ] {
            assert!(
                !question_has_visual_intent(question, None, &parse_binding(question)),
                "{question}"
            );
        }
        for question in [
            "What does the architecture diagram show?",
            "What does Figure 4 show?",
            "见图中的架构图",
            "表格里的数值是多少",
        ] {
            assert!(
                question_has_visual_intent(question, None, &parse_binding(question)),
                "{question}"
            );
        }
    }

    #[test]
    fn weak_text_gate_inserts_out_of_pool_table_at_rank_nine() {
        let mut docs = Vec::new();
        let mut hits = Vec::new();
        for index in 0..12 {
            let uid = format!("p{index}");
            let snippet = format!("paragraph {index} about unrelated prose");
            docs.push(seg_doc(
                "e1",
                &uid,
                1,
                SegmentType::Paragraph,
                &snippet,
            ));
            hits.push(seg_hit(
                "e1",
                &uid,
                1,
                SegmentType::Paragraph,
                &snippet,
                1.0 - index as f32 * 0.01,
            ));
        }
        docs.push(seg_doc(
            "e1",
            "tab2",
            3,
            SegmentType::Table,
            "Latency at batch 32 is 4.2ms.",
        ));
        let segments = VisualPageSegments::from_documents(&docs);
        let text = results_from_hits(
            "batch 32 latency".to_string(),
            "hybrid".to_string(),
            1,
            hits.clone(),
            Vec::new(),
        );
        let (out, applied) = apply_within_paper_visual_evidence(
            text,
            &[parent("e1", 3, 0.92, Some(SegmentType::Table))],
            &segments,
            &["e1".to_string()],
            "batch 32 latency",
            None,
            &CarrierBinding::default(),
            &[],
            None,
            WithinPaperVisualOptions::default(),
        );
        assert!(applied);
        let ordered = ordered_hits(&out);
        assert_eq!(ordered.len(), 13);
        for index in 0..8 {
            assert_eq!(ordered[index].snippet, hits[index].snippet);
        }
        assert!(ordered[8].snippet.contains("4.2ms"));
        assert_eq!(ordered[9].snippet, hits[8].snippet);
        assert_eq!(ordered.last().unwrap().snippet, hits[11].snippet);
    }

    #[test]
    fn weak_text_gate_promotes_pool_tail_table_into_rank_nine() {
        let mut hits = Vec::new();
        for index in 0..11 {
            let uid = format!("p{index}");
            let snippet = format!("paragraph {index} about unrelated prose");
            hits.push(seg_hit(
                "e1",
                &uid,
                1,
                SegmentType::Paragraph,
                &snippet,
                1.0 - index as f32 * 0.01,
            ));
        }
        hits.push(seg_hit(
            "e1",
            "tab2",
            3,
            SegmentType::Table,
            "Latency at batch 32 is 4.2ms.",
            0.2,
        ));
        let text = results_from_hits(
            "batch 32 latency".to_string(),
            "hybrid".to_string(),
            1,
            hits.clone(),
            Vec::new(),
        );
        let (out, applied) = apply_within_paper_visual_evidence(
            text,
            &[parent("e1", 3, 0.92, Some(SegmentType::Table))],
            &VisualPageSegments::default(),
            &["e1".to_string()],
            "batch 32 latency",
            None,
            &CarrierBinding::default(),
            &[],
            None,
            WithinPaperVisualOptions::default(),
        );
        assert!(applied);
        let ordered = ordered_hits(&out);
        assert_eq!(ordered.len(), 12);
        for index in 0..8 {
            assert_eq!(ordered[index].snippet, hits[index].snippet);
        }
        assert!(ordered[8].snippet.contains("4.2ms"));
        assert_eq!(
            ordered
                .iter()
                .filter(|hit| hit.snippet.contains("4.2ms"))
                .count(),
            1
        );
    }

    #[test]
    fn supplement_moves_tail_and_out_of_pool_tables_into_the_rerank_window() {
        let mut hits = Vec::new();
        for index in 0..29 {
            hits.push(seg_hit(
                "e1",
                &format!("p{index}"),
                1,
                SegmentType::Paragraph,
                &format!("paragraph {index}"),
                1.0 - index as f32 * 0.01,
            ));
        }
        hits.push(seg_hit(
            "e1",
            "tab-tail",
            3,
            SegmentType::Table,
            "tail table",
            0.05,
        ));
        let promoted = supplement_hits_from_visual_pages(
            results_from_hits("q".to_string(), "hybrid".to_string(), 1, hits.clone(), Vec::new()),
            &[parent("e1", 3, 0.50, Some(SegmentType::Table))],
            &VisualPageSegments::default(),
            &["e1".to_string()],
            &[],
            None,
            25,
            4,
        );
        let ordered = ordered_hits(&promoted);
        assert_eq!(ordered.len(), 30);
        assert!(matches!(&ordered[24].target, SearchTarget::Segment { segment_uid, .. } if segment_uid.as_str() == "tab-tail"));
        for index in 0..24 {
            assert!(matches!(&ordered[index].target, SearchTarget::Segment { segment_uid, .. } if segment_uid.as_str() == format!("p{index}")));
        }

        let low = supplement_hits_from_visual_pages(
            results_from_hits("q".to_string(), "hybrid".to_string(), 1, hits.clone(), Vec::new()),
            &[parent("e1", 3, 0.21, Some(SegmentType::Table))],
            &VisualPageSegments::default(),
            &["e1".to_string()],
            &[],
            None,
            25,
            4,
        );
        let low_hits = ordered_hits(&low);
        assert!(matches!(&low_hits[29].target, SearchTarget::Segment { segment_uid, .. } if segment_uid.as_str() == "tab-tail"));

        let short_window = supplement_hits_from_visual_pages(
            results_from_hits("q".to_string(), "hybrid".to_string(), 1, hits, Vec::new()),
            &[parent("e1", 3, 0.90, Some(SegmentType::Table))],
            &VisualPageSegments::default(),
            &["e1".to_string()],
            &[],
            None,
            9,
            4,
        );
        let short_hits = ordered_hits(&short_window);
        assert!(matches!(&short_hits[29].target, SearchTarget::Segment { segment_uid, .. } if segment_uid.as_str() == "tab-tail"));

        let mut pool = Vec::new();
        let mut docs = Vec::new();
        for index in 0..30 {
            let uid = format!("p{index}");
            let snippet = format!("paragraph {index}");
            pool.push(seg_hit(
                "e1",
                &uid,
                1,
                SegmentType::Paragraph,
                &snippet,
                1.0 - index as f32 * 0.01,
            ));
            docs.push(seg_doc("e1", &uid, 1, SegmentType::Paragraph, &snippet));
        }
        docs.push(seg_doc(
            "e1",
            "tab-out",
            4,
            SegmentType::Table,
            "out of pool table",
        ));
        let rescued = supplement_hits_from_visual_pages(
            results_from_hits("q".to_string(), "hybrid".to_string(), 1, pool.clone(), Vec::new()),
            &[parent("e1", 4, 0.40, Some(SegmentType::Table))],
            &VisualPageSegments::from_documents(&docs),
            &["e1".to_string()],
            &[],
            None,
            25,
            4,
        );
        let rescued_hits = ordered_hits(&rescued);
        assert_eq!(rescued_hits.len(), 31);
        assert!(matches!(&rescued_hits[24].target, SearchTarget::Segment { segment_uid, .. } if segment_uid.as_str() == "tab-out"));
        for index in 0..24 {
            assert_eq!(rescued_hits[index].snippet, pool[index].snippet);
        }
    }

    fn uid_of(hit: &SearchHit) -> &str {
        match &hit.target {
            SearchTarget::Segment { segment_uid, .. } => segment_uid.as_str(),
            _ => "",
        }
    }

    fn with_gap(gap_z: f32) -> WithinPaperVisualOptions {
        WithinPaperVisualOptions {
            ce_confidence: Some(CeConfidence {
                top1_prob: 0.5,
                margin_prob: 0.1,
                top1_gap_z: gap_z,
            }),
            ..WithinPaperVisualOptions::default()
        }
    }

    fn apply_c(
        hits: Vec<SearchHit>,
        parents: &[ParentScore],
        segments: &VisualPageSegments,
        routed: &[&str],
        options: WithinPaperVisualOptions,
    ) -> (Vec<SearchHit>, bool) {
        let question = "optimizer learning rate schedule for adamw training runs";
        let (out, applied) = apply_within_paper_visual_evidence(
            results_from_hits(question.to_string(), "hybrid".to_string(), 1, hits, Vec::new()),
            parents,
            segments,
            &routed.iter().map(|entry| (*entry).to_string()).collect::<Vec<_>>(),
            question,
            None,
            &parse_binding(question),
            &[],
            None,
            options,
        );
        (ordered_hits(&out), applied)
    }

    #[test]
    fn ce_confidence_normalizes_raw_logits_and_keeps_calibrated_probs() {
        let logits = CeConfidence::from_raw_scores(&[2.0, 0.0]).unwrap();
        let top = 1.0 / (1.0 + (-2.0_f32).exp());
        let second = 1.0 / (1.0 + (-0.0_f32).exp());
        assert!((logits.top1_prob - top).abs() < 1e-5);
        assert!((logits.margin_prob - (top - second)).abs() < 1e-5);
        let calibrated = CeConfidence::from_raw_scores(&[0.90, 0.40]).unwrap();
        assert_eq!(calibrated.top1_prob, 0.90);
        assert_eq!(calibrated.margin_prob, (0.90_f32 - 0.40_f32).max(0.0));
        assert!(CeConfidence::from_raw_scores(&[]).is_none());
        assert!(CeConfidence::from_raw_scores(&[f32::NAN]).is_none());
        let only = CeConfidence::from_raw_scores(&[1.5]).unwrap();
        let only_prob = 1.0 / (1.0 + (-1.5_f32).exp());
        assert!((only.top1_prob - only_prob).abs() < 1e-5);
        assert_eq!(only.margin_prob, only.top1_prob);
        assert!(only.top1_gap_z.is_infinite());
        let base = [1.5_f32, 0.2, -0.4, -1.1];
        let shifted = base.map(|score| score + 3.7);
        let scaled = base.map(|score| score * 2.5 + 4.0);
        let shuffled = [-0.4_f32, 1.5, -1.1, 0.2];
        let gap = CeConfidence::from_raw_scores(&base).unwrap().top1_gap_z;
        assert!((CeConfidence::from_raw_scores(&shifted).unwrap().top1_gap_z - gap).abs() < 1e-4);
        assert!((CeConfidence::from_raw_scores(&scaled).unwrap().top1_gap_z - gap).abs() < 1e-4);
        assert!((CeConfidence::from_raw_scores(&shuffled).unwrap().top1_gap_z - gap).abs() < 1e-4);
        assert_eq!(
            CeConfidence::from_raw_scores(&[0.2, 0.2, 0.2])
                .unwrap()
                .top1_gap_z,
            0.0
        );
    }

    #[test]
    fn condition_c_locks_the_top_three_and_places_the_figure_at_rank_four_or_five() {
        let mut docs = vec![seg_doc(
            "e1",
            "p0",
            1,
            SegmentType::Paragraph,
            "optimizer learning rate schedule for adamw training runs",
        )];
        let mut hits = vec![seg_hit(
            "e1",
            "p0",
            1,
            SegmentType::Paragraph,
            "optimizer learning rate schedule for adamw training runs",
            0.95,
        )];
        for index in 1..5 {
            let uid = format!("p{index}");
            let snippet = format!("background paragraph {index}");
            docs.push(seg_doc("e1", &uid, 1, SegmentType::Paragraph, &snippet));
            hits.push(seg_hit(
                "e1",
                &uid,
                1,
                SegmentType::Paragraph,
                &snippet,
                0.8,
            ));
        }
        docs.push(seg_doc("e1", "fig", 4, SegmentType::Figure, "Figure 4 latency."));
        hits.push(seg_hit(
            "e1",
            "fig",
            4,
            SegmentType::Figure,
            "Figure 4 latency.",
            0.2,
        ));
        let segments = VisualPageSegments::from_documents(&docs);
        let (fused, applied) = apply_c(
            hits,
            &[parent("e1", 4, 0.80, Some(SegmentType::Figure))],
            &segments,
            &["e1"],
            with_gap(0.40),
        );
        assert!(applied);
        assert_eq!(uid_of(&fused[0]), "p0");
        assert_eq!(uid_of(&fused[1]), "p1");
        assert_eq!(uid_of(&fused[2]), "p2");
        let fig_at = fused.iter().position(|hit| uid_of(hit) == "fig").unwrap();
        assert!((3..5).contains(&fig_at), "figure landed at {fig_at}");
    }

    #[test]
    fn condition_c_high_confidence_pure_text_stays_strict_noop() {
        let docs = vec![
            seg_doc(
                "e1",
                "p1",
                1,
                SegmentType::Paragraph,
                "optimizer learning rate schedule for adamw training runs",
            ),
            seg_doc("e1", "fig", 4, SegmentType::Figure, "Figure 4 latency."),
        ];
        let segments = VisualPageSegments::from_documents(&docs);
        let hits = vec![
            seg_hit(
                "e1",
                "p1",
                1,
                SegmentType::Paragraph,
                "optimizer learning rate schedule for adamw training runs",
                0.9,
            ),
            seg_hit("e1", "fig", 4, SegmentType::Figure, "Figure 4 latency.", 0.4),
        ];
        let (fused, applied) = apply_c(
            hits,
            &[parent("e1", 4, 0.80, Some(SegmentType::Figure))],
            &segments,
            &["e1"],
            with_gap(2.0),
        );
        assert!(!applied);
        assert_eq!(uid_of(&fused[0]), "p1");
        assert_eq!(fused[0].score, 0.9);
    }

    #[test]
    fn condition_c_low_visual_cosine_stays_strict_noop() {
        let docs = vec![
            seg_doc(
                "e1",
                "p1",
                1,
                SegmentType::Paragraph,
                "optimizer learning rate schedule for adamw training runs",
            ),
            seg_doc("e1", "fig", 4, SegmentType::Figure, "Figure 4 latency."),
        ];
        let segments = VisualPageSegments::from_documents(&docs);
        let hits = vec![
            seg_hit(
                "e1",
                "p1",
                1,
                SegmentType::Paragraph,
                "optimizer learning rate schedule for adamw training runs",
                0.9,
            ),
            seg_hit("e1", "p2", 1, SegmentType::Paragraph, "background paragraph", 0.5),
            seg_hit("e1", "p3", 1, SegmentType::Paragraph, "another paragraph", 0.4),
            seg_hit("e1", "fig", 4, SegmentType::Figure, "Figure 4 latency.", 0.2),
        ];
        let (fused, applied) = apply_c(
            hits,
            &[parent("e1", 4, 0.25, Some(SegmentType::Figure))],
            &segments,
            &["e1"],
            with_gap(0.40),
        );
        assert!(!applied);
        assert_eq!(uid_of(&fused[0]), "p1");
        assert_eq!(fused[0].score, 0.9);
    }

    #[test]
    fn condition_c_applies_anchor_paper_rank_decay_across_two_papers() {
        let overlap = "optimizer learning rate schedule for adamw training runs";
        let docs = vec![
            seg_doc("a", "pa", 1, SegmentType::Paragraph, overlap),
            seg_doc("b", "pb", 1, SegmentType::Paragraph, "paper b background paragraph"),
            seg_doc("b", "figb", 2, SegmentType::Figure, "Figure B curve."),
            seg_doc("a", "fill", 1, SegmentType::Paragraph, "extra filler paragraph"),
            seg_doc("a", "figa", 4, SegmentType::Figure, "Figure A curve."),
        ];
        let segments = VisualPageSegments::from_documents(&docs);
        let hits = vec![
            seg_hit("a", "pa", 1, SegmentType::Paragraph, overlap, 0.95),
            seg_hit(
                "b",
                "pb",
                1,
                SegmentType::Paragraph,
                "paper b background paragraph",
                0.9,
            ),
            seg_hit(
                "a",
                "fill",
                1,
                SegmentType::Paragraph,
                "extra filler paragraph",
                0.8,
            ),
            seg_hit("b", "figb", 2, SegmentType::Figure, "Figure B curve.", 0.5),
            seg_hit("a", "figa", 4, SegmentType::Figure, "Figure A curve.", 0.3),
        ];
        let (fused, applied) = apply_c(
            hits,
            &[
                parent("a", 4, 0.70, Some(SegmentType::Figure)),
                parent("b", 2, 0.90, Some(SegmentType::Figure)),
            ],
            &segments,
            &["a", "b"],
            with_gap(0.40),
        );
        assert!(applied);
        assert_eq!(uid_of(&fused[0]), "pa");
        assert_eq!(uid_of(&fused[1]), "pb");
        assert_eq!(uid_of(&fused[2]), "fill");
        let fig_a = fused.iter().position(|hit| uid_of(hit) == "figa").unwrap();
        let fig_b = fused.iter().position(|hit| uid_of(hit) == "figb").unwrap();
        assert!(fig_a < fig_b, "fig A at {fig_a}, fig B at {fig_b}");
    }
}
