//! Research report writes use the same immutable Verified Proposal and apply receipt
//! as normal assistant edits. No model output is accepted back from the UI.
use super::{
    note_apply_content::{proposal_digest, stable_hash},
    note_apply_store::{receipt_path, VerifiedNoteProposal},
};
use neuink_domain::EntryId;
use neuink_workspace::Workspace;
use serde_json::{json, Value};

pub(crate) fn preview(ws: &Workspace, task_id: &str, entry_id: &str) -> Result<Value, String> {
    if entry_id.is_empty()
        || entry_id.len() > 100
        || !entry_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("目标条目无效".into());
    }
    let task = ws.read_research_task(task_id).map_err(|e| e.to_string())?;
    if task.status != "completed" || task.report.trim().is_empty() {
        return Err("只有完成的研究报告可以生成笔记预览".into());
    }
    let entry = ws
        .read_entry(&EntryId::from_string(entry_id))
        .map_err(|_| "目标条目不存在或已删除")?;
    let id = format!(
        "research-{task_id}-{}",
        &blake3::hash(entry_id.as_bytes()).to_hex()[..20]
    );
    let key = format!("apply-{id}");
    let title = format!(
        "Research · {}",
        task.query.chars().take(65).collect::<String>()
    );
    let mut markdown = format!(
        "# {title}\n\n{}\n\n---\n\n研究时间：{} · {} {}\n\n",
        task.report, task.created_at, if task.engine == "deerflow" { "DeerFlow" } else { "GPT Researcher" }, task.engine_version
    );
    if !task.documents.is_empty() {
        markdown.push_str("## 本地资料范围\n\n");
        for (i, doc) in task.documents.iter().enumerate() {
            markdown.push_str(&format!(
                "- Local {}：{}（{}）\n",
                i + 1,
                doc.title,
                doc.evidence_level
            ));
        }
    }
    markdown.push_str("\n## 检索来源\n\n");
    for (i, url) in task.source_urls.iter().enumerate() {
        markdown.push_str(&format!("- [来源 {}]({url})\n", i + 1));
    }
    let mut proposal = VerifiedNoteProposal {
        action: "create".into(),
        base_content_hash: Some(stable_hash("")),
        before_markdown: Some(String::new()),
        entry_id: entry_id.into(),
        id: id.clone(),
        idempotency_key: key.clone(),
        markdown,
        note_id: None,
        patch_operations: vec![],
        proposal_digest: String::new(),
        segment_uid: None,
        sources: vec![],
        target_kind: "markdown_note".into(),
        task_id: format!("research-{task_id}"),
        title: title.clone(),
        verified_at: chrono::Utc::now().to_rfc3339(),
        status: "pending".into(),
    };
    proposal.proposal_digest = proposal_digest(&proposal)?;
    let mut value = json!(proposal);
    value["createdAt"] = json!(proposal.verified_at);
    value["entryTitle"] = json!(entry.title);
    value["rationale"] =
        json!("将已完成报告新建为此条目的笔记；现有笔记保持原内容。来源列表与证据范围一并保存。");
    let mut saved = ws
        .save_research_proposal(&id, &value)
        .map_err(|e| e.to_string())?;
    if receipt_path(ws.layout().root(), &key).exists() {
        saved["status"] = json!("applied");
    }
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::super::note_apply::{
        apply_note_proposal_impl, ApplyNoteProposalRequest, ApplyNoteProposalResponse,
    };
    use super::*;
    #[test]
    fn report_preview_applies_once_and_rejects_tampered_content() {
        let dir = tempfile::tempdir().unwrap();
        let ws = Workspace::create(dir.path()).unwrap();
        let entry = ws.create_entry("Report owner").unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let task = neuink_domain::deep_research::ResearchTask {
            version: 1,
            id: "task-1".into(),
            query: "Comparison".into(),
            parent_id: None,
            created_at: now.clone(),
            updated_at: now,
            status: "completed".into(),
            stage: "Done".into(),
            profile_id: "test".into(),
            model: "test".into(),
            retriever: "arxiv".into(),
            depth: "brief".into(),
            timeout_seconds: 300,
            documents: vec![],
            source_urls: vec!["https://arxiv.org/abs/1706.03762".into()],
            report: "Report with [source](https://arxiv.org/abs/1706.03762)".into(),
            error: None,
            engine_version: "0.16.1".into(),
            engine: "gpt-researcher".into(),
            cost_estimate: None,
        };
        ws.write_research_task(&task).unwrap();
        let value = preview(&ws, &task.id, entry.id.as_str()).unwrap();
        let request = || ApplyNoteProposalRequest {
            root: dir.path().to_owned(),
            proposal_id: value["id"].as_str().unwrap().into(),
            task_id: value["taskId"].as_str().unwrap().into(),
        };
        let first = match apply_note_proposal_impl(request()).unwrap() {
            ApplyNoteProposalResponse::Applied { receipt } => receipt,
            _ => panic!("expected new note"),
        };
        let second = match apply_note_proposal_impl(request()).unwrap() {
            ApplyNoteProposalResponse::Applied { receipt } => receipt,
            _ => panic!("expected idempotency"),
        };
        assert_eq!(first.note_id, second.note_id);
        assert_eq!(ws.read_entry(&entry.id).unwrap().contents.len(), 1);
        assert_eq!(
            preview(&ws, &task.id, entry.id.as_str()).unwrap()["status"],
            "applied"
        );
        let mut proposal: VerifiedNoteProposal = serde_json::from_value(value).unwrap();
        proposal.markdown.push_str("tampered");
        assert_ne!(
            proposal_digest(&proposal).unwrap(),
            proposal.proposal_digest
        );
    }
}
