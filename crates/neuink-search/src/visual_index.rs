//! Vector index over a library's stored image assets.
//!
//! Scope: this module only stores and rereads image vectors, and ranks assets by
//! cosine. Which assets exist is a workspace fact; which model produced the vectors is
//! a provider fact. Everything here is rebuildable cache.
//!
//! Two rules the snapshot enforces:
//! - `identity` and `dimensions` are written into the snapshot, so a replaced model
//!   can never be served vectors from the previous one.
//! - documents with the same `entry|path|content_hash` reuse their vector, so a rebuild
//!   after an unrelated edit embeds only the changed assets.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use neuink_domain::SegmentType;
use serde::{Deserialize, Serialize};

use crate::visual_embedding::{VisualAssetInput, VisualEmbeddingProvider};
use crate::visual_sidecar::VisualScore;
use crate::{SearchError, SearchResult};

pub const VISUAL_INDEX_FORMAT_VERSION: u32 = 2;
pub const VISUAL_INDEX_FILE_NAME: &str = "visual-assets.vectors.json";
pub const VISUAL_EMBED_BATCH_SIZE: usize = 4;

/// Where a visual vector came from. Pages and their region crops come from the native
/// PDF; figures and tables come from the MinerU parse. Both land in one snapshot so the
/// two sources are scored against the same query vector.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VisualSourceKind {
    Page,
    Region,
    Figure,
    Table,
}

/// One visual source as the index sees it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VisualIndexDocument {
    pub entry_id: String,
    pub kind: VisualSourceKind,
    /// Stable source id inside the entry: `page:3`, `page:3:r1`, `images/x.jpg`.
    #[serde(alias = "relative_path")]
    pub source_id: String,
    #[serde(default)]
    pub page_idx: Option<u32>,
    /// Crop index for `Region` sources; `None` for whole pages and MinerU assets.
    #[serde(default)]
    pub region: Option<u32>,
    #[serde(default)]
    pub segment_type: Option<SegmentType>,
    /// Content hash of the source bytes, so a changed source re-embeds.
    pub content_hash: String,
}

impl VisualIndexDocument {
    pub fn key(&self) -> String {
        format!(
            "{}\u{1f}{}\u{1f}{}",
            self.entry_id, self.source_id, self.content_hash
        )
    }

    /// Parent identity used by `visual_sidecar::aggregate_parents`. A region crop shares
    /// its page's parent, so the page votes once no matter how many crops it has.
    pub fn parent_id(&self) -> String {
        match self.kind {
            VisualSourceKind::Page | VisualSourceKind::Region => {
                format!("page:{}", self.page_idx.unwrap_or_default())
            }
            VisualSourceKind::Figure | VisualSourceKind::Table => {
                format!("asset:{}", self.source_id)
            }
        }
    }

