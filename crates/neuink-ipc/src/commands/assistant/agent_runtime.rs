use std::{
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    time::Instant,
};

mod evidence;
mod llm;
mod types;
mod util;

pub use types::{AgentRuntimeSettings, RunAgentSubagentTaskRequest, RunAgentSubagentTaskResponse};

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
    serde_json::from_slice(&bytes).map(Some).map_err(|error| {
        format!(
            "无法读取 Agent Runtime 配置 {}: {error}",
            path.to_string_lossy()
        )
    })
}

pub fn save_agent_runtime_settings(request: SaveAgentRuntimeSettingsRequest) -> Result<(), String> {
    let path = agent_runtime_settings_path(&request.root)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        ensure_subagent_manifests(parent, &request.settings)?;
    }
    let bytes = serde_json::to_vec_pretty(&request.settings).map_err(|error| error.to_string())?;
    fs::write(path, bytes).map_err(|error| error.to_string())
}

pub fn invoke_mcp_tool(name: String, args: serde_json::Value) -> Result<serde_json::Value, String> {
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
    let mut parts = name.split('.');
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

    let command_parts = split_command(&server.command);
    let Some((program, program_args)) = command_parts.split_first() else {
        return Err(format!("MCP server command is empty: {server_id}"));
    };
    let mut child = Command::new(program)
        .args(program_args)
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start MCP tool package {server_id}: {error}"))?;

    let payload = serde_json::json!({
        "tool": tool_name,
        "args": tool_args,
    });
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(payload.to_string().as_bytes())
            .map_err(|error| error.to_string())?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed to wait for MCP tool package {server_id}: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "MCP tool package {server_id} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed = serde_json::from_str::<serde_json::Value>(&stdout)
        .unwrap_or_else(|_| serde_json::json!({ "text": stdout }));
    Ok(serde_json::json!({
        "summary": format!("Executed MCP tool {tool_name} through {server_id}."),
        "output": parsed
    }))
}

fn split_command(command: &str) -> Vec<String> {
    command
        .split_whitespace()
        .map(ToString::to_string)
        .collect()
}

fn agent_runtime_settings_path(root: &std::path::Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root)
        .map_err(|error| format!("无法读取工作区路径 {}: {error}", root.to_string_lossy()))?;
    Ok(root.join("agent-runtime").join("settings.json"))
}

