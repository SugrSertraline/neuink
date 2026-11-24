use std::{
    collections::{HashMap, HashSet},
    fs,
    hash::{DefaultHasher, Hash, Hasher},
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime},
};

use neuink_domain::{EntryId, SegmentType};
use neuink_search::{
    embed_query_vector, semantic_embedding_identity, semantic_index_path, EmbeddingProvider,
    FastEmbedProvider, MemorySearchIndex, PersistentSemanticSearchIndex, SearchDocument,
    SearchDocumentSource, SearchDocumentSourceKind, SearchInclude, SearchIndex, SearchMode,
    SearchQuery, SearchResults, SearchScope, SearchTarget,
};
use neuink_workspace::{
    Workspace, WorkspaceLayout, WorkspaceSearchOptions, WorkspaceSearchRecord,
    WorkspaceSearchRecordKind,
};
use serde::{de::IgnoredAny, Deserialize, Serialize};

use tauri::Manager;
use super::embedding_resources::{embedding_model_dir, rerank_model_dir};

pub mod unified;
pub mod rerank_stage;
mod multivector_stage;
pub mod visual;
pub mod page_render;
pub mod recommended_rerank_models;
pub mod recommended_visual_models;
pub mod recommended_text_models;
pub mod visual_qwen;
pub mod visual_runtime;
#[cfg(test)]
mod rerank_batch_tests;

pub use unified::{UnifiedSearchRequest, UnifiedSearchResponse};
pub use visual::{PrepareVisualSearchIndexRequest, PrepareVisualSearchIndexResponse};

const SEARCH_INDEX_CACHE_LIMIT: usize = 8;
const SEMANTIC_INDEX_CACHE_LIMIT: usize = 3;
const EMBEDDING_PROVIDER_CACHE_LIMIT: usize = 1;
const CACHE_TTL: Duration = Duration::from_secs(60 * 30);
const CACHE_CLEANUP_INTERVAL: Duration = Duration::from_secs(60 * 5);
const DISK_VECTOR_CACHE_TTL: Duration = Duration::from_secs(60 * 60 * 24 * 14);
const BOOKRAG_SECTION_ALPHA: f32 = 0.0;
const SEMANTIC_INDEX_FORMAT_VERSION: u32 = neuink_search::SEMANTIC_INDEX_FORMAT_VERSION;

