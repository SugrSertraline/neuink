use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct AppSettings {
    #[serde(default)]
    pub workspace_root: Option<String>,
    #[serde(default)]
    pub llm: Option<LlmSettings>,
    #[serde(default)]
    pub llm_profiles: Vec<LlmProfile>,
    #[serde(default)]
    pub active_llm_profile_id: Option<String>,
    #[serde(default)]
    pub assistant_llm_profile_id: Option<String>,
    #[serde(default)]
    pub translation_llm_profile_id: Option<String>,
    #[serde(default)]
    pub translation_automation: TranslationAutomationSettings,
    #[serde(default, deserialize_with = "read_selection_translation")]
    pub selection_translation: SelectionTranslationSettings,
    #[serde(default)]
    pub sciverse: SciverseSettings,
    #[serde(default)]
    pub research: ResearchSettings,
    #[serde(default)]
    pub visual: VisualEmbeddingSettings,
    #[serde(default)]
    pub rerank: RerankSettings,
    #[serde(default)]
    pub retrieval: RetrievalSettings,
    #[serde(default)]
    pub text_model: TextModelSettings,
    #[serde(default)]
    pub recent_workspaces: Vec<RecentWorkspace>,
    pub autosave_interval_ms: Option<u64>,
    pub theme: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct SelectionTranslationSettings {
    pub provider: SelectionTranslationProvider,
    pub endpoint: String,
    pub model: String,
    pub region: String,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionTranslationProvider {
    #[default]
    ReadingModel,
    Azure,
    Deepl,
    QwenMt,
}

// Migrate only persisted settings; removed providers remain invalid IPC input.
fn read_selection_translation<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<SelectionTranslationSettings, D::Error> {
    #[derive(Default, Deserialize)]
    #[serde(default)]
    struct SavedSelectionTranslation {
        provider: Option<String>,
        endpoint: String,
        model: String,
        region: String,
    }
    let saved = SavedSelectionTranslation::deserialize(deserializer)?;
    if saved.provider.as_deref() == Some("openai") {
        return Ok(SelectionTranslationSettings::default());
    }
    let provider = SelectionTranslationProvider::deserialize(
        serde::de::value::StrDeserializer::<D::Error>::new(
            saved.provider.as_deref().unwrap_or("reading_model"),
        ),
    )?;
    Ok(SelectionTranslationSettings {
        provider,
        endpoint: saved.endpoint,
        model: saved.model,
        region: saved.region,
    })
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ResearchSettings {
    #[serde(default = "research_enabled")]
    pub papers_enabled: bool,
    #[serde(default = "research_enabled")]
    pub web_enabled: bool,
    #[serde(default)]
    pub use_tavily: bool,
}
fn research_enabled() -> bool {
    true
}
impl Default for ResearchSettings {
    fn default() -> Self {
        Self {
            papers_enabled: true,
            web_enabled: true,
            use_tavily: false,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SciverseSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_sciverse_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub api_key_ref: Option<String>,
}

impl Default for SciverseSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: default_sciverse_base_url(),
            api_key_ref: None,
        }
    }
}

fn default_sciverse_base_url() -> String {
    "https://api.sciverse.space".to_string()
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct RecentWorkspace {
    pub root: String,
    pub last_opened_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct TranslationAutomationSettings {
    #[serde(default)]
    pub auto_translate_pdf: bool,
    #[serde(default = "default_translation_segment_types")]
    pub segment_types: Vec<String>,
}

impl Default for TranslationAutomationSettings {
    fn default() -> Self {
        Self {
            auto_translate_pdf: false,
            segment_types: default_translation_segment_types(),
        }
    }
}

fn default_translation_segment_types() -> Vec<String> {
    [
        "paragraph",
        "heading",
        "table",
        "math",
        "figure",
        "code",
        "list",
        "page_header",
        "page_footer",
        "page_number",
        "aside_text",
        "page_footnote",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmApiProtocol {
    Anthropic,
    Google,
    #[default]
    #[serde(other)]
    OpenaiCompatible,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct LlmSettings {
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key: Option<String>,
    pub api_key_ref: Option<String>,
    pub max_context_length: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub top_p: Option<f32>,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    #[serde(default)]
    pub api_protocol: LlmApiProtocol,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct LlmProfile {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key: Option<String>,
    pub max_context_length: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub top_p: Option<f32>,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    #[serde(default)]
    pub api_protocol: LlmApiProtocol,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VisualEmbeddingProviderKind {
    /// Qwen3-VL-Embedding-2B behind a local HTTP service the user runs.
    #[default]
    QwenLocal,
    /// The same model behind a remote HTTP API.
    QwenApi,
    /// A stored value this build no longer runs. Recognised so old settings still
    /// deserialize; it never runs.
    #[serde(other)]
    Retired,
}

impl VisualEmbeddingProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::QwenLocal => "qwen_local",
            Self::QwenApi => "qwen_api",
            Self::Retired => "retired",
        }
    }

    pub fn is_qwen(self) -> bool {
        matches!(self, Self::QwenLocal | Self::QwenApi)
    }
}

fn default_visual_timeout_ms() -> u64 {
    60_000
}

fn default_visual_local_endpoint() -> Option<String> {
    Some("http://127.0.0.1:8765".to_string())
}

fn default_fusion_text_weight() -> f32 {
    1.0
}

fn default_fusion_visual_weight() -> f32 {
    0.5
}

fn default_fusion_rrf_k() -> f32 {
    60.0
}

fn default_gate_min_head_entries() -> usize {
    3
}

fn default_gate_max_snippet_overlap() -> usize {
    2
}

/// How the visual sidecar votes enter the document order.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VisualFusionMode {
    /// Weighted rank fusion over both channels. This reorders the head.
    Weighted,
    /// The text order is kept; visual entries are appended only when a gold-free gate
    /// reports that the text head is thin. This is the shape the dual-channel experiment
    /// measured (DocVQA100: 0.36 -> 0.41 at rank 11).
    #[default]
    AppendGated,
}

/// Gold-free gate for `AppendGated`.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct VisualAppendGate {
    #[serde(default = "default_gate_min_head_entries")]
    pub min_head_entries: usize,
    #[serde(default = "default_gate_max_snippet_overlap")]
    pub max_snippet_overlap: usize,
}

impl Default for VisualAppendGate {
    fn default() -> Self {
        Self {
            min_head_entries: default_gate_min_head_entries(),
            max_snippet_overlap: default_gate_max_snippet_overlap(),
        }
    }
}

/// The dual-channel parameters, restored as settings rather than constants.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct VisualFusionSettings {
    pub mode: VisualFusionMode,
    #[serde(default = "default_fusion_text_weight")]
    pub text_weight: f32,
    #[serde(default = "default_fusion_visual_weight")]
    pub visual_weight: f32,
    #[serde(default = "default_fusion_rrf_k")]
    pub rrf_k: f32,
    pub gate: VisualAppendGate,
}

impl Default for VisualFusionSettings {
    fn default() -> Self {
        Self {
            mode: VisualFusionMode::AppendGated,
            text_weight: default_fusion_text_weight(),
            visual_weight: default_fusion_visual_weight(),
            rrf_k: default_fusion_rrf_k(),
            gate: VisualAppendGate::default(),
        }
    }
}

impl VisualFusionSettings {
    pub fn validate(&self) -> Result<(), String> {
        for (name, value) in [
            ("text_weight", self.text_weight),
            ("visual_weight", self.visual_weight),
        ] {
            if !value.is_finite() || !(0.0..=10.0).contains(&value) {
                return Err(format!("视觉融合权重 {name} 必须在 0 到 10 之间"));
            }
        }
        if self.mode == VisualFusionMode::Weighted
            && self.text_weight <= 0.0
            && self.visual_weight <= 0.0
        {
            return Err("加权融合至少要有一个通道权重大于 0".to_string());
        }
        if !self.rrf_k.is_finite() || !(1.0..=1000.0).contains(&self.rrf_k) {
            return Err("视觉融合 RRF k 必须在 1 到 1000 之间".to_string());
        }
        if self.gate.min_head_entries == 0 || self.gate.min_head_entries > 50 {
            return Err("视觉追加门控的 head 下限必须在 1 到 50 之间".to_string());
        }
        if self.gate.max_snippet_overlap > 20 {
            return Err("视觉追加门控的词重叠上限必须在 0 到 20 之间".to_string());
        }
        Ok(())
    }
}

/// How the visual channel obtains Qwen3-VL-Embedding-2B vectors.
///
/// One model, two transports. The index namespace comes from the model identity the
/// service reports, so switching transport never reuses the other model's vectors.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct VisualEmbeddingSettings {
    pub provider: VisualEmbeddingProviderKind,
    /// Service base URL. Local runs default to loopback; a remote API must set it.
    #[serde(default = "default_visual_local_endpoint")]
    pub endpoint: Option<String>,
    /// Bearer token for `qwen_api`. Never logged, never returned by status calls.
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default = "default_visual_timeout_ms")]
    pub timeout_ms: u64,
    /// Dual-channel parameters. Defaults reproduce the measured shape: gated append,
    /// text 1.0 / visual 0.5, RRF k=60.
    #[serde(default)]
    pub fusion: VisualFusionSettings,
    /// Startup policy for the local service (ignored by remote transports).
    #[serde(default)]
    pub startup: VisualServiceStartup,
}

