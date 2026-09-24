//! User decisions for stored tag/metadata proposals. Model arguments are never write authority.
use super::{
    conversation::{
        load_conversation, update_conversation_message, ConversationRequest,
        UpdateConversationMessageRequest,
    },
    entry, tag,
};
use neuink_domain::{ConversationId, EntryMeta, TagMeta};
use neuink_workspace::{atomic_write_json, Workspace};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

#[derive(Debug, Deserialize)]
pub struct DecideAssistantProposalRequest {
    pub root: PathBuf,
    pub conversation_id: ConversationId,
    pub message_id: String,
    pub proposal_id: String,
    pub expected_proposal: Value,
    pub decision: String,
}

#[derive(Debug, Serialize)]
pub struct ProposalDecisionResponse {
    pub status: String,
    pub entries: Vec<EntryMeta>,
    pub tags: Vec<TagMeta>,
}

#[derive(Deserialize, Serialize)]
struct DecisionRecord {
    proposal: Value,
    status: String,
}

#[tauri::command]
pub fn decide_assistant_proposal(
    request: DecideAssistantProposalRequest,
) -> Result<ProposalDecisionResponse, String> {
    if !matches!(request.decision.as_str(), "apply" | "reject") {
        return Err("无效的确认操作。".into());
    }
    let workspace = Workspace::open_existing(&request.root).map_err(|e| e.to_string())?;
    let directory = request
        .root
        .join("agent-runtime")
        .join("proposal-decisions");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let _lock = decision_lock(&request.root)?;
    let key = serde_json::to_vec(&(
        &request.conversation_id,
        &request.message_id,
        &request.proposal_id,
    ))
    .map_err(|e| e.to_string())?;
    let path = directory.join(format!("{}.json", blake3::hash(&key).to_hex()));
    if path.exists() {
        if !path
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(directory.canonicalize().map_err(|e| e.to_string())?)
        {
            return Err("确认记录超出资料库范围。".into());
        }
        let record: DecisionRecord =
            serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if record.proposal != request.expected_proposal {
            return Err("提案内容已变化，请重新加载后确认。".into());
        }
        let expected = if request.decision == "apply" {
            "applied"
        } else {
            "rejected"
        };
        if record.status == expected {
            persist_status(&request, &record)?;
            return response(&workspace, expected);
        }
        return Err(
            "该提案已处理或上次提交结果不明，禁止重复执行。请核对数据，必要时生成新提案。".into(),
        );
    }
    let conversation = load_conversation(ConversationRequest {
        root: request.root.clone(),
        conversation_id: request.conversation_id.clone(),
    })?;
    let message = conversation
        .messages
        .iter()
        .find(|m| m.message_id == request.message_id)
        .ok_or("未找到已保存的提案消息，未执行修改。")?;
    if !matches!(
        message.role,
        super::conversation::ConversationRole::Assistant
    ) {
        return Err("只有助手提案可以提交。".into());
    }
    let matches: Vec<_> = message
        .parts
        .iter()
        .filter(|p| {
            matches!(
                p["type"].as_str(),
                Some("tag-proposal" | "entry-meta-proposal")
            ) && p["proposal"]["id"].as_str() == Some(&request.proposal_id)
        })
        .collect();
    if matches.len() != 1 {
        return Err("未找到唯一的已保存提案，未执行修改。".into());
    }
    let part = matches[0];
    let proposal = &part["proposal"];
    if proposal != &request.expected_proposal || proposal["status"] != "pending" {
        return Err("提案已变化或不再待确认，请重新加载，未执行修改。".into());
    }
    // Decode everything from the saved proposal BEFORE claiming the irreversible attempt.
    let mutation = if request.decision == "apply" {
        Some(mutation_from_saved(&request.root, part)?)
    } else {
        None
    };
    let mut record = DecisionRecord {
        proposal: proposal.clone(),
        status: if request.decision == "reject" {
            "rejected"
        } else {
            "applying"
        }
        .into(),
    };
    atomic_write_json(&path, &record).map_err(|e| e.to_string())?;
    persist_status(&request, &record)?;
    if request.decision == "reject" {
        return response(&workspace, "rejected");
    }
    // A crash/ambiguous failure leaves "applying": never automatically repeat a side effect.
    match mutation {
        Some(Mutation::Tag(value)) => {
            tag::apply_tag_proposal_impl(value)?;
        }
        Some(Mutation::Entry(value)) => {
            entry::apply_entry_meta_proposal(value)?;
        }
        None => return Err("缺少待执行操作，未执行修改。".into()),
    }
    record.status = "applied".into();
    atomic_write_json(&path, &record)
        .map_err(|e| format!("修改可能已完成但回执保存失败，请核对数据，禁止重复提交：{e}"))?;
    persist_status(&request, &record)?;
    response(&workspace, "applied")
}

