//! Post-ranking read-only surrounding context packaging (Direction F).
//!
//! Concatenating neighbor paragraphs *before* ranking was falsified in
//! `single-paper-precision-v3` and `single-paper-multivector-context-v3` because it
//! causes successor-paragraph leakage. Attaching read-only `[Prev]` / `[Next]`
//! same-section siblings strictly *after* final ranking and top-k truncation gives
//! the reader / assistant LLM cross-paragraph continuity with zero ranking regression.

use std::collections::HashMap;

use neuink_domain::SegmentType;

use crate::{
    strip_passage_header, SearchDocument, SearchDocumentSourceKind, SearchResults, SearchTarget,
};

const NEIGHBOR_CHAR_LIMIT: usize = 240;
pub const DEFAULT_SURROUNDING_CONTEXT_TOP_N: usize = 3;

/// Read-only map from `(entry_id, segment_uid)` to its same-section `[Prev]` / `[Next]`
/// sibling summary, built once from the prepared search documents.
#[derive(Clone, Debug, Default)]
pub struct SegmentContextMap {
    by_segment: HashMap<(String, String), String>,
}

impl SegmentContextMap {
    pub fn from_documents(documents: &[SearchDocument]) -> Self {
        let mut runs: Vec<(String, String, Vec<(String, String)>)> = Vec::new();
        for document in documents {
            if document.source.kind != SearchDocumentSourceKind::Segment {
                continue;
            }
            if !is_substantive_segment_type(document.source.segment_type) {
                continue;
            }
            let Some(segment_uid) = document.source.segment_uid.as_ref() else {
                continue;
            };
            let body = cleaned_body(document);
            if body.is_empty() {
                continue;
            }
            let entry_id = document.entry_id.as_str().to_string();
            let section_key = section_run_key(document);
            let item = (segment_uid.as_str().to_string(), body);
            if let Some(last) = runs.last_mut() {
                if last.0 == entry_id && last.1 == section_key {
                    if last.2.last().map(|(uid, _)| uid) != Some(&item.0) {
                        last.2.push(item);
                    }
                    continue;
                }
            }
            runs.push((entry_id, section_key, vec![item]));
        }

        let mut by_segment = HashMap::new();
        for (entry_id, _section, items) in runs {
            if items.len() < 2 {
                continue;
            }
            for (idx, (uid, _)) in items.iter().enumerate() {
                let mut parts = Vec::with_capacity(2);
                if idx > 0 {
                    let prev = clip_chars(&items[idx - 1].1, NEIGHBOR_CHAR_LIMIT);
                    if !prev.is_empty() {
                        parts.push(format!("[Prev] {prev}"));
                    }
                }
                if idx + 1 < items.len() {
                    let next = clip_chars(&items[idx + 1].1, NEIGHBOR_CHAR_LIMIT);
                    if !next.is_empty() {
                        parts.push(format!("[Next] {next}"));
                    }
                }
                if !parts.is_empty() {
                    by_segment
                        .entry((entry_id.clone(), uid.clone()))
                        .or_insert_with(|| parts.join("\n"));
                }
            }
        }
        Self { by_segment }
    }

    pub fn get(&self, entry_id: &str, segment_uid: &str) -> Option<&str> {
        self.by_segment
            .get(&(entry_id.to_string(), segment_uid.to_string()))
            .map(String::as_str)
    }

    pub fn is_empty(&self) -> bool {
        self.by_segment.is_empty()
    }
}

/// Populates `surrounding_context` on at most `top_n` highest-scoring segment hits in
/// `results`. Never alters scores, snippets, hit ordering, or entry ordering.
pub fn attach_surrounding_context(
    results: &mut SearchResults,
    contexts: &SegmentContextMap,
    top_n: usize,
) {
    if top_n == 0 || contexts.is_empty() {
        return;
    }
    let mut ranked_slots: Vec<(usize, usize, f32)> = Vec::new();
    for (entry_idx, group) in results.entries.iter().enumerate() {
        for (hit_idx, hit) in group.hits.iter().enumerate() {
            if matches!(hit.target, SearchTarget::Segment { .. }) {
                ranked_slots.push((entry_idx, hit_idx, hit.score));
            }
        }
    }
    ranked_slots.sort_by(|left, right| {
        right
            .2
            .total_cmp(&left.2)
            .then_with(|| left.0.cmp(&right.0))
            .then_with(|| left.1.cmp(&right.1))
    });
    for (entry_idx, hit_idx, _) in ranked_slots.into_iter().take(top_n) {
        let hit = &mut results.entries[entry_idx].hits[hit_idx];
        if let SearchTarget::Segment {
            entry_id,
            segment_uid,
            ..
        } = &hit.target
        {
            hit.surrounding_context = contexts
                .get(entry_id.as_str(), segment_uid.as_str())
                .map(str::to_string);
        }
    }
}

fn is_substantive_segment_type(segment_type: Option<SegmentType>) -> bool {
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

fn section_run_key(document: &SearchDocument) -> String {
    if let Some(id) = document
        .source
        .section_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return format!("id:{id}");
    }
    if let Some(path) = document
        .source
        .section_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return format!("path:{}", path.to_ascii_lowercase());
    }
    format!("page:{}", document.source.page_idx.unwrap_or(0))
}

