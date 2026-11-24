//! Visual sidecar over stored MinerU assets.
//!
//! Two stages, both explicit:
//! 1. `prepare_visual_search_index` reads every stored asset, encodes it with the paired
//!    model and writes one snapshot. This is the only place image bytes are encoded.
//! 2. At query time the snapshot is read-only: the question is encoded once into the
//!    same space, assets are scored by cosine and the parents vote on document routing.
//!
//! Enablement follows from state, not from a switch: a snapshot that matches the current
//! model identity is used; anything else degrades to the text channel with a fixed
//! reason, so an unprepared library never pays for a 500-asset encode.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

use neuink_config::{VisualEmbeddingProviderKind, VisualEmbeddingSettings};
use neuink_domain::EntryId;
use neuink_search::{
    build_visual_index, check_provider, reopen_visual_index, visual_index_path, visual_namespace,
    visual_snapshot_keys, VisualChannelStatus, VisualEmbeddingProvider, VisualIndexDocument,
    VisualRecall, VisualScore, VisualSearchIndex,
};
use neuink_workspace::{EntryVisualAsset, Workspace};
use serde::{Deserialize, Serialize};

use super::visual_qwen::QwenVisualServiceProvider;

/// Query-vector cache. One entry per distinct question text and model identity; the
/// cost saved is a full text-tower pass. It is cleared wholesale at the cap instead of
/// evicting one entry, so the bound is trivial to reason about.
const VISUAL_QUERY_CACHE_LIMIT: usize = 256;

pub(super) const VISUAL_REASON_MODEL_UNAVAILABLE: &str = "model_unavailable";
pub(super) const VISUAL_REASON_INDEX_MISSING: &str = "index_missing";

#[derive(Debug, Deserialize)]
pub struct GetVisualIndexStatusRequest {
    pub root: PathBuf,
}

#[derive(Debug, Serialize)]
pub struct VisualIndexStatusResponse {
    pub built: bool,
    pub snapshot_count: usize,
    pub updated_at_ms: Option<u64>,
}

/// Whether a visual snapshot exists, without starting the encoder or reading assets: the
/// search sidebar needs to say "not built" before it offers the expensive build action.
pub fn visual_index_status(root: &Path) -> Result<VisualIndexStatusResponse, String> {
    let workspace = Workspace::open(root).map_err(|error| error.to_string())?;
    let directory = workspace.layout().cache_dir().join("search");
    let mut snapshot_count = 0usize;
    let mut updated_at_ms: Option<u64> = None;
    if let Ok(entries) = std::fs::read_dir(&directory) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !(name.starts_with("visual-")
                && (name.ends_with(".vectors.bin") || name.ends_with(".vectors.json")))
            {
                continue;
            }
            snapshot_count += 1;
            if let Ok(modified) = entry.metadata().and_then(|metadata| metadata.modified()) {
                let millis = modified
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .map(|duration| duration.as_millis() as u64);
                updated_at_ms = updated_at_ms.max(millis);
            }
        }
    }
    Ok(VisualIndexStatusResponse {
        built: snapshot_count > 0,
        snapshot_count,
        updated_at_ms,
    })
}
#[derive(Debug, Deserialize)]
pub struct PrepareVisualSearchIndexRequest {
    pub root: PathBuf,
}

#[derive(Debug, Serialize)]
pub struct PrepareVisualSearchIndexResponse {
    pub provider: String,
    pub model_name: Option<String>,
    pub dimensions: Option<usize>,
    pub identity: String,
    pub namespace: String,
    pub entry_count: usize,
    pub asset_count: usize,
    pub document_count: usize,
    /// Assets encoded in this run; unchanged assets reuse their stored vector.
    pub embedded_count: usize,
}

/// The recall handle the unified pipeline consumes.
pub struct VisualChannel {
    status: VisualChannelStatus,
    provider: Arc<dyn VisualEmbeddingProvider>,
    index: Option<Arc<VisualSearchIndex>>,
    identity: Option<String>,
}

impl VisualChannel {
    pub fn status_code(&self) -> &'static str {
        match self.status {
            VisualChannelStatus::Ready => "ready",
            VisualChannelStatus::Disabled => "disabled",
            VisualChannelStatus::Unavailable(reason) => reason,
        }
    }
}

impl VisualRecall for VisualChannel {
    fn status(&self) -> VisualChannelStatus {
        self.status
    }

    fn recall(
        &mut self,
        question: &str,
        entries: &[String],
        limit: usize,
    ) -> neuink_search::SearchResult<Vec<VisualScore>> {
        if !self.status.is_ready() || entries.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        let Some(index) = self.index.as_ref() else {
            return Ok(Vec::new());
        };
        let identity = self.identity.clone().unwrap_or_default();
        let vector = query_vector(self.provider.as_ref(), &identity, question)?;
        index.search(&vector, entries, limit)
    }
}

const VISUAL_PROVIDER_CACHE_TTL: Duration = Duration::from_secs(60);
const VISUAL_UNAVAILABLE_CACHE_TTL: Duration = Duration::from_secs(30);
const FAST_INDEX_MISSING_PROVIDER: &str = "visual-index-missing";

/// Cheap local stat check (`cache/search/visual-*.vectors.{bin,json}`) used by query
/// paths to avoid probing an offline visual sidecar when no visual index has been built.
pub fn has_visual_snapshot(root: &Path) -> bool {
    visual_index_status(root)
        .map(|status| status.built)
        .unwrap_or(false)
}

struct IndexMissingVisualProvider;

impl VisualEmbeddingProvider for IndexMissingVisualProvider {
    fn status(&self) -> neuink_search::VisualProviderStatus {
        neuink_search::VisualProviderStatus::unavailable(
            FAST_INDEX_MISSING_PROVIDER,
            "视觉索引尚未构建。",
        )
    }

    fn identity(&self) -> Option<String> {
        None
    }

    fn dimensions(&self) -> Option<usize> {
        None
    }

    fn embed_assets(
        &self,
        _assets: &[neuink_search::VisualAssetInput],
        _on_progress: &dyn Fn(usize, usize),
    ) -> neuink_search::SearchResult<Vec<Vec<f32>>> {
        Err(neuink_search::SearchError::EmbeddingUnavailable(
            "视觉索引尚未构建。".to_string(),
        ))
    }

    fn embed_query_text(&self, _text: &str) -> neuink_search::SearchResult<Vec<f32>> {
        Err(neuink_search::SearchError::EmbeddingUnavailable(
            "视觉索引尚未构建。".to_string(),
        ))
    }
}

/// Sentinel provider used when a query workspace has no visual snapshot on disk,
/// allowing `visual_channel` to report `index_missing` without any HTTP probe.
pub fn index_missing_provider() -> Arc<dyn VisualEmbeddingProvider> {
    Arc::new(IndexMissingVisualProvider)
}

