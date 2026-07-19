use std::{cmp::Ordering, collections::BTreeMap};

use rayon::prelude::*;

use crate::{
    EmbeddingInput, EmbeddingProvider, SearchDocument, SearchDocumentSourceKind, SearchEntryGroup,
    SearchHit, SearchInclude, SearchMode, SearchQuery, SearchResult, SearchResults,
    SearchTextSection,
};

#[derive(Debug)]
pub struct InMemorySemanticSearchIndex {
    documents: Vec<SemanticDocument>,
}

impl InMemorySemanticSearchIndex {
    pub fn build(
        documents: &[SearchDocument],
        provider: &dyn EmbeddingProvider,
        include: &SearchInclude,
    ) -> SearchResult<Self> {
        let inputs = documents
            .iter()
            .enumerate()
            .filter(|(_, document)| included_by_query(include, document.source.kind))
            .map(|(index, document)| EmbeddingInput {
                id: index.to_string(),
                text: embedding_text(document),
            })
            .collect::<Vec<_>>();

        let vectors = provider.embed(&inputs)?;
        let mut semantic_documents = Vec::with_capacity(vectors.len());
        for (input, vector) in inputs.into_iter().zip(vectors.into_iter()) {
            let document_index = input.id.parse::<usize>().unwrap_or_default();
            if let Some(document) = documents.get(document_index) {
                semantic_documents.push(SemanticDocument {
                    document: document.clone(),
                    text_for_snippet: document.text_for_snippet(),
                    vector: normalize(vector.values),
                });
            }
        }

        Ok(Self {
            documents: semantic_documents,
        })
    }

    pub fn document_count(&self) -> usize {
        self.documents.len()
    }

    pub fn search(
        &self,
        query: &SearchQuery,
        normalized_query: &str,
        provider: &dyn EmbeddingProvider,
        result_mode: impl Into<String>,
        warnings: Vec<String>,
        index_generation: u64,
    ) -> SearchResult<SearchResults> {
        let query_vector = provider
            .embed(&[EmbeddingInput {
                id: "query".to_string(),
                text: normalized_query.to_string(),
            }])?
            .into_iter()
            .next()
            .map(|vector| normalize(vector.values))
            .unwrap_or_default();

        let mut hits = self
            .documents
            .par_iter()
            .filter(|indexed| {
                query.scope.contains_entry(&indexed.document.entry_id)
                    && included_by_query(&query.include, indexed.document.source.kind)
            })
            .filter_map(|indexed| {
                let score = dot_product(&query_vector, &indexed.vector);
                if !score.is_finite() {
                    return None;
                }
                Some(SearchHit {
                    entry_id: indexed.document.entry_id.clone(),
                    entry_title: indexed.document.entry_title.clone(),
                    source: indexed.document.source.clone(),
                    target: indexed.document.target.clone(),
                    title: indexed.document.title.clone(),
                    snippet: make_semantic_snippet(&indexed.text_for_snippet),
                    score,
                    matched_terms: Vec::new(),
                })
            })
            .collect::<Vec<_>>();

        hits.sort_by(compare_hits);
        hits.truncate(query.limit);
        Ok(group_hits(
            normalized_query.to_string(),
            result_mode.into(),
            index_generation,
            hits,
            warnings,
        ))
    }
}

#[derive(Clone, Debug)]
struct SemanticDocument {
    document: SearchDocument,
    text_for_snippet: String,
    vector: Vec<f32>,
}

pub fn merge_hybrid_results(
    query: String,
    index_generation: u64,
    keyword_results: SearchResults,
    semantic_results: SearchResults,
    limit: usize,
    warnings: Vec<String>,
) -> SearchResults {
    let keyword_hits = flatten_hits(keyword_results);
    let semantic_hits = flatten_hits(semantic_results);
    let mut scored = Vec::<(String, SearchHit, f32)>::new();

    for (rank, hit) in keyword_hits.into_iter().enumerate() {
        let key = hit_key(&hit);
        scored.push((key, hit, 1.0 / (60.0 + rank as f32 + 1.0)));
    }

    for (rank, hit) in semantic_hits.into_iter().enumerate() {
        let key = hit_key(&hit);
        scored.push((key, hit, 1.0 / (60.0 + rank as f32 + 1.0)));
    }

    let mut by_key = BTreeMap::<String, (SearchHit, f32)>::new();
    for (key, hit, score) in scored {
        let entry = by_key.entry(key).or_insert((hit, 0.0));
        entry.1 += score;
    }

    let mut hits = by_key
        .into_values()
        .map(|(mut hit, score)| {
            hit.score = score;
            hit
        })
        .collect::<Vec<_>>();
    hits.sort_by(compare_hits);
    hits.truncate(limit);
    group_hits(
        query,
        "hybrid".to_string(),
        index_generation,
        hits,
        warnings,
    )
}

