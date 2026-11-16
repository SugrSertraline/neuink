use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::embedding_representation::{
    embed_query_vector, embedding_text, included_by_query, matches_semantic_document,
    normalize_embedding_vector as normalize, semantic_embedding_identity, stable_document_key,
    validate_embedding_vector, validate_embedding_vectors, SemanticVectorDocument,
    EMBEDDING_REPRESENTATION_VERSION,
};

use crate::{
    adaptive_hybrid_weights, weighted_reciprocal_rank_fusion, EmbeddingInput, EmbeddingProvider,
    SearchDocument, SearchEntryGroup, SearchError, SearchHit, SearchInclude, SearchMode,
    SearchQuery, SearchResult, SearchResults, SearchTarget,
};

pub const INDEX_FORMAT_VERSION: u32 = 6;
pub const SEMANTIC_INDEX_FORMAT_VERSION: u32 = INDEX_FORMAT_VERSION;

#[derive(Debug)]
pub struct PersistentSemanticSearchIndex {
    documents: Vec<PersistentSemanticDocument>,
    embedding_identity: Option<String>,
    chapters: OnceLock<crate::ChapterCentroids>,
}

impl PersistentSemanticSearchIndex {
    pub fn open_or_build(
        path: impl AsRef<Path>,
        documents: &[SearchDocument],
        provider: &dyn EmbeddingProvider,
        include: &SearchInclude,
        fingerprint: u64,
    ) -> SearchResult<Self> {
        Self::open_or_build_with_progress(
            path,
            documents,
            provider,
            include,
            fingerprint,
            &|_, _| {},
        )
    }

    /// Opens the index from disk only when the cached snapshot matches the
    /// current fingerprint. Never embeds documents or writes to disk.
    /// The caller must bind the path namespace to the model identity. Prefer
    /// `open_cached_with_identity` when a provider is available.
    pub fn open_cached(
        path: impl AsRef<Path>,
        documents: &[SearchDocument],
        include: &SearchInclude,
        fingerprint: u64,
    ) -> SearchResult<Option<Self>> {
        Self::try_open(path.as_ref(), documents, include, fingerprint, None)
    }

    /// Verifies the model contents as well as the document fingerprint without
    /// running embedding inference or changing the snapshot.
    pub fn open_cached_with_identity(
        path: impl AsRef<Path>,
        documents: &[SearchDocument],
        include: &SearchInclude,
        fingerprint: u64,
        embedding_identity: &str,
    ) -> SearchResult<Option<Self>> {
        Self::try_open(
            path.as_ref(),
            documents,
            include,
            fingerprint,
            Some(embedding_identity),
        )
    }

    pub fn open_or_build_with_progress(
        path: impl AsRef<Path>,
        documents: &[SearchDocument],
        provider: &dyn EmbeddingProvider,
        include: &SearchInclude,
        fingerprint: u64,
        on_progress: &dyn Fn(usize, usize),
    ) -> SearchResult<Self> {
        let path = path.as_ref();
        let identity = semantic_embedding_identity(provider);
        if let Some(identity) = identity.as_deref() {
            if let Some(index) =
                Self::try_open(path, documents, include, fingerprint, Some(identity))?
            {
                let total = index.document_count();
                on_progress(total, total);
                return Ok(index);
            }
        }

        let cached_vectors = Self::read_cached_vectors(path, identity.as_deref())?;
        let index = Self::build_reusing(documents, provider, include, cached_vectors, on_progress)?;
        index.persist(path, fingerprint)?;
        Ok(index)
    }

    pub fn build(
        documents: &[SearchDocument],
        provider: &dyn EmbeddingProvider,
        include: &SearchInclude,
    ) -> SearchResult<Self> {
        Self::build_reusing(documents, provider, include, HashMap::new(), &|_, _| {})
    }

