//! Durable assistant checkpoints. Compare-and-swap precedes every external action.
use crate::{atomic_write_json, WorkspaceError, WorkspaceLayout};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

static WRITER: Mutex<()> = Mutex::new(());
const MAX_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecution {
    pub id: String,
    pub conversation_id: String,
    pub revision: u64,
    pub status: String,
    pub updated_at: String,
    pub payload: Value,
}

fn invalid(message: &str) -> WorkspaceError {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message).into()
}

fn directory(root: &Path) -> Result<PathBuf, WorkspaceError> {
    let root = fs::canonicalize(root)?;
    let mut directory = root.clone();
    for component in ["agent-runtime", "executions"] {
        directory.push(component);
        fs::create_dir_all(&directory)?;
        directory = fs::canonicalize(directory)?;
        if !directory.starts_with(&root) {
            return Err(invalid("Checkpoint directory escapes workspace"));
        }
    }
    Ok(directory)
}

fn path(root: &Path, id: &str) -> Result<PathBuf, WorkspaceError> {
    if !safe_identifier(id) {
        return Err(invalid("Invalid execution id"));
    }
    let directory = directory(root)?;
    let path = directory.join(format!("{id}.json"));
    if path.exists() && !fs::canonicalize(&path)?.starts_with(&directory) {
        return Err(invalid("Checkpoint path escapes workspace"));
    }
    Ok(path)
}