fn flatten_hits(results: SearchResults) -> Vec<SearchHit> {
    results
        .entries
        .into_iter()
        .flat_map(|entry| entry.hits)
        .collect()
}

fn group_hits(
    query: String,
    mode: String,
    index_generation: u64,
    hits: Vec<SearchHit>,
    warnings: Vec<String>,
) -> SearchResults {
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
    SearchResults {
        query,
        mode,
        index_generation,
        total_hit_count,
        entries,
        warnings,
    }
}

fn embedding_text(document: &SearchDocument) -> String {
    let mut parts = Vec::with_capacity(document.sections.len() + 1);
    if !document.title.trim().is_empty() {
        parts.push(document.title.trim().to_string());
    }
    for section in &document.sections {
        if let Some(text) = section_text(section) {
            parts.push(text);
        }
    }
    parts.join("\n")
}

fn section_text(section: &SearchTextSection) -> Option<String> {
    let text = section.text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn normalize(mut values: Vec<f32>) -> Vec<f32> {
    let norm = values.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 0.0 {
        for value in &mut values {
            *value /= norm;
        }
    }
    values
}

fn dot_product(left: &[f32], right: &[f32]) -> f32 {
    left.iter()
        .zip(right.iter())
        .map(|(left, right)| left * right)
        .sum()
}

fn make_semantic_snippet(text: &str) -> String {
    let clean = text.split_whitespace().collect::<Vec<_>>().join(" ");
    trim_chars(&clean, 0, 220)
}

fn trim_chars(text: &str, start: usize, len: usize) -> String {
    let body = text.chars().skip(start).take(len).collect::<String>();
    if text.chars().count() > start + len {
        format!("{}...", body.trim())
    } else {
        body
    }
}

fn included_by_query(include: &SearchInclude, kind: SearchDocumentSourceKind) -> bool {
    match kind {
        SearchDocumentSourceKind::EntryTitle
        | SearchDocumentSourceKind::EntryField
        | SearchDocumentSourceKind::EntryTag => include.entry_meta,
        SearchDocumentSourceKind::NoteTitle
        | SearchDocumentSourceKind::NoteBody
        | SearchDocumentSourceKind::SegmentNote
        | SearchDocumentSourceKind::Annotation => include.notes,
        SearchDocumentSourceKind::PdfPage | SearchDocumentSourceKind::Segment => include.segments,
    }
}

fn compare_hits(left: &SearchHit, right: &SearchHit) -> Ordering {
    right
        .score
        .partial_cmp(&left.score)
        .unwrap_or(Ordering::Equal)
        .then_with(|| left.entry_title.cmp(&right.entry_title))
        .then_with(|| left.title.cmp(&right.title))
}

fn hit_key(hit: &SearchHit) -> String {
    let source_kind = format!("{:?}", hit.source.kind);
    match &hit.target {
        crate::SearchTarget::Entry { entry_id } => {
            format!("entry:{}:{source_kind}", entry_id.as_str())
        }
        crate::SearchTarget::Note { entry_id, note_id } => {
            format!("note:{}:{}:{source_kind}", entry_id.as_str(), note_id.as_str())
        }
        crate::SearchTarget::Page { entry_id, page_idx } => {
            format!("page:{}:{}:{source_kind}", entry_id.as_str(), page_idx)
        }
        crate::SearchTarget::Segment {
            entry_id,
            segment_uid,
            page_idx,
        } => format!(
            "segment:{}:{}:{}:{source_kind}",
            entry_id.as_str(),
            segment_uid.as_str(),
            page_idx
        ),
    }
}

pub fn semantic_result_mode(mode: SearchMode) -> &'static str {
    match mode {
        SearchMode::Keyword => "keyword",
        SearchMode::Semantic => "semantic",
        SearchMode::Hybrid => "semantic",
    }
}