impl Default for VisualEmbeddingSettings {
    fn default() -> Self {
        Self {
            provider: VisualEmbeddingProviderKind::QwenLocal,
            endpoint: default_visual_local_endpoint(),
            api_key: None,
            timeout_ms: default_visual_timeout_ms(),
            fusion: VisualFusionSettings::default(),
            startup: VisualServiceStartup::default(),
        }
    }
}

impl VisualEmbeddingSettings {
    /// Rejects a configuration that cannot work, so a bad setting fails at save time
    /// instead of producing a silently disabled channel later.
    pub fn validate(&self) -> Result<(), String> {
        if self.timeout_ms == 0 || self.timeout_ms > 600_000 {
            return Err("视觉编码超时必须在 1 到 600000 毫秒之间".to_string());
        }
        if self.provider == VisualEmbeddingProviderKind::Retired {
            return Err(
                "已停用的视觉编码器不再运行，请改用 Qwen 本地服务或远程 API。".to_string(),
            );
        }
        let endpoint = self.endpoint.as_deref().map(str::trim).unwrap_or_default();
        if endpoint.is_empty() {
            return Err(match self.provider {
                VisualEmbeddingProviderKind::QwenApi => {
                    "选择远程视觉编码 API 时需要填写服务地址".to_string()
                }
                _ => "视觉编码服务地址不能为空".to_string(),
            });
        }
        if !(endpoint.starts_with("http://") || endpoint.starts_with("https://")) {
            return Err("视觉编码服务地址必须以 http:// 或 https:// 开头".to_string());
        }
        if self.provider == VisualEmbeddingProviderKind::QwenApi {
            let key = self.api_key.as_deref().map(str::trim).unwrap_or_default();
            if key.is_empty() {
                return Err("选择远程视觉编码 API 时需要填写访问密钥".to_string());
            }
            if endpoint.starts_with("http://") {
                return Err("远程视觉编码 API 必须使用 https://，避免密钥明文传输".to_string());
            }
        }
        self.fusion.validate()?;
        Ok(())
    }
}

