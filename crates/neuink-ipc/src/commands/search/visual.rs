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
    let documents = match collect_assets(root, include_pages) {
        Ok(collected) => collected.documents,
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
    // Bytes are read only here: the query path never touches the ZIP.
    let mut asset_bytes = BTreeMap::new();
    for (entry_id, relative_path, key) in &asset_coordinates {
        let bytes = workspace
            .entry_asset_bytes(entry_id, relative_path)
            .map_err(|error| error.to_string())?;
        asset_bytes.insert(key.clone(), bytes);
    }
    // Page and region vectors come from the service that rasterizes the PDF; everything
    // else is embedded from the bytes read out of the stored ZIP.
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
        &asset_bytes,
        &precomputed,
        provider.as_ref(),
        &|_, _| {},
    )
    .map_err(|error| {
        if cfg!(test) {
            eprintln!(
                "visual prepare: docs={} assets={} precomputed={} sample_doc={:?} sample_pre={:?}",
                documents.len(),
                asset_bytes.len(),
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
            asset_bytes.contains_key(&document.key()) || precomputed.contains_key(&document.key())
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
        asset_count: asset_bytes.len(),
        document_count: rebuilt.document_count(),
        embedded_count,
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
    let entries = workspace.list_entries().map_err(|error| error.to_string())?;
    let mut hasher = blake3::Hasher::new();
    let mut ordered = entries
        .iter()
        .map(|entry| (entry.id.to_string(), entry.pdf.as_ref().map(|pdf| pdf.content_hash.clone())))
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
    let entries = workspace.list_entries().map_err(|error| error.to_string())?;
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
            let mut pages = segments
                .iter()
                .map(|segment| segment.page_idx)
                .collect::<Vec<_>>();
            pages.sort_unstable();
            pages.dedup();
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
                documents.push(page_document(&entry.entry_id, pdf_hash, *page, Some(region)));
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
                && document.page_idx == Some(page)
                && document.region == region
        })
        .map(VisualIndexDocument::key)
}

/// Crop count per page: top, bottom, left, right, matching the measured protocol.
const REGION_CROPS: u32 = 4;

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
            .write_mineru_output_zip(&entry.id, &zip_with_images(&["images/a.jpg", "images/b.jpg"]))
            .expect("rewrite zip");
        let after = collect_assets(&root, false).expect("collect after change");
        assert_eq!(after.documents.len(), 2);
        assert_eq!(after.assets.len(), 2);
        std::fs::remove_dir_all(&root).ok();
    }
}
