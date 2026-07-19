use neuink_config::LlmProfile;
use serde::Deserialize;
use serde_json::{json, Value};

use super::types::{AgentProfile, AgentRuntimeSettings, RunAgentSubagentTaskRequest, SkillPackage};
use super::util::trim_chars;

pub(crate) async fn complete_chat(
    profile: &LlmProfile,
    system_prompt: String,
    user_prompt: String,
) -> Result<String, String> {
    let url = format!(
        "{}/chat/completions",
        profile.base_url.trim_end_matches('/')
    );
    let mut body = json!({
        "model": profile.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
    });
    set_optional(&mut body, "temperature", profile.temperature);
    set_optional(&mut body, "top_p", profile.top_p);
    if let Some(max_tokens) = profile.max_output_tokens {
        body["max_tokens"] = json!(max_tokens);
    }

    let client = reqwest::Client::new();
    let mut request = client.post(url).json(&body);
    if let Some(api_key) = profile
        .api_key
        .as_deref()
        .filter(|key| !key.trim().is_empty())
    {
        request = request.bearer_auth(api_key);
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    if !status.is_success() {
        let message = response
            .text()
            .await
            .unwrap_or_else(|_| "Unable to read model error body.".to_string());
        return Err(format!("LLM request failed: HTTP {status}. {message}"));
    }

    let payload = response
        .json::<ChatCompletionResponse>()
        .await
        .map_err(|error| error.to_string())?;
    payload
        .choices
        .into_iter()
        .find_map(|choice| choice.message.content)
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| "LLM response did not contain message content.".to_string())
}

pub(crate) fn build_system_prompt(
    agent: &AgentProfile,
    skill_packages: &[SkillPackage],
    subagent_manifest_markdown: Option<&str>,
) -> String {
    let mut lines = vec![
        agent.system_prompt.trim().to_string(),
        String::new(),
        format!("Agent Identity: {}", agent.name),
    ];
    if !agent.description.trim().is_empty() {
        lines.push(format!("Agent Description: {}", agent.description));
    }
    if !agent.kind.trim().is_empty() {
        lines.push(format!("Agent Kind: {}", agent.kind));
    }
    if let Some(output_kind) = agent.output_kind.as_deref() {
        lines.push(format!("Subagent Output Kind: {output_kind}"));
    }
    if let Some(markdown) = subagent_manifest_markdown.filter(|value| !value.trim().is_empty()) {
        lines.push("Subagent Manifest Instructions:".to_string());
        lines.push(trim_chars(markdown.to_string(), 8_000));
    }
    if skill_packages.is_empty() {
        lines.push("Available Skill Metadata: none".to_string());
    } else {
        lines.push("Available Skill Metadata:".to_string());
        for skill_package in skill_packages {
            lines.push(format!(
                "- {} ({}): {} Triggers: {}. Resources: refs={}, scripts={}, assets={}.",
                skill_package.name,
                skill_package.id,
                if skill_package.description.trim().is_empty() {
                    "No description."
                } else {
                    skill_package.description.trim()
                },
                if skill_package.triggers.is_empty() {
                    "none".to_string()
                } else {
                    skill_package.triggers.join(", ")
                },
                skill_package.resource_paths.references.len(),
                skill_package.resource_paths.scripts.len(),
                skill_package.resource_paths.assets.len()
            ));
        }
    }
    lines.push("Skill loading rule: this one-shot subagent receives metadata only. It must not pretend to have executed or fully read a Skill unless the caller provided those instructions explicitly.".to_string());
    lines.push("Skill script rule: scripts inside Skills are auxiliary resources and must not be executed directly. Executable actions must go through MCP or an approved Tool Package.".to_string());
    lines.join("\n")
}

pub(crate) fn build_prompt(
    request: &RunAgentSubagentTaskRequest,
    agent: &AgentProfile,
    skill_packages: &[SkillPackage],
    evidence: &str,
) -> String {
    let history = request
        .conversation_history
        .iter()
        .rev()
        .take(6)
        .rev()
        .map(|message| {
            format!(
                "{}: {}",
                message.role,
                trim_chars(message.content.clone(), 1_200)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let scope = request
        .scope
        .entry_ids
        .iter()
        .enumerate()
        .map(|(index, id)| {
            format!(
                "- {} ({})",
                request
                    .scope
                    .entry_titles
                    .get(index)
                    .cloned()
                    .unwrap_or_else(|| id.to_string()),
                id
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let skill_package_names = skill_packages
        .iter()
        .map(|skill_package| skill_package.name.clone())
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "You are executing a delegated Neuink reading task.\n\nAgent: {}\nLoaded skill packages: {}\n\nUser question:\n{}\n\nDelegated instruction:\n{}\n\nScope:\n{}\n\nRecent conversation:\n{}\n\nEvidence:\n{}\n\nReturn a concise, grounded answer. If evidence is missing, say exactly what is missing.",
        agent.name,
        if skill_package_names.is_empty() { "none".to_string() } else { skill_package_names },
        request.question,
        request.instruction,
        if scope.is_empty() { "Current workspace scope." } else { &scope },
        if history.is_empty() { "None." } else { &history },
        if evidence.trim().is_empty() { "No evidence was found." } else { evidence },
    )
}

pub(crate) fn resolve_agent(
    settings: &AgentRuntimeSettings,
    agent_id: &str,
) -> Result<AgentProfile, String> {
    settings
        .subagents
        .iter()
        .find(|agent| agent.enabled && agent.id == agent_id)
        .or_else(|| (settings.main_assistant.id == agent_id).then_some(&settings.main_assistant))
        .or(Some(&settings.main_assistant))
        .cloned()
        .ok_or_else(|| "Agent runtime has no available agent profile.".to_string())
}

pub(crate) fn resolve_profile(
    profiles: &[LlmProfile],
    preferred_id: Option<&str>,
) -> Result<LlmProfile, String> {
    preferred_id
        .and_then(|id| profiles.iter().find(|profile| profile.id == id))
        .or_else(|| profiles.first())
        .cloned()
        .ok_or_else(|| "No LLM profile is available for Rust agent execution.".to_string())
}

pub(crate) fn resolve_skill_packages(
    settings: &AgentRuntimeSettings,
    agent: &AgentProfile,
) -> Vec<SkillPackage> {
    settings
        .skill_packages
        .iter()
        .filter(|skill_package| {
            skill_package.enabled
                && agent
                    .allowed_skill_package_ids
                    .iter()
                    .any(|id| id == &skill_package.id)
        })
        .cloned()
        .collect()
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: Option<String>,
}

fn set_optional(body: &mut Value, key: &str, value: Option<f32>) {
    if let Some(value) = value {
        body[key] = json!(value);
    }
}
