use thiserror::Error;

/// Longest query-plus-document sequence the local reranker accepts. Matches the
/// `max_length` the ONNX tokenizer truncates to.
pub const RERANK_MAX_LENGTH: usize = 512;
/// Default cap on candidates per rerank call. Callers that need more must split
/// the work themselves; the reranker never truncates silently.
pub const DEFAULT_RERANK_MAX_CANDIDATES: usize = 60;
/// Upper bound for a configured candidate limit.
pub const RERANK_MAX_CANDIDATES_LIMIT: usize = 200;
/// Documents scored per inference call when the caller does not choose a batch size.
pub const RERANK_DEFAULT_BATCH_SIZE: usize = 8;
/// Largest ONNX Runtime intra-op thread count accepted for a local reranker.
#[cfg(feature = "local-embedding")]
const RERANK_MAX_INTRA_THREADS: usize = 64;
/// Largest batch size accepted for a local reranker.
#[cfg(feature = "local-embedding")]
const RERANK_MAX_BATCH_SIZE: usize = 32;

pub type RerankResult<T> = Result<T, RerankError>;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum RerankError {
    #[error("rerank query is empty")]
    EmptyQuery,
    #[error("rerank candidate limit must be between 1 and {limit}, got {requested}")]
    InvalidCandidateLimit { requested: usize, limit: usize },
    #[error("rerank option {field} must be between 1 and {max}, got {requested}")]
    InvalidOptions {
        field: &'static str,
        requested: usize,
        max: usize,
    },
    #[error("rerank received {count} candidates, above the limit of {max}")]
    TooManyCandidates { count: usize, max: usize },
    #[error("rerank model is unavailable: {0}")]
    ModelUnavailable(&'static str),
    #[error("rerank inference failed: {0}")]
    InferenceFailed(&'static str),
    #[error("rerank provider returned invalid output: {0}")]
    InvalidOutput(&'static str),
    #[error("rerank configuration is invalid: {0}")]
    Invalid(String),
    #[error("rerank provider failed: {0}")]
    Provider(String),
}

/// A search hit to reorder. `id` is opaque to the reranker and may repeat across
/// candidates; identity is tracked by position, never by `id`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RerankCandidate {
    pub id: String,
    pub text: String,
}

/// One score returned by a provider. `index` is the position of the document in
/// the slice passed to [`RerankProvider::score`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RerankScore {
    pub index: usize,
    pub score: f32,
}

/// A candidate after reranking. `original_index` points back to the input slice.
#[derive(Debug, Clone, PartialEq)]
pub struct RerankedCandidate {
    pub original_index: usize,
    pub id: String,
    pub score: f32,
}

/// Synchronous scoring backend. Implementations return one score per document in
/// any order. The caller validates completeness, uniqueness, and finiteness.
pub trait RerankProvider: Send + Sync {
    fn score(&self, query: &str, documents: &[&str]) -> RerankResult<Vec<RerankScore>>;
}

/// Reorders `candidates` by descending score. Ties keep the original input order.
///
/// Input above `max_candidates` is rejected rather than truncated, so the caller
/// always knows which candidates were scored. Any provider output that is not
/// exactly one finite score per input index is an error, never a dropped candidate.
pub fn rerank_candidates(
    provider: &dyn RerankProvider,
    query: &str,
    candidates: &[RerankCandidate],
    max_candidates: usize,
) -> RerankResult<Vec<RerankedCandidate>> {
    validate_candidate_limit(max_candidates)?;
    if query.trim().is_empty() {
        return Err(RerankError::EmptyQuery);
    }
    if candidates.len() > max_candidates {
        return Err(RerankError::TooManyCandidates {
            count: candidates.len(),
            max: max_candidates,
        });
    }
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let documents = candidates
        .iter()
        .map(|candidate| candidate.text.as_str())
        .collect::<Vec<_>>();
    let scores = provider.score(query, &documents)?;
    order_scores(candidates, scores)
}

fn validate_candidate_limit(max_candidates: usize) -> RerankResult<()> {
    if (1..=RERANK_MAX_CANDIDATES_LIMIT).contains(&max_candidates) {
        Ok(())
    } else {
        Err(RerankError::InvalidCandidateLimit {
            requested: max_candidates,
            limit: RERANK_MAX_CANDIDATES_LIMIT,
        })
    }
}

fn order_scores(
    candidates: &[RerankCandidate],
    scores: Vec<RerankScore>,
) -> RerankResult<Vec<RerankedCandidate>> {
    if scores.len() != candidates.len() {
        return Err(RerankError::InvalidOutput(
            "score count does not match candidate count",
        ));
    }

    let mut seen = vec![false; candidates.len()];
    let mut ordered = Vec::with_capacity(candidates.len());
    for item in scores {
        if item.index >= candidates.len() {
            return Err(RerankError::InvalidOutput("score index is out of range"));
        }
        if seen[item.index] {
            return Err(RerankError::InvalidOutput("score index is duplicated"));
        }
        seen[item.index] = true;
        if !item.score.is_finite() {
            return Err(RerankError::InvalidOutput("score is not finite"));
        }
        ordered.push(RerankedCandidate {
            original_index: item.index,
            id: candidates[item.index].id.clone(),
            // Adding 0.0 turns -0.0 into 0.0, so equal scores tie under total_cmp.
            score: item.score + 0.0,
        });
    }

    ordered.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then(left.original_index.cmp(&right.original_index))
    });
    Ok(ordered)
}

