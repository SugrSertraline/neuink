//! Shared, deterministic retrieval stages used by IPC and the benchmark.
//! Retrieval windows are distinct from the final evidence limit.
use std::collections::{BTreeMap, HashSet};

use neuink_domain::{CanonicalSectionRole, SegmentType};
use serde::{Deserialize, Serialize};

use crate::{
    adaptive_hybrid_weights, weighted_reciprocal_rank_fusion, MemorySearchIndex,
    PersistentSemanticSearchIndex, SearchDocument, SearchEntryGroup, SearchHit, SearchIndex,
    SearchMode, SearchQuery, SearchResult, SearchResults, SearchTarget, SemanticVectorDocument,
};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub enum HybridPolicy {
    #[default]
    Legacy,
    Semantic,
    H1,
    H2,
    H3,
}

impl HybridPolicy {
    pub fn filters_stopwords(self) -> bool {
        matches!(self, Self::Legacy | Self::H1 | Self::H2 | Self::H3)
    }

    pub fn weights(self, query: &str, matched: Option<&[String]>) -> (f32, f32, f32) {
        match self {
            Self::Legacy => {
                let (kw, sem) = adaptive_hybrid_weights(query, matched);
                (kw, sem, 60.0)
            }
            Self::Semantic => (0.0, 1.0, 60.0),
            Self::H1 => (0.5, 1.0, 20.0),
            Self::H2 => (0.5, 1.0, 60.0),
            Self::H3 => (1.0, 1.0, 20.0),
        }
    }
}

pub fn candidate_window(final_limit: usize) -> usize {
    final_limit.clamp(1, 200).saturating_mul(5).max(60)
}

pub fn hit_identity(hit: &SearchHit) -> String {
    match &hit.target {
        SearchTarget::Segment {
            entry_id,
            segment_uid,
            ..
        } => format!("s:{entry_id}:{segment_uid}"),
        SearchTarget::Page { entry_id, page_idx } => format!("p:{entry_id}:{page_idx}"),
        SearchTarget::Note { entry_id, note_id } => format!("n:{entry_id}:{note_id}"),
        SearchTarget::Entry { entry_id } => format!("e:{entry_id}"),
    }
}

pub fn ordered_hits(results: &SearchResults) -> Vec<SearchHit> {
    let mut hits = results
        .entries
        .iter()
        .flat_map(|entry| entry.hits.iter().cloned())
        .collect::<Vec<_>>();
    sort_hits(&mut hits);
    hits
}

fn sort_hits(hits: &mut [SearchHit]) {
    hits.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| hit_identity(a).cmp(&hit_identity(b)))
    });
}

pub fn results_from_hits(
    query: String,
    mode: String,
    generation: u64,
    mut hits: Vec<SearchHit>,
    warnings: Vec<String>,
) -> SearchResults {
    sort_hits(&mut hits);
    let mut groups = BTreeMap::<String, SearchEntryGroup>::new();
    for hit in hits {
        let group = groups
            .entry(hit.entry_id.to_string())
            .or_insert_with(|| SearchEntryGroup {
                entry_id: hit.entry_id.clone(),
                entry_title: hit.entry_title.clone(),
                hit_count: 0,
                max_score: hit.score,
                hits: Vec::new(),
            });
        group.hit_count += 1;
        group.hits.push(hit);
    }
    let mut entries = groups.into_values().collect::<Vec<_>>();
    entries.sort_by(|a, b| {
        b.max_score
            .total_cmp(&a.max_score)
            .then_with(|| a.entry_id.as_str().cmp(b.entry_id.as_str()))
    });
    SearchResults {
        query,
        mode,
        index_generation: generation,
        total_hit_count: entries.iter().map(|g| g.hit_count).sum(),
        entries,
        warnings,
        rerank_used: None,
    }
}