/// Clears cached visual providers (both positive and negative entries).
/// Called when visual settings change or the local visual sidecar is started.
pub fn invalidate_provider_cache() {
    if let Some(cache) = VISUAL_PROVIDER_CACHE.get() {
        if let Ok(mut guard) = cache.lock() {
            guard.clear();
        }
    }
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct ProviderCacheKey {
    kind: &'static str,
    endpoint: String,
    api_key: String,
    timeout_ms: u64,
}

struct ProviderCacheEntry {
    provider: Arc<dyn VisualEmbeddingProvider>,
    stored_at: Instant,
}

static VISUAL_PROVIDER_CACHE: OnceLock<Mutex<HashMap<ProviderCacheKey, ProviderCacheEntry>>> =
    OnceLock::new();

#[derive(Clone, PartialEq, Eq, Hash)]
struct VisualIndexCacheKey {
    root: String,
    namespace: String,
    include_pages: bool,
}

struct VisualIndexCacheEntry {
    /// Source fingerprint at store time. A query hit must match the workspace now.
    fingerprint: String,
    /// Snapshot mtime at store time. A missing file or a rewritten snapshot misses.
    snapshot_mtime_ms: Option<u64>,
    index: Arc<VisualSearchIndex>,
}

static VISUAL_INDEX_CACHE: OnceLock<Mutex<HashMap<VisualIndexCacheKey, VisualIndexCacheEntry>>> =
    OnceLock::new();

fn index_cache_key(root: &Path, namespace: &str, include_pages: bool) -> VisualIndexCacheKey {
    VisualIndexCacheKey {
        root: root.to_string_lossy().into_owned(),
        namespace: namespace.to_string(),
        include_pages,
    }
}

/// Milliseconds since the Unix epoch for the binary snapshot, or the legacy JSON
/// beside it. `None` when neither file is present, so a deleted snapshot cannot hit.
fn snapshot_mtime_ms(path: &Path) -> Option<u64> {
    file_mtime_ms(path).or_else(|| file_mtime_ms(&path.with_extension("json")))
}

fn file_mtime_ms(path: &Path) -> Option<u64> {
    std::fs::metadata(path).ok().and_then(|metadata| {
        metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
    })
}

fn load_visual_index(
    root: &Path,
    namespace: &str,
    include_pages: bool,
    fingerprint: &str,
    mtime_ms: Option<u64>,
) -> Option<Arc<VisualSearchIndex>> {
    let mtime_ms = mtime_ms?;
    let cache = VISUAL_INDEX_CACHE.get()?.lock().ok()?;
    cache
        .get(&index_cache_key(root, namespace, include_pages))
        .filter(|entry| {
            entry.fingerprint == fingerprint && entry.snapshot_mtime_ms == Some(mtime_ms)
        })
        .map(|entry| Arc::clone(&entry.index))
}

fn store_visual_index(
    root: &Path,
    namespace: &str,
    include_pages: bool,
    fingerprint: &str,
    path: &Path,
    index: Arc<VisualSearchIndex>,
) {
    let Some(cache) = VISUAL_INDEX_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .ok()
    else {
        return;
    };
    let mut cache = cache;
    let snapshot_mtime_ms = snapshot_mtime_ms(path);
    cache.insert(
        index_cache_key(root, namespace, include_pages),
        VisualIndexCacheEntry {
            fingerprint: fingerprint.to_string(),
            snapshot_mtime_ms,
            index,
        },
    );
}

/// Builds the provider named by the settings. Both transports return the same trait
/// object, so every caller below is provider-agnostic: local or remote is a settings
/// change, never a code path.
///
/// A provider whose health check succeeded is reused for 60 seconds, so a search does
/// not open `GET /health` on every question. An unavailable provider is not cached.
pub fn provider_for(settings: &VisualEmbeddingSettings) -> Arc<dyn VisualEmbeddingProvider> {
    let key = ProviderCacheKey {
        kind: settings.provider.as_str(),
        endpoint: settings.endpoint.clone().unwrap_or_default(),
        api_key: settings.api_key.clone().unwrap_or_default(),
        timeout_ms: settings.timeout_ms,
    };
    if let Some(cache) = VISUAL_PROVIDER_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .ok()
    {
        if let Some(entry) = cache.get(&key) {
            if entry.provider.status().available
                && entry.stored_at.elapsed() < VISUAL_PROVIDER_CACHE_TTL
            {
                return Arc::clone(&entry.provider);
            }
        }
    }
    let provider = build_provider(settings);
    if provider.status().available {
        if let Some(mut cache) = VISUAL_PROVIDER_CACHE
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .ok()
        {
            cache.insert(
                key,
                ProviderCacheEntry {
                    provider: Arc::clone(&provider),
                    stored_at: Instant::now(),
                },
            );
        }
    }
    provider
}

/// Query-path provider lookup. Unlike `provider_for` (which serves live status screens
/// and startup polling), this caches unreachable states briefly (`30s`) so offline local
/// sidecars do not stall repeated searches with loopback connection-refused retries.
pub fn provider_for_query(settings: &VisualEmbeddingSettings) -> Arc<dyn VisualEmbeddingProvider> {
    let key = ProviderCacheKey {
        kind: settings.provider.as_str(),
        endpoint: settings.endpoint.clone().unwrap_or_default(),
        api_key: settings.api_key.clone().unwrap_or_default(),
        timeout_ms: settings.timeout_ms,
    };
    if let Some(cache) = VISUAL_PROVIDER_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .ok()
    {
        if let Some(entry) = cache.get(&key) {
            let ttl = if entry.provider.status().available {
                VISUAL_PROVIDER_CACHE_TTL
            } else {
                VISUAL_UNAVAILABLE_CACHE_TTL
            };
            if entry.stored_at.elapsed() < ttl {
                return Arc::clone(&entry.provider);
            }
        }
    }
    let provider = build_provider(settings);
    if let Some(mut cache) = VISUAL_PROVIDER_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .ok()
    {
        cache.insert(
            key,
            ProviderCacheEntry {
                provider: Arc::clone(&provider),
                stored_at: Instant::now(),
            },
        );
    }
    provider
}

fn build_provider(settings: &VisualEmbeddingSettings) -> Arc<dyn VisualEmbeddingProvider> {
    let endpoint = settings.endpoint.clone().unwrap_or_default();
    let timeout = Duration::from_millis(settings.timeout_ms.max(1));
    match settings.provider {
        VisualEmbeddingProviderKind::QwenLocal => {
            Arc::new(QwenVisualServiceProvider::from_local(endpoint, timeout))
        }
        VisualEmbeddingProviderKind::QwenApi => Arc::new(QwenVisualServiceProvider::from_api(
            endpoint,
            settings.api_key.clone().unwrap_or_default(),
            timeout,
        )),
        // A stored value this build no longer runs. It reports why instead of silently
        // searching text-only, so the settings screen can tell the user what to change.
        VisualEmbeddingProviderKind::Retired => {
            Arc::new(neuink_search::NoVisualProvider::with_message(
                "当前视觉编码器已停用，请改选 Qwen 服务。",
            ))
        }
    }
}

/// Opens the channel by inspection only: no encoding, no writes, no network.
pub(super) fn visual_channel(
    root: &PathBuf,
    provider: Arc<dyn VisualEmbeddingProvider>,
) -> VisualChannel {
    super::page_render::bind_from_env();
    let unavailable = |reason: &'static str| VisualChannel {
        status: VisualChannelStatus::Unavailable(reason),
        provider: provider.clone(),
        index: None,
        identity: None,
    };
    if provider.status().provider == FAST_INDEX_MISSING_PROVIDER {
        return unavailable(VISUAL_REASON_INDEX_MISSING);
    }
    let check = check_provider(provider.as_ref());
    if check.unavailable_reason.is_some() {
        return unavailable(VISUAL_REASON_MODEL_UNAVAILABLE);
    }
    let (Some(identity), Some(dimensions)) = (provider.identity(), provider.dimensions()) else {
        return unavailable(VISUAL_REASON_MODEL_UNAVAILABLE);
    };
    // Page sources need a rasterizer, not a particular transport: both the local service
    // and a remote API receive images from this process.
    let include_pages = super::page_render::available();
    let namespace = visual_namespace(&identity, dimensions);
    // Fingerprint and snapshot mtime are metadata stats. A hit must not unzip a
    // MinerU archive or read the vector body.
    let workspace = match Workspace::open(root) {
        Ok(workspace) => workspace,
        Err(_) => return unavailable(VISUAL_REASON_INDEX_MISSING),
    };
    let path = visual_index_path(&workspace.layout().cache_dir(), &namespace);
    let fingerprint = sources_fingerprint(&workspace).ok();
    let mtime_ms = snapshot_mtime_ms(&path);
    if let Some(fp) = fingerprint.as_deref() {
        if let Some(index) = load_visual_index(root, &namespace, include_pages, fp, mtime_ms) {
            return VisualChannel {
                status: VisualChannelStatus::Ready,
                provider,
                index: Some(index),
                identity: Some(identity),
            };
        }
    }
    let documents = match collect_assets(root, include_pages) {
        Ok(collected) => collected.documents,
        Err(_) => return unavailable(VISUAL_REASON_INDEX_MISSING),
    };
    if documents.is_empty() {
        return unavailable(VISUAL_REASON_INDEX_MISSING);
    }
    match reopen_visual_index(&path, &identity, dimensions, &documents) {
        Ok(Some(index)) => {
            let index = Arc::new(index);
            if let Some(fp) = fingerprint.as_deref() {
                store_visual_index(
                    root,
                    &namespace,
                    include_pages,
                    fp,
                    &path,
                    Arc::clone(&index),
                );
            }
            VisualChannel {
                status: VisualChannelStatus::Ready,
                provider,
                index: Some(index),
                identity: Some(identity),
            }
        }
        _ => unavailable(VISUAL_REASON_INDEX_MISSING),
    }
}

