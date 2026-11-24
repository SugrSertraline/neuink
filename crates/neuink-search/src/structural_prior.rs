//! Clean structural tagging and zero-API soft demotion (`B0-sec-soft`).
//!
//! Validated in `single-paper-precision-v3`:
//! - Formatting candidate passages with `[Section: <path>] [Type: <type>]` and NO
//!   neighboring paragraphs eliminates successor-paragraph leakage while giving
//!   rerankers structural awareness (`Q0-inst-struct`: +8.24pp P@1, +5.50pp P@3).
//! - Softly demoting `Abstract`/`Front matter` (`x0.80`) when the query lacks summary
//!   intent and short bare `Heading` units (`x0.85`) yields +2.87pp P@1 at zero API cost.

use neuink_domain::{CanonicalSectionRole, SegmentType};

use crate::{stamp_rank_scores, SearchHit};

const ABSTRACT_SOFT_WEIGHT: f32 = 0.80;
const SHORT_HEADING_SOFT_WEIGHT: f32 = 0.85;
const RELATED_WORK_SOFT_WEIGHT: f32 = 0.85;
const SHORT_HEADING_MAX_CHARS: usize = 120;

/// Strips an embedding-style `passage: ...` first header line if present.
/// Never reads or appends neighboring paragraphs.
pub fn strip_passage_header(text: &str) -> &str {
    let trimmed = text.trim_start();
    if let Some((first, rest)) = trimmed.split_once('\n') {
        if first.trim_start().starts_with("passage:") {
            return rest.trim_start();
        }
    }
    text.trim()
}

fn segment_type_label(segment_type: SegmentType) -> &'static str {
    match segment_type {
        SegmentType::Paragraph => "Paragraph",
        SegmentType::Heading => "Heading",
        SegmentType::Table => "Table",
        SegmentType::Math => "Math",
        SegmentType::Figure => "Figure",
        SegmentType::Code => "Code",
        SegmentType::List => "List",
        SegmentType::PageHeader => "PageHeader",
        SegmentType::PageFooter => "PageFooter",
        SegmentType::PageNumber => "PageNumber",
        SegmentType::AsideText => "AsideText",
        SegmentType::PageFootnote => "PageFootnote",
    }
}

fn section_label(hit: &SearchHit) -> Option<String> {
    if let Some(path) = hit
        .source
        .section_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(path.to_string());
    }
    match hit.source.section_role {
        Some(CanonicalSectionRole::Other) | None => None,
        Some(role) => Some(role.as_str().replace('_', " ")),
    }
}

/// Formats one hit with clean `[Section: ...]` / `[Type: ...]` tags and its own body only.
/// Hits without structural metadata keep their cleaned body unchanged.
pub fn format_structured_hit(hit: &SearchHit) -> String {
    let body = strip_passage_header(&hit.snippet);
    let section = section_label(hit);
    let seg_type = hit.source.segment_type.map(segment_type_label);
    match (section, seg_type) {
        (Some(sec), Some(kind)) => format!("[Section: {sec}] [Type: {kind}]\n{body}"),
        (Some(sec), None) => format!("[Section: {sec}]\n{body}"),
        (None, Some(kind)) => format!("[Type: {kind}]\n{body}"),
        (None, None) => body.to_string(),
    }
}

/// Returns true when at least two hits exist and all share a single entry ID.
pub fn is_single_paper_hits(hits: &[SearchHit]) -> bool {
    let Some(first) = hits.first() else {
        return false;
    };
    hits.len() >= 2 && hits.iter().all(|hit| hit.entry_id == first.entry_id)
}

/// Returns true when the user query explicitly asks for a paper summary / overview / abstract.
pub fn query_has_summary_intent(query: &str) -> bool {
    let lower = query.to_ascii_lowercase();
    const EN_PHRASES: &[&str] = &[
        "main contribution",
        "what is this paper about",
        "what does this paper do",
        "what did this paper do",
        "goal of this paper",
        "purpose of this paper",
        "paper summary",
    ];
    if EN_PHRASES.iter().any(|phrase| lower.contains(phrase)) {
        return true;
    }
    const EN_WORDS: &[&str] = &[
        "abstract",
        "summary",
        "summarize",
        "overview",
        "contribution",
        "contributions",
    ];
    if lower
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .any(|word| EN_WORDS.contains(&word))
    {
        return true;
    }
    const ZH_PHRASES: &[&str] = &[
        "摘要",
        "总结",
        "概述",
        "主要贡献",
        "核心贡献",
        "主要内容",
        "核心内容",
        "核心思想",
        "整体思路",
        "研究目的",
        "研究内容",
        "讲了什么",
        "写了什么",
        "做了什么",
        "干什么",
        "干了什么",
        "介绍了什么",
        "整篇论文",
        "全文总结",
    ];
    ZH_PHRASES.iter().any(|phrase| query.contains(phrase))
}

