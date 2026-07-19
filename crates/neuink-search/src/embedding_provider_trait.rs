use serde::{Deserialize, Serialize};

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

pub trait EmbeddingProvider: Send + Sync {
    fn status(&self) -> EmbeddingProviderStatus;

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
}
