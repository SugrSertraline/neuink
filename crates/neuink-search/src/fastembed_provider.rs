use std::path::{Path, PathBuf};
#[cfg(feature = "local-embedding")]
use std::sync::{Mutex, OnceLock};

#[cfg(feature = "local-embedding")]
use fastembed::{
    InitOptionsUserDefined, Pooling, TextEmbedding, TokenizerFiles, UserDefinedEmbeddingModel,
};
use serde::Deserialize;

use crate::{
    EmbeddingInput, EmbeddingProvider, EmbeddingProviderStatus, EmbeddingVector, SearchError,
    SearchResult,
};

pub const DEFAULT_EMBEDDING_MODEL_RESOURCE_DIR: &str = "embedding-models/default";
const DEFAULT_PROVIDER_NAME: &str = "fastembed-local";
const MODEL_FILE_NAMES: &[&str] = &["onnx/model.onnx", "model.onnx"];
const TOKENIZER_FILE_NAME: &str = "tokenizer.json";
const MANIFEST_FILE_NAME: &str = "neuink-embedding.json";
pub const LOCAL_EMBEDDING_BATCH_SIZE: usize = 8;

pub struct FastEmbedProvider {
    model_dir: PathBuf,
    status: EmbeddingProviderStatus,
    #[cfg(feature = "local-embedding")]
    model: OnceLock<SearchResult<Mutex<TextEmbedding>>>,
}

impl FastEmbedProvider {
    pub fn from_model_dir(model_dir: impl Into<PathBuf>) -> Self {
        let model_dir = model_dir.into();
        let status = inspect_model_dir(&model_dir);
        Self {
            model_dir,
            status,
            #[cfg(feature = "local-embedding")]
            model: OnceLock::new(),
        }
    }

    pub fn model_dir(&self) -> &Path {
        &self.model_dir
    }
}

impl EmbeddingProvider for FastEmbedProvider {
    fn status(&self) -> EmbeddingProviderStatus {
        self.status.clone()
    }

    #[cfg(feature = "local-embedding")]
    fn embed(&self, inputs: &[EmbeddingInput]) -> SearchResult<Vec<EmbeddingVector>> {
        self.embed_with_progress(inputs, &|_, _| {})
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

        let model = match self
            .model
            .get_or_init(|| load_text_embedding(&self.model_dir))
        {
            Ok(model) => model,
            Err(error) => return Err(clone_search_error(error)),
        };
        let mut model = model.lock().map_err(|_| SearchError::LockPoisoned)?;
        let mut vectors = Vec::with_capacity(inputs.len());
        for batch in inputs.chunks(LOCAL_EMBEDDING_BATCH_SIZE) {
            let texts = batch
                .iter()
                .map(|input| input.text.as_str())
                .collect::<Vec<_>>();
            let batch_vectors = model
                .embed(texts, Some(LOCAL_EMBEDDING_BATCH_SIZE))
                .map_err(|error| SearchError::EmbeddingUnavailable(error.to_string()))?;
            vectors.extend(batch_vectors.into_iter().map(EmbeddingVector::new));
            on_progress(vectors.len(), inputs.len());
        }
        if inputs.is_empty() {
            on_progress(0, 0);
        }
        Ok(vectors)
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

#[cfg(feature = "local-embedding")]
fn load_text_embedding(model_dir: &Path) -> SearchResult<Mutex<TextEmbedding>> {
    let model_file = first_existing_file(model_dir, MODEL_FILE_NAMES).ok_or_else(|| {
        SearchError::EmbeddingUnavailable(
            "Embedding ONNX model is missing; expected onnx/model.onnx or model.onnx.".to_string(),
        )
    })?;
    let tokenizer_files = TokenizerFiles {
        tokenizer_file: read_required_file(&model_dir.join(TOKENIZER_FILE_NAME))?,
        config_file: read_required_file(&model_dir.join("config.json"))?,
        special_tokens_map_file: read_required_file(&model_dir.join("special_tokens_map.json"))?,
        tokenizer_config_file: read_required_file(&model_dir.join("tokenizer_config.json"))?,
    };
    let user_model =
        UserDefinedEmbeddingModel::new(read_required_file(&model_file)?, tokenizer_files)
            .with_pooling(Pooling::Mean);
    TextEmbedding::try_new_from_user_defined(user_model, InitOptionsUserDefined::default())
        .map(Mutex::new)
        .map_err(|error| SearchError::EmbeddingUnavailable(error.to_string()))
}

#[cfg(feature = "local-embedding")]
fn read_required_file(path: &Path) -> SearchResult<Vec<u8>> {
    std::fs::read(path).map_err(|error| {
        SearchError::EmbeddingUnavailable(format!(
            "Failed to read embedding model file {}: {error}",
            path.display()
        ))
    })
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
    let model_path = first_existing_file(model_dir, MODEL_FILE_NAMES);
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
            "Embedding ONNX model is missing; expected onnx/model.onnx or model.onnx.",
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
    fn embeds_with_bundled_model_when_present() {
        let model_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src-tauri/resources/embedding-models/default");
        if !model_dir.join("onnx").join("model.onnx").is_file() {
            return;
        }

        let provider = FastEmbedProvider::from_model_dir(model_dir);
        let vectors = provider
            .embed(&[EmbeddingInput {
                id: "probe".to_string(),
                text: "query: software engineering experiment".to_string(),
            }])
            .unwrap();

        assert_eq!(vectors.len(), 1);
        assert_eq!(vectors[0].dimensions(), 384);
    }

    fn unique_name(prefix: &str) -> String {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("{prefix}-{nanos}")
    }
}