/// Encodes and stores every asset of the requested scope. Reads the workspace, writes
/// only the cache snapshot.
pub fn prepare_visual_index(
    provider: Arc<dyn VisualEmbeddingProvider>,
    request: PrepareVisualSearchIndexRequest,
) -> Result<PrepareVisualSearchIndexResponse, String> {
    // Headless callers (probe, tests) bind PDFium from the environment; the app binds in the
    // command layer, where the resource directory is known.
    super::page_render::bind_from_env();
    let workspace = Workspace::open(&request.root).map_err(|error| error.to_string())?;
    if !provider.status().available {
        return Err(provider
            .status()
            .message
            .unwrap_or_else(|| "视觉编码模型不可用。".to_string()));
    }
    let identity = provider
        .identity()
        .ok_or_else(|| "视觉编码模型缺少内容身份，拒绝写入向量。".to_string())?;
    let dimensions = provider
        .dimensions()
        .ok_or_else(|| "视觉编码模型未声明输出维度。".to_string())?;
    // Page sources need a rasterizer, not a particular transport: both the local service
    // and a remote API receive images from this process.
    let include_pages = super::page_render::available();
    let collected = collect_assets(&request.root, include_pages)?;
    let CollectedSources {
        documents,
        assets: asset_coordinates,
        pages: page_requests,
    } = collected;
    let namespace = visual_namespace(&identity, dimensions);
    // Nothing to encode is a state, not a failure: a fresh library legitimately has no
    // assets yet, and the settings screen must be able to say so without an error banner.
    if documents.is_empty() {
        return Ok(PrepareVisualSearchIndexResponse {
            provider: provider.status().provider,
            model_name: provider.status().model_name,
            dimensions: Some(dimensions),
            identity,
            namespace,
            entry_count: 0,
            asset_count: 0,
            document_count: 0,
            embedded_count: 0,
        });
    }
    let path = visual_index_path(&workspace.layout().cache_dir(), &namespace);
    let entry_count = documents
        .iter()
        .map(|document| document.entry_id.as_str())
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    let existing_keys = visual_snapshot_keys(&path, &identity, dimensions);
    // Bytes are read only for sources the snapshot does not already hold. One ZIP open
    // covers every missing crop of a paper. The builder still looks each key up, so the
    // bytes stay until that build finishes.
    let mut asset_bytes = BTreeMap::new();
    let mut pending_assets: BTreeMap<EntryId, Vec<(String, String)>> = BTreeMap::new();
    for (entry_id, relative_path, key) in &asset_coordinates {
        if existing_keys.contains(key) {
            continue;
        }
        pending_assets
            .entry(entry_id.clone())
            .or_default()
            .push((relative_path.clone(), key.clone()));
    }
    for (entry_id, pending) in &pending_assets {
        let paths = pending
            .iter()
            .map(|(relative_path, _)| relative_path.clone())
            .collect::<Vec<_>>();
        let loaded = workspace
            .entry_assets_bytes_batch(entry_id, &paths)
            .map_err(|error| error.to_string())?;
        for (relative_path, key) in pending {
            let bytes = loaded.get(relative_path).cloned().ok_or_else(|| {
                format!("视觉索引缺少图像字节：{relative_path}")
            })?;
            asset_bytes.insert(key.clone(), bytes);
        }
    }
    // Page and region vectors: rasterize the PDF in-process with the bound PDFium and let
    // build_visual_index embed the PNG bytes with everything else. The local service is
    // image-only now (its /embed_pages endpoint is deprecated), so the product owns
    // rasterization for both local and remote transports. A page whose keys are already
    // in the snapshot is not rendered again. One PDF open covers that paper's pages.
    let precomputed: BTreeMap<String, Vec<f32>> = BTreeMap::new();
    if include_pages {
        for request in page_requests.values() {
            let mut pending_pages = Vec::new();
            for page in &request.pages {
                let expected_keys = (0..=REGION_CROPS)
                    .map(|index| if index == 0 { None } else { Some(index - 1) })
                    .filter_map(|region| page_key(&documents, &request.entry_id, *page, region))
                    .collect::<Vec<_>>();
                if !expected_keys.is_empty()
                    && expected_keys.iter().all(|key| existing_keys.contains(key))
                {
                    continue;
                }
                pending_pages.push(*page);
            }
            if pending_pages.is_empty() {
                continue;
            }
            let rendered = super::page_render::render_entry_pages(
                &request.pdf_path,
                &pending_pages,
                (REGION_CROPS > 0).then_some(REGION_CROPS as usize),
            )?;
            for page in pending_pages {
                let crops = rendered
                    .get(&page)
                    .ok_or_else(|| format!("视觉分页渲染没有返回第 {page} 页"))?;
                for (index, bytes) in crops.iter().enumerate() {
                    let region = if index == 0 {
                        None
                    } else {
                        Some((index - 1) as u32)
                    };
                    let key = page_key(&documents, &request.entry_id, page, region)
                        .ok_or_else(|| "视觉分页渲染返回了未收集的页面或区域".to_string())?;
                    asset_bytes.insert(key, bytes.clone());
                }
            }
        }
    }
    let rebuilt = build_visual_index(
        &path,
        &identity,
        dimensions,
        &documents,
        &asset_bytes,
        &precomputed,
        provider.as_ref(),
        &|_, _| {},
    )
    .map_err(|error| {
        if cfg!(test) || std::env::var_os("NEUINK_VISUAL_DEBUG").is_some() {
            // A failing prepare must say which sources it could not account for: the
            // settings screen only shows the fixed message.
            let unaccounted = documents
                .iter()
                .filter(|document| {
                    !asset_bytes.contains_key(&document.key())
                        && !precomputed.contains_key(&document.key())
                })
                .take(5)
                .map(|document| {
                    format!(
                        "{} kind={:?} page={:?} region={:?}",
                        document.key(),
                        document.kind,
                        document.page_idx,
                        document.region
                    )
                })
                .collect::<Vec<_>>();
            let page_doc_keys = documents
                .iter()
                .filter(|document| {
                    document.region.is_none()
                        && document.kind == neuink_search::VisualSourceKind::Page
                })
                .take(3)
                .map(VisualIndexDocument::key)
                .collect::<Vec<_>>();
            let pre_keys = precomputed.keys().take(3).cloned().collect::<Vec<_>>();
            eprintln!(
                "visual prepare: page_doc_keys={page_doc_keys:?} precomputed_keys={pre_keys:?}"
            );
            eprintln!(
                "visual prepare: docs={} assets={} precomputed={} page_entries={} unaccounted={:?}",
                documents.len(),
                asset_bytes.len(),
                precomputed.len(),
                page_requests.len(),
                unaccounted
            );
        }
        error.to_string()
    })?;
    let rebuilt = Arc::new(rebuilt);
    if let Ok(fingerprint) = sources_fingerprint(&workspace) {
        store_visual_index(
            &request.root,
            &namespace,
            include_pages,
            &fingerprint,
            &path,
            Arc::clone(&rebuilt),
        );
    }
    Ok(PrepareVisualSearchIndexResponse {
        provider: provider.status().provider,
        model_name: provider.status().model_name,
        dimensions: Some(dimensions),
        identity,
        namespace,
        entry_count,
        asset_count: asset_coordinates.len(),
        document_count: rebuilt.document_count(),
        embedded_count: rebuilt.embedded_count(),
    })
}