    /// Crop index carried into `VisualScore`, so aggregation can take the best crop.
    pub fn region_index(&self) -> Option<u32> {
        match self.kind {
            VisualSourceKind::Region => self.region,
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct VisualSnapshot {
    format_version: u32,
    identity: String,
    dimensions: usize,
    documents: Vec<VisualIndexDocument>,
    vectors: Vec<Vec<f32>>,
}

#[derive(Clone, Debug)]
pub struct VisualSearchIndex {
    identity: String,
    dimensions: usize,
    documents: Vec<VisualIndexDocument>,
    vectors: Vec<Vec<f32>>,
    path: Option<PathBuf>,
}

impl VisualSearchIndex {
    pub fn identity(&self) -> &str {
        &self.identity
    }

    pub fn dimensions(&self) -> usize {
        self.dimensions
    }

    pub fn document_count(&self) -> usize {
        self.documents.len()
    }

    pub fn documents(&self) -> &[VisualIndexDocument] {
        &self.documents
    }

    /// Snapshot this index was built from or read from, for status reporting.
    pub fn snapshot_path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    /// Ranks assets by cosine against a query vector in the same space.
    ///
    /// `allowed_entries` is the caller's frozen scope; an empty slice means the caller
    /// froze nothing and therefore gets nothing, never "the whole library".
    pub fn search(
        &self,
        vector: &[f32],
        allowed_entries: &[String],
        limit: usize,
    ) -> SearchResult<Vec<VisualScore>> {
        if vector.len() != self.dimensions {
            return Err(SearchError::VectorDimensionMismatch {
                expected: self.dimensions,
                actual: vector.len(),
            });
        }
        if vector.iter().any(|value| !value.is_finite()) {
            return Err(SearchError::EmbeddingUnavailable(
                "visual query vector is not finite".to_string(),
            ));
        }
        if allowed_entries.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        let query = normalize(vector);
        let mut scores = Vec::new();
        for (document, stored) in self.documents.iter().zip(&self.vectors) {
            if !allowed_entries.iter().any(|entry| entry == &document.entry_id) {
                continue;
            }
            if stored.len() != self.dimensions {
                continue;
            }
            let candidate = normalize(stored);
            let cosine = query
                .iter()
                .zip(&candidate)
                .map(|(left, right)| left * right)
                .sum::<f32>();
            if !cosine.is_finite() {
                continue;
            }
            scores.push(VisualScore {
                entry_id: document.entry_id.clone(),
                parent_id: document.parent_id(),
                region: document.region_index(),
                score: cosine,
            });
        }
        scores.sort_by(|left, right| {
            right
                .score
                .total_cmp(&left.score)
                .then_with(|| left.entry_id.cmp(&right.entry_id))
                .then_with(|| left.parent_id.cmp(&right.parent_id))
        });
        scores.truncate(limit);
        Ok(scores)
    }
}

fn normalize(vector: &[f32]) -> Vec<f32> {
    let norm = vector
        .iter()
        .map(|value| value * value)
        .sum::<f32>()
        .sqrt();
    if !norm.is_finite() || norm <= 1e-12 {
        return vec![0.0; vector.len()];
    }
    vector.iter().map(|value| value / norm).collect()
}

pub fn visual_index_path(cache_dir: &Path, namespace: &str) -> PathBuf {
    cache_dir
        .join("search")
        .join(format!("visual-{namespace}.vectors.json"))
}

/// Namespace from the model identity and dimensions only. A different model or a
/// different output width is a different index, not a stale one.
pub fn visual_namespace(identity: &str, dimensions: usize) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"neuink-visual-index-v1");
    hasher.update(&(identity.len() as u64).to_le_bytes());
    hasher.update(identity.as_bytes());
    hasher.update(&(dimensions as u64).to_le_bytes());
    hasher.finalize().to_hex().to_string()
}

/// Builds or extends the index. Stored vectors are reused by document key; only new or
/// changed sources are embedded. A failed build leaves the previous snapshot untouched.
///
/// `precomputed` carries vectors the caller already has, for sources the product never
/// holds as bytes: page and region vectors come from a service that rasterizes the PDF
/// itself. A document in `precomputed` never reaches `provider.embed_assets`.
pub fn build_visual_index(
    path: &Path,
    identity: &str,
    dimensions: usize,
    documents: &[VisualIndexDocument],
    assets: &BTreeMap<String, Vec<u8>>,
    precomputed: &BTreeMap<String, Vec<f32>>,
    provider: &dyn VisualEmbeddingProvider,
    on_progress: &dyn Fn(usize, usize),
) -> SearchResult<VisualSearchIndex> {
    let previous = read_snapshot(path)
        .filter(|snapshot| snapshot.identity == identity && snapshot.dimensions == dimensions)
        .map(|snapshot| {
            snapshot
                .documents
                .into_iter()
                .zip(snapshot.vectors)
                .map(|(document, vector)| (document.key(), vector))
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();

    let mut vectors: Vec<Option<Vec<f32>>> = documents
        .iter()
        .map(|document| {
            let key = document.key();
            precomputed
                .get(&key)
                .or_else(|| previous.get(&key))
                .filter(|vector| vector.len() == dimensions)
                .cloned()
        })
        .collect();

    let missing = documents
        .iter()
        .enumerate()
        .filter(|(index, _)| vectors[*index].is_none())
        .collect::<Vec<_>>();
    let total = missing.len();
    let mut completed = 0usize;
    for batch in missing.chunks(VISUAL_EMBED_BATCH_SIZE) {
        let inputs = batch
            .iter()
            .filter_map(|(_index, document)| {
                assets.get(&document.key()).map(|bytes| VisualAssetInput {
                    id: document.key(),
                    bytes: bytes.clone(),
                })
            })
            .collect::<Vec<_>>();
        if inputs.len() != batch.len() {
            // A document without stored bytes is a broken state, not a missing vector.
            return Err(SearchError::VectorStoreUnavailable(
                "visual index has documents without stored asset bytes".to_string(),
            ));
        }
        let embedded = provider.embed_assets(&inputs, &|done, _| {
            on_progress(completed + done, total);
        })?;
        if embedded.len() != batch.len() {
            return Err(SearchError::VectorStoreUnavailable(format!(
                "visual provider returned {} vectors for {} assets",
                embedded.len(),
                batch.len()
            )));
        }
        for ((index, _), vector) in batch.iter().zip(embedded) {
            if vector.len() != dimensions {
                return Err(SearchError::VectorDimensionMismatch {
                    expected: dimensions,
                    actual: vector.len(),
                });
            }
            vectors[*index] = Some(vector);
        }
        completed += batch.len();
        on_progress(completed, total);
    }
    if total == 0 {
        on_progress(0, 0);
    }

    let vectors = vectors
        .into_iter()
        .map(|vector| {
            vector.ok_or_else(|| {
                SearchError::VectorStoreUnavailable(
                    "visual index left an asset without a vector".to_string(),
                )
            })
        })
        .collect::<SearchResult<Vec<_>>>()?;
    let snapshot = VisualSnapshot {
        format_version: VISUAL_INDEX_FORMAT_VERSION,
        identity: identity.to_string(),
        dimensions,
        documents: documents.to_vec(),
        vectors: vectors.clone(),
    };
    write_snapshot(path, &snapshot)?;
    Ok(VisualSearchIndex {
        identity: identity.to_string(),
        dimensions,
        documents: documents.to_vec(),
        vectors,
        path: Some(path.to_path_buf()),
    })
}

/// Reads a snapshot that matches the current identity, dimensions and document set.
/// Never embeds and never writes. `Ok(None)` means "no usable snapshot".
pub fn reopen_visual_index(
    path: &Path,
    identity: &str,
    dimensions: usize,
    documents: &[VisualIndexDocument],
) -> SearchResult<Option<VisualSearchIndex>> {
    let Some(snapshot) = read_snapshot(path) else {
        return Ok(None);
    };
    if snapshot.format_version != VISUAL_INDEX_FORMAT_VERSION
        || snapshot.identity != identity
        || snapshot.dimensions != dimensions
        || snapshot.documents != documents
    {
        return Ok(None);
    }
    Ok(Some(VisualSearchIndex {
        identity: snapshot.identity,
        dimensions: snapshot.dimensions,
        documents: snapshot.documents,
        vectors: snapshot.vectors,
        path: Some(path.to_path_buf()),
    }))
}

fn read_snapshot(path: &Path) -> Option<VisualSnapshot> {
    let bytes = fs::read(path).ok()?;
    let snapshot = serde_json::from_slice::<VisualSnapshot>(&bytes).ok()?;
    (snapshot.format_version == VISUAL_INDEX_FORMAT_VERSION).then_some(snapshot)
}

fn write_snapshot(path: &Path, snapshot: &VisualSnapshot) -> SearchResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| SearchError::VectorIndexIo(error.to_string()))?;
    }
    let bytes = serde_json::to_vec(snapshot)
        .map_err(|error| SearchError::VectorIndexIo(error.to_string()))?;
    let temporary = path.with_extension("vectors.json.tmp");
    fs::write(&temporary, bytes).map_err(|error| SearchError::VectorIndexIo(error.to_string()))?;
    fs::rename(&temporary, path).map_err(|error| SearchError::VectorIndexIo(error.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use super::*;
    use crate::visual_embedding::VisualProviderStatus;

    /// Deterministic 4-d vectors derived from bytes, with a paired text encoder.
    struct FakeProvider {
        identity: String,
        embed_calls: Arc<AtomicUsize>,
        fail_at: Option<usize>,
    }

    impl FakeProvider {
        fn new(identity: &str) -> Self {
            Self {
                identity: identity.to_string(),
                embed_calls: Arc::new(AtomicUsize::new(0)),
                fail_at: None,
            }
        }

        fn failing(identity: &str, after: usize) -> Self {
            Self {
                identity: identity.to_string(),
                embed_calls: Arc::new(AtomicUsize::new(0)),
                fail_at: Some(after),
            }
        }

        fn calls(&self) -> usize {
            self.embed_calls.load(Ordering::SeqCst)
        }
    }

    fn vector_for(bytes: &[u8]) -> Vec<f32> {
        let hash = blake3::hash(bytes);
        let raw = hash.as_bytes();
        let values = (0..4)
            .map(|index| f32::from(raw[index]) / 255.0)
            .collect::<Vec<_>>();
        normalize(&values)
    }

    impl VisualEmbeddingProvider for FakeProvider {
        fn status(&self) -> VisualProviderStatus {
            VisualProviderStatus {
                available: true,
                provider: "fake".to_string(),
                model_name: Some(self.identity.clone()),
                dimensions: Some(4),
                message: None,
            }
        }

        fn identity(&self) -> Option<String> {
            Some(self.identity.clone())
        }

        fn dimensions(&self) -> Option<usize> {
            Some(4)
        }

        fn embed_assets(
            &self,
            assets: &[VisualAssetInput],
            on_progress: &dyn Fn(usize, usize),
        ) -> SearchResult<Vec<Vec<f32>>> {
            let done = self.embed_calls.fetch_add(assets.len(), Ordering::SeqCst);
            if let Some(limit) = self.fail_at {
                if done + assets.len() > limit {
                    return Err(SearchError::EmbeddingUnavailable("boom".to_string()));
                }
            }
            let vectors = assets
                .iter()
                .map(|asset| vector_for(&asset.bytes))
                .collect::<Vec<_>>();
            on_progress(vectors.len(), assets.len());
            Ok(vectors)
        }

        fn embed_query_text(&self, text: &str) -> SearchResult<Vec<f32>> {
            Ok(vector_for(text.as_bytes()))
        }
    }

    fn empty_precomputed() -> BTreeMap<String, Vec<f32>> {
        BTreeMap::new()
    }

    fn document(entry: &str, path: &str, hash: &str) -> VisualIndexDocument {
        VisualIndexDocument {
            entry_id: entry.to_string(),
            kind: VisualSourceKind::Figure,
            source_id: path.to_string(),
            page_idx: Some(1),
            region: None,
            segment_type: Some(SegmentType::Figure),
            content_hash: hash.to_string(),
        }
    }

    fn page_document(entry: &str, page: u32, region: Option<u32>, hash: &str) -> VisualIndexDocument {
        VisualIndexDocument {
            entry_id: entry.to_string(),
            kind: if region.is_some() {
                VisualSourceKind::Region
            } else {
                VisualSourceKind::Page
            },
            source_id: match region {
                Some(crop) => format!("page:{page}:r{crop}"),
                None => format!("page:{page}"),
            },
            page_idx: Some(page),
            region,
            segment_type: None,
            content_hash: hash.to_string(),
        }
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("neuink-visual-{tag}-{nanos}"))
    }

    #[test]
    fn namespace_separates_models_and_dimensions() {
        assert_eq!(visual_namespace("model-a", 512), visual_namespace("model-a", 512));
        assert_ne!(visual_namespace("model-a", 512), visual_namespace("model-b", 512));
        assert_ne!(visual_namespace("model-a", 512), visual_namespace("model-a", 768));
    }

    #[test]
    fn a_build_writes_a_snapshot_and_a_reopen_reads_it_without_embedding() {
        let dir = temp_dir("reopen");
        let path = visual_index_path(&dir, "ns");
        let documents = vec![document("e1", "images/a.jpg", "h1")];
        let assets = BTreeMap::from([(
            "e1\u{1f}images/a.jpg\u{1f}h1".to_string(),
            b"image-a".to_vec(),
        )]);
        let provider = FakeProvider::new("model-a");
        let built = build_visual_index(&path, "model-a", 4, &documents, &assets, &empty_precomputed(), &provider, &|_, _| {})
            .expect("build");
        assert_eq!(built.document_count(), 1);
        assert_eq!(provider.calls(), 1);

        let reopening = FakeProvider::failing("model-a", 0);
        let reopened = reopen_visual_index(&path, "model-a", 4, &documents)
            .expect("reopen")
            .expect("snapshot matches");
        assert_eq!(reopened.document_count(), 1);
        assert_eq!(reopening.calls(), 0);
    }

    #[test]
    fn a_rebuild_reuses_unchanged_vectors_and_embeds_only_changed_assets() {
        let dir = temp_dir("incremental");
        let path = visual_index_path(&dir, "ns");
        let first = vec![
            document("e1", "images/a.jpg", "h1"),
            document("e1", "images/b.jpg", "h2"),
        ];
        let mut assets = BTreeMap::from([
            ("e1\u{1f}images/a.jpg\u{1f}h1".to_string(), b"a".to_vec()),
            ("e1\u{1f}images/b.jpg\u{1f}h2".to_string(), b"b".to_vec()),
        ]);
        let provider = FakeProvider::new("model-a");
        build_visual_index(&path, "model-a", 4, &first, &assets, &empty_precomputed(), &provider, &|_, _| {}).expect("build");
        assert_eq!(provider.calls(), 2);

        let second = vec![
            document("e1", "images/a.jpg", "h1"),
            document("e1", "images/b.jpg", "h3"),
        ];
        assets.insert("e1\u{1f}images/b.jpg\u{1f}h3".to_string(), b"b2".to_vec());
        let rebuilt = build_visual_index(&path, "model-a", 4, &second, &assets, &empty_precomputed(), &provider, &|_, _| {})
            .expect("rebuild");
        assert_eq!(rebuilt.document_count(), 2);
        // Only the changed asset was embedded.
        assert_eq!(provider.calls(), 3);
    }

    #[test]
    fn a_snapshot_from_another_identity_is_not_reused() {
        let dir = temp_dir("identity");
        let path = visual_index_path(&dir, "ns");
        let documents = vec![document("e1", "images/a.jpg", "h1")];
        let assets = BTreeMap::from([("e1\u{1f}images/a.jpg\u{1f}h1".to_string(), b"a".to_vec())]);
        build_visual_index(&path, "model-a", 4, &documents, &assets, &empty_precomputed(), &FakeProvider::new("model-a"), &|_, _| {})
            .expect("build");
        assert!(reopen_visual_index(&path, "model-b", 4, &documents)
            .expect("reopen")
            .is_none());
    }

    #[test]
    fn search_respects_the_frozen_scope_the_dimensions_and_the_limit() {
        let dir = temp_dir("search");
        let path = visual_index_path(&dir, "ns");
        let documents = vec![
            document("e1", "images/a.jpg", "h1"),
            document("e2", "images/b.jpg", "h2"),
            document("e3", "images/c.jpg", "h3"),
        ];
        let assets = BTreeMap::from([
            ("e1\u{1f}images/a.jpg\u{1f}h1".to_string(), b"aa".to_vec()),
            ("e2\u{1f}images/b.jpg\u{1f}h2".to_string(), b"bb".to_vec()),
            ("e3\u{1f}images/c.jpg\u{1f}h3".to_string(), b"cc".to_vec()),
        ]);
        let provider = FakeProvider::new("model-a");
        let index = build_visual_index(&path, "model-a", 4, &documents, &assets, &empty_precomputed(), &provider, &|_, _| {})
            .expect("build");
        let query = provider.embed_query_text("bb").expect("query");

        // No frozen scope means no results, never the whole library.
        assert!(index.search(&query, &[], 10).expect("search").is_empty());
        let scoped = index
            .search(&query, &["e1".to_string(), "e2".to_string()], 10)
            .expect("search");
        assert_eq!(scoped.len(), 2);
        assert!(scoped.iter().all(|score| score.entry_id != "e3"));
        assert_eq!(index.search(&query, &["e1".to_string()], 10).expect("search").len(), 1);
        let limited = index
            .search(&query, &["e1".to_string(), "e2".to_string()], 1)
            .expect("search");
        assert_eq!(limited.len(), 1);
        assert!(matches!(
            index.search(&[1.0, 0.0], &["e1".to_string()], 10),
            Err(SearchError::VectorDimensionMismatch { .. })
        ));
    }

    #[test]
    fn a_failed_embedding_leaves_the_previous_snapshot_in_place() {
        let dir = temp_dir("failure");
        let path = visual_index_path(&dir, "ns");
        let documents = vec![document("e1", "images/a.jpg", "h1")];
        let assets = BTreeMap::from([("e1\u{1f}images/a.jpg\u{1f}h1".to_string(), b"a".to_vec())]);
        build_visual_index(&path, "model-a", 4, &documents, &assets, &empty_precomputed(), &FakeProvider::new("model-a"), &|_, _| {})
            .expect("first build");
        let before = fs::read(&path).expect("snapshot bytes");

        let changed = vec![document("e1", "images/a.jpg", "h9")];
        let mut changed_assets = assets.clone();
        changed_assets.insert("e1\u{1f}images/a.jpg\u{1f}h9".to_string(), b"z".to_vec());
        let failing = FakeProvider::failing("model-a", 0);
        assert!(build_visual_index(&path, "model-a", 4, &changed, &changed_assets, &empty_precomputed(), &failing, &|_, _| {})
            .is_err());
        assert_eq!(fs::read(&path).expect("snapshot bytes"), before);
    }

    #[test]
    fn page_and_region_sources_share_one_parent_vote() {
        use crate::visual_sidecar::aggregate_parents;

        let dir = temp_dir("parents");
        let path = visual_index_path(&dir, "ns");
        let documents = vec![
            page_document("e1", 3, None, "p3"),
            page_document("e1", 3, Some(0), "p3r0"),
            page_document("e1", 3, Some(1), "p3r1"),
            document("e1", "images/fig1.jpg", "f1"),
        ];
        let assets = BTreeMap::from([(
            "e1\u{1f}images/fig1.jpg\u{1f}f1".to_string(),
            b"figure".to_vec(),
        )]);
        // Page vectors are produced by the service that rasterizes the PDF, so the index
        // never sees those bytes.
        let mut precomputed = BTreeMap::new();
        precomputed.insert("e1\u{1f}page:3\u{1f}p3".to_string(), vec![1.0, 0.0, 0.0, 0.0]);
        precomputed.insert("e1\u{1f}page:3:r0\u{1f}p3r0".to_string(), vec![0.0, 1.0, 0.0, 0.0]);
        precomputed.insert("e1\u{1f}page:3:r1\u{1f}p3r1".to_string(), vec![0.0, 0.0, 1.0, 0.0]);
        let provider = FakeProvider::new("model-a");
        let index = build_visual_index(
            &path,
            "model-a",
            4,
            &documents,
            &assets,
            &precomputed,
            &provider,
            &|_, _| {},
        )
        .expect("build");
        assert_eq!(index.document_count(), 4);
        // Only the figure needed embedding; the three page sources were precomputed.
        assert_eq!(provider.calls(), 1);

        let scores = index
            .search(&[1.0, 0.0, 0.0, 0.0], &["e1".to_string()], 10)
            .expect("search");
        assert_eq!(scores.len(), 4);
        let regions: Vec<Option<u32>> = scores.iter().map(|score| score.region).collect();
        assert!(regions.contains(&Some(0)));
        let parents = aggregate_parents(&scores);
        // The page votes once and the figure once, whatever the crop count.
        assert_eq!(parents.len(), 2);
        assert!(parents.iter().any(|parent| parent.parent_id == "page:3"));
    }
}
