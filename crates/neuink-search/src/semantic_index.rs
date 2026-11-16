use std::{cmp::Ordering, collections::BTreeMap};

use rayon::prelude::*;

use crate::embedding_representation::{
    embed_query_vector, embedding_text, included_by_query, matches_semantic_document,
    normalize_embedding_vector as normalize, validate_embedding_vector, validate_embedding_vectors,
    SemanticVectorDocument,
};

use crate::{
    EmbeddingInput, EmbeddingProvider, SearchDocument, SearchEntryGroup, SearchHit, SearchInclude,
    SearchQuery, SearchResult, SearchResults,
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
        validate_embedding_vectors(&vectors, inputs.len(), provider.status().dimensions)?;
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

    pub fn vector_documents(&self) -> impl Iterator<Item = SemanticVectorDocument<'_>> {
        self.documents.iter().map(|indexed| SemanticVectorDocument {
            document: &indexed.document,
            vector: &indexed.vector,
        })
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
        let query_vector = embed_query_vector(provider, normalized_query)?;
        self.search_with_vector(
            query,
            normalized_query,
            &query_vector,
            result_mode,
            warnings,
            index_generation,
        )
    }

    pub fn search_with_vector(
        &self,
        query: &SearchQuery,
        normalized_query: &str,
        query_vector: &[f32],
        result_mode: impl Into<String>,
        warnings: Vec<String>,
        index_generation: u64,
    ) -> SearchResult<SearchResults> {
        validate_embedding_vector(
            query_vector,
            self.documents.first().map(|indexed| indexed.vector.len()),
        )?;
        let query_vector = normalize(query_vector.to_vec());

        let mut hits = self
            .documents
            .par_iter()
            .filter(|indexed| matches_semantic_document(query, &indexed.document))
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

#[cfg(test)]
mod tests {
    use super::embedding_text;
    use crate::{SearchDocument, SearchDocumentSource, SearchTarget, SearchTextSection};
    use neuink_domain::EntryId;

    #[test]
    fn embedding_text_uses_one_passage_prefix_and_one_title() {
        let entry_id = EntryId::from_string("entry-a");
        let document = SearchDocument {
            entry_id: entry_id.clone(),
            entry_title: "Entry title".to_string(),
            source: SearchDocumentSource::default(),
            target: SearchTarget::Entry { entry_id },
            title: "Display title".to_string(),
            sections: vec![
                SearchTextSection::title("Display title"),
                SearchTextSection::body("Clean body"),
            ],
            boost: 1.0,
        };

        assert_eq!(
            embedding_text(&document),
            "passage: Display title\nClean body"
        );
    }
}
