use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::{SegmentType, SegmentUid, SourceSegment};

/// A stable, low-cost role inferred from a section heading.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CanonicalSectionRole {
    Abstract,
    Introduction,
    RelatedWork,
    Methods,
    Experiments,
    Results,
    Discussion,
    Conclusion,
    References,
    Appendix,
    FrontMatter,
    #[default]
    Other,
}

impl CanonicalSectionRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Abstract => "abstract",
            Self::Introduction => "introduction",
            Self::RelatedWork => "related_work",
            Self::Methods => "methods",
            Self::Experiments => "experiments",
            Self::Results => "results",
            Self::Discussion => "discussion",
            Self::Conclusion => "conclusion",
            Self::References => "references",
            Self::Appendix => "appendix",
            Self::FrontMatter => "front_matter",
            Self::Other => "other",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DocumentSectionNode {
    pub section_id: String,
    pub title: String,
    pub level: u8,
    pub section_path: String,
    pub section_role: CanonicalSectionRole,
    #[serde(default)]
    pub start_page_idx: u32,
    #[serde(default)]
    pub end_page_idx: u32,
    #[serde(default)]
    pub table_count: usize,
    #[serde(default)]
    pub figure_count: usize,
    pub heading_segment_uid: Option<SegmentUid>,
    pub segment_uids: Vec<SegmentUid>,
    pub children: Vec<DocumentSectionNode>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct DocumentOutline {
    pub sections: Vec<DocumentSectionNode>,
    #[serde(default)]
    pub segment_sections: BTreeMap<SegmentUid, String>,
}

impl DocumentOutline {
    pub fn is_empty(&self) -> bool {
        self.sections.is_empty()
    }

    pub fn section(&self, section_id: &str) -> Option<&DocumentSectionNode> {
        fn find<'a>(nodes: &'a [DocumentSectionNode], id: &str) -> Option<&'a DocumentSectionNode> {
            nodes.iter().find_map(|node| {
                (node.section_id == id)
                    .then_some(node)
                    .or_else(|| find(&node.children, id))
            })
        }
        find(&self.sections, section_id)
    }

    pub fn section_for_segment(&self, uid: &SegmentUid) -> Option<&DocumentSectionNode> {
        let id = self.segment_sections.get(uid)?;
        self.section(id)
    }

    pub fn flatten(&self) -> Vec<&DocumentSectionNode> {
        fn visit<'a>(nodes: &'a [DocumentSectionNode], out: &mut Vec<&'a DocumentSectionNode>) {
            for node in nodes {
                out.push(node);
                visit(&node.children, out);
            }
        }
        let mut out = Vec::new();
        visit(&self.sections, &mut out);
        out
    }

    /// A bounded outline suitable for injecting into an assistant context.
    pub fn compact_summary(&self, max_chars: usize) -> String {
        let mut output = String::new();
        for node in self.flatten() {
            let line = format!(
                "{}{} [{}-{}]{}{}\n",
                "  ".repeat(node.level.saturating_sub(1) as usize),
                node.title,
                node.start_page_idx + 1,
                node.end_page_idx + 1,
                if node.table_count > 0 { format!(" tables={}", node.table_count) } else { String::new() },
                if node.figure_count > 0 { format!(" figures={}", node.figure_count) } else { String::new() },
            );
            if output.len() + line.len() > max_chars {
                break;
            }
            output.push_str(&line);
        }
        output.trim_end().to_string()
    }
}

