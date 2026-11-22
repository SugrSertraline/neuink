use serde::{Deserialize, Serialize};

use crate::colbert_head::MultivectorSupport;
use crate::multivector_index::MultivectorDocument;
use crate::SearchResult;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmbeddingInput {
    pub id: String,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EmbeddingVector {
    pub values: Vec<f32>,
}

impl EmbeddingVector {
    pub fn new(values: Vec<f32>) -> Self {
        Self { values }
    }

    pub fn dimensions(&self) -> usize {
        self.values.len()
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct EmbeddingProviderStatus {
    pub available: bool,
    pub provider: String,
    #[serde(default)]
    pub model_name: Option<String>,
    #[serde(default)]
    pub model_path: Option<String>,
    #[serde(default)]
    pub dimensions: Option<usize>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmbeddingPrefixes {
    pub query: String,
    pub passage: String,
}

impl EmbeddingPrefixes {
    pub fn e5_default() -> Self {
        Self {
            query: "query: ".to_string(),
            passage: "passage: ".to_string(),
        }
    }

    pub fn none() -> Self {
        Self {
            query: String::new(),
            passage: String::new(),
        }
    }
}

impl Default for EmbeddingPrefixes {
    fn default() -> Self {
        Self::e5_default()
    }
}

pub trait EmbeddingProvider: Send + Sync {
    fn status(&self) -> EmbeddingProviderStatus;

    /// An identity derived from immutable model contents and tokenizer/config.
    /// Returning `None` opts out of persistent vector reuse. A filesystem path
    /// or a display model name alone is insufficient to identify model weights.
    fn cache_identity(&self) -> Option<String> {
        None
    }

    /// Model-specific prefixes prepended to queries and passages before embedding.
    /// Defaults to E5 (`query: ` / `passage: `) so legacy/unannotated E5 models and
    /// tests preserve existing behaviour while BGE-M3 and OpenAI-style models can opt out.
    fn prefixes(&self) -> EmbeddingPrefixes {
        EmbeddingPrefixes::e5_default()
    }

    fn embed(&self, inputs: &[EmbeddingInput]) -> SearchResult<Vec<EmbeddingVector>>;

    fn embed_with_progress(
        &self,
        inputs: &[EmbeddingInput],
        on_progress: &dyn Fn(usize, usize),
    ) -> SearchResult<Vec<EmbeddingVector>> {
        let vectors = self.embed(inputs)?;
        on_progress(inputs.len(), inputs.len());
        Ok(vectors)
    }

    /// Local BGE-M3 heads, or unsupported for every other transport.
    fn multivector_support(&self) -> MultivectorSupport {
        MultivectorSupport::Unsupported
    }

    /// Content identity covering both model weights and multi-vector projection heads.
    fn multivector_head_identity(&self) -> Option<String> {
        self.cache_identity()
    }

    /// Token-level vectors. Non-local providers fail closed.
    fn encode_multivector_documents(&self, texts: &[String]) -> Result<Vec<MultivectorDocument>, String> {
        let _ = texts;
        Err("provider_unsupported".to_string())
    }
}