#[derive(Debug, Deserialize)]
pub struct SearchEntriesRequest {
    pub root: PathBuf,
    pub query: String,
    #[serde(default)]
    pub english_query: Option<String>,
    #[serde(default)]
    pub sub_queries: Vec<String>,
    #[serde(default)]
    pub section_filter: Option<String>,
    #[serde(default)]
    pub segment_types: Vec<String>,
    #[serde(default)]
    pub scope_entry_ids: Vec<EntryId>,
    #[serde(default)]
    pub mode: SearchMode,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct SearchSegmentsRequest {
    pub root: PathBuf,
    pub query: String,
    #[serde(default)]
    pub english_query: Option<String>,
    #[serde(default)]
    pub sub_queries: Vec<String>,
    #[serde(default)]
    pub section_filter: Option<String>,
    #[serde(default)]
    pub segment_types: Vec<String>,
    #[serde(default)]
    pub scope_entry_ids: Vec<EntryId>,
    #[serde(default)]
    pub mode: SearchMode,
    #[serde(default)]
    pub top_k: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct SearchSegmentTask {
    /// Echoed back on the matching batch item so the caller can associate results.
    #[serde(default)]
    pub task_id: String,
    /// Blank queries fail only their own task; see `collect_segments_batch`.
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub english_query: Option<String>,
    #[serde(default)]
    pub sub_queries: Vec<String>,
    #[serde(default)]
    pub section_filter: Option<String>,
    #[serde(default)]
    pub segment_types: Vec<String>,
    #[serde(default)]
    pub scope_entry_ids: Vec<EntryId>,
    #[serde(default)]
    pub mode: SearchMode,
    #[serde(default)]
    pub top_k: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct SearchSegmentsBatchRequest {
    pub root: PathBuf,
    pub tasks: Vec<SearchSegmentTask>,
}

/// One ordered entry per submitted task. Exactly one of `results` or `error` is set.
#[derive(Debug, Serialize)]
pub struct SearchSegmentsBatchItem {
    pub task_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub results: Option<SearchResults>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<SearchSegmentsTaskError>,
    /// Which rerank rung ran: `off`, `heuristic`, `cross_encoder`, `cross_encoder+scope_v6`, `fused`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rerank_used: Option<&'static str>,
    /// Why a rung was skipped: `model_unavailable`, `provider_error`, `scope_refine_unconfigured`, `scope_refine_error`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rerank_reason: Option<&'static str>,
    /// Tail swaps from scope refine. Omitted when the cross-encoder order stands.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub scope_swaps: Vec<neuink_search::ScopeSwapSummary>,
    /// `single_vector`, `colbert`, or `bge_m3_hybrid`. Omitted when the pool is off.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pool_used: Option<&'static str>,
    /// Why the pool fell back: `colbert_head_missing`, `sparse_head_missing`, `provider_unsupported`, `provider_error`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pool_reason: Option<&'static str>,
    /// The caller's top_k, kept off the wire so the ladder can cut after a wider recall.
    #[serde(skip)]
    pub requested_top_k: usize,
    /// Optional English translation kept off the wire so rerankers can use it for CJK queries
    /// over English papers.
    #[serde(skip)]
    pub english_query: Option<String>,
}

/// Fixed, path-free codes. Raw backend errors can contain workspace paths, so they are dropped.
#[derive(Debug, Serialize)]
pub struct SearchSegmentsTaskError {
    pub code: &'static str,
    pub message: &'static str,
}

#[derive(Debug, Deserialize)]
pub struct SearchIndexStatusRequest {
    pub root: PathBuf,
    #[serde(default)]
    pub segments_only: bool,
}

#[derive(Debug, Deserialize)]
pub struct RebuildSearchIndexRequest {
    pub root: PathBuf,
    #[serde(default)]
    pub segments_only: bool,
}

#[derive(Debug, Serialize)]
pub struct SearchIndexStatus {
    pub scope: String,
    pub semantic_status: SemanticIndexState,
    pub document_count: usize,
    pub semantic_document_count: usize,
    pub records_fingerprint: String,
    pub keyword_memory_cache_ready: bool,
    pub semantic_memory_cache_ready: bool,
    pub semantic_disk_cache_ready: bool,
    pub semantic_disk_cache_path: String,
    pub semantic_disk_cache_record_count: Option<usize>,
    pub semantic_disk_cache_modified_at_ms: Option<u64>,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SemanticIndexState {
    Empty,
    ReadyMemory,
    ReadyDisk,
    NeedsBuild,
}

#[derive(Debug, Serialize)]
pub struct RebuildSearchIndexResponse {
    pub status: SearchIndexStatus,
    pub rebuilt_vector_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchIndexBuildState {
    Idle,
    Queued,
    Running,
    Ready,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SearchIndexBuildStatus {
    pub root: String,
    pub state: SearchIndexBuildState,
    pub scope: String,
    pub phase: String,
    pub completed: usize,
    pub total: usize,
    pub message: String,
    pub error: Option<String>,
    pub started_at_ms: u64,
    pub updated_at_ms: u64,
}

struct CachedWorkspaceIndex {
    fingerprint: u64,
    index: Arc<MemorySearchIndex>,
    surrounding_contexts: Arc<neuink_search::SegmentContextMap>,
    visual_page_segments: Arc<neuink_search::VisualPageSegments>,
    last_used: Instant,
}

struct CachedSemanticIndex {
    fingerprint: u64,
    index: Arc<PersistentSemanticSearchIndex>,
    last_used: Instant,
}

struct CachedEmbeddingProvider {
    provider: Arc<dyn EmbeddingProvider>,
    signature: String,
    last_used: Instant,
}

static SEARCH_INDEX_CACHE: OnceLock<Mutex<HashMap<String, CachedWorkspaceIndex>>> = OnceLock::new();
static SEMANTIC_INDEX_CACHE: OnceLock<Mutex<HashMap<String, CachedSemanticIndex>>> =
    OnceLock::new();
static EMBEDDING_PROVIDER_CACHE: OnceLock<Mutex<HashMap<String, CachedEmbeddingProvider>>> =
    OnceLock::new();
static DISK_VECTOR_CACHE_LAST_CLEANUP: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
static SEARCH_BUILD_STATUS: OnceLock<Mutex<HashMap<String, SearchIndexBuildStatus>>> =
    OnceLock::new();
static SEMANTIC_BUILD_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static SEMANTIC_AUTO_REBUILD_KEYS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

pub fn spawn_search_cache_workers<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    // Keep cache eviction alive at startup. Legacy semantic snapshots are
    // rebuilt lazily in a detached worker on the first semantic request, so
    // keyword search remains available while the new index is prepared.
    thread::Builder::new()
        .name("neuink-search-cache-cleanup".to_string())
        .spawn(clean_search_caches_loop)
        .ok();

    // Warm configured local retrieval models (and installed on-demand local visual
    // service) shortly after startup so the first assistant query avoids cold load.
    thread::Builder::new()
        .name("neuink-retrieval-prewarm".to_string())
        .spawn(move || prewarm_retrieval_models(app))
        .ok();
}

fn prewarm_retrieval_models<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    use neuink_config::{
        RerankMode, RerankTransport, TextEmbeddingProviderKind, VisualEmbeddingProviderKind,
        VisualServiceStartup,
    };

    thread::sleep(Duration::from_millis(1500));
    let Ok(saved) = crate::storage::read_settings(&app) else {
        return;
    };

    if saved.text_model.provider == TextEmbeddingProviderKind::LocalOnnx {
        if let Ok(provider) = text_provider_for_app(&app) {
            if provider.status().available {
                let _ = semantic_embedding_identity(provider.as_ref());
                let _ = provider.embed(&[]);
            }
        }
    }

    if saved.rerank.mode == RerankMode::CrossEncoder
        && saved.rerank.transport == RerankTransport::Local
    {
        let _ = resolve_rerank(&app);
    }

    if saved.visual.provider == VisualEmbeddingProviderKind::QwenLocal
        && saved.visual.startup == VisualServiceStartup::OnDemand
        && ready_visual_runtime(&app).is_some()
    {
        let _ = ensure_visual_service(&app);
    }
}

#[tauri::command]
pub async fn search_entries<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: SearchEntriesRequest,
) -> Result<SearchResults, String> {
    let provider = text_provider_for_app(&app)?;
    tokio::task::spawn_blocking(move || {
        run_search_bundle(
            provider,
            request.root,
            request.query,
            request.english_query,
            request.sub_queries,
            request.scope_entry_ids,
            request.mode,
            request.limit.unwrap_or(40).clamp(1, 200),
            false,
            request.section_filter,
            parse_segment_types(&request.segment_types),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn search_segments<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: SearchSegmentsRequest,
) -> Result<SearchResults, String> {
    let provider = text_provider_for_app(&app)?;
    let saved = crate::storage::read_settings(&app)?;
    let multivector = saved.retrieval.multivector;
    let (rerank, rerank_provider, scope_judge, listwise) = resolve_rerank(&app)?;
    tokio::task::spawn_blocking(move || {
        run_segments_single(
            provider,
            rerank,
            rerank_provider,
            scope_judge,
            listwise,
            multivector,
            request,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Resources shared by every query in one search request. Built once per
/// `prepare_search` call; records and documents are dropped after preparation.
struct PreparedSearch {
    include: SearchInclude,
    keyword: Arc<MemorySearchIndex>,
    provider: Arc<dyn EmbeddingProvider>,
    semantic: Option<Arc<PersistentSemanticSearchIndex>>,
    /// Distinct entries in the prepared corpus. The document head needs the scope
    /// size to tell "no parsed documents" from "nothing ranked".
    document_count: usize,
    /// The same entries in first-seen order, so an empty request scope can mean this set
    /// rather than an empty boundary.
    entries: Vec<String>,
    /// Post-ranking read-only same-section `[Prev]`/`[Next]` context map.
    surrounding_contexts: Arc<neuink_search::SegmentContextMap>,
    /// Zero-I/O page-to-segment map for within-paper visual sidecar evidence rescue.
    visual_page_segments: Arc<neuink_search::VisualPageSegments>,
    /// Per-request query-vector memoization so routing, evidence, and chapter
    /// supplementation never re-embed the same query string twice.
    query_vectors: Mutex<HashMap<String, Vec<f32>>>,
}

impl PreparedSearch {
    pub(super) fn embed_query(&self, text: &str) -> Result<Vec<f32>, neuink_search::SearchError> {
        let key = text.trim();
        if let Ok(cache) = self.query_vectors.lock() {
            if let Some(vector) = cache.get(key) {
                return Ok(vector.clone());
            }
        }
        let vector = embed_query_vector(self.provider.as_ref(), key)?;
        if let Ok(mut cache) = self.query_vectors.lock() {
            cache.insert(key.to_string(), vector.clone());
        }
        Ok(vector)
    }
}

fn prepare_search(
    provider: Arc<dyn EmbeddingProvider>,
    root: &PathBuf,
    segments_only: bool,
    needs_semantic: bool,
) -> Result<PreparedSearch, String> {
    let (options, include) = search_scope_options(segments_only);
    let workspace = Workspace::open(root).map_err(|e| e.to_string())?;
    clean_disk_vector_cache(root);
    let records = workspace
        .collect_search_records(options.clone())
        .map_err(|e| e.to_string())?;
    let documents = records
        .iter()
        .cloned()
        .filter_map(search_document)
        .collect::<Vec<_>>();
    let (keyword, surrounding_contexts, visual_page_segments) = cached_workspace_bundle(
        root,
        &options,
        records_fingerprint(&records),
        documents.clone(),
    )?;
    let semantic_fingerprint = semantic_records_fingerprint(&records);
    let semantic = if needs_semantic {
        try_cached_semantic_index(
            root,
            &options,
            semantic_fingerprint,
            &include,
            &documents,
            provider.as_ref(),
        )
    } else {
        None
    };
    if needs_semantic && semantic.is_none() {
        schedule_legacy_semantic_rebuild(
            root,
            &options,
            semantic_fingerprint,
            &include,
            &documents,
            provider.clone(),
        );
    }
    Ok(PreparedSearch {
        include,
        keyword,
        provider,
        semantic,
        document_count: documents
            .iter()
            .map(|document| document.entry_id.as_str())
            .collect::<HashSet<_>>()
            .len(),
        entries: {
            let mut seen = HashSet::new();
            documents
                .iter()
                .map(|document| document.entry_id.to_string())
                .filter(|entry| seen.insert(entry.clone()))
                .collect()
        },
        surrounding_contexts,
        visual_page_segments,
        query_vectors: Mutex::new(HashMap::new()),
    })
}

#[allow(clippy::too_many_arguments)]
fn run_single_query(
    prepared: &PreparedSearch,
    primary: &str,
    english: Option<&str>,
    sub_queries: &[String],
    scope: Vec<EntryId>,
    mode: SearchMode,
    limit: usize,
    segments_only: bool,
    section_filter: Option<String>,
    segment_types: Vec<SegmentType>,
) -> Result<SearchResults, String> {
    let primary = primary.trim().to_string();
    let keyword = prepared.keyword.as_ref();
    // A keyword query never uses the semantic index, even when a sibling task in
    // the same batch needed it and it was prepared.
    let semantic = prepared
        .semantic
        .as_deref()
        .filter(|_| mode != SearchMode::Keyword);
    let template = SearchQuery {
        text: primary.clone(),
        mode,
        scope: SearchScope { entry_ids: scope },
        include: prepared.include.clone(),
        section_filter,
        segment_types,
        segments_only,
        filter_stopwords: false,
        limit,
    };
    let mut queries = vec![(primary.clone(), 1.0)];
    if let Some(q) = english.map(str::trim).filter(|q| !q.is_empty()) {
        queries.push((q.to_string(), 0.9));
    }
    for q in sub_queries
        .iter()
        .map(|q| q.trim().to_string())
        .filter(|q| !q.is_empty())
        .take(3)
    {
        if !queries.iter().any(|(existing, _)| existing == &q) {
            queries.push((q, 0.75));
        }
    }
    let window = neuink_search::candidate_window(limit);
    let mut primary_vector = None;
    let mut lists = Vec::new();
    for (i, (text, _)) in queries.iter().enumerate() {
        let mut query = template.clone();
        query.text = text.clone();
        let vector = if semantic.is_some() {
            prepared.embed_query(text).ok()
        } else {
            None
        };
        let result = neuink_search::recall_candidates(
            keyword,
            semantic,
            &query,
            vector.as_deref(),
            production_hybrid_policy(&query),
            window,
        );
        let result = match result {
            Ok(result) => result,
            Err(error) => {
                query.limit = window;
                keyword_fallback(keyword, query, error)?
            }
        };
        if i == 0 {
            primary_vector = vector;
        }
        lists.push(result);
    }
    let weights = queries
        .iter()
        .map(|(_, weight)| *weight)
        .collect::<Vec<_>>();
    let fused = neuink_search::fuse_query_candidates(&primary, &lists, &weights);
    let chapters = if BOOKRAG_SECTION_ALPHA > 0.0 {
        semantic.map(|index| index.chapter_centroids())
    } else {
        None
    };
    let mut result = neuink_search::finalize_candidates(
        fused,
        &template,
        primary_vector.as_deref(),
        chapters,
        BOOKRAG_SECTION_ALPHA,
        true,
    );
    if contains_cjk(&primary)
        && queries.len() == 1
        && (result.mode.contains("fallback") || result.total_hit_count == 0)
    {
        result
            .warnings
            .push("中文查询未提供英文检索词；请检查本地向量索引，或显式开启双语扩展。".into());
    }
    Ok(result)
}

fn run_search_bundle(
    provider: Arc<dyn EmbeddingProvider>,
    root: PathBuf,
    primary: String,
    english: Option<String>,
    sub_queries: Vec<String>,
    scope: Vec<EntryId>,
    mode: SearchMode,
    limit: usize,
    segments_only: bool,
    section_filter: Option<String>,
    segment_types: Vec<SegmentType>,
) -> Result<SearchResults, String> {
    let primary = primary.trim().to_string();
    if primary.is_empty() {
        return Err("query is required".into());
    }
    let prepared = prepare_search(provider, &root, segments_only, mode != SearchMode::Keyword)?;
    run_single_query(
        &prepared,
        &primary,
        english.as_deref(),
        &sub_queries,
        scope,
        mode,
        limit,
        segments_only,
        section_filter,
        segment_types,
    )
}

fn run_segments_single(
    provider: Arc<dyn EmbeddingProvider>,
    rerank: neuink_config::RerankSettings,
    rerank_provider: Option<Arc<dyn neuink_search::RerankProvider>>,
    scope_judge: Option<Arc<dyn neuink_search::ScopeJudgeProvider>>,
    listwise: Option<Arc<dyn neuink_search::ListwiseRerankProvider>>,
    multivector: neuink_config::MultivectorPoolSettings,
    request: SearchSegmentsRequest,
) -> Result<SearchResults, String> {
    let primary = request.query.trim().to_string();
    if primary.is_empty() {
        return Err("query is required".into());
    }
    let requested_top_k = request.top_k.unwrap_or(20).clamp(1, 20);
    let recall_limit =
        rerank_stage::effective_recall_window(requested_top_k, &rerank, &multivector);
    let pool_provider = provider.clone();
    let prepared = prepare_search(
        provider,
        &request.root,
        true,
        request.mode != SearchMode::Keyword,
    )?;
    let recalled = run_single_query(
        &prepared,
        &primary,
        request.english_query.as_deref(),
        &request.sub_queries,
        request.scope_entry_ids,
        request.mode,
        recall_limit,
        true,
        request.section_filter,
        parse_segment_types(&request.segment_types),
    )?;
    let cache_root = WorkspaceLayout::new(request.root)
        .cache_dir()
        .join("search");
    let (pooled, _) = multivector_stage::rescore_results_with_cache(
        recalled,
        &multivector,
        pool_provider.as_ref(),
        Some(&cache_root),
    );
    let (mut reranked, outcome) = unified::rerank_task_results_with_english(
        pooled,
        &primary,
        request.english_query.as_deref(),
        &rerank,
        rerank_provider.as_deref(),
        scope_judge.as_deref(),
        listwise.as_deref(),
        requested_top_k,
    );
    reranked.rerank_used = Some(outcome.used.to_string());
    neuink_search::attach_surrounding_context(
        &mut reranked,
        &prepared.surrounding_contexts,
        neuink_search::DEFAULT_SURROUNDING_CONTEXT_TOP_N,
    );
    Ok(reranked)
}

#[tauri::command]
pub async fn search_segments_batch<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: SearchSegmentsBatchRequest,
) -> Result<Vec<SearchSegmentsBatchItem>, String> {
    let provider = text_provider_for_app(&app)?;
    let saved = crate::storage::read_settings(&app)?;
    let multivector = saved.retrieval.multivector;
    let (rerank, rerank_provider, scope_judge, listwise) = resolve_rerank(&app)?;
    let pool_provider = provider.clone();
    tokio::task::spawn_blocking(move || {
        run_segments_batch(
            provider,
            rerank,
            rerank_provider,
            scope_judge,
            listwise,
            pool_provider,
            multivector,
            request,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Resolves the rerank ladder settings and, for the model-backed rung only, the loaded
/// encoder. Shared by both search entry points so one settings screen governs them both.
fn resolve_rerank<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<
    (
        neuink_config::RerankSettings,
        Option<Arc<dyn neuink_search::RerankProvider>>,
        Option<Arc<dyn neuink_search::ScopeJudgeProvider>>,
        Option<Arc<dyn neuink_search::ListwiseRerankProvider>>,
    ),
    String,
> {
    let settings = crate::storage::read_settings(app)?.rerank;
    let assistant = crate::commands::settings::peek_assistant_profile(app).ok().flatten();
    let provider: Option<Arc<dyn neuink_search::RerankProvider>> =
        if settings.mode == neuink_config::RerankMode::CrossEncoder {
            match settings.transport {
                neuink_config::RerankTransport::Api => {
                    rerank_stage::provider_for(&settings, std::path::Path::new(""))
                }
                neuink_config::RerankTransport::Local => {
                    let bundled = if settings
                        .model_dir
                        .as_deref()
                        .map(str::trim)
                        .is_some_and(|value| !value.is_empty())
                    {
                        None
                    } else {
                        rerank_model_dir(app).ok()
                    };
                    match rerank_stage::local_model_dir(&settings, bundled.as_deref()) {
                        Some(dir) => rerank_stage::provider_for(&settings, &dir),
                        None => None,
                    }
                }
            }
        } else {
            None
        };
    let scope_judge = rerank_stage::scope_judge_for(&settings, assistant.as_ref())
        .map(|judge| Arc::new(judge) as Arc<dyn neuink_search::ScopeJudgeProvider>);
    let listwise = rerank_stage::listwise_reranker_for(&settings, assistant.as_ref())
        .map(|reranker| reranker as Arc<dyn neuink_search::ListwiseRerankProvider>);
    Ok((settings, provider, scope_judge, listwise))
}

/// Applies the ladder to every successful batch item. The batch wire is unchanged except
/// for two additive fields, so a caller that ignores reranking keeps working.
#[cfg(test)]
fn apply_batch_rerank(
    items: Vec<SearchSegmentsBatchItem>,
    settings: &neuink_config::RerankSettings,
    provider: Option<&dyn neuink_search::RerankProvider>,
    scope_judge: Option<&dyn neuink_search::ScopeJudgeProvider>,
    listwise: Option<&dyn neuink_search::ListwiseRerankProvider>,
    embedding: Option<&dyn neuink_search::EmbeddingProvider>,
    multivector: &neuink_config::MultivectorPoolSettings,
) -> Vec<SearchSegmentsBatchItem> {
    apply_batch_rerank_with_cache(
        items,
        settings,
        provider,
        scope_judge,
        listwise,
        embedding,
        multivector,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
fn apply_batch_rerank_with_cache(
    items: Vec<SearchSegmentsBatchItem>,
    settings: &neuink_config::RerankSettings,
    provider: Option<&dyn neuink_search::RerankProvider>,
    scope_judge: Option<&dyn neuink_search::ScopeJudgeProvider>,
    listwise: Option<&dyn neuink_search::ListwiseRerankProvider>,
    embedding: Option<&dyn neuink_search::EmbeddingProvider>,
    multivector: &neuink_config::MultivectorPoolSettings,
    cache_root: Option<&std::path::Path>,
) -> Vec<SearchSegmentsBatchItem> {
    items
        .into_iter()
        .map(|item| match item.results {
            Some(results) => {
                let question = results.query.clone();
                let (results, pool) = match embedding {
                    Some(embedding) => multivector_stage::rescore_results_with_cache(
                        results,
                        multivector,
                        embedding,
                        cache_root,
                    ),
                    None => (results, None),
                };
                let (reranked, outcome) = unified::rerank_task_results_with_english(
                    results,
                    &question,
                    item.english_query.as_deref(),
                    settings,
                    provider,
                    scope_judge,
                    listwise,
                    item.requested_top_k,
                );
                SearchSegmentsBatchItem {
                    task_id: item.task_id,
                    results: Some(reranked),
                    error: item.error,
                    rerank_used: Some(outcome.used),
                    rerank_reason: outcome.reason,
                    scope_swaps: outcome.swaps,
                    pool_used: pool.map(|mark| mark.used),
                    pool_reason: pool.and_then(|mark| mark.reason),
                    requested_top_k: item.requested_top_k,
                    english_query: item.english_query,
                }
            }
            None => item,
        })
        .collect()
}

/// Prepares the workspace index and embedding provider once per batch, then runs
/// each task in order. Only a preparation failure fails the whole batch.
fn run_segments_batch(
    provider: Arc<dyn EmbeddingProvider>,
    rerank: neuink_config::RerankSettings,
    rerank_provider: Option<Arc<dyn neuink_search::RerankProvider>>,
    scope_judge: Option<Arc<dyn neuink_search::ScopeJudgeProvider>>,
    listwise: Option<Arc<dyn neuink_search::ListwiseRerankProvider>>,
    pool_provider: Arc<dyn EmbeddingProvider>,
    multivector: neuink_config::MultivectorPoolSettings,
    request: SearchSegmentsBatchRequest,
) -> Result<Vec<SearchSegmentsBatchItem>, String> {
    let SearchSegmentsBatchRequest { root, tasks } = request;
    let mut surrounding_contexts: Option<Arc<neuink_search::SegmentContextMap>> = None;
    let items = collect_segments_batch(
        tasks,
        |needs_semantic| {
            let prepared = prepare_search(provider, &root, true, needs_semantic)?;
            surrounding_contexts = Some(prepared.surrounding_contexts.clone());
            Ok(prepared)
        },
        |prepared, task| {
            let requested = task.top_k.unwrap_or(20).clamp(1, 20);
            let segment_types = parse_segment_types(&task.segment_types);
            let scope_for_chapters: Vec<String> = if task.scope_entry_ids.is_empty() {
                prepared.entries.clone()
            } else {
                task.scope_entry_ids
                    .iter()
                    .map(|id| id.as_str().to_string())
                    .collect()
            };
            let section_filter_for_chapters = task.section_filter.clone();
            let english_for_chapters = task.english_query.clone();
            let query_for_chapters = task.query.clone();
            let recalled = run_single_query(
                prepared,
                &task.query,
                task.english_query.as_deref(),
                &task.sub_queries,
                task.scope_entry_ids,
                task.mode,
                rerank_stage::effective_recall_window(requested, &rerank, &multivector),
                true,
                task.section_filter,
                segment_types.clone(),
            )?;
            let rerank_active =
                rerank.mode == neuink_config::RerankMode::CrossEncoder || rerank.listwise.enabled;
            let rerank_window = if rerank_active {
                rerank_stage::recall_window(requested, &rerank)
            } else {
                0
            };
            if rerank_active && rerank_window >= 6 {
                let chapter_query = english_for_chapters
                    .as_deref()
                    .map(str::trim)
                    .filter(|eng| !eng.is_empty() && contains_cjk(&query_for_chapters))
                    .unwrap_or(&query_for_chapters);
                if let (Some(semantic), Ok(query_vec)) = (
                    prepared.semantic.as_deref(),
                    prepared.embed_query(chapter_query),
                ) {
                    return Ok(neuink_search::supplement_hits_from_chapters(
                        recalled,
                        semantic,
                        &query_vec,
                        &scope_for_chapters,
                        &segment_types,
                        section_filter_for_chapters.as_deref(),
                        rerank_window,
                        3,
                        4,
                        10,
                    ));
                }
            }
            Ok(recalled)
        },
    )?;
    let cache_root = WorkspaceLayout::new(root).cache_dir().join("search");
    let mut reranked = apply_batch_rerank_with_cache(
        items,
        &rerank,
        rerank_provider.as_deref(),
        scope_judge.as_deref(),
        listwise.as_deref(),
        Some(pool_provider.as_ref()),
        &multivector,
        Some(&cache_root),
    );
    if let Some(contexts) = surrounding_contexts.as_deref() {
        for item in &mut reranked {
            if let Some(results) = item.results.as_mut() {
                neuink_search::attach_surrounding_context(
                    results,
                    contexts,
                    neuink_search::DEFAULT_SURROUNDING_CONTEXT_TOP_N,
                );
            }
        }
    }
    Ok(reranked)
}

const BATCH_INVALID_QUERY: SearchSegmentsTaskError = SearchSegmentsTaskError {
    code: "invalid_query",
    message: "query is required",
};
const BATCH_SEARCH_FAILED: SearchSegmentsTaskError = SearchSegmentsTaskError {
    code: "search_failed",
    message: "search task failed",
};

/// Generic over the prepared resources so the per-task isolation rules can be tested
/// without a workspace or embedding model. `prepare` is called at most once.
fn collect_segments_batch<P>(
    tasks: Vec<SearchSegmentTask>,
    prepare: impl FnOnce(bool) -> Result<P, String>,
    run: impl Fn(&P, SearchSegmentTask) -> Result<SearchResults, String>,
) -> Result<Vec<SearchSegmentsBatchItem>, String> {
    let any_valid = tasks.iter().any(|task| !task.query.trim().is_empty());
    if !any_valid {
        // Nothing to search: do not open the workspace at all.
        return Ok(tasks
            .into_iter()
            .map(|task| batch_error_item(task.task_id, BATCH_INVALID_QUERY))
            .collect());
    }
    let needs_semantic = tasks
        .iter()
        .any(|task| !task.query.trim().is_empty() && task.mode != SearchMode::Keyword);
    let prepared = prepare(needs_semantic)?;
    Ok(tasks
        .into_iter()
        .map(|task| {
            if task.query.trim().is_empty() {
                return batch_error_item(task.task_id, BATCH_INVALID_QUERY);
            }
            let task_id = task.task_id.clone();
            let requested_top_k = task.top_k.unwrap_or(20).clamp(1, 20);
            let english_query = task.english_query.clone();
            match run(&prepared, task) {
                Ok(results) => SearchSegmentsBatchItem {
                    task_id,
                    results: Some(results),
                    error: None,
                    // The ladder runs after the batch; until then no rung has been applied.
                    rerank_used: None,
                    rerank_reason: None,
                    scope_swaps: Vec::new(),
                    pool_used: None,
                    pool_reason: None,
                    requested_top_k,
                    english_query,
                },
                Err(_) => batch_error_item(task_id, BATCH_SEARCH_FAILED),
            }
        })
        .collect())
}

fn batch_error_item(task_id: String, error: SearchSegmentsTaskError) -> SearchSegmentsBatchItem {
    SearchSegmentsBatchItem {
        task_id,
        results: None,
        error: Some(error),
        rerank_used: None,
        rerank_reason: None,
        scope_swaps: Vec::new(),
        pool_used: None,
        pool_reason: None,
        requested_top_k: 0,
        english_query: None,
    }
}

// Updated only from the frozen selection and independent gate report.
fn production_hybrid_policy(_query: &SearchQuery) -> neuink_search::HybridPolicy {
    neuink_search::HybridPolicy::Legacy
}

fn contains_cjk(text: &str) -> bool {
    text.chars()
        .any(|ch| matches!(ch, '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}'))
}

fn parse_segment_types(values: &[String]) -> Vec<SegmentType> {
    values
        .iter()
        .filter_map(|value| match value.trim().to_ascii_lowercase().as_str() {
            "paragraph" => Some(SegmentType::Paragraph),
            "heading" => Some(SegmentType::Heading),
            "table" => Some(SegmentType::Table),
            "figure" => Some(SegmentType::Figure),
            "math" | "equation" => Some(SegmentType::Math),
            "code" => Some(SegmentType::Code),
            "list" => Some(SegmentType::List),
            "aside_text" | "aside" => Some(SegmentType::AsideText),
            "page_footnote" | "footnote" => Some(SegmentType::PageFootnote),
            _ => None,
        })
        .collect()
}

#[tauri::command]
pub async fn get_search_index_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: SearchIndexStatusRequest,
) -> Result<SearchIndexStatus, String> {
    let provider = text_provider_for_app(&app)?;
    tokio::task::spawn_blocking(move || get_search_index_status_impl(request, provider))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_search_index_build_status(
    request: SearchIndexStatusRequest,
) -> Result<SearchIndexBuildStatus, String> {
    tokio::task::spawn_blocking(move || load_search_build_status(&request.root))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn rebuild_search_index<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: RebuildSearchIndexRequest,
) -> Result<RebuildSearchIndexResponse, String> {
    let provider = text_provider_for_app(&app)?;
    tokio::task::spawn_blocking(move || {
        begin_search_build(&request.root, "手动重建向量索引");
        let root = request.root.clone();
        let result = rebuild_search_index_impl(provider, request);
        if let Err(error) = &result {
            fail_search_build(&root, error);
        }
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

fn get_search_index_status_impl(
    request: SearchIndexStatusRequest,
    provider: Arc<dyn EmbeddingProvider>,
) -> Result<SearchIndexStatus, String> {
    let (scope, options, include) = search_scope_status_options(request.segments_only);
    let workspace = Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let records = workspace
        .collect_search_records(options.clone())
        .map_err(|error| error.to_string())?;
    let documents = records
        .iter()
        .cloned()
        .filter_map(search_document)
        .collect::<Vec<_>>();
    let semantic_document_count = documents
        .iter()
        .filter(|document| search_include_contains(&include, document.source.kind))
        .count();
    let records_fingerprint = records_fingerprint(&records);
    let semantic_fingerprint = semantic_records_fingerprint(&records);
    let keyword_cache_key = workspace_cache_key(&request.root, &options);
    let keyword_memory_cache_ready = SEARCH_INDEX_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .ok()
        .and_then(|cache| {
            cache
                .get(&keyword_cache_key)
                .map(|cached| cached.fingerprint == records_fingerprint)
        })
        .unwrap_or(false);

    let identity = semantic_embedding_identity(provider.as_ref());
    let semantic_cache_key =
        model_semantic_cache_key(&request.root, &options, &include, identity.as_deref());
    let semantic_memory_cache_ready =
        lookup_semantic_memory(semantic_cache_key.as_deref(), semantic_fingerprint).is_some();

    let cache_dir = WorkspaceLayout::new(request.root.clone()).cache_dir();
    let namespace =
        semantic_cache_namespace(&request.root, &options, &include, identity.as_deref());
    let semantic_disk_cache_path = semantic_index_path(cache_dir, &namespace);
    let disk_cache = read_semantic_disk_cache_status(&semantic_disk_cache_path);
    let semantic_disk_cache_ready = disk_cache
        .as_ref()
        .is_some_and(|status| status.current_for(semantic_fingerprint, identity.as_deref()));
    let semantic_disk_cache_modified_at_ms = semantic_disk_cache_path
        .metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);
    let semantic_disk_cache_record_count = disk_cache.map(|status| status.record_count);
    let semantic_status = semantic_index_state(
        semantic_document_count,
        semantic_memory_cache_ready,
        semantic_disk_cache_ready,
    );
    let message = search_index_status_message(semantic_document_count, &semantic_status);

    Ok(SearchIndexStatus {
        scope,
        semantic_status,
        document_count: documents.len(),
        semantic_document_count,
        records_fingerprint: records_fingerprint.to_string(),
        keyword_memory_cache_ready,
        semantic_memory_cache_ready,
        semantic_disk_cache_ready,
        semantic_disk_cache_path: semantic_disk_cache_path.display().to_string(),
        semantic_disk_cache_record_count,
        semantic_disk_cache_modified_at_ms,
        message,
    })
}

pub fn rebuild_search_index_impl(
    provider: Arc<dyn EmbeddingProvider>,
    request: RebuildSearchIndexRequest,
) -> Result<RebuildSearchIndexResponse, String> {
    // The manual build intentionally keeps the previous disk snapshot so
    // `open_or_build_with_progress` only embeds documents that are new or
    // changed since the last build instead of re-embedding the workspace.
    let workspace = Workspace::open(&request.root).map_err(|error| error.to_string())?;

    // A global build also refreshes the segments-only scope so assistant
    // segment search keeps working after the startup warmup was removed.
    let scopes = if request.segments_only {
        vec![search_scope_options(true)]
    } else {
        vec![search_scope_options(false), search_scope_options(true)]
    };
    let mut semantic_document_count = 0;
    let mut shared_vectors: HashMap<String, Vec<f32>> = HashMap::new();
    for (options, include) in scopes {
        // Each scope must fingerprint the exact record set its searches use,
        // otherwise the disk snapshot never matches at query time.
        let records = workspace
            .collect_search_records(options.clone())
            .map_err(|error| error.to_string())?;
        let documents = records
            .iter()
            .cloned()
            .filter_map(search_document)
            .collect::<Vec<_>>();
        semantic_document_count = semantic_document_count.max(documents.len());
        if documents.is_empty() {
            continue;
        }

        let records_fingerprint = records_fingerprint(&records);
        let semantic_fingerprint = semantic_records_fingerprint(&records);
        let keyword_index = cached_index(
            &request.root,
            &options,
            records_fingerprint,
            documents.clone(),
        )?;
        let _ = keyword_index.generation();
        let semantic_index = cached_semantic_index(
            &request.root,
            &options,
            semantic_fingerprint,
            &include,
            &documents,
            provider.clone(),
            Some(if options.include_segments && !options.include_entry_meta {
                "segments"
            } else {
                "global"
            }),
            shared_vectors.clone(),
        )
        .map_err(|error| error.to_string())?;
        shared_vectors.extend(semantic_index.export_vectors());
    }

    let status = get_search_index_status_impl(
        SearchIndexStatusRequest {
            root: request.root,
            segments_only: request.segments_only,
        },
        provider,
    )?;
    Ok(RebuildSearchIndexResponse {
        status,
        rebuilt_vector_count: semantic_document_count,
    })
}

fn cached_index(
    root: &PathBuf,
    options: &WorkspaceSearchOptions,
    fingerprint: u64,
    documents: Vec<SearchDocument>,
) -> Result<Arc<MemorySearchIndex>, String> {
    cached_workspace_bundle(root, options, fingerprint, documents).map(|(index, _, _)| index)
}

#[allow(clippy::type_complexity)]
fn cached_workspace_bundle(
    root: &PathBuf,
    options: &WorkspaceSearchOptions,
    fingerprint: u64,
    documents: Vec<SearchDocument>,
) -> Result<
    (
        Arc<MemorySearchIndex>,
        Arc<neuink_search::SegmentContextMap>,
        Arc<neuink_search::VisualPageSegments>,
    ),
    String,
> {
    let cache_key = workspace_cache_key(root, options);
    let cache = SEARCH_INDEX_CACHE.get_or_init(|| Mutex::new(HashMap::new()));

    if let Some(bundle) = cache
        .lock()
        .map_err(|_| "search cache lock is poisoned".to_string())?
        .get_mut(&cache_key)
        .filter(|cached| cached.fingerprint == fingerprint)
        .map(|cached| {
            cached.last_used = Instant::now();
            (
                cached.index.clone(),
                cached.surrounding_contexts.clone(),
                cached.visual_page_segments.clone(),
            )
        })
    {
        return Ok(bundle);
    }

    let surrounding_contexts = Arc::new(neuink_search::SegmentContextMap::from_documents(
        &documents,
    ));
    let visual_page_segments = Arc::new(neuink_search::VisualPageSegments::from_documents(
        &documents,
    ));
    let index = Arc::new(MemorySearchIndex::default());
    index
        .replace_documents(documents)
        .map_err(|error| error.to_string())?;
    let mut cache = cache
        .lock()
        .map_err(|_| "search cache lock is poisoned".to_string())?;
    cache.insert(
        cache_key,
        CachedWorkspaceIndex {
            fingerprint,
            index: index.clone(),
            surrounding_contexts: surrounding_contexts.clone(),
            visual_page_segments: visual_page_segments.clone(),
            last_used: Instant::now(),
        },
    );
    trim_workspace_cache(&mut cache);
    Ok((index, surrounding_contexts, visual_page_segments))
}

/// Files whose length or mtime changes when a model is replaced in place. The
/// provider hashes contents once, so a changed signature must drop the provider.
const MODEL_SIGNATURE_FILES: &[&str] = &[
    "onnx/model.onnx",
    "model.onnx",
    "tokenizer.json",
    "config.json",
    "special_tokens_map.json",
    "tokenizer_config.json",
    "sentencepiece.bpe.model",
    "neuink-embedding.json",
];

fn model_metadata_signature(model_dir: &std::path::Path) -> String {
    MODEL_SIGNATURE_FILES
        .iter()
        .map(
            |relative| match std::fs::metadata(model_dir.join(relative)) {
                Ok(metadata) => format!(
                    "{relative}:{}:{:?}",
                    metadata.len(),
                    metadata.modified().ok()
                ),
                Err(_) => format!("{relative}:-"),
            },
        )
        .collect::<Vec<_>>()
        .join("|")
}

/// One provider instance per transport configuration. Local providers cache a loaded ONNX
/// session (the expensive part); API providers cache an HTTP client and its connections.
fn cached_text_provider(
    settings: &neuink_config::TextModelSettings,
    local_dir: PathBuf,
) -> Result<Arc<dyn EmbeddingProvider>, neuink_search::SearchError> {
    use neuink_config::TextEmbeddingProviderKind;
    let (cache_key, signature) = match settings.provider {
        TextEmbeddingProviderKind::LocalOnnx => {
            let key = format!("local:{}", local_dir.display());
            (key, model_metadata_signature(&local_dir))
        }
        TextEmbeddingProviderKind::Api => {
            let endpoint = settings.endpoint.clone().unwrap_or_default();
            let model = settings.model.clone().unwrap_or_default();
            let dimensions = settings.dimensions.unwrap_or_default();
            let key = format!("api:{endpoint}|{model}|{dimensions}");
            let mut hasher = DefaultHasher::new();
            key.hash(&mut hasher);
            hasher.write_u64(settings.timeout_ms);
            settings.api_key.hash(&mut hasher);
            (key, hasher.finish().to_string())
        }
    };
    let cache = EMBEDDING_PROVIDER_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut cache = cache
        .lock()
        .map_err(|_| neuink_search::SearchError::LockPoisoned)?;
    if let Some(cached) = cache.get_mut(&cache_key) {
        if cached.signature == signature {
            cached.last_used = Instant::now();
            return Ok(cached.provider.clone());
        }
    }
    cache.remove(&cache_key);

    let provider: Arc<dyn EmbeddingProvider> = match settings.provider {
        TextEmbeddingProviderKind::LocalOnnx => {
            Arc::new(FastEmbedProvider::from_model_dir(local_dir))
        }
        TextEmbeddingProviderKind::Api => Arc::new(neuink_search::RemoteEmbeddingProvider::new(
            settings.endpoint.clone().unwrap_or_default(),
            settings.api_key.clone(),
            settings.model.clone().unwrap_or_default(),
            settings.dimensions.unwrap_or_default(),
            settings.timeout_ms,
        )?),
    };
    if !provider.status().available {
        return Ok(provider);
    }
    cache.insert(
        cache_key,
        CachedEmbeddingProvider {
            provider: provider.clone(),
            signature,
            last_used: Instant::now(),
        },
    );
    trim_embedding_provider_cache(&mut cache);
    Ok(provider)
}

/// Resolves the configured text encoder for one app handle. Commands call this once per
/// request; the pipeline below only ever sees `dyn EmbeddingProvider`.
pub(crate) fn text_provider_for_app<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Arc<dyn EmbeddingProvider>, String> {
    let settings = crate::storage::read_settings(app)?.text_model;
    let local_dir = if settings.provider == neuink_config::TextEmbeddingProviderKind::LocalOnnx {
        embedding_model_dir(app)?
    } else {
        PathBuf::new()
    };
    cached_text_provider(&settings, local_dir).map_err(|error| error.to_string())
}

fn cached_semantic_index(
    root: &PathBuf,
    options: &WorkspaceSearchOptions,
    records_fingerprint: u64,
    include: &SearchInclude,
    documents: &[SearchDocument],
    provider: Arc<dyn EmbeddingProvider>,
    progress_scope: Option<&str>,
    seed_vectors: HashMap<String, Vec<f32>>,
) -> Result<Arc<PersistentSemanticSearchIndex>, neuink_search::SearchError> {
    let identity = semantic_embedding_identity(provider.as_ref());
    let cache_key = model_semantic_cache_key(root, options, include, identity.as_deref());
    if let Some(index) = lookup_semantic_memory(cache_key.as_deref(), records_fingerprint) {
        return Ok(index);
    }

    let _build_guard = SEMANTIC_BUILD_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| neuink_search::SearchError::LockPoisoned)?;
    if let Some(index) = lookup_semantic_memory(cache_key.as_deref(), records_fingerprint) {
        return Ok(index);
    }

    let cache_dir = WorkspaceLayout::new(root.clone()).cache_dir();
    let identity = semantic_embedding_identity(provider.as_ref());
    let namespace = semantic_cache_namespace(root, options, include, identity.as_deref());
    let index_path = semantic_index_path(cache_dir, &namespace);
    let scope = progress_scope.unwrap_or("semantic");
    let semantic_total = documents
        .iter()
        .filter(|document| search_include_contains(include, document.source.kind))
        .count();
    update_search_build_progress(
        root,
        scope,
        "embedding",
        0,
        semantic_total,
        format!("正在构建{}向量索引", search_scope_display_name(scope)),
    );
    let progress = |completed: usize, total: usize| {
        update_search_build_progress(
            root,
            scope,
            "embedding",
            completed,
            total,
            format!(
                "正在构建{}向量索引 · {completed}/{total}",
                search_scope_display_name(scope)
            ),
        );
    };
    let index_result = PersistentSemanticSearchIndex::open_or_build_with_seed_and_progress(
        index_path,
        documents,
        provider.as_ref(),
        include,
        records_fingerprint,
        seed_vectors,
        &progress,
    );
    let index = match index_result {
        Ok(index) => Arc::new(index),
        Err(error) => {
            fail_search_build(root, &error.to_string());
            return Err(error);
        }
    };
    // Unknown identity: the index serves this build only and is never reused from memory.
    if let Some(cache_key) = cache_key {
        let cache = SEMANTIC_INDEX_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        let mut cache = cache
            .lock()
            .map_err(|_| neuink_search::SearchError::LockPoisoned)?;
        cache.insert(
            cache_key,
            CachedSemanticIndex {
                fingerprint: records_fingerprint,
                index: index.clone(),
                last_used: Instant::now(),
            },
        );
        trim_semantic_cache(&mut cache);
    }
    finish_search_build(
        root,
        format!(
            "{}向量索引已就绪 · {}",
            search_scope_display_name(scope),
            index.document_count()
        ),
    );
    Ok(index)
}

/// Returns a semantic index only when it is already available (memory cache or
/// a fingerprint-current disk snapshot). Never triggers embedding work, so
/// search requests stay cheap until the user explicitly builds the index.
fn try_cached_semantic_index(
    root: &PathBuf,
    options: &WorkspaceSearchOptions,
    records_fingerprint: u64,
    include: &SearchInclude,
    documents: &[SearchDocument],
    provider: &dyn EmbeddingProvider,
) -> Option<Arc<PersistentSemanticSearchIndex>> {
    let identity = semantic_embedding_identity(provider)?;
    let cache_key = model_semantic_cache_key(root, options, include, Some(&identity));
    if let Some(index) = lookup_semantic_memory(cache_key.as_deref(), records_fingerprint) {
        return Some(index);
    }

    let cache_dir = WorkspaceLayout::new(root.clone()).cache_dir();
    let namespace = semantic_cache_namespace(root, options, include, Some(&identity));
    let index_path = semantic_index_path(cache_dir, &namespace);
    let index = PersistentSemanticSearchIndex::open_cached_with_identity(
        &index_path,
        documents,
        include,
        records_fingerprint,
        &identity,
    )
    .ok()??;
    let index = Arc::new(index);
    if let Some(cache_key) = cache_key {
        let cache = SEMANTIC_INDEX_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        if let Ok(mut cache) = cache.lock() {
            cache.insert(
                cache_key,
                CachedSemanticIndex {
                    fingerprint: records_fingerprint,
                    index: index.clone(),
                    last_used: Instant::now(),
                },
            );
            trim_semantic_cache(&mut cache);
        }
    }
    Some(index)
}

fn schedule_legacy_semantic_rebuild(
    root: &PathBuf,
    options: &WorkspaceSearchOptions,
    records_fingerprint: u64,
    include: &SearchInclude,
    documents: &[SearchDocument],
    provider: Arc<dyn EmbeddingProvider>,
) {
    let cache_dir = WorkspaceLayout::new(root.clone()).cache_dir();
    let identity = semantic_embedding_identity(provider.as_ref());
    let namespace = semantic_cache_namespace(root, options, include, identity.as_deref());
    let index_path = semantic_index_path(cache_dir.clone(), &namespace);
    let cache_status = read_semantic_disk_cache_status(&index_path);
    let has_stale_sibling =
        cache_status.is_none() && has_any_semantic_disk_snapshot(&cache_dir.join("search"));
    let provider_ready = provider.status().available;
    if !should_schedule_legacy_semantic_rebuild(cache_status.as_ref(), provider_ready)
        && !(provider_ready && has_stale_sibling)
    {
        return;
    }

    // Dedupe key only; reuse decisions go through `model_semantic_cache_key`.
    let active_key = format!(
        "{}|{}",
        semantic_cache_key(root, options, include),
        identity.as_deref().unwrap_or("unknown-identity")
    );
    let active = SEMANTIC_AUTO_REBUILD_KEYS.get_or_init(|| Mutex::new(HashSet::new()));
    let Ok(mut active_keys) = active.lock() else {
        return;
    };
    if !active_keys.insert(active_key.clone()) {
        return;
    }
    drop(active_keys);

    let root = root.clone();
    let options = options.clone();
    let include = include.clone();
    let documents = documents.to_vec();
    let scope = if options.include_segments && !options.include_entry_meta {
        "segments"
    } else {
        "global"
    };
    let worker_key = active_key.clone();
    let spawn = thread::Builder::new()
        .name("neuink-search-semantic-auto-rebuild".to_string())
        .spawn(move || {
            let result = cached_semantic_index(
                &root,
                &options,
                records_fingerprint,
                &include,
                &documents,
                provider,
                Some(scope),
                HashMap::new(),
            );
            if let Err(error) = result {
                fail_search_build(&root, &error.to_string());
            }
            if let Ok(mut active_keys) = SEMANTIC_AUTO_REBUILD_KEYS
                .get_or_init(|| Mutex::new(HashSet::new()))
                .lock()
            {
                active_keys.remove(&worker_key);
            }
        });
    if spawn.is_err() {
        if let Ok(mut active_keys) = active.lock() {
            active_keys.remove(&active_key);
        }
    }
}

fn should_schedule_legacy_semantic_rebuild(
    cache_status: Option<&SemanticDiskCacheStatus>,
    provider_available: bool,
) -> bool {
    provider_available
        && cache_status.is_some_and(|status| {
            status.version != SEMANTIC_INDEX_FORMAT_VERSION
                || status.representation_version != neuink_search::EMBEDDING_REPRESENTATION_VERSION
        })
}

fn has_any_semantic_disk_snapshot(search_cache_dir: &std::path::Path) -> bool {
    let Ok(entries) = fs::read_dir(search_cache_dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return false;
        };
        name.starts_with("semantic-") && name.ends_with(".vectors.json")
    })
}

/// `None` for an unknown model identity. Such entries are never stored or reused
/// from memory, because unidentified models would otherwise share one key.
fn model_semantic_cache_key(
    root: &PathBuf,
    options: &WorkspaceSearchOptions,
    include: &SearchInclude,
    identity: Option<&str>,
) -> Option<String> {
    identity.map(|identity| format!("{}|{identity}", semantic_cache_key(root, options, include)))
}

fn lookup_semantic_memory(
    cache_key: Option<&str>,
    records_fingerprint: u64,
) -> Option<Arc<PersistentSemanticSearchIndex>> {
    let key = cache_key?;
    let cache = SEMANTIC_INDEX_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut cache = cache.lock().ok()?;
    let cached = cache
        .get_mut(key)
        .filter(|cached| cached.fingerprint == records_fingerprint)?;
    cached.last_used = Instant::now();
    Some(cached.index.clone())
}

fn semantic_cache_key(
    root: &PathBuf,
    options: &WorkspaceSearchOptions,
    include: &SearchInclude,
) -> String {
    format!(
        "{}|{}:{}:{}",
        workspace_cache_key(root, options),
        include.entry_meta,
        include.notes,
        include.segments
    )
}

/// The segments scope is the assistant's `search_segments` corpus: parsed
/// segments plus the user's notes and annotations anchored to them.
fn search_scope_options(segments_only: bool) -> (WorkspaceSearchOptions, SearchInclude) {
    if segments_only {
        (
            WorkspaceSearchOptions {
                include_entry_meta: false,
                include_notes: true,
                include_segments: true,
            },
            SearchInclude {
                entry_meta: false,
                notes: true,
                segments: true,
            },
        )
    } else {
        (WorkspaceSearchOptions::default(), SearchInclude::default())
    }
}

fn search_scope_status_options(
    segments_only: bool,
) -> (String, WorkspaceSearchOptions, SearchInclude) {
    let (options, include) = search_scope_options(segments_only);
    (
        if segments_only { "segments" } else { "global" }.to_string(),
        options,
        include,
    )
}

fn search_scope_display_name(scope: &str) -> &'static str {
    if scope == "segments" {
        "片段"
    } else {
        "全局"
    }
}

fn keyword_fallback(
    keyword_index: &MemorySearchIndex,
    mut query: SearchQuery,
    error: neuink_search::SearchError,
) -> Result<SearchResults, String> {
    let requested_mode = query.mode;
    query.mode = SearchMode::Keyword;
    let mut results = keyword_index
        .search(query)
        .map_err(|keyword_error| keyword_error.to_string())?;
    results.mode = match requested_mode {
        SearchMode::Semantic => "semantic_fallback_keyword".to_string(),
        SearchMode::Hybrid => "hybrid_fallback_keyword".to_string(),
        SearchMode::Keyword => "keyword".to_string(),
    };
    results.warnings.push(format!(
        "Embedding search is unavailable: {error}. Showing keyword fallback results."
    ));
    Ok(results)
}

fn load_search_build_status(root: &PathBuf) -> Result<SearchIndexBuildStatus, String> {
    let key = root.display().to_string();
    let cache = SEARCH_BUILD_STATUS.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(status) = cache
        .lock()
        .map_err(|_| "search build status lock is poisoned".to_string())?
        .get(&key)
        .cloned()
    {
        return Ok(status);
    }

    let status = fs::read(search_build_status_path(root))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<SearchIndexBuildStatus>(&bytes).ok())
        .unwrap_or_else(|| idle_search_build_status(root));
    if matches!(
        &status.state,
        SearchIndexBuildState::Queued | SearchIndexBuildState::Running
    ) {
        // Builds run inside the current application process and cannot survive
        // a restart. If an in-progress state exists only on disk, the previous
        // process stopped before it could record a terminal state. Recover to
        // idle instead of presenting or resuming a phantom background build.
        let recovered = interrupted_search_build_status(root);
        store_search_build_status(root, recovered.clone());
        return Ok(recovered);
    }
    cache
        .lock()
        .map_err(|_| "search build status lock is poisoned".to_string())?
        .insert(key, status.clone());
    Ok(status)
}

fn idle_search_build_status(root: &PathBuf) -> SearchIndexBuildStatus {
    let now = unix_time_ms();
    SearchIndexBuildStatus {
        root: root.display().to_string(),
        state: SearchIndexBuildState::Idle,
        scope: "all".to_string(),
        phase: "idle".to_string(),
        completed: 0,
        total: 0,
        message: "等待构建向量索引".to_string(),
        error: None,
        started_at_ms: now,
        updated_at_ms: now,
    }
}

fn interrupted_search_build_status(root: &PathBuf) -> SearchIndexBuildStatus {
    let mut status = idle_search_build_status(root);
    status.message = "上次向量索引构建已中断；等待用户手动构建".to_string();
    status
}

fn begin_search_build(root: &PathBuf, message: &str) {
    let now = unix_time_ms();
    store_search_build_status(
        root,
        SearchIndexBuildStatus {
            root: root.display().to_string(),
            state: SearchIndexBuildState::Queued,
            scope: "all".to_string(),
            phase: "queued".to_string(),
            completed: 0,
            total: 0,
            message: message.to_string(),
            error: None,
            started_at_ms: now,
            updated_at_ms: now,
        },
    );
}

fn update_search_build_progress(
    root: &PathBuf,
    scope: &str,
    phase: &str,
    completed: usize,
    total: usize,
    message: String,
) {
    let previous =
        load_search_build_status(root).unwrap_or_else(|_| idle_search_build_status(root));
    store_search_build_status(
        root,
        SearchIndexBuildStatus {
            root: root.display().to_string(),
            state: SearchIndexBuildState::Running,
            scope: scope.to_string(),
            phase: phase.to_string(),
            completed,
            total,
            message,
            error: None,
            started_at_ms: previous.started_at_ms,
            updated_at_ms: unix_time_ms(),
        },
    );
}

fn finish_search_build(root: &PathBuf, message: String) {
    let previous =
        load_search_build_status(root).unwrap_or_else(|_| idle_search_build_status(root));
    store_search_build_status(
        root,
        SearchIndexBuildStatus {
            root: root.display().to_string(),
            state: SearchIndexBuildState::Ready,
            scope: previous.scope,
            phase: "complete".to_string(),
            completed: previous.total,
            total: previous.total,
            message,
            error: None,
            started_at_ms: previous.started_at_ms,
            updated_at_ms: unix_time_ms(),
        },
    );
}

fn fail_search_build(root: &PathBuf, error: &str) {
    let previous =
        load_search_build_status(root).unwrap_or_else(|_| idle_search_build_status(root));
    store_search_build_status(
        root,
        SearchIndexBuildStatus {
            root: root.display().to_string(),
            state: SearchIndexBuildState::Failed,
            scope: previous.scope,
            phase: "failed".to_string(),
            completed: previous.completed,
            total: previous.total,
            message: "向量索引构建失败".to_string(),
            error: Some(error.to_string()),
            started_at_ms: previous.started_at_ms,
            updated_at_ms: unix_time_ms(),
        },
    );
}

fn store_search_build_status(root: &PathBuf, status: SearchIndexBuildStatus) {
    let key = root.display().to_string();
    if let Ok(mut cache) = SEARCH_BUILD_STATUS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
    {
        cache.insert(key, status.clone());
        while cache.len() > 4 {
            let Some(oldest_key) = cache
                .iter()
                .min_by_key(|(_, cached)| cached.updated_at_ms)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            cache.remove(&oldest_key);
        }
    }

    let path = search_build_status_path(root);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(&status) {
        let _ = fs::write(path, bytes);
    }
}

fn search_build_status_path(root: &PathBuf) -> PathBuf {
    WorkspaceLayout::new(root.clone())
        .cache_dir()
        .join("search")
        .join("build-status.json")
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn clean_search_caches_loop() {
    loop {
        thread::sleep(CACHE_CLEANUP_INTERVAL);
        clean_search_caches();
    }
}

fn clean_search_caches() {
    let cutoff = Instant::now() - CACHE_TTL;
    if let Some(cache) = SEARCH_INDEX_CACHE.get() {
        if let Ok(mut cache) = cache.lock() {
            cache.retain(|_, cached| cached.last_used >= cutoff);
            trim_workspace_cache(&mut cache);
        }
    }
    if let Some(cache) = SEMANTIC_INDEX_CACHE.get() {
        if let Ok(mut cache) = cache.lock() {
            cache.retain(|_, cached| cached.last_used >= cutoff);
            trim_semantic_cache(&mut cache);
        }
    }
    if let Some(cache) = EMBEDDING_PROVIDER_CACHE.get() {
        if let Ok(mut cache) = cache.lock() {
            cache.retain(|_, cached| cached.last_used >= cutoff);
            trim_embedding_provider_cache(&mut cache);
        }
    }
}

fn clean_disk_vector_cache(root: &PathBuf) {
    let root_key = root.display().to_string();
    let last_cleanup = DISK_VECTOR_CACHE_LAST_CLEANUP.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut last_cleanup) = last_cleanup.lock() {
        if last_cleanup
            .get(&root_key)
            .is_some_and(|last| last.elapsed() < CACHE_CLEANUP_INTERVAL)
        {
            return;
        }
        last_cleanup.insert(root_key, Instant::now());
    }

    let search_dir = WorkspaceLayout::new(root.clone())
        .cache_dir()
        .join("search");
    let Ok(entries) = fs::read_dir(search_dir) else {
        return;
    };
    let cutoff = SystemTime::now()
        .checked_sub(DISK_VECTOR_CACHE_TTL)
        .unwrap_or(SystemTime::UNIX_EPOCH);

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !file_name.starts_with("semantic-") || !file_name.ends_with(".vectors.json") {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if modified < cutoff {
            let _ = fs::remove_file(path);
        }
    }
}

fn trim_workspace_cache(cache: &mut HashMap<String, CachedWorkspaceIndex>) {
    trim_cache_by_last_used(cache, SEARCH_INDEX_CACHE_LIMIT, |cached| cached.last_used);
}

fn trim_semantic_cache(cache: &mut HashMap<String, CachedSemanticIndex>) {
    trim_cache_by_last_used(cache, SEMANTIC_INDEX_CACHE_LIMIT, |cached| cached.last_used);
}

fn trim_embedding_provider_cache(cache: &mut HashMap<String, CachedEmbeddingProvider>) {
    trim_cache_by_last_used(cache, EMBEDDING_PROVIDER_CACHE_LIMIT, |cached| {
        cached.last_used
    });
}

fn trim_cache_by_last_used<T>(
    cache: &mut HashMap<String, T>,
    limit: usize,
    last_used: impl Fn(&T) -> Instant,
) {
    while cache.len() > limit {
        let Some(oldest_key) = cache
            .iter()
            .min_by_key(|(_, cached)| last_used(cached))
            .map(|(key, _)| key.clone())
        else {
            return;
        };
        cache.remove(&oldest_key);
    }
}

fn search_document(record: WorkspaceSearchRecord) -> Option<SearchDocument> {
    let source_kind = source_kind(record.kind);
    let target = match record.kind {
        WorkspaceSearchRecordKind::EntryTitle
        | WorkspaceSearchRecordKind::EntryField
        | WorkspaceSearchRecordKind::EntryTag => SearchTarget::Entry {
            entry_id: record.entry_id.clone(),
        },
        WorkspaceSearchRecordKind::NoteTitle | WorkspaceSearchRecordKind::NoteBody => {
            SearchTarget::Note {
                entry_id: record.entry_id.clone(),
                note_id: record.note_id.clone()?,
            }
        }
        WorkspaceSearchRecordKind::PdfPage => SearchTarget::Page {
            entry_id: record.entry_id.clone(),
            page_idx: record.page_idx?,
        },
        WorkspaceSearchRecordKind::Segment
        | WorkspaceSearchRecordKind::SegmentNote
        | WorkspaceSearchRecordKind::Annotation => SearchTarget::Segment {
            entry_id: record.entry_id.clone(),
            segment_uid: record.segment_uid.clone()?,
            page_idx: record.page_idx?,
        },
    };
    let label = source_label(&record);

    Some(neuink_search::compose_search_document(
        neuink_search::SearchDocumentInput {
            entry_id: record.entry_id,
            entry_title: record.entry_title,
            source: SearchDocumentSource {
                kind: source_kind,
                label,
                field_name: record.field_name,
                tag_id: record.tag_id,
                note_id: record.note_id,
                segment_uid: record.segment_uid,
                page_idx: record.page_idx,
                section_id: record.section_id,
                section_path: record.section_path,
                section_role: record.section_role,
                segment_type: record.segment_type,
            },
            target,
            title: record.title,
            body: record.text,
            caption: record.caption,
            translation: record.translation,
            boost: source_boost(record.kind),
        },
    ))
}

#[cfg(test)]
fn filter_segment_search_results(mut results: SearchResults, limit: usize) -> SearchResults {
    let mut hits = results
        .entries
        .into_iter()
        .flat_map(|entry| entry.hits)
        .filter(|hit| matches!(&hit.target, SearchTarget::Segment { .. }))
        .collect::<Vec<_>>();
    hits.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.entry_title.cmp(&right.entry_title))
            .then_with(|| left.title.cmp(&right.title))
    });
    hits.truncate(limit);

    let mut grouped = std::collections::BTreeMap::<String, SearchEntryGroup>::new();
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
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.entry_title.cmp(&right.entry_title))
    });
    results.entries = entries;
    results.total_hit_count = results.entries.iter().map(|entry| entry.hit_count).sum();
    results
}

fn source_kind(kind: WorkspaceSearchRecordKind) -> SearchDocumentSourceKind {
    match kind {
        WorkspaceSearchRecordKind::EntryTitle => SearchDocumentSourceKind::EntryTitle,
        WorkspaceSearchRecordKind::EntryField => SearchDocumentSourceKind::EntryField,
        WorkspaceSearchRecordKind::EntryTag => SearchDocumentSourceKind::EntryTag,
        WorkspaceSearchRecordKind::NoteTitle => SearchDocumentSourceKind::NoteTitle,
        WorkspaceSearchRecordKind::NoteBody => SearchDocumentSourceKind::NoteBody,
        WorkspaceSearchRecordKind::SegmentNote => SearchDocumentSourceKind::SegmentNote,
        WorkspaceSearchRecordKind::Annotation => SearchDocumentSourceKind::Annotation,
        WorkspaceSearchRecordKind::PdfPage => SearchDocumentSourceKind::PdfPage,
        WorkspaceSearchRecordKind::Segment => SearchDocumentSourceKind::Segment,
    }
}

fn source_boost(kind: WorkspaceSearchRecordKind) -> f32 {
    match kind {
        WorkspaceSearchRecordKind::EntryTitle => 3.0,
        WorkspaceSearchRecordKind::EntryTag => 2.4,
        WorkspaceSearchRecordKind::EntryField => 1.8,
        WorkspaceSearchRecordKind::NoteTitle => 1.8,
        WorkspaceSearchRecordKind::NoteBody => 1.1,
        WorkspaceSearchRecordKind::SegmentNote => 1.35,
        WorkspaceSearchRecordKind::Annotation => 1.45,
        WorkspaceSearchRecordKind::PdfPage => 1.15,
        WorkspaceSearchRecordKind::Segment => 1.0,
    }
}

fn source_label(record: &WorkspaceSearchRecord) -> String {
    match record.kind {
        WorkspaceSearchRecordKind::EntryTitle => "Entry".to_string(),
        WorkspaceSearchRecordKind::EntryField => record
            .field_name
            .as_ref()
            .map(|name| format!("Field · {name}"))
            .unwrap_or_else(|| "Field".to_string()),
        WorkspaceSearchRecordKind::EntryTag => record
            .tag_path
            .as_ref()
            .map(|path| format!("Tag · {path}"))
            .unwrap_or_else(|| "Tag".to_string()),
        WorkspaceSearchRecordKind::NoteTitle => "Note title".to_string(),
        WorkspaceSearchRecordKind::NoteBody => "Note".to_string(),
        WorkspaceSearchRecordKind::SegmentNote => record
            .page_idx
            .map(|page_idx| format!("Segment Note · Page {}", page_idx + 1))
            .unwrap_or_else(|| "Segment Note".to_string()),
        WorkspaceSearchRecordKind::Annotation => record
            .page_idx
            .map(|page_idx| format!("Annotation · Page {}", page_idx + 1))
            .unwrap_or_else(|| "Annotation".to_string()),
        WorkspaceSearchRecordKind::PdfPage => record
            .page_idx
            .map(|page_idx| format!("PDF Page · Page {}", page_idx + 1))
            .unwrap_or_else(|| "PDF Page".to_string()),
        WorkspaceSearchRecordKind::Segment => record
            .page_idx
            .map(|page_idx| match record.segment_type {
                Some(segment_type) => {
                    format!(
                        "PDF Segment · Page {} · {}",
                        page_idx + 1,
                        segment_type_label(segment_type)
                    )
                }
                None => format!("PDF Segment · Page {}", page_idx + 1),
            })
            .unwrap_or_else(|| "PDF Segment".to_string()),
    }
}

fn segment_type_label(segment_type: neuink_domain::SegmentType) -> &'static str {
    match segment_type {
        neuink_domain::SegmentType::Paragraph => "paragraph",
        neuink_domain::SegmentType::Heading => "heading",
        neuink_domain::SegmentType::Table => "table",
        neuink_domain::SegmentType::Math => "math",
        neuink_domain::SegmentType::Figure => "figure",
        neuink_domain::SegmentType::Code => "code",
        neuink_domain::SegmentType::List => "list",
        neuink_domain::SegmentType::PageHeader => "page_header",
        neuink_domain::SegmentType::PageFooter => "page_footer",
        neuink_domain::SegmentType::PageNumber => "page_number",
        neuink_domain::SegmentType::AsideText => "aside_text",
        neuink_domain::SegmentType::PageFootnote => "page_footnote",
    }
}

fn search_include_contains(include: &SearchInclude, kind: SearchDocumentSourceKind) -> bool {
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

fn semantic_index_state(
    semantic_document_count: usize,
    semantic_memory_cache_ready: bool,
    semantic_disk_cache_ready: bool,
) -> SemanticIndexState {
    if semantic_document_count == 0 {
        SemanticIndexState::Empty
    } else if semantic_memory_cache_ready {
        SemanticIndexState::ReadyMemory
    } else if semantic_disk_cache_ready {
        SemanticIndexState::ReadyDisk
    } else {
        SemanticIndexState::NeedsBuild
    }
}

fn search_index_status_message(
    semantic_document_count: usize,
    semantic_status: &SemanticIndexState,
) -> String {
    match semantic_status {
        SemanticIndexState::Empty => "暂无可向量化内容".to_string(),
        SemanticIndexState::ReadyMemory => {
            format!("向量已就绪 · {semantic_document_count}")
        }
        SemanticIndexState::ReadyDisk => format!("磁盘缓存 · {semantic_document_count}"),
        SemanticIndexState::NeedsBuild => {
            format!("待构建向量 · {semantic_document_count}")
        }
    }
}

fn workspace_cache_key(root: &PathBuf, options: &WorkspaceSearchOptions) -> String {
    format!(
        "{}|{}:{}:{}",
        root.display(),
        options.include_entry_meta,
        options.include_notes,
        options.include_segments
    )
}

fn semantic_cache_namespace(
    root: &PathBuf,
    options: &WorkspaceSearchOptions,
    include: &SearchInclude,
    identity: Option<&str>,
) -> String {
    let mut hasher = DefaultHasher::new();
    workspace_cache_key(root, options).hash(&mut hasher);
    include.entry_meta.hash(&mut hasher);
    include.notes.hash(&mut hasher);
    include.segments.hash(&mut hasher);
    identity.unwrap_or("unknown-model").hash(&mut hasher);
    neuink_search::EMBEDDING_REPRESENTATION_VERSION.hash(&mut hasher);
    format!("semantic-{:016x}", hasher.finish())
}

fn records_fingerprint(records: &[WorkspaceSearchRecord]) -> u64 {
    records_fingerprint_with_translation(records, true)
}

fn semantic_records_fingerprint(records: &[WorkspaceSearchRecord]) -> u64 {
    records_fingerprint_with_translation(records, false)
}

fn records_fingerprint_with_translation(
    records: &[WorkspaceSearchRecord],
    include_translation: bool,
) -> u64 {
    let mut hasher = DefaultHasher::new();
    records.len().hash(&mut hasher);
    let mut record_fingerprints = Vec::with_capacity(records.len());
    for record in records {
        let mut record_hasher = DefaultHasher::new();
        record.entry_id.hash(&mut record_hasher);
        record.entry_title.hash(&mut record_hasher);
        record.kind.hash(&mut record_hasher);
        record.title.hash(&mut record_hasher);
        record.text.hash(&mut record_hasher);
        record.field_name.hash(&mut record_hasher);
        record.tag_id.hash(&mut record_hasher);
        record.tag_path.hash(&mut record_hasher);
        record.note_id.hash(&mut record_hasher);
        record.segment_uid.hash(&mut record_hasher);
        record.page_idx.hash(&mut record_hasher);
        record.segment_type.hash(&mut record_hasher);
        record.section_id.hash(&mut record_hasher);
        record.section_path.hash(&mut record_hasher);
        record.section_role.hash(&mut record_hasher);
        record.caption.hash(&mut record_hasher);
        if include_translation {
            record.translation.hash(&mut record_hasher);
        }
        record_fingerprints.push(record_hasher.finish());
    }
    record_fingerprints.sort_unstable();
    for fingerprint in record_fingerprints {
        fingerprint.hash(&mut hasher);
    }
    hasher.finish()
}

#[cfg(test)]
use neuink_search::SearchEntryGroup;

#[cfg(test)]
mod tests {
    use std::{fs, sync::Arc, time::SystemTime};

    use super::{
        begin_search_build, filter_segment_search_results, load_search_build_status,
        lookup_semantic_memory, model_semantic_cache_key, parse_segment_types, records_fingerprint,
        run_single_query, search_build_status_path, search_document, search_scope_options,
        semantic_cache_namespace, update_search_build_progress, PreparedSearch,
        SearchIndexBuildState, SearchIndexBuildStatus, WorkspaceSearchRecord,
        WorkspaceSearchRecordKind,
    };
    use neuink_domain::{EntryId, SegmentType, SegmentUid};
    use neuink_search::{
        EmbeddingProvider, FastEmbedProvider, MemorySearchIndex, SearchDocumentSource, SearchDocumentSourceKind,
        SearchEntryGroup, SearchHit, SearchInclude, SearchIndex, SearchMode, SearchResults,
        SearchTarget,
    };
    use neuink_workspace::WorkspaceSearchOptions;

    #[test]
    fn segments_scope_matches_assistant_search_corpus() {
        // `search_segments` searches segments plus anchored notes; the manual
        // segments build must embed the same namespace or hybrid never finds it.
        let root = std::path::PathBuf::from("workspace");
        let assistant_options = WorkspaceSearchOptions {
            include_entry_meta: false,
            include_notes: true,
            include_segments: true,
        };
        let assistant_include = SearchInclude {
            entry_meta: false,
            notes: true,
            segments: true,
        };
        let (options, include) = search_scope_options(true);

        assert_eq!(include, assistant_include);
        assert_eq!(
            semantic_cache_namespace(&root, &options, &include, None),
            semantic_cache_namespace(&root, &assistant_options, &assistant_include, None)
        );
    }

    #[test]
    fn unknown_identity_has_no_memory_key_and_known_identities_stay_separate() {
        let root = std::path::PathBuf::from("workspace");
        let (options, include) = search_scope_options(false);

        assert_eq!(
            model_semantic_cache_key(&root, &options, &include, None),
            None,
            "unknown identity must never produce a reusable memory key"
        );
        let model_a = model_semantic_cache_key(&root, &options, &include, Some("model-a"));
        let model_b = model_semantic_cache_key(&root, &options, &include, Some("model-b"));
        assert!(model_a.is_some());
        assert_ne!(model_a, model_b);
        assert!(lookup_semantic_memory(None, 1).is_none());
    }

    #[test]
    fn segment_scope_filters_pages_and_unanchored_notes_after_candidate_expansion() {
        let entry_id = EntryId::from_string("entry-a");
        let segment_uid = neuink_domain::SegmentUid::from_string("segment-a");
        let hit = |target, kind| SearchHit {
            entry_id: entry_id.clone(),
            entry_title: "Paper".to_string(),
            source: SearchDocumentSource {
                kind,
                ..Default::default()
            },
            target,
            title: "hit".to_string(),
            snippet: "body".to_string(),
            score: 1.0,
            matched_terms: Vec::new(),
            surrounding_context: None,
        };
        let results = SearchResults {
            query: "q".to_string(),
            mode: "keyword".to_string(),
            index_generation: 1,
            total_hit_count: 3,
            entries: vec![SearchEntryGroup {
                entry_id: entry_id.clone(),
                entry_title: "Paper".to_string(),
                hit_count: 3,
                max_score: 1.0,
                hits: vec![
                    hit(
                        SearchTarget::Page {
                            entry_id: entry_id.clone(),
                            page_idx: 0,
                        },
                        SearchDocumentSourceKind::PdfPage,
                    ),
                    hit(
                        SearchTarget::Note {
                            entry_id: entry_id.clone(),
                            note_id: neuink_domain::NoteId::from_string("note-a"),
                        },
                        SearchDocumentSourceKind::NoteBody,
                    ),
                    hit(
                        SearchTarget::Segment {
                            entry_id: entry_id.clone(),
                            segment_uid,
                            page_idx: 0,
                        },
                        SearchDocumentSourceKind::Segment,
                    ),
                ],
            }],
            warnings: Vec::new(),
            rerank_used: None,
        };

        let filtered = filter_segment_search_results(results, 1);

        assert_eq!(filtered.total_hit_count, 1);
        assert!(matches!(
            filtered.entries[0].hits[0].target,
            SearchTarget::Segment { .. }
        ));
    }

    #[test]
    fn records_fingerprint_is_independent_of_directory_iteration_order() {
        let first = record("entry-a", "Alpha");
        let second = record("entry-b", "Beta");
        assert_eq!(
            records_fingerprint(&[first.clone(), second.clone()]),
            records_fingerprint(&[second, first])
        );
    }

    #[test]
    fn records_fingerprint_changes_when_searchable_content_changes() {
        let first = record("entry-a", "Alpha");
        let mut changed = first.clone();
        changed.text = "Changed".to_string();
        assert_ne!(
            records_fingerprint(&[first]),
            records_fingerprint(&[changed])
        );
    }

    #[test]
    fn disk_status_ready_only_for_exact_model_identity() {
        let status = super::SemanticDiskCacheStatus {
            version: super::SEMANTIC_INDEX_FORMAT_VERSION,
            fingerprint: 9,
            representation_version: neuink_search::EMBEDDING_REPRESENTATION_VERSION,
            embedding_identity: Some("model-a".to_string()),
            record_count: 1,
        };
        assert!(status.current_for(9, Some("model-a")));
        assert!(!status.current_for(9, Some("model-b")));
        assert!(!status.current_for(9, None));
        assert!(!status.current_for(8, Some("model-a")));

        let identityless = super::SemanticDiskCacheStatus {
            embedding_identity: None,
            ..status
        };
        assert!(!identityless.current_for(9, None));
        assert!(!identityless.current_for(9, Some("model-a")));
    }

    #[test]
    fn legacy_semantic_cache_is_rebuilt_only_when_provider_and_version_require_it() {
        let legacy = super::SemanticDiskCacheStatus {
            version: super::SEMANTIC_INDEX_FORMAT_VERSION - 1,
            fingerprint: 1,
            representation_version: 0,
            embedding_identity: None,
            record_count: 2,
        };
        let current = super::SemanticDiskCacheStatus {
            version: super::SEMANTIC_INDEX_FORMAT_VERSION,
            fingerprint: 1,
            representation_version: neuink_search::EMBEDDING_REPRESENTATION_VERSION,
            embedding_identity: Some("model-a".to_string()),
            record_count: 2,
        };

        assert!(super::should_schedule_legacy_semantic_rebuild(
            Some(&legacy),
            true
        ));
        assert!(!super::should_schedule_legacy_semantic_rebuild(
            Some(&legacy),
            false
        ));
        assert!(!super::should_schedule_legacy_semantic_rebuild(
            Some(&current),
            true
        ));
        let stale_rep = super::SemanticDiskCacheStatus {
            representation_version: neuink_search::EMBEDDING_REPRESENTATION_VERSION.saturating_sub(1),
            ..current
        };
        assert!(super::should_schedule_legacy_semantic_rebuild(
            Some(&stale_rep),
            true
        ));
        assert!(!super::should_schedule_legacy_semantic_rebuild(None, true));
    }

    #[test]
    fn search_build_progress_is_persisted_outside_the_ui() {
        let root = std::env::temp_dir().join(format!(
            "neuink-search-build-status-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("test root");

        begin_search_build(&root, "queued");
        update_search_build_progress(&root, "global", "embedding", 4, 10, "building".to_string());
        let status = load_search_build_status(&root).expect("persisted status");

        assert!(matches!(status.state, SearchIndexBuildState::Running));
        assert_eq!(status.completed, 4);
        assert_eq!(status.total, 10);
        assert!(search_build_status_path(&root).is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persisted_in_progress_build_is_recovered_as_manual_idle_state() {
        for (suffix, state) in [
            ("queued", SearchIndexBuildState::Queued),
            ("running", SearchIndexBuildState::Running),
        ] {
            let root = std::env::temp_dir().join(format!(
                "neuink-search-interrupted-status-{suffix}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .expect("clock")
                    .as_nanos()
            ));
            let path = search_build_status_path(&root);
            fs::create_dir_all(path.parent().expect("status parent")).expect("status directory");
            let persisted = SearchIndexBuildStatus {
                root: root.display().to_string(),
                state,
                scope: "global".to_string(),
                phase: "embedding".to_string(),
                completed: 4,
                total: 10,
                message: "building".to_string(),
                error: None,
                started_at_ms: 1,
                updated_at_ms: 2,
            };
            fs::write(
                &path,
                serde_json::to_vec_pretty(&persisted).expect("serialize persisted status"),
            )
            .expect("write persisted status");

            let recovered = load_search_build_status(&root).expect("recover interrupted status");
            assert!(matches!(recovered.state, SearchIndexBuildState::Idle));
            assert_eq!(recovered.completed, 0);
            assert_eq!(recovered.total, 0);
            assert_eq!(
                recovered.message,
                "上次向量索引构建已中断；等待用户手动构建"
            );

            let stored = serde_json::from_slice::<SearchIndexBuildStatus>(
                &fs::read(&path).expect("read recovered status"),
            )
            .expect("deserialize recovered status");
            assert!(matches!(stored.state, SearchIndexBuildState::Idle));
            let _ = fs::remove_dir_all(root);
        }
    }

    fn batch_task(task_id: &str, query: &str, mode: super::SearchMode) -> super::SearchSegmentTask {
        super::SearchSegmentTask {
            task_id: task_id.to_string(),
            query: query.to_string(),
            english_query: None,
            sub_queries: Vec::new(),
            section_filter: None,
            segment_types: Vec::new(),
            scope_entry_ids: Vec::new(),
            mode,
            top_k: None,
        }
    }

    fn empty_results(query: &str) -> SearchResults {
        SearchResults {
            query: query.to_string(),
            mode: "keyword".to_string(),
            index_generation: 0,
            total_hit_count: 0,
            entries: Vec::new(),
            warnings: Vec::new(),
            rerank_used: None,
        }
    }

    #[test]
    fn segments_batch_without_valid_queries_never_prepares_resources() {
        let prepare_calls = std::cell::Cell::new(0);
        let items = super::collect_segments_batch(
            vec![
                batch_task("t1", "   ", SearchMode::Hybrid),
                batch_task("t2", "", SearchMode::Keyword),
            ],
            |_| {
                prepare_calls.set(prepare_calls.get() + 1);
                Ok(())
            },
            |_: &(), _| Ok(empty_results("unused")),
        )
        .expect("blank-only batch returns per-task errors");
        assert_eq!(prepare_calls.get(), 0);
        assert_eq!(items.len(), 2);
        assert!(items.iter().all(|item| item.results.is_none()
            && item
                .error
                .as_ref()
                .is_some_and(|error| error.code == "invalid_query")));
        assert_eq!(items[0].task_id, "t1");
        assert_eq!(items[1].task_id, "t2");
    }

    #[test]
    fn segments_batch_prepares_once_and_isolates_bad_tasks_in_order() {
        let prepare_calls = std::cell::Cell::new(0);
        let items = super::collect_segments_batch(
            vec![
                batch_task("first", "alpha", SearchMode::Hybrid),
                batch_task("blank", "  ", SearchMode::Hybrid),
                batch_task("broken", "broken", SearchMode::Hybrid),
                batch_task("last", "gamma", SearchMode::Hybrid),
            ],
            |needs_semantic| {
                prepare_calls.set(prepare_calls.get() + 1);
                assert!(needs_semantic);
                Ok(())
            },
            |_: &(), task| {
                if task.query == "broken" {
                    Err("index detail that must not leak".to_string())
                } else {
                    Ok(empty_results(&task.query))
                }
            },
        )
        .expect("per-task failures do not fail the batch");
        assert_eq!(prepare_calls.get(), 1);
        let ids: Vec<&str> = items.iter().map(|item| item.task_id.as_str()).collect();
        assert_eq!(ids, ["first", "blank", "broken", "last"]);
        assert_eq!(
            items[0].results.as_ref().map(|r| r.query.as_str()),
            Some("alpha")
        );
        assert_eq!(
            items[1].error.as_ref().map(|e| e.code),
            Some("invalid_query")
        );
        assert_eq!(
            items[2].error.as_ref().map(|e| e.code),
            Some("search_failed")
        );
        assert_eq!(
            items[2].error.as_ref().map(|e| e.message),
            Some("search task failed")
        );
        assert_eq!(
            items[3].results.as_ref().map(|r| r.query.as_str()),
            Some("gamma")
        );
    }

    #[test]
    fn segments_batch_requests_semantic_preparation_only_for_non_keyword_tasks() {
        let needs = std::cell::Cell::new(None);
        super::collect_segments_batch(
            vec![batch_task("k", "alpha", SearchMode::Keyword)],
            |needs_semantic| {
                needs.set(Some(needs_semantic));
                Ok(())
            },
            |_: &(), task| Ok(empty_results(&task.query)),
        )
        .expect("keyword batch succeeds");
        assert_eq!(needs.get(), Some(false));
    }

    #[test]
    fn segments_batch_preparation_failure_fails_the_whole_batch() {
        let error = super::collect_segments_batch(
            vec![batch_task("t1", "alpha", SearchMode::Hybrid)],
            |_| Err::<(), _>("workspace unavailable".to_string()),
            |_: &(), task| Ok(empty_results(&task.query)),
        )
        .expect_err("index preparation failure aborts the batch");
        assert_eq!(error, "workspace unavailable");
    }

    fn parity_segment(
        entry_id: &str,
        segment_uid: &str,
        page_idx: u32,
        segment_type: SegmentType,
        section_path: &str,
        text: &str,
    ) -> WorkspaceSearchRecord {
        WorkspaceSearchRecord {
            entry_id: EntryId::from_string(entry_id.to_string()),
            entry_title: entry_id.to_string(),
            kind: WorkspaceSearchRecordKind::Segment,
            // The segment uid doubles as the title so each hit can be identified by its title.
            title: segment_uid.to_string(),
            text: text.to_string(),
            field_name: None,
            tag_id: None,
            tag_path: None,
            note_id: None,
            segment_uid: Some(SegmentUid::from_string(segment_uid.to_string())),
            page_idx: Some(page_idx),
            segment_type: Some(segment_type),
            section_id: None,
            section_path: Some(section_path.to_string()),
            section_role: None,
            caption: None,
            translation: None,
        }
    }

    /// Keyword-only segment fixture. The embedding model directory does not exist and no
    /// semantic index is attached, so hybrid tasks take the keyword fallback path.
    fn parity_prepared() -> PreparedSearch {
        let records = vec![
            parity_segment(
                "paper-a",
                "a-intro",
                0,
                SegmentType::Paragraph,
                "Introduction",
                "contrastive pretraining improves recall on the benchmark corpus",
            ),
            parity_segment(
                "paper-a",
                "a-table",
                3,
                SegmentType::Table,
                "Results > Table 2",
                "benchmark recall table reports contrastive results",
            ),
            parity_segment(
                "paper-b",
                "b-method",
                1,
                SegmentType::Paragraph,
                "Methods > Dataset",
                "contrastive pretraining reduces latency on the benchmark corpus",
            ),
            parity_segment(
                "paper-b",
                "b-results",
                2,
                SegmentType::Paragraph,
                "Results > Ablation",
                "ablation shows latency gains for the retrieval encoder",
            ),
        ];
        let index = Arc::new(MemorySearchIndex::default());
        index
            .replace_documents(records.into_iter().filter_map(search_document).collect())
            .expect("index segment fixtures");
        let (_, include) = search_scope_options(true);
        let model_dir = std::env::temp_dir().join(format!(
            "neuink-search-parity-missing-model-{}",
            std::process::id()
        ));
        PreparedSearch {
            include,
            keyword: index,
            provider: Arc::new(FastEmbedProvider::from_model_dir(model_dir))
                as Arc<dyn EmbeddingProvider>,
            semantic: None,
            // Fixtures below use two entries, so the head's scope size is 2.
            document_count: 2,
            entries: vec!["entry-a".to_string(), "entry-b".to_string()],
            surrounding_contexts: Arc::new(neuink_search::SegmentContextMap::default()),
            visual_page_segments: Arc::new(neuink_search::VisualPageSegments::default()),
            query_vectors: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }

    fn parity_tasks() -> Vec<super::SearchSegmentTask> {
        let mut english = batch_task("english", "benchmark", SearchMode::Keyword);
        english.english_query = Some("contrastive pretraining".to_string());
        english.sub_queries = vec!["latency".to_string()];
        let mut scoped = batch_task("scoped", "contrastive", SearchMode::Keyword);
        scoped.scope_entry_ids = vec![EntryId::from_string("paper-b".to_string())];
        let mut section = batch_task("section", "benchmark", SearchMode::Keyword);
        section.section_filter = Some("Results".to_string());
        let mut table = batch_task("table", "benchmark", SearchMode::Keyword);
        table.segment_types = vec!["table".to_string()];
        vec![
            batch_task("keyword", "contrastive", SearchMode::Keyword),
            batch_task("hybrid", "benchmark recall", SearchMode::Hybrid),
            english,
            scoped,
            section,
            table,
            batch_task("blank", "   ", SearchMode::Hybrid),
        ]
    }

    /// Mirrors the per-task mapping in `run_segments_batch` so the direct and batched paths
    /// share one set of query arguments.
    fn run_parity_task(
        prepared: &PreparedSearch,
        task: super::SearchSegmentTask,
    ) -> Result<SearchResults, String> {
        run_single_query(
            prepared,
            &task.query,
            task.english_query.as_deref(),
            &task.sub_queries,
            task.scope_entry_ids,
            task.mode,
            task.top_k.unwrap_or(20).clamp(1, 20),
            true,
            task.section_filter,
            parse_segment_types(&task.segment_types),
        )
    }

    fn hit_titles(results: &SearchResults) -> Vec<String> {
        results
            .entries
            .iter()
            .flat_map(|group| group.hits.iter().map(|hit| hit.title.clone()))
            .collect()
    }

    fn hit_entry_ids(results: &SearchResults) -> Vec<String> {
        results
            .entries
            .iter()
            .flat_map(|group| {
                group
                    .hits
                    .iter()
                    .map(|hit| hit.entry_id.as_str().to_string())
            })
            .collect()
    }

    /// Hits are ranked inside each entry group; the groups themselves are not flattened into one ranking.
    fn assert_hits_ranked_within_entries(results: &SearchResults) {
        for group in &results.entries {
            let scores: Vec<f32> = group.hits.iter().map(|hit| hit.score).collect();
            assert!(
                scores.windows(2).all(|pair| pair[0] >= pair[1]),
                "scores out of order in {}: {scores:?}",
                group.entry_id.as_str()
            );
        }
    }

    #[test]
    fn segments_batch_matches_direct_queries_on_the_same_prepared_index() {
        let prepared = parity_prepared();
        let direct: Vec<(String, serde_json::Value)> = parity_tasks()
            .into_iter()
            .filter(|task| !task.query.trim().is_empty())
            .map(|task| {
                let task_id = task.task_id.clone();
                let results = run_parity_task(&prepared, task).expect("direct query succeeds");
                (
                    task_id,
                    serde_json::to_value(results).expect("serialize direct results"),
                )
            })
            .collect();
        let items = super::collect_segments_batch(
            parity_tasks(),
            move |_| Ok(prepared),
            |prepared, task| run_parity_task(prepared, task),
        )
        .expect("prepared batch runs");

        let ids: Vec<&str> = items.iter().map(|item| item.task_id.as_str()).collect();
        assert_eq!(
            ids,
            ["keyword", "hybrid", "english", "scoped", "section", "table", "blank"]
        );
        let blank = items.last().expect("blank task item");
        assert!(blank.results.is_none());
        assert_eq!(
            blank.error.as_ref().map(|error| error.code),
            Some("invalid_query")
        );
        let batched: Vec<(String, serde_json::Value)> = items
            .iter()
            .filter_map(|item| {
                item.results.as_ref().map(|results| {
                    (
                        item.task_id.clone(),
                        serde_json::to_value(results).expect("serialize batch results"),
                    )
                })
            })
            .collect();
        assert_eq!(batched, direct);
    }

    #[test]
    fn segments_batch_results_hold_expected_hits_modes_and_warnings() {
        let prepared = parity_prepared();
        let items = super::collect_segments_batch(
            parity_tasks(),
            move |_| Ok(prepared),
            |prepared, task| run_parity_task(prepared, task),
        )
        .expect("prepared batch runs");
        let result = |task_id: &str| {
            items
                .iter()
                .find(|item| item.task_id == task_id)
                .and_then(|item| item.results.as_ref())
                .unwrap_or_else(|| panic!("task {task_id} has results"))
        };

        let keyword = result("keyword");
        assert_eq!(keyword.mode, "keyword");
        assert!(keyword.warnings.is_empty());
        assert!(!hit_titles(keyword).is_empty());
        assert!(hit_titles(keyword)
            .iter()
            .all(|title| ["a-intro", "a-table", "b-method"].contains(&title.as_str())));
        assert_hits_ranked_within_entries(keyword);

        let hybrid = result("hybrid");
        assert_eq!(hybrid.mode, "hybrid_fallback_keyword");
        assert!(!hybrid.warnings.is_empty());
        assert!(!hit_titles(hybrid).is_empty());

        let english = result("english");
        assert!(hit_titles(english).iter().any(|title| title == "b-method"));
        assert!(hit_titles(english).iter().any(|title| title == "b-results"));

        let scoped = result("scoped");
        assert!(!hit_titles(scoped).is_empty());
        assert!(hit_entry_ids(scoped).iter().all(|entry| entry == "paper-b"));

        assert_eq!(hit_titles(result("section")), ["a-table"]);
        assert_eq!(hit_titles(result("table")), ["a-table"]);
    }

    fn record(entry_id: &str, text: &str) -> WorkspaceSearchRecord {
        WorkspaceSearchRecord {
            entry_id: EntryId::from_string(entry_id.to_string()),
            entry_title: text.to_string(),
            kind: WorkspaceSearchRecordKind::EntryTitle,
            title: text.to_string(),
            text: text.to_string(),
            field_name: None,
            tag_id: None,
            tag_path: None,
            note_id: None,
            segment_uid: None,
            page_idx: None,
            segment_type: None,
            section_id: None,
            section_path: None,
            section_role: None,
            caption: None,
            translation: None,
        }
    }
}

#[derive(Debug, Deserialize)]
struct SemanticDiskCacheSnapshot {
    version: u32,
    fingerprint: u64,
    #[serde(default)]
    representation_version: u32,
    #[serde(default)]
    embedding_identity: Option<String>,
    records: Vec<IgnoredAny>,
}

#[derive(Debug)]
struct SemanticDiskCacheStatus {
    version: u32,
    fingerprint: u64,
    representation_version: u32,
    embedding_identity: Option<String>,
    record_count: usize,
}

impl SemanticDiskCacheStatus {
    /// A snapshot is ready only for the exact model identity. An unknown identity
    /// (`None`) never matches, so an identity-less snapshot cannot report Ready.
    fn current_for(&self, fingerprint: u64, identity: Option<&str>) -> bool {
        self.version == SEMANTIC_INDEX_FORMAT_VERSION
            && self.representation_version == neuink_search::EMBEDDING_REPRESENTATION_VERSION
            && self.fingerprint == fingerprint
            && identity.is_some()
            && self.embedding_identity.as_deref() == identity
    }
}

fn read_semantic_disk_cache_status(path: &PathBuf) -> Option<SemanticDiskCacheStatus> {
    let bytes = fs::read(path).ok()?;
    let snapshot = serde_json::from_slice::<SemanticDiskCacheSnapshot>(&bytes).ok()?;
    Some(SemanticDiskCacheStatus {
        version: snapshot.version,
        fingerprint: snapshot.fingerprint,
        representation_version: snapshot.representation_version,
        embedding_identity: snapshot.embedding_identity,
        record_count: snapshot.records.len(),
    })
}

/// Which visual encoder is configured. The Qwen service is the only encoder this build
/// runs; a stored retired value is reported so the settings screen can explain it.
#[derive(Debug, serde::Serialize)]
pub struct VisualEmbeddingSettingsState {
    pub provider: &'static str,
    /// Whether a key is stored; the key itself is never returned.
    pub has_api_key: bool,
    pub endpoint: Option<String>,
    pub timeout_ms: u64,
    /// Dual-channel parameters, so a settings screen can read what the pipeline uses.
    pub fusion: neuink_config::VisualFusionSettings,
    /// `on_demand` or `manual`; the local service starts itself when the policy allows.
    pub startup: &'static str,
}

impl VisualEmbeddingSettingsState {
    fn from_settings(settings: &neuink_config::VisualEmbeddingSettings) -> Self {
        Self {
            provider: settings.provider.as_str(),
            has_api_key: settings
                .api_key
                .as_deref()
                .is_some_and(|key| !key.trim().is_empty()),
            endpoint: settings.endpoint.clone(),
            timeout_ms: settings.timeout_ms,
            fusion: settings.fusion,
            startup: settings.startup.as_str(),
        }
    }
}

#[tauri::command]
pub fn get_visual_embedding_settings<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<VisualEmbeddingSettingsState, String> {
    let settings = crate::storage::read_settings(&app)?.visual;
    Ok(VisualEmbeddingSettingsState::from_settings(&settings))
}

/// Validates before writing, so a configuration that cannot run is rejected at save time
/// instead of silently disabling the channel later. The key is write-only: omitting it
/// keeps the stored one, an empty string clears it.
#[tauri::command]
pub fn save_visual_embedding_settings<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    settings: neuink_config::VisualEmbeddingSettings,
) -> Result<VisualEmbeddingSettingsState, String> {
    let mut saved = crate::storage::read_settings(&app)?;
    let mut merged = settings;
    match merged.api_key.as_deref() {
        None => merged.api_key = saved.visual.api_key.clone(),
        Some("") => merged.api_key = None,
        Some(_) => {}
    }
    merged.validate()?;
    saved.visual = merged;
    crate::storage::write_settings(&app, &saved)?;
    visual::invalidate_provider_cache();
    Ok(VisualEmbeddingSettingsState::from_settings(&saved.visual))
}

/// Composed retrieval in one call: document routing, named-carrier binding, the visual
/// sidecar vote (ready only when its snapshot matches the current model), and evidence
/// inside the routed documents. Separate from the batch path so a batch keeps its
/// existing request and result shape.
#[tauri::command]
pub async fn search_unified<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: UnifiedSearchRequest,
) -> Result<UnifiedSearchResponse, String> {
    let provider = text_provider_for_app(&app)?;
    let saved = crate::storage::read_settings(&app)?;
    let settings = saved.visual;
    let fusion = settings.fusion;
    // Constructing the provider probes the service over blocking HTTP; it must not run on
    // the async worker or reqwest drops its runtime inside an async context and panics.
    let visual_settings = settings.clone();
    let multivector = saved.retrieval.multivector;
    let (rerank_settings, rerank_provider, scope_judge, listwise) = resolve_rerank(&app)?;
    tokio::task::spawn_blocking(move || {
        let visual_provider = if visual::has_visual_snapshot(&request.root) {
            visual::provider_for_query(&visual_settings)
        } else {
            visual::index_missing_provider()
        };
        unified::run_unified_search(
            provider,
            visual_provider,
            fusion,
            rerank_settings,
            rerank_provider,
            scope_judge,
            listwise,
            multivector,
            request,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Reports whether a visual snapshot already exists, without loading the vision model.
#[tauri::command]
pub fn get_visual_index_status(
    request: visual::GetVisualIndexStatusRequest,
) -> Result<visual::VisualIndexStatusResponse, String> {
    visual::visual_index_status(&request.root)
}
/// Encodes every stored MinerU asset once and writes the visual snapshot. This is the
/// only path that spends image-encoder work; queries only reread the snapshot.
#[tauri::command]
pub async fn prepare_visual_search_index<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: PrepareVisualSearchIndexRequest,
) -> Result<PrepareVisualSearchIndexResponse, String> {
    let settings = crate::storage::read_settings(&app)?.visual;
    settings.validate()?;
    let background = app.clone();
    tokio::task::spawn_blocking(move || {
        // Bring the local service up first: a provider built before the service is listening
        // reports "unreachable" and the preparation would fail on its first click.
        let _ = ensure_visual_service(&background);
        // Provider construction and the health probe both use blocking HTTP, so they belong
        // on this worker thread: doing it on an async worker panics reqwest's runtime drop.
        let provider = visual::provider_for(&settings);
        visual::prepare_visual_index(provider, request)
    })
    .await
    .map_err(|error| error.to_string())?
}


#[cfg(test)]
mod visual_service_tests;

/// Which rerank rung is configured, with the model directory it would load.
#[derive(Debug, serde::Serialize)]
pub struct RerankSettingsState {
    /// `local` (ONNX in-process) or `api` (hosted rerank endpoint).
    pub transport: &'static str,
    pub api_style: &'static str,
    pub api_endpoint: Option<String>,
    pub api_model: Option<String>,
    /// Whether a token is stored; the token itself is never returned.
    pub has_api_key: bool,
    pub mode: &'static str,
    pub model_dir: Option<String>,
    pub max_candidates: usize,
    pub fallback_heuristic: bool,
    /// Whether a model is actually present at the resolved directory. A settings screen
    /// needs this to tell "configured but not installed" from "working".
    pub model_present: bool,
    pub scope_refine: ScopeRefineState,
    pub api_instruction: Option<String>,
    pub fuse_with_pool: bool,
    pub structured_input: bool,
    pub structural_soft_demotion: bool,
    pub listwise: ListwiseRefineState,
}

/// Tail-refine settings the screen may show. The bearer token stays on disk.
#[derive(Debug, serde::Serialize)]
pub struct ScopeRefineState {
    pub enabled: bool,
    pub use_assistant_llm: bool,
    pub api_endpoint: Option<String>,
    pub api_model: Option<String>,
    pub has_api_key: bool,
    pub timeout_ms: u64,
    pub max_concurrency: usize,
}

#[derive(Debug, serde::Serialize)]
pub struct ListwiseRefineState {
    pub enabled: bool,
    pub use_assistant_llm: bool,
    pub api_endpoint: Option<String>,
    pub api_model: Option<String>,
    pub has_api_key: bool,
    pub top_n: usize,
    pub fuse_rrf: bool,
    pub single_paper_mode: bool,
    pub timeout_ms: u64,
}

impl RerankSettingsState {
    fn from_settings(settings: &neuink_config::RerankSettings, model_present: bool) -> Self {
        Self {
            mode: settings.mode.as_str(),
            model_dir: settings.model_dir.clone(),
            max_candidates: settings.max_candidates,
            fallback_heuristic: settings.fallback_heuristic,
            model_present,
            transport: settings.transport.as_str(),
            api_style: settings.api_style.as_str(),
            api_endpoint: settings.api_endpoint.clone(),
            api_model: settings.api_model.clone(),
            has_api_key: settings
                .api_key
                .as_deref()
                .is_some_and(|key| !key.trim().is_empty()),
            scope_refine: ScopeRefineState::from_settings(&settings.scope_refine),
            api_instruction: settings.api_instruction.clone(),
            fuse_with_pool: settings.fuse_with_pool,
            structured_input: settings.structured_input,
            structural_soft_demotion: settings.structural_soft_demotion,
            listwise: ListwiseRefineState::from_settings(&settings.listwise),
        }
    }
}

impl ListwiseRefineState {
    fn from_settings(settings: &neuink_config::ListwiseRefineSettings) -> Self {
        Self {
            enabled: settings.enabled,
            use_assistant_llm: settings.use_assistant_llm,
            api_endpoint: settings.api_endpoint.clone(),
            api_model: settings.api_model.clone(),
            has_api_key: settings
                .api_key
                .as_deref()
                .is_some_and(|key| !key.trim().is_empty()),
            top_n: settings.top_n,
            fuse_rrf: settings.fuse_rrf,
            single_paper_mode: settings.single_paper_mode,
            timeout_ms: settings.timeout_ms,
        }
    }
}

impl ScopeRefineState {
    fn from_settings(settings: &neuink_config::ScopeRefineSettings) -> Self {
        Self {
            enabled: settings.enabled,
            use_assistant_llm: settings.use_assistant_llm,
            api_endpoint: settings.api_endpoint.clone(),
            api_model: settings.api_model.clone(),
            has_api_key: settings
                .api_key
                .as_deref()
                .is_some_and(|key| !key.trim().is_empty()),
            timeout_ms: settings.timeout_ms,
            max_concurrency: settings.max_concurrency,
        }
    }
}

#[tauri::command]
pub fn get_rerank_settings<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<RerankSettingsState, String> {
    let settings = crate::storage::read_settings(&app)?.rerank;
    let resolved = settings
        .model_dir
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or(rerank_model_dir(&app)?);
    let model_present = rerank_stage::reranker_model_present(&resolved);
    Ok(RerankSettingsState::from_settings(&settings, model_present))
}

/// One reranker directory that can be used as-is.
#[derive(Debug, serde::Serialize)]
pub struct InstalledRerankModel {
    pub id: String,
    pub path: String,
    pub label: String,
}

/// A directory is a reranker when its ONNX file loads and it carries a tokenizer; the name
/// and config architecture are used to keep text-embedding directories out of the list.
fn looks_like_reranker(dir: &PathBuf, id: &str) -> bool {
    if !rerank_stage::reranker_model_present(dir) || !dir.join("tokenizer.json").is_file() {
        return false;
    }
    if id.to_ascii_lowercase().contains("rerank") {
        return true;
    }
    let config = std::fs::read_to_string(dir.join("config.json")).unwrap_or_default();
    let config = config.to_ascii_lowercase();
    config.contains("forsequenceclassification") || config.contains("reranker")
}

/// Lists reranker directories the user can pick, so a completed download never needs a
/// hand-typed path. Scans the same roots the model loader resolves plus the configured one.
#[tauri::command]
pub fn list_installed_rerank_models<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<InstalledRerankModel>, String> {
    use std::collections::BTreeSet;
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir.join("embedding-models"));
    }
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
    {
        roots.push(exe_dir.join("embedding-models"));
    }
    roots.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src-tauri/resources/embedding-models"),
    );
    let settings = crate::storage::read_settings(&app)?.rerank;

    let mut entries: Vec<InstalledRerankModel> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    for root in roots {
        let Ok(dirs) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in dirs.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let id = dir
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string();
            if !seen.insert(dir.to_string_lossy().to_string()) || !looks_like_reranker(&dir, &id) {
                continue;
            }
            let label = crate::commands::search::recommended_rerank_models::RECOMMENDED_RERANK
                .iter()
                .find(|model| model.id == id)
                .map(|model| model.display_name.to_string())
                .unwrap_or_else(|| id.clone());
            entries.push(InstalledRerankModel {
                id,
                path: dir.to_string_lossy().to_string(),
                label,
            });
        }
    }
    // A configured directory outside the resource roots still belongs in the picker.
    if let Some(dir) = settings.model_dir.as_deref().map(PathBuf::from) {
        let path = dir.to_string_lossy().to_string();
        if seen.insert(path.clone()) && looks_like_reranker(&dir, "custom") {
            entries.push(InstalledRerankModel {
                id: "custom".to_string(),
                path,
                label: "自定义目录".to_string(),
            });
        }
    }
    entries.sort_by(|left, right| left.label.cmp(&right.label));
    Ok(entries)
}
#[tauri::command]
pub fn save_rerank_settings<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    settings: neuink_config::RerankSettings,
) -> Result<RerankSettingsState, String> {
    // A None key means "keep the stored one": the screen never receives the token, so it
    // cannot send it back unchanged.
    let mut settings = settings;
    if let Ok(saved) = crate::storage::read_settings(&app) {
        if settings.api_key.is_none() {
            settings.api_key = saved.rerank.api_key;
        }
        // A blank scope key means keep. The screen never receives the stored token.
        if settings
            .scope_refine
            .api_key
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
        {
            settings.scope_refine.api_key = saved.rerank.scope_refine.api_key;
        }
        if settings
            .listwise
            .api_key
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
        {
            settings.listwise.api_key = saved.rerank.listwise.api_key;
        }
    }
    settings.validate()?;
    let mut saved = crate::storage::read_settings(&app)?;
    saved.rerank = settings;
    crate::storage::write_settings(&app, &saved)?;
    let resolved = saved
        .rerank
        .model_dir
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or(rerank_model_dir(&app)?);
    let model_present = rerank_stage::reranker_model_present(&resolved);
    Ok(RerankSettingsState::from_settings(&saved.rerank, model_present))
}


/// Whether the assistant uses the composed retrieval path. Read by the app shell, not by
/// the search commands: the commands always support both paths.
#[derive(Debug, serde::Serialize)]
pub struct RetrievalSettingsState {
    pub unified: bool,
    pub multivector: neuink_config::MultivectorPoolSettings,
}

#[tauri::command]
pub fn get_retrieval_settings<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<RetrievalSettingsState, String> {
    let settings = crate::storage::read_settings(&app)?.retrieval;
    Ok(RetrievalSettingsState {
        unified: settings.unified,
        multivector: settings.multivector,
    })
}

#[tauri::command]
pub fn save_retrieval_settings<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    settings: neuink_config::RetrievalSettings,
) -> Result<RetrievalSettingsState, String> {
    settings.validate()?;
    let mut saved = crate::storage::read_settings(&app)?;
    saved.retrieval = settings;
    crate::storage::write_settings(&app, &saved)?;
    Ok(RetrievalSettingsState {
        unified: saved.retrieval.unified,
        multivector: saved.retrieval.multivector,
    })
}



/// What the text model settings screen shows: the configured transport, the resolved model
/// facts, and (for the local transport) the directory that would actually be loaded.
#[derive(Debug, serde::Serialize)]
pub struct TextModelSettingsState {
    pub provider: String,
    pub model_dir: Option<String>,
    pub endpoint: Option<String>,
    pub has_api_key: bool,
    pub model: Option<String>,
    pub dimensions: Option<usize>,
    pub timeout_ms: u64,
    pub resolved_dir: String,
    pub loaded_model_name: Option<String>,
    pub loaded_dimensions: Option<usize>,
    pub available: bool,
    pub message: Option<String>,
    pub colbert_head_present: bool,
    pub sparse_head_present: bool,
}

/// Result of a live probe, used by the settings screen's "测试连接" button.
#[derive(Debug, serde::Serialize)]
pub struct TextEmbeddingProbeState {
    pub provider: String,
    pub model_name: Option<String>,
    pub dimensions: usize,
    pub latency_ms: u64,
}

impl TextModelSettingsState {
    fn from_settings<R: tauri::Runtime>(
        app: &tauri::AppHandle<R>,
        settings: &neuink_config::TextModelSettings,
    ) -> Result<Self, String> {
        let local_dir = if settings.provider == neuink_config::TextEmbeddingProviderKind::LocalOnnx {
            embedding_model_dir(app)?
        } else {
            PathBuf::new()
        };
        let provider =
            cached_text_provider(settings, local_dir).map_err(|error| error.to_string())?;
        let status = provider.status();
        let resolved_dir = status
            .model_path
            .clone()
            .or_else(|| settings.endpoint.clone())
            .unwrap_or_default();
        let heads = neuink_search::inspect_multivector_heads(std::path::Path::new(&resolved_dir));
        Ok(Self {
            provider: settings.provider.as_str().to_string(),
            model_dir: settings.model_dir.clone(),
            endpoint: settings.endpoint.clone(),
            has_api_key: settings
                .api_key
                .as_deref()
                .map(str::trim)
                .is_some_and(|key| !key.is_empty()),
            model: settings.model.clone(),
            dimensions: settings.dimensions,
            timeout_ms: settings.timeout_ms,
            resolved_dir,
            loaded_model_name: status.model_name,
            loaded_dimensions: status.dimensions,
            available: status.available,
            message: status.message,
            colbert_head_present: heads.colbert_present,
            sparse_head_present: heads.sparse_present,
        })
    }
}

/// The settings screen writes the API key only when the user types one. Keeping the stored
/// value here means saving unrelated fields never clears the credential.
fn merge_stored_api_key<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &mut neuink_config::TextModelSettings,
) {
    if settings
        .api_key
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .is_empty()
    {
        if let Ok(saved) = crate::storage::read_settings(app) {
            settings.api_key = saved.text_model.api_key;
        }
    }
}

#[tauri::command]
pub fn list_text_models<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<crate::commands::embedding_resources::TextModelChoice>, String> {
    crate::commands::embedding_resources::list_text_models(&app)
}

#[tauri::command]
pub fn get_text_model_settings<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<TextModelSettingsState, String> {
    let settings = crate::storage::read_settings(&app)?.text_model;
    TextModelSettingsState::from_settings(&app, &settings)
}

#[tauri::command]
pub fn save_text_model_settings<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    settings: neuink_config::TextModelSettings,
) -> Result<TextModelSettingsState, String> {
    let mut settings = settings;
    merge_stored_api_key(&app, &mut settings);
    settings.validate()?;
    // Local mode: refuse a directory that cannot serve the search path. Shipping a setting
    // that silently disables semantic retrieval would look like a search regression later.
    if settings.provider == neuink_config::TextEmbeddingProviderKind::LocalOnnx {
        if let Some(dir) = settings.model_dir.as_deref() {
            let path = std::path::PathBuf::from(dir);
            let provider = neuink_search::FastEmbedProvider::from_model_dir(path);
            if !neuink_search::EmbeddingProvider::status(&provider).available {
                return Err(
                    "该目录不是可用的文本嵌入模型（需 neuink-embedding.json 与 ONNX 权重）".to_string(),
                );
            }
        }
    }
    let mut saved = crate::storage::read_settings(&app)?;
    saved.text_model = settings;
    crate::storage::write_settings(&app, &saved)?;
    TextModelSettingsState::from_settings(&app, &saved.text_model)
}

/// Live probe for the settings screen: embeds two strings through the configured transport
/// and reports the vector width, so "configured" and "actually works" stay distinguishable.
#[tauri::command]
pub async fn test_text_embedding_connection<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    settings: neuink_config::TextModelSettings,
) -> Result<TextEmbeddingProbeState, String> {
    tokio::task::spawn_blocking(move || test_text_embedding_connection_impl(&app, settings))
        .await
        .map_err(|error| error.to_string())?
}

fn test_text_embedding_connection_impl<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    settings: neuink_config::TextModelSettings,
) -> Result<TextEmbeddingProbeState, String> {
    let mut settings = settings;
    merge_stored_api_key(&app, &mut settings);
    settings.validate()?;
    let local_dir = if settings.provider == neuink_config::TextEmbeddingProviderKind::LocalOnnx {
        embedding_model_dir(&app)?
    } else {
        PathBuf::new()
    };
    let provider = cached_text_provider(&settings, local_dir).map_err(|error| error.to_string())?;
    let status = provider.status();
    if !status.available {
        return Err(status
            .message
            .unwrap_or_else(|| "文本嵌入模型不可用".to_string()));
    }
    let started = Instant::now();
    let vectors = provider
        .embed(&[
            neuink_search::EmbeddingInput {
                id: "probe".to_string(),
                text: "probe".to_string(),
            },
            neuink_search::EmbeddingInput {
                id: "probe-2".to_string(),
                text: "检索探针".to_string(),
            },
        ])
        .map_err(|error| error.to_string())?;
    let dimensions = vectors
        .first()
        .map(|vector| vector.dimensions())
        .unwrap_or(0);
    if vectors.len() != 2 || dimensions == 0 {
        return Err("嵌入模型返回的向量数量或维度不正确".to_string());
    }
    Ok(TextEmbeddingProbeState {
        provider: status.provider,
        model_name: status.model_name,
        dimensions,
        latency_ms: started.elapsed().as_millis() as u64,
    })
}


#[tauri::command]
pub fn list_recommended_text_models<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<crate::commands::search::recommended_text_models::RecommendedState>, String> {
    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
    let root = resource_dir.join("embedding-models");
    Ok(crate::commands::search::recommended_text_models::list_states(&root))
}

/// Downloads one self-contained ONNX export and installs it as a selectable model directory.
///
/// Only entries flagged `directly_installable` are accepted: everything else would need an
/// export or an external-data merge, which this command must not pretend to do.
#[tauri::command]
pub async fn install_recommended_text_model<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<crate::commands::search::recommended_text_models::RecommendedState, String> {
    tokio::task::spawn_blocking(move || install_recommended_text_model_impl(&app, id))
        .await
        .map_err(|error| error.to_string())?
}

fn install_recommended_text_model_impl<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: String,
) -> Result<crate::commands::search::recommended_text_models::RecommendedState, String> {
    use crate::commands::search::recommended_text_models as recommended;
    use neuink_search::EmbeddingProvider;

    let model = recommended::RECOMMENDED
        .iter()
        .find(|model| model.id == id)
        .copied()
        .ok_or_else(|| format!("未知的推荐模型：{id}"))?;
    if !model.directly_installable {
        return Err(format!("{} 无法直接安装：{}", model.display_name, model.note));
    }
    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
    let dir = recommended::install_dir(&resource_dir.join("embedding-models"), model.id)
        .ok_or_else(|| "安装目录不可用".to_string())?;
    recommended::write_model_metadata(&dir, &model)?;

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(1800))
        .build()
        .map_err(|error| error.to_string())?;
    // Download exactly what the entry declares; every path was checked to return HTTP 206
    // from `https://huggingface.co/<repo>/resolve/main/<path>`.
    let downloads: Vec<(String, String)> = model
        .files
        .iter()
        .map(|(remote, local)| ((*remote).to_string(), (*local).to_string()))
        .collect();
    for (remote, relative) in downloads {
        let target = dir.join(&relative);
        if target.is_file() && std::fs::metadata(&target).map(|meta| meta.len() > 0).unwrap_or(false) {
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let url = format!("https://huggingface.co/{}/resolve/main/{remote}", model.repository);
        let bytes = client
            .get(&url)
            .send()
            .and_then(|response| response.error_for_status())
            .and_then(|response| response.bytes())
            .map_err(|error| format!("下载 {url} 失败：{error}"))?;
        std::fs::write(&target, &bytes).map_err(|error| error.to_string())?;
    }
    recommended::write_model_metadata(&dir, &model)?;

    // Prove the model actually runs: files on disk are not the same as a usable encoder.
    let provider = neuink_search::FastEmbedProvider::from_model_dir(dir.clone());
    let status = provider.status();
    if !status.available {
        return Err(format!(
            "模型文件已下载但无法加载：{}",
            status.message.unwrap_or_else(|| "未知原因".to_string())
        ));
    }
    let probe = neuink_search::EmbeddingProvider::embed(
        &provider,
        &[neuink_search::EmbeddingInput {
            id: "probe".to_string(),
            text: "probe".to_string(),
        }],
    )
    .map_err(|error| format!("模型已下载但推理失败：{error}"))?;
    if probe.len() != 1 {
        return Err("模型已下载但推理结果数量不符".to_string());
    }
    Ok(crate::commands::search::recommended_text_models::RecommendedState {
        model,
        installed_dir: Some(dir.to_string_lossy().to_string()),
        installed: true,
    })
}





#[tauri::command]
pub fn list_recommended_rerank_models<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<crate::commands::search::recommended_rerank_models::RecommendedRerankState>, String> {
    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
    Ok(crate::commands::search::recommended_rerank_models::list_states(
        &resource_dir.join("embedding-models"),
    ))
}

/// Downloads one reranker and proves it scores before reporting success.
#[tauri::command]
pub async fn install_recommended_rerank_model<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<crate::commands::search::recommended_rerank_models::RecommendedRerankState, String> {
    tokio::task::spawn_blocking(move || install_recommended_rerank_model_impl(&app, id))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(feature = "local-embedding")]
fn install_recommended_rerank_model_impl<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: String,
) -> Result<crate::commands::search::recommended_rerank_models::RecommendedRerankState, String> {
    use crate::commands::search::recommended_rerank_models as recommended;

    let model = recommended::RECOMMENDED_RERANK
        .iter()
        .find(|model| model.id == id)
        .copied()
        .ok_or_else(|| format!("未知的推荐重排模型：{id}"))?;
    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
    let dir = recommended::install_dir(&resource_dir.join("embedding-models"), model.id)
        .ok_or_else(|| "安装目录不可用".to_string())?;

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|error| error.to_string())?;
    for (remote, local) in model.files {
        let target = dir.join(local);
        if target.is_file() && std::fs::metadata(&target).map(|meta| meta.len() > 0).unwrap_or(false) {
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let url = format!("https://huggingface.co/{}/resolve/main/{remote}", model.repository);
        let bytes = client
            .get(&url)
            .send()
            .and_then(|response| response.error_for_status())
            .and_then(|response| response.bytes())
            .map_err(|error| format!("下载 {url} 失败：{error}"))?;
        std::fs::write(&target, &bytes).map_err(|error| error.to_string())?;
    }
    recommended::complete_tokenizer_files(&dir)?;

    let reranker = neuink_search::LocalReranker::load(&dir)
        .map_err(|error| format!("重排模型已下载但无法加载：{error}"))?;
    let scores = neuink_search::RerankProvider::score(
        &reranker,
        "probe query",
        &["probe passage"],
    )
    .map_err(|error| format!("重排模型已下载但推理失败：{error}"))?;
    if scores.len() != 1 {
        return Err("重排模型已下载但打分结果数量不符".to_string());
    }
    Ok(recommended::RecommendedRerankState {
        model,
        installed_dir: Some(dir.to_string_lossy().to_string()),
        installed: true,
    })
}

