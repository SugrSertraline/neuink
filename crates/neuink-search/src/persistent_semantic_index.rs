use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashMap},
    fs,
    hash::{DefaultHasher, Hash, Hasher},
    path::{Path, PathBuf},
};

use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::{
    EmbeddingInput, EmbeddingProvider, SearchDocument, SearchDocumentSourceKind, SearchEntryGroup,
    SearchError, SearchHit, SearchInclude, SearchMode, SearchQuery, SearchResult, SearchResults,
    SearchTarget, SearchTextSection,
};

const INDEX_FORMAT_VERSION: u32 = 3;

#[derive(Debug)]
pub struct PersistentSemanticSearchIndex {
    documents: Vec<PersistentSemanticDocument>,
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

    pub fn open_or_build_with_progress(
        path: impl AsRef<Path>,
        documents: &[SearchDocument],
        provider: &dyn EmbeddingProvider,
        include: &SearchInclude,
        fingerprint: u64,
        on_progress: &dyn Fn(usize, usize),
    ) -> SearchResult<Self> {
        let path = path.as_ref();
        if let Some(index) = Self::try_open(path, documents, include, fingerprint)? {
            let total = index.document_count();
            on_progress(total, total);
            return Ok(index);
        }

        let cached_vectors = Self::read_cached_vectors(path)?;
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
        by_id.extend(
            missing_inputs
                .into_iter()
                .zip(vectors)
                .map(|(input, vector)| (input.id, normalize(vector.values))),
        );

        Ok(Self {
            documents: semantic_documents_from_vectors(documents, include, by_id),
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

    fn try_open(
        path: &Path,
        documents: &[SearchDocument],
        include: &SearchInclude,
        fingerprint: u64,
    ) -> SearchResult<Option<Self>> {
        if !path.is_file() {
            return Ok(None);
        }

        let bytes = fs::read(path).map_err(io_error)?;
        let Ok(snapshot) = serde_json::from_slice::<PersistedSemanticIndex>(&bytes) else {
            return Ok(None);
        };
        if snapshot.version != INDEX_FORMAT_VERSION || snapshot.fingerprint != fingerprint {
            return Ok(None);
        }

        let vectors = snapshot
            .records
            .into_iter()
            .map(|record| (record.id, record.vector))
            .collect::<HashMap<_, _>>();
        Ok(Some(Self {
            documents: semantic_documents_from_vectors(documents, include, vectors),
        }))
    }

    fn read_cached_vectors(path: &Path) -> SearchResult<HashMap<String, Vec<f32>>> {
        if !path.is_file() {
            return Ok(HashMap::new());
        }
        let bytes = fs::read(path).map_err(io_error)?;
        let Ok(snapshot) = serde_json::from_slice::<PersistedSemanticIndex>(&bytes) else {
            return Ok(HashMap::new());
        };
        if snapshot.version != INDEX_FORMAT_VERSION {
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
            version: INDEX_FORMAT_VERSION,
            fingerprint,
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
        if path.exists() {
            fs::remove_file(path).map_err(io_error)?;
        }
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
    records: Vec<PersistedSemanticRecord>,
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

fn stable_document_key(document: &SearchDocument) -> String {
    let target = match &document.target {
        SearchTarget::Entry { entry_id } => format!("entry:{}", entry_id.as_str()),
        SearchTarget::Note { entry_id, note_id } => {
            format!("note:{}:{}", entry_id.as_str(), note_id.as_str())
        }
        SearchTarget::Page { entry_id, page_idx } => {
            format!("page:{}:{}", entry_id.as_str(), page_idx)
        }
        SearchTarget::Segment {
            entry_id,
            segment_uid,
            page_idx,
        } => format!(
            "segment:{}:{}:{}",
            entry_id.as_str(),
            segment_uid.as_str(),
            page_idx
        ),
    };
    let mut hasher = DefaultHasher::new();
    document.source.kind.hash(&mut hasher);
    document.source.label.hash(&mut hasher);
    document.source.field_name.hash(&mut hasher);
    document.source.tag_id.hash(&mut hasher);
    document.source.note_id.hash(&mut hasher);
    document.source.segment_uid.hash(&mut hasher);
    document.source.page_idx.hash(&mut hasher);
    document.title.hash(&mut hasher);
    document.boost.to_bits().hash(&mut hasher);
    for section in &document.sections {
        section.label.hash(&mut hasher);
        section.text.hash(&mut hasher);
        section.boost.to_bits().hash(&mut hasher);
    }
    format!("{target}:{:016x}", hasher.finish())
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

    use super::{stable_document_key, PersistentSemanticSearchIndex};
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

    #[derive(Default)]
    struct CountingProvider {
        embedded: AtomicUsize,
    }

    impl EmbeddingProvider for CountingProvider {
        fn status(&self) -> EmbeddingProviderStatus {
            EmbeddingProviderStatus {
                available: true,
                provider: "test".to_string(),
                ..EmbeddingProviderStatus::default()
            }
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

fn embedding_text(document: &SearchDocument) -> String {
    let mut parts = Vec::with_capacity(document.sections.len() + 4);
    if !document.entry_title.trim().is_empty() {
        parts.push(format!("Entry: {}", document.entry_title.trim()));
    }
    if !document.title.trim().is_empty() {
        parts.push(format!("Title: {}", document.title.trim()));
    }
    if !document.source.label.trim().is_empty() {
        parts.push(format!("Source: {}", document.source.label.trim()));
    }
    for section in &document.sections {
        if let Some(text) = section_text(section) {
            parts.push(format!("{}: {}", section.label, text));
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