    fn build_reusing(
        documents: &[SearchDocument],
        provider: &dyn EmbeddingProvider,
        include: &SearchInclude,
        mut by_id: HashMap<String, Vec<f32>>,
        on_progress: &dyn Fn(usize, usize),
    ) -> SearchResult<Self> {
        let inputs = documents
            .iter()
            .filter(|document| included_by_query(include, document.source.kind))
            .map(|document| EmbeddingInput {
                id: stable_document_key(document),
                text: embedding_text(document),
            })
            .collect::<Vec<_>>();

        let total = inputs.len();
        let missing_inputs = inputs
            .into_iter()
            .filter(|input| !by_id.contains_key(&input.id))
            .collect::<Vec<_>>();
        let reused = total.saturating_sub(missing_inputs.len());
        on_progress(reused, total);
        let vectors = if missing_inputs.is_empty() {
            Vec::new()
        } else {
            provider.embed_with_progress(&missing_inputs, &|completed, _| {
                on_progress(reused + completed, total);
            })?
        };
        validate_embedding_vectors(&vectors, missing_inputs.len(), provider.status().dimensions)?;
        by_id.extend(
            missing_inputs
                .into_iter()
                .zip(vectors)
                .map(|(input, vector)| (input.id, normalize(vector.values))),
        );

        Ok(Self {
            documents: semantic_documents_from_vectors(documents, include, by_id),
            embedding_identity: semantic_embedding_identity(provider),
            chapters: OnceLock::new(),
        })
    }

    pub fn document_count(&self) -> usize {
        self.documents.len()
    }

    /// Borrows existing normalized document vectors; no inference or copying.
    pub fn vector_documents(&self) -> impl Iterator<Item = SemanticVectorDocument<'_>> {
        self.documents.iter().map(|indexed| SemanticVectorDocument {
            document: &indexed.document,
            vector: &indexed.vector,
        })
    }

    /// Section vectors are derived once from the immutable document snapshot.
    /// Repeated queries reuse both paragraph and section vectors.
    pub fn chapter_centroids(&self) -> &crate::ChapterCentroids {
        self.chapters
            .get_or_init(|| crate::ChapterCentroids::from_vectors(self.vector_documents()))
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

    fn try_open(
        path: &Path,
        documents: &[SearchDocument],
        include: &SearchInclude,
        fingerprint: u64,
        expected_identity: Option<&str>,
    ) -> SearchResult<Option<Self>> {
        if !path.is_file() {
            return Ok(None);
        }

        let bytes = fs::read(path).map_err(io_error)?;
        let Ok(snapshot) = serde_json::from_slice::<PersistedSemanticIndex>(&bytes) else {
            return Ok(None);
        };
        if snapshot.version != SEMANTIC_INDEX_FORMAT_VERSION
            || snapshot.representation_version != EMBEDDING_REPRESENTATION_VERSION
            || snapshot.fingerprint != fingerprint
            || expected_identity
                .is_some_and(|identity| snapshot.embedding_identity.as_deref() != Some(identity))
            || !snapshot.valid_vectors()
        {
            return Ok(None);
        }

        let vectors = snapshot
            .records
            .into_iter()
            .map(|record| (record.id, record.vector))
            .collect::<HashMap<_, _>>();
        let indexed_documents = semantic_documents_from_vectors(documents, include, vectors);
        let expected_count = documents
            .iter()
            .filter(|document| included_by_query(include, document.source.kind))
            .count();
        if indexed_documents.len() != expected_count {
            return Ok(None);
        }
        Ok(Some(Self {
            documents: indexed_documents,
            embedding_identity: snapshot.embedding_identity,
            chapters: OnceLock::new(),
        }))
    }

    fn read_cached_vectors(
        path: &Path,
        identity: Option<&str>,
    ) -> SearchResult<HashMap<String, Vec<f32>>> {
        let Some(identity) = identity else {
            return Ok(HashMap::new());
        };
        if !path.is_file() {
            return Ok(HashMap::new());
        }
        let bytes = fs::read(path).map_err(io_error)?;
        let Ok(snapshot) = serde_json::from_slice::<PersistedSemanticIndex>(&bytes) else {
            return Ok(HashMap::new());
        };
        if snapshot.version != SEMANTIC_INDEX_FORMAT_VERSION
            || snapshot.representation_version != EMBEDDING_REPRESENTATION_VERSION
            || snapshot.embedding_identity.as_deref() != Some(identity)
            || !snapshot.valid_vectors()
        {
            return Ok(HashMap::new());
        }
        Ok(snapshot
            .records
            .into_iter()
            .map(|record| (record.id, record.vector))
            .collect())
    }

    fn persist(&self, path: &Path, fingerprint: u64) -> SearchResult<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(io_error)?;
        }

        let snapshot = PersistedSemanticIndex {
            version: SEMANTIC_INDEX_FORMAT_VERSION,
            fingerprint,
            representation_version: EMBEDDING_REPRESENTATION_VERSION,
            embedding_identity: self.embedding_identity.clone(),
            dimensions: self
                .documents
                .first()
                .map(|indexed| indexed.vector.len())
                .unwrap_or_default(),
            records: self
                .documents
                .iter()
                .map(|document| PersistedSemanticRecord {
                    id: document.id.clone(),
                    vector: document.vector.clone(),
                })
                .collect(),
        };
        let bytes = serde_json::to_vec(&snapshot)
            .map_err(|error| SearchError::VectorIndexIo(error.to_string()))?;
        let tmp = tmp_path(path);
        fs::write(&tmp, bytes).map_err(io_error)?;
        fs::rename(tmp, path).map_err(io_error)?;
        Ok(())
    }
}