fn cleaned_body(document: &SearchDocument) -> String {
    let raw = document
        .sections
        .iter()
        .find(|section| section.label == "body")
        .map(|section| section.text.as_str())
        .unwrap_or("");
    let stripped = strip_passage_header(raw);
    stripped.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clip_chars(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let clipped: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{}...", clipped.trim_end())
    } else {
        clipped
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        results_from_hits, SearchDocumentSource, SearchHit, SearchTextSection,
    };
    use neuink_domain::{EntryId, SegmentUid};

    fn seg_doc(
        entry: &str,
        uid: &str,
        section: &str,
        kind: SegmentType,
        body: &str,
    ) -> SearchDocument {
        SearchDocument {
            entry_id: EntryId::from_string(entry),
            entry_title: "Paper".to_string(),
            source: SearchDocumentSource {
                kind: SearchDocumentSourceKind::Segment,
                segment_uid: Some(SegmentUid::from_string(uid)),
                page_idx: Some(0),
                section_id: Some(section.to_string()),
                section_path: Some(section.to_string()),
                segment_type: Some(kind),
                ..SearchDocumentSource::default()
            },
            target: SearchTarget::Segment {
                entry_id: EntryId::from_string(entry),
                segment_uid: SegmentUid::from_string(uid),
                page_idx: 0,
            },
            title: "Paper".to_string(),
            sections: vec![SearchTextSection::body(body)],
            boost: 1.0,
        }
    }

    fn seg_hit(entry: &str, uid: &str, score: f32) -> SearchHit {
        SearchHit {
            entry_id: EntryId::from_string(entry),
            entry_title: "Paper".to_string(),
            source: SearchDocumentSource {
                kind: SearchDocumentSourceKind::Segment,
                segment_uid: Some(SegmentUid::from_string(uid)),
                ..SearchDocumentSource::default()
            },
            target: SearchTarget::Segment {
                entry_id: EntryId::from_string(entry),
                segment_uid: SegmentUid::from_string(uid),
                page_idx: 0,
            },
            title: "Paper".to_string(),
            snippet: format!("snippet {uid}"),
            score,
            matched_terms: Vec::new(),
            surrounding_context: None,
        }
    }

    #[test]
    fn builds_same_section_prev_next_and_never_crosses_sections_or_includes_headings() {
        let docs = vec![
            seg_doc("e1", "h1", "sec-1", SegmentType::Heading, "Experiments"),
            seg_doc("e1", "s1", "sec-1", SegmentType::Paragraph, "Table 2 summarizes accuracy."),
            seg_doc("e1", "s2", "sec-1", SegmentType::Table, "Our model achieves 91.4% F1."),
            seg_doc("e1", "s3", "sec-1", SegmentType::Paragraph, "Ablations confirm the gain."),
            seg_doc("e1", "s4", "sec-2", SegmentType::Paragraph, "In conclusion we summarize."),
        ];
        let map = SegmentContextMap::from_documents(&docs);

        // Heading is excluded, so s1 only sees s2 as [Next].
        assert_eq!(map.get("e1", "h1"), None);
        assert_eq!(map.get("e1", "s1"), Some("[Next] Our model achieves 91.4% F1."));
        assert_eq!(
            map.get("e1", "s2"),
            Some("[Prev] Table 2 summarizes accuracy.\n[Next] Ablations confirm the gain.")
        );
        // s3 does not cross into sec-2 (s4).
        assert_eq!(map.get("e1", "s3"), Some("[Prev] Our model achieves 91.4% F1."));
        assert_eq!(map.get("e1", "s4"), None);
    }

    #[test]
    fn attaches_only_to_top_n_without_changing_order_or_snippets() {
        let docs = vec![
            seg_doc("e1", "s1", "sec-1", SegmentType::Paragraph, "First body."),
            seg_doc("e1", "s2", "sec-1", SegmentType::Paragraph, "Second body."),
            seg_doc("e1", "s3", "sec-1", SegmentType::Paragraph, "Third body."),
            seg_doc("e1", "s4", "sec-1", SegmentType::Paragraph, "Fourth body."),
        ];
        let map = SegmentContextMap::from_documents(&docs);
        let mut results = results_from_hits(
            "q".to_string(),
            "hybrid".to_string(),
            1,
            vec![
                seg_hit("e1", "s1", 4.0),
                seg_hit("e1", "s2", 3.0),
                seg_hit("e1", "s3", 2.0),
                seg_hit("e1", "s4", 1.0),
            ],
            Vec::new(),
        );
        attach_surrounding_context(&mut results, &map, 3);
        let hits = &results.entries[0].hits;
        assert!(hits[0].surrounding_context.is_some());
        assert!(hits[1].surrounding_context.is_some());
        assert!(hits[2].surrounding_context.is_some());
        assert!(hits[3].surrounding_context.is_none());
        assert_eq!(hits[0].snippet, "snippet s1");
        assert_eq!(hits[0].score, 4.0);
    }
}
