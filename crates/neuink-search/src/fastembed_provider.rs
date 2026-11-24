use std::path::{Path, PathBuf};
use std::{io::Read, sync::OnceLock};

use serde::Deserialize;

use crate::{
    EmbeddingInput, EmbeddingProvider, EmbeddingProviderStatus, EmbeddingVector, SearchError,
    SearchResult,
};

pub const DEFAULT_EMBEDDING_MODEL_RESOURCE_DIR: &str = "embedding-models/default";
const DEFAULT_PROVIDER_NAME: &str = "fastembed-local";
pub const EMBEDDING_MODEL_FILE_NAMES: &[&str] = &[
    "onnx/model.onnx",
    "onnx/model_int8.onnx",
    // Xenova exports name their int8 file `model_quantized.onnx`; the recommended
    // multilingual-e5-small entry is one of them. Same lesson as the reranker.
    "onnx/model_quantized.onnx",
    "model.onnx",
];
const TOKENIZER_FILE_NAME: &str = "tokenizer.json";
const MANIFEST_FILE_NAME: &str = "neuink-embedding.json";
pub const LOCAL_EMBEDDING_BATCH_SIZE: usize = 8;

pub struct FastEmbedProvider {
    model_dir: PathBuf,
    status: EmbeddingProviderStatus,
    prefixes: crate::EmbeddingPrefixes,
    /// `None` keeps ONNX Runtime's default (all cores). Thread count changes speed
    /// only; it is not part of the content identity, so it never forces re-embedding.
    intra_threads: Option<usize>,
    cache_identity: OnceLock<Option<String>>,
    multivector_head_identity: OnceLock<Option<String>>,
    #[cfg(feature = "local-embedding")]
    backend: OnceLock<SearchResult<Backend>>,
    #[cfg(feature = "local-embedding")]
    multivector_heads: OnceLock<
        Result<
            (
                crate::colbert_head::LinearHead,
                Option<crate::colbert_head::LinearHead>,
            ),
            String,
        >,
    >,
}

impl FastEmbedProvider {
    pub fn from_model_dir(model_dir: impl Into<PathBuf>) -> Self {
        Self::build(model_dir.into(), None)
    }

    /// Caps ONNX Runtime intra-op threads, for fixed-thread cost measurement.
    /// A zero thread count is clamped to one.
    pub fn from_model_dir_with_intra_threads(
        model_dir: impl Into<PathBuf>,
        intra_threads: usize,
    ) -> Self {
        Self::build(model_dir.into(), Some(intra_threads.max(1)))
    }

    fn build(model_dir: PathBuf, intra_threads: Option<usize>) -> Self {
        let status = inspect_model_dir(&model_dir);
        let prefixes = read_manifest(&model_dir.join(MANIFEST_FILE_NAME))
            .map(|manifest| manifest.resolved_prefixes())
            .unwrap_or_else(crate::EmbeddingPrefixes::e5_default);
        Self {
            model_dir,
            status,
            prefixes,
            intra_threads,
            cache_identity: OnceLock::new(),
            multivector_head_identity: OnceLock::new(),
            #[cfg(feature = "local-embedding")]
            backend: OnceLock::new(),
            #[cfg(feature = "local-embedding")]
            multivector_heads: OnceLock::new(),
        }
    }

    pub fn intra_threads(&self) -> Option<usize> {
        self.intra_threads
    }

    pub fn model_dir(&self) -> &Path {
        &self.model_dir
    }
}

impl EmbeddingProvider for FastEmbedProvider {
    fn status(&self) -> EmbeddingProviderStatus {
        self.status.clone()
    }

    fn prefixes(&self) -> crate::EmbeddingPrefixes {
        self.prefixes.clone()
    }

    fn cache_identity(&self) -> Option<String> {
        self.cache_identity
            .get_or_init(|| model_content_identity(&self.model_dir).ok())
            .clone()
    }

    #[cfg(feature = "local-embedding")]
    fn embed(&self, inputs: &[EmbeddingInput]) -> SearchResult<Vec<EmbeddingVector>> {
        self.embed_with_progress(inputs, &|_, _| {})
    }

