use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    process::Command,
};

use neuink_config::LlmProfile;
use neuink_domain::{EntryId, NoteId, SegmentUid, TagId, TagMeta};
use neuink_search::SearchMode;
use neuink_workspace::Workspace;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::sciverse::{
    assistant_tools_enabled, sciverse_agentic_search, sciverse_meta_catalog, sciverse_meta_search,
    sciverse_paper_schema, sciverse_paper_schema_search, sciverse_read_content,
    SciverseJsonRequest,
};
use super::search::{search_segments, SearchSegmentsRequest};
use super::settings::read_assistant_profile;

mod agent_run_registry;
mod agent_runtime;
mod note_apply;
mod note_apply_content;
mod note_apply_store;
#[cfg(test)]
mod note_apply_tests;
mod skill_package;

pub use note_apply::{ApplyNoteProposalRequest, ApplyNoteProposalResponse};

#[tauri::command]
pub fn apply_note_proposal(
    request: ApplyNoteProposalRequest,
) -> Result<ApplyNoteProposalResponse, String> {
    note_apply::apply_note_proposal_impl(request)
}

#[derive(Clone, Debug, Serialize)]
pub struct ToolDescriptor {
    pub name: String,
    pub description: String,
    pub parameters_schema: Value,
}

#[derive(Clone, Debug, Deserialize)]
pub struct LoadPromptRequest {
    pub name: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct InvokeToolRequest {
    pub name: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ReadSegmentContentRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub segment_uid: SegmentUid,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReadSegmentContentResponse {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub segment_uid: SegmentUid,
    pub page_idx: u32,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ReadEntryAssistantContextRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
}

#[derive(Clone, Debug, Deserialize)]
pub struct OpenPathInFileManagerRequest {
    pub path: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct EntryAssistantSource {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub segment_uid: SegmentUid,
    pub page_idx: u32,
    pub quote: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReadEntryAssistantContextResponse {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub markdown: String,
    pub sources: Vec<EntryAssistantSource>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AnalyzeEntryTagsRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    #[serde(default)]
    pub instruction: String,
    #[serde(default)]
    pub skill_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TagRecommendation {
    pub confidence: f32,
    pub dimension: String,
    pub path: String,
    pub reason: String,
    pub source: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct AnalyzeEntryTagsResponse {
    pub recommendations: Vec<TagRecommendation>,
    pub skill_version: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AssistantActiveNoteRef {
    pub entry_id: EntryId,
    pub note_id: NoteId,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AssistantPinnedSegmentRef {
    pub entry_id: EntryId,
    pub segment_uid: SegmentUid,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AssistantContextSnapshotRequest {
    pub root: PathBuf,
    pub active_entry_id: Option<EntryId>,
    pub active_note: Option<AssistantActiveNoteRef>,
    #[serde(default)]
    pub pinned_segments: Vec<AssistantPinnedSegmentRef>,
    #[serde(default)]
    pub document_char_budget: Option<usize>,
    #[serde(default)]
    pub note_char_budget: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AssistantEntrySnapshot {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub has_pdf: bool,
    pub parse_status: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AssistantNoteSnapshot {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub note_id: NoteId,
    pub note_title: String,
    pub markdown: String,
    pub markdown_char_count: usize,
    pub source_link_count: usize,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AssistantDocumentSnapshot {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub markdown: String,
    pub markdown_char_count: usize,
    pub sources: Vec<EntryAssistantSource>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AssistantPinnedSegmentSnapshot {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub segment_uid: SegmentUid,
    pub page_idx: u32,
    pub text: String,
    pub text_char_count: usize,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AssistantContextSnapshotResponse {
    pub active_entry: Option<AssistantEntrySnapshot>,
    pub active_note: Option<AssistantNoteSnapshot>,
    pub document: Option<AssistantDocumentSnapshot>,
    pub pinned_segments: Vec<AssistantPinnedSegmentSnapshot>,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub fn list_tools<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Vec<ToolDescriptor> {
    let mut tools = vec![
        ToolDescriptor {
            name: "search_segments".to_string(),
            description: "Search parsed PDF source segments within an optional Entry scope. Hybrid mode is preferred and falls back to keyword until local embedding resources are bundled."
                .to_string(),
            parameters_schema: json!({
                "type": "object",
                "properties": {
                    "root": {"type": "string"},
                    "query": {"type": "string"},
                    "scope_entry_ids": {"type": "array", "items": {"type": "string"}},
                    "mode": {"type": "string", "enum": ["keyword", "semantic", "hybrid"]},
                    "top_k": {"type": "number"}
                },
                "required": ["root", "query"]
            }),
        },
        ToolDescriptor {
            name: "read_segment_content".to_string(),
            description: "Read the full text and page for one PDF source segment.".to_string(),
            parameters_schema: json!({
                "type": "object",
                "properties": {
                    "root": {"type": "string"},
                    "entry_id": {"type": "string"},
                    "segment_uid": {"type": "string"}
                },
                "required": ["root", "entry_id", "segment_uid"]
            }),
        },
        ToolDescriptor {
            name: "read_entry_assistant_context".to_string(),
            description: "Read parsed PDF segments for one Entry as assistant-ready markdown."
                .to_string(),
            parameters_schema: json!({
                "type": "object",
                "properties": {
                    "root": {"type": "string"},
                    "entry_id": {"type": "string"}
                },
                "required": ["root", "entry_id"]
            }),
        },
    ];
    if assistant_tools_enabled(&app) {
        tools.extend([
            ToolDescriptor {
                name: "search_sciverse_evidence".to_string(),
                description: "Search Sciverse's remote scientific literature index for citable evidence chunks. Use this for external literature discovery, not for files already in the Neuink workspace."
                    .to_string(),
                parameters_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "query": {"type": "string", "minLength": 1, "maxLength": 4096},
                        "top_k": {"type": "integer", "minimum": 1, "maximum": 20},
                        "sub_queries": {"type": "integer", "minimum": 0, "maximum": 4}
                    },
                    "required": ["query"]
                }),
            },
            ToolDescriptor {
                name: "search_sciverse_metadata".to_string(),
                description: "Search Sciverse's structured paper metadata. Use this for bibliographic filtering, identifiers, venues, authors, and citation metadata; it never writes to the local library.".to_string(),
                parameters_schema: json!({
                    "type": "object", "additionalProperties": false,
                    "properties": {
                        "query": {"type": "string", "minLength": 1, "maxLength": 4096},
                        "fields": {"type": "array", "items": {"type": "string"}, "maxItems": 20},
                        "page": {"type": "integer", "minimum": 1, "maximum": 100},
                        "page_size": {"type": "integer", "minimum": 1, "maximum": 20}
                    }, "required": ["query"]
                }),
            },
            ToolDescriptor {
                name: "get_sciverse_metadata_catalog".to_string(),
                description: "Get the live Sciverse metadata field catalog before constructing unusual structured metadata requests. This is read-only.".to_string(),
                parameters_schema: json!({"type": "object", "additionalProperties": false, "properties": {}}),
            },
            ToolDescriptor {
                name: "search_sciverse_paper_schema".to_string(),
                description: "Search Sciverse Paper Schema definitions and structured research concepts. Use it to clarify available schema fields or domain concepts; this is read-only.".to_string(),
                parameters_schema: json!({
                    "type": "object", "additionalProperties": false,
                    "properties": {"query": {"type": "string", "minLength": 1, "maxLength": 4096}, "page": {"type": "integer", "minimum": 1, "maximum": 100}, "page_size": {"type": "integer", "minimum": 1, "maximum": 20}},
                    "required": ["query"]
                }),
            },
            ToolDescriptor {
                name: "get_sciverse_paper_schema".to_string(),
                description: "Get the Sciverse Paper Schema document. This is read-only and should be used only when the schema definition itself is needed.".to_string(),
                parameters_schema: json!({"type": "object", "additionalProperties": false, "properties": {}}),
            },
            ToolDescriptor {
                name: "read_sciverse_content".to_string(),
                description: "Read a bounded text range from a Sciverse document by doc_id. Use this after search_sciverse_evidence when the returned chunk needs surrounding context."
                    .to_string(),
                parameters_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "doc_id": {"type": "string", "minLength": 1},
                        "offset": {"type": "integer", "minimum": 0},
                        "limit": {"type": "integer", "minimum": 100, "maximum": 12000},
                        "title": {"type": "string"},
                        "chunk_id": {"type": "string"},
                        "page_no": {"type": "integer", "minimum": 0}
                    },
                    "required": ["doc_id"]
                }),
            },
        ]);
    }
    tools
}

#[tauri::command]
pub async fn run_agent_subagent_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: agent_runtime::RunAgentSubagentTaskRequest,
) -> Result<agent_runtime::RunAgentSubagentTaskResponse, String> {
    agent_runtime::run_agent_subagent_task_impl(app, request).await
}

#[tauri::command]
pub async fn analyze_entry_tags<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: AnalyzeEntryTagsRequest,
) -> Result<AnalyzeEntryTagsResponse, String> {
    let profile = read_assistant_profile(&app)?
        .ok_or_else(|| "Please configure an assistant model before analyzing tags.".to_string())?;
    let workspace = Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let context = read_entry_assistant_context_from_workspace(&workspace, request.entry_id)?;
    if context.markdown.trim().is_empty() {
        return Ok(AnalyzeEntryTagsResponse {
            recommendations: Vec::new(),
            skill_version: "empty-document".to_string(),
        });
    }

    let tags = workspace.list_tags().map_err(|error| error.to_string())?;
    let existing_paths = tag_paths(&tags);
    let tag_skill = match request.skill_id.as_deref() {
        Some(skill_id) => skill_package::load_skill_package(
            app.clone(),
            skill_package::LoadSkillPackageRequest {
                root: request.root.clone(),
                skill_id: skill_id.to_string(),
            },
        )?,
        None => select_skill_for_task(&app, &request.root, &profile, &request.instruction).await?,
    };
    if !tag_skill.enabled || tag_skill.readme.trim().is_empty() {
        return Err("Selected Tag Skill is disabled or has no instructions.".to_string());
    }
    let skill_instructions = tag_skill.readme.as_str();
    let skill_version = format!("{}:{}", tag_skill.id, tag_skill.version);

    let system_prompt = format!(
        "You are Neuink's paper tagging agent.\n\n{}\n\nReturn JSON only, with this exact shape: {{\"tags\":[{{\"path\":\"Domain/Method/Leaf\",\"dimension\":\"problem|method|domain|application|dataset\",\"reason\":\"short grounded reason\",\"confidence\":0.0}}]}}.\nRules: propose 2-6 concise, complete taxonomy paths; reuse an existing path when appropriate, but you may propose a new path when it is more accurate. Never emit raw sentence fragments, truncated words, generic roots such as 主题, or a tag unless it represents a stable research concept. Do not apply or create tags yourself.",
        trim_to_char_budget(skill_instructions.to_string(), 12_000).0,
    );
    let user_prompt = format!(
        "User tagging request (follow language, naming, granularity, and count preferences when specified):\n{}\n\nExisting tag tree:\n{}\n\nPaper content:\n{}",
        if request.instruction.trim().is_empty() {
            "Suggest useful tags for this paper."
        } else {
            request.instruction.trim()
        },
        if existing_paths.is_empty() {
            "(empty)".to_string()
        } else {
            existing_paths.join("\n")
        },
        trim_to_char_budget(context.markdown, 24_000).0,
    );
    let answer = complete_tag_chat(&profile, system_prompt, user_prompt).await?;
    let recommendations = parse_tag_recommendations(&answer, &existing_paths)?;

    Ok(AnalyzeEntryTagsResponse {
        recommendations,
        skill_version,
    })
}

async fn select_skill_for_task<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    root: &std::path::Path,
    profile: &LlmProfile,
    instruction: &str,
) -> Result<skill_package::ImportedSkillPackage, String> {
    let candidates = skill_package::list_skill_packages(
        app.clone(),
        skill_package::ListSkillPackagesRequest {
            root: root.to_path_buf(),
        },
    )?
    .into_iter()
    .filter(|skill| skill.enabled)
    .collect::<Vec<_>>();
    if candidates.is_empty() {
        return Err("Skill Registry has no enabled Skills.".to_string());
    }
    let metadata = candidates
        .iter()
        .map(|skill| {
            json!({
                "category": skill.category,
                "description": skill.description,
                "id": skill.id,
                "name": skill.name,
                "triggers": skill.triggers,
            })
        })
        .collect::<Vec<_>>();
    let answer = complete_tag_chat(
        profile,
        "You are Neuink SkillSelectorAgent. Select exactly one Skill from registry metadata for the task. Return JSON only: {\"skill_id\":\"exact-id\",\"reason\":\"short reason\"}. Never invent an id and do not execute the task.".to_string(),
        format!(
            "Task:\n{}\n\nSkill Registry:\n{}",
            if instruction.trim().is_empty() {
                "Suggest useful tags for this paper."
            } else {
                instruction.trim()
            },
            serde_json::to_string(&metadata).map_err(|error| error.to_string())?
        ),
    )
    .await?;
    let selected_id = parse_selected_skill_id(&answer)?;
    candidates
        .into_iter()
        .find(|skill| skill.id == selected_id)
        .ok_or_else(|| "SkillSelectorAgent selected an unavailable Skill.".to_string())
}

fn parse_selected_skill_id(answer: &str) -> Result<String, String> {
    let start = answer
        .find('{')
        .ok_or_else(|| "SkillSelectorAgent returned no JSON.".to_string())?;
    let end = answer
        .rfind('}')
        .ok_or_else(|| "SkillSelectorAgent returned invalid JSON.".to_string())?;
    let payload: Value = serde_json::from_str(&answer[start..=end])
        .map_err(|error| format!("SkillSelectorAgent returned invalid JSON: {error}"))?;
    payload
        .get("skill_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "SkillSelectorAgent selected no Skill.".to_string())
}

#[tauri::command]
pub fn load_agent_runtime_settings(
    request: agent_runtime::LoadAgentRuntimeSettingsRequest,
) -> Result<Option<agent_runtime::AgentRuntimeSettings>, String> {
    agent_runtime::load_agent_runtime_settings(request)
}

#[tauri::command]
pub fn save_agent_runtime_settings(
    request: agent_runtime::SaveAgentRuntimeSettingsRequest,
) -> Result<(), String> {
    agent_runtime::save_agent_runtime_settings(request)
}

#[tauri::command]
pub fn save_agent_run(request: agent_run_registry::SaveAgentRunRequest) -> Result<(), String> {
    agent_run_registry::save_agent_run(request)
}

#[tauri::command]
pub fn list_agent_runs(
    request: agent_run_registry::ListAgentRunsRequest,
) -> Result<Vec<agent_run_registry::AgentRunRecordSummary>, String> {
    agent_run_registry::list_agent_runs(request)
}

#[tauri::command]
pub fn read_agent_run(
    request: agent_run_registry::ReadAgentRunRequest,
) -> Result<agent_run_registry::AgentRunRecord, String> {
    agent_run_registry::read_agent_run(request)
}

#[tauri::command]
pub fn delete_agent_run(request: agent_run_registry::DeleteAgentRunRequest) -> Result<(), String> {
    agent_run_registry::delete_agent_run(request)
}

#[tauri::command]
pub fn prune_agent_runs(
    request: agent_run_registry::PruneAgentRunsRequest,
) -> Result<agent_run_registry::PruneAgentRunsResponse, String> {
    agent_run_registry::prune_agent_runs(request)
}

#[tauri::command]
pub fn import_skill_package_archive<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: skill_package::ImportSkillPackageArchiveRequest,
) -> Result<skill_package::ImportedSkillPackage, String> {
    skill_package::import_skill_package_archive(app, request)
}

#[tauri::command]
pub fn list_skill_packages<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: skill_package::ListSkillPackagesRequest,
) -> Result<Vec<skill_package::ImportedSkillPackage>, String> {
    skill_package::list_skill_packages(app, request)
}

#[tauri::command]
pub fn load_skill_package<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: skill_package::LoadSkillPackageRequest,
) -> Result<skill_package::ImportedSkillPackage, String> {
    skill_package::load_skill_package(app, request)
}

#[tauri::command]
pub fn load_prompt(request: LoadPromptRequest) -> Result<String, String> {
    match request.name.as_str() {
        "qna_system" => Ok(include_str!("../../prompts/qna_system.md").to_string()),
        "qna_user" => Ok(include_str!("../../prompts/qna_user.md").to_string()),
        "ask_segment" => Ok(include_str!("../../prompts/ask_segment.md").to_string()),
        "assistant_router" => Ok(include_str!("../../prompts/assistant_router.md").to_string()),
        _ => Err(format!("unknown prompt: {}", request.name)),
    }
}

fn normalized_sciverse_metadata_payload(value: Value) -> Result<Value, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "Sciverse metadata search input must be an object.".to_string())?;
    let query = object
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|query| !query.is_empty())
        .ok_or_else(|| "query is required for Sciverse metadata search.".to_string())?;
    let fields = object
        .get("fields")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .take(20)
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| {
            vec![
                "unique_id",
                "doc_id",
                "title",
                "abstract",
                "author",
                "doi",
                "publication_published_year",
                "publication_venue_name_unified",
                "citation_count",
                "access_oa_url",
                "access_license",
                "file_name",
            ]
        });
    Ok(json!({"query": query, "filters": [], "fields": fields,
        "page": object.get("page").and_then(Value::as_u64).unwrap_or(1).clamp(1, 100),
        "page_size": object.get("page_size").and_then(Value::as_u64).unwrap_or(10).clamp(1, 20)}))
}

