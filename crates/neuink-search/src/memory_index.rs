use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet, HashMap},
    sync::{Arc, RwLock},
};

use neuink_domain::EntryId;
use rayon::prelude::*;

use crate::{
    token::{tokenize, tokenize_unique},
    SearchDocument, SearchEntryGroup, SearchError, SearchHit, SearchIndex, SearchMode, SearchQuery,
    SearchResult, SearchResults,
};

const QUERY_CACHE_LIMIT: usize = 64;
const MAX_RESULT_LIMIT: usize = 1000;
/// Okapi BM25 parameters (Robertson & Zaragoza, 2009), the Lucene/tantivy defaults.
const BM25_K1: f32 = 1.2;
const BM25_B: f32 = 0.75;

#[derive(Debug, Default)]
pub struct MemorySearchIndex {
    snapshot: RwLock<Arc<SearchSnapshot>>,
    query_cache: RwLock<HashMap<String, SearchResults>>,
}

impl SearchIndex for MemorySearchIndex {
    fn replace_documents(&self, documents: Vec<SearchDocument>) -> SearchResult<()> {
        let next_generation = self.generation()? + 1;
        let snapshot = Arc::new(SearchSnapshot::build(documents, next_generation));
        *self
            .snapshot
            .write()
            .map_err(|_| SearchError::LockPoisoned)? = snapshot;
        self.query_cache
            .write()
            .map_err(|_| SearchError::LockPoisoned)?
            .clear();
        Ok(())
    }

    fn remove_entry(&self, entry_id: &EntryId) -> SearchResult<()> {
        let documents = self
            .snapshot
            .read()
            .map_err(|_| SearchError::LockPoisoned)?
            .documents
            .iter()
            .filter(|document| &document.document.entry_id != entry_id)
            .map(|document| document.document.clone())
            .collect::<Vec<_>>();
        self.replace_documents(documents)
    }

    fn search(&self, query: SearchQuery) -> SearchResult<SearchResults> {
        let normalized_query = query.normalized_text();
        if normalized_query.is_empty() {
            return Err(SearchError::EmptyQuery);
        }

        let cache_key = cache_key(&query, &normalized_query);
        if let Some(cached) = self
            .query_cache
            .read()
            .map_err(|_| SearchError::LockPoisoned)?
            .get(&cache_key)
            .cloned()
        {
            return Ok(cached);
        }

        let snapshot = self
            .snapshot
            .read()
            .map_err(|_| SearchError::LockPoisoned)?
            .clone();
        let results = snapshot.search(&query, normalized_query)?;
        let mut cache = self
            .query_cache
            .write()
            .map_err(|_| SearchError::LockPoisoned)?;
        if cache.len() >= QUERY_CACHE_LIMIT {
            if let Some(key) = cache.keys().next().cloned() {
                cache.remove(&key);
            }
        }
        cache.insert(cache_key, results.clone());
        Ok(results)
    }

    fn generation(&self) -> SearchResult<u64> {
        Ok(self
            .snapshot
            .read()
            .map_err(|_| SearchError::LockPoisoned)?
            .generation)
    }
}

#[derive(Debug, Default)]
struct SearchSnapshot {
    generation: u64,
    documents: Vec<IndexedDocument>,
    postings: HashMap<String, Vec<Posting>>,
    average_length: f32,
}

impl SearchSnapshot {
    fn build(documents: Vec<SearchDocument>, generation: u64) -> Self {
        let locals = documents
            .into_par_iter()
            .enumerate()
            .map(index_document)
            .collect::<Vec<_>>();

        let mut ordered = locals;
        ordered.sort_by_key(|document| document.doc_idx);

        let total_length = ordered.iter().map(|document| document.length).sum::<f32>();
        let average_length = if ordered.is_empty() {
            1.0
        } else {
            (total_length / ordered.len() as f32).max(1.0)
        };

        let mut postings: HashMap<String, Vec<Posting>> = HashMap::new();
        for document in &ordered {
            for (term, weight) in &document.term_weights {
                postings.entry(term.clone()).or_default().push(Posting {
                    doc_idx: document.doc_idx,
                    weight: *weight,
                });
            }
        }

        Self {
            generation,
            documents: ordered
                .into_iter()
                .map(|document| IndexedDocument {
                    document: document.document,
                    text_for_snippet: document.text_for_snippet,
                    length: document.length,
                })
                .collect(),
            postings,
            average_length,
        }
    }