pub(super) fn decision_lock(root: &std::path::Path) -> Result<fs::File, String> {
    let directory = root.join("agent-runtime").join("proposal-decisions");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    if !directory
        .canonicalize()
        .map_err(|e| e.to_string())?
        .starts_with(&canonical_root)
    {
        return Err("确认记录目录超出资料库范围。".into());
    }
    let path = directory.join("writer.lock");
    if path.exists()
        && !path
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(&canonical_root)
    {
        return Err("确认锁超出资料库范围。".into());
    }
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|e| e.to_string())?;
    lock.try_lock()
        .map_err(|_| "另一项修改正在提交，请稍后重新确认。".to_string())?;
    Ok(lock)
}

fn persist_status(
    request: &DecideAssistantProposalRequest,
    record: &DecisionRecord,
) -> Result<(), String> {
    let conversation = load_conversation(ConversationRequest {
        root: request.root.clone(),
        conversation_id: request.conversation_id.clone(),
    })?;
    let message = conversation
        .messages
        .iter()
        .find(|m| m.message_id == request.message_id)
        .ok_or("提案消息已不存在，请核对提交结果。")?;
    let mut parts = message.parts.clone();
    for part in &mut parts {
        if matches!(
            part["type"].as_str(),
            Some("tag-proposal" | "entry-meta-proposal")
        ) && part["proposal"]["id"].as_str() == Some(&request.proposal_id)
        {
            part["proposal"] = record.proposal.clone();
            part["proposal"]["status"] = json!(record.status);
            if record.status == "applied" {
                part["proposal"]["appliedAt"] = json!(chrono::Utc::now().to_rfc3339());
            }
        }
    }
    update_conversation_message(UpdateConversationMessageRequest {
        root: request.root.clone(),
        conversation_id: request.conversation_id.clone(),
        message_id: request.message_id.clone(),
        content: None,
        source_links: None,
        tool_events: None,
        note_proposals: None,
        parts: Some(parts),
    })?;
    Ok(())
}

enum Mutation {
    Tag(tag::ApplyTagProposalRequest),
    Entry(entry::ApplyEntryMetaProposalRequest),
}
fn mutation_from_saved(root: &std::path::Path, part: &Value) -> Result<Mutation, String> {
    let p = &part["proposal"];
    if part["type"] == "tag-proposal" {
        serde_json::from_value(
            json!({"root":root, "action":p["action"], "entry_ids":p["entryIds"],
            "name":p["name"], "new_name":p["newName"], "tag_id":p["tagId"]}),
        )
        .map(Mutation::Tag)
        .map_err(|e| e.to_string())
    } else {
        let fields = p["fields"].as_array().ok_or("缺少待确认的修改字段。")?;
        if fields.is_empty()
            || fields
                .iter()
                .any(|field| !matches!(field.as_str(), Some("title" | "description")))
            || (!fields.iter().any(|f| f == "title") && p["afterTitle"] != p["beforeTitle"])
            || (!fields.iter().any(|f| f == "description")
                && p["afterDescription"] != p["beforeDescription"])
        {
            return Err("提案包含未展示的修改字段，请重新生成。".into());
        }
        serde_json::from_value(
            json!({"root":root, "entry_id":p["entryId"], "base_updated_at":p["baseUpdatedAt"],
            "title":p["afterTitle"], "description":p["afterDescription"]}),
        )
        .map(Mutation::Entry)
        .map_err(|e| e.to_string())
    }
}
fn response(workspace: &Workspace, status: &str) -> Result<ProposalDecisionResponse, String> {
    Ok(ProposalDecisionResponse {
        status: status.into(),
        entries: workspace.list_entries().map_err(|e| e.to_string())?,
        tags: workspace.list_tags().map_err(|e| e.to_string())?,
    })
}

#[cfg(test)]
#[path = "assistant_proposal_tests.rs"]
mod tests;