fn normalized_sciverse_schema_payload(value: Value) -> Result<Value, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "Sciverse Paper Schema search input must be an object.".to_string())?;
    let query = object
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|query| !query.is_empty())
        .ok_or_else(|| "query is required for Sciverse Paper Schema search.".to_string())?;
    Ok(json!({"query": query,
        "page": object.get("page").and_then(Value::as_u64).unwrap_or(1).clamp(1, 100),
        "page_size": object.get("page_size").and_then(Value::as_u64).unwrap_or(10).clamp(1, 20)}))
}

#[tauri::command]
pub async fn invoke_tool<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: InvokeToolRequest,
) -> Result<Value, String> {
    match request.name.as_str() {
        "search_segments" => invoke_search_segments(app, request.args).await,
        "search_sciverse_evidence" => {
            let args: neuink_sciverse::AgenticSearchRequest =
                serde_json::from_value(request.args).map_err(|error| error.to_string())?;
            let result = sciverse_agentic_search(app, args).await?;
            serde_json::to_value(result).map_err(|error| error.to_string())
        }
        "read_sciverse_content" => {
            let args: neuink_sciverse::ContentRequest =
                serde_json::from_value(request.args).map_err(|error| error.to_string())?;
            let result = sciverse_read_content(app, args).await?;
            serde_json::to_value(result).map_err(|error| error.to_string())
        }
        "search_sciverse_metadata" => {
            let payload = normalized_sciverse_metadata_payload(request.args)?;
            let result = sciverse_meta_search(app, SciverseJsonRequest { payload }).await?;
            Ok(result)
        }
        "get_sciverse_metadata_catalog" => sciverse_meta_catalog(app).await,
        "search_sciverse_paper_schema" => {
            let payload = normalized_sciverse_schema_payload(request.args)?;
            let result = sciverse_paper_schema_search(app, SciverseJsonRequest { payload }).await?;
            Ok(result)
        }
        "get_sciverse_paper_schema" => sciverse_paper_schema(app).await,
        "read_segment_content" => {
            let args: ReadSegmentContentRequest =
                serde_json::from_value(request.args).map_err(|error| error.to_string())?;
            read_segment_content(args).map(|response| json!(response))
        }
        "read_entry_assistant_context" => {
            let args: ReadEntryAssistantContextRequest =
                serde_json::from_value(request.args).map_err(|error| error.to_string())?;
            read_entry_assistant_context(args).map(|response| json!(response))
        }
        name if name.starts_with("mcp.") => {
            agent_runtime::invoke_mcp_tool(name.to_string(), request.args)
        }
        _ => Err(format!("unknown tool: {}", request.name)),
    }
}

