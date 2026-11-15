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
}

impl Default for VisualEmbeddingSettings {
    fn default() -> Self {
        Self {
            provider: VisualEmbeddingProviderKind::QwenLocal,
            endpoint: default_visual_local_endpoint(),
            api_key: None,
            timeout_ms: default_visual_timeout_ms(),
            fusion: VisualFusionSettings::default(),
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
            fallback_heuristic: true,
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
        assert!(settings.validate().is_ok());
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
}

impl RetrievalSettings {
    pub fn validate(&self) -> Result<(), String> {
        Ok(())
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
        let settings = RetrievalSettings { unified: true };
        let encoded = serde_json::to_string(&settings).expect("encode");
        assert_eq!(encoded, r#"{"unified":true}"#);
        let decoded: RetrievalSettings = serde_json::from_str(&encoded).expect("decode");
        assert!(decoded.unified);
        // An older settings file without the field still loads.
        let legacy: RetrievalSettings = serde_json::from_str("{}").expect("legacy");
        assert!(!legacy.unified);
    }
}




/// Which text embedding model the search path uses.
///
/// `model_dir` is an absolute directory holding `neuink-embedding.json` plus an ONNX file;
/// `None` means the bundled resource directory. The dimension and pooling come from that
/// manifest, so switching models never needs a code change.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct TextModelSettings {
    /// Absolute model directory, or `None` for the bundled one.
    pub model_dir: Option<String>,
}

impl TextModelSettings {
    pub fn validate(&self) -> Result<(), String> {
        if let Some(dir) = self.model_dir.as_deref() {
            if dir.trim().is_empty() {
                return Err("文本嵌入模型目录不能是空串；留空表示使用内置模型".to_string());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod text_model_settings_tests {
    use super::TextModelSettings;

    #[test]
    fn the_bundled_model_is_the_default() {
        let settings = TextModelSettings::default();
        assert_eq!(settings.model_dir, None);
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn an_empty_directory_is_rejected_but_an_absolute_one_is_accepted() {
        let blank = TextModelSettings {
            model_dir: Some("   ".to_string()),
        };
        assert!(blank.validate().is_err());
        let absolute = TextModelSettings {
            model_dir: Some(r"D:\models\bge-m3-int8".to_string()),
        };
        assert!(absolute.validate().is_ok());
    }

    #[test]
    fn the_field_round_trips_and_older_settings_still_load() {
        let encoded = serde_json::to_string(&TextModelSettings {
            model_dir: Some("D:/m".to_string()),
        })
        .expect("encode");
        assert!(encoded.contains("model_dir"));
        let legacy: TextModelSettings = serde_json::from_str("{}").expect("legacy");
        assert_eq!(legacy.model_dir, None);
    }
}