/// Combines entire bounded channel lists; final K is deliberately absent.
pub fn fuse_hybrid_candidates(
    query: &str,
    keyword: &SearchResults,
    semantic: &SearchResults,
    policy: HybridPolicy,
) -> SearchResults {
    if policy == HybridPolicy::Semantic {
        let mut result = semantic.clone();
        result.mode = "hybrid_semantic_only".into();
        return result;
    }
    let kw = ordered_hits(keyword);
    let (a, b, k) = policy.weights(query, kw.first().map(|hit| hit.matched_terms.as_slice()));
    fuse_ranked(
        query,
        &[keyword.clone(), semantic.clone()],
        &[a, b],
        k,
        "hybrid",
    )
}

fn fuse_ranked(
    query: &str,
    lists: &[SearchResults],
    weights: &[f32],
    k: f32,
    mode: &str,
) -> SearchResults {
    let ranked = lists
        .iter()
        .map(|list| ordered_hits(list).iter().map(hit_identity).collect())
        .collect::<Vec<Vec<String>>>();
    let fused = weighted_reciprocal_rank_fusion(&ranked, weights, k);
    let mut by_key = BTreeMap::new();
    for list in lists {
        for hit in ordered_hits(list) {
            by_key.entry(hit_identity(&hit)).or_insert(hit);
        }
    }
    let hits = fused
        .into_iter()
        .filter_map(|(key, score)| {
            let mut hit = by_key.remove(&key)?;
            hit.score = score;
            Some(hit)
        })
        .collect();
    let mut warnings = lists
        .iter()
        .flat_map(|r| r.warnings.clone())
        .collect::<Vec<_>>();
    warnings.sort();
    warnings.dedup();
    results_from_hits(
        query.to_string(),
        mode.to_string(),
        lists.first().map(|r| r.index_generation).unwrap_or(0),
        hits,
        warnings,
    )
}

pub fn fuse_query_candidates(
    query: &str,
    lists: &[SearchResults],
    weights: &[f32],
) -> SearchResults {
    if lists.len() == 1 {
        let mut result = lists[0].clone();
        result.query = query.into();
        return result;
    }
    let mode = if lists.iter().any(|r| r.mode.contains("fallback")) {
        "multi_query_fallback"
    } else {
        "multi_query"
    };
    fuse_ranked(query, lists, weights, 60.0, mode)
}

/// The caller embeds each unique query once, then reuses it for all policies.
pub fn recall_candidates(
    keyword: &MemorySearchIndex,
    semantic: Option<&PersistentSemanticSearchIndex>,
    query: &SearchQuery,
    vector: Option<&[f32]>,
    policy: HybridPolicy,
    window: usize,
) -> SearchResult<SearchResults> {
    let mut candidate = query.clone();
    candidate.limit = window;
    // In cross-paper / whole-library hybrid search, filtering high-DF English stopwords
    // prevents irrelevant documents from flooding BM25 Top-K (+7.00pp P@10 on TREC-COVID,
    // +1.02pp AllDoc@20 on MultiHopRAG, +1.03pp R@10 and -69% latency on DAPR).
    // Inside a single paper (~70 segments), keeping full query tokens preserves BM25 rank
    // coverage across the paper for RRF (+5.55pp R@10 on single-paper QASPER).
    let apply_policy_stopwords = query.mode == SearchMode::Hybrid
        && policy.filters_stopwords()
        && !(policy == HybridPolicy::Legacy && query.scope.entry_ids.len() == 1);
    candidate.filter_stopwords = query.filter_stopwords || apply_policy_stopwords;
    if query.mode == SearchMode::Keyword {
        return keyword.search(candidate);
    }
    let semantic = semantic.ok_or(crate::SearchError::SemanticUnavailable)?;
    let vector = vector.ok_or(crate::SearchError::SemanticUnavailable)?;
    let semantic_result = semantic.search_with_vector(
        &candidate,
        &query.normalized_text(),
        vector,
        "semantic",
        Vec::new(),
        keyword.generation()?,
    )?;
    if query.mode == SearchMode::Semantic {
        return Ok(semantic_result);
    }
    if policy == HybridPolicy::Semantic {
        // Same hits and order as the Semantic branch; keyword recall is skipped entirely.
        let mut result = semantic_result;
        result.mode = "hybrid_semantic_only".into();
        return Ok(result);
    }
    candidate.mode = SearchMode::Keyword;
    let keyword_result = keyword.search(candidate)?;
    Ok(fuse_hybrid_candidates(
        &query.normalized_text(),
        &keyword_result,
        &semantic_result,
        policy,
    ))
}