#[tauri::command]
pub fn read_segment_content(
    request: ReadSegmentContentRequest,
) -> Result<ReadSegmentContentResponse, String> {
    let workspace = Workspace::open(&request.root).map_err(|error| error.to_string())?;
    read_segment_content_from_workspace(&workspace, request.entry_id, request.segment_uid)
}

#[tauri::command]
pub fn read_entry_assistant_context(
    request: ReadEntryAssistantContextRequest,
) -> Result<ReadEntryAssistantContextResponse, String> {
    let workspace = Workspace::open(&request.root).map_err(|error| error.to_string())?;
    read_entry_assistant_context_from_workspace(&workspace, request.entry_id)
}

#[tauri::command]
pub fn open_path_in_file_manager(request: OpenPathInFileManagerRequest) -> Result<(), String> {
    let path = std::fs::canonicalize(&request.path)
        .map_err(|error| format!("无法打开路径 {}: {error}", request.path.to_string_lossy()))?;
    if !path.exists() {
        return Err(format!("路径不存在: {}", path.to_string_lossy()));
    }
    let target = if path.is_file() {
        path.parent()
            .map(|parent| parent.to_path_buf())
            .unwrap_or_else(|| path.clone())
    } else {
        path.clone()
    };

    #[cfg(target_os = "windows")]
    {
        let target = windows_explorer_path(&target);
        Command::new("explorer")
            .arg(&target)
            .spawn()
            .map_err(|error| format!("打开路径失败: {target}: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|error| format!("打开路径失败: {}: {error}", target.to_string_lossy()))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|error| format!("打开路径失败: {}: {error}", target.to_string_lossy()))?;
        return Ok(());
    }
}

#[cfg(target_os = "windows")]
fn windows_explorer_path(path: &std::path::Path) -> String {
    let text = path.to_string_lossy();
    if let Some(stripped) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{stripped}")
    } else if let Some(stripped) = text.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        text.to_string()
    }
}