    fn multivector_support(&self) -> crate::colbert_head::MultivectorSupport {
        crate::colbert_head::MultivectorSupport::Local(
            crate::colbert_head::inspect_multivector_heads(&self.model_dir),
        )
    }

    fn multivector_head_identity(&self) -> Option<String> {
        self.multivector_head_identity
            .get_or_init(|| {
                let head_hash = crate::colbert_head::head_sha256(&self.model_dir);
                let base = self.cache_identity().unwrap_or_else(|| "local".to_string());
                Some(format!("{base}:{head_hash}"))
            })
            .clone()
    }

    fn encode_multivector_documents(
        &self,
        texts: &[String],
    ) -> Result<Vec<crate::multivector_index::MultivectorDocument>, String> {
        self.encode_multivector_documents_impl(texts)
    }

    #[cfg(feature = "local-embedding")]
    fn embed_with_progress(
        &self,
        inputs: &[EmbeddingInput],
        on_progress: &dyn Fn(usize, usize),
    ) -> SearchResult<Vec<EmbeddingVector>> {
        if !self.status.available {
            return Err(SearchError::EmbeddingUnavailable(
                self.status
                    .message
                    .clone()
                    .unwrap_or_else(|| "Embedding model resources are unavailable.".to_string()),
            ));
        }

        let backend = match self
            .backend
            .get_or_init(|| load_backend(&self.model_dir, self.intra_threads))
        {
            Ok(backend) => backend,
            Err(error) => return Err(clone_search_error(error)),
        };
        if inputs.is_empty() {
            on_progress(0, 0);
            return Ok(Vec::new());
        }

        // Group inputs of similar length into the same batch so short passages
        // do not pay O(L^2) self-attention padding up to 512 tokens because one
        // long paragraph happened to sit beside them, then restore input order.
        let order = order_indices_by_length(inputs);
        let mut ordered_vectors: Vec<Option<EmbeddingVector>> = vec![None; inputs.len()];
        let mut completed = 0_usize;
        for batch_indices in order.chunks(LOCAL_EMBEDDING_BATCH_SIZE) {
            let texts = batch_indices
                .iter()
                .map(|&index| inputs[index].text.clone())
                .collect::<Vec<_>>();
            let batch_vectors = match backend {
                Backend::Path(engine) => engine
                    .embed(&texts)
                    .map_err(SearchError::EmbeddingUnavailable)?,
            };
            if batch_vectors.len() != batch_indices.len() {
                return Err(SearchError::EmbeddingUnavailable(format!(
                    "Embedding backend returned {} vectors for {} inputs.",
                    batch_vectors.len(),
                    batch_indices.len()
                )));
            }
            for (&original_index, vector) in batch_indices.iter().zip(batch_vectors) {
                // The manifest is the contract. A directory holding both an old and a new
                // weight file used to load the wrong one and silently change every vector,
                // so a mismatch is an error rather than a quietly different result.
                if let Some(declared) = self.status.dimensions {
                    if vector.len() != declared {
                        return Err(SearchError::EmbeddingUnavailable(format!(
                            "Embedding manifest declares {declared} dimensions but the loaded ONNX produced {}; remove stale weight files from {}",
                            vector.len(),
                            self.model_dir.display()
                        )));
                    }
                }
                ordered_vectors[original_index] = Some(EmbeddingVector::new(vector));
            }
            completed += batch_indices.len();
            on_progress(completed, inputs.len());
        }
        Ok(ordered_vectors
            .into_iter()
            .map(|vector| vector.expect("every input index must be populated"))
            .collect())
    }

    #[cfg(not(feature = "local-embedding"))]
    fn embed(&self, _inputs: &[EmbeddingInput]) -> SearchResult<Vec<EmbeddingVector>> {
        Err(SearchError::EmbeddingUnavailable(
            self.status.message.clone().unwrap_or_else(|| {
                "Local embedding support is not enabled in this build.".to_string()
            }),
        ))
    }
}