fn ensure_subagent_manifests(
    runtime_dir: &std::path::Path,
    settings: &AgentRuntimeSettings,
) -> Result<(), String> {
    for agent in &settings.subagents {
        if agent.kind != "subagent" {
            continue;
        }
        let dir = runtime_dir.join("subagents").join(safe_id(&agent.id));
        fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        let toml_path = dir.join("SUBAGENT.toml");
        if !toml_path.exists() {
            fs::write(
                &toml_path,
                format!(
                    "id = \"{}\"\nname = \"{}\"\noutput_kind = \"{}\"\nsandbox = \"{}\"\n\n[permissions]\ncan_read_workspace_wide = {}\ncan_write_proposals = {}\ncan_use_skills = {}\ncan_invoke_tools = {}\n",
                    escape_toml(&agent.id),
                    escape_toml(&agent.name),
                    escape_toml(agent.output_kind.as_deref().unwrap_or("evidence")),
                    escape_toml(agent.sandbox.as_deref().unwrap_or("read-only")),
                    agent.permissions.can_read_workspace_wide,
                    agent.permissions.can_write_proposals,
                    agent.permissions.can_use_skills,
                    agent.permissions.can_invoke_tools
                ),
            )
            .map_err(|error| error.to_string())?;
        }
        let markdown_path = dir.join("SUBAGENT.md");
        if !markdown_path.exists() {
            fs::write(
                markdown_path,
                format!(
                    "# {}\n\n{}\n\n## System Prompt\n\n{}\n",
                    agent.name, agent.description, agent.system_prompt
                ),
            )
            .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn safe_id(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn escape_toml(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

struct LoadedSubagentManifest {
    markdown: Option<String>,
}

fn load_subagent_manifest(
    root: &std::path::Path,
    agent: &types::AgentProfile,
) -> Result<LoadedSubagentManifest, String> {
    let Some(manifest_path) = agent.subagent_manifest_path.as_deref() else {
        return Ok(LoadedSubagentManifest { markdown: None });
    };
    let root = fs::canonicalize(root)
        .map_err(|error| format!("无法读取工作区路径 {}: {error}", root.to_string_lossy()))?;
    let toml_path = root.join(manifest_path);
    if !toml_path.exists() {
        return Ok(LoadedSubagentManifest { markdown: None });
    }
    let toml = fs::read_to_string(&toml_path).map_err(|error| error.to_string())?;
    validate_subagent_manifest(&toml, agent)?;
    let markdown_path = toml_path
        .parent()
        .map(|parent| parent.join("SUBAGENT.md"))
        .filter(|path| path.exists());
    let markdown = markdown_path
        .map(fs::read_to_string)
        .transpose()
        .map_err(|error| error.to_string())?;
    Ok(LoadedSubagentManifest { markdown })
}

fn validate_subagent_manifest(toml: &str, agent: &types::AgentProfile) -> Result<(), String> {
    let manifest_id = manifest_string_field(toml, "id");
    if manifest_id.as_deref().is_some_and(|id| id != agent.id) {
        return Err(format!(
            "SUBAGENT.toml id does not match runtime agent id: {}",
            agent.id
        ));
    }
    let output_kind = manifest_string_field(toml, "output_kind");
    if let (Some(manifest_output), Some(agent_output)) =
        (output_kind.as_deref(), agent.output_kind.as_deref())
    {
        if manifest_output != agent_output {
            return Err(format!(
                "SUBAGENT.toml output_kind does not match runtime agent {}",
                agent.id
            ));
        }
    }
    Ok(())
}

fn manifest_string_field(toml: &str, key: &str) -> Option<String> {
    let prefix = format!("{key} = ");
    toml.lines()
        .map(str::trim)
        .find_map(|line| line.strip_prefix(&prefix))
        .map(str::trim)
        .and_then(|value| value.strip_prefix('"')?.strip_suffix('"'))
        .map(ToString::to_string)
}

// 思路借鉴自 opencode：agent/profile/tool 运行时分层，Neuink 保留阅读工具域与证据接地。
pub async fn run_agent_subagent_task_impl<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: RunAgentSubagentTaskRequest,
) -> Result<RunAgentSubagentTaskResponse, String> {
    let started = Instant::now();
    let agent = llm::resolve_agent(&request.runtime_settings, &request.agent_id)?;
    let manifest = load_subagent_manifest(&request.root, &agent)?;
    let profile = llm::resolve_profile(&request.profiles, agent.llm_profile_id.as_deref())?;
    let skill_packages = llm::resolve_skill_packages(&request.runtime_settings, &agent);
    let mut trace = vec![util::trace_event(
        "agent.resolve",
        started,
        format!(
            "Resolved agent {} with {} skill package(s).",
            agent.name,
            skill_packages.len()
        ),
    )];

    let evidence_started = Instant::now();
    let mut evidence = evidence::collect_evidence(app, &request).await?;
    trace.append(&mut evidence.trace);
    trace.push(util::trace_event(
        "agent.evidence",
        evidence_started,
        format!(
            "Collected {} source(s) for the delegated task.",
            evidence.sources.len()
        ),
    ));

    let prompt = llm::build_prompt(&request, &agent, &skill_packages, &evidence.text);
    let llm_started = Instant::now();
    let answer = llm::complete_chat(
        &profile,
        llm::build_system_prompt(&agent, &skill_packages, manifest.markdown.as_deref()),
        prompt,
    )
    .await?;
    trace.push(util::trace_event(
        "agent.llm",
        llm_started,
        format!(
            "Completed model call with {} output chars.",
            answer.chars().count()
        ),
    ));

    Ok(RunAgentSubagentTaskResponse {
        agent_id: agent.id,
        agent_name: agent.name,
        answer,
        sources: evidence.sources,
        trace,
    })
}