#[tauri::command]
pub fn get_assistant_context_snapshot(
    request: AssistantContextSnapshotRequest,
) -> Result<AssistantContextSnapshotResponse, String> {
    let workspace = Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let mut warnings = Vec::new();
    let document_budget = clamp_context_budget(request.document_char_budget, 240_000);
    let note_budget = clamp_context_budget(request.note_char_budget, 64_000);

    let active_entry = request.active_entry_id.as_ref().and_then(|entry_id| {
        match workspace.read_entry(entry_id) {
            Ok(entry) => Some(AssistantEntrySnapshot {
                entry_id: entry.id,
                entry_title: entry.title,
                has_pdf: entry.pdf.is_some(),
                parse_status: entry
                    .pdf
                    .as_ref()
                    .map(|pdf| format!("{:?}", pdf.parse.status)),
            }),
            Err(error) => {
                warnings.push(format!("active entry unavailable: {error}"));
                None
            }
        }
    });

    let active_note = request.active_note.as_ref().and_then(|note_ref| {
        let entry = match workspace.read_entry(&note_ref.entry_id) {
            Ok(entry) => entry,
            Err(error) => {
                warnings.push(format!("active note entry unavailable: {error}"));
                return None;
            }
        };
        let note = match workspace.read_note(&note_ref.entry_id, &note_ref.note_id) {
            Ok(note) => note,
            Err(error) => {
                warnings.push(format!("active note unavailable: {error}"));
                return None;
            }
        };
        let source_link_count = note.links.len();
        let (markdown, markdown_char_count, truncated) =
            trim_to_char_budget(note.markdown, note_budget);
        Some(AssistantNoteSnapshot {
            entry_id: note_ref.entry_id.clone(),
            entry_title: entry.title,
            note_id: note.note_id,
            note_title: note.title,
            markdown,
            markdown_char_count,
            source_link_count,
            truncated,
        })
    });

    let document = request.active_entry_id.as_ref().and_then(|entry_id| {
        match read_entry_assistant_context_from_workspace(&workspace, entry_id.clone()) {
            Ok(context) => {
                if context.markdown.trim().is_empty() {
                    return None;
                }
                let (markdown, markdown_char_count, truncated) =
                    trim_to_char_budget(context.markdown, document_budget);
                Some(AssistantDocumentSnapshot {
                    entry_id: context.entry_id,
                    entry_title: context.entry_title,
                    markdown,
                    markdown_char_count,
                    sources: context.sources,
                    truncated,
                })
            }
            Err(error) => {
                warnings.push(format!("entry document context unavailable: {error}"));
                None
            }
        }
    });

    let mut pinned_segments = Vec::new();
    for pinned in request.pinned_segments {
        match read_segment_content_from_workspace(&workspace, pinned.entry_id, pinned.segment_uid) {
            Ok(segment) => {
                let (text, text_char_count, truncated) = trim_to_char_budget(segment.text, 8_000);
                pinned_segments.push(AssistantPinnedSegmentSnapshot {
                    entry_id: segment.entry_id,
                    entry_title: segment.entry_title,
                    segment_uid: segment.segment_uid,
                    page_idx: segment.page_idx,
                    text,
                    text_char_count,
                    truncated,
                });
            }
            Err(error) => warnings.push(format!("pinned segment unavailable: {error}")),
        }
    }

    Ok(AssistantContextSnapshotResponse {
        active_entry,
        active_note,
        document,
        pinned_segments,
        warnings,
    })
}