#[cfg(not(feature = "local-embedding"))]
fn install_recommended_rerank_model_impl<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    _id: String,
) -> Result<crate::commands::search::recommended_rerank_models::RecommendedRerankState, String> {
    Err("当前构建未启用本地重排模型支持".to_string())
}

/// One line of the on-device self check.
#[derive(Debug, serde::Serialize)]
pub struct RetrievalCheck {
    pub name: &'static str,
    pub ok: bool,
    pub detail: String,
    pub ms: u64,
}

/// Verifies the three channels plus the library, so "does retrieval work here" is a single
/// button instead of four separate guesses.
#[tauri::command]
pub async fn run_retrieval_self_check<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    root: std::path::PathBuf,
) -> Result<Vec<RetrievalCheck>, String> {
    tokio::task::spawn_blocking(move || run_retrieval_self_check_impl(&app, root))
        .await
        .map_err(|error| error.to_string())?
}

fn run_retrieval_self_check_impl<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    root: std::path::PathBuf,
) -> Result<Vec<RetrievalCheck>, String> {
    let mut checks = Vec::new();

    // Text encoder: load and embed one probe string.
    let started = std::time::Instant::now();
    let text = (|| -> Result<String, String> {
        let provider = text_provider_for_app(&app)?;
        let status = provider.status();
        if !status.available {
            return Err(status.message.unwrap_or_else(|| "模型不可用".to_string()));
        }
        let vectors = provider
            .embed(&[neuink_search::EmbeddingInput {
                id: "probe".to_string(),
                text: "probe".to_string(),
            }])
            .map_err(|error| error.to_string())?;
        Ok(format!(
            "{} · {} 维 · {}",
            status.model_name.unwrap_or_else(|| "未知模型".to_string()),
            vectors.first().map(|vector| vector.dimensions()).unwrap_or(0),
            status
                .model_path
                .or_else(|| status.message.clone())
                .unwrap_or_default()
        ))
    })();
    checks.push(RetrievalCheck {
        name: "text_model",
        ok: text.is_ok(),
        detail: text.unwrap_or_else(|error| error),
        ms: started.elapsed().as_millis() as u64,
    });

    // Library: can it be opened, and how many papers are parsed.
    let started = std::time::Instant::now();
    let library = (|| -> Result<String, String> {
        let workspace = Workspace::open(&root).map_err(|error| error.to_string())?;
        let entries = workspace.list_entries().map_err(|error| error.to_string())?;
        let parsed = entries
            .iter()
            .filter(|entry| {
                entry
                    .pdf
                    .as_ref()
                    .map(|pdf| pdf.parse.status == neuink_domain::PdfParseStatus::Succeeded)
                    .unwrap_or(false)
            })
            .count();
        Ok(format!("{} 篇条目，其中 {} 篇已解析", entries.len(), parsed))
    })();
    checks.push(RetrievalCheck {
        name: "library",
        ok: library.is_ok(),
        detail: library.unwrap_or_else(|error| error),
        ms: started.elapsed().as_millis() as u64,
    });

    // Visual channel: provider reachability (a missing snapshot is reported, not failed).
    let started = std::time::Instant::now();
    let visual = (|| -> Result<String, String> {
        let startup = ensure_visual_service(&app)?;
        let settings = crate::storage::read_settings(&app)?.visual;
        let endpoint = settings
            .endpoint
            .clone()
            .unwrap_or_else(|| "http://127.0.0.1:8765".to_string());
        let provider = visual::provider_for(&settings);
        let check = neuink_search::check_provider(provider.as_ref());
        if check.unavailable_reason.is_some() {
            // Distinguish "no service listening" from "service answered but not usable":
            // both used to read as model_unavailable, which sent people looking for files.
            let message = provider.status().message.unwrap_or_default();
            let code = if message.contains("不可达") {
                "service_unreachable"
            } else {
                "model_not_ready"
            };
            return Err(format!("{code}：{endpoint} — {message}"));
        }
        Ok(format!(
            "{startup}；{} · {} 维",
            provider.status().model_name.unwrap_or_else(|| "未知模型".to_string()),
            provider.dimensions().unwrap_or(0)
        ))
    })();
    checks.push(RetrievalCheck {
        name: "visual_model",
        ok: visual.is_ok(),
        detail: visual.unwrap_or_else(|error| error),
        ms: started.elapsed().as_millis() as u64,
    });

    // Rerank ladder: only the model-backed rung needs a load; the others are model-free.
    let started = std::time::Instant::now();
    let rerank = (|| -> Result<String, String> {
        let settings = crate::storage::read_settings(&app)?.rerank;
        match settings.mode {
            neuink_config::RerankMode::Off => Ok("重排关闭（融合序直接输出）".to_string()),
            neuink_config::RerankMode::Heuristic => Ok("字段覆盖重排可用（无需模型）".to_string()),
            neuink_config::RerankMode::CrossEncoder => {
                let dir = settings
                    .model_dir
                    .as_deref()
                    .map(std::path::PathBuf::from)
                    .unwrap_or(rerank_model_dir(&app)?);
                let provider = rerank_stage::provider_for(&settings, &dir).ok_or_else(|| {
                    format!(
                        "{}：{}",
                        rerank_stage::unavailable_reason(&settings),
                        settings
                            .api_endpoint
                            .clone()
                            .unwrap_or_else(|| dir.display().to_string())
                    )
                })?;
                let scores = neuink_search::RerankProvider::score(
                    provider.as_ref(),
                    "probe query",
                    &["probe passage"],
                )
                .map_err(|error| error.to_string())?;
                if scores.is_empty() {
                    return Err("重排打分结果为空".to_string());
                }
                Ok(match settings.transport {
                    neuink_config::RerankTransport::Local => {
                        format!("本地交叉编码器可用：{}", dir.display())
                    }
                    neuink_config::RerankTransport::Api => format!(
                        "重排 API 可用：{}（{}）",
                        settings.api_endpoint.clone().unwrap_or_default(),
                        settings.api_model.clone().unwrap_or_default()
                    ),
                })
            }
        }
    })();
    checks.push(RetrievalCheck {
        name: "rerank",
        ok: rerank.is_ok(),
        detail: rerank.unwrap_or_else(|error| error),
        ms: started.elapsed().as_millis() as u64,
    });

    Ok(checks)
}