/// Build a deterministic section tree from parser output. The function uses
/// only reading order and parser metadata, so the index remains rebuildable.
pub fn build_document_outline(segments: &[SourceSegment]) -> DocumentOutline {
    let heading_indices = segments
        .iter()
        .enumerate()
        .filter(|(_, segment)| segment.segment_type == SegmentType::Heading)
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    if heading_indices.is_empty() {
        return DocumentOutline::default();
    }

    let first_heading = heading_indices[0];
    // Strip the document's L0/main title only when it looks like a title:
    // it is first in reading order, has no numeric prefix, and is followed by
    // a numbered or otherwise deeper heading. A genuine ``Introduction`` at
    // the beginning must remain searchable as a section.
    let title_heading = (first_heading == 0
        && !has_number_prefix(&segments[first_heading].text)
        && heading_indices.get(1).is_some_and(|next| {
            heading_level(&segments[*next]).unwrap_or(1) > 1
                || has_number_prefix(&segments[*next].text)
        }))
    .then_some(first_heading);

    let mut roots = Vec::<DocumentSectionNode>::new();
    let mut stack = Vec::<(u8, Vec<usize>)>::new();
    let mut section_counter = 0usize;
    let mut heading_by_index = BTreeMap::new();

    for (heading_order, &index) in heading_indices.iter().enumerate() {
        if Some(index) == title_heading {
            continue;
        }
        let segment = &segments[index];
        // Parser metadata is often flattened to level=1. An explicit section
        // number is a stronger signal and must win in that case.
        let inferred_level = inferred_numbering_level(&segment.text);
        let mut level = if inferred_level > 1 {
            inferred_level
        } else {
            heading_level(segment).unwrap_or(1)
        };
        level = level.clamp(1, 8);
        while let Some(&(parent_level, _)) = stack.last() {
            if parent_level < level {
                if level > parent_level.saturating_add(1) {
                    level = parent_level.saturating_add(1);
                }
                break;
            }
            stack.pop();
        }
        let parent_role = stack
            .last()
            .and_then(|(_, path)| node_at_path(&roots, path))
            .map(|node| node.section_role);
        let role = match canonical_section_role(&segment.text) {
            CanonicalSectionRole::Other => parent_role.unwrap_or(CanonicalSectionRole::Other),
            role => role,
        };
        let title = compact_title(&segment.text);
        let parent_path = stack
            .last()
            .and_then(|(_, path)| node_at_path(&roots, path))
            .map(|node| node.section_path.clone());
        let section_path = parent_path
            .map(|path| format!("{path} > {title}"))
            .unwrap_or_else(|| title.clone());
        let section_id = format!("section-{section_counter}");
        section_counter += 1;
        let node = DocumentSectionNode {
            section_id: section_id.clone(),
            title,
            level,
            section_path,
            section_role: role,
            start_page_idx: segment.page_idx,
            end_page_idx: segment.page_idx,
            table_count: 0,
            figure_count: 0,
            heading_segment_uid: Some(segment.uid.clone()),
            segment_uids: vec![segment.uid.clone()],
            children: Vec::new(),
        };
        let path = if let Some((_, parent)) = stack.last() {
            let mut child_path = parent.clone();
            child_path.push(node_child_index(&roots, parent));
            insert_node(&mut roots, parent, node);
            child_path
        } else {
            let index = roots.len();
            roots.push(node);
            vec![index]
        };
        stack.push((level, path.clone()));
        heading_by_index.insert(index, section_id);
        let _ = heading_order;
    }

    let mut outline = DocumentOutline {
        sections: roots,
        segment_sections: BTreeMap::new(),
    };
    let mut current_section = None::<String>;
    let mut seen_heading = BTreeSet::new();
    for (index, segment) in segments.iter().enumerate() {
        if let Some(section_id) = heading_by_index.get(&index) {
            current_section = Some(section_id.clone());
            seen_heading.insert(section_id.clone());
        }
        let Some(section_id) = current_section.clone() else {
            continue;
        };
        outline
            .segment_sections
            .insert(segment.uid.clone(), section_id.clone());
        if !seen_heading.contains(&section_id) {
            continue;
        }
        if let Some(node) = outline.section_mut(&section_id) {
            if !node.segment_uids.contains(&segment.uid) {
                node.segment_uids.push(segment.uid.clone());
            }
        }
    }
    // Preserve paragraphs before the first heading under a virtual front
    // matter section, while leaving ordinary heading-free legacy documents
    // empty so they naturally fall back to flat retrieval.
    let preface = first_heading
        .checked_sub(1)
        .map(|last| {
            segments[..=last]
                .iter()
                .filter(|segment| segment.segment_type != SegmentType::Heading)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if !preface.is_empty() && !outline.sections.is_empty() {
        let front_matter = DocumentSectionNode {
            section_id: "section-front-matter".to_string(),
            title: "Front matter".to_string(),
            level: 1,
            section_path: "Front matter".to_string(),
            section_role: CanonicalSectionRole::FrontMatter,
            start_page_idx: preface.first().map(|segment| segment.page_idx).unwrap_or(0),
            end_page_idx: preface.last().map(|segment| segment.page_idx).unwrap_or(0),
            table_count: preface
                .iter()
                .filter(|segment| segment.segment_type == SegmentType::Table)
                .count(),
            figure_count: preface
                .iter()
                .filter(|segment| segment.segment_type == SegmentType::Figure)
                .count(),
            heading_segment_uid: None,
            segment_uids: preface.iter().map(|segment| segment.uid.clone()).collect(),
            children: Vec::new(),
        };
        outline.sections.insert(0, front_matter);
        for segment in preface {
            outline
                .segment_sections
                .insert(segment.uid.clone(), "section-front-matter".to_string());
        }
    }
    // Derive stable page and visual counts from the assigned segment IDs.
    fn populate_stats(
        nodes: &mut [DocumentSectionNode],
        segments_by_uid: &BTreeMap<SegmentUid, &SourceSegment>,
    ) {
        for node in nodes {
            let assigned = node
                .segment_uids
                .iter()
                .filter_map(|uid| segments_by_uid.get(uid).copied())
                .collect::<Vec<_>>();
            if let Some(first) = assigned.first() {
                node.start_page_idx = assigned.iter().map(|segment| segment.page_idx).min().unwrap_or(first.page_idx);
                node.end_page_idx = assigned.iter().map(|segment| segment.page_idx).max().unwrap_or(first.page_idx);
                node.table_count = assigned.iter().filter(|segment| segment.segment_type == SegmentType::Table).count();
                node.figure_count = assigned.iter().filter(|segment| segment.segment_type == SegmentType::Figure).count();
            }
            populate_stats(&mut node.children, segments_by_uid);
        }
    }
    let segments_by_uid = segments
        .iter()
        .map(|segment| (segment.uid.clone(), segment))
        .collect::<BTreeMap<_, _>>();
    populate_stats(&mut outline.sections, &segments_by_uid);
    outline
}

impl DocumentOutline {
    fn section_mut(&mut self, section_id: &str) -> Option<&mut DocumentSectionNode> {
        fn find<'a>(
            nodes: &'a mut [DocumentSectionNode],
            id: &str,
        ) -> Option<&'a mut DocumentSectionNode> {
            for node in nodes {
                if node.section_id == id {
                    return Some(node);
                }
                if let Some(found) = find(&mut node.children, id) {
                    return Some(found);
                }
            }
            None
        }
        find(&mut self.sections, section_id)
    }
}