fn read_segment_content_from_workspace(
    workspace: &Workspace,
    entry_id: EntryId,
    segment_uid: SegmentUid,
) -> Result<ReadSegmentContentResponse, String> {
    let entry = workspace
        .read_entry(&entry_id)
        .map_err(|error| error.to_string())?;
    let segment = workspace
        .read_segments(&entry_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|segment| segment_matches_uid(segment, &segment_uid))
        .ok_or_else(|| format!("segment not found: {segment_uid}"))?;

    Ok(ReadSegmentContentResponse {
        entry_id,
        entry_title: entry.title,
        segment_uid: segment.uid,
        page_idx: segment.page_idx,
        text: segment.markdown.unwrap_or(segment.text),
    })
}

fn read_entry_assistant_context_from_workspace(
    workspace: &Workspace,
    entry_id: EntryId,
) -> Result<ReadEntryAssistantContextResponse, String> {
    let entry = workspace
        .read_entry(&entry_id)
        .map_err(|error| error.to_string())?;
    let segments = workspace
        .read_segments(&entry_id)
        .map_err(|error| error.to_string())?;
    let annotations = workspace
        .read_annotations(&entry_id)
        .map_err(|error| error.to_string())?;

    if segments.is_empty() && annotations.is_empty() {
        return Ok(ReadEntryAssistantContextResponse {
            entry_id,
            entry_title: entry.title,
            markdown: String::new(),
            sources: Vec::new(),
        });
    }

    let mut markdown = format!("# {}\n", entry.title);
    let mut last_page_idx: Option<u32> = None;
    let mut sources = Vec::with_capacity(segments.len());
    let segments_by_uid = segments
        .iter()
        .map(|segment| (segment.uid.clone(), segment.clone()))
        .collect::<HashMap<_, _>>();

    let mut seen_logical_segment_uids = HashSet::new();
    let mut source_index = 0usize;
    for segment in segments.into_iter() {
        let logical_segment_key = logical_segment_uid(&segment);
        if !seen_logical_segment_uids.insert(logical_segment_key) {
            continue;
        }
        if last_page_idx != Some(segment.page_idx) {
            markdown.push_str(&format!("\n## Page {}\n", segment.page_idx + 1));
            last_page_idx = Some(segment.page_idx);
        }

        let source_segment_uid = segment.uid.clone();
        let text = segment.markdown.unwrap_or(segment.text);
        source_index += 1;
        let marker = format!("S{}", source_index);
        markdown.push_str(&format!(
            "\n[{}] segment_uid: {}\n{}\n",
            marker, source_segment_uid, text
        ));
        sources.push(EntryAssistantSource {
            entry_id: entry_id.clone(),
            entry_title: entry.title.clone(),
            segment_uid: source_segment_uid,
            page_idx: segment.page_idx,
            quote: compact_quote(&text),
        });
    }

    if !annotations.is_empty() {
        markdown.push_str("\n## Annotations\n");
        for annotation in annotations {
            let live_segment = segments_by_uid.get(&annotation.segment_uid);
            let page_idx = live_segment.map(|segment| segment.page_idx).or_else(|| {
                annotation
                    .segment_snapshot
                    .as_ref()
                    .map(|segment| segment.page_idx)
            });
            let segment_text = live_segment
                .map(|segment| segment.markdown.as_deref().unwrap_or(&segment.text))
                .or_else(|| {
                    annotation
                        .segment_snapshot
                        .as_ref()
                        .map(|segment| segment.markdown.as_deref().unwrap_or(&segment.text))
                });
            let page_label = page_idx
                .map(|page_idx| format!("Page {}", page_idx + 1))
                .unwrap_or_else(|| "Page unknown".to_string());
            markdown.push_str(&format!(
                "\n- [{}] type: {}; importance: {:?}; segment_uid: {}\n  Annotation: {}\n",
                page_label,
                annotation.kind,
                annotation.importance,
                annotation.segment_uid,
                annotation.content
            ));
            if let Some(segment_text) = segment_text {
                let quote = compact_quote(segment_text);
                if !quote.is_empty() {
                    markdown.push_str(&format!("  Source excerpt: {}\n", quote));
                }
            }
            if let Some(page_idx) = page_idx {
                sources.push(EntryAssistantSource {
                    entry_id: entry_id.clone(),
                    entry_title: entry.title.clone(),
                    segment_uid: annotation.segment_uid,
                    page_idx,
                    quote: compact_quote(&annotation.content),
                });
            }
        }
    }

    Ok(ReadEntryAssistantContextResponse {
        entry_id,
        entry_title: entry.title,
        markdown,
        sources,
    })
}

