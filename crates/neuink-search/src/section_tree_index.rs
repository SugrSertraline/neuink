use std::collections::BTreeMap;

use neuink_domain::{CanonicalSectionRole, DocumentOutline, SegmentType, SegmentUid};

/// Structure-only adapter over the deterministic outline. It carries section IDs,
/// paths and member segments. It applies no role or vector scoring: chapter
/// evidence comes from `ChapterCentroids`, and role policy from the finalize stage.
#[derive(Clone, Debug, Default)]
pub struct SectionTreeIndex {
    pub sections: BTreeMap<String, SectionTreeEntry>,
}

#[derive(Clone, Debug)]
pub struct SectionTreeEntry {
    pub section_id: String,
    pub section_path: String,
    pub section_role: CanonicalSectionRole,
    pub segment_uids: Vec<SegmentUid>,
    /// Always `NEUTRAL_STRUCTURE_SCORE`; kept so existing callers keep their shape.
    pub structure_score: f32,
}

/// Multiplicative identity: a structure-only entry never changes a ranking.
pub const NEUTRAL_STRUCTURE_SCORE: f32 = 1.0;

pub fn build_section_tree_index(outline: &DocumentOutline) -> SectionTreeIndex {
    let mut sections = BTreeMap::new();
    for node in outline.flatten() {
        sections.insert(
            node.section_id.clone(),
            SectionTreeEntry {
                section_id: node.section_id.clone(),
                section_path: node.section_path.clone(),
                section_role: node.section_role,
                segment_uids: node.segment_uids.clone(),
                structure_score: NEUTRAL_STRUCTURE_SCORE,
            },
        );
    }
    SectionTreeIndex { sections }
}

pub fn segment_type_matches_filter(
    segment_type: SegmentType,
    filter: Option<&[SegmentType]>,
) -> bool {
    filter
        .map(|allowed| allowed.contains(&segment_type))
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structure_adapter_is_score_neutral_for_every_role() {
        let outline = DocumentOutline::default();
        assert!(build_section_tree_index(&outline).sections.is_empty());
        assert_eq!(NEUTRAL_STRUCTURE_SCORE, 1.0);
    }
}