#[cfg(test)]
mod visual_settings_tests {
    use super::{
        VisualEmbeddingProviderKind, VisualEmbeddingSettings, VisualFusionMode,
        VisualFusionSettings,
    };

    #[test]
    fn qwen_local_is_the_default_and_points_at_loopback() {
        let settings = VisualEmbeddingSettings::default();
        assert_eq!(settings.provider, VisualEmbeddingProviderKind::QwenLocal);
        assert_eq!(settings.provider.as_str(), "qwen_local");
        assert_eq!(settings.endpoint.as_deref(), Some("http://127.0.0.1:8765"));
        assert_eq!(settings.timeout_ms, 60_000);
        assert_eq!(settings.fusion.mode, VisualFusionMode::AppendGated);
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn the_retired_bundled_encoder_is_recognised_but_never_runs() {
        use serde::Deserialize;

        let provider = VisualEmbeddingProviderKind::deserialize(
            serde::de::value::StrDeserializer::<serde::de::value::Error>::new("fastembed"),
        )
        .expect("old stored value must decode");
        assert_eq!(provider, VisualEmbeddingProviderKind::Retired);
        assert!(!provider.is_qwen());
        let settings = VisualEmbeddingSettings {
            provider,
            ..VisualEmbeddingSettings::default()
        };
        assert!(settings
            .validate()
            .expect_err("retired provider must be rejected")
            .contains("已停用"));
    }

    #[test]
    fn a_remote_api_needs_a_key_and_https() {
        let mut settings = VisualEmbeddingSettings {
            provider: VisualEmbeddingProviderKind::QwenApi,
            endpoint: Some("https://example.invalid/v1".to_string()),
            api_key: None,
            ..VisualEmbeddingSettings::default()
        };
        assert!(settings.validate().is_err());

        settings.api_key = Some("token".to_string());
        assert!(settings.validate().is_ok());

        settings.endpoint = Some("http://example.invalid/v1".to_string());
        assert!(settings
            .validate()
            .expect_err("plain http must be rejected")
            .contains("https://"));
    }

    #[test]
    fn the_timeout_is_bounded_and_the_address_must_be_absolute() {
        let mut settings = VisualEmbeddingSettings {
            timeout_ms: 0,
            ..VisualEmbeddingSettings::default()
        };
        assert!(settings.validate().is_err());
        settings.timeout_ms = 600_001;
        assert!(settings.validate().is_err());
        settings.timeout_ms = 600_000;
        assert!(settings.validate().is_ok());

        settings.endpoint = Some("127.0.0.1:8765".to_string());
        assert!(settings.validate().is_err());
    }

    #[test]
    fn fusion_bounds_are_enforced() {
        let mut fusion = VisualFusionSettings::default();
        fusion.visual_weight = 11.0;
        assert!(fusion.validate().is_err());
        fusion.visual_weight = 0.5;
        fusion.rrf_k = 0.0;
        assert!(fusion.validate().is_err());
        fusion.rrf_k = 60.0;
        fusion.gate.min_head_entries = 0;
        assert!(fusion.validate().is_err());
        fusion.gate.min_head_entries = 3;
        fusion.gate.max_snippet_overlap = 21;
        assert!(fusion.validate().is_err());
        fusion.gate.max_snippet_overlap = 2;
        assert!(fusion.validate().is_ok());
        fusion.mode = VisualFusionMode::Weighted;
        fusion.text_weight = 0.0;
        fusion.visual_weight = 0.0;
        assert!(fusion.validate().is_err());
    }
}


/// Which rerank stage runs after fusion.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RerankMode {
    /// No rerank stage. The measured default: field-coverage fusion already orders the
    /// head, and a cross-encoder costs 1.2–4.7 s per query on CPU for a thin gain.
    #[default]
    Off,
    /// Model-free field coverage. Cheap, and the fallback stage of the ladder.
    Heuristic,
    /// Local cross-encoder over the head of the fused list.
    CrossEncoder,
}

impl RerankMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Heuristic => "heuristic",
            Self::CrossEncoder => "cross_encoder",
        }
    }
}

fn default_rerank_max_candidates() -> usize {
    20
}

fn default_scope_refine_timeout_ms() -> u64 {
    30_000
}

fn default_scope_refine_concurrency() -> usize {
    8
}