    fn search(&self, query: &SearchQuery, normalized_query: String) -> SearchResult<SearchResults> {
        let query_terms = if query.filter_stopwords {
            crate::token::tokenize_content_query(&normalized_query)
        } else {
            tokenize_unique(&normalized_query)
        };
        if query_terms.is_empty() {
            return Err(SearchError::EmptyQuery);
        }

        let mut scores: HashMap<usize, CandidateScore> = HashMap::new();
        let document_count = self.documents.len() as f32;

        for term in &query_terms {
            let Some(postings) = self.postings.get(term) else {
                continue;
            };
            let idf = bm25_idf(document_count, postings.len() as f32);

            for posting in postings {
                let Some(indexed) = self.documents.get(posting.doc_idx) else {
                    continue;
                };
                let candidate = scores.entry(posting.doc_idx).or_default();
                candidate.score +=
                    idf * bm25_term_weight(posting.weight, indexed.length, self.average_length);
                candidate.matched_terms.insert(term.clone());
            }
        }

        let limit = query.limit.clamp(1, MAX_RESULT_LIMIT);
        let mut hits = scores
            .into_iter()
            .filter_map(|(doc_idx, candidate)| {
                let indexed = self.documents.get(doc_idx)?;
                if !crate::embedding_representation::matches_semantic_document(
                    query,
                    &indexed.document,
                ) {
                    return None;
                }

                let coverage = candidate.matched_terms.len() as f32 / query_terms.len() as f32;
                let score = candidate.score * indexed.document.boost * (0.6 + coverage * 0.4);
                Some(SearchHit {
                    entry_id: indexed.document.entry_id.clone(),
                    entry_title: indexed.document.entry_title.clone(),
                    source: indexed.document.source.clone(),
                    target: indexed.document.target.clone(),
                    title: indexed.document.title.clone(),
                    snippet: make_snippet(
                        &indexed.text_for_snippet,
                        &normalized_query,
                        &candidate.matched_terms,
                    ),
                    score,
                    matched_terms: candidate.matched_terms.into_iter().collect(),
                })
            })
            .collect::<Vec<_>>();

        hits.sort_by(compare_hits);
        hits.truncate(limit);

        let mut grouped = BTreeMap::<String, SearchEntryGroup>::new();
        for hit in hits {
            let key = hit.entry_id.as_str().to_string();
            let group = grouped.entry(key).or_insert_with(|| SearchEntryGroup {
                entry_id: hit.entry_id.clone(),
                entry_title: hit.entry_title.clone(),
                hit_count: 0,
                max_score: hit.score,
                hits: Vec::new(),
            });
            group.hit_count += 1;
            group.max_score = group.max_score.max(hit.score);
            group.hits.push(hit);
        }

        let mut entries = grouped.into_values().collect::<Vec<_>>();
        entries.sort_by(|left, right| {
            right
                .max_score
                .partial_cmp(&left.max_score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| left.entry_title.cmp(&right.entry_title))
        });

        let total_hit_count = entries.iter().map(|entry| entry.hit_count).sum();
        let (mode, warnings) = result_mode_and_warnings(query.mode);
        Ok(SearchResults {
            query: normalized_query,
            mode,
            index_generation: self.generation,
            total_hit_count,
            entries,
            warnings,
        })
    }
}

#[derive(Clone, Debug)]
struct IndexedDocument {
    document: SearchDocument,
    text_for_snippet: String,
    /// Field-weighted token count used for BM25 length normalization.
    length: f32,
}

#[derive(Clone, Copy, Debug)]
struct Posting {
    doc_idx: usize,
    /// Field-weighted term frequency (BM25F-style section boosts).
    weight: f32,
}

#[derive(Debug)]
struct LocalIndexedDocument {
    doc_idx: usize,
    document: SearchDocument,
    text_for_snippet: String,
    term_weights: HashMap<String, f32>,
    length: f32,
}

#[derive(Debug, Default)]
struct CandidateScore {
    score: f32,
    matched_terms: BTreeSet<String>,
}

fn index_document((doc_idx, document): (usize, SearchDocument)) -> LocalIndexedDocument {
    // Section boosts scale term frequency and length together (BM25F); the
    // document boost is applied to the final score so k1 does not saturate it.
    let mut term_weights = HashMap::<String, f32>::new();
    let mut length = 0.0;
    for section in &document.sections {
        for token in tokenize(&section.text) {
            *term_weights.entry(token).or_insert(0.0) += section.boost;
            length += section.boost;
        }
    }
    // `document.title` is the display title and is usually also represented by
    // a title section. Index it only as a fallback so a segment label cannot be
    // counted twice in the high-weight field.
    if !document
        .sections
        .iter()
        .any(|section| section.label == "title")
    {
        for token in tokenize(&document.title) {
            *term_weights.entry(token).or_insert(0.0) += 2.0;
            length += 2.0;
        }
    }

    let text_for_snippet = document.text_for_snippet();
    LocalIndexedDocument {
        doc_idx,
        document,
        text_for_snippet,
        term_weights,
        length,
    }
}

