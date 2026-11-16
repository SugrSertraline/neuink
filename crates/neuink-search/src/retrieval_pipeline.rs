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
        matches!(self, Self::H1 | Self::H2 | Self::H3)
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
    candidate.filter_stopwords =
        query.filter_stopwords || (query.mode == SearchMode::Hybrid && policy.filters_stopwords());
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