// Hash once per immutable provider instance, streaming weights instead of
// retaining another model-sized byte buffer. Relative paths make relocation
// harmless; only inference inputs are hashed, so documentation changes do not
// force an unnecessary vector rebuild.
fn model_content_identity(model_dir: &Path) -> std::io::Result<String> {
    let mut files = EMBEDDING_MODEL_FILE_NAMES
        .iter()
        .map(|relative| model_dir.join(relative))
        .chain([
            model_dir.join(TOKENIZER_FILE_NAME),
            model_dir.join("config.json"),
            model_dir.join("special_tokens_map.json"),
            model_dir.join("tokenizer_config.json"),
            model_dir.join("sentencepiece.bpe.model"),
            model_dir.join(MANIFEST_FILE_NAME),
        ])
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();
    files.sort();
    if first_existing_file(model_dir, EMBEDDING_MODEL_FILE_NAMES).is_none()
        || !model_dir.join(TOKENIZER_FILE_NAME).is_file()
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Missing model inputs",
        ));
    }
    let mut hasher = blake3::Hasher::new();
    // Pooling and text prefixes belong to the identity: changing either produces
    // incompatible vectors, so a manifest change must invalidate cached embeddings.
    let manifest = read_manifest(&model_dir.join(MANIFEST_FILE_NAME));
    let pooling = manifest
        .as_ref()
        .and_then(|manifest| manifest.pooling_tag())
        .unwrap_or("mean");
    let prefixes = manifest
        .as_ref()
        .map(EmbeddingManifest::resolved_prefixes)
        .unwrap_or_else(crate::EmbeddingPrefixes::e5_default);
    hasher.update(format!("neuink-fastembed-pooling-v2:{pooling}").as_bytes());
    hasher.update(
        format!(
            "neuink-fastembed-prefixes-v1:{}:{}",
            prefixes.query, prefixes.passage
        )
        .as_bytes(),
    );
    let mut buffer = [0_u8; 64 * 1024];
    for path in files {
        let relative = path
            .strip_prefix(model_dir)
            .map_err(std::io::Error::other)?;
        let relative = relative.to_string_lossy().replace('\\', "/");
        hasher.update(&(relative.len() as u64).to_le_bytes());
        hasher.update(relative.as_bytes());
        let mut file = std::fs::File::open(&path)?;
        hasher.update(&file.metadata()?.len().to_le_bytes());
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
    }
    Ok(hasher.finalize().to_hex().to_string())
}

/// Orders input indices by ascending byte length so each batch groups passages
/// of similar token length, minimizing O(L^2) self-attention padding waste.
#[cfg(any(feature = "local-embedding", test))]
fn order_indices_by_length(inputs: &[EmbeddingInput]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..inputs.len()).collect();
    if order.len() > LOCAL_EMBEDDING_BATCH_SIZE {
        order.sort_by_key(|&index| inputs[index].text.len());
    }
    order
}

/// ONNX backend for local embedding models.
///
/// Both single-file exports (`model_int8.onnx`, `model_quantized.onnx`) and
/// external-data exports (`model.onnx` + `model.onnx_data`) load straight from
/// the file path via [`crate::path_embedding::PathEmbeddingEngine`], avoiding
/// loading hundreds of megabytes into an intermediate Rust `Vec<u8>` buffer
/// and giving direct control over ONNX Runtime graph optimization and threads.
#[cfg(feature = "local-embedding")]
pub enum Backend {
    Path(crate::path_embedding::PathEmbeddingEngine),
}

#[cfg(feature = "local-embedding")]
fn load_backend(model_dir: &Path, intra_threads: Option<usize>) -> SearchResult<Backend> {
    let model_file = first_existing_file(model_dir, EMBEDDING_MODEL_FILE_NAMES).ok_or_else(|| {
        SearchError::EmbeddingUnavailable(
            "Embedding ONNX model is missing; expected onnx/model.onnx, onnx/model_int8.onnx, onnx/model_quantized.onnx or model.onnx.".to_string(),
        )
    })?;
    let manifest = read_manifest(&model_dir.join(MANIFEST_FILE_NAME));
    let pooling = match manifest.as_ref() {
        Some(manifest) => match manifest.pooling_tag() {
            Some(tag) => crate::path_embedding::PoolKind::from_manifest(Some(tag)),
            None => {
                return Err(SearchError::EmbeddingUnavailable(
                    "Embedding manifest names an unsupported pooling; use mean or cls.".to_string(),
                ));
            }
        },
        None => crate::path_embedding::PoolKind::from_manifest(None),
    };
    let dimensions = manifest.as_ref().and_then(|manifest| manifest.dimensions);
    let engine = crate::path_embedding::PathEmbeddingEngine::load(
        model_dir,
        &model_file,
        pooling,
        dimensions,
        intra_threads,
    )
    .map_err(SearchError::EmbeddingUnavailable)?;
    Ok(Backend::Path(engine))
}