/// BM25 idf with the +1 inside the log so very common terms never go negative.
fn bm25_idf(document_count: f32, document_frequency: f32) -> f32 {
    (1.0 + (document_count - document_frequency + 0.5) / (document_frequency + 0.5)).ln()
}

fn bm25_term_weight(term_frequency: f32, length: f32, average_length: f32) -> f32 {
    let normalization = BM25_K1 * (1.0 - BM25_B + BM25_B * length / average_length);
    term_frequency * (BM25_K1 + 1.0) / (term_frequency + normalization)
}

fn compare_hits(left: &SearchHit, right: &SearchHit) -> Ordering {
    right
        .score
        .partial_cmp(&left.score)
        .unwrap_or(Ordering::Equal)
        .then_with(|| left.entry_title.cmp(&right.entry_title))
        .then_with(|| left.title.cmp(&right.title))
        // Stable identity decides equal titles, so truncation never depends on HashMap order.
        .then_with(|| crate::hit_identity(left).cmp(&crate::hit_identity(right)))
}

fn result_mode_and_warnings(mode: SearchMode) -> (String, Vec<String>) {
    match mode {
        SearchMode::Keyword => ("keyword".to_string(), Vec::new()),
        SearchMode::Hybrid => (
            "hybrid_fallback_keyword".to_string(),
            vec![
                "Embedding model resources are not available yet; showing keyword fallback results."
                    .to_string(),
            ],
        ),
        SearchMode::Semantic => (
            "semantic_fallback_keyword".to_string(),
            vec![
                "Semantic search requires a bundled local embedding model; showing keyword fallback results."
                    .to_string(),
            ],
        ),
    }
}

fn cache_key(query: &SearchQuery, normalized_query: &str) -> String {
    let mut scope = query
        .scope
        .entry_ids
        .iter()
        .map(|entry_id| entry_id.as_str().to_string())
        .collect::<Vec<_>>();
    scope.sort();
    format!(
        "{}|{:?}|{}|{}:{}:{}|{}|{:?}|{}|{}|{}",
        normalized_query,
        query.mode,
        query.limit,
        query.include.entry_meta,
        query.include.notes,
        query.include.segments,
        query.section_filter.as_deref().unwrap_or_default(),
        query.segment_types,
        scope.join(","),
        query.segments_only,
        query.filter_stopwords
    )
}

fn make_snippet(text: &str, query: &str, terms: &BTreeSet<String>) -> String {
    let clean = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.chars().count() <= 220 {
        return clean;
    }

    let lower = clean.to_lowercase();
    let position = lower
        .find(&query.to_lowercase())
        .or_else(|| terms.iter().find_map(|term| lower.find(term)));

    let Some(position) = position else {
        return trim_chars(&clean, 0, 220);
    };

    let start = position.saturating_sub(80);
    let end = (position + 140).min(clean.len());
    let start = floor_char_boundary(&clean, start);
    let end = ceil_char_boundary(&clean, end);
    let prefix = if start > 0 { "..." } else { "" };
    let suffix = if end < clean.len() { "..." } else { "" };
    format!("{prefix}{}{suffix}", clean[start..end].trim())
}

fn trim_chars(text: &str, start: usize, len: usize) -> String {
    let body = text.chars().skip(start).take(len).collect::<String>();
    if text.chars().count() > start + len {
        format!("{}...", body.trim())
    } else {
        body
    }
}