/// Documents plus the per-asset coordinates a build needs, keyed by the index document key.
///
/// Image bytes are deliberately absent: a query only needs the document set (to verify the
/// snapshot), so bytes are read lazily by `prepare_visual_index`. That keeps the query path
/// free of ZIP reads.
struct CollectedSources {
    documents: Vec<VisualIndexDocument>,
    /// Per stored asset: entry, ZIP-relative path, and the document key it becomes.
    assets: Vec<(EntryId, String, String)>,
    pages: BTreeMap<String, PageRequest>,
}

/// Per-entry raw material, cached by a fingerprint of the sources it was read from.
#[derive(Clone)]
struct EntrySources {
    entry_id: String,
    /// PDF content hash and page list, when the entry is parsed and its PDF is present.
    pdf: Option<(String, PathBuf, Vec<u32>)>,
    assets: Vec<EntryVisualAsset>,
}

struct CachedSources {
    fingerprint: String,
    entries: Vec<EntrySources>,
}

/// Process-level cache. Reading sources means opening the MinerU ZIP and hashing every
/// image, which is cheap for one paper and measurable for a large library, so the collected
/// set is reused until a source changes. The fingerprint is built from filesystem facts
/// (PDF hash, ZIP and segment file size plus mtime), which makes this event-driven without
/// persisting any manifest: touching a source invalidates the cache by construction.
static SOURCES_CACHE: OnceLock<Mutex<Option<CachedSources>>> = OnceLock::new();

/// Fingerprint of everything the collected sources depend on.
fn sources_fingerprint(workspace: &Workspace) -> Result<String, String> {
    let entries = workspace
        .list_entries()
        .map_err(|error| error.to_string())?;
    let mut hasher = blake3::Hasher::new();
    let mut ordered = entries
        .iter()
        .map(|entry| {
            (
                entry.id.to_string(),
                entry.pdf.as_ref().map(|pdf| pdf.content_hash.clone()),
            )
        })
        .collect::<Vec<_>>();
    ordered.sort();
    for (id, pdf_hash) in ordered {
        hasher.update(id.as_bytes());
        // A replaced PDF changes every page source, so its hash belongs in the key.
        hasher.update(pdf_hash.unwrap_or_default().as_bytes());
        let entry_id = EntryId::from_string(id);
        for path in [
            workspace.layout().entry_mineru_output_zip(&entry_id),
            workspace.layout().entry_segments_file(&entry_id),
        ] {
            match std::fs::metadata(&path) {
                Ok(metadata) => {
                    hasher.update(path.to_string_lossy().as_bytes());
                    hasher.update(&metadata.len().to_le_bytes());
                    let modified = metadata
                        .modified()
                        .ok()
                        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|duration| duration.as_nanos())
                        .unwrap_or_default();
                    hasher.update(&modified.to_le_bytes());
                }
                Err(_) => {
                    hasher.update(b"missing");
                }
            }
        }
    }
    Ok(hasher.finalize().to_hex().to_string())
}

