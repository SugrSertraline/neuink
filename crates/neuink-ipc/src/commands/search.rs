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

use super::embedding_resources::{embedding_model_dir, rerank_model_dir};

mod unified;
mod rerank_stage;
mod visual;
mod visual_qwen;
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
    /// Which rerank rung ran: `off`, `heuristic`, `cross_encoder`, `fused`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rerank_used: Option<&'static str>,
    /// Why a rung was skipped: `model_unavailable`, `provider_error`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rerank_reason: Option<&'static str>,
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
    last_used: Instant,
}

struct CachedSemanticIndex {
    fingerprint: u64,
    index: Arc<PersistentSemanticSearchIndex>,
    last_used: Instant,
}

struct CachedEmbeddingProvider {
    provider: Arc<FastEmbedProvider>,
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

pub fn spawn_search_cache_workers<R: tauri::Runtime>(_app: tauri::AppHandle<R>) {
    // Keep cache eviction alive at startup. Legacy semantic snapshots are
    // rebuilt lazily in a detached worker on the first semantic request, so
    // keyword search remains available while the new index is prepared.
    thread::Builder::new()
        .name("neuink-search-cache-cleanup".to_string())
        .spawn(clean_search_caches_loop)
        .ok();
}

#[tauri::command]
pub async fn search_entries<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: SearchEntriesRequest,
) -> Result<SearchResults, String> {
    let model_dir = embedding_model_dir(&app)?;
    tokio::task::spawn_blocking(move || {
        run_search_bundle(
            model_dir,
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
    let model_dir = embedding_model_dir(&app)?;
    tokio::task::spawn_blocking(move || {
        run_search_bundle(
            model_dir,
            request.root,
            request.query,
            request.english_query,
            request.sub_queries,
            request.scope_entry_ids,
            request.mode,
            request.top_k.unwrap_or(20).clamp(1, 20),
            true,
            request.section_filter,
            parse_segment_types(&request.segment_types),
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
    provider: Arc<FastEmbedProvider>,
    semantic: Option<Arc<PersistentSemanticSearchIndex>>,
    /// Distinct entries in the prepared corpus. The document head needs the scope
    /// size to tell "no parsed documents" from "nothing ranked".
    document_count: usize,
}

fn prepare_search(
    model_dir: PathBuf,
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
    let keyword = cached_index(
        root,
        &options,
        records_fingerprint(&records),
        documents.clone(),
    )?;
    let provider = cached_embedding_provider(model_dir).map_err(|e| e.to_string())?;
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
    let provider = prepared.provider.as_ref();
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
            embed_query_vector(provider, text).ok()
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
    model_dir: PathBuf,
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
    let prepared = prepare_search(model_dir, &root, segments_only, mode != SearchMode::Keyword)?;
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

#[tauri::command]
pub async fn search_segments_batch<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: SearchSegmentsBatchRequest,
) -> Result<Vec<SearchSegmentsBatchItem>, String> {
    let model_dir = embedding_model_dir(&app)?;
    let (rerank, rerank_provider) = resolve_rerank(&app)?;
    tokio::task::spawn_blocking(move || {
        run_segments_batch(model_dir, rerank, rerank_provider, request)
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
    ),
    String,
> {
    let settings = crate::storage::read_settings(app)?.rerank;
    let provider: Option<Arc<dyn neuink_search::RerankProvider>> =
        if settings.mode == neuink_config::RerankMode::CrossEncoder {
            let dir = rerank_model_dir(app)?;
            rerank_stage::reranker_for(&dir)
                .map(|reranker| reranker as Arc<dyn neuink_search::RerankProvider>)
        } else {
            None
        };
    Ok((settings, provider))
}

/// Applies the ladder to every successful batch item. The batch wire is unchanged except
/// for two additive fields, so a caller that ignores reranking keeps working.
fn apply_batch_rerank(
    items: Vec<SearchSegmentsBatchItem>,
    settings: &neuink_config::RerankSettings,
    provider: Option<&dyn neuink_search::RerankProvider>,
) -> Vec<SearchSegmentsBatchItem> {
    items
        .into_iter()
        .map(|item| match item.results {
            Some(results) => {
                let question = results.query.clone();
                let (reranked, outcome) =
                    unified::rerank_task_results(results, &question, settings, provider);
                SearchSegmentsBatchItem {
                    task_id: item.task_id,
                    results: Some(reranked),
                    error: item.error,
                    rerank_used: Some(outcome.used),
                    rerank_reason: outcome.reason,
                }
            }
            None => item,
        })
        .collect()
}

/// Prepares the workspace index and embedding provider once per batch, then runs
/// each task in order. Only a preparation failure fails the whole batch.
fn run_segments_batch(
    model_dir: PathBuf,
    rerank: neuink_config::RerankSettings,
    rerank_provider: Option<Arc<dyn neuink_search::RerankProvider>>,
    request: SearchSegmentsBatchRequest,
) -> Result<Vec<SearchSegmentsBatchItem>, String> {
    let SearchSegmentsBatchRequest { root, tasks } = request;
    let items = collect_segments_batch(
        tasks,
        |needs_semantic| prepare_search(model_dir, &root, true, needs_semantic),
        |prepared, task| {
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
        },
    )?;
    Ok(apply_batch_rerank(items, &rerank, rerank_provider.as_deref()))
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
            match run(&prepared, task) {
                Ok(results) => SearchSegmentsBatchItem {
                    task_id,
                    results: Some(results),
                    error: None,
                    // The ladder runs after the batch; until then no rung has been applied.
                    rerank_used: None,
                    rerank_reason: None,
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
    let model_dir = embedding_model_dir(&app)?;
    tokio::task::spawn_blocking(move || get_search_index_status_impl(request, model_dir))
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
    let embedding_model_dir = embedding_model_dir(&app)?;
    tokio::task::spawn_blocking(move || {
        begin_search_build(&request.root, "手动重建向量索引");
        let root = request.root.clone();
        let result = rebuild_search_index_impl(embedding_model_dir, request);
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
    model_dir: PathBuf,
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

    let provider = cached_embedding_provider(model_dir).map_err(|e| e.to_string())?;
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

fn rebuild_search_index_impl(
    embedding_model_dir: PathBuf,
    request: RebuildSearchIndexRequest,
) -> Result<RebuildSearchIndexResponse, String> {
    // The manual build intentionally keeps the previous disk snapshot so
    // `open_or_build_with_progress` only embeds documents that are new or
    // changed since the last build instead of re-embedding the workspace.
    let workspace = Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let provider = cached_embedding_provider(embedding_model_dir.clone())
        .map_err(|error| error.to_string())?;

    // A global build also refreshes the segments-only scope so assistant
    // segment search keeps working after the startup warmup was removed.
    let scopes = if request.segments_only {
        vec![search_scope_options(true)]
    } else {
        vec![search_scope_options(false), search_scope_options(true)]
    };
    let mut semantic_document_count = 0;
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
        let _ = cached_semantic_index(
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
        )
        .map_err(|error| error.to_string())?;
    }

    let status = get_search_index_status_impl(
        SearchIndexStatusRequest {
            root: request.root,
            segments_only: request.segments_only,
        },
        embedding_model_dir,
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
    let cache_key = workspace_cache_key(root, options);
    let cache = SEARCH_INDEX_CACHE.get_or_init(|| Mutex::new(HashMap::new()));

    if let Some(index) = cache
        .lock()
        .map_err(|_| "search cache lock is poisoned".to_string())?
        .get_mut(&cache_key)
        .filter(|cached| cached.fingerprint == fingerprint)
        .map(|cached| {
            cached.last_used = Instant::now();
            cached.index.clone()
        })
    {
        return Ok(index);
    }

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
            last_used: Instant::now(),
        },
    );
    trim_workspace_cache(&mut cache);
    Ok(index)
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

fn cached_embedding_provider(
    embedding_model_dir: PathBuf,
) -> Result<Arc<FastEmbedProvider>, neuink_search::SearchError> {
    let cache_key = embedding_model_dir.display().to_string();
    let signature = model_metadata_signature(&embedding_model_dir);
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

    let provider = Arc::new(FastEmbedProvider::from_model_dir(embedding_model_dir));
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

fn cached_semantic_index(
    root: &PathBuf,
    options: &WorkspaceSearchOptions,
    records_fingerprint: u64,
    include: &SearchInclude,
    documents: &[SearchDocument],
    provider: Arc<FastEmbedProvider>,
    progress_scope: Option<&str>,
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
    let index_result = PersistentSemanticSearchIndex::open_or_build_with_progress(
        index_path,
        documents,
        provider.as_ref(),
        include,
        records_fingerprint,
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
    provider: &FastEmbedProvider,
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
    provider: Arc<FastEmbedProvider>,
) {
    let cache_dir = WorkspaceLayout::new(root.clone()).cache_dir();
    let identity = semantic_embedding_identity(provider.as_ref());
    let namespace = semantic_cache_namespace(root, options, include, identity.as_deref());
    let index_path = semantic_index_path(cache_dir, &namespace);
    let cache_status = read_semantic_disk_cache_status(&index_path);
    if !should_schedule_legacy_semantic_rebuild(cache_status.as_ref(), provider.status().available)
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
        && cache_status.is_some_and(|status| status.version != SEMANTIC_INDEX_FORMAT_VERSION)
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
        FastEmbedProvider, MemorySearchIndex, SearchDocumentSource, SearchDocumentSourceKind,
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
            provider: Arc::new(FastEmbedProvider::from_model_dir(model_dir)),
            semantic: None,
            // Fixtures below use two entries, so the head's scope size is 2.
            document_count: 2,
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
    let model_dir = embedding_model_dir(&app)?;
    let saved = crate::storage::read_settings(&app)?;
    let settings = saved.visual;
    let visual_provider = visual::provider_for(&settings);
    let fusion = settings.fusion;
    let rerank_settings = saved.rerank;
    // Only a cross-encoder run needs the model; the heuristic rung is model-free.
    let rerank_provider: Option<Arc<dyn neuink_search::RerankProvider>> =
        if rerank_settings.mode == neuink_config::RerankMode::CrossEncoder {
            let dir = rerank_model_dir(&app)?;
            rerank_stage::reranker_for(&dir).map(|reranker| reranker as Arc<dyn neuink_search::RerankProvider>)
        } else {
            None
        };
    tokio::task::spawn_blocking(move || {
        unified::run_unified_search(
            model_dir,
            visual_provider,
            fusion,
            rerank_settings,
            rerank_provider,
            request,
        )
    })
    .await
    .map_err(|error| error.to_string())?
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
    let provider = visual::provider_for(&settings);
    tokio::task::spawn_blocking(move || visual::prepare_visual_index(provider, request))
        .await
        .map_err(|error| error.to_string())?
}


#[cfg(test)]
mod visual_service_tests;

/// Which rerank rung is configured, with the model directory it would load.
#[derive(Debug, serde::Serialize)]
pub struct RerankSettingsState {
    pub mode: &'static str,
    pub model_dir: Option<String>,
    pub max_candidates: usize,
    pub fallback_heuristic: bool,
    /// Whether a model is actually present at the resolved directory. A settings screen
    /// needs this to tell "configured but not installed" from "working".
    pub model_present: bool,
}

impl RerankSettingsState {
    fn from_settings(settings: &neuink_config::RerankSettings, model_present: bool) -> Self {
        Self {
            mode: settings.mode.as_str(),
            model_dir: settings.model_dir.clone(),
            max_candidates: settings.max_candidates,
            fallback_heuristic: settings.fallback_heuristic,
            model_present,
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

#[tauri::command]
pub fn save_rerank_settings<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    settings: neuink_config::RerankSettings,
) -> Result<RerankSettingsState, String> {
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
}

#[tauri::command]
pub fn get_retrieval_settings<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<RetrievalSettingsState, String> {
    let settings = crate::storage::read_settings(&app)?.retrieval;
    Ok(RetrievalSettingsState {
        unified: settings.unified,
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
    })
}