// Domain IDs use NanoID's URL-safe alphabet; execution IDs also use UUIDs.
// Keep both alphabets without accepting separators, dots or Windows path syntax.
fn safe_identifier(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

pub fn read(root: &Path, id: &str) -> Result<Option<AgentExecution>, WorkspaceError> {
    let path = path(root, id)?;
    if !path.exists() {
        return Ok(None);
    }
    if fs::metadata(&path)?.len() > MAX_BYTES {
        return Err(invalid("Checkpoint too large"));
    }
    Ok(Some(serde_json::from_slice(&fs::read(path)?)?))
}

pub fn save(root: &Path, mut record: AgentExecution) -> Result<AgentExecution, WorkspaceError> {
    let _guard = WRITER
        .lock()
        .map_err(|_| invalid("Checkpoint writer unavailable"))?;
    let _file_lock = writer_lock(root)?;
    if !safe_identifier(&record.conversation_id) {
        return Err(invalid("Invalid execution conversation"));
    }
    if !WorkspaceLayout::new(root)
        .conversations_dir()
        .join(format!("{}.json", record.conversation_id))
        .is_file()
    {
        return Err(invalid("Execution conversation no longer exists"));
    }
    let path = path(root, &record.id)?;
    let previous = read(root, &record.id)?;
    if previous.as_ref().map_or(0, |p| p.revision) != record.revision {
        return Err(invalid(
            "Execution changed in another runner. Reload before continuing.",
        ));
    }
    if previous
        .as_ref()
        .is_some_and(|p| p.conversation_id != record.conversation_id)
    {
        return Err(invalid("Execution conversation cannot change"));
    }
    if ![
        "running",
        "cancelled",
        "failed",
        "awaiting_approval",
        "completed",
    ]
    .contains(&record.status.as_str())
    {
        return Err(invalid("Invalid execution status"));
    }
    record.revision = record
        .revision
        .checked_add(1)
        .ok_or_else(|| invalid("Invalid revision"))?;
    record.updated_at = chrono::Utc::now().to_rfc3339();
    if serde_json::to_vec(&record)?.len() as u64 > MAX_BYTES {
        return Err(invalid("Checkpoint too large"));
    }
    atomic_write_json(path, &record)?;
    Ok(record)
}

fn writer_lock(root: &Path) -> Result<fs::File, WorkspaceError> {
    let directory = directory(root)?;
    let path = directory.join("writer.lock");
    if path.exists() && !fs::canonicalize(&path)?.starts_with(&directory) {
        return Err(invalid("Checkpoint lock escapes workspace"));
    }
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    file.try_lock().map_err(|_| {
        invalid("Another process is saving this execution. Retry after it finishes.")
    })?;
    // The OS releases the lock even if the process crashes; no stale lock-file lease.
    Ok(file)
}

pub fn delete_for_conversation(root: &Path, conversation_id: &str) -> Result<(), WorkspaceError> {
    let _guard = WRITER
        .lock()
        .map_err(|_| invalid("Checkpoint writer unavailable"))?;
    let _file_lock = writer_lock(root)?;
    for entry in fs::read_dir(directory(root)?)? {
        let candidate = entry?.path();
        if candidate.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Some(id) = candidate.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if let Some(record) = read(root, id)? {
            if record.conversation_id == conversation_id {
                fs::remove_file(path(root, id)?)?;
            }
        }
    }
    Ok(())
}

pub fn list(root: &Path, conversation_id: &str) -> Result<Vec<AgentExecution>, WorkspaceError> {
    let mut records = Vec::new();
    for entry in fs::read_dir(directory(root)?)? {
        let path = entry?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        // Never misrepresent damaged state as an empty/recovered task list.
        if let Some(mut record) = read(root, id)? {
            if record.conversation_id == conversation_id
                && record.status != "completed"
                && record.status != "awaiting_approval"
            {
                record.payload = serde_json::json!({"question": record.payload.get("question")});
                records.push(record);
            }
        }
    }
    records.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    records.truncate(20);
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identifiers_accept_domain_alphabet_but_reject_path_syntax() {
        assert!(safe_identifier("7ifDV_d90PAk6BE9"));
        assert!(safe_identifier("execution-123_456"));
        for value in [
            "",
            "..",
            "../outside",
            "..\\outside",
            "C:\\temp",
            "a/b",
            "a:b",
            "a.b",
            "a\0b",
        ] {
            assert!(!safe_identifier(value), "unexpectedly accepted {value:?}");
        }
        assert!(!safe_identifier(&"a".repeat(101)));
        for _ in 0..128 {
            assert!(safe_identifier(
                neuink_domain::ConversationId::new().as_str()
            ));
        }
    }

    #[test]
    fn locked_corrupt_and_oversized_checkpoints_fail_without_replacing_data() {
        let root = std::env::temp_dir().join(format!(
            "neuink-execution-{}",
            neuink_domain::ConversationId::new().as_str()
        ));
        fs::create_dir_all(root.join("conversations")).unwrap();
        fs::write(root.join("conversations/conversation_1.json"), b"{}").unwrap();
        let input = AgentExecution {
            id: "run_1".into(),
            conversation_id: "conversation_1".into(),
            revision: 0,
            status: "running".into(),
            updated_at: String::new(),
            payload: serde_json::json!({}),
        };
        let lock = writer_lock(&root).unwrap();
        assert!(save(&root, input.clone())
            .unwrap_err()
            .to_string()
            .contains("Another process"));
        assert!(read(&root, "run_1").unwrap().is_none());
        drop(lock);
        let saved = save(&root, input).unwrap();
        let mut oversized = saved.clone();
        oversized.payload = Value::String("x".repeat(MAX_BYTES as usize));
        assert!(save(&root, oversized)
            .unwrap_err()
            .to_string()
            .contains("too large"));
        assert_eq!(
            read(&root, "run_1").unwrap().unwrap().revision,
            saved.revision
        );
        let target = path(&root, "run_1").unwrap();
        fs::write(&target, b"broken json").unwrap();
        assert!(read(&root, "run_1").is_err());
        assert!(save(&root, saved).is_err());
        assert_eq!(fs::read(target).unwrap(), b"broken json");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn durable_compare_and_swap_rejects_stale_writers_and_traversal() {
        let root = std::env::temp_dir().join(format!(
            "neuink-execution-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(root.join("conversations")).unwrap();
        fs::write(root.join("conversations/conversation-1.json"), b"{}").unwrap();
        let input = AgentExecution {
            id: "run-1".into(),
            conversation_id: "conversation-1".into(),
            revision: 0,
            status: "running".into(),
            updated_at: String::new(),
            payload: serde_json::json!({"question":"test", "actors":{}}),
        };
        let first = save(&root, input.clone()).unwrap();
        assert_eq!(first.revision, 1);
        assert!(save(&root, input).is_err());
        assert_eq!(read(&root, "run-1").unwrap().unwrap().revision, 1);
        assert!(read(&root, "../outside").is_err());
        assert_eq!(list(&root, "conversation-1").unwrap().len(), 1);
        let mut complete = first;
        complete.status = "completed".into();
        assert_eq!(save(&root, complete).unwrap().revision, 2);
        assert!(list(&root, "conversation-1").unwrap().is_empty());
        delete_for_conversation(&root, "conversation-1").unwrap();
        assert!(read(&root, "run-1").unwrap().is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
