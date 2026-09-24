use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeSettings {
    pub main_assistant: AgentProfile,
    #[serde(default)]
    pub mcp_servers: Vec<AgentMcpServer>,
    #[serde(default)]
    pub subagents: Vec<AgentProfile>,
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
    pub can_write_proposals: bool,
}
