use std::{fs, path::PathBuf};

mod mcp;
mod types;
pub use mcp::cancel as cancel_mcp_call;

pub use types::AgentRuntimeSettings;

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadAgentRuntimeSettingsRequest {
    pub root: PathBuf,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAgentRuntimeSettingsRequest {
    pub root: PathBuf,
    pub settings: AgentRuntimeSettings,
}

pub fn load_agent_runtime_settings(
    request: LoadAgentRuntimeSettingsRequest,
) -> Result<Option<AgentRuntimeSettings>, String> {
    let path = agent_runtime_settings_path(&request.root)?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    serde_json::from_slice::<AgentRuntimeSettings>(&bytes)
        .map(|settings| (settings.version == 4).then_some(settings))
        .map_err(|error| {
            format!(
                "无法读取 Agent Runtime 配置 {}: {error}",
                path.to_string_lossy()
            )
        })
}

pub fn save_agent_runtime_settings(request: SaveAgentRuntimeSettingsRequest) -> Result<(), String> {
    if request.settings.version != 4 {
        return Err("Unsupported agent runtime configuration version".into());
    }
    let path = agent_runtime_settings_path(&request.root)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(&request.settings).map_err(|error| error.to_string())?;
    neuink_workspace::atomic_write(path, &bytes).map_err(|error| error.to_string())
}

pub async fn invoke_mcp_tool(
    name: String,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let object = args
        .as_object()
        .ok_or_else(|| "mcp tool args must be an object".to_string())?;
    let root: PathBuf = serde_json::from_value(
        object
            .get("root")
            .cloned()
            .ok_or_else(|| "root is required for mcp tool execution".to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let tool_args = object
        .get("args")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let mut parts = name.splitn(3, '.');
    let _prefix = parts.next();
    let server_id = parts
        .next()
        .ok_or_else(|| format!("invalid mcp tool name: {name}"))?;
    let tool_name = parts
        .next()
        .ok_or_else(|| format!("invalid mcp tool name: {name}"))?;

    let settings =
        load_agent_runtime_settings(LoadAgentRuntimeSettingsRequest { root: root.clone() })?
            .ok_or_else(|| "Agent runtime settings not found".to_string())?;
    let server = settings
        .mcp_servers
        .iter()
        .find(|server| server.id == server_id)
        .ok_or_else(|| format!("MCP server not found: {server_id}"))?;
    if !server.enabled {
        return Err(format!("MCP server disabled: {server_id}"));
    }
    if !server
        .allowed_tool_names
        .iter()
        .any(|item| item == tool_name)
    {
        return Err(format!("MCP tool not allowed: {tool_name}"));
    }
    if server.command.trim().is_empty() {
        return Err(format!("MCP server command is empty: {server_id}"));
    }

    require_mcp_grant(&settings, server_id, tool_name)?;
    let id = object
        .get("call_id")
        .and_then(serde_json::Value::as_str)
        .ok_or("MCP call id required")?;
    let result = mcp::request(
        &root,
        &server.command,
        id.to_string(),
        "tools/call",
        serde_json::json!({"name":tool_name,"arguments":tool_args}),
    )
    .await?;
    if result.get("isError").and_then(serde_json::Value::as_bool) == Some(true) {
        return Err("MCP tool reported execution failure".into());
    }
    Ok(serde_json::json!({"summary":format!("Executed MCP tool {tool_name}."),"output":result}))
}

fn require_mcp_grant(
    settings: &AgentRuntimeSettings,
    server: &str,
    tool: &str,
) -> Result<(), String> {
    let id = format!("mcp.{server}.{tool}");
    if !settings.tool_packages.iter().any(|package| {
        package.enabled
            && package.kind == "mcp"
            && package.mcp_server_id.as_deref() == Some(server)
            && package.permission_mode == "allow"
            && package.allowed_tool_ids.contains(&id)
    }) {
        return Err("MCP tool requires an explicit approved Tool Package grant".into());
    }
    Ok(())
}

pub async fn list_mcp_tools(
    root: PathBuf,
    server_id: String,
    call_id: String,
) -> Result<serde_json::Value, String> {
    let settings =
        load_agent_runtime_settings(LoadAgentRuntimeSettingsRequest { root: root.clone() })?
            .ok_or("Agent runtime settings not found")?;
    let server = settings
        .mcp_servers
        .iter()
        .find(|item| item.id == server_id && item.enabled)
        .ok_or("MCP server is disabled or missing")?;
    // Do not even start a process without a locally approved capability.
    let allowed: Vec<_> = server
        .allowed_tool_names
        .iter()
        .filter(|name| require_mcp_grant(&settings, &server_id, name).is_ok())
        .collect();
    if allowed.is_empty() {
        return Ok(serde_json::json!({"tools":[]}));
    }
    let result = mcp::request(
        &root,
        &server.command,
        call_id,
        "tools/list",
        serde_json::json!({}),
    )
    .await?;
    let tools: Vec<_> = result["tools"]
        .as_array()
        .ok_or("Invalid MCP catalog")?
        .iter()
        .filter(|item| {
            item["name"]
                .as_str()
                .is_some_and(|name| allowed.iter().any(|allowed| allowed.as_str() == name))
        })
        .cloned()
        .collect();
    Ok(serde_json::json!({"tools":tools}))
}

fn agent_runtime_settings_path(root: &std::path::Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root)
        .map_err(|error| format!("无法读取工作区路径 {}: {error}", root.to_string_lossy()))?;
    Ok(root.join("agent-runtime").join("settings.json"))
}