/// Section counts for one entry. `without_content` covers heading-only sections,
/// which never receive an invented body centroid.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
pub struct SectionCoverage {
    pub sections: usize,
    pub with_content: usize,
    pub without_content: usize,
}

#[derive(Debug, Default)]
pub struct ChapterCentroids {
    sections: BTreeMap<(String, String), ChapterVectors>,
    incomplete_entries: HashSet<String>,
}

#[derive(Debug)]
struct ChapterVectors {
    own: Option<Vec<f32>>,
    subtree: Option<Vec<f32>>,
    parent: Option<String>,
}

impl ChapterCentroids {
    /// Headings define structure, but never contribute a content vector.
    pub fn from_vectors<'a>(records: impl IntoIterator<Item = SemanticVectorDocument<'a>>) -> Self {
        let mut paths = BTreeMap::<(String, String), String>::new();
        let mut direct = BTreeMap::<(String, String), BTreeMap<String, Vec<f32>>>::new();
        let mut result = Self::default();
        let mut dimension: Option<usize> = None;
        let mut seen_uids = HashSet::<(String, String, String)>::new();
        for record in records {
            let doc = record.document;
            if doc.source.kind != crate::SearchDocumentSourceKind::Segment {
                continue;
            }
            let entry = doc.entry_id.to_string();
            let (Some(id), Some(path)) = (&doc.source.section_id, &doc.source.section_path) else {
                result.incomplete_entries.insert(entry);
                continue;
            };
            paths.insert((entry.clone(), id.clone()), path.clone());
            if doc.source.segment_type == Some(SegmentType::Heading) {
                continue;
            }
            let Some(uid) = &doc.source.segment_uid else {
                result.incomplete_entries.insert(entry);
                continue;
            };
            if record.vector.is_empty()
                || record.vector.iter().any(|v| !v.is_finite())
                || record.vector.iter().map(|v| v * v).sum::<f32>() <= 1e-12
            {
                result.incomplete_entries.insert(entry);
                continue;
            }
            // A mixed-dimension content vector would silently drop parent centroids; treat the paper as incomplete.
            if *dimension.get_or_insert(record.vector.len()) != record.vector.len() {
                result.incomplete_entries.insert(entry);
                continue;
            }
            // Identity dedupe by segment uid, then content dedupe by normalized body/caption text.
            // Different text is never merged, and the same text under another uid is counted once.
            if !seen_uids.insert((entry.clone(), id.clone(), uid.to_string())) {
                continue;
            }
            let key = content_key(doc).unwrap_or_else(|| format!("uid:{uid}"));
            direct
                .entry((entry, id.clone()))
                .or_default()
                .entry(key)
                .or_insert_with(|| record.vector.to_vec());
        }
        for ((entry, id), path) in &paths {
            let parent = path.rsplit_once(" > ").and_then(|(parent_path, _)| {
                paths
                    .iter()
                    .find(|((e, _), p)| e == entry && p.as_str() == parent_path)
                    .map(|((_, id), _)| id.clone())
            });
            let mut subtree = BTreeMap::new();
            for ((e, child), child_path) in &paths {
                if e == entry
                    && (child_path == path || child_path.starts_with(&format!("{path} > ")))
                {
                    if let Some(vectors) = direct.get(&(e.clone(), child.clone())) {
                        subtree.extend(vectors.clone());
                    }
                }
            }
            result.sections.insert(
                (entry.clone(), id.clone()),
                ChapterVectors {
                    own: direct
                        .get(&(entry.clone(), id.clone()))
                        .and_then(|v| centroid(v.values())),
                    subtree: centroid(subtree.values()),
                    parent,
                },
            );
        }
        result
    }

    /// Read-only eligibility for chapter rerank. Unknown entries and entries marked
    /// incomplete are never eligible, so this cannot relax the whole-query bypass.
    pub fn is_entry_complete(&self, entry_id: &str) -> bool {
        !self.incomplete_entries.contains(entry_id)
            && self.sections.keys().any(|(entry, _)| entry == entry_id)
    }

    /// Read-only section counts for an entry, for benchmark reports.
    pub fn section_coverage(&self, entry_id: &str) -> SectionCoverage {
        let mut coverage = SectionCoverage::default();
        for ((entry, _), vectors) in &self.sections {
            if entry != entry_id {
                continue;
            }
            coverage.sections += 1;
            if vectors.own.is_some() {
                coverage.with_content += 1;
            } else {
                coverage.without_content += 1;
            }
        }
        coverage
    }

    pub fn vector_bytes(&self) -> usize {
        self.sections
            .values()
            .map(|s| {
                s.own.as_ref().map_or(0, |v| v.len() * 4)
                    + s.subtree.as_ref().map_or(0, |v| v.len() * 4)
            })
            .sum()
    }

    fn apply(
        &self,
        hits: &mut [SearchHit],
        query: &SearchQuery,
        vector: &[f32],
        alpha: f32,
    ) -> bool {
        if alpha <= 0.0
            || !alpha.is_finite()
            || query.scope.entry_ids.len() != 1
            || vector.is_empty()
            || vector.iter().any(|v| !v.is_finite())
            || vector.iter().map(|v| v * v).sum::<f32>() <= 1e-12
            || self
                .sections
                .values()
                .filter_map(|s| s.own.as_ref())
                .any(|v| v.len() != vector.len())
        {
            return false;
        }
        let entry = query.scope.entry_ids[0].to_string();
        if self.incomplete_entries.contains(&entry)
            || hits.iter().any(|h| {
                h.entry_id.as_str() != entry
                    || !matches!(h.target, SearchTarget::Segment { .. })
                    || (h.source.segment_type != Some(SegmentType::Heading)
                        && h.source
                            .section_id
                            .as_ref()
                            .and_then(|id| self.sections.get(&(entry.clone(), id.clone())))
                            .and_then(|s| s.own.as_ref())
                            .is_none())
            })
        {
            return false;
        }
        let mut signals = Vec::with_capacity(hits.len());
        for hit in hits.iter() {
            let signal = hit
                .source
                .section_id
                .as_ref()
                .and_then(|id| self.sections.get(&(entry.clone(), id.clone())))
                .and_then(|s| {
                    let own = s.own.as_ref()?;
                    let own_score = cosine(vector, own)?;
                    let parent = s
                        .parent
                        .as_ref()
                        .and_then(|id| self.sections.get(&(entry.clone(), id.clone())))
                        .and_then(|s| s.subtree.as_ref());
                    let parent_score = parent.and_then(|p| cosine(vector, p)).unwrap_or(own_score);
                    Some((0.85 * own_score.max(0.0) + 0.15 * parent_score.max(0.0)).clamp(0.0, 1.0))
                })
                .unwrap_or(0.0);
            signals.push(signal);
        }
        for (rank, (hit, signal)) in hits.iter_mut().zip(signals).enumerate() {
            hit.score =
                (1.0 / (60.0 + rank as f32 + 1.0)) * (1.0 + alpha.clamp(0.0, 0.15) * signal);
        }
        true
    }
}