/// Returns true when the query asks about related work, baselines, or comparisons.
pub fn query_has_related_work_intent(query: &str) -> bool {
    let lower = query.to_ascii_lowercase();
    const EN_PHRASES: &[&str] = &[
        "related work",
        "prior work",
        "previous work",
        "existing work",
        "existing methods",
        "other methods",
        "state of the art",
    ];
    if EN_PHRASES.iter().any(|phrase| lower.contains(phrase)) {
        return true;
    }
    const EN_WORDS: &[&str] = &[
        "literature",
        "baseline",
        "baselines",
        "compare",
        "compared",
        "comparison",
        "sota",
    ];
    if lower
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .any(|word| EN_WORDS.contains(&word))
    {
        return true;
    }
    const ZH_PHRASES: &[&str] = &[
        "相关工作",
        "前人",
        "已有方法",
        "现有方法",
        "文献综述",
        "基线",
        "对比",
        "比较",
    ];
    ZH_PHRASES.iter().any(|phrase| query.contains(phrase))
}

fn is_related_work(hit: &SearchHit) -> bool {
    if hit.source.section_role == Some(CanonicalSectionRole::RelatedWork) {
        return true;
    }
    let Some(path) = hit.source.section_path.as_deref() else {
        return false;
    };
    let lower = path.trim().to_ascii_lowercase();
    lower == "related work"
        || lower.starts_with("related work ")
        || lower.starts_with("related work:")
        || lower.starts_with("related work/")
}

fn is_abstract_or_front_matter(hit: &SearchHit) -> bool {
    if matches!(
        hit.source.section_role,
        Some(CanonicalSectionRole::Abstract | CanonicalSectionRole::FrontMatter)
    ) {
        return true;
    }
    let Some(path) = hit.source.section_path.as_deref() else {
        return false;
    };
    let lower = path.trim().to_ascii_lowercase();
    lower == "abstract"
        || lower.starts_with("abstract ")
        || lower.starts_with("abstract:")
        || lower.starts_with("abstract/")
        || lower == "front matter"
        || lower.starts_with("front matter ")
        || lower.starts_with("front matter:")
        || lower.starts_with("front matter/")
}

fn is_short_heading(hit: &SearchHit) -> bool {
    hit.source.segment_type == Some(SegmentType::Heading)
        && strip_passage_header(&hit.snippet).chars().count() < SHORT_HEADING_MAX_CHARS
}

fn sigmoid(value: f32) -> f32 {
    1.0 / (1.0 + (-value).exp())
}

fn apply_structural_soft_demotion_slice(
    hits: &[SearchHit],
    query: &str,
    single_paper: bool,
    demote_related_work: bool,
) -> Vec<SearchHit> {
    if hits.len() <= 1 {
        return hits.to_vec();
    }
    // Abstract/FrontMatter demotion (0.80x) is proven on single-paper Q&A (+4.50pp P@1 on
    // confirm200), whereas across multiple papers an abstract is often the primary document
    // selection signal (unconditional demotion caused -7.42pp R@10 on MultiHopRAG and
    // -1.50pp nDCG@10 on DAPR). Bare short headings (0.85x) are demoted in both scopes.
    // The 0.85 Related Work coefficient is single-paper only. Product callers pass
    // `demote_related_work = false`: on QASPER-83 ordinary_40 it dropped P@1 from
    // 0.3750 to 0.3500 and nDCG@10 from 0.4932 to 0.4630.
    let demote_abstract = single_paper && !query_has_summary_intent(query);
    let demote_related =
        single_paper && demote_related_work && !query_has_related_work_intent(query);
    let has_target = hits.iter().any(|hit| {
        (demote_abstract && is_abstract_or_front_matter(hit))
            || (demote_related && is_related_work(hit))
            || is_short_heading(hit)
    });
    if !has_target {
        return hits.to_vec();
    }
    let needs_sigmoid = hits
        .iter()
        .any(|hit| !hit.score.is_finite() || hit.score < 0.0 || hit.score > 1.0);
    let mut scored = hits
        .iter()
        .enumerate()
        .map(|(index, hit)| {
            let base = if !hit.score.is_finite() {
                0.0
            } else if needs_sigmoid {
                sigmoid(hit.score)
            } else {
                hit.score
            };
            let mut weight = 1.0_f32;
            if demote_abstract && is_abstract_or_front_matter(hit) {
                weight *= ABSTRACT_SOFT_WEIGHT;
            }
            if demote_related && is_related_work(hit) {
                weight *= RELATED_WORK_SOFT_WEIGHT;
            }
            if is_short_heading(hit) {
                weight *= SHORT_HEADING_SOFT_WEIGHT;
            }
            (index, base * weight)
        })
        .collect::<Vec<_>>();
    scored.sort_by(|left, right| {
        right
            .1
            .total_cmp(&left.1)
            .then_with(|| left.0.cmp(&right.0))
    });
    let mut ordered = scored
        .into_iter()
        .map(|(index, _)| hits[index].clone())
        .collect::<Vec<_>>();
    stamp_rank_scores(&mut ordered);
    ordered
}

