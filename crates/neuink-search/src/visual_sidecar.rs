//! Visual channel for the retrieval sidecar.
//!
//! Measured basis (DocVQA500, 500 queries x 500 pages, official split): a visual
//! channel is only useful when a page votes once. Collapsing the four region
//! crops into their page with `max(page, best region)` before fusion took
//! single-channel R@10 from 0.268 (page only) to 0.344 (region) and 0.340
//! (parent), and the two-way RRF with the text channel reached 0.380 while the
//! union of both channels covered 0.648 of gold pages. Feeding page and region
//! as separate votes was never measured and would double-count one page.
//!
//! So this module keeps the aggregation and the fusion rule, and leaves the
//! encoder behind a trait: a provider is either ready or reports why it is not,
//! and an unavailable channel degrades to text instead of silently returning
//! nothing.

use neuink_domain::SegmentType;
use serde::{Deserialize, Serialize};

use crate::{weighted_reciprocal_rank_fusion, SearchResult};

/// One scored visual asset. `region` is `Some` for a crop and `None` for the
/// whole page; both collapse into the same parent before fusion.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VisualScore {
    pub entry_id: String,
    /// Page or asset identity inside the entry. Crops of one page share it.
    pub parent_id: String,
    pub region: Option<u32>,
    pub score: f32,
    /// Zero-based PDF page index of this visual source when known.
    #[serde(default)]
    pub page_idx: Option<u32>,
    /// Asset segment type (`Figure` / `Table`) for MinerU visual crops; `None` for full pages.
    #[serde(default)]
    pub segment_type: Option<SegmentType>,
}

/// One vote per parent, after region collapse.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ParentScore {
    pub entry_id: String,
    pub parent_id: String,
    pub score: f32,
    #[serde(default)]
    pub page_idx: Option<u32>,
    #[serde(default)]
    pub segment_type: Option<SegmentType>,
}

impl ParentScore {
    /// Stable identity used for fusion, independent of score scale.
    pub fn key(&self) -> String {
        format!("{}\u{1f}{}", self.entry_id, self.parent_id)
    }
}

/// Readiness of the visual channel. `Unavailable` is a normal state on a machine
/// without the model or the index, and must degrade rather than fail the query.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum VisualChannelStatus {
    /// The caller turned the channel off. Also the default: a product without a
    /// visual index must not claim one.
    #[default]
    Disabled,
    /// Index and encoder are ready.
    Ready,
    /// A fixed, path-free reason the channel cannot run.
    Unavailable(&'static str),
}

impl VisualChannelStatus {
    pub fn is_ready(self) -> bool {
        matches!(self, Self::Ready)
    }

    /// Fixed code recorded in the output when the channel did not run.
    pub fn degradation_code(self) -> Option<&'static str> {
        match self {
            Self::Disabled => Some("visual_disabled"),
            Self::Unavailable(_) => Some("visual_unavailable"),
            Self::Ready => None,
        }
    }
}

/// Encoder plus index. Implementations own their model and cached vectors; the
/// pipeline only needs query-time ranking inside an allowed entry set.
pub trait VisualRecall {
    fn status(&self) -> VisualChannelStatus;

    /// `entries` is the already-frozen allowed set. An empty slice means no
    /// visual search at all, never "the whole library".
    fn recall(
        &mut self,
        question: &str,
        entries: &[String],
        limit: usize,
    ) -> SearchResult<Vec<VisualScore>>;
}

/// Maximum of a parent's own page score and its best crop score, one entry per
/// parent. Order is descending score, then identity, so equal scores never drift
/// with input order. Non-finite scores are dropped rather than ranked.
pub fn aggregate_parents(scores: &[VisualScore]) -> Vec<ParentScore> {
    let mut parents: Vec<ParentScore> = Vec::new();
    for score in scores {
        if !score.score.is_finite() || score.parent_id.trim().is_empty() {
            continue;
        }
        let resolved_page = score.page_idx.or_else(|| {
            score
                .parent_id
                .strip_prefix("page:")
                .and_then(|raw| raw.parse::<u32>().ok())
        });
        match parents
            .iter_mut()
            .find(|parent| parent.entry_id == score.entry_id && parent.parent_id == score.parent_id)
        {
            Some(existing) => {
                if score.score > existing.score {
                    existing.score = score.score;
                }
                if existing.page_idx.is_none() {
                    existing.page_idx = resolved_page;
                }
                if existing.segment_type.is_none() {
                    existing.segment_type = score.segment_type;
                }
            }
            None => parents.push(ParentScore {
                entry_id: score.entry_id.clone(),
                parent_id: score.parent_id.clone(),
                score: score.score,
                page_idx: resolved_page,
                segment_type: score.segment_type,
            }),
        }
    }
    parents.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.entry_id.cmp(&right.entry_id))
            .then_with(|| left.parent_id.cmp(&right.parent_id))
    });
    parents
}

/// Entry order implied by a parent ranking: one entry per first appearance.
pub fn parent_entry_order(parents: &[ParentScore], limit: usize) -> Vec<String> {
    let mut entries: Vec<String> = Vec::new();
    for parent in parents.iter().take(limit) {
        if entries.iter().any(|seen| seen == &parent.entry_id) {
            continue;
        }
        entries.push(parent.entry_id.clone());
    }
    entries
}