fn logical_segment_uid(segment: &neuink_domain::SourceSegment) -> String {
    segment
        .continuation_group_id
        .clone()
        .unwrap_or_else(|| segment.uid.as_str().to_string())
}

fn segment_matches_uid(segment: &neuink_domain::SourceSegment, uid: &SegmentUid) -> bool {
    segment.uid == *uid
        || segment
            .continuation_group_id
            .as_deref()
            .is_some_and(|group_id| group_id == uid.as_str())
}

async fn invoke_search_segments<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    args: Value,
) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct Args {
        root: PathBuf,
        query: String,
        #[serde(default)]
        scope_entry_ids: Vec<EntryId>,
        #[serde(default)]
        mode: Option<SearchMode>,
        #[serde(default)]
        top_k: Option<usize>,
    }

    let args: Args = serde_json::from_value(args).map_err(|error| error.to_string())?;
    let results = search_segments(
        app,
        SearchSegmentsRequest {
            root: args.root,
            query: args.query,
            scope_entry_ids: args.scope_entry_ids,
            mode: args.mode.unwrap_or(SearchMode::Hybrid),
            top_k: args.top_k,
        },
    )
    .await?;
    Ok(json!(results))
}

fn compact_quote(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(240)
        .collect()
}

fn clamp_context_budget(value: Option<usize>, default: usize) -> usize {
    value.unwrap_or(default).clamp(2_000, 2_000_000)
}