/// Optional post-cross-encoder tail refinement (Scope-Rerank v6).
///
/// Locks ranks 1..=8 and evaluates only slots 9..=10 against challengers 11..=20.
/// Always fail-closed to the cross-encoder ranking.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct ScopeRefineSettings {
    /// Opt-in switch; off by default.
    pub enabled: bool,
    /// Reuse the configured OpenAI-compatible assistant LLM profile when overrides are blank.
    #[serde(default = "default_true")]
    pub use_assistant_llm: bool,
    /// Optional OpenAI-compatible base URL or `/chat/completions` override.
    #[serde(default)]
    pub api_endpoint: Option<String>,
    /// Optional model override.
    #[serde(default)]
    pub api_model: Option<String>,
    /// Optional write-only bearer token override. Never returned to the frontend.
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default = "default_scope_refine_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default = "default_scope_refine_concurrency")]
    pub max_concurrency: usize,
}

impl Default for ScopeRefineSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            use_assistant_llm: true,
            api_endpoint: None,
            api_model: None,
            api_key: None,
            timeout_ms: default_scope_refine_timeout_ms(),
            max_concurrency: default_scope_refine_concurrency(),
        }
    }
}

impl ScopeRefineSettings {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=120_000).contains(&self.timeout_ms) {
            return Err("尾部范围精排超时必须在 1 到 120000 毫秒之间".to_string());
        }
        if !(1..=16).contains(&self.max_concurrency) {
            return Err("尾部范围精排并发必须在 1 到 16 之间".to_string());
        }
        if let Some(endpoint) = self.api_endpoint.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
            if !(endpoint.starts_with("http://") || endpoint.starts_with("https://")) {
                return Err("尾部范围精排地址必须以 http:// 或 https:// 开头".to_string());
            }
            if endpoint.starts_with("http://") && !is_loopback_endpoint(endpoint) {
                return Err("尾部范围精排必须使用 https://；仅本机回环地址允许 http://".to_string());
            }
        }
        Ok(())
    }
}

fn default_listwise_timeout_ms() -> u64 {
    60_000
}

fn default_listwise_top_n() -> usize {
    25
}

fn default_max_full_scope_segments() -> usize {
    600
}

fn default_rescore_window() -> usize {
    100
}

/// Which BGE-M3 multi-vector score to use when the pool is enabled.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MultivectorPoolMode {
    /// ColBERT MaxSim only.
    Colbert,
    /// `0.4` dense + `0.2` lexical + `0.4` ColBERT. This is the measured C0 mix.
    #[default]
    BgeM3Hybrid,
}

impl MultivectorPoolMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Colbert => "colbert",
            Self::BgeM3Hybrid => "bge_m3_hybrid",
        }
    }
}

/// Opt-in first-stage pool. Off by default; a missing head falls back to single-vector.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct MultivectorPoolSettings {
    pub enabled: bool,
    pub mode: MultivectorPoolMode,
    #[serde(default = "default_max_full_scope_segments")]
    pub max_full_scope_segments: usize,
    #[serde(default = "default_rescore_window")]
    pub rescore_window: usize,
}

impl Default for MultivectorPoolSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: MultivectorPoolMode::BgeM3Hybrid,
            max_full_scope_segments: default_max_full_scope_segments(),
            rescore_window: default_rescore_window(),
        }
    }
}

impl MultivectorPoolSettings {
    pub fn is_default(&self) -> bool {
        self == &Self::default()
    }

    pub fn validate(&self) -> Result<(), String> {
        if !(1..=2000).contains(&self.max_full_scope_segments) {
            return Err("多向量全量打分上限必须在 1 到 2000 段之间".to_string());
        }
        if !(10..=200).contains(&self.rescore_window) {
            return Err("多向量重打分窗口必须在 10 到 200 之间".to_string());
        }
        Ok(())
    }
}

/// One unlocked Top-N listwise pass. Mutually exclusive with scope refine.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct ListwiseRefineSettings {
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub use_assistant_llm: bool,
    #[serde(default)]
    pub api_endpoint: Option<String>,
    #[serde(default)]
    pub api_model: Option<String>,
    /// Write-only bearer token. Never returned to the frontend.
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default = "default_listwise_top_n")]
    pub top_n: usize,
    #[serde(default = "default_true")]
    pub fuse_rrf: bool,
    /// When every candidate comes from a single entry, use the single-paper
    /// substantive-evidence prompt (`[Section] [Type]`) and output direct L1 order
    /// without RRF re-injecting Abstract false positives. Multi-doc queries still obey `fuse_rrf`.
    #[serde(default = "default_true")]
    pub single_paper_mode: bool,
    #[serde(default = "default_listwise_timeout_ms")]
    pub timeout_ms: u64,
}

impl Default for ListwiseRefineSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            use_assistant_llm: true,
            api_endpoint: None,
            api_model: None,
            api_key: None,
            top_n: default_listwise_top_n(),
            fuse_rrf: true,
            single_paper_mode: true,
            timeout_ms: default_listwise_timeout_ms(),
        }
    }
}

