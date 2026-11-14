//! Paired text/image embedding provider for the visual retrieval channel.
//!
//! The contract is *paired semantics*: query text and image assets must land in one
//! shared space, so a provider that cannot encode text is not usable here. That is
//! the reason the model is a parameter of the channel rather than a detail of it —
//! CLIP ViT-B/32 (512-d), Nomic v1.5 (768-d) and Qwen3-VL-Embedding-2B (2048-d) are
//! all valid implementations, and vectors from different models must never meet.
//!
//! Identity is content-derived, never a path or a display name, so a replaced model
//! file cannot reuse another model's vectors.

use serde::{Deserialize, Serialize};

use crate::SearchResult;

/// One image asset handed to the provider.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VisualAssetInput {
    /// Stable document key; the provider never parses it.
    pub id: String,
    /// Encoded image bytes (png/jpeg/webp), exactly as stored under the entry.
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct VisualProviderStatus {
    pub available: bool,
    pub provider: String,
    #[serde(default)]
    pub model_name: Option<String>,
    #[serde(default)]
    pub dimensions: Option<usize>,
    #[serde(default)]
    pub message: Option<String>,
}

impl VisualProviderStatus {
    pub fn unavailable(provider: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            available: false,
            provider: provider.into(),
            model_name: None,
            dimensions: None,
            message: Some(message.into()),
        }
    }
}

pub trait VisualEmbeddingProvider: Send + Sync {
    fn status(&self) -> VisualProviderStatus;

    /// Immutable model identity (weights, tokenizer and preprocessing). `None` opts
    /// out of persisting vectors.
    fn identity(&self) -> Option<String>;

    fn dimensions(&self) -> Option<usize>;

    /// Encodes stored assets. `on_progress` reports (completed, total).
    fn embed_assets(
        &self,
        assets: &[VisualAssetInput],
        on_progress: &dyn Fn(usize, usize),
    ) -> SearchResult<Vec<Vec<f32>>>;

    /// Encodes the query into the same space as the assets.
    fn embed_query_text(&self, text: &str) -> SearchResult<Vec<f32>>;

    /// Page-level encoding, when the transport can also rasterize a local PDF.
    ///
    /// A remote API cannot read a local file path, so it returns `None` and the index
    /// falls back to whatever image bytes the product stores.
    fn page_source(&self) -> Option<&dyn VisualPageEmbedding> {
        None
    }
}

/// One page or crop vector produced from a local PDF.
#[derive(Clone, Debug, PartialEq)]
pub struct VisualPageVector {
    pub page_idx: u32,
    /// Crop index when the vector belongs to a region rather than the whole page.
    pub region: Option<u32>,
    pub vector: Vec<f32>,
}

/// Rasterizes a local PDF and encodes pages (and optional crops) in one call.
///
/// The product never holds page bitmaps: producing them needs a PDF renderer, and the
/// encoder service already runs the Python stack that has one. Keeping rasterization
/// there means the Rust side stays free of a native PDF library.
pub trait VisualPageEmbedding: Send + Sync {
    /// `pages` is 0-based and must be non-empty. `regions` asks for the four geometric
    /// crops per page (top, bottom, left, right), matching the measured protocol.
    fn embed_pdf_pages(
        &self,
        pdf_path: &std::path::Path,
        pages: &[u32],
        regions: bool,
    ) -> SearchResult<Vec<VisualPageVector>>;
}

/// The channel used when the product has no visual model. It never claims to search.
#[derive(Clone, Debug, Default)]
pub struct NoVisualProvider {
    message: Option<String>,
}

impl NoVisualProvider {
    pub fn with_message(message: impl Into<String>) -> Self {
        Self {
            message: Some(message.into()),
        }
    }
}

impl VisualEmbeddingProvider for NoVisualProvider {
    fn status(&self) -> VisualProviderStatus {
        VisualProviderStatus::unavailable(
            "none",
            self.message
                .clone()
                .unwrap_or_else(|| "No visual embedding model is configured.".to_string()),
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
        _assets: &[VisualAssetInput],
        _on_progress: &dyn Fn(usize, usize),
    ) -> SearchResult<Vec<Vec<f32>>> {
        Err(crate::SearchError::EmbeddingUnavailable(
            "No visual embedding model is configured.".to_string(),
        ))
    }

    fn embed_query_text(&self, _text: &str) -> SearchResult<Vec<f32>> {
        Err(crate::SearchError::EmbeddingUnavailable(
            "No visual embedding model is configured.".to_string(),
        ))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VisualProviderCheck {
    /// Fixed, path-free reason the channel cannot run, when it cannot.
    pub unavailable_reason: Option<&'static str>,
}

/// Checks the preconditions the index needs: available model, content identity, and
/// dimensions. A missing identity means vectors could be reused by the wrong model,
/// so it blocks persistence rather than silently disabling reuse.
pub fn check_provider(provider: &dyn VisualEmbeddingProvider) -> VisualProviderCheck {
    let status = provider.status();
    if !status.available {
        return VisualProviderCheck {
            unavailable_reason: Some("model_unavailable"),
        };
    }
    if provider.identity().is_none() {
        return VisualProviderCheck {
            unavailable_reason: Some("identity_unavailable"),
        };
    }
    if provider.dimensions().is_none() {
        return VisualProviderCheck {
            unavailable_reason: Some("dimensions_unavailable"),
        };
    }
    VisualProviderCheck {
        unavailable_reason: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_no_provider_reports_a_reason_and_refuses_to_embed() {
        let provider = NoVisualProvider::with_message("no model bundled");
        let check = check_provider(&provider);
        assert_eq!(check.unavailable_reason, Some("model_unavailable"));
        assert_eq!(
            provider.status().message.as_deref(),
            Some("no model bundled")
        );
        assert!(provider.embed_query_text("q").is_err());
        assert!(provider.embed_assets(&[], &|_, _| {}).is_err());
    }

    #[test]
    fn identity_and_dimensions_are_both_required_to_persist_vectors() {
        struct OnlyIdentity;
        impl VisualEmbeddingProvider for OnlyIdentity {
            fn status(&self) -> VisualProviderStatus {
                VisualProviderStatus {
                    available: true,
                    provider: "fake".to_string(),
                    model_name: None,
                    dimensions: None,
                    message: None,
                }
            }
            fn identity(&self) -> Option<String> {
                Some("id".to_string())
            }
            fn dimensions(&self) -> Option<usize> {
                None
            }
            fn embed_assets(
                &self,
                _assets: &[VisualAssetInput],
                _on_progress: &dyn Fn(usize, usize),
            ) -> SearchResult<Vec<Vec<f32>>> {
                Ok(Vec::new())
            }
            fn embed_query_text(&self, _text: &str) -> SearchResult<Vec<f32>> {
                Ok(vec![0.0])
            }
        }
        assert_eq!(
            check_provider(&OnlyIdentity).unavailable_reason,
            Some("dimensions_unavailable")
        );
    }
}
