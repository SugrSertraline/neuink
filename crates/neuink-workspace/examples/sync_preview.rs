//! Read-only inspection. Prints counts/reasons, never document text or credentials.
use neuink_workspace::sync_inventory;
use std::{collections::BTreeMap, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: sync_preview <workspace-root>")?;
    if let Some(entry) = std::env::args().nth(2) {
        let bundle = neuink_workspace::sync_export::export_entry(&root, &entry)?;
        let manifest = bundle.manifest();
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "entry_id":entry,"validated_entities":manifest.documents.len(),
                "validated_attachment_bytes":manifest.unique_attachment_bytes,
                "notices":manifest.notices,"uploads":0,"local_writes":0
            }))?
        );
        return Ok(());
    }
    let report = sync_inventory::preview(&root)?;
    let mut issues = BTreeMap::<String, usize>::new();
    for entry in &report.entries {
        if let Some(issue) = &entry.issue {
            *issues.entry(issue.clone()).or_default() += 1;
        }
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "entries":report.entries.len(),
            "validated_entries":report.entries.iter().filter(|entry| entry.issue.is_none()).count(),
            "validated_entities":report.validated_entities,
            "validated_attachment_bytes":report.validated_attachment_bytes,
            "candidate_unique_bytes":report.unique_bytes,
            "blocked_reasons":issues,
            "blocked_entries":report.entries.iter().filter(|entry| entry.issue.is_some()).map(|entry| &entry.entry_id).collect::<Vec<_>>(),
            "uploads":0,
            "local_writes":0
        }))?
    );
    Ok(())
}
