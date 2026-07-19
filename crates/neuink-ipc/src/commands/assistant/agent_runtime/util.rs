use std::time::Instant;

use super::types::AgentRuntimeTraceEvent;

pub(crate) fn trace_event(id: &str, started: Instant, summary: String) -> AgentRuntimeTraceEvent {
    AgentRuntimeTraceEvent {
        id: id.to_string(),
        label: id.replace('.', " "),
        elapsed_ms: started.elapsed().as_millis(),
        summary,
    }
}

pub(crate) fn compact_quote(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(240)
        .collect()
}

pub(crate) fn trim_chars(text: String, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text;
    }
    let mut trimmed = text.chars().take(max_chars).collect::<String>();
    trimmed.push_str("\n[truncated]");
    trimmed
}