fn trim_to_char_budget(text: String, budget: usize) -> (String, usize, bool) {
    let char_count = text.chars().count();
    if char_count <= budget {
        return (text, char_count, false);
    }

    let mut trimmed = text.chars().take(budget).collect::<String>();
    trimmed.push_str("\n\n[Context truncated because it exceeds the configured budget.]");
    (trimmed, char_count, true)
}

fn tag_paths(tags: &[TagMeta]) -> Vec<String> {
    let by_id = tags
        .iter()
        .map(|tag| (tag.id.clone(), tag))
        .collect::<HashMap<TagId, &TagMeta>>();
    tags.iter()
        .map(|tag| {
            let mut names = vec![tag.name.clone()];
            let mut parent_id = tag.parent_id.clone();
            let mut guard = 0;
            while let Some(id) = parent_id {
                guard += 1;
                if guard > 16 {
                    break;
                }
                let Some(parent) = by_id.get(&id) else {
                    break;
                };
                names.push(parent.name.clone());
                parent_id = parent.parent_id.clone();
            }
            names.reverse();
            names.join("/")
        })
        .collect()
}

async fn complete_tag_chat(
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
    if let Some(value) = profile.temperature {
        body["temperature"] = json!(value);
    }
    if let Some(value) = profile.top_p {
        body["top_p"] = json!(value);
    }
    if let Some(value) = profile.max_output_tokens {
        body["max_tokens"] = json!(value);
    }
    let mut request = reqwest::Client::new().post(url).json(&body);
    if let Some(key) = profile
        .api_key
        .as_deref()
        .filter(|key| !key.trim().is_empty())
    {
        request = request.bearer_auth(key);
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Tag analysis model request failed: HTTP {status}. {}",
            response.text().await.unwrap_or_default()
        ));
    }
    let payload: Value = response.json().await.map_err(|error| error.to_string())?;
    payload
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "Tag analysis model returned no content.".to_string())
}

