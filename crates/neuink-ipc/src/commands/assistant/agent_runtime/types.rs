use std::path::PathBuf;

use neuink_config::LlmProfile;
use neuink_domain::{EntryId, TagId};
use serde::{Deserialize, Serialize};

use super::super::{AssistantContextSnapshotResponse, EntryAssistantSource};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RunAgentSubagentTaskRequest {
    pub root: PathBuf,
    pub agent_id: String,
    pub instruction: String,
    pub question: String,
    pub runtime_settings: AgentRuntimeSettings,
    #[serde(default)]
    pub profiles: Vec<LlmProfile>,
    #[serde(default)]
    pub context_snapshot: Option<AssistantContextSnapshotResponse>,
    #[serde(default)]
    pub conversation_history: Vec<AgentConversationMessage>,
    pub scope: AgentScopeSnapshot,
}

#[derive(Clone, Debug, Serialize)]
pub struct RunAgentSubagentTaskResponse {
    pub agent_id: String,
    pub agent_name: String,
    pub answer: String,
    pub sources: Vec<EntryAssistantSource>,
    pub trace: Vec<AgentRuntimeTraceEvent>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentRuntimeTraceEvent {
    pub id: String,
    pub label: String,
    pub elapsed_ms: u128,
    pub summary: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AgentConversationMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AgentScopeSnapshot {
    #[serde(default)]
    pub tag_ids: Vec<TagId>,
    #[serde(default)]
    pub tag_names: Vec<String>,
    #[serde(default)]
    pub entry_ids: Vec<EntryId>,
    #[serde(default)]
    pub entry_titles: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeSettings {
    pub main_assistant: AgentProfile,
    #[serde(default)]
    pub mcp_servers: Vec<AgentMcpServer>,
    #[serde(default)]
    pub subagents: Vec<AgentProfile>,
    #[serde(default)]
    pub skill_packages: Vec<SkillPackage>,
    #[serde(default)]
    pub tool_packages: Vec<AgentToolPackage>,
    pub version: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMcpServer {
    #[serde(default)]
    pub allowed_tool_names: Vec<String>,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolPackage {
    #[serde(default)]
    pub allowed_tool_ids: Vec<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub mcp_server_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub permission_mode: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    #[serde(default)]
    pub allowed_subagent_ids: Vec<String>,
    #[serde(default)]
    pub allowed_mcp_server_ids: Vec<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub allowed_skill_package_ids: Vec<String>,
    #[serde(default)]
    pub enabled_tool_ids: Vec<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub llm_profile_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub output_kind: Option<String>,
    pub permissions: AgentPermissions,
    #[serde(default)]
    pub sandbox: Option<String>,
    #[serde(default)]
    pub subagent_manifest_path: Option<String>,
    pub system_prompt: String,
    #[serde(default)]
    pub visible_in_ui: bool,
}

fn default_enabled() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPermissions {
    #[serde(default)]
    pub can_invoke_subagents: bool,
    #[serde(default)]
    pub can_invoke_tools: bool,
    #[serde(default)]
    pub can_read_workspace_wide: bool,
    #[serde(default)]
    pub can_use_skills: bool,
    #[serde(default)]
    pub can_write_proposals: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPackage {
    pub category: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub files: Vec<SkillPackageFile>,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub resource_paths: SkillResourcePaths,
    #[serde(default)]
    pub readme: String,
    #[serde(default)]
    pub script_execution: Option<String>,
    #[serde(default)]
    pub source_archive_path: Option<String>,
    #[serde(default)]
    pub suggested_tool_ids: Vec<String>,
    #[serde(default)]
    pub triggers: Vec<String>,
    #[serde(default)]
    pub version: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPackageFile {
    pub path: String,
    #[serde(default)]
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillResourcePaths {
    #[serde(default)]
    pub assets: Vec<String>,
    #[serde(default)]
    pub references: Vec<String>,
    #[serde(default)]
    pub scripts: Vec<String>,
}

pub(crate) struct EvidenceBundle {
    pub text: String,
    pub sources: Vec<EntryAssistantSource>,
    pub trace: Vec<AgentRuntimeTraceEvent>,
}