/// Whitespace-normalized body and caption text. Titles, section paths and
/// translations are excluded, so only the segment's own words decide whether two
/// records repeat. Case is kept: differing text must never merge.
fn content_key(document: &SearchDocument) -> Option<String> {
    let text = document
        .sections
        .iter()
        .filter(|section| section.label == "body" || section.label == "caption")
        .map(|section| {
            section
                .text
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    (!text.is_empty()).then_some(text)
}

fn centroid<'a>(vectors: impl Iterator<Item = &'a Vec<f32>>) -> Option<Vec<f32>> {
    let mut vectors = vectors;
    let mut total = vectors.next()?.clone();
    for vector in vectors {
        if vector.len() != total.len() {
            return None;
        }
        for (a, b) in total.iter_mut().zip(vector) {
            *a += b;
        }
    }
    let norm = total.iter().map(|v| v * v).sum::<f32>().sqrt();
    if !norm.is_finite() || norm <= 1e-6 {
        return None;
    }
    total.iter_mut().for_each(|v| *v /= norm);
    Some(total)
}

fn cosine(a: &[f32], b: &[f32]) -> Option<f32> {
    if a.len() != b.len() {
        return None;
    }
    let norm = a.iter().map(|v| v * v).sum::<f32>().sqrt();
    if !norm.is_finite() || norm <= 1e-6 {
        return None;
    }
    let value = a.iter().zip(b).map(|(a, b)| a * b).sum::<f32>() / norm;
    value.is_finite().then_some(value.clamp(-1.0, 1.0))
}

/// Exactly one final cut, after all query fusion and chapter/reference policies.
pub fn finalize_candidates(
    results: SearchResults,
    query: &SearchQuery,
    vector: Option<&[f32]>,
    chapters: Option<&ChapterCentroids>,
    alpha: f32,
    references: bool,
) -> SearchResults {
    let mut hits = ordered_hits(&results);
    if let (Some(chapters), Some(vector)) = (chapters, vector) {
        chapters.apply(&mut hits, query, vector, alpha);
    }
    let reference_filter = query.section_filter.as_deref().is_some_and(|f| {
        f.to_lowercase().contains("reference")
            || f.contains("参考文献")
            || hits.iter().any(|h| {
                h.source.section_id.as_deref() == Some(f)
                    && h.source.section_role == Some(CanonicalSectionRole::References)
            })
    });
    if references && !reference_filter {
        for hit in &mut hits {
            if hit.source.section_role == Some(CanonicalSectionRole::References) {
                hit.score = if hit.score >= 0.0 {
                    hit.score * 0.35
                } else {
                    hit.score / 0.35
                };
            }
        }
    }
    sort_hits(&mut hits);
    hits.truncate(query.limit.max(1));
    results_from_hits(
        results.query,
        results.mode,
        results.index_generation,
        hits,
        results.warnings,
    )
}

/// Supplements a first-stage candidate pool with non-heading segments from the
/// top-scoring chapters (via cached `ChapterCentroids`, zero extra embedding inference)
/// inside the anchored routed papers.
///
/// Only `existing[..keep_prefix]` is locked. A same-chapter segment in the Stage-1
/// tail, or outside the pool, may occupy `keep_prefix..rerank_head`. Displaced hits
/// stay after that window, and a moved tail hit is not duplicated. References stay
/// out unless `section_filter` asks for them. Call only when a reranker is active.
#[allow(clippy::too_many_arguments)]
pub fn supplement_hits_from_chapters(
    results: SearchResults,
    semantic: &PersistentSemanticSearchIndex,
    query_vector: &[f32],
    routed_entries: &[String],
    segment_types: &[SegmentType],
    section_filter: Option<&str>,
    rerank_head: usize,
    top_sections: usize,
    per_section_max: usize,
    max_append: usize,
) -> SearchResults {
    let allowed_append = max_append.min(rerank_head / 3);
    if allowed_append == 0
        || top_sections == 0
        || per_section_max == 0
        || routed_entries.is_empty()
        || query_vector.is_empty()
        || query_vector.iter().any(|v| !v.is_finite())
        || query_vector.iter().map(|v| v * v).sum::<f32>() <= 1e-12
    {
        return results;
    }

    let existing = ordered_hits(&results);
    let anchor_entries = chapter_anchor_entries(&existing, routed_entries);
    if anchor_entries.is_empty() {
        return results;
    }
    let decay_by_paper = routed_entries.len() > 1;
    let chapters = semantic.chapter_centroids();
    let mut section_scores: Vec<(f32, String, String)> = Vec::new();
    for ((entry_id, section_id), vectors) in &chapters.sections {
        let Some(doc_rank) = anchor_entries.iter().position(|id| id == entry_id) else {
            continue;
        };
        let Some(own) = vectors.own.as_deref() else {
            continue;
        };
        let Some(own_score) = cosine(query_vector, own) else {
            continue;
        };
        let parent_score = vectors
            .parent
            .as_ref()
            .and_then(|parent_id| chapters.sections.get(&(entry_id.clone(), parent_id.clone())))
            .and_then(|parent| parent.subtree.as_deref())
            .and_then(|subtree| cosine(query_vector, subtree))
            .unwrap_or(own_score);
        let blended =
            (0.85 * own_score.max(0.0) + 0.15 * parent_score.max(0.0)).clamp(0.0, 1.0);
        let score = if decay_by_paper {
            blended / (1.0 + 0.15 * doc_rank as f32)
        } else {
            blended
        };
        if score.is_finite() {
            section_scores.push((score, entry_id.clone(), section_id.clone()));
        }
    }
    if section_scores.is_empty() {
        return results;
    }
    section_scores.sort_by(|left, right| {
        right
            .0
            .total_cmp(&left.0)
            .then_with(|| left.1.cmp(&right.1))
            .then_with(|| left.2.cmp(&right.2))
    });
    let chosen_sections: Vec<(String, String)> = section_scores
        .into_iter()
        .take(top_sections)
        .map(|(_, entry, sec)| (entry, sec))
        .collect();
    let chosen_set: HashSet<(String, String)> = chosen_sections.iter().cloned().collect();

    let filter_lower = section_filter
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);

    let mut members_by_section: BTreeMap<(String, String), Vec<(f32, &SearchDocument)>> =
        BTreeMap::new();
    for record in semantic.vector_documents() {
        let doc = record.document;
        if doc.source.kind != crate::SearchDocumentSourceKind::Segment
            || doc.source.segment_type == Some(SegmentType::Heading)
            || reference_segment_blocked(doc, section_filter)
        {
            continue;
        }
        let Some(sec_id) = doc.source.section_id.as_deref() else {
            continue;
        };
        let key = (doc.entry_id.to_string(), sec_id.to_string());
        if !chosen_set.contains(&key) {
            continue;
        }
        if !segment_types.is_empty()
            && !doc
                .source
                .segment_type
                .is_some_and(|kind| segment_types.contains(&kind))
        {
            continue;
        }
        if let Some(filter) = filter_lower.as_deref() {
            let matches_id = doc
                .source
                .section_id
                .as_deref()
                .is_some_and(|value| value.to_lowercase() == filter);
            let matches_path = doc
                .source
                .section_path
                .as_deref()
                .is_some_and(|value| value.to_lowercase().contains(filter));
            if !matches_id && !matches_path {
                continue;
            }
        }
        if let Some(score) = cosine(query_vector, record.vector) {
            members_by_section.entry(key).or_default().push((score, doc));
        }
    }

    let Some(additions) = select_chapter_window_additions(
        &existing,
        &chosen_sections,
        &members_by_section,
        rerank_head,
        allowed_append,
        per_section_max,
    ) else {
        return results;
    };

    let keep_prefix = existing
        .len()
        .min(rerank_head.saturating_sub(additions.len()));
    let addition_ids = additions.iter().map(hit_identity).collect::<HashSet<_>>();
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

/// Multi-paper supplement only reads chapters from the first three papers in the
/// current text-hit order. An empty pool falls back to the routed head.
fn chapter_anchor_entries(existing: &[SearchHit], routed_entries: &[String]) -> Vec<String> {
    if routed_entries.len() <= 1 {
        return routed_entries.to_vec();
    }
    const MAX_ANCHOR_ENTRIES: usize = 3;
    let routed = routed_entries
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let mut anchors = Vec::new();
    for hit in existing {
        let entry = hit.entry_id.as_str();
        if routed.contains(entry) && !anchors.iter().any(|kept: &String| kept == entry) {
            anchors.push(entry.to_string());
            if anchors.len() == MAX_ANCHOR_ENTRIES {
                break;
            }
        }
    }
    if anchors.is_empty() {
        routed_entries
            .iter()
            .take(MAX_ANCHOR_ENTRIES)
            .cloned()
            .collect()
    } else {
        anchors
    }
}

fn section_filter_requests_references(section_filter: Option<&str>) -> bool {
    section_filter.is_some_and(|filter| {
        let filter = filter.trim();
        !filter.is_empty()
            && (filter.to_lowercase().contains("reference") || filter.contains("参考文献"))
    })
}

/// References re-enter only when the filter names them, or names this section id.
fn reference_segment_blocked(doc: &SearchDocument, section_filter: Option<&str>) -> bool {
    if doc.source.section_role != Some(CanonicalSectionRole::References) {
        return false;
    }
    if section_filter_requests_references(section_filter) {
        return false;
    }
    let names_this_section = section_filter.map(str::trim).is_some_and(|filter| {
        !filter.is_empty() && doc.source.section_id.as_deref() == Some(filter)
    });
    !names_this_section
}

/// Largest `k` whose first `k` chapter members all sit outside the prefix that `k`
/// itself would preserve. Prefix hits stay locked; tail and out-of-pool hits may move.
fn select_chapter_window_additions(
    existing: &[SearchHit],
    chosen_sections: &[(String, String)],
    members_by_section: &BTreeMap<(String, String), Vec<(f32, &SearchDocument)>>,
    rerank_head: usize,
    allowed_append: usize,
    per_section_max: usize,
) -> Option<Vec<SearchHit>> {
    let ranked = chosen_sections
        .iter()
        .map(|key| {
            let Some(members) = members_by_section.get(key) else {
                return Vec::new();
            };
            let mut members = members.clone();
            members.sort_by(|left, right| {
                right.0.total_cmp(&left.0).then_with(|| {
                    left.1
                        .source
                        .segment_uid
                        .as_ref()
                        .map(|uid| uid.as_str())
                        .cmp(&right.1.source.segment_uid.as_ref().map(|uid| uid.as_str()))
                })
            });
            members
                .into_iter()
                .map(|(_, doc)| doc)
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    for count in (1..=allowed_append.min(rerank_head)).rev() {
        let keep = existing.len().min(rerank_head.saturating_sub(count));
        let mut blocked = existing
            .iter()
            .take(keep)
            .map(hit_identity)
            .collect::<HashSet<_>>();
        let mut picks = Vec::new();
        for members in &ranked {
            if picks.len() == count {
                break;
            }
            if members.is_empty() {
                continue;
            }
            let mut took = 0usize;
            for doc in members {
                if took >= per_section_max || picks.len() == count {
                    break;
                }
                let candidate = hit_from_document(doc);
                if blocked.insert(hit_identity(&candidate)) {
                    picks.push(candidate);
                    took += 1;
                }
            }
        }
        if picks.len() == count {
            return Some(picks);
        }
    }
    None
}

const SUPPLEMENT_SNIPPET_PARAGRAPH_CHARS: usize = 700;
const SUPPLEMENT_SNIPPET_TABLE_CHARS: usize = 1600;

fn bounded_document_snippet(doc: &SearchDocument) -> String {
    let raw = doc.text_for_snippet();
    let is_table = doc.source.segment_type == Some(neuink_domain::SegmentType::Table)
        || crate::result::contains_html_table(&raw);
    let clean = crate::result::compact_html_table_if_present(&raw);
    let limit = if is_table {
        SUPPLEMENT_SNIPPET_TABLE_CHARS
    } else {
        SUPPLEMENT_SNIPPET_PARAGRAPH_CHARS
    };
    if clean.chars().count() <= limit {
        clean
    } else {
        let body = clean.chars().take(limit).collect::<String>();
        format!("{}...", body.trim())
    }
}

fn hit_from_document(doc: &SearchDocument) -> SearchHit {
    SearchHit {
        entry_id: doc.entry_id.clone(),
        entry_title: doc.entry_title.clone(),
        source: doc.source.clone(),
        target: doc.target.clone(),
        title: doc.title.clone(),
        snippet: bounded_document_snippet(doc),
        score: 0.0,
        matched_terms: Vec::new(),
        surrounding_context: None,
    }
}