#[derive(Clone, Debug)]
struct PersistentSemanticDocument {
    id: String,
    document: SearchDocument,
    text_for_snippet: String,
    vector: Vec<f32>,
}

#[derive(Debug, Deserialize, Serialize)]
struct PersistedSemanticIndex {
    version: u32,
    fingerprint: u64,
    #[serde(default)]
    representation_version: u32,
    #[serde(default)]
    embedding_identity: Option<String>,
    #[serde(default)]
    dimensions: usize,
    records: Vec<PersistedSemanticRecord>,
}

impl PersistedSemanticIndex {
    fn valid_vectors(&self) -> bool {
        self.records
            .iter()
            .all(|record| validate_embedding_vector(&record.vector, Some(self.dimensions)).is_ok())
    }
}

#[derive(Debug, Deserialize, Serialize)]
struct PersistedSemanticRecord {
    id: String,
    vector: Vec<f32>,
}

pub fn semantic_index_path(cache_dir: impl AsRef<Path>, namespace: &str) -> PathBuf {
    cache_dir
        .as_ref()
        .join("search")
        .join(format!("{namespace}.vectors.json"))
}

pub fn semantic_result_mode(mode: SearchMode) -> &'static str {
    match mode {
        SearchMode::Keyword => "keyword",
        SearchMode::Semantic => "semantic",
        SearchMode::Hybrid => "semantic",
    }
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
    let top_keyword_terms = keyword_hits.first().map(|hit| hit.matched_terms.as_slice());
    let (keyword_weight, semantic_weight) = adaptive_hybrid_weights(&query, top_keyword_terms);
    let keyword_keys = keyword_hits.iter().map(hit_key).collect::<Vec<_>>();
    let semantic_keys = semantic_hits.iter().map(hit_key).collect::<Vec<_>>();
    let fused = weighted_reciprocal_rank_fusion(
        &[keyword_keys, semantic_keys],
        &[keyword_weight, semantic_weight],
        60.0,
    );
    let mut hit_by_key = BTreeMap::<String, SearchHit>::new();
    for hit in keyword_hits.into_iter().chain(semantic_hits) {
        hit_by_key.entry(hit_key(&hit)).or_insert(hit);
    }
    let mut hits = fused
        .into_iter()
        .filter_map(|(key, score)| {
            let mut hit = hit_by_key.remove(&key)?;
            hit.score = score;
            Some(hit)
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

fn semantic_documents_from_vectors(
    documents: &[SearchDocument],
    include: &SearchInclude,
    vectors: HashMap<String, Vec<f32>>,
) -> Vec<PersistentSemanticDocument> {
    documents
        .iter()
        .filter(|document| included_by_query(include, document.source.kind))
        .filter_map(|document| {
            let key = stable_document_key(document);
            let vector = vectors.get(&key)?;
            Some(PersistentSemanticDocument {
                id: key,
                document: document.clone(),
                text_for_snippet: document.text_for_snippet(),
                vector: vector.clone(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        fs,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Mutex,
        },
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{embedding_text, stable_document_key, PersistentSemanticSearchIndex};
    use crate::{
        EmbeddingInput, EmbeddingProvider, EmbeddingProviderStatus, EmbeddingVector,
        SearchDocument, SearchDocumentSource, SearchInclude, SearchResult, SearchTarget,
        SearchTextSection,
    };
    use neuink_domain::EntryId;

    #[test]
    fn semantic_document_key_does_not_depend_on_collection_position() {
        let first = document("entry-a", "Alpha");
        let second = document("entry-b", "Beta");
        let original = [stable_document_key(&first), stable_document_key(&second)];
        let reordered = [stable_document_key(&second), stable_document_key(&first)];
        assert_eq!(original[0], reordered[1]);
        assert_eq!(original[1], reordered[0]);
    }

    #[test]
    fn semantic_document_key_changes_with_embedding_content() {
        assert_ne!(
            stable_document_key(&document("entry-a", "Alpha")),
            stable_document_key(&document("entry-a", "Changed"))
        );
    }

    #[test]
    fn embedding_text_uses_one_passage_prefix_and_one_title() {
        let document = document("entry-a", "Alpha");
        assert_eq!(embedding_text(&document), "passage: Alpha");
    }

    #[test]
    fn disk_cache_reuses_unchanged_vectors_after_content_changes() {
        let cache_dir = std::env::temp_dir().join(format!(
            "neuink-vector-cache-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let cache_path = cache_dir.join("semantic.vectors.json");
        let provider = CountingProvider::default();
        let include = SearchInclude::default();
        let original = vec![document("entry-a", "Alpha"), document("entry-b", "Beta")];
        PersistentSemanticSearchIndex::open_or_build(
            &cache_path,
            &original,
            &provider,
            &include,
            1,
        )
        .expect("initial build");
        assert_eq!(provider.embedded.load(Ordering::SeqCst), 2);

        let reordered = vec![document("entry-b", "Beta"), document("entry-a", "Alpha")];
        let reopened = PersistentSemanticSearchIndex::open_or_build(
            &cache_path,
            &reordered,
            &provider,
            &include,
            1,
        )
        .expect("cached reopen");
        assert_eq!(reopened.document_count(), 2);
        assert_eq!(provider.embedded.load(Ordering::SeqCst), 2);

        let changed = vec![
            document("entry-b", "Beta"),
            document("entry-a", "Alpha"),
            document("entry-c", "Gamma"),
        ];
        let reopened = PersistentSemanticSearchIndex::open_or_build(
            &cache_path,
            &changed,
            &provider,
            &include,
            2,
        )
        .expect("incremental build");
        assert_eq!(reopened.document_count(), 3);
        assert_eq!(provider.embedded.load(Ordering::SeqCst), 3);
        let _ = fs::remove_dir_all(cache_dir);
    }

    #[test]
    fn semantic_build_reports_reuse_and_embedding_progress() {
        let provider = CountingProvider::default();
        let documents = vec![document("entry-a", "Alpha"), document("entry-b", "Beta")];
        let progress = Mutex::new(Vec::new());

        let index = PersistentSemanticSearchIndex::build_reusing(
            &documents,
            &provider,
            &SearchInclude::default(),
            HashMap::new(),
            &|completed, total| progress.lock().unwrap().push((completed, total)),
        )
        .expect("semantic build");

        assert_eq!(index.document_count(), 2);
        let progress = progress.into_inner().unwrap();
        assert_eq!(progress.first(), Some(&(0, 2)));
        assert_eq!(progress.last(), Some(&(2, 2)));
    }

    #[test]
    fn chapter_centroids_are_cached_without_extra_embedding_inference() {
        let provider = CountingProvider::default();
        let documents = vec![document("entry-a", "Alpha")];
        let index =
            PersistentSemanticSearchIndex::build(&documents, &provider, &SearchInclude::default())
                .unwrap();
        let first = index.chapter_centroids();
        let second = index.chapter_centroids();
        assert!(std::ptr::eq(first, second));
        assert_eq!(provider.embedded.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn restart_translation_weights_and_display_labels_reuse_vectors_but_body_changes_once() {
        let cache_dir = test_cache_dir("representation");
        let cache_path = cache_dir.join("semantic.vectors.json");
        let provider = CountingProvider::default();
        let include = SearchInclude::default();
        let original = vec![document("entry-a", "Alpha"), document("entry-b", "Beta")];
        PersistentSemanticSearchIndex::open_or_build(
            &cache_path,
            &original,
            &provider,
            &include,
            1,
        )
        .unwrap();
        assert_eq!(provider.embedded.load(Ordering::SeqCst), 2);

        let mut changed = original.clone();
        changed[0]
            .sections
            .push(SearchTextSection::with_boost("translation", "译文", 0.85));
        changed[0].boost = 0.35;
        changed[0].sections[0].boost = 4.0;
        changed[0].source.label = "A display label".to_string();
        let index = PersistentSemanticSearchIndex::open_or_build(
            &cache_path,
            &changed,
            &provider,
            &include,
            2,
        )
        .unwrap();
        assert_eq!(index.document_count(), 2);
        assert_eq!(provider.embedded.load(Ordering::SeqCst), 2);
        drop(index);

        let identity = super::semantic_embedding_identity(&provider).unwrap();
        let restarted = PersistentSemanticSearchIndex::open_cached_with_identity(
            &cache_path,
            &changed,
            &include,
            2,
            &identity,
        )
        .unwrap()
        .unwrap();
        assert_eq!(restarted.vector_documents().count(), 2);
        assert_eq!(provider.embedded.load(Ordering::SeqCst), 2);

        changed[0].sections[0].text = "Changed original body".to_string();
        PersistentSemanticSearchIndex::open_or_build(&cache_path, &changed, &provider, &include, 3)
            .unwrap();
        assert_eq!(provider.embedded.load(Ordering::SeqCst), 3);
        fs::remove_dir_all(cache_dir).unwrap();
    }

    #[test]
    fn changing_model_contents_rebuilds_all_vectors_in_the_same_cache_path() {
        let cache_dir = test_cache_dir("model-change");
        let cache_path = cache_dir.join("semantic.vectors.json");
        let include = SearchInclude::default();
        let documents = vec![document("entry-a", "Alpha"), document("entry-b", "Beta")];
        let first = CountingProvider::default();
        PersistentSemanticSearchIndex::open_or_build(&cache_path, &documents, &first, &include, 1)
            .unwrap();
        let replacement = CountingProvider {
            model: "different-weights".to_string(),
            ..CountingProvider::default()
        };
        let identity = super::semantic_embedding_identity(&replacement).unwrap();
        assert!(PersistentSemanticSearchIndex::open_cached_with_identity(
            &cache_path,
            &documents,
            &include,
            1,
            &identity,
        )
        .unwrap()
        .is_none());
        PersistentSemanticSearchIndex::open_or_build(
            &cache_path,
            &documents,
            &replacement,
            &include,
            1,
        )
        .unwrap();
        assert_eq!(replacement.embedded.load(Ordering::SeqCst), 2);
        PersistentSemanticSearchIndex::open_or_build(
            &cache_path,
            &documents,
            &replacement,
            &include,
            1,
        )
        .unwrap();
        assert_eq!(replacement.embedded.load(Ordering::SeqCst), 2);
        fs::remove_dir_all(cache_dir).unwrap();
    }

    #[test]
    fn legacy_or_corrupt_snapshot_rebuilds_once_instead_of_returning_partial_ready_index() {
        let cache_dir = test_cache_dir("legacy");
        let cache_path = cache_dir.join("semantic.vectors.json");
        let provider = CountingProvider::default();
        let include = SearchInclude::default();
        let documents = vec![document("entry-a", "Alpha"), document("entry-b", "Beta")];
        PersistentSemanticSearchIndex::open_or_build(
            &cache_path,
            &documents,
            &provider,
            &include,
            1,
        )
        .unwrap();
        let mut snapshot: serde_json::Value =
            serde_json::from_slice(&fs::read(&cache_path).unwrap()).unwrap();
        snapshot["version"] = 4.into();
        fs::write(&cache_path, serde_json::to_vec(&snapshot).unwrap()).unwrap();
        PersistentSemanticSearchIndex::open_or_build(
            &cache_path,
            &documents,
            &provider,
            &include,
            1,
        )
        .unwrap();
        assert_eq!(provider.embedded.load(Ordering::SeqCst), 4);
        PersistentSemanticSearchIndex::open_or_build(
            &cache_path,
            &documents,
            &provider,
            &include,
            1,
        )
        .unwrap();
        assert_eq!(provider.embedded.load(Ordering::SeqCst), 4);

        let mut snapshot: serde_json::Value =
            serde_json::from_slice(&fs::read(&cache_path).unwrap()).unwrap();
        snapshot["records"][0]["vector"] = serde_json::json!([1.0]);
        fs::write(&cache_path, serde_json::to_vec(&snapshot).unwrap()).unwrap();
        let rebuilt = PersistentSemanticSearchIndex::open_or_build(
            &cache_path,
            &documents,
            &provider,
            &include,
            1,
        )
        .unwrap();
        assert_eq!(rebuilt.document_count(), 2);
        assert_eq!(provider.embedded.load(Ordering::SeqCst), 6);
        fs::remove_dir_all(cache_dir).unwrap();
    }

    #[test]
    fn shared_vector_search_and_in_memory_search_apply_identical_prefilters_without_inference() {
        use crate::{
            InMemorySemanticSearchIndex, SearchDocumentSourceKind, SearchQuery, SearchScope,
        };
        use neuink_domain::{SegmentType, SegmentUid};
        let provider = CountingProvider::default();
        let mut documents = vec![
            document("entry-a", "Alpha"),
            document("entry-b", "Beta"),
            document("entry-a", "Entry title"),
        ];
        for (index, document) in documents.iter_mut().take(2).enumerate() {
            document.source.kind = SearchDocumentSourceKind::Segment;
            document.source.section_id = Some("section-1".to_string());
            document.source.section_path = Some("Methods / Dataset".to_string());
            document.source.segment_type = Some(if index == 0 {
                SegmentType::Table
            } else {
                SegmentType::Figure
            });
            document.target = SearchTarget::Segment {
                entry_id: document.entry_id.clone(),
                segment_uid: SegmentUid::from_string(format!("segment-{index}")),
                page_idx: 0,
            };
        }
        let persistent =
            PersistentSemanticSearchIndex::build(&documents, &provider, &SearchInclude::default())
                .unwrap();
        let in_memory =
            InMemorySemanticSearchIndex::build(&documents, &provider, &SearchInclude::default())
                .unwrap();
        let before_search = provider.embedded.load(Ordering::SeqCst);
        let mut query = SearchQuery::new("Dataset");
        query.scope = SearchScope {
            entry_ids: vec![EntryId::from_string("entry-a")],
        };
        query.section_filter = Some("section-1".to_string());
        query.segment_types = vec![SegmentType::Table];
        query.segments_only = true;
        for result in [
            persistent
                .search_with_vector(&query, "Dataset", &[1.0, 0.0], "semantic", vec![], 0)
                .unwrap(),
            in_memory
                .search_with_vector(&query, "Dataset", &[1.0, 0.0], "semantic", vec![], 0)
                .unwrap(),
        ] {
            assert_eq!(result.total_hit_count, 1);
            assert_eq!(result.entries[0].entry_id, EntryId::from_string("entry-a"));
            assert_eq!(
                result.entries[0].hits[0].source.segment_type,
                Some(SegmentType::Table)
            );
        }
        assert_eq!(provider.embedded.load(Ordering::SeqCst), before_search);
        assert!(persistent
            .search_with_vector(&query, "Dataset", &[1.0], "semantic", vec![], 0)
            .is_err());
        query.segment_types = vec![SegmentType::Figure];
        assert_eq!(
            persistent
                .search_with_vector(&query, "Dataset", &[1.0, 0.0], "semantic", vec![], 0)
                .unwrap()
                .total_hit_count,
            0
        );
    }

    fn test_cache_dir(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "neuink-cache-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[derive(Default)]
    struct CountingProvider {
        embedded: AtomicUsize,
        model: String,
    }

    impl EmbeddingProvider for CountingProvider {
        fn status(&self) -> EmbeddingProviderStatus {
            EmbeddingProviderStatus {
                available: true,
                provider: "test".to_string(),
                dimensions: Some(2),
                ..EmbeddingProviderStatus::default()
            }
        }

        fn cache_identity(&self) -> Option<String> {
            Some(format!("counting-provider-weights:{}", self.model))
        }

        fn embed(&self, inputs: &[EmbeddingInput]) -> SearchResult<Vec<EmbeddingVector>> {
            self.embedded.fetch_add(inputs.len(), Ordering::SeqCst);
            Ok(inputs
                .iter()
                .map(|input| EmbeddingVector::new(vec![input.text.len() as f32, 1.0]))
                .collect())
        }
    }

    fn document(entry_id: &str, text: &str) -> SearchDocument {
        let entry_id = EntryId::from_string(entry_id.to_string());
        SearchDocument {
            entry_id: entry_id.clone(),
            entry_title: text.to_string(),
            source: SearchDocumentSource::default(),
            target: SearchTarget::Entry { entry_id },
            title: text.to_string(),
            sections: vec![SearchTextSection::body(text)],
            boost: 1.0,
        }
    }
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

fn hit_key(hit: &SearchHit) -> String {
    let source_kind = format!("{:?}", hit.source.kind);
    match &hit.target {
        SearchTarget::Entry { entry_id } => {
            format!("entry:{}:{source_kind}", entry_id.as_str())
        }
        SearchTarget::Note { entry_id, note_id } => {
            format!(
                "note:{}:{}:{source_kind}",
                entry_id.as_str(),
                note_id.as_str()
            )
        }
        SearchTarget::Page { entry_id, page_idx } => {
            format!("page:{}:{}:{source_kind}", entry_id.as_str(), page_idx)
        }
        SearchTarget::Segment {
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

fn tmp_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_default();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    name.push(format!(".{nanos}.tmp"));
    path.with_file_name(name)
}

fn io_error(error: std::io::Error) -> SearchError {
    SearchError::VectorIndexIo(error.to_string())
}