fn parse_tag_recommendations(
    content: &str,
    existing_paths: &[String],
) -> Result<Vec<TagRecommendation>, String> {
    #[derive(Deserialize)]
    struct ModelTagResponse {
        #[serde(default)]
        tags: Vec<ModelTag>,
    }
    #[derive(Deserialize)]
    struct ModelTag {
        confidence: Option<f32>,
        dimension: Option<String>,
        path: String,
        reason: Option<String>,
    }

    let content = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let parsed: ModelTagResponse = serde_json::from_str(content)
        .map_err(|error| format!("Tag analysis returned invalid JSON: {error}"))?;
    let existing = existing_paths
        .iter()
        .map(|path| normalize_tag_path_key(path))
        .collect::<HashSet<_>>();
    let mut seen = HashSet::new();
    let mut recommendations = Vec::new();
    for tag in parsed.tags {
        let path = normalize_tag_path(&tag.path);
        let key = normalize_tag_path_key(&path);
        if path.is_empty() || path.split('/').count() > 5 || !seen.insert(key.clone()) {
            continue;
        }
        if path
            .split('/')
            .any(|part| part.eq_ignore_ascii_case("主题"))
        {
            continue;
        }
        recommendations.push(TagRecommendation {
            confidence: tag.confidence.unwrap_or(0.6).clamp(0.0, 1.0),
            dimension: tag
                .dimension
                .unwrap_or_else(|| "research".to_string())
                .trim()
                .to_string(),
            path,
            reason: tag
                .reason
                .unwrap_or_else(|| "模型基于论文内容提出的标签".to_string())
                .trim()
                .to_string(),
            source: if existing.contains(&key) {
                "existing"
            } else {
                "new"
            }
            .to_string(),
        });
        if recommendations.len() == 6 {
            break;
        }
    }
    Ok(recommendations)
}

fn normalize_tag_path(path: &str) -> String {
    path.split('/')
        .map(|part| part.trim().split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|part| !part.is_empty())
        .map(|part| part.chars().take(48).collect::<String>())
        .collect::<Vec<_>>()
        .join("/")
}

fn normalize_tag_path_key(path: &str) -> String {
    normalize_tag_path(path).to_lowercase()
}