fn workspace_sources(workspace: &Workspace) -> Result<Arc<CachedSources>, String> {
    let fingerprint = sources_fingerprint(workspace)?;
    let mut cache = match SOURCES_CACHE.get_or_init(|| Mutex::new(None)).lock() {
        Ok(cache) => cache,
        Err(_) => return build_sources(workspace, fingerprint).map(Arc::new),
    };
    if let Some(cached) = cache.as_ref() {
        if cached.fingerprint == fingerprint {
            return Ok(Arc::new(CachedSources {
                fingerprint: cached.fingerprint.clone(),
                entries: cached.entries.clone(),
            }));
        }
    }
    let built = build_sources(workspace, fingerprint)?;
    *cache = Some(CachedSources {
        fingerprint: built.fingerprint.clone(),
        entries: built.entries.clone(),
    });
    Ok(Arc::new(built))
}

fn build_sources(workspace: &Workspace, fingerprint: String) -> Result<CachedSources, String> {
    let mut by_entry: BTreeMap<String, Vec<EntryVisualAsset>> = BTreeMap::new();
    for asset in workspace
        .collect_entry_visual_assets(None)
        .map_err(|error| error.to_string())?
    {
        by_entry
            .entry(asset.entry_id.clone())
            .or_default()
            .push(asset);
    }
    let mut entries = workspace
        .list_entries()
        .map_err(|error| error.to_string())?;
    entries.sort_by(|left, right| left.id.as_str().cmp(right.id.as_str()));
    let mut sources = Vec::with_capacity(entries.len());
    for entry in entries {
        let entry_id = entry.id.to_string();
        let assets = by_entry.remove(&entry_id).unwrap_or_default();
        let pdf = entry.pdf.as_ref().and_then(|pdf| {
            if pdf.parse.status != neuink_domain::PdfParseStatus::Succeeded {
                return None;
            }
            let path = workspace.layout().entry_pdf_file(&entry.id);
            if !path.is_file() {
                return None;
            }
            let segments = workspace.read_segments(&entry.id).ok()?;
            let pages = pages_needing_pdf_fallback(&segments, &assets);
            (!pages.is_empty()).then(|| (pdf.content_hash.clone(), path, pages))
        });
        if pdf.is_none() && assets.is_empty() {
            continue;
        }
        sources.push(EntrySources {
            entry_id,
            pdf,
            assets,
        });
    }
    Ok(CachedSources {
        fingerprint,
        entries: sources,
    })
}

/// Documents for the visual index, composed from the cached sources.
///
/// `include_pages` adds page and region sources derived from the native PDF. Those vectors
/// are produced by a service that rasterizes the PDF, so their bytes never reach the
/// product; the document set still has to match what the snapshot was built with.
fn collect_assets(root: &PathBuf, include_pages: bool) -> Result<CollectedSources, String> {
    let workspace = Workspace::open(root).map_err(|error| error.to_string())?;
    let sources = workspace_sources(&workspace)?;
    let mut documents = Vec::new();
    let mut assets = Vec::new();
    let mut pages = BTreeMap::new();
    for entry in &sources.entries {
        for asset in &entry.assets {
            let document = document_from_asset(asset);
            assets.push((
                EntryId::from_string(entry.entry_id.clone()),
                asset.relative_path.clone(),
                document.key(),
            ));
            documents.push(document);
        }
        if !include_pages {
            continue;
        }
        let Some((pdf_hash, pdf_path, page_list)) = entry.pdf.as_ref() else {
            continue;
        };
        for page in page_list {
            documents.push(page_document(&entry.entry_id, pdf_hash, *page, None));
            for region in 0..REGION_CROPS {
                documents.push(page_document(
                    &entry.entry_id,
                    pdf_hash,
                    *page,
                    Some(region),
                ));
            }
        }
        pages.insert(
            entry.entry_id.clone(),
            PageRequest {
                entry_id: entry.entry_id.clone(),
                pdf_path: pdf_path.clone(),
                pages: page_list.clone(),
            },
        );
    }
    Ok(CollectedSources {
        documents,
        assets,
        pages,
    })
}

/// One entry's PDF path, page list and the hash its page sources are keyed by.
struct PageRequest {
    entry_id: String,
    pdf_path: PathBuf,
    pages: Vec<u32>,
}

/// Key of the collected document for one page source, so a service vector can be matched
/// to the document the build will persist.
fn page_key(
    documents: &[VisualIndexDocument],
    entry_id: &str,
    page: u32,
    region: Option<u32>,
) -> Option<String> {
    documents
        .iter()
        .find(|document| {
            document.entry_id == entry_id
                // Page sources only: MinerU assets also carry a page index and no region,
                // so page/region alone would collide with a figure.
                && matches!(
                    document.kind,
                    neuink_search::VisualSourceKind::Page | neuink_search::VisualSourceKind::Region
                )
                && document.page_idx == Some(page)
                && document.region == region
        })
        .map(VisualIndexDocument::key)
}

/// Pages whose figure or table segments are not all backed by a MinerU crop.
///
/// A formula crop does not make a page visual. A page whose charts already have crops
/// is not rendered again. A paper with no crops still renders each figure or table page.
fn pages_needing_pdf_fallback(
    segments: &[neuink_domain::SourceSegment],
    assets: &[EntryVisualAsset],
) -> Vec<u32> {
    let crops = assets
        .iter()
        .map(|asset| asset.relative_path.as_str())
        .collect::<BTreeSet<_>>();
    let mut by_page: BTreeMap<u32, Vec<&neuink_domain::SourceSegment>> = BTreeMap::new();
    for segment in segments {
        if !matches!(
            segment.segment_type,
            neuink_domain::SegmentType::Figure | neuink_domain::SegmentType::Table
        ) {
            continue;
        }
        by_page.entry(segment.page_idx).or_default().push(segment);
    }
    let mut pages = Vec::new();
    for (page, group) in by_page {
        let covered = group.iter().all(|segment| {
            segment
                .asset_path
                .as_deref()
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .is_some_and(|path| crops.contains(path))
        });
        if !covered {
            pages.push(page);
        }
    }
    pages
}

/// Crop count per page. Whole-page encoding is the default: the four geometric crops
const REGION_CROPS: u32 = 0;

fn page_document(
    entry_id: &str,
    pdf_hash: &str,
    page: u32,
    region: Option<u32>,
) -> VisualIndexDocument {
    VisualIndexDocument {
        entry_id: entry_id.to_string(),
        kind: match region {
            Some(_) => neuink_search::VisualSourceKind::Region,
            None => neuink_search::VisualSourceKind::Page,
        },
        source_id: match region {
            Some(crop) => format!("page:{page}:r{crop}"),
            None => format!("page:{page}"),
        },
        page_idx: Some(page),
        region,
        segment_type: None,
        content_hash: format!("{pdf_hash}:{page}"),
    }
}

fn document_from_asset(asset: &EntryVisualAsset) -> VisualIndexDocument {
    VisualIndexDocument {
        entry_id: asset.entry_id.clone(),
        kind: match asset.segment_type {
            Some(neuink_domain::SegmentType::Table) => neuink_search::VisualSourceKind::Table,
            _ => neuink_search::VisualSourceKind::Figure,
        },
        source_id: asset.relative_path.clone(),
        page_idx: asset.page_idx,
        region: None,
        segment_type: asset.segment_type,
        content_hash: asset.content_hash.clone(),
    }
}