/// Applies the zero-API `B0-sec-soft` prior. Preserves upstream order on ties, leaves
/// single-paper queries asking for an abstract/overview untouched, and avoids demoting
/// abstracts on cross-paper whole-library results.
pub fn apply_structural_soft_demotion(hits: &[SearchHit], query: &str) -> Vec<SearchHit> {
    apply_structural_soft_demotion_slice(hits, query, is_single_paper_hits(hits), false)
}

/// Applies `B0-sec-soft` strictly within the scored prefix `hits[..head]` and keeps the
/// unscored tail `hits[head..]` below it, then stamps consistent descending rank scores
/// across the full slice.
///
/// Use this after a partial-head reranker (such as `rerank_hits_with_provider_raw`) whose
/// head carries raw cross-encoder logits (often negative) while the tail still holds
/// positive Stage-1 fusion scores. Running full-slice `apply_structural_soft_demotion`
/// across mixed score scales would let unscored tail hits leapfrog negative-logit head hits.
pub fn apply_structural_soft_demotion_head(
    hits: &[SearchHit],
    query: &str,
    head: usize,
) -> Vec<SearchHit> {
    apply_structural_soft_demotion_head_with_related(hits, query, head, false)
}

/// Same head-scoped `B0-sec-soft` pass, with single-paper Related Work demotion optional.
///
/// `demote_related_work == false` keeps the abstract and short-heading rules and skips
/// the 0.85 Related Work coefficient. Multi-paper lists never apply that coefficient.
pub fn apply_structural_soft_demotion_head_with_related(
    hits: &[SearchHit],
    query: &str,
    head: usize,
    demote_related_work: bool,
) -> Vec<SearchHit> {
    let bound = head.min(hits.len());
    let single_paper = is_single_paper_hits(hits);
    let mut combined = if bound <= 1 {
        hits.to_vec()
    } else {
        let mut head_ordered = apply_structural_soft_demotion_slice(
            &hits[..bound],
            query,
            single_paper,
            demote_related_work,
        );
        head_ordered.extend_from_slice(&hits[bound..]);
        head_ordered
    };
    stamp_rank_scores(&mut combined);
    combined
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::result::{SearchDocumentSource, SearchTarget};
    use neuink_domain::{EntryId, SegmentUid};

    fn seg_hit(
        entry: &str,
        uid: &str,
        section: Option<&str>,
        role: Option<CanonicalSectionRole>,
        seg_type: Option<SegmentType>,
        snippet: &str,
        score: f32,
    ) -> SearchHit {
        SearchHit {
            entry_id: EntryId::from_string(entry),
            entry_title: "Paper".into(),
            source: SearchDocumentSource {
                section_path: section.map(str::to_string),
                section_role: role,
                segment_type: seg_type,
                ..SearchDocumentSource::default()
            },
            target: SearchTarget::Segment {
                entry_id: EntryId::from_string(entry),
                segment_uid: SegmentUid::from_string(uid),
                page_idx: 0,
            },
            title: "Paper".into(),
            snippet: snippet.into(),
            score,
            matched_terms: Vec::new(),
            surrounding_context: None,
        }
    }

    #[test]
    fn structured_format_strips_passage_header_and_tags_section_and_type() {
        let hit = seg_hit(
            "e1",
            "s1",
            Some("Experiments ::: Datasets"),
            Some(CanonicalSectionRole::Experiments),
            Some(SegmentType::Paragraph),
            "passage: Paper Title | Experiments | text | pages 1-1\nWe evaluate on 120,000 tweets.",
            0.9,
        );
        let formatted = format_structured_hit(&hit);
        assert_eq!(
            formatted,
            "[Section: Experiments ::: Datasets] [Type: Paragraph]\nWe evaluate on 120,000 tweets."
        );
        assert!(!formatted.contains("passage:"));
    }

    #[test]
    fn structured_format_leaves_untagged_hits_plain() {
        let hit = seg_hit("e1", "s1", None, None, None, "Plain note body", 0.5);
        assert_eq!(format_structured_hit(&hit), "Plain note body");
    }

    #[test]
    fn soft_demotion_pushes_abstract_and_short_heading_below_evidence() {
        let hits = vec![
            seg_hit(
                "e1",
                "s1",
                Some("Abstract"),
                Some(CanonicalSectionRole::Abstract),
                Some(SegmentType::Paragraph),
                "We study sarcasm detection.",
                0.90,
            ),
            seg_hit(
                "e1",
                "s2",
                Some("Dataset"),
                Some(CanonicalSectionRole::Experiments),
                Some(SegmentType::Heading),
                "Dataset",
                0.85,
            ),
            seg_hit(
                "e1",
                "s3",
                Some("Dataset"),
                Some(CanonicalSectionRole::Experiments),
                Some(SegmentType::Paragraph),
                "The dataset contains 120,000 tweets.",
                0.80,
            ),
        ];
        let reordered = apply_structural_soft_demotion(&hits, "What dataset size was used?");
        assert_eq!(reordered[0].snippet, "The dataset contains 120,000 tweets.");
    }

    #[test]
    fn soft_demotion_respects_english_and_chinese_summary_intent() {
        let hits = vec![
            seg_hit(
                "e1",
                "s1",
                Some("Abstract"),
                Some(CanonicalSectionRole::Abstract),
                Some(SegmentType::Paragraph),
                "Paper abstract.",
                0.90,
            ),
            seg_hit(
                "e1",
                "s2",
                Some("Results"),
                Some(CanonicalSectionRole::Results),
                Some(SegmentType::Paragraph),
                "Table 1 shows 91.2 F1.",
                0.80,
            ),
        ];
        assert_eq!(
            apply_structural_soft_demotion(&hits, "Give an overview of the main contribution")[0]
                .snippet,
            "Paper abstract."
        );
        assert_eq!(
            apply_structural_soft_demotion(&hits, "这篇论文的主要贡献是什么")[0].snippet,
            "Paper abstract."
        );
        assert_eq!(
            apply_structural_soft_demotion(&hits, "整篇论文干什么了")[0].snippet,
            "Paper abstract."
        );
        assert_eq!(
            apply_structural_soft_demotion(&hits, "What does this paper do?")[0].snippet,
            "Paper abstract."
        );
    }

    #[test]
    fn soft_demotion_handles_negative_logits_via_sigmoid() {
        let hits = vec![
            seg_hit(
                "e1",
                "s1",
                Some("Abstract"),
                Some(CanonicalSectionRole::Abstract),
                Some(SegmentType::Paragraph),
                "Abstract preview",
                2.0,
            ),
            seg_hit(
                "e1",
                "s2",
                Some("Experiments"),
                Some(CanonicalSectionRole::Experiments),
                Some(SegmentType::Paragraph),
                "Concrete experiment",
                1.5,
            ),
        ];
        let reordered = apply_structural_soft_demotion(&hits, "What baselines were evaluated?");
        assert_eq!(reordered[0].snippet, "Concrete experiment");
    }

    #[test]
    fn soft_demotion_head_never_lets_positive_tail_leapfrog_negative_head_logits() {
        let hits = vec![
            seg_hit(
                "e1",
                "h1",
                Some("Abstract"),
                Some(CanonicalSectionRole::Abstract),
                Some(SegmentType::Paragraph),
                "Abstract head hit",
                -1.0,
            ),
            seg_hit(
                "e1",
                "h2",
                Some("Experiments"),
                Some(CanonicalSectionRole::Experiments),
                Some(SegmentType::Paragraph),
                "Evidence head hit",
                -1.2,
            ),
            seg_hit(
                "e1",
                "h3",
                Some("Results"),
                Some(CanonicalSectionRole::Results),
                Some(SegmentType::Paragraph),
                "Negative logit head hit",
                -4.5,
            ),
            seg_hit(
                "e1",
                "t1",
                Some("Introduction"),
                Some(CanonicalSectionRole::Introduction),
                Some(SegmentType::Paragraph),
                "Unscored Stage-1 RRF tail hit",
                0.025,
            ),
        ];
        let reordered =
            apply_structural_soft_demotion_head(&hits, "What baselines were evaluated?", 3);
        assert_eq!(reordered[0].snippet, "Evidence head hit");
        assert_eq!(reordered[1].snippet, "Abstract head hit");
        assert_eq!(reordered[2].snippet, "Negative logit head hit");
        assert_eq!(reordered[3].snippet, "Unscored Stage-1 RRF tail hit");
        assert!(reordered[2].score > reordered[3].score);

        // Summary-intent query keeps head order and still normalizes raw negative logits.
        let summary =
            apply_structural_soft_demotion_head(&hits, "What is the main contribution?", 3);
        assert_eq!(summary[0].snippet, "Abstract head hit");
        assert_eq!(summary[3].snippet, "Unscored Stage-1 RRF tail hit");
        assert!(summary.windows(2).all(|w| w[0].score > w[1].score));
    }

    #[test]
    fn single_paper_detection_requires_at_least_two_hits_from_one_entry() {
        let one = vec![seg_hit("e1", "s1", None, None, None, "a", 1.0)];
        let same = vec![
            seg_hit("e1", "s1", None, None, None, "a", 1.0),
            seg_hit("e1", "s2", None, None, None, "b", 0.9),
        ];
        let mixed = vec![
            seg_hit("e1", "s1", None, None, None, "a", 1.0),
            seg_hit("e2", "s2", None, None, None, "b", 0.9),
        ];
        assert!(!is_single_paper_hits(&one));
        assert!(is_single_paper_hits(&same));
        assert!(!is_single_paper_hits(&mixed));
    }

    #[test]
    fn cross_paper_soft_demotion_keeps_abstracts_and_demotes_only_short_headings() {
        let hits = vec![
            seg_hit(
                "paper-a",
                "s1",
                Some("Abstract"),
                Some(CanonicalSectionRole::Abstract),
                Some(SegmentType::Paragraph),
                "Paper A abstract directly answering the cross-paper query.",
                0.90,
            ),
            seg_hit(
                "paper-b",
                "s2",
                Some("Results"),
                Some(CanonicalSectionRole::Results),
                Some(SegmentType::Heading),
                "Results",
                0.85,
            ),
            seg_hit(
                "paper-b",
                "s3",
                Some("Results"),
                Some(CanonicalSectionRole::Results),
                Some(SegmentType::Paragraph),
                "Paper B reports 92.1% accuracy.",
                0.80,
            ),
        ];
        let reordered = apply_structural_soft_demotion(&hits, "What accuracy is reported?");
        assert_eq!(reordered[0].entry_id.as_str(), "paper-a");
        assert_eq!(reordered[1].snippet, "Paper B reports 92.1% accuracy.");
        assert_eq!(reordered[2].snippet, "Results");
    }

    fn related_pair(related_score: f32, evidence_score: f32) -> Vec<SearchHit> {
        vec![
            seg_hit(
                "e1",
                "rw",
                Some("Related Work"),
                Some(CanonicalSectionRole::RelatedWork),
                Some(SegmentType::Paragraph),
                "Smith et al. studied a similar task.",
                related_score,
            ),
            seg_hit(
                "e1",
                "exp",
                Some("Experiments"),
                Some(CanonicalSectionRole::Experiments),
                Some(SegmentType::Paragraph),
                "Our model reaches 91.4 F1.",
                evidence_score,
            ),
        ]
    }

    #[test]
    fn single_paper_related_work_stays_on_the_product_path() {
        let hits = related_pair(0.90, 0.80);
        let product = apply_structural_soft_demotion(&hits, "What F1 does the model reach?");
        assert_eq!(product[0].snippet, "Smith et al. studied a similar task.");
        let demoted = apply_structural_soft_demotion_head_with_related(
            &hits,
            "What F1 does the model reach?",
            hits.len(),
            true,
        );
        assert_eq!(demoted[0].snippet, "Our model reaches 91.4 F1.");
        let exempt = apply_structural_soft_demotion_head_with_related(
            &hits,
            "How does this compare to prior work?",
            hits.len(),
            true,
        );
        assert_eq!(exempt[0].snippet, "Smith et al. studied a similar task.");
        let zh = apply_structural_soft_demotion_head_with_related(
            &hits,
            "和前人工作对比如何",
            hits.len(),
            true,
        );
        assert_eq!(zh[0].snippet, "Smith et al. studied a similar task.");
    }

    #[test]
    fn multi_paper_related_work_is_not_demoted() {
        let mut hits = related_pair(0.90, 0.80);
        hits[1].entry_id = EntryId::from_string("e2");
        let ordered = apply_structural_soft_demotion(&hits, "What F1 does the model reach?");
        assert_eq!(ordered[0].snippet, "Smith et al. studied a similar task.");
    }
}
