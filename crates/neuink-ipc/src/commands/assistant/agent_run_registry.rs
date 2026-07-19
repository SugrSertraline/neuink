use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAgentRunRequest {
    pub root: PathBuf,
    pub run: AgentRunRecordInput,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentRunsRequest {
    pub root: PathBuf,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub entry_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub started_after: Option<String>,
    #[serde(default)]
    pub started_before: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAgentRunRequest {
    pub root: PathBuf,
    pub run_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAgentRunRequest {
    pub root: PathBuf,
    pub run_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneAgentRunsRequest {
    pub root: PathBuf,
    #[serde(default)]
    pub keep_latest: Option<usize>,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneAgentRunsResponse {
    pub deleted_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRecordInput {
    pub run_id: String,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub entry_id: Option<String>,
    #[serde(default)]
    pub message_id: Option<String>,
    #[serde(default)]
    pub question: Option<String>,
    #[serde(default)]
    pub answer_preview: Option<String>,
    pub run: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRecord {
    pub run_id: String,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub entry_id: Option<String>,
    #[serde(default)]
    pub message_id: Option<String>,
    #[serde(default)]
    pub question: Option<String>,
    #[serde(default)]
    pub answer_preview: Option<String>,
    pub status: String,
    pub started_at: String,
    #[serde(default)]
    pub ended_at: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    pub node_count: usize,
    pub failed_node_count: usize,
    pub tool_node_count: usize,
    pub subagent_node_count: usize,
    pub saved_at: DateTime<Utc>,
    pub run: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRecordSummary {
    pub run_id: String,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub entry_id: Option<String>,
    #[serde(default)]
    pub message_id: Option<String>,
    #[serde(default)]
    pub question: Option<String>,
    #[serde(default)]
    pub answer_preview: Option<String>,
    pub status: String,
    pub started_at: String,
    #[serde(default)]
    pub ended_at: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    pub node_count: usize,
    pub failed_node_count: usize,
    pub tool_node_count: usize,
    pub subagent_node_count: usize,
    pub saved_at: DateTime<Utc>,
}

pub fn save_agent_run(request: SaveAgentRunRequest) -> Result<(), String> {
    let run_dir = agent_run_dir(&request.root)?;
    fs::create_dir_all(&run_dir).map_err(|error| error.to_string())?;
    let record = build_record(request.run)?;
    let bytes = serde_json::to_vec_pretty(&record).map_err(|error| error.to_string())?;
    fs::write(
        run_dir.join(format!("{}.json", safe_run_id(&record.run_id))),
        bytes,
    )
    .map_err(|error| error.to_string())
}

pub fn list_agent_runs(
    request: ListAgentRunsRequest,
) -> Result<Vec<AgentRunRecordSummary>, String> {
    let run_dir = agent_run_dir(&request.root)?;
    let conversations_dir = request.root.join("conversations");
    if !run_dir.exists() {
        return Ok(Vec::new());
    }

    let mut records = Vec::new();
    for entry in fs::read_dir(run_dir).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        let record: AgentRunRecord =
            serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
        if is_orphaned_conversation_run(&record, &conversations_dir) {
            let _ = delete_agent_run(DeleteAgentRunRequest {
                root: request.root.clone(),
                run_id: record.run_id,
            });
            continue;
        }
        if !matches_filter(&record, &request) {
            continue;
        }
        records.push(summary_from_record(record));
    }

    records.sort_by(|left, right| right.saved_at.cmp(&left.saved_at));
    records.truncate(request.limit.max(1));
    Ok(records)
}

pub fn read_agent_run(request: ReadAgentRunRequest) -> Result<AgentRunRecord, String> {
    let path = agent_run_dir(&request.root)?.join(format!("{}.json", safe_run_id(&request.run_id)));
    if !path.exists() {
        return Err(format!("agent run not found: {}", request.run_id));
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

pub fn delete_agent_run(request: DeleteAgentRunRequest) -> Result<(), String> {
    let path = agent_run_dir(&request.root)?.join(format!("{}.json", safe_run_id(&request.run_id)));
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn prune_agent_runs(request: PruneAgentRunsRequest) -> Result<PruneAgentRunsResponse, String> {
    let run_dir = agent_run_dir(&request.root)?;
    if !run_dir.exists() {
        return Ok(PruneAgentRunsResponse { deleted_count: 0 });
    }

    let mut records = Vec::new();
    for entry in fs::read_dir(&run_dir).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        let record: AgentRunRecord =
            serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
        if request
            .status
            .as_deref()
            .is_some_and(|status| record.status != status)
        {
            continue;
        }
        records.push((path, record.saved_at));
    }

    records.sort_by(|left, right| right.1.cmp(&left.1));
    let keep_latest = request.keep_latest.unwrap_or(100).max(1);
    let mut deleted_count = 0;
    for (path, _) in records.into_iter().skip(keep_latest) {
        if fs::remove_file(path).is_ok() {
            deleted_count += 1;
        }
    }

    Ok(PruneAgentRunsResponse { deleted_count })
}

fn build_record(input: AgentRunRecordInput) -> Result<AgentRunRecord, String> {
    let status = string_field(&input.run, "status").unwrap_or_else(|| "unknown".to_string());
    let started_at =
        string_field(&input.run, "startedAt").unwrap_or_else(|| Utc::now().to_rfc3339());
    let ended_at = string_field(&input.run, "endedAt");
    let duration_ms = input.run.get("durationMs").and_then(Value::as_u64);
    let nodes = input
        .run
        .get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let failed_node_count = nodes
        .iter()
        .filter(|node| string_field(node, "status").as_deref() == Some("failed"))
        .count();
    let tool_node_count = nodes
        .iter()
        .filter(|node| string_field(node, "kind").as_deref() == Some("tool"))
        .count();
    let subagent_node_count = nodes
        .iter()
        .filter(|node| string_field(node, "kind").as_deref() == Some("subagent"))
        .count();

    Ok(AgentRunRecord {
        run_id: non_empty(input.run_id).ok_or_else(|| "run_id is required".to_string())?,
        conversation_id: input.conversation_id.and_then(non_empty),
        entry_id: input.entry_id.and_then(non_empty),
        message_id: input.message_id.and_then(non_empty),
        question: input.question.and_then(non_empty),
        answer_preview: input
            .answer_preview
            .and_then(|value| non_empty(trim_chars(&value, 500))),
        status,
        started_at,
        ended_at,
        duration_ms,
        node_count: nodes.len(),
        failed_node_count,
        tool_node_count,
        subagent_node_count,
        saved_at: Utc::now(),
        run: input.run,
    })
}

fn matches_filter(record: &AgentRunRecord, request: &ListAgentRunsRequest) -> bool {
    if request
        .conversation_id
        .as_deref()
        .is_some_and(|id| record.conversation_id.as_deref() != Some(id))
    {
        return false;
    }
    if request
        .entry_id
        .as_deref()
        .is_some_and(|id| record.entry_id.as_deref() != Some(id))
    {
        return false;
    }
    if request
        .status
        .as_deref()
        .is_some_and(|status| record.status != status)
    {
        return false;
    }
    if request
        .started_after
        .as_deref()
        .is_some_and(|after| record.started_at.as_str() < after)
    {
        return false;
    }
    if request
        .started_before
        .as_deref()
        .is_some_and(|before| record.started_at.as_str() > before)
    {
        return false;
    }
    true
}

fn summary_from_record(record: AgentRunRecord) -> AgentRunRecordSummary {
    AgentRunRecordSummary {
        run_id: record.run_id,
        conversation_id: record.conversation_id,
        entry_id: record.entry_id,
        message_id: record.message_id,
        question: record.question,
        answer_preview: record.answer_preview,
        status: record.status,
        started_at: record.started_at,
        ended_at: record.ended_at,
        duration_ms: record.duration_ms,
        node_count: record.node_count,
        failed_node_count: record.failed_node_count,
        tool_node_count: record.tool_node_count,
        subagent_node_count: record.subagent_node_count,
        saved_at: record.saved_at,
    }
}

fn is_orphaned_conversation_run(record: &AgentRunRecord, conversations_dir: &Path) -> bool {
    record
        .conversation_id
        .as_deref()
        .is_some_and(|conversation_id| {
            !conversations_dir
                .join(format!("{conversation_id}.json"))
                .exists()
        })
}

fn agent_run_dir(root: &std::path::Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root)
        .map_err(|error| format!("无法读取工作区路径 {}: {error}", root.to_string_lossy()))?;
    Ok(root.join("agent-runtime").join("runs"))
}

fn default_limit() -> usize {
    50
}

fn safe_run_id(run_id: &str) -> String {
    run_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)?
        .as_str()
        .map(ToString::to_string)
        .and_then(non_empty)
}

fn non_empty(value: String) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn trim_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use serde_json::json;

    use super::{
        list_agent_runs, read_agent_run, save_agent_run, AgentRunRecordInput, ListAgentRunsRequest,
        ReadAgentRunRequest, SaveAgentRunRequest,
    };

    #[test]
    fn saves_lists_and_reads_agent_run_records() {
        let root = std::env::temp_dir().join(format!("neuink_agent_runs_{}", unique_suffix()));
        neuink_workspace::Workspace::create(&root).unwrap();
        fs::create_dir_all(root.join("conversations")).unwrap();
        fs::write(root.join("conversations").join("conv-1.json"), "{}").unwrap();

        save_agent_run(SaveAgentRunRequest {
            root: root.clone(),
            run: AgentRunRecordInput {
                answer_preview: Some("answer".to_string()),
                conversation_id: Some("conv-1".to_string()),
                entry_id: Some("entry-1".to_string()),
                message_id: Some("msg-1".to_string()),
                question: Some("question".to_string()),
                run_id: "run-1".to_string(),
                run: json!({
                    "id": "run-1",
                    "status": "failed",
                    "startedAt": "2026-06-29T00:00:00Z",
                    "endedAt": "2026-06-29T00:00:01Z",
                    "durationMs": 1000,
                    "nodes": [
                        {"id": "tool", "kind": "tool", "status": "succeeded"},
                        {"id": "subagent", "kind": "subagent", "status": "failed"}
                    ]
                }),
            },
        })
        .unwrap();

        let summaries = list_agent_runs(ListAgentRunsRequest {
            conversation_id: Some("conv-1".to_string()),
            entry_id: None,
            limit: 20,
            root: root.clone(),
            status: Some("failed".to_string()),
            started_after: None,
            started_before: None,
        })
        .unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].run_id, "run-1");
        assert_eq!(summaries[0].node_count, 2);
        assert_eq!(summaries[0].failed_node_count, 1);
        assert_eq!(summaries[0].tool_node_count, 1);
        assert_eq!(summaries[0].subagent_node_count, 1);

        let record = read_agent_run(ReadAgentRunRequest {
            root: root.clone(),
            run_id: "run-1".to_string(),
        })
        .unwrap();
        assert_eq!(record.conversation_id.as_deref(), Some("conv-1"));
        assert_eq!(record.status, "failed");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_agent_runs_prunes_runs_for_deleted_conversations() {
        let root =
            std::env::temp_dir().join(format!("neuink_orphan_agent_runs_{}", unique_suffix()));
        neuink_workspace::Workspace::create(&root).unwrap();

        save_agent_run(SaveAgentRunRequest {
            root: root.clone(),
            run: AgentRunRecordInput {
                answer_preview: Some("answer".to_string()),
                conversation_id: Some("deleted-conv".to_string()),
                entry_id: Some("entry-1".to_string()),
                message_id: Some("msg-1".to_string()),
                question: Some("question".to_string()),
                run_id: "orphan-run".to_string(),
                run: json!({
                    "id": "orphan-run",
                    "status": "succeeded",
                    "startedAt": "2026-06-29T00:00:00Z",
                    "nodes": []
                }),
            },
        })
        .unwrap();

        let summaries = list_agent_runs(ListAgentRunsRequest {
            conversation_id: None,
            entry_id: None,
            limit: 20,
            root: root.clone(),
            status: None,
            started_after: None,
            started_before: None,
        })
        .unwrap();
        assert!(summaries.is_empty());
        assert!(read_agent_run(ReadAgentRunRequest {
            root: root.clone(),
            run_id: "orphan-run".to_string(),
        })
        .is_err());

        fs::remove_dir_all(root).unwrap();
    }

    fn unique_suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }
}