fn query_cache() -> &'static Mutex<BTreeMap<String, Vec<f32>>> {
    static CACHE: OnceLock<Mutex<BTreeMap<String, Vec<f32>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(BTreeMap::new()))
}

struct InFlightQuery {
    state: Mutex<Option<Result<Vec<f32>, String>>>,
    done: Condvar,
}

impl InFlightQuery {
    fn new() -> Self {
        Self {
            state: Mutex::new(None),
            done: Condvar::new(),
        }
    }

    fn finish(&self, outcome: Result<Vec<f32>, String>) {
        if let Ok(mut guard) = self.state.lock() {
            if guard.is_none() {
                *guard = Some(outcome);
            }
            self.done.notify_all();
        }
    }

    fn wait(&self) -> Result<Vec<f32>, String> {
        let Ok(mut guard) = self.state.lock() else {
            return Err("视觉查询等待锁异常".to_string());
        };
        while guard.is_none() {
            guard = match self.done.wait(guard) {
                Ok(next) => next,
                Err(_) => return Err("视觉查询等待锁异常".to_string()),
            };
        }
        guard
            .clone()
            .unwrap_or_else(|| Err("视觉查询未返回结果".to_string()))
    }
}

fn in_flight_queries() -> &'static Mutex<HashMap<String, Arc<InFlightQuery>>> {
    static IN_FLIGHT: OnceLock<Mutex<HashMap<String, Arc<InFlightQuery>>>> = OnceLock::new();
    IN_FLIGHT.get_or_init(|| Mutex::new(HashMap::new()))
}

struct InFlightGuard {
    key: String,
    slot: Arc<InFlightQuery>,
    completed: bool,
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        if let Ok(mut map) = in_flight_queries().lock() {
            if let Some(current) = map.get(&self.key) {
                if Arc::ptr_eq(current, &self.slot) {
                    map.remove(&self.key);
                }
            }
        }
        if !self.completed {
            self.slot
                .finish(Err("视觉查询在编码完成前中止".to_string()));
        }
    }
}