#[cfg(feature = "local-embedding")]
impl FastEmbedProvider {
    fn encode_multivector_documents_impl(
        &self,
        texts: &[String],
    ) -> Result<Vec<crate::multivector_index::MultivectorDocument>, String> {
        let backend = self
            .backend
            .get_or_init(|| load_backend(&self.model_dir, self.intra_threads));
        let Backend::Path(engine) = backend.as_ref().map_err(|error| error.to_string())?;
        let states = engine.encode_token_states(texts)?;
        let (colbert, sparse) = self
            .multivector_heads
            .get_or_init(|| {
                let colbert = crate::colbert_head::load_colbert(&self.model_dir)?;
                let sparse = crate::colbert_head::load_sparse(&self.model_dir).ok();
                Ok((colbert, sparse))
            })
            .as_ref()
            .map_err(Clone::clone)?;
        states
            .into_iter()
            .map(|state| {
                let lexical = match sparse {
                    Some(head) => crate::colbert_head::lexical_weights(
                        head,
                        &state.hidden_tokens,
                        &state.token_ids,
                        state.valid_len,
                    )?,
                    None => Vec::new(),
                };
                Ok(crate::multivector_index::MultivectorDocument {
                    identity: String::new(),
                    dense: state.dense,
                    lexical,
                    colbert: crate::colbert_head::project_colbert(
                        colbert,
                        &state.hidden_tokens,
                        state.valid_len,
                    )?,
                })
            })
            .collect()
    }
}

#[cfg(not(feature = "local-embedding"))]
impl FastEmbedProvider {
    fn encode_multivector_documents_impl(
        &self,
        _texts: &[String],
    ) -> Result<Vec<crate::multivector_index::MultivectorDocument>, String> {
        Err("provider_unsupported".to_string())
    }
}

#[cfg(feature = "local-embedding")]
fn clone_search_error(error: &SearchError) -> SearchError {
    match error {
        SearchError::EmptyQuery => SearchError::EmptyQuery,
        SearchError::SemanticUnavailable => SearchError::SemanticUnavailable,
        SearchError::EmbeddingUnavailable(message) => {
            SearchError::EmbeddingUnavailable(message.clone())
        }
        SearchError::VectorStoreUnavailable(message) => {
            SearchError::VectorStoreUnavailable(message.clone())
        }
        SearchError::VectorIndexIo(message) => SearchError::VectorIndexIo(message.clone()),
        SearchError::VectorDimensionMismatch { expected, actual } => {
            SearchError::VectorDimensionMismatch {
                expected: *expected,
                actual: *actual,
            }
        }
        SearchError::LockPoisoned => SearchError::LockPoisoned,
    }
}

fn inspect_model_dir(model_dir: &Path) -> EmbeddingProviderStatus {
    let manifest = read_manifest(&model_dir.join(MANIFEST_FILE_NAME));
    let model_name = manifest
        .as_ref()
        .and_then(|manifest| manifest.model_name.clone())
        .or_else(|| Some("bundled-default".to_string()));
    let dimensions = manifest.as_ref().and_then(|manifest| manifest.dimensions);
    let model_path = first_existing_file(model_dir, EMBEDDING_MODEL_FILE_NAMES);
    let tokenizer_path = model_dir.join(TOKENIZER_FILE_NAME);
    let provider = manifest
        .as_ref()
        .and_then(|manifest| manifest.provider.clone())
        .unwrap_or_else(|| DEFAULT_PROVIDER_NAME.to_string());

    if !model_dir.exists() {
        return unavailable(
            provider,
            model_name,
            Some(model_dir.display().to_string()),
            dimensions,
            "Embedding model directory is not bundled.",
        );
    }

    if !model_dir.is_dir() {
        return unavailable(
            provider,
            model_name,
            Some(model_dir.display().to_string()),
            dimensions,
            "Embedding model path exists but is not a directory.",
        );
    }

    let Some(model_path) = model_path else {
        return unavailable(
            provider,
            model_name,
            Some(model_dir.display().to_string()),
            dimensions,
            "Embedding ONNX model is missing; expected onnx/model.onnx, onnx/model_int8.onnx, onnx/model_quantized.onnx or model.onnx.",
        );
    };

    if !tokenizer_path.is_file() {
        return unavailable(
            provider,
            model_name,
            Some(model_dir.display().to_string()),
            dimensions,
            "Embedding tokenizer.json is missing.",
        );
    }

    EmbeddingProviderStatus {
        available: cfg!(feature = "local-embedding"),
        provider,
        model_name,
        model_path: Some(model_path.display().to_string()),
        dimensions,
        message: Some(if cfg!(feature = "local-embedding") {
            "Local embedding model resources are present.".to_string()
        } else {
            "Local embedding support is not enabled in this build.".to_string()
        }),
    }
}

