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

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use neuink_config::{VisualEmbeddingProviderKind, VisualEmbeddingSettings};
use neuink_domain::EntryId;
use neuink_search::{
    build_visual_index, check_provider, reopen_visual_index, visual_index_path, visual_namespace,
    VisualChannelStatus, VisualEmbeddingProvider, VisualIndexDocument, VisualRecall, VisualScore,
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
    index: Option<neuink_search::VisualSearchIndex>,
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

/// Builds the provider named by the settings. Both transports return the same trait
/// object, so every caller below is provider-agnostic: local or remote is a settings
/// change, never a code path.
pub(super) fn provider_for(settings: &VisualEmbeddingSettings) -> Arc<dyn VisualEmbeddingProvider> {
    let endpoint = settings.endpoint.clone().unwrap_or_default();
    let timeout = std::time::Duration::from_millis(settings.timeout_ms.max(1));
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
        VisualEmbeddingProviderKind::Retired => Arc::new(
            neuink_search::NoVisualProvider::with_message("当前视觉编码器已停用，请改选 Qwen 服务。"),
        ),
    }
}

/// Opens the channel by inspection only: no encoding, no writes, no network.
pub(super) fn visual_channel(
    root: &PathBuf,
    provider: Arc<dyn VisualEmbeddingProvider>,
) -> VisualChannel {
    let unavailable = |reason: &'static str| VisualChannel {
        status: VisualChannelStatus::Unavailable(reason),
        provider: provider.clone(),
        index: None,
        identity: None,
    };
    let check = check_provider(provider.as_ref());
    if check.unavailable_reason.is_some() {
        return unavailable(VISUAL_REASON_MODEL_UNAVAILABLE);
    }
    let (Some(identity), Some(dimensions)) = (provider.identity(), provider.dimensions()) else {
        return unavailable(VISUAL_REASON_MODEL_UNAVAILABLE);
    };
    // The document set must match what the snapshot was built with, so page sources are
    // included exactly when this transport could have produced them.
    let include_pages = provider.page_source().is_some();
    let (documents, _, _) = match collect_assets(root, include_pages) {
        Ok(collected) => collected,
        Err(_) => return unavailable(VISUAL_REASON_INDEX_MISSING),
    };
    if documents.is_empty() {
        return unavailable(VISUAL_REASON_INDEX_MISSING);
    }
    let workspace = match Workspace::open(root) {
        Ok(workspace) => workspace,
        Err(_) => return unavailable(VISUAL_REASON_INDEX_MISSING),
    };
    let namespace = visual_namespace(&identity, dimensions);
    let path = visual_index_path(&workspace.layout().cache_dir(), &namespace);
    match reopen_visual_index(&path, &identity, dimensions, &documents) {
        Ok(Some(index)) => VisualChannel {
            status: VisualChannelStatus::Ready,
            provider,
            index: Some(index),
            identity: Some(identity),
        },
        _ => unavailable(VISUAL_REASON_INDEX_MISSING),
    }
}

/// Encodes and stores every asset of the requested scope. Reads the workspace, writes
/// only the cache snapshot.
pub(super) fn prepare_visual_index(
    provider: Arc<dyn VisualEmbeddingProvider>,
    request: PrepareVisualSearchIndexRequest,
) -> Result<PrepareVisualSearchIndexResponse, String> {
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
    let include_pages = provider.page_source().is_some();
    let (documents, assets, page_requests) = collect_assets(&request.root, include_pages)?;
    if documents.is_empty() {
        return Err("资料库中没有可编码的图片资源。".to_string());
    }
    let namespace = visual_namespace(&identity, dimensions);
    let path = visual_index_path(&workspace.layout().cache_dir(), &namespace);
    let entry_count = documents
        .iter()
        .map(|document| document.entry_id.as_str())
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    // Page and region vectors come from the service that rasterizes the PDF; everything
    // else is embedded from the bytes the product stores.
    let mut precomputed = BTreeMap::new();
    if let Some(page_source) = provider.page_source() {
        for request in page_requests.values() {
            let vectors = page_source
                .embed_pdf_pages(&request.pdf_path, &request.pages, true)
                .map_err(|error| error.to_string())?;
            for item in vectors {
                let key = page_key(&documents, &request.entry_id, item.page_idx, item.region)
                    .ok_or_else(|| {
                        "视觉分页编码返回了未收集的页面或区域".to_string()
                    })?;
                precomputed.insert(key, item.vector);
            }
        }
    }
    let rebuilt = build_visual_index(
        &path,
        &identity,
        dimensions,
        &documents,
        &assets,
        &precomputed,
        provider.as_ref(),
        &|_, _| {},
    )
    .map_err(|error| {
        if cfg!(test) {
            eprintln!(
                "visual prepare: docs={} assets={} precomputed={} sample_doc={:?} sample_pre={:?}",
                documents.len(),
                assets.len(),
                precomputed.len(),
                documents.first().map(|document| document.key()),
                precomputed.keys().next()
            );
        }
        error.to_string()
    })?;
    let embedded_count = rebuilt
        .documents()
        .iter()
        .filter(|document| {
            assets.contains_key(&document.key()) || precomputed.contains_key(&document.key())
        })
        .count()
        .min(documents.len());
    Ok(PrepareVisualSearchIndexResponse {
        provider: provider.status().provider,
        model_name: provider.status().model_name,
        dimensions: Some(dimensions),
        identity,
        namespace,
        entry_count,
        asset_count: assets.len(),
        document_count: rebuilt.document_count(),
        embedded_count,
    })
}

