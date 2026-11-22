//! Within-paper visual sidecar evidence fusion (Direction C).
//!
//! Reuses the `ParentScore`s already produced by `visual.recall()` during unified
//! routing (zero extra visual-encoder calls). Under a gold-free dual gate:
//! - Explicit visual/figure/table intent (Condition A): rescues unrecalled Figure/Table
//!   segments on the top visually-matched pages and fuses them with text hits via RRF.
//! - Weak text overlap (Condition B): preserves the text head order and safely appends
//!   visually-matched page/figure/table segments behind it.
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
const SNIPPET_CHAR_LIMIT: usize = 320;

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
                entry_id,
                page_idx,
                ..
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
}

/// Configuration for within-paper visual evidence fusion.
#[derive(Clone, Copy, Debug)]
pub struct WithinPaperVisualOptions {
    pub text_weight: f32,
    pub visual_weight: f32,
    pub rrf_k: f32,
    pub max_snippet_overlap: usize,
}

impl Default for WithinPaperVisualOptions {
    fn default() -> Self {
        Self {
            text_weight: 1.0,
            visual_weight: 0.5,
            rrf_k: crate::DEFAULT_RRF_K,
            max_snippet_overlap: 2,
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
    text_has_visual_intent(question)
        || english_question.is_some_and(text_has_visual_intent)
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
        "曲线",
        "可视化",
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
        "graph",
        "graphs",
        "curve",
        "curves",
        "flowchart",
        "heatmap",
        "histogram",
        "screenshot",
        "visual",
        "visualization",
        "architecture",
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

/// Applies gold-free gated within-paper visual evidence fusion before Stage-2/3 reranking.
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
    let page_votes = top_visual_pages(visual_parents, routed_documents);
    if page_votes.is_empty() {
        return (results, false);
    }

    let text_hits = ordered_hits(&results);
    let visual_intent = question_has_visual_intent(question, english_question, binding);
    let weak_text = text_hits.is_empty()
        || max_head_overlap(&text_hits, question, english_question) <= options.max_snippet_overlap;
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

    let query = results.query.clone();
    let mode = results.mode.clone();
    let generation = results.index_generation;
    let warnings = results.warnings.clone();

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

    // Condition B (weak text overlap or empty text hits): preserve existing text head order
    // and safely append unseen visually-matched Figure/Table/page segments behind it.
    let mut seen = BTreeSet::new();
    let mut combined = Vec::with_capacity(text_hits.len() + visual_candidates.len());
    let mut min_score = f32::INFINITY;
    for hit in text_hits {
        seen.insert(hit_identity(&hit));
        if hit.score.is_finite() {
            min_score = min_score.min(hit.score);
        }
        combined.push(hit);
    }
    let base_tail = if min_score.is_finite() {
        (min_score - 1e-4).min(min_score * 0.99)
    } else {
        0.5
    };
    let mut appended = 0usize;
    for (idx, mut hit) in visual_candidates.into_iter().enumerate() {
        let key = hit_identity(&hit);
        if !seen.insert(key) {
            continue;
        }
        hit.score = base_tail - (idx as f32 + 1.0) * 1e-4;
        combined.push(hit);
        appended += 1;
    }
    if appended == 0 {
        return (results, false);
    }
    (
        results_from_hits(query, mode, generation, combined, warnings),
        true,
    )
}

fn top_visual_pages(
    visual_parents: &[ParentScore],
    routed_documents: &[String],
) -> Vec<VisualPageVote> {
    let mut by_page: HashMap<(String, u32), VisualPageVote> = HashMap::new();
    for parent in visual_parents {
        if !parent.score.is_finite() {
            continue;
        }
        if !routed_documents
            .iter()
            .any(|allowed| allowed == &parent.entry_id)
        {
            continue;
        }
        let Some(page_idx) = parent.page_idx else {
            continue;
        };
        let key = (parent.entry_id.clone(), page_idx);
        match by_page.get_mut(&key) {
            Some(existing) => {
                if parent.score > existing.score {
                    existing.score = parent.score;
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
                        score: parent.score,
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
    let mut chars = joined.chars();
    let clipped: String = chars.by_ref().take(SNIPPET_CHAR_LIMIT).collect();
    if chars.next().is_some() {
        format!("{}...", clipped.trim_end())
    } else {
        clipped
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::carrier_binding::parse_binding;
    use crate::{SearchDocumentSource, SearchTextSection};
    use neuink_domain::{EntryId, SegmentUid};

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
    fn pure_text_strong_overlap_query_stays_strict_noop() {
        let docs = vec![
            seg_doc("e1", "p1", 1, SegmentType::Paragraph, "AdamW optimizer learning rate schedule."),
            seg_doc("e1", "fig4", 4, SegmentType::Figure, "Figure 4: latency curve."),
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
            seg_doc("e1", "p1", 1, SegmentType::Paragraph, "We compare model architectures."),
            seg_doc("e1", "fig4", 4, SegmentType::Figure, "Figure 4: Encoder-decoder architecture."),
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
            seg_doc("e1", "p1", 1, SegmentType::Paragraph, "Unrelated introduction text."),
            seg_doc("e1", "tab2", 3, SegmentType::Table, "Latency at batch 32 is 4.2ms."),
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
}