fn first_existing_file(base_dir: &Path, relative_paths: &[&str]) -> Option<PathBuf> {
    relative_paths
        .iter()
        .map(|relative_path| base_dir.join(relative_path))
        .find(|path| path.is_file())
}

fn unavailable(
    provider: String,
    model_name: Option<String>,
    model_path: Option<String>,
    dimensions: Option<usize>,
    message: &str,
) -> EmbeddingProviderStatus {
    EmbeddingProviderStatus {
        available: false,
        provider,
        model_name,
        model_path,
        dimensions,
        message: Some(message.to_string()),
    }
}

fn read_manifest(path: &Path) -> Option<EmbeddingManifest> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[derive(Debug, Deserialize)]
struct EmbeddingManifest {
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    model_name: Option<String>,
    #[serde(default)]
    dimensions: Option<usize>,
    /// `mean` (default, e5 family) or `cls` (bge-m3 family). Pooling belongs to the model
    /// identity: mean-pooling a CLS model silently produces near-useless vectors, so the
    /// manifest declares it instead of the code assuming one kind.
    #[serde(default)]
    pooling: Option<String>,
    #[serde(default)]
    query_prefix: Option<String>,
    #[serde(default)]
    passage_prefix: Option<String>,
}

impl EmbeddingManifest {
    /// Normalised pooling tag, or `None` when the manifest names an unsupported one.
    fn pooling_tag(&self) -> Option<&'static str> {
        match self.pooling.as_deref().map(str::to_ascii_lowercase) {
            None => Some("mean"),
            Some(value) if value == "mean" => Some("mean"),
            Some(value) if value == "cls" => Some("cls"),
            Some(_) => None,
        }
    }

    fn resolved_prefixes(&self) -> crate::EmbeddingPrefixes {
        if self.query_prefix.is_some() || self.passage_prefix.is_some() {
            return crate::EmbeddingPrefixes {
                query: self.query_prefix.clone().unwrap_or_default(),
                passage: self.passage_prefix.clone().unwrap_or_default(),
            };
        }
        let lower = self
            .model_name
            .as_deref()
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();
        if lower.contains("bge-m3")
            || lower.contains("qwen3-embedding")
            || (lower.contains("bge-") && self.pooling_tag() == Some("cls"))
        {
            crate::EmbeddingPrefixes::none()
        } else {
            crate::EmbeddingPrefixes::e5_default()
        }
    }
}

#[cfg(test)]
mod quantized_model_file_tests {
    use super::*;