fn floor_char_boundary(text: &str, mut index: usize) -> usize {
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn ceil_char_boundary(text: &str, mut index: usize) -> usize {
    while index < text.len() && !text.is_char_boundary(index) {
        index += 1;
    }
    index
}

#[cfg(test)]
mod tests {
    use neuink_domain::{EntryId, SegmentUid};

    use super::*;
    use crate::{SearchDocumentSource, SearchDocumentSourceKind, SearchTarget, SearchTextSection};

    #[test]
    fn searches_keyword_documents() {
        let index = MemorySearchIndex::default();
        let entry_id = EntryId::from_string("entry-a");
        index
            .replace_documents(vec![SearchDocument {
                entry_id: entry_id.clone(),
                entry_title: "Retrieval paper".to_string(),
                source: SearchDocumentSource {
                    kind: SearchDocumentSourceKind::EntryTitle,
                    label: "Title".to_string(),
                    ..Default::default()
                },
                target: SearchTarget::Entry {
                    entry_id: entry_id.clone(),
                },
                title: "Retrieval paper".to_string(),
                sections: vec![SearchTextSection::title("Retrieval augmented generation")],
                boost: 2.0,
            }])
            .unwrap();

        let results = index.search(SearchQuery::new("retrieval")).unwrap();

        assert_eq!(results.total_hit_count, 1);
        assert_eq!(results.entries[0].entry_id, entry_id);
    }

    #[test]
    fn display_title_is_not_counted_again_when_title_section_exists() {
        let entry_id = EntryId::from_string("entry-a");
        let document = SearchDocument {
            entry_id: entry_id.clone(),
            entry_title: "Paper".to_string(),
            source: SearchDocumentSource::default(),
            target: SearchTarget::Entry { entry_id },
            title: "PDF Segment · Page 1 · paragraph".to_string(),
            sections: vec![
                SearchTextSection::with_boost("title", "PDF Segment · Page 1 · paragraph", 0.25),
                SearchTextSection::body("clean body"),
            ],
            boost: 1.0,
        };

        let indexed = index_document((0, document));
        let paragraph_weight = indexed
            .term_weights
            .get("paragraph")
            .copied()
            .expect("title token");
        assert!((paragraph_weight - 0.25).abs() < f32::EPSILON);
    }

    #[test]
    fn snippets_prefer_matching_body_context() {
        let index = MemorySearchIndex::default();
        let entry_id = EntryId::from_string("entry-a");
        index
            .replace_documents(vec![SearchDocument {
                entry_id: entry_id.clone(),
                entry_title: "Algorithm notes".to_string(),
                source: SearchDocumentSource {
                    kind: SearchDocumentSourceKind::Segment,
                    label: "PDF · Page 3".to_string(),
                    segment_uid: Some(SegmentUid::from_string("seg-a")),
                    page_idx: Some(2),
                    ..Default::default()
                },
                target: SearchTarget::Segment {
                    entry_id,
                    segment_uid: SegmentUid::from_string("seg-a"),
                    page_idx: 2,
                },
                title: "Page 3".to_string(),
                sections: vec![
                    SearchTextSection::title("Page 3"),
                    SearchTextSection::body(
                        "The role of this algorithm is to reduce repeated work during search.",
                    ),
                ],
                boost: 1.0,
            }])
            .unwrap();

        let results = index.search(SearchQuery::new("algorithm")).unwrap();
        let snippet = &results.entries[0].hits[0].snippet;

        assert!(snippet.contains("algorithm"));
        assert_ne!(snippet, "Page 3");
    }

    #[test]
    fn supports_cjk_bigram_queries() {
        let index = MemorySearchIndex::default();
        let entry_id = EntryId::from_string("entry-a");
        index
            .replace_documents(vec![SearchDocument {
                entry_id: entry_id.clone(),
                entry_title: "搜索".to_string(),
                source: SearchDocumentSource {
                    kind: SearchDocumentSourceKind::Segment,
                    label: "Segment".to_string(),
                    segment_uid: Some(SegmentUid::from_string("seg-a")),
                    page_idx: Some(0),
                    ..Default::default()
                },
                target: SearchTarget::Segment {
                    entry_id,
                    segment_uid: SegmentUid::from_string("seg-a"),
                    page_idx: 0,
                },
                title: "Page 1".to_string(),
                sections: vec![SearchTextSection::body("关键词搜索可以支撑问答接地")],
                boost: 1.0,
            }])
            .unwrap();

        let results = index.search(SearchQuery::new("搜索")).unwrap();

        assert_eq!(results.total_hit_count, 1);
    }

    #[test]
    fn hybrid_mode_falls_back_to_keyword_with_warning() {
        let index = MemorySearchIndex::default();
        let entry_id = EntryId::from_string("entry-a");
        index
            .replace_documents(vec![SearchDocument {
                entry_id: entry_id.clone(),
                entry_title: "Hybrid retrieval".to_string(),
                source: SearchDocumentSource {
                    kind: SearchDocumentSourceKind::Segment,
                    label: "Segment".to_string(),
                    segment_uid: Some(SegmentUid::from_string("seg-a")),
                    page_idx: Some(0),
                    ..Default::default()
                },
                target: SearchTarget::Segment {
                    entry_id,
                    segment_uid: SegmentUid::from_string("seg-a"),
                    page_idx: 0,
                },
                title: "Page 1".to_string(),
                sections: vec![SearchTextSection::body(
                    "Hybrid search should keep keyword recall available.",
                )],
                boost: 1.0,
            }])
            .unwrap();

        let mut query = SearchQuery::new("keyword recall");
        query.mode = SearchMode::Hybrid;
        let results = index.search(query).unwrap();

        assert_eq!(results.total_hit_count, 1);
        assert_eq!(results.mode, "hybrid_fallback_keyword");
        assert_eq!(results.warnings.len(), 1);
    }

    fn segment_document(entry: &str, segment: &str, body: &str) -> SearchDocument {
        let entry_id = EntryId::from_string(entry);
        SearchDocument {
            entry_id: entry_id.clone(),
            entry_title: entry.to_string(),
            source: SearchDocumentSource {
                kind: SearchDocumentSourceKind::Segment,
                label: "Segment".to_string(),
                segment_uid: Some(SegmentUid::from_string(segment)),
                page_idx: Some(0),
                ..Default::default()
            },
            target: SearchTarget::Segment {
                entry_id,
                segment_uid: SegmentUid::from_string(segment),
                page_idx: 0,
            },
            title: "Page 1".to_string(),
            sections: vec![SearchTextSection::body(body)],
            boost: 1.0,
        }
    }

    fn sectioned_segment(
        entry: &str,
        segment: &str,
        section_path: &str,
        body: &str,
        boost: f32,
    ) -> SearchDocument {
        let mut document = segment_document(entry, segment, body);
        document.source.section_path = Some(section_path.to_string());
        document.boost = boost;
        document
    }

    #[test]
    fn section_filter_runs_before_the_candidate_limit() {
        let index = MemorySearchIndex::default();
        index
            .replace_documents(vec![
                // Higher-scoring but outside the filter; must not take the single slot.
                sectioned_segment(
                    "entry-a",
                    "seg-off",
                    "Background",
                    "attention attention attention",
                    5.0,
                ),
                sectioned_segment(
                    "entry-a",
                    "seg-on",
                    "Methods > Answer",
                    "attention once",
                    1.0,
                ),
            ])
            .unwrap();
        let mut query = SearchQuery::new("attention");
        query.section_filter = Some("Answer".into());
        query.limit = 1;

        let results = index.search(query).unwrap();

        assert_eq!(results.total_hit_count, 1);
        assert!(results.entries[0].hits[0].snippet.contains("once"));
    }

    #[test]
    fn bm25_prefers_focused_segments_over_long_pages() {
        let index = MemorySearchIndex::default();
        let filler = "unrelated background discussion ".repeat(120);
        index
            .replace_documents(vec![
                segment_document(
                    "entry-long",
                    "seg-long",
                    &format!("{filler} attention {filler}"),
                ),
                segment_document("entry-short", "seg-short", "Sparse attention reduces cost."),
                segment_document("entry-other", "seg-other", "Convolution baseline results."),
            ])
            .unwrap();

        let results = index.search(SearchQuery::new("attention")).unwrap();

        assert_eq!(results.entries[0].entry_id.as_str(), "entry-short");
    }

    #[test]
    fn bm25_saturates_repeated_terms() {
        let index = MemorySearchIndex::default();
        index
            .replace_documents(vec![
                segment_document("entry-spam", "seg-spam", &"retrieval ".repeat(50)),
                segment_document(
                    "entry-both",
                    "seg-both",
                    "retrieval with reranking and retrieval",
                ),
                segment_document("entry-other", "seg-other", "Unrelated text about parsing."),
            ])
            .unwrap();

        let results = index
            .search(SearchQuery::new("retrieval reranking"))
            .unwrap();

        // Matching both query terms beats spamming one, which BM25 caps via k1.
        assert_eq!(results.entries[0].entry_id.as_str(), "entry-both");
    }

    #[test]
    fn hybrid_query_cache_key_keeps_mode() {
        let index = MemorySearchIndex::default();
        index
            .replace_documents(vec![segment_document("entry-a", "seg-a", "keyword recall")])
            .unwrap();
        let mut query = SearchQuery::new("keyword recall");
        query.mode = SearchMode::Hybrid;
        let results = index.search(query).unwrap();

        assert_eq!(results.total_hit_count, 1);
        assert_eq!(results.mode, "hybrid_fallback_keyword");
        assert_eq!(results.warnings.len(), 1);
    }
}
