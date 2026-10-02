use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeSettings {
    #[serde(default)]
    pub capability_revision: u32,
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capability_revision_survives_native_storage_and_unknown_extension_fields_do_not() {
        let settings:AgentRuntimeSettings=serde_json::from_value(serde_json::json!({
            "version":4,"capabilityRevision":1,"unusedExtension":{},
            "mainAssistant":{"id":"main-assistant","name":"Main","permissions":{},"systemPrompt":"Host tools only","enabledToolIds":["read_note"]}
        })).unwrap();
        let stored = serde_json::to_value(settings).unwrap();
        assert_eq!(stored["capabilityRevision"], 1);
        assert_eq!(
            stored["mainAssistant"]["enabledToolIds"],
            serde_json::json!(["read_note"])
        );
        assert!(stored.get("unusedExtension").is_none());
    }
}
