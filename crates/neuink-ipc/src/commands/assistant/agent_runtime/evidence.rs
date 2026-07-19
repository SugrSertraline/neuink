use std::time::Instant;

use neuink_search::{SearchMode, SearchResults, SearchTarget};
use neuink_workspace::Workspace;

use crate::commands::search::{search_segments, SearchSegmentsRequest};

use super::super::{
    read_entry_assistant_context_from_workspace, AssistantContextSnapshotResponse,
    EntryAssistantSource, ReadEntryAssistantContextResponse,
};
use super::types::{EvidenceBundle, RunAgentSubagentTaskRequest};
use super::util::{compact_quote, trace_event, trim_chars};

pub(crate) async fn collect_evidence<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: &RunAgentSubagentTaskRequest,
) -> Result<EvidenceBundle, String> {
    let mut handles = Vec::new();
    let search_request = SearchSegmentsRequest {
        root: request.root.clone(),
        query: request.question.clone(),
        scope_entry_ids: request.scope.entry_ids.clone(),
        mode: SearchMode::Hybrid,
        top_k: Some(8),
    };
    handles.push(tokio::spawn(async move {
        let started = Instant::now();
        let results = search_segments(app, search_request).await?;
        Ok::<_, String>(evidence_from_search(results, started))
    }));

    for entry_id in request.scope.entry_ids.iter().take(3).cloned() {
        let root = request.root.clone();
        handles.push(tokio::task::spawn_blocking(move || {
            let started = Instant::now();
            let workspace = Workspace::open(&root).map_err(|error| error.to_string())?;
            let context = read_entry_assistant_context_from_workspace(&workspace, entry_id)?;
            Ok::<_, String>(evidence_from_entry_context(context, started))
        }));
    }

    let mut text = context_snapshot_text(request.context_snapshot.as_ref());
    let mut sources = snapshot_sources(request.context_snapshot.as_ref());
    let mut trace = Vec::new();

    for handle in handles {
        match handle.await.map_err(|error| error.to_string())? {
            Ok(mut bundle) => {
                if !bundle.text.trim().is_empty() {
                    text.push_str("\n\n");
                    text.push_str(&bundle.text);
                }
                sources.append(&mut bundle.sources);
                trace.append(&mut bundle.trace);
            }
            Err(error) => trace.push(super::types::AgentRuntimeTraceEvent {
                id: "agent.evidence.error".to_string(),
                label: "Evidence warning".to_string(),
                elapsed_ms: 0,
                summary: error,
            }),
        }
    }

    Ok(EvidenceBundle {
        text: trim_chars(text, 48_000),
        sources: unique_sources(sources),
        trace,
    })
}

fn evidence_from_search(results: SearchResults, started: Instant) -> EvidenceBundle {
    let mut lines = Vec::new();
    let mut sources = Vec::new();

    for hit in results.entries.iter().flat_map(|entry| &entry.hits).take(8) {
        let SearchTarget::Segment {
            entry_id,
            segment_uid,
            page_idx,
        } = &hit.target
        else {
            continue;
        };
        lines.push(format!(
            "[{} p.{}] {}\n{}",
            hit.entry_title,
            page_idx + 1,
            segment_uid,
            hit.snippet
        ));
        sources.push(EntryAssistantSource {
            entry_id: entry_id.clone(),
            entry_title: hit.entry_title.clone(),
            segment_uid: segment_uid.clone(),
            page_idx: *page_idx,
            quote: compact_quote(&hit.snippet),
        });
    }

    EvidenceBundle {
        text: lines.join("\n\n"),
        sources,
        trace: vec![trace_event(
            "agent.search",
            started,
            format!(
                "Search returned {} hit(s) using {}.",
                results.total_hit_count, results.mode
            ),
        )],
    }
}

fn evidence_from_entry_context(
    context: ReadEntryAssistantContextResponse,
    started: Instant,
) -> EvidenceBundle {
    EvidenceBundle {
        text: trim_chars(context.markdown, 20_000),
        sources: context.sources,
        trace: vec![trace_event(
            "agent.read_entry",
            started,
            format!("Read assistant context for {}.", context.entry_title),
        )],
    }
}

fn context_snapshot_text(snapshot: Option<&AssistantContextSnapshotResponse>) -> String {
    let Some(snapshot) = snapshot else {
        return String::new();
    };
    let mut lines = Vec::new();
    if let Some(document) = &snapshot.document {
        lines.push(format!(
            "Active document: {}\n{}",
            document.entry_title,
            trim_chars(document.markdown.clone(), 24_000)
        ));
    }
    if let Some(note) = &snapshot.active_note {
        lines.push(format!(
            "Active note: {}\n{}",
            note.note_title,
            trim_chars(note.markdown.clone(), 8_000)
        ));
    }
    if !snapshot.pinned_segments.is_empty() {
        lines.push(
            snapshot
                .pinned_segments
                .iter()
                .map(|segment| {
                    format!(
                        "Pinned segment: {} p.{}\n{}",
                        segment.entry_title,
                        segment.page_idx + 1,
                        segment.text
                    )
                })
                .collect::<Vec<_>>()
                .join("\n\n"),
        );
    }
    lines.join("\n\n")
}

fn snapshot_sources(
    snapshot: Option<&AssistantContextSnapshotResponse>,
) -> Vec<EntryAssistantSource> {
    let Some(snapshot) = snapshot else {
        return Vec::new();
    };
    let mut sources = Vec::new();
    if let Some(document) = &snapshot.document {
        sources.extend(document.sources.clone());
    }
    sources.extend(
        snapshot
            .pinned_segments
            .iter()
            .map(|segment| EntryAssistantSource {
                entry_id: segment.entry_id.clone(),
                entry_title: segment.entry_title.clone(),
                segment_uid: segment.segment_uid.clone(),
                page_idx: segment.page_idx,
                quote: compact_quote(&segment.text),
            }),
    );
    sources
}

fn unique_sources(sources: Vec<EntryAssistantSource>) -> Vec<EntryAssistantSource> {
    let mut unique = Vec::new();
    for source in sources {
        let exists = unique.iter().any(|item: &EntryAssistantSource| {
            item.entry_id == source.entry_id && item.segment_uid == source.segment_uid
        });
        if !exists {
            unique.push(source);
        }
    }
    unique
}