fn heading_level(segment: &SourceSegment) -> Option<u8> {
    segment
        .mineru_metadata
        .get("level")
        .or_else(|| segment.mineru_metadata.get("text_level"))
        .and_then(|value| value.parse::<u8>().ok())
}

fn inferred_numbering_level(title: &str) -> u8 {
    let prefix = title
        .trim()
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_end_matches(['.', ')']);
    if prefix.chars().all(|ch| ch.is_ascii_digit() || ch == '.')
        && prefix.chars().any(|ch| ch.is_ascii_digit())
    {
        prefix.matches('.').count() as u8 + 1
    } else {
        1
    }
}

fn has_number_prefix(title: &str) -> bool {
    let prefix = title.trim().split_whitespace().next().unwrap_or_default();
    let prefix = prefix.trim_end_matches(['.', ')']);
    !prefix.is_empty()
        && prefix.chars().all(|ch| ch.is_ascii_digit() || ch == '.')
        && prefix.chars().any(|ch| ch.is_ascii_digit())
}

fn canonical_section_role(title: &str) -> CanonicalSectionRole {
    let normalized_title = title
        .split_whitespace()
        .skip_while(|word| has_number_prefix(word))
        .collect::<Vec<_>>()
        .join(" ");
    let normalized = normalized_title.to_ascii_lowercase();
    let normalized = normalized.trim_matches(|ch: char| !ch.is_ascii_alphanumeric());
    if normalized.starts_with("abstract") {
        CanonicalSectionRole::Abstract
    } else if normalized.starts_with("introduction") || normalized == "intro" {
        CanonicalSectionRole::Introduction
    } else if normalized.contains("related work") || normalized.contains("literature review") {
        CanonicalSectionRole::RelatedWork
    } else if normalized.starts_with("method")
        || normalized.contains("approach")
        || normalized.contains("materials")
    {
        CanonicalSectionRole::Methods
    } else if normalized.starts_with("experiment") || normalized.contains("evaluation") {
        CanonicalSectionRole::Experiments
    } else if normalized.starts_with("result") {
        CanonicalSectionRole::Results
    } else if normalized.starts_with("discussion") {
        CanonicalSectionRole::Discussion
    } else if normalized.starts_with("conclusion") || normalized.starts_with("concluding") {
        CanonicalSectionRole::Conclusion
    } else if normalized.starts_with("reference") || normalized == "bibliography" {
        CanonicalSectionRole::References
    } else if normalized.starts_with("appendix") || normalized.starts_with("supplement") {
        CanonicalSectionRole::Appendix
    } else {
        CanonicalSectionRole::Other
    }
}