impl ListwiseRefineSettings {
    pub fn validate(&self) -> Result<(), String> {
        if !(10..=30).contains(&self.top_n) {
            return Err("Listwise 候选数必须在 10 到 30 之间".to_string());
        }
        if !(1..=120_000).contains(&self.timeout_ms) {
            return Err("Listwise 超时必须在 1 到 120000 毫秒之间".to_string());
        }
        if let Some(endpoint) = self.api_endpoint.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
            if !(endpoint.starts_with("http://") || endpoint.starts_with("https://")) {
                return Err("Listwise 地址必须以 http:// 或 https:// 开头".to_string());
            }
            if endpoint.starts_with("http://") && !is_loopback_endpoint(endpoint) {
                return Err("Listwise 必须使用 https://；仅本机回环地址允许 http://".to_string());
            }
        }
        Ok(())
    }
}

/// Rerank ladder: `CrossEncoder → Heuristic → fused order`.
///
/// A model that is missing, fails to load, or errors mid-scoring must never break a
/// search: the stage falls back to the model-free heuristic when allowed, and otherwise
/// leaves the fused order untouched. Which rung ran is reported per task.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct RerankSettings {
    pub mode: RerankMode,
    /// Cross-encoder directory; empty means the bundled resource path.
    #[serde(default)]
    pub model_dir: Option<String>,
    /// Head of the fused list that a cross-encoder is allowed to score.
    #[serde(default = "default_rerank_max_candidates")]
    pub max_candidates: usize,
    /// When the cross-encoder cannot run, fall back to field coverage instead of the
    /// fused order alone.
    #[serde(default = "default_true")]
    pub fallback_heuristic: bool,
    /// Where the model-backed rung runs: local ONNX or a hosted rerank API.

    #[serde(default)]
    pub transport: RerankTransport,
    /// Hosted endpoint; only used by [`RerankTransport::Api`].
    #[serde(default)]
    pub api_endpoint: Option<String>,
    /// Bearer token for the hosted endpoint. Never returned by status calls.
    #[serde(default)]
    pub api_key: Option<String>,
    /// Hosted model name, for example `jina-reranker-v2-base-multilingual`.
    #[serde(default)]
    pub api_model: Option<String>,
    /// Request/response shape of the hosted endpoint.

    #[serde(default)]
    pub api_style: RemoteApiStyle,
    /// Optional v6 tail refinement after a successful cross-encoder pass.
    #[serde(default)]
    pub scope_refine: ScopeRefineSettings,
    /// Optional hosted rerank instruction. Blank or `None` omits the field.
    #[serde(default)]
    pub api_instruction: Option<String>,
    /// After a successful cross-encoder, fuse it with the first-stage order.
    #[serde(default)]
    pub fuse_with_pool: bool,
    /// Prefix cross-encoder documents with clean `[Section] [Type]` tags (zero neighbor text).
    #[serde(default = "default_true")]
    pub structured_input: bool,
    /// Zero-API offline soft prior (`B0-sec-soft`): gently demotes Abstract/Front matter
    /// and short pure-Heading units when the query has no summary intent.
    #[serde(default = "default_true")]
    pub structural_soft_demotion: bool,
    /// Optional single-call listwise pass. Cannot be on together with scope refine.
    #[serde(default)]
    pub listwise: ListwiseRefineSettings,
}

fn default_true() -> bool {
    true
}

impl Default for RerankSettings {
    fn default() -> Self {
        Self {
            mode: RerankMode::Off,
            model_dir: None,
            max_candidates: default_rerank_max_candidates(),
            transport: RerankTransport::Local,
            api_endpoint: None,
            api_key: None,
            api_model: None,
            api_style: RemoteApiStyle::Protocol,
            fallback_heuristic: true,
            scope_refine: ScopeRefineSettings::default(),
            api_instruction: None,
            fuse_with_pool: false,
            structured_input: true,
            structural_soft_demotion: true,
            listwise: ListwiseRefineSettings::default(),
        }
    }
}