/// Encodes `question` via `provider` with both result caching and single-flight
/// deduplication across concurrent sub-tasks sharing the same routing question.
fn query_vector(
    provider: &dyn VisualEmbeddingProvider,
    identity: &str,
    question: &str,
) -> neuink_search::SearchResult<Vec<f32>> {
    let key = format!("{identity}\u{1f}{question}");
    if let Ok(cache) = query_cache().lock() {
        if let Some(vector) = cache.get(&key) {
            return Ok(vector.clone());
        }
    }

    let (slot, is_leader) = {
        let Ok(mut in_flight) = in_flight_queries().lock() else {
            return provider.embed_query_text(question);
        };
        // Re-check cache while holding `in_flight` to avoid missing a just-completed leader.
        if let Ok(cache) = query_cache().lock() {
            if let Some(vector) = cache.get(&key) {
                return Ok(vector.clone());
            }
        }
        if let Some(existing) = in_flight.get(&key) {
            (Arc::clone(existing), false)
        } else {
            let created = Arc::new(InFlightQuery::new());
            in_flight.insert(key.clone(), Arc::clone(&created));
            (created, true)
        }
    };

    if !is_leader {
        return slot
            .wait()
            .map_err(neuink_search::SearchError::EmbeddingUnavailable);
    }

    let mut guard = InFlightGuard {
        key: key.clone(),
        slot: Arc::clone(&slot),
        completed: false,
    };
    let result = provider.embed_query_text(question);
    match result {
        Ok(vector) => {
            if let Ok(mut cache) = query_cache().lock() {
                if cache.len() >= VISUAL_QUERY_CACHE_LIMIT {
                    cache.clear();
                }
                cache.insert(key, vector.clone());
            }
            guard.completed = true;
            slot.finish(Ok(vector.clone()));
            Ok(vector)
        }
        Err(error) => {
            guard.completed = true;
            slot.finish(Err(error.to_string()));
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(page: Option<u32>) -> EntryVisualAsset {
        EntryVisualAsset {
            entry_id: "entry-1".to_string(),
            relative_path: "images/a.jpg".to_string(),
            page_idx: page,
            segment_type: None,
            content_hash: "hash".to_string(),
        }
    }

    #[test]
    fn an_asset_becomes_an_index_document_with_a_stable_key() {
        let document = document_from_asset(&asset(Some(7)));
        assert_eq!(document.entry_id, "entry-1");
        assert_eq!(document.source_id, "images/a.jpg");
        assert_eq!(document.kind, neuink_search::VisualSourceKind::Figure);
        assert_eq!(document.page_idx, Some(7));
        assert_eq!(document.key(), "entry-1\u{1f}images/a.jpg\u{1f}hash");
        assert_eq!(document.parent_id(), "asset:images/a.jpg");
    }

    #[test]
    fn a_page_and_its_crops_resolve_to_one_parent_and_keep_the_pdf_hash() {
        let page = page_document("entry-1", "pdf-hash", 4, None);
        let crop = page_document("entry-1", "pdf-hash", 4, Some(2));
        assert_eq!(page.kind, neuink_search::VisualSourceKind::Page);
        assert_eq!(crop.kind, neuink_search::VisualSourceKind::Region);
        assert_eq!(page.source_id, "page:4");
        assert_eq!(crop.source_id, "page:4:r2");
        // Both crops and the page share one parent, so the page votes once.
        assert_eq!(page.parent_id(), crop.parent_id());
        assert_eq!(page.content_hash, "pdf-hash:4");
        assert_eq!(crop.region_index(), Some(2));
        assert_eq!(page.region_index(), None);
    }

    #[test]
    fn the_registry_maps_each_kind_to_a_provider_and_never_hides_a_retired_one() {
        use neuink_config::{VisualEmbeddingProviderKind, VisualEmbeddingSettings};

        let retired = provider_for(&VisualEmbeddingSettings {
            provider: VisualEmbeddingProviderKind::Retired,
            ..VisualEmbeddingSettings::default()
        });
        assert!(!retired.status().available);
        assert!(retired
            .status()
            .message
            .as_deref()
            .is_some_and(|message| message.contains("已停用")));

        // An unreachable local service yields an unavailable provider, not a panic and not
        // a silent text-only search.
        let local = provider_for(&VisualEmbeddingSettings {
            provider: VisualEmbeddingProviderKind::QwenLocal,
            endpoint: Some("http://127.0.0.1:9".to_string()),
            timeout_ms: 200,
            ..VisualEmbeddingSettings::default()
        });
        assert!(!local.status().available);
        assert_eq!(local.status().provider, "qwen-service");
    }

    #[test]
    fn reason_codes_are_fixed_and_distinct() {
        assert_eq!(VISUAL_REASON_MODEL_UNAVAILABLE, "model_unavailable");
        assert_eq!(VISUAL_REASON_INDEX_MISSING, "index_missing");
        let channel = VisualChannel {
            status: VisualChannelStatus::Unavailable(VISUAL_REASON_INDEX_MISSING),
            provider: Arc::new(neuink_search::NoVisualProvider::default()),
            index: None,
            identity: None,
        };
        assert_eq!(channel.status_code(), "index_missing");
        assert!(!channel.status().is_ready());
    }

    fn zip_with_images(names: &[&str]) -> Vec<u8> {
        use std::io::{Cursor, Write};
        use zip::{write::SimpleFileOptions, ZipWriter};
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file("paper_content_list.json", SimpleFileOptions::default())
            .expect("json entry");
        writer.write_all(b"[]").expect("json bytes");
        for name in names {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .expect("start");
            writer.write_all(b"pixels").expect("bytes");
        }
        writer.finish().expect("finish").into_inner()
    }

    #[test]
    fn the_collected_sources_cache_invalidates_when_the_source_zip_changes() {
        let root = std::env::temp_dir().join(format!("neuink-visual-cache-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("root");
        let workspace = Workspace::create(&root).expect("workspace");
        let entry = workspace.create_entry("Paper").expect("entry");
        workspace
            .write_mineru_output_zip(&entry.id, &zip_with_images(&["images/a.jpg"]))
            .expect("zip");

        let first = collect_assets(&root, false).expect("collect");
        assert_eq!(first.documents.len(), 1);
        let again = collect_assets(&root, false).expect("collect again");
        assert_eq!(again.documents, first.documents);

        // Touching the archive is the event: the cached set must not be reused.
        workspace
            .write_mineru_output_zip(
                &entry.id,
                &zip_with_images(&["images/a.jpg", "images/b.jpg"]),
            )
            .expect("rewrite zip");
        let after = collect_assets(&root, false).expect("collect after change");
        assert_eq!(after.documents.len(), 2);
        assert_eq!(after.assets.len(), 2);
        std::fs::remove_dir_all(&root).ok();
    }
    #[test]
    fn a_page_source_never_resolves_to_a_mineru_asset_on_the_same_page() {
        // Regression: MinerU assets carry a page index and no region, so matching only on
        // page/region used to return the asset key and left the page document vectorless.
        let figure = document_from_asset(&asset(Some(3)));
        let page = page_document("entry-1", "pdf-hash", 3, None);
        let documents = vec![figure, page.clone()];
        assert_eq!(page_key(&documents, "entry-1", 3, None), Some(page.key()));
        let crop = page_document("entry-1", "pdf-hash", 3, Some(2));
        let documents = vec![document_from_asset(&asset(Some(3))), crop.clone()];
        assert_eq!(
            page_key(&documents, "entry-1", 3, Some(2)),
            Some(crop.key())
        );
    }

    #[test]
    fn collect_assets_skips_pure_text_pdf_pages_and_keeps_figure_table_pages() {
        use neuink_domain::{SegmentType, SourceSegment};

        let root = std::env::temp_dir().join(format!(
            "neuink-visual-pages-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("root");
        let workspace = Workspace::create(&root).expect("workspace");
        let entry = workspace.create_entry("Paper").expect("entry");
        let pdf_path = root.join("origin.pdf");
        std::fs::write(&pdf_path, b"%PDF-1.4\n%%EOF\n").expect("pdf");
        workspace.import_pdf(&entry.id, &pdf_path).expect("import");
        for status in [
            neuink_domain::PdfParseStatus::Queued,
            neuink_domain::PdfParseStatus::Uploading,
            neuink_domain::PdfParseStatus::Uploaded,
            neuink_domain::PdfParseStatus::Parsing,
            neuink_domain::PdfParseStatus::Succeeded,
        ] {
            workspace
                .set_pdf_parse_state(&entry.id, status, None)
                .expect("parse");
        }
        workspace
            .write_segments(
                &entry.id,
                &[
                    SourceSegment::new(SegmentType::Paragraph, 0, None, "plain text".to_string()),
                    SourceSegment::new(SegmentType::Figure, 1, None, "a chart".to_string()),
                ],
            )
            .expect("segments");

        let collected = collect_assets(&root, true).expect("collect");
        let pages = collected
            .documents
            .iter()
            .filter(|document| document.kind == neuink_search::VisualSourceKind::Page)
            .map(|document| document.page_idx)
            .collect::<Vec<_>>();
        assert_eq!(pages, vec![Some(1)]);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_page_with_mineru_crops_is_not_rendered_and_a_formula_page_is_not_visual() {
        use neuink_domain::{SegmentType, SourceSegment};
        use std::io::{Cursor, Write};
        use zip::{write::SimpleFileOptions, ZipWriter};

        let root = std::env::temp_dir().join(format!(
            "neuink-visual-crop-fallback-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("root");
        let workspace = Workspace::create(&root).expect("workspace");
        let entry = workspace.create_entry("Paper").expect("entry");
        let pdf_path = root.join("origin.pdf");
        std::fs::write(&pdf_path, b"%PDF-1.4\n%%EOF\n").expect("pdf");
        workspace.import_pdf(&entry.id, &pdf_path).expect("import");
        for status in [
            neuink_domain::PdfParseStatus::Queued,
            neuink_domain::PdfParseStatus::Uploading,
            neuink_domain::PdfParseStatus::Uploaded,
            neuink_domain::PdfParseStatus::Parsing,
            neuink_domain::PdfParseStatus::Succeeded,
        ] {
            workspace
                .set_pdf_parse_state(&entry.id, status, None)
                .expect("parse");
        }
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in [
            ("images/fig.jpg", &b"figure"[..]),
            ("images/eq.jpg", &b"equation"[..]),
            ("images/logo.png", &b"logo"[..]),
        ] {
            writer
                .start_file(name, SimpleFileOptions::default())
                .expect("zip");
            writer.write_all(bytes).expect("bytes");
        }
        let zip = writer.finish().expect("finish").into_inner();
        workspace
            .write_mineru_output_zip(&entry.id, &zip)
            .expect("store zip");
        workspace
            .write_segments(
                &entry.id,
                &[
                    SourceSegment::new(SegmentType::Math, 0, None, "formula".to_string())
                        .with_asset_path(Some("images/eq.jpg".to_string())),
                    SourceSegment::new(SegmentType::Figure, 1, None, "covered chart".to_string())
                        .with_asset_path(Some("images/fig.jpg".to_string())),
                    SourceSegment::new(SegmentType::Table, 2, None, "uncropped table".to_string()),
                ],
            )
            .expect("segments");

        let collected = collect_assets(&root, true).expect("collect");
        let asset_paths = collected
            .documents
            .iter()
            .filter(|document| document.kind != neuink_search::VisualSourceKind::Page)
            .map(|document| document.source_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(asset_paths, vec!["images/fig.jpg"]);
        let pages = collected
            .documents
            .iter()
            .filter(|document| document.kind == neuink_search::VisualSourceKind::Page)
            .map(|document| document.page_idx)
            .collect::<Vec<_>>();
        assert_eq!(pages, vec![Some(2)]);
        std::fs::remove_dir_all(&root).ok();
    }

    struct FiniteProvider;

    impl VisualEmbeddingProvider for FiniteProvider {
        fn status(&self) -> neuink_search::VisualProviderStatus {
            neuink_search::VisualProviderStatus {
                available: true,
                provider: "fake".to_string(),
                model_name: Some("finite".to_string()),
                dimensions: Some(4),
                message: None,
            }
        }

        fn identity(&self) -> Option<String> {
            Some("finite-visual-cache-test".to_string())
        }

        fn dimensions(&self) -> Option<usize> {
            Some(4)
        }

        fn embed_assets(
            &self,
            assets: &[neuink_search::VisualAssetInput],
            on_progress: &dyn Fn(usize, usize),
        ) -> neuink_search::SearchResult<Vec<Vec<f32>>> {
            let vectors = assets
                .iter()
                .map(|_| vec![1.0, 0.0, 0.0, 0.0])
                .collect::<Vec<_>>();
            on_progress(vectors.len(), assets.len());
            Ok(vectors)
        }

        fn embed_query_text(&self, _text: &str) -> neuink_search::SearchResult<Vec<f32>> {
            Ok(vec![1.0, 0.0, 0.0, 0.0])
        }
    }

    fn zip_with_image_bytes(bytes: &[u8]) -> Vec<u8> {
        use std::io::{Cursor, Write};
        use zip::{write::SimpleFileOptions, ZipWriter};
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file("images/a.jpg", SimpleFileOptions::default())
            .expect("start");
        writer.write_all(bytes).expect("bytes");
        writer.finish().expect("finish").into_inner()
    }

    #[test]
    fn visual_index_cache_invalidates_when_snapshot_is_removed_or_source_changes() {
        let root = std::env::temp_dir().join(format!(
            "neuink-visual-index-cache-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("root");
        let workspace = Workspace::create(&root).expect("workspace");
        let entry = workspace.create_entry("Paper").expect("entry");
        workspace
            .write_mineru_output_zip(&entry.id, &zip_with_image_bytes(b"pixels-v1"))
            .expect("zip");
        let provider = Arc::new(FiniteProvider);
        let prepared = prepare_visual_index(
            provider.clone(),
            PrepareVisualSearchIndexRequest { root: root.clone() },
        )
        .expect("prepare");
        assert!(prepared.document_count >= 1);
        let ready = visual_channel(&root, provider.clone());
        assert!(ready.status().is_ready(), "{}", ready.status_code());

        let snapshot = visual_index_path(
            &workspace.layout().cache_dir(),
            &prepared.namespace,
        );
        assert!(snapshot.is_file(), "snapshot {}", snapshot.display());
        std::fs::remove_file(&snapshot).expect("delete snapshot");
        let after_delete = visual_channel(&root, provider.clone());
        assert_eq!(after_delete.status_code(), VISUAL_REASON_INDEX_MISSING);
        assert!(!after_delete.status().is_ready());

        prepare_visual_index(
            provider.clone(),
            PrepareVisualSearchIndexRequest { root: root.clone() },
        )
        .expect("reprepare");
        assert!(visual_channel(&root, provider.clone()).status().is_ready());

        workspace
            .write_mineru_output_zip(&entry.id, &zip_with_image_bytes(b"pixels-v2-changed"))
            .expect("rewrite zip");
        let after_change = visual_channel(&root, provider.clone());
        assert_eq!(after_change.status_code(), VISUAL_REASON_INDEX_MISSING);
        assert!(!after_change.status().is_ready());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn has_visual_snapshot_and_index_missing_fast_path_skip_network() {
        let root = std::env::temp_dir().join(format!(
            "neuink-visual-fast-path-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("root");
        let _workspace = Workspace::create(&root).expect("workspace");
        assert!(!has_visual_snapshot(&root));
        let channel = visual_channel(&root, index_missing_provider());
        assert_eq!(channel.status_code(), VISUAL_REASON_INDEX_MISSING);
        assert!(!channel.status().is_ready());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn provider_for_query_caches_unreachable_endpoint_until_invalidated() {
        invalidate_provider_cache();
        let settings = VisualEmbeddingSettings {
            provider: VisualEmbeddingProviderKind::QwenLocal,
            endpoint: Some("http://127.0.0.1:9".to_string()),
            api_key: None,
            timeout_ms: 500,
            fusion: neuink_config::VisualFusionSettings::default(),
            startup: neuink_config::VisualServiceStartup::Manual,
        };
        let first = provider_for_query(&settings);
        assert!(!first.status().available);

        let started = Instant::now();
        let second = provider_for_query(&settings);
        assert!(!second.status().available);
        assert!(
            started.elapsed() < Duration::from_millis(50),
            "expected negative cache hit, took {:?}",
            started.elapsed()
        );
        invalidate_provider_cache();
    }

    #[test]
    fn query_vector_deduplicates_concurrent_identical_requests() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Barrier;

        struct CountingSlowProvider {
            calls: AtomicUsize,
        }

        impl VisualEmbeddingProvider for CountingSlowProvider {
            fn status(&self) -> neuink_search::VisualProviderStatus {
                neuink_search::VisualProviderStatus {
                    available: true,
                    provider: "counting".to_string(),
                    model_name: Some("slow".to_string()),
                    dimensions: Some(3),
                    message: None,
                }
            }

            fn identity(&self) -> Option<String> {
                Some("single-flight-test".to_string())
            }

            fn dimensions(&self) -> Option<usize> {
                Some(3)
            }

            fn embed_assets(
                &self,
                _assets: &[neuink_search::VisualAssetInput],
                _on_progress: &dyn Fn(usize, usize),
            ) -> neuink_search::SearchResult<Vec<Vec<f32>>> {
                Ok(Vec::new())
            }

            fn embed_query_text(&self, _text: &str) -> neuink_search::SearchResult<Vec<f32>> {
                self.calls.fetch_add(1, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(80));
                Ok(vec![0.5, 0.5, 0.5])
            }
        }

        let unique_identity = format!(
            "single-flight-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        );
        let provider = Arc::new(CountingSlowProvider {
            calls: AtomicUsize::new(0),
        });
        let barrier = Arc::new(Barrier::new(4));
        let mut handles = Vec::new();
        for _ in 0..4 {
            let p = Arc::clone(&provider);
            let b = Arc::clone(&barrier);
            let id = unique_identity.clone();
            handles.push(std::thread::spawn(move || {
                b.wait();
                query_vector(p.as_ref(), &id, "shared routing question").expect("vector")
            }));
        }
        for handle in handles {
            assert_eq!(handle.join().expect("join"), vec![0.5, 0.5, 0.5]);
        }
        assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
    }
}