/// Fuses the text channel's entry order with the visual channel's entry order.
/// Both lists hold distinct entries in rank order, so one entry gains at most one
/// vote per channel.
///
/// Fusion scores tie often (two lists of similar length give many equal sums), so
/// ties resolve by the best rank the entry holds in either list, then by id. The
/// order is therefore a function of the two lists only.
pub fn fuse_entry_orders(
    text_order: &[String],
    visual_order: &[String],
    text_weight: f32,
    visual_weight: f32,
    k: f32,
) -> Vec<String> {
    if visual_order.is_empty() || visual_weight <= 0.0 {
        return text_order.to_vec();
    }
    if text_order.is_empty() || text_weight <= 0.0 {
        return visual_order.to_vec();
    }
    let best_rank = |entry: &str| {
        [text_order, visual_order]
            .iter()
            .filter_map(|list| list.iter().position(|candidate| candidate == entry))
            .map(|position| position + 1)
            .min()
            .unwrap_or(usize::MAX)
    };
    let mut fused = weighted_reciprocal_rank_fusion(
        &[text_order.to_vec(), visual_order.to_vec()],
        &[text_weight, visual_weight],
        k,
    );
    fused.sort_by(|(left, left_score), (right, right_score)| {
        right_score
            .total_cmp(left_score)
            .then_with(|| best_rank(left).cmp(&best_rank(right)))
            .then_with(|| left.cmp(right))
    });
    fused.into_iter().map(|(entry, _score)| entry).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn score(entry: &str, parent: &str, region: Option<u32>, value: f32) -> VisualScore {
        VisualScore {
            entry_id: entry.to_string(),
            parent_id: parent.to_string(),
            region,
            score: value,
            page_idx: None,
            segment_type: None,
        }
    }

    #[test]
    fn a_page_and_its_best_crop_collapse_to_one_vote() {
        let parents = aggregate_parents(&[
            score("e1", "p7", None, 0.40),
            score("e1", "p7", Some(0), 0.55),
            score("e1", "p7", Some(1), 0.31),
        ]);
        assert_eq!(parents.len(), 1);
        assert_eq!(parents[0].score, 0.55);
    }

    #[test]
    fn separate_parents_stay_separate() {
        let parents = aggregate_parents(&[
            score("e1", "p7", None, 0.2),
            score("e1", "p8", None, 0.6),
            score("e2", "p1", None, 0.4),
        ]);
        let keys: Vec<String> = parents.iter().map(ParentScore::key).collect();
        assert_eq!(keys, ["e1\u{1f}p8", "e2\u{1f}p1", "e1\u{1f}p7"]);
    }

    #[test]
    fn equal_scores_order_by_identity() {
        let parents =
            aggregate_parents(&[score("b", "p1", None, 0.5), score("a", "p2", None, 0.5)]);
        assert_eq!(parents[0].entry_id, "a");
        assert_eq!(parents[1].entry_id, "b");
    }

    #[test]
    fn non_finite_scores_are_dropped() {
        let parents = aggregate_parents(&[
            score("e1", "p1", None, f32::NAN),
            score("e1", "p2", None, f32::INFINITY),
            score("e1", "p3", None, 0.3),
        ]);
        assert_eq!(parents.len(), 1);
        assert_eq!(parents[0].parent_id, "p3");
    }

    #[test]
    fn entry_order_is_one_entry_per_first_appearance() {
        let parents = aggregate_parents(&[
            score("e2", "p1", None, 0.9),
            score("e1", "p3", None, 0.8),
            score("e2", "p2", None, 0.7),
        ]);
        assert_eq!(parent_entry_order(&parents, 10), ["e2", "e1"]);
        assert_eq!(parent_entry_order(&parents, 1), ["e2"]);
    }

    #[test]
    fn fusion_returns_text_order_when_the_visual_channel_is_silent() {
        let text = vec!["a".to_string(), "b".to_string()];
        assert_eq!(fuse_entry_orders(&text, &[], 1.0, 0.5, 60.0), text);
        assert_eq!(
            fuse_entry_orders(&text, &["z".to_string()], 1.0, 0.0, 60.0),
            text
        );
    }

    #[test]
    fn fusion_promotes_an_entry_the_visual_channel_ranks_first() {
        let text = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let visual = vec!["c".to_string(), "b".to_string()];
        let fused = fuse_entry_orders(&text, &visual, 1.0, 1.0, 60.0);
        // `c` and `b` tie on the fused score; `c` holds the better rank (visual 1).
        assert_eq!(fused[0], "c");
        assert_eq!(fused[1], "b");
        assert_eq!(fused[2], "a");
        assert_eq!(fused.len(), 3);
    }

    #[test]
    fn fusion_is_deterministic_for_equal_inputs() {
        let text = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let visual = vec!["c".to_string(), "b".to_string()];
        let first = fuse_entry_orders(&text, &visual, 1.0, 1.0, 60.0);
        for _ in 0..16 {
            assert_eq!(fuse_entry_orders(&text, &visual, 1.0, 1.0, 60.0), first);
        }
    }

    #[test]
    fn status_codes_are_fixed() {
        assert_eq!(
            VisualChannelStatus::Disabled.degradation_code(),
            Some("visual_disabled")
        );
        assert_eq!(
            VisualChannelStatus::Unavailable("no model").degradation_code(),
            Some("visual_unavailable")
        );
        assert_eq!(VisualChannelStatus::Ready.degradation_code(), None);
        assert!(VisualChannelStatus::Ready.is_ready());
    }
}