/// Documents plus their stored bytes, keyed by the index document key.
///
/// `include_pages` adds page and region sources derived from the native PDF. Those
/// vectors are produced by a service that rasterizes the PDF, so their bytes never reach
/// the product; the document set still has to match what the snapshot was built with.
fn collect_assets(
    root: &PathBuf,
    include_pages: bool,
) -> Result<
    (
        Vec<VisualIndexDocument>,
        BTreeMap<String, Vec<u8>>,
        BTreeMap<String, PageRequest>,
    ),
    String,
> {
    let workspace = Workspace::open(root).map_err(|error| error.to_string())?;
    let collected = workspace
        .collect_entry_visual_assets(None)
        .map_err(|error| error.to_string())?;
    let mut documents = Vec::with_capacity(collected.len());
    let mut assets = BTreeMap::new();
    let mut pages = BTreeMap::new();
    for asset in collected {
        let document = document_from_asset(&asset);
        let entry_id = EntryId::from_string(asset.entry_id.clone());
        let bytes = workspace
            .entry_asset_bytes(&entry_id, &asset.relative_path)
            .map_err(|error| error.to_string())?;
        assets.insert(document.key(), bytes);
        documents.push(document);
    }
    if !include_pages {
        return Ok((documents, assets, pages));
    }
    for (entry_documents, request) in page_documents(&workspace)? {
        documents.extend(entry_documents);
        pages.insert(request.entry_id.clone(), request);
    }
    Ok((documents, assets, pages))
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
                && document.page_idx == Some(page)
                && document.region == region
        })
        .map(VisualIndexDocument::key)
}

/// Page and region sources for every parsed entry that still has its PDF.
///
/// The page list comes from the parsed segments, so it matches what the parse covered.
/// The content hash binds the source to the PDF bytes: replacing the PDF re-embeds.
fn page_documents(
    workspace: &Workspace,
) -> Result<Vec<(Vec<VisualIndexDocument>, PageRequest)>, String> {
    let entries = workspace.list_entries().map_err(|error| error.to_string())?;
    let mut collected = Vec::new();
    for entry in entries {
        let Some(pdf) = entry.pdf.as_ref() else {
            continue;
        };
        if pdf.parse.status != neuink_domain::PdfParseStatus::Succeeded {
            continue;
        }
        let pdf_path = workspace.layout().entry_pdf_file(&entry.id);
        if !pdf_path.is_file() {
            continue;
        }
        let segments = match workspace.read_segments(&entry.id) {
            Ok(segments) => segments,
            Err(_) => continue,
        };
        let mut pages = segments
            .iter()
            .map(|segment| segment.page_idx)
            .collect::<Vec<_>>();
        pages.sort_unstable();
        pages.dedup();
        if pages.is_empty() {
            continue;
        }
        let entry_id = entry.id.to_string();
        let mut documents = Vec::with_capacity(pages.len() * REGIONS_PER_PAGE);
        for page in &pages {
            documents.push(page_document(&entry_id, &pdf.content_hash, *page, None));
            for region in 0..REGION_CROPS {
                documents.push(page_document(
                    &entry_id,
                    &pdf.content_hash,
                    *page,
                    Some(region),
                ));
            }
        }
        collected.push((
            documents,
            PageRequest {
                entry_id,
                pdf_path,
                pages,
            },
        ));
    }
    Ok(collected)
}

/// Crop count per page: top, bottom, left, right, matching the measured protocol.
const REGION_CROPS: u32 = 4;
const REGIONS_PER_PAGE: usize = REGION_CROPS as usize + 1;

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
    let vector = provider.embed_query_text(question)?;
    if let Ok(mut cache) = query_cache().lock() {
        if cache.len() >= VISUAL_QUERY_CACHE_LIMIT {
            cache.clear();
        }
        cache.insert(key, vector.clone());
    }
    Ok(vector)
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
}