impl RerankSettings {
    pub fn validate(&self) -> Result<(), String> {
        if self.max_candidates == 0 || self.max_candidates > 200 {
            return Err("重排候选上限必须在 1 到 200 之间".to_string());
        }
        if self.mode == RerankMode::CrossEncoder {
            if let Some(model_dir) = self.model_dir.as_deref() {
                if model_dir.trim().is_empty() {
                    return Err("选择本地重排模型时目录不能为空串，留空表示使用内置路径".to_string());
                }
            }
        }
        self.scope_refine.validate()?;
        self.listwise.validate()?;
        if self.scope_refine.enabled && self.listwise.enabled {
            return Err("尾部范围精排与无锁 Listwise 不能同时开启".to_string());
        }
        if let Some(instruction) = self.api_instruction.as_deref() {
            if instruction.trim().chars().count() > 1000 {
                return Err("重排任务指令不能超过 1000 个字符".to_string());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod rerank_settings_tests {
    use super::{RerankMode, RerankSettings};

    #[test]
    fn the_default_is_off_with_a_bounded_head() {
        let settings = RerankSettings::default();
        assert_eq!(settings.mode, RerankMode::Off);
        assert_eq!(settings.mode.as_str(), "off");
        assert_eq!(settings.max_candidates, 20);
        assert!(settings.fallback_heuristic);
        assert!(settings.structured_input);
        assert!(settings.structural_soft_demotion);
        assert!(settings.listwise.single_paper_mode);
        assert!(settings.validate().is_ok());

        let legacy: RerankSettings = serde_json::from_str("{}").expect("legacy json");
        assert!(legacy.structured_input);
        assert!(legacy.structural_soft_demotion);
        assert!(legacy.listwise.single_paper_mode);

        let opt_out: RerankSettings = serde_json::from_str(
            r#"{"structured_input":false,"structural_soft_demotion":false}"#,
        )
        .expect("explicit opt-out");
        assert!(!opt_out.structured_input);
        assert!(!opt_out.structural_soft_demotion);
    }

    #[test]
    fn the_candidate_bound_is_enforced() {
        let mut settings = RerankSettings::default();
        settings.max_candidates = 0;
        assert!(settings.validate().is_err());
        settings.max_candidates = 201;
        assert!(settings.validate().is_err());
        settings.max_candidates = 200;
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn an_empty_directory_string_is_rejected_for_the_model_mode() {
        let mut settings = RerankSettings {
            mode: RerankMode::CrossEncoder,
            ..RerankSettings::default()
        };
        settings.model_dir = Some("   ".to_string());
        assert!(settings.validate().is_err());
        settings.model_dir = Some(r"D:\models\reranker".to_string());
        assert!(settings.validate().is_ok());
        // Omitted directory is valid: it means the bundled resource path.
        settings.model_dir = None;
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn an_old_settings_file_leaves_scope_refine_off() {
        let settings: RerankSettings = serde_json::from_str(r#"{"mode":"off"}"#).expect("legacy");
        assert!(!settings.scope_refine.enabled);
        assert!(settings.scope_refine.use_assistant_llm);
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn scope_refine_rejects_a_cleartext_remote_endpoint() {
        let mut settings = RerankSettings::default();
        settings.scope_refine.api_endpoint = Some("http://example.com/v1".to_string());
        assert!(settings.validate().is_err());
        settings.scope_refine.api_endpoint = Some("http://127.0.0.1:9/v1".to_string());
        assert!(settings.validate().is_ok());
        settings.scope_refine.max_concurrency = 0;
        assert!(settings.validate().is_err());
    }

    #[test]
    fn an_old_file_leaves_instruction_fusion_and_listwise_off() {
        let settings: RerankSettings = serde_json::from_str(r#"{"mode":"cross_encoder"}"#).expect("legacy");
        assert!(settings.api_instruction.is_none());
        assert!(!settings.fuse_with_pool);
        assert!(!settings.listwise.enabled);
        assert!(settings.listwise.fuse_rrf);
        assert_eq!(settings.listwise.top_n, 25);
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn scope_refine_and_listwise_are_mutually_exclusive() {
        let mut settings = RerankSettings::default();
        settings.scope_refine.enabled = true;
        settings.listwise.enabled = true;
        let error = settings.validate().expect_err("mutex");
        assert!(error.contains("不能同时开启"));
        settings.listwise.enabled = false;
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn listwise_bounds_and_instruction_length_are_enforced() {
        let mut settings = RerankSettings::default();
        settings.listwise.top_n = 9;
        assert!(settings.validate().is_err());
        settings.listwise.top_n = 25;
        settings.listwise.api_endpoint = Some("http://example.com/v1".to_string());
        assert!(settings.validate().is_err());
        settings.listwise.api_endpoint = Some("http://127.0.0.1:9/v1".to_string());
        settings.api_instruction = Some("x".repeat(1001));
        assert!(settings.validate().is_err());
        settings.api_instruction = Some("  ".to_string());
        assert!(settings.validate().is_ok());
    }
}

/// Which retrieval path the assistant's library tool uses.
///
/// The default stays on the batch path: the composed path changes document routing, runs
/// the visual vote and applies the rerank ladder, so it is opt-in rather than a silent
/// behaviour change for every existing user.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct RetrievalSettings {
    /// Use `search_unified` (document routing, carrier binding, visual vote, rerank).
    pub unified: bool,
    /// Opt-in BGE-M3 multi-vector pool. Omitted on older files, which stay single-vector.
    #[serde(default, skip_serializing_if = "MultivectorPoolSettings::is_default")]
    pub multivector: MultivectorPoolSettings,
}

impl RetrievalSettings {
    pub fn validate(&self) -> Result<(), String> {
        self.multivector.validate()
    }
}

#[cfg(test)]
mod retrieval_settings_tests {
    use super::RetrievalSettings;
    use serde_json;

    #[test]
    fn the_composed_path_is_opt_in() {
        let settings = RetrievalSettings::default();
        assert!(!settings.unified);
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn the_flag_round_trips_through_json() {
        let settings = RetrievalSettings {
            unified: true,
            ..RetrievalSettings::default()
        };
        let encoded = serde_json::to_string(&settings).expect("encode");
        assert_eq!(encoded, r#"{"unified":true}"#);
        let decoded: RetrievalSettings = serde_json::from_str(&encoded).expect("decode");
        assert!(decoded.unified);
        assert!(!decoded.multivector.enabled);
        // An older settings file without the field still loads.
        let legacy: RetrievalSettings = serde_json::from_str(r#"{"unified":true}"#).expect("legacy");
        assert!(legacy.unified);
        assert!(!legacy.multivector.enabled);
        assert_eq!(legacy.multivector.max_full_scope_segments, 600);
    }

    #[test]
    fn multivector_bounds_are_enforced() {
        let mut settings = RetrievalSettings::default();
        settings.multivector.enabled = true;
        settings.multivector.max_full_scope_segments = 0;
        assert!(settings.validate().is_err());
        settings.multivector.max_full_scope_segments = 600;
        settings.multivector.rescore_window = 9;
        assert!(settings.validate().is_err());
        settings.multivector.rescore_window = 100;
        assert!(settings.validate().is_ok());
    }
}




/// Where text embeddings come from. Both transports return the same trait object, so
/// retrieval and indexing code never branches on this value.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TextEmbeddingProviderKind {
    /// A local ONNX export loaded in-process (`FastEmbedProvider`).
    #[default]
    LocalOnnx,
    /// An OpenAI-compatible `/embeddings` HTTP endpoint.
    Api,
}

impl TextEmbeddingProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LocalOnnx => "local_onnx",
            Self::Api => "api",
        }
    }
}

fn default_text_api_timeout_ms() -> u64 {
    60_000
}

/// Which text embedding model the search path uses.
///
/// Local mode reads `model_dir`: an absolute directory holding `neuink-embedding.json` plus
/// an ONNX file; `None` means the bundled resource directory. API mode reads `endpoint`,
/// `api_key`, `model` and `dimensions` and talks the OpenAI-compatible protocol.
///
/// The two transports share one trait (`EmbeddingProvider`) and therefore one vector store,
/// one degradation vocabulary and one settings screen; adding a provider must not change
/// the retrieval pipeline.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct TextModelSettings {
    /// Absolute model directory, or `None` for the bundled one. Local mode only.
    pub model_dir: Option<String>,
    /// Which transport produces vectors.
    pub provider: TextEmbeddingProviderKind,
    /// OpenAI-compatible base URL, for example `https://api.example.com/v1`.
    /// A URL already ending in `/embeddings` is accepted as-is.
    pub endpoint: Option<String>,
    /// Bearer token. Write-only from the UI's point of view: status calls report only
    /// whether one is stored.
    pub api_key: Option<String>,
    /// Model id sent to the API, for example `text-embedding-3-small`. Never hardcoded.
    pub model: Option<String>,
    /// Output width the API is known to produce; vectors are validated against it.
    pub dimensions: Option<usize>,
    /// Per-request timeout for the API transport.
    pub timeout_ms: u64,
}

impl Default for TextModelSettings {
    fn default() -> Self {
        Self {
            model_dir: None,
            provider: TextEmbeddingProviderKind::LocalOnnx,
            endpoint: None,
            api_key: None,
            model: None,
            dimensions: None,
            timeout_ms: default_text_api_timeout_ms(),
        }
    }
}

impl TextModelSettings {
    pub fn validate(&self) -> Result<(), String> {
        match self.provider {
            TextEmbeddingProviderKind::LocalOnnx => {
                if let Some(dir) = self.model_dir.as_deref() {
                    if dir.trim().is_empty() {
                        return Err("文本嵌入模型目录不能是空串；留空表示使用内置模型".to_string());
                    }
                }
                Ok(())
            }
            TextEmbeddingProviderKind::Api => self.validate_api(),
        }
    }

    fn validate_api(&self) -> Result<(), String> {
        let endpoint = self.endpoint.as_deref().map(str::trim).unwrap_or_default();
        if endpoint.is_empty() {
            return Err("选择远程嵌入 API 时需要填写服务地址".to_string());
        }
        if !(endpoint.starts_with("http://") || endpoint.starts_with("https://")) {
            return Err("嵌入 API 地址必须以 http:// 或 https:// 开头".to_string());
        }
        // A plain-http endpoint is only acceptable on the loopback interface, where the
        // bytes never leave the machine; anything else would send the token in clear text.
        if endpoint.starts_with("http://") && !is_loopback_endpoint(endpoint) {
            return Err("远程嵌入 API 必须使用 https://；仅本机回环地址允许 http://".to_string());
        }
        if self.model.as_deref().map(str::trim).unwrap_or_default().is_empty() {
            return Err("选择远程嵌入 API 时需要填写模型名称".to_string());
        }
        match self.dimensions {
            Some(dimensions) if (1..=8192).contains(&dimensions) => {}
            _ => return Err("远程嵌入 API 需要填写 1 到 8192 之间的向量维度".to_string()),
        }
        if self.timeout_ms == 0 || self.timeout_ms > 600_000 {
            return Err("嵌入 API 超时必须介于 1 与 600000 毫秒之间".to_string());
        }
        Ok(())
    }
}

/// `true` when the endpoint host is the loopback interface. Used only to decide whether
/// plain `http://` is safe; TLS is still required for every other host.
pub fn is_loopback_endpoint(endpoint: &str) -> bool {
    let without_scheme = endpoint
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(endpoint);
    let authority = without_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or(without_scheme);
    // Strip credentials and the port: `user:pass@host:port`.
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    let host = if let Some(rest) = host_port.strip_prefix('[') {
        rest.split(']').next().unwrap_or(rest)
    } else {
        host_port.split(':').next().unwrap_or(host_port)
    };
    matches!(
        host.to_ascii_lowercase().as_str(),
        "127.0.0.1" | "localhost" | "::1"
    )
}

#[cfg(test)]
mod text_model_settings_tests {
    use super::{is_loopback_endpoint, TextEmbeddingProviderKind, TextModelSettings};

    fn api_settings() -> TextModelSettings {
        TextModelSettings {
            provider: TextEmbeddingProviderKind::Api,
            endpoint: Some("https://api.example.com/v1".to_string()),
            api_key: Some("token".to_string()),
            model: Some("text-embedding-example".to_string()),
            dimensions: Some(1024),
            ..TextModelSettings::default()
        }
    }

    #[test]
    fn the_bundled_model_is_the_default() {
        let settings = TextModelSettings::default();
        assert_eq!(settings.model_dir, None);
        assert_eq!(settings.provider, TextEmbeddingProviderKind::LocalOnnx);
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn an_empty_directory_is_rejected_but_an_absolute_one_is_accepted() {
        let blank = TextModelSettings {
            model_dir: Some("   ".to_string()),
            ..TextModelSettings::default()
        };
        assert!(blank.validate().is_err());
        let absolute = TextModelSettings {
            model_dir: Some(r"D:\models\bge-m3-int8".to_string()),
            ..TextModelSettings::default()
        };
        assert!(absolute.validate().is_ok());
    }

    #[test]
    fn the_field_round_trips_and_older_settings_still_load() {
        let encoded = serde_json::to_string(&TextModelSettings {
            model_dir: Some("D:/m".to_string()),
            ..TextModelSettings::default()
        })
        .expect("encode");
        assert!(encoded.contains("model_dir"));
        let legacy: TextModelSettings = serde_json::from_str("{}").expect("legacy");
        assert_eq!(legacy.model_dir, None);
        assert_eq!(legacy.provider, TextEmbeddingProviderKind::LocalOnnx);
        assert_eq!(legacy.timeout_ms, 60_000);
    }

    #[test]
    fn an_api_provider_needs_endpoint_model_and_dimensions() {
        assert!(api_settings().validate().is_ok());

        let no_endpoint = TextModelSettings {
            endpoint: None,
            ..api_settings()
        };
        assert!(no_endpoint.validate().is_err());

        let no_model = TextModelSettings {
            model: None,
            ..api_settings()
        };
        assert!(no_model.validate().is_err());

        let no_dimensions = TextModelSettings {
            dimensions: None,
            ..api_settings()
        };
        assert!(no_dimensions.validate().is_err());

        let bad_dimensions = TextModelSettings {
            dimensions: Some(0),
            ..api_settings()
        };
        assert!(bad_dimensions.validate().is_err());
    }

    #[test]
    fn plain_http_is_only_allowed_on_loopback() {
        assert!(is_loopback_endpoint("http://127.0.0.1:11434/v1"));
        assert!(is_loopback_endpoint("http://localhost:8000"));
        assert!(is_loopback_endpoint("http://[::1]:8000/v1"));
        assert!(!is_loopback_endpoint("http://api.example.com/v1"));
        assert!(is_loopback_endpoint("https://localhost:443/v1"));

        let remote_http = TextModelSettings {
            endpoint: Some("http://api.example.com/v1".to_string()),
            ..api_settings()
        };
        assert!(remote_http.validate().is_err());

        let local_http = TextModelSettings {
            endpoint: Some("http://127.0.0.1:11434/v1".to_string()),
            ..api_settings()
        };
        assert!(local_http.validate().is_ok());
    }

    #[test]
    fn a_stored_api_key_survives_a_save_that_omits_it() {
        // The settings screen writes the key only when the user types one; the command
        // merges instead of clearing, so a value saved earlier must still validate.
        let mut settings = api_settings();
        settings.api_key = None;
        assert!(settings.validate().is_ok());
        assert_eq!(settings.api_key, None);
    }
}

/// Whether the app starts the local visual service on demand.
///
/// A user should not have to keep a terminal open for the second retrieval channel, so the
/// local transport auto-starts when a visual channel is needed and the service is not
/// answering. Remote transports never auto-start anything.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VisualServiceStartup {
    /// Start it when needed (default).
    OnDemand,
    /// Never start it; require an already running service.
    Manual,
}

impl Default for VisualServiceStartup {
    fn default() -> Self {
        Self::OnDemand
    }
}

impl VisualServiceStartup {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OnDemand => "on_demand",
            Self::Manual => "manual",
        }
    }
}


/// Which backend runs the model-backed rerank rung.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RerankTransport {
    /// Local ONNX cross-encoder in the app process.
    Local,
    /// Hosted rerank API (Jina, Cohere, or anything with the same shape).
    Api,
}

impl Default for RerankTransport {
    fn default() -> Self {
        Self::Local
    }
}

impl RerankTransport {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Api => "api",
        }
    }
}

/// Request/response shape of a hosted embedding or rerank endpoint.
///
/// `protocol` is the Jina/Cohere shape the app shipped first (`results[]` at the top level,
/// `{model, query, documents}`); `dashscope` is Alibaba Model Studio's native shape
/// (`output.results[]`, `{model, input:{query, documents}, parameters:{...}}`).
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteApiStyle {
    Protocol,
    DashScope,
}

impl Default for RemoteApiStyle {
    fn default() -> Self {
        Self::Protocol
    }
}

impl RemoteApiStyle {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Protocol => "protocol",
            Self::DashScope => "dashscope",
        }
    }
}
