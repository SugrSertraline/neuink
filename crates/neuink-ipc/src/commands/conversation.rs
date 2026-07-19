use std::{fs, path::PathBuf};

use chrono::{DateTime, Utc};
use neuink_domain::{ConversationId, EntryId, TagId};
use neuink_workspace::{atomic_write_json, Workspace, WorkspaceLayout};
use serde::{Deserialize, Serialize};

const CONVERSATION_INDEX_FILE: &str = "index.json";
const CONVERSATION_INDEX_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Conversation {
    pub id: ConversationId,
    pub title: String,
    pub scope_snapshot: ScopeSnapshot,
    pub messages: Vec<ConversationMessage>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ConversationMeta {
    pub id: ConversationId,
    pub title: String,
    pub scope_snapshot: ScopeSnapshot,
    pub message_count: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub context_items: Vec<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ConversationIndex {
    version: u32,
    conversations: Vec<ConversationMeta>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ScopeSnapshot {
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
pub struct ConversationMessage {
    pub message_id: String,
    pub role: ConversationRole,
    pub content: String,
    #[serde(default)]
    pub source_links: Vec<ConversationSourceLink>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_events: Vec<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub note_proposals: Vec<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parts: Vec<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversationRole {
    Assistant,
    User,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ConversationSourceLink {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub segment_uid: String,
    pub page_idx: u32,
    pub quote: String,
}

#[derive(Debug, Deserialize)]
pub struct RootRequest {
    pub root: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct ConversationRequest {
    pub root: PathBuf,
    pub conversation_id: ConversationId,
}

#[derive(Debug, Deserialize)]
pub struct RenameConversationRequest {
    pub root: PathBuf,
    pub conversation_id: ConversationId,
    pub title: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateConversationRequest {
    pub root: PathBuf,
    pub title: String,
    pub scope_snapshot: ScopeSnapshot,
}

#[derive(Debug, Deserialize)]
pub struct AppendConversationMessagesRequest {
    pub root: PathBuf,
    pub conversation_id: ConversationId,
    pub messages: Vec<ConversationMessageInput>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateConversationMessageRequest {
    pub root: PathBuf,
    pub conversation_id: ConversationId,
    pub message_id: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub source_links: Option<Vec<ConversationSourceLink>>,
    #[serde(default)]
    pub tool_events: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub note_proposals: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub parts: Option<Vec<serde_json::Value>>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ConversationMessageInput {
    pub role: ConversationRole,
    pub content: String,
    #[serde(default)]
    pub source_links: Vec<ConversationSourceLink>,
    #[serde(default)]
    pub tool_events: Vec<serde_json::Value>,
    #[serde(default)]
    pub note_proposals: Vec<serde_json::Value>,
    #[serde(default)]
    pub parts: Vec<serde_json::Value>,
}

#[tauri::command]
pub fn list_conversations(request: RootRequest) -> Result<Vec<ConversationMeta>, String> {
    Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let layout = WorkspaceLayout::new(request.root);
    Ok(read_or_rebuild_conversation_index(&layout)?.conversations)
}

fn latest_context_items(conversation: &Conversation) -> Vec<serde_json::Value> {
    for message in conversation.messages.iter().rev() {
        if !matches!(message.role, ConversationRole::User) {
            continue;
        }
        for part in &message.parts {
            let is_context_part = part
                .get("type")
                .and_then(|value| value.as_str())
                .is_some_and(|value| value == "context");
            if !is_context_part {
                continue;
            }
            if let Some(items) = part.get("items").and_then(|value| value.as_array()) {
                return items.clone();
            }
        }
    }
    Vec::new()
}

#[tauri::command]
pub fn load_conversation(request: ConversationRequest) -> Result<Conversation, String> {
    Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let layout = WorkspaceLayout::new(request.root);
    read_conversation_file(conversation_file(&layout, &request.conversation_id))
}

#[tauri::command]
pub fn delete_conversation(request: ConversationRequest) -> Result<(), String> {
    Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let layout = WorkspaceLayout::new(request.root);
    let path = conversation_file(&layout, &request.conversation_id);
    if !path.exists() {
        return Err(format!(
            "conversation not found: {}",
            request.conversation_id.as_str()
        ));
    }
    fs::remove_file(path).map_err(|error| error.to_string())?;
    update_conversation_index_after_delete(&layout, &request.conversation_id);
    Ok(())
}

#[tauri::command]
pub fn rename_conversation(request: RenameConversationRequest) -> Result<Conversation, String> {
    Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let layout = WorkspaceLayout::new(request.root);
    let mut conversation =
        read_conversation_file(conversation_file(&layout, &request.conversation_id))?;
    conversation.title = normalize_title(request.title);
    conversation.updated_at = Utc::now();
    atomic_write_json(conversation_file(&layout, &conversation.id), &conversation)
        .map_err(|error| error.to_string())?;
    update_conversation_index_after_write(&layout, &conversation);
    Ok(conversation)
}

#[tauri::command]
pub fn create_conversation(request: CreateConversationRequest) -> Result<Conversation, String> {
    Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let layout = WorkspaceLayout::new(request.root);
    let now = Utc::now();
    let conversation = Conversation {
        id: ConversationId::new(),
        title: normalize_title(request.title),
        scope_snapshot: request.scope_snapshot,
        messages: Vec::new(),
        created_at: now,
        updated_at: now,
    };
    atomic_write_json(conversation_file(&layout, &conversation.id), &conversation)
        .map_err(|error| error.to_string())?;
    update_conversation_index_after_write(&layout, &conversation);
    Ok(conversation)
}

#[tauri::command]
pub fn append_conversation_messages(
    request: AppendConversationMessagesRequest,
) -> Result<Conversation, String> {
    Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let layout = WorkspaceLayout::new(request.root);
    let mut conversation =
        read_conversation_file(conversation_file(&layout, &request.conversation_id))?;
    let now = Utc::now();

    for message in request.messages {
        conversation.messages.push(ConversationMessage {
            message_id: format!(
                "msg_{}",
                Utc::now().timestamp_nanos_opt().unwrap_or_default()
            ),
            role: message.role,
            content: message.content,
            source_links: message.source_links,
            tool_events: message.tool_events,
            note_proposals: message.note_proposals,
            parts: message.parts,
            created_at: now,
        });
    }

    conversation.updated_at = Utc::now();
    atomic_write_json(conversation_file(&layout, &conversation.id), &conversation)
        .map_err(|error| error.to_string())?;
    update_conversation_index_after_write(&layout, &conversation);
    Ok(conversation)
}

#[tauri::command]
pub fn update_conversation_message(
    request: UpdateConversationMessageRequest,
) -> Result<Conversation, String> {
    Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let layout = WorkspaceLayout::new(request.root);
    let mut conversation =
        read_conversation_file(conversation_file(&layout, &request.conversation_id))?;
    let message = conversation
        .messages
        .iter_mut()
        .find(|message| message.message_id == request.message_id)
        .ok_or_else(|| format!("message not found: {}", request.message_id))?;

    if let Some(content) = request.content {
        message.content = content;
    }
    if let Some(source_links) = request.source_links {
        message.source_links = source_links;
    }
    if let Some(tool_events) = request.tool_events {
        message.tool_events = tool_events;
    }
    if let Some(note_proposals) = request.note_proposals {
        message.note_proposals = note_proposals;
    }
    if let Some(parts) = request.parts {
        message.parts = parts;
    }

    conversation.updated_at = Utc::now();
    atomic_write_json(conversation_file(&layout, &conversation.id), &conversation)
        .map_err(|error| error.to_string())?;
    Ok(conversation)
}

fn conversation_meta(conversation: &Conversation) -> ConversationMeta {
    ConversationMeta {
        id: conversation.id.clone(),
        title: conversation.title.clone(),
        scope_snapshot: conversation.scope_snapshot.clone(),
        message_count: conversation.messages.len(),
        context_items: latest_context_items(conversation),
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
    }
}

fn read_or_rebuild_conversation_index(
    layout: &WorkspaceLayout,
) -> Result<ConversationIndex, String> {
    let index_path = conversation_index_file(layout);
    if index_path.exists() {
        let cached = fs::read(&index_path)
            .map_err(|error| error.to_string())
            .and_then(|bytes| {
                serde_json::from_slice::<ConversationIndex>(&bytes)
                    .map_err(|error| error.to_string())
            });
        if let Ok(index) = cached {
            if index.version == CONVERSATION_INDEX_VERSION
                && conversation_index_matches_files(layout, &index)?
            {
                return Ok(index);
            }
        }
    }

    rebuild_conversation_index(layout)
}

fn rebuild_conversation_index(layout: &WorkspaceLayout) -> Result<ConversationIndex, String> {
    let mut conversations = Vec::new();
    for file in conversation_files(layout)? {
        conversations.push(conversation_meta(&read_conversation_file(file)?));
    }
    sort_conversation_metas(&mut conversations);
    let index = ConversationIndex {
        version: CONVERSATION_INDEX_VERSION,
        conversations,
    };
    write_conversation_index(layout, &index)?;
    Ok(index)
}

fn conversation_index_matches_files(
    layout: &WorkspaceLayout,
    index: &ConversationIndex,
) -> Result<bool, String> {
    let mut file_ids = conversation_files(layout)?
        .into_iter()
        .filter_map(|path| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .map(str::to_owned)
        })
        .collect::<Vec<_>>();
    let mut index_ids = index
        .conversations
        .iter()
        .map(|item| item.id.as_str().to_owned())
        .collect::<Vec<_>>();
    file_ids.sort();
    index_ids.sort();
    Ok(file_ids == index_ids)
}

fn update_conversation_index_after_write(layout: &WorkspaceLayout, conversation: &Conversation) {
    let result = read_or_rebuild_conversation_index(layout).and_then(|mut index| {
        index
            .conversations
            .retain(|item| item.id.as_str() != conversation.id.as_str());
        index.conversations.push(conversation_meta(conversation));
        sort_conversation_metas(&mut index.conversations);
        write_conversation_index(layout, &index)
    });
    if result.is_err() {
        invalidate_conversation_index(layout);
    }
}

fn update_conversation_index_after_delete(
    layout: &WorkspaceLayout,
    conversation_id: &ConversationId,
) {
    let result = read_or_rebuild_conversation_index(layout).and_then(|mut index| {
        index
            .conversations
            .retain(|item| item.id.as_str() != conversation_id.as_str());
        write_conversation_index(layout, &index)
    });
    if result.is_err() {
        invalidate_conversation_index(layout);
    }
}

fn sort_conversation_metas(conversations: &mut [ConversationMeta]) {
    conversations.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
}

fn write_conversation_index(
    layout: &WorkspaceLayout,
    index: &ConversationIndex,
) -> Result<(), String> {
    atomic_write_json(conversation_index_file(layout), index).map_err(|error| error.to_string())
}

fn invalidate_conversation_index(layout: &WorkspaceLayout) {
    let path = conversation_index_file(layout);
    if path.exists() {
        let _ = fs::remove_file(path);
    }
}

fn conversation_files(layout: &WorkspaceLayout) -> Result<Vec<PathBuf>, String> {
    let dir = layout.conversations_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) == Some("json")
            && path.file_name().and_then(|name| name.to_str()) != Some(CONVERSATION_INDEX_FILE)
        {
            files.push(path);
        }
    }
    Ok(files)
}

fn read_conversation_file(path: PathBuf) -> Result<Conversation, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

fn conversation_file(layout: &WorkspaceLayout, conversation_id: &ConversationId) -> PathBuf {
    layout
        .conversations_dir()
        .join(format!("{}.json", conversation_id.as_str()))
}

fn conversation_index_file(layout: &WorkspaceLayout) -> PathBuf {
    layout.conversations_dir().join(CONVERSATION_INDEX_FILE)
}

fn normalize_title(title: String) -> String {
    let title = title.trim();
    if title.is_empty() {
        "New conversation".to_string()
    } else {
        title.chars().take(48).collect()
    }
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    #[test]
    fn conversation_index_rebuilds_and_tracks_mutations() {
        let root = test_workspace_root();
        Workspace::create(&root).expect("create test workspace");

        let created = create_conversation(CreateConversationRequest {
            root: root.clone(),
            title: "Cached conversation".to_string(),
            scope_snapshot: ScopeSnapshot::default(),
        })
        .expect("create conversation");
        let layout = WorkspaceLayout::new(root.clone());
        assert!(conversation_index_file(&layout).exists());

        fs::remove_file(conversation_index_file(&layout)).expect("remove index for rebuild test");
        let rebuilt = list_conversations(RootRequest { root: root.clone() })
            .expect("rebuild conversation index");
        assert_eq!(rebuilt.len(), 1);
        assert_eq!(rebuilt[0].message_count, 0);

        append_conversation_messages(AppendConversationMessagesRequest {
            root: root.clone(),
            conversation_id: created.id.clone(),
            messages: vec![ConversationMessageInput {
                role: ConversationRole::User,
                content: "hello".to_string(),
                source_links: Vec::new(),
                tool_events: Vec::new(),
                note_proposals: Vec::new(),
                parts: Vec::new(),
            }],
        })
        .expect("append message");
        let updated =
            list_conversations(RootRequest { root: root.clone() }).expect("read updated index");
        assert_eq!(updated[0].message_count, 1);

        rename_conversation(RenameConversationRequest {
            root: root.clone(),
            conversation_id: created.id.clone(),
            title: "Renamed".to_string(),
        })
        .expect("rename conversation");
        let renamed =
            list_conversations(RootRequest { root: root.clone() }).expect("read renamed index");
        assert_eq!(renamed[0].title, "Renamed");

        delete_conversation(ConversationRequest {
            root: root.clone(),
            conversation_id: created.id,
        })
        .expect("delete conversation");
        assert!(list_conversations(RootRequest { root: root.clone() })
            .expect("read index after delete")
            .is_empty());

        fs::remove_dir_all(root).expect("remove test workspace");
    }

    fn test_workspace_root() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "neuink-ipc-conversation-index-{}-{unique}",
            std::process::id()
        ))
    }
}