#[tauri::command]
pub fn list_recommended_visual_models() -> Vec<crate::commands::search::recommended_visual_models::RecommendedVisualModel> {
    crate::commands::search::recommended_visual_models::RECOMMENDED_VISUAL.to_vec()
}





#[tauri::command]
pub fn get_visual_runtime_state<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<Option<crate::commands::search::visual_runtime::VisualRuntimeState>, String> {
    Ok(find_visual_runtime_state(&app, &id).map(|(_, state)| state))
}

/// One action: isolated Python environment, CPU inference dependencies and model weights.
/// A supplied `reuse_model_dir` skips the multi-gigabyte download.
#[tauri::command]
pub async fn install_visual_runtime<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    reuse_model_dir: Option<String>,
) -> Result<crate::commands::search::visual_runtime::VisualRuntimeState, String> {
    tokio::task::spawn_blocking(move || {
        let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
        let reuse = reuse_model_dir.map(std::path::PathBuf::from);
        crate::commands::search::visual_runtime::install(&resource_dir, &id, reuse.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Downloads only the weights for an environment that is already prepared, so a failed
/// multi-gigabyte download can be retried without reinstalling torch.
#[tauri::command]
pub async fn download_visual_weights<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    reuse_model_dir: Option<String>,
) -> Result<crate::commands::search::visual_runtime::VisualRuntimeState, String> {
    tokio::task::spawn_blocking(move || {
        let resource_dir = match find_visual_runtime_state(&app, &id) {
            Some((dir, _)) => dir,
            None => app.path().resource_dir().map_err(|error| error.to_string())?,
        };
        let reuse = reuse_model_dir.map(std::path::PathBuf::from);
        crate::commands::search::visual_runtime::download_missing_weights(
            &resource_dir,
            &id,
            reuse.as_deref(),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Starts the prepared service and returns its process id.
/// Whether the local visual service is actually answering, for the settings screen.
///
/// `get_visual_runtime_state` only knows what is installed on disk; this probe asks the
/// configured transport, so "downloaded" and "running" are distinguishable at a glance.
#[derive(Debug, serde::Serialize)]
pub struct VisualServiceStatus {
    pub running: bool,
    pub model: Option<String>,
    pub dimensions: Option<usize>,
    pub endpoint: Option<String>,
    pub message: Option<String>,
}

#[tauri::command]
pub async fn get_visual_service_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<VisualServiceStatus, String> {
    let settings = crate::storage::read_settings(&app)?.visual;
    tokio::task::spawn_blocking(move || {
        // Provider construction probes the service over blocking HTTP; keep it off the
        // async worker for the same runtime-drop reason as the other visual commands.
        let provider = visual::provider_for(&settings);
        let status = provider.status();
        VisualServiceStatus {
            running: status.available,
            model: status.model_name,
            dimensions: status.dimensions,
            endpoint: settings.endpoint.clone(),
            message: status.message,
        }
    })
    .await
    .map_err(|error| error.to_string())
}
/// The port the local visual service binds. Checked before spawning so a second click
/// cannot load another 4 GB checkpoint and fail to bind.
fn visual_service_listening() -> bool {
    use std::net::{SocketAddr, TcpStream};
    let addr = SocketAddr::from(([127, 0, 0, 1], 8765));
    TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(300)).is_ok()
}

#[tauri::command]
pub async fn start_visual_service<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<u32, String> {
    tokio::task::spawn_blocking(move || {
        let _start_guard = visual_runtime::start_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if visual_service_listening() {
            visual::invalidate_provider_cache();
            return Ok(0);
        }
        let script = visual_service_script(&app)?;
        let (_, state) = find_visual_runtime_state(&app, &id)
            .ok_or_else(|| "视觉服务尚未安装".to_string())?;
        let pid = visual_runtime::start_with_state(&state, &script)?;
        // Loading the 4 GB checkpoint takes tens of seconds; only report success once the
        // port answers, so the settings screen can show "running" instead of guessing.
        for _ in 0..180 {
            if visual_service_listening() {
                visual::invalidate_provider_cache();
                break;
            }
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
        Ok(pid)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Locates the service script in the packaged resources, then in the checkout layout.
fn visual_service_script<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<std::path::PathBuf, String> {
    const RELATIVE: &str = "scripts/qwen-visual-service/service.py";
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(RELATIVE));
        candidates.push(resource_dir.join("resources").join(RELATIVE));
    }
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
    {
        candidates.push(exe_dir.join(RELATIVE));
    }
    candidates.push(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop")
            .join(RELATIVE),
    );
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| "找不到视觉服务脚本（scripts/qwen-visual-service/service.py）".to_string())
}



/// Starts the local visual service when the configured transport needs it.
///
/// Called before any visual work: a user should never have to keep a terminal open, and a
/// remote transport must never spawn anything. The outcome string is for the self check.
fn ensure_visual_service<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<String, String> {
    use neuink_config::{VisualEmbeddingProviderKind, VisualServiceStartup};

    let settings = crate::storage::read_settings(app)?.visual;
    if settings.provider != VisualEmbeddingProviderKind::QwenLocal {
        return Ok("远程视觉编码，无需本机服务".to_string());
    }
    let _start_guard = visual_runtime::start_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let provider = visual::provider_for(&settings);
    if neuink_search::check_provider(provider.as_ref())
        .unavailable_reason
        .is_none()
    {
        visual::invalidate_provider_cache();
        return Ok("视觉编码服务已在运行".to_string());
    }
    if settings.startup == VisualServiceStartup::Manual {
        return Err("service_unreachable：启动策略为手动，请先启动视觉服务".to_string());
    }

    let Some((_id, state)) = ready_visual_runtime(app) else {
        return Err(
            "service_unreachable：尚未安装视觉服务依赖与模型，请先在“视觉编码模型”里一键安装"
                .to_string(),
        );
    };
    let script = visual_service_script(app)?;
    let pid = visual_runtime::start_with_state(&state, &script)?;
    // Give the interpreter a moment to bind the port before the caller probes it.
    // A 4 GB checkpoint needs tens of seconds to load, so wait long enough to be useful.
    for _ in 0..90 {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let provider = visual::provider_for(&settings);
        if neuink_search::check_provider(provider.as_ref())
            .unavailable_reason
            .is_none()
        {
            visual::invalidate_provider_cache();
            return Ok(format!("视觉编码服务已自动启动（进程 {pid}）"));
        }
    }
    Err(format!(
        "service_unreachable：已尝试启动视觉服务（进程 {pid}）但未就绪，请查看服务日志"
    ))
}





/// Directories that may hold the prepared visual runtime.
///
/// `app.path().resource_dir()` is not the same directory in every layout: a dev build can
/// report the target directory itself while the copied resources live under `resources/`.
/// Every lookup therefore probes the same candidate list instead of trusting one path.
fn visual_runtime_roots<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Vec<std::path::PathBuf> {
    const DIR: &str = "visual-service";
    let mut roots = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir.join(DIR));
        roots.push(resource_dir.join("resources").join(DIR));
    }
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
    {
        roots.push(exe_dir.join(DIR));
        roots.push(exe_dir.join("resources").join(DIR));
    }
    roots.push(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src-tauri/resources")
            .join(DIR),
    );
    roots
}

/// Looks up a prepared visual runtime state for `id` across every candidate resource layout,
/// returning both the owning resource directory and the parsed state.
fn find_visual_runtime_state_in_roots(
    roots: &[std::path::PathBuf],
    id: &str,
) -> Option<(std::path::PathBuf, visual_runtime::VisualRuntimeState)> {
    for root in roots {
        let Some(parent) = root.parent() else {
            continue;
        };
        if let Some(state) = visual_runtime::load_state(parent, id) {
            return Some((parent.to_path_buf(), state));
        }
    }
    None
}

fn find_visual_runtime_state<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
) -> Option<(std::path::PathBuf, visual_runtime::VisualRuntimeState)> {
    find_visual_runtime_state_in_roots(&visual_runtime_roots(app), id)
}

/// First root that actually contains a prepared model.
fn ready_visual_runtime<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<(String, visual_runtime::VisualRuntimeState)> {
    for root in visual_runtime_roots(app) {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let id = entry.file_name().to_string_lossy().to_string();
            let state_path = entry.path().join("state.json");
            let Ok(bytes) = std::fs::read(&state_path) else {
                continue;
            };
            let Ok(state) = serde_json::from_slice::<visual_runtime::VisualRuntimeState>(&bytes) else {
                continue;
            };
            if state.dependencies_installed && state.model_present {
                return Some((id, state));
            }
        }
    }
    None
}

#[cfg(test)]
mod visual_runtime_lookup_tests {
    use super::*;

    #[test]
    fn find_visual_runtime_state_falls_back_to_nested_resources_layout() {
        let base = std::env::temp_dir().join(format!(
            "neuink-visual-lookup-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let nested_resources = base.join("resources");
        let model_dir = nested_resources
            .join("visual-service")
            .join("qwen3-vl-embedding-2b");
        std::fs::create_dir_all(&model_dir).expect("create dir");
        let state = visual_runtime::VisualRuntimeState {
            model_id: "qwen3-vl-embedding-2b".to_string(),
            env_dir: "C:/fake/env".to_string(),
            model_dir: "C:/fake/model".to_string(),
            python: "C:/fake/env/python.exe".to_string(),
            dependencies_installed: true,
            model_present: true,
            model_error: None,
        };
        std::fs::write(
            model_dir.join("state.json"),
            serde_json::to_vec(&state).expect("json"),
        )
        .expect("write state");

        let roots = vec![
            base.join("visual-service"),
            nested_resources.join("visual-service"),
        ];
        let (found_parent, found_state) =
            find_visual_runtime_state_in_roots(&roots, "qwen3-vl-embedding-2b")
                .expect("should find nested state");
        assert_eq!(found_parent, nested_resources);
        assert!(found_state.dependencies_installed);
        assert!(found_state.model_present);
        std::fs::remove_dir_all(&base).ok();
    }
}



