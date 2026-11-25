use neuink_domain::deep_research::ResearchTask;
use neuink_workspace::Workspace;
use serde_json::{json, Value};
use std::collections::HashSet;

pub fn read(ws: &Workspace, id: &str) -> Result<Vec<ResearchTask>, String> {
    let mut current = Some(id.to_string());
    let mut seen = HashSet::new();
    let mut tasks = Vec::new();
    while let Some(id) = current {
        if tasks.len() >= 20 || !seen.insert(id.clone()) { return Err("研究对话已达到长度上限，请新建对话".into()); }
        let task = ws.read_research_task(&id).map_err(|_| "研究记录不可用，请新建对话或重新打开历史")?;
        current = task.parent_id.clone();
        tasks.push(task);
    }
    tasks.reverse();
    Ok(tasks)
}

pub fn context(ws: &Workspace, parent: Option<&str>, new_id: &str) -> Result<Vec<Value>, String> {
    let Some(id) = parent else { return Ok(vec![]); };
    let tasks = read(ws, id)?;
    if tasks.len() >= 20 || tasks.iter().any(|t| t.id == new_id || t.status == "running") {
        return Err("请等待当前研究结束，或新建研究对话".into());
    }
    // Bound the prompt without duplicating past report bodies in every task file.
    Ok(tasks.iter().rev().take(4).collect::<Vec<_>>().into_iter().rev().map(|t|
        json!({"question":t.query,"answer":t.report.chars().take(16000).collect::<String>(),"status":t.status})
    ).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn task(id: usize) -> ResearchTask {
        serde_json::from_value(json!({"version":1,"id":format!("research-{id}"),"parent_id":if id > 0 { Some(format!("research-{}",id-1)) } else {None},
            "query":format!("question {id}"),"created_at":"2026-10-24","updated_at":"2026-10-24","status":"completed","stage":"研究完成",
            "profile_id":"test","model":"test","retriever":"auto","depth":"deep","timeout_seconds":3600,"documents":[],"source_urls":[],"report":"文".repeat(17000),"error":null,"engine_version":"2.1.0","engine":"deerflow","cost_estimate":null})).unwrap()
    }
    #[test]
    fn history_is_bounded_ordered_and_cannot_change_identity() {
        let tmp = tempfile::tempdir().unwrap(); let ws = Workspace::create(tmp.path()).unwrap();
        for id in 0..6 { ws.write_research_task(&task(id)).unwrap(); }
        let history = context(&ws, Some("research-5"), "research-6").unwrap();
        assert_eq!(history.len(),4); assert_eq!(history[0]["question"], "question 2");
        assert_eq!(history[3]["answer"].as_str().unwrap().chars().count(),16000);
        assert_eq!(read(&ws,"research-5").unwrap().len(),6);
        assert!(context(&ws, Some("research-5"), "research-2").is_err());
        assert!(context(&ws, Some("../secret"), "new").is_err());
        let mut changed = task(5); changed.parent_id = None;
        assert!(ws.write_research_task(&changed).is_err());
        let mut changed = task(5); changed.engine = "other".into();
        assert!(ws.write_research_task(&changed).is_err());
        let mut running = task(5); running.status = "running".into(); ws.write_research_task(&running).unwrap();
        assert!(context(&ws, Some("research-5"), "new").is_err());
    }
    #[test]
    fn legacy_reports_keep_their_engine_and_cycles_fail() {
        let mut value = serde_json::to_value(task(0)).unwrap();
        value.as_object_mut().unwrap().remove("engine"); value.as_object_mut().unwrap().remove("parent_id");
        let legacy: ResearchTask = serde_json::from_value(value).unwrap();
        assert_eq!(legacy.engine,"gpt-researcher"); assert!(legacy.parent_id.is_none());
        let tmp = tempfile::tempdir().unwrap(); let ws = Workspace::create(tmp.path()).unwrap();
        let mut first = task(0); first.parent_id = Some("research-1".into());
        ws.write_research_task(&first).unwrap(); ws.write_research_task(&task(1)).unwrap();
        assert!(read(&ws,"research-1").is_err());
    }
}
