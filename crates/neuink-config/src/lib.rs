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
    #[serde(default)]
    pub recent_workspaces: Vec<RecentWorkspace>,
    pub autosave_interval_ms: Option<u64>,
    pub theme: Option<String>,
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
}