fn compact_title(title: &str) -> String {
    title.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn node_at_path<'a>(
    nodes: &'a [DocumentSectionNode],
    path: &[usize],
) -> Option<&'a DocumentSectionNode> {
    let (&index, rest) = path.split_first()?;
    let node = nodes.get(index)?;
    if rest.is_empty() {
        Some(node)
    } else {
        node_at_path(&node.children, rest)
    }
}

fn node_child_index(nodes: &[DocumentSectionNode], path: &[usize]) -> usize {
    node_at_path(nodes, path)
        .map(|node| node.children.len())
        .unwrap_or(0)
}

fn insert_node(nodes: &mut [DocumentSectionNode], path: &[usize], node: DocumentSectionNode) {
    if let Some((&index, rest)) = path.split_first() {
        if let Some(parent) = nodes.get_mut(index) {
            if rest.is_empty() {
                parent.children.push(node);
            } else {
                insert_node(&mut parent.children, rest, node);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn heading(text: &str, level: Option<&str>) -> SourceSegment {
        let mut segment = SourceSegment::new(SegmentType::Heading, 0, None, text.to_string());
        if let Some(level) = level {
            segment.mineru_metadata.insert("level".into(), level.into());
        }
        segment
    }

    #[test]
    fn builds_monotonic_tree_and_assigns_body_segments() {
        let mut body = SourceSegment::new(SegmentType::Paragraph, 0, None, "body".into());
        let mut segments = vec![
            heading("Paper title", Some("1")),
            heading("1 Introduction", Some("1")),
            heading("1.1 Method", Some("3")),
            body.clone(),
        ];
        let outline = build_document_outline(&segments);
        assert_eq!(
            outline
                .flatten()
                .iter()
                .map(|node| node.level)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert!(outline.section_for_segment(&body.uid).is_some());
        assert!(outline.compact_summary(500).contains("Introduction"));
        body.text.clear();
        segments[3] = body;
    }

    #[test]
    fn numbered_headings_override_flat_parser_levels_and_inherit_role() {
        let headings = vec![
            heading("4 Experiments", Some("1")),
            heading("4.2 Ablation Study", Some("1")),
        ];
        let outline = build_document_outline(&headings);
        let nodes = outline.flatten();
        assert_eq!(nodes[0].level, 1);
        assert_eq!(nodes[1].level, 2);
        assert_eq!(nodes[1].section_role, CanonicalSectionRole::Experiments);
    }

    #[test]
    fn no_heading_is_a_safe_empty_outline() {
        let segment = SourceSegment::new(SegmentType::Paragraph, 0, None, "body".into());
        assert!(build_document_outline(&[segment]).is_empty());
    }
}