    /// Xenova's int8 export is named `onnx/model_quantized.onnx`; a loader whitelist that
    /// misses it rejects a fully downloaded recommended model, so this pins the name.
    #[test]
    fn accepts_a_quantized_onnx_export_name() {
        let dir =
            std::env::temp_dir().join(format!("neuink-quantized-model-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("onnx")).unwrap();
        std::fs::write(dir.join("onnx/model_quantized.onnx"), b"placeholder").unwrap();
        std::fs::write(dir.join(TOKENIZER_FILE_NAME), b"placeholder").unwrap();

        let status = inspect_model_dir(&dir);
        assert!(
            status.model_path.is_some(),
            "onnx/model_quantized.onnx must be accepted as the model file"
        );
        assert!(!status
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("ONNX model is missing"));

        std::fs::remove_dir_all(&dir).ok();
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, time::SystemTime};

    use super::*;

    #[test]
    fn local_embedding_batch_stays_memory_bounded() {
        assert_eq!(LOCAL_EMBEDDING_BATCH_SIZE, 8);
    }

    #[test]
    fn reports_missing_model_dir() {
        let dir = std::env::temp_dir().join(unique_name("neuink-missing-model"));
        let provider = FastEmbedProvider::from_model_dir(&dir);

        let status = provider.status();

        assert!(!status.available);
        assert_eq!(
            status.message.as_deref(),
            Some("Embedding model directory is not bundled.")
        );
    }

    #[test]
    fn reports_available_when_required_files_exist() {
        let dir = std::env::temp_dir().join(unique_name("neuink-embedding-model"));
        fs::create_dir_all(&dir).unwrap();
        fs::create_dir_all(dir.join("onnx")).unwrap();
        fs::write(dir.join("onnx").join("model.onnx"), b"placeholder").unwrap();
        fs::write(dir.join(TOKENIZER_FILE_NAME), b"placeholder").unwrap();
        fs::write(
            dir.join(MANIFEST_FILE_NAME),
            br#"{"provider":"fastembed-local","model_name":"test-model","dimensions":384}"#,
        )
        .unwrap();

        let provider = FastEmbedProvider::from_model_dir(&dir);
        let status = provider.status();

        assert_eq!(status.available, cfg!(feature = "local-embedding"));
        assert_eq!(status.model_name.as_deref(), Some("test-model"));
        assert_eq!(status.dimensions, Some(384));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    #[cfg(feature = "local-embedding")]
    fn embeds_with_bundled_model_when_present() {
        let model_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src-tauri/resources/embedding-models/default");
        // The bundled model is replaceable (e5-small 384, bge-m3 1024), so this test looks
        // for any accepted file name and follows the manifest instead of pinning one model.
        if first_existing_file(&model_dir, EMBEDDING_MODEL_FILE_NAMES).is_none() {
            return;
        }
        let declared = read_manifest(&model_dir.join(MANIFEST_FILE_NAME))
            .and_then(|manifest| manifest.dimensions)
            .expect("the bundled manifest must declare dimensions");

        let provider = FastEmbedProvider::from_model_dir(model_dir);
        let vectors = provider
            .embed(&[EmbeddingInput {
                id: "probe".to_string(),
                text: "query: software engineering experiment".to_string(),
            }])
            .unwrap();

        assert_eq!(vectors.len(), 1);
        assert_eq!(vectors[0].dimensions(), declared);
    }

    #[test]
    fn identity_follows_model_and_tokenizer_contents_instead_of_absolute_path() {
        let first_dir = std::env::temp_dir().join(unique_name("neuink-identity-a"));
        let second_dir = std::env::temp_dir().join(unique_name("neuink-identity-b"));
        for dir in [&first_dir, &second_dir] {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join("model.onnx"), b"weights-A").unwrap();
            fs::write(dir.join(TOKENIZER_FILE_NAME), b"tokenizer-A").unwrap();
            fs::write(dir.join(MANIFEST_FILE_NAME), br#"{"dimensions":2}"#).unwrap();
        }
        let original = FastEmbedProvider::from_model_dir(&first_dir)
            .cache_identity()
            .unwrap();
        assert_eq!(
            original,
            FastEmbedProvider::from_model_dir(&second_dir)
                .cache_identity()
                .unwrap()
        );
        fs::write(first_dir.join("model.onnx"), b"weights-B").unwrap();
        let changed_weights = FastEmbedProvider::from_model_dir(&first_dir)
            .cache_identity()
            .unwrap();
        assert_ne!(original, changed_weights);
        fs::write(first_dir.join(TOKENIZER_FILE_NAME), b"tokenizer-B").unwrap();
        assert_ne!(
            changed_weights,
            FastEmbedProvider::from_model_dir(&first_dir)
                .cache_identity()
                .unwrap()
        );
        fs::remove_dir_all(first_dir).unwrap();
        fs::remove_dir_all(second_dir).unwrap();
    }

    #[test]
    fn intra_thread_cap_is_optional_and_never_changes_content_identity() {
        let dir = std::env::temp_dir().join(unique_name("neuink-threads"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("model.onnx"), b"weights").unwrap();
        fs::write(dir.join(TOKENIZER_FILE_NAME), b"tokenizer").unwrap();
        fs::write(dir.join(MANIFEST_FILE_NAME), br#"{"dimensions":2}"#).unwrap();

        let default = FastEmbedProvider::from_model_dir(&dir);
        let capped = FastEmbedProvider::from_model_dir_with_intra_threads(&dir, 4);
        let clamped = FastEmbedProvider::from_model_dir_with_intra_threads(&dir, 0);
        assert_eq!(default.intra_threads(), None);
        assert_eq!(capped.intra_threads(), Some(4));
        assert_eq!(clamped.intra_threads(), Some(1));
        assert_eq!(default.cache_identity(), capped.cache_identity());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn manifest_resolves_bge_m3_unprefixed_and_e5_prefixed_with_distinct_identities() {
        let bge_dir = std::env::temp_dir().join(unique_name("neuink-prefix-bge"));
        let e5_dir = std::env::temp_dir().join(unique_name("neuink-prefix-e5"));
        for dir in [&bge_dir, &e5_dir] {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join("model.onnx"), b"weights").unwrap();
            fs::write(dir.join(TOKENIZER_FILE_NAME), b"tokenizer").unwrap();
        }
        fs::write(
            bge_dir.join(MANIFEST_FILE_NAME),
            br#"{"model_name":"BAAI/bge-m3","dimensions":1024,"pooling":"cls"}"#,
        )
        .unwrap();
        fs::write(
            e5_dir.join(MANIFEST_FILE_NAME),
            br#"{"model_name":"Xenova/multilingual-e5-small","dimensions":384,"pooling":"mean"}"#,
        )
        .unwrap();

        let bge = FastEmbedProvider::from_model_dir(&bge_dir);
        let e5 = FastEmbedProvider::from_model_dir(&e5_dir);
        assert_eq!(bge.prefixes(), crate::EmbeddingPrefixes::none());
        assert_eq!(e5.prefixes(), crate::EmbeddingPrefixes::e5_default());

        let original_id = bge.cache_identity().unwrap();
        fs::write(
            bge_dir.join(MANIFEST_FILE_NAME),
            br#"{"model_name":"BAAI/bge-m3","dimensions":1024,"pooling":"cls","query_prefix":"Instruct: " ,"passage_prefix":""}"#,
        )
        .unwrap();
        let custom = FastEmbedProvider::from_model_dir(&bge_dir);
        assert_eq!(custom.prefixes().query, "Instruct: ");
        assert_eq!(custom.prefixes().passage, "");
        assert_ne!(original_id, custom.cache_identity().unwrap());

        fs::remove_dir_all(bge_dir).unwrap();
        fs::remove_dir_all(e5_dir).unwrap();
    }

    #[test]
    fn length_sorted_ordering_groups_similar_lengths_when_above_batch_size() {
        let inputs = (0..10)
            .map(|index| EmbeddingInput {
                id: format!("id-{index}"),
                text: "a".repeat(if index % 2 == 0 { 400 - index * 10 } else { 10 + index }),
            })
            .collect::<Vec<_>>();
        let order = order_indices_by_length(&inputs);
        assert_eq!(order.len(), inputs.len());
        for pair in order.windows(2) {
            assert!(inputs[pair[0]].text.len() <= inputs[pair[1]].text.len());
        }
        let mut sorted_ids = order.clone();
        sorted_ids.sort_unstable();
        assert_eq!(sorted_ids, (0..10).collect::<Vec<_>>());
    }

    #[test]
    #[cfg(feature = "local-embedding")]
    fn path_engine_matches_fastembed_and_length_sorted_batching_preserves_order() {
        let model_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src-tauri/resources/embedding-models/default");
        let Some(model_file) = first_existing_file(&model_dir, EMBEDDING_MODEL_FILE_NAMES) else {
            return;
        };
        let manifest = read_manifest(&model_dir.join(MANIFEST_FILE_NAME));
        let pooling = match manifest.as_ref().and_then(EmbeddingManifest::pooling_tag) {
            Some("cls") => fastembed::Pooling::Cls,
            _ => fastembed::Pooling::Mean,
        };
        let samples = vec![
            "Short title",
            "Transformer attention weights across multiple scientific paper sections and ablations in long-context retrieval experiments.",
            "中文科研论文检索测试：对比单文件 ONNX 路径加载与 fastembed 的向量余弦相似度。",
            "A",
            "BGE-M3 dense vector parity check.",
            "Another short note",
            "Evaluating multi-hop reasoning across heterogeneous academic corpora with section-aware soft demotion.",
            "Table 3: Accuracy breakdown.",
            "Figure 2 shows recall@5 improvements over BM25 baseline.",
            "Tiny",
        ];

        let cosine = |a: &[f32], b: &[f32]| -> f32 {
            let na = a.iter().map(|v| v * v).sum::<f32>().sqrt();
            let nb = b.iter().map(|v| v * v).sum::<f32>().sqrt();
            a.iter()
                .zip(b)
                .map(|(x, y)| (x / na) * (y / nb))
                .sum::<f32>()
        };

        let provider = FastEmbedProvider::from_model_dir(&model_dir);
        let inputs: Vec<EmbeddingInput> = samples
            .iter()
            .enumerate()
            .map(|(idx, text)| EmbeddingInput {
                id: format!("s-{idx}"),
                text: (*text).to_string(),
            })
            .collect();
        let batched_vectors = provider.embed(&inputs).unwrap();
        assert_eq!(batched_vectors.len(), samples.len());

        let single_vectors: Vec<Vec<f32>> = samples
            .iter()
            .enumerate()
            .map(|(idx, sample)| {
                provider
                    .embed(&[EmbeddingInput {
                        id: format!("single-{idx}"),
                        text: (*sample).to_string(),
                    }])
                    .unwrap()
                    .pop()
                    .unwrap()
                    .values
            })
            .collect();

        // Compare against legacy fastembed SingleFile loader (both batch=1 and batch=8).
        let tokenizer_files = fastembed::TokenizerFiles {
            tokenizer_file: fs::read(model_dir.join(TOKENIZER_FILE_NAME)).unwrap(),
            config_file: fs::read(model_dir.join("config.json")).unwrap(),
            special_tokens_map_file: fs::read(model_dir.join("special_tokens_map.json")).unwrap(),
            tokenizer_config_file: fs::read(model_dir.join("tokenizer_config.json")).unwrap(),
        };
        let user_model =
            fastembed::UserDefinedEmbeddingModel::new(fs::read(&model_file).unwrap(), tokenizer_files)
                .with_pooling(pooling);
        let mut legacy = fastembed::TextEmbedding::try_new_from_user_defined(
            user_model,
            fastembed::InitOptionsUserDefined::default(),
        )
        .unwrap();
        let legacy_singles: Vec<Vec<f32>> = samples
            .iter()
            .take(4)
            .map(|s| legacy.embed(vec![*s], Some(1)).unwrap().pop().unwrap())
            .collect();

        for idx in 0..4 {
            let c_path_vs_legacy_b1 = cosine(&single_vectors[idx], &legacy_singles[idx]);
            let c_path_b8_vs_b1 = cosine(&batched_vectors[idx].values, &single_vectors[idx]);
            assert!(
                c_path_vs_legacy_b1 > 0.9999,
                "PathEmbeddingEngine(b1) diverged from fastembed(b1) at idx={idx}: cos={c_path_vs_legacy_b1}"
            );
            // Dynamic INT8 ONNX quantizes activations per batch tensor, so batch=8 vs batch=1
            // naturally sits around ~0.97-0.99 (same as legacy fastembed). Checking > 0.95
            // guarantees length-sorted batching restored the exact original input order.
            assert!(
                c_path_b8_vs_b1 > 0.95,
                "length-sorted batching order mismatch at idx={idx}: cos={c_path_b8_vs_b1}"
            );
        }
    }

    fn unique_name(prefix: &str) -> String {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("{prefix}-{nanos}")
    }
}