/// Settings for [`LocalReranker::load_with_options`]. The default matches
/// [`LocalReranker::load`]: ONNX Runtime chooses the thread count and each call
/// scores [`RERANK_DEFAULT_BATCH_SIZE`] documents.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalRerankerOptions {
    /// ONNX Runtime intra-op threads. `None` lets ONNX Runtime use every available core.
    pub intra_threads: Option<usize>,
    /// Documents passed to each inference call.
    pub batch_size: usize,
}

impl Default for LocalRerankerOptions {
    fn default() -> Self {
        Self {
            intra_threads: None,
            batch_size: RERANK_DEFAULT_BATCH_SIZE,
        }
    }
}

#[cfg(feature = "local-embedding")]
impl LocalRerankerOptions {
    fn validate(&self) -> RerankResult<()> {
        if let Some(threads) = self.intra_threads {
            check_option_range("intra_threads", threads, RERANK_MAX_INTRA_THREADS)?;
        }
        check_option_range("batch_size", self.batch_size, RERANK_MAX_BATCH_SIZE)
    }
}

#[cfg(feature = "local-embedding")]
fn check_option_range(field: &'static str, requested: usize, max: usize) -> RerankResult<()> {
    if (1..=max).contains(&requested) {
        Ok(())
    } else {
        Err(RerankError::InvalidOptions {
            field,
            requested,
            max,
        })
    }
}

/// Accepted ONNX locations, checked in order. The pinned reranker ships as
/// `onnx/model_int8.onnx`, so it is listed first. `model.onnx` stays as a fallback
/// for directories exported with the plain name.
#[cfg(feature = "local-embedding")]
const RERANK_MODEL_FILE_NAMES: &[&str] = &[
    "onnx/model_int8.onnx",
    "onnx/model.onnx",
    "onnx/model_quantized.onnx",
    "model.onnx",
];

/// Cross-encoder reranker loaded only from a local directory. It never downloads:
/// fastembed's hub loader is not called.
///
/// The directory must contain `onnx/model_int8.onnx`, `onnx/model.onnx`, or
/// `model.onnx` (first match wins), plus
/// `tokenizer.json`, `config.json`, `special_tokens_map.json`, and
/// `tokenizer_config.json`. Errors use fixed messages, so they never include
/// paths or document text.
#[cfg(feature = "local-embedding")]
pub struct LocalReranker {
    model: std::sync::Mutex<fastembed::TextRerank>,
    batch_size: usize,
}

#[cfg(feature = "local-embedding")]
impl LocalReranker {
    pub fn load(model_dir: &std::path::Path) -> RerankResult<Self> {
        Self::load_with_options(model_dir, LocalRerankerOptions::default())
    }

    /// Validates `options` before touching the model directory, so a bad setting
    /// never reads model files.
    pub fn load_with_options(
        model_dir: &std::path::Path,
        options: LocalRerankerOptions,
    ) -> RerankResult<Self> {
        use fastembed::{
            OnnxSource, RerankInitOptionsUserDefined, TextRerank, TokenizerFiles,
            UserDefinedRerankingModel,
        };

        options.validate()?;
        if !model_dir.is_dir() {
            return Err(RerankError::ModelUnavailable(
                "reranker model directory is missing",
            ));
        }
        let model_file = RERANK_MODEL_FILE_NAMES
            .iter()
            .map(|relative| model_dir.join(relative))
            .find(|path| path.is_file())
            .ok_or(RerankError::ModelUnavailable(
                "reranker ONNX model file is missing",
            ))?;
        // Opening the file checks readability without reading the weights into memory.
        std::fs::File::open(&model_file)
            .map_err(|_| RerankError::ModelUnavailable("reranker ONNX model file is unreadable"))?;

        let tokenizer_files = TokenizerFiles {
            tokenizer_file: read_tokenizer_asset(model_dir, "tokenizer.json")?,
            config_file: read_tokenizer_asset(model_dir, "config.json")?,
            special_tokens_map_file: read_tokenizer_asset(model_dir, "special_tokens_map.json")?,
            tokenizer_config_file: read_tokenizer_asset(model_dir, "tokenizer_config.json")?,
        };
        let model = UserDefinedRerankingModel::new(OnnxSource::File(model_file), tokenizer_files);
        let mut init_options =
            RerankInitOptionsUserDefined::new().with_max_length(RERANK_MAX_LENGTH);
        if let Some(threads) = options.intra_threads {
            init_options = init_options.with_intra_threads(threads);
        }
        let reranker =
            TextRerank::try_new_from_user_defined(model, init_options).map_err(|_| {
                RerankError::ModelUnavailable("reranker session or tokenizer failed to load")
            })?;
        Ok(Self {
            model: std::sync::Mutex::new(reranker),
            batch_size: options.batch_size,
        })
    }
}

#[cfg(feature = "local-embedding")]
fn read_tokenizer_asset(model_dir: &std::path::Path, name: &str) -> RerankResult<Vec<u8>> {
    std::fs::read(model_dir.join(name)).map_err(|_| {
        RerankError::ModelUnavailable("reranker tokenizer asset is missing or unreadable")
    })
}

#[cfg(feature = "local-embedding")]
impl RerankProvider for LocalReranker {
    fn score(&self, query: &str, documents: &[&str]) -> RerankResult<Vec<RerankScore>> {
        let mut model = self
            .model
            .lock()
            .map_err(|_| RerankError::InferenceFailed("reranker lock is poisoned"))?;
        let results = model
            .rerank(query, documents, false, Some(self.batch_size))
            .map_err(|_| RerankError::InferenceFailed("reranker inference failed"))?;
        Ok(results
            .into_iter()
            .map(|result| RerankScore {
                index: result.index,
                score: result.score,
            })
            .collect())
    }
}


