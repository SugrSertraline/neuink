use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[tokio::test]
#[ignore = "Requires configured Claude Code; two synthetic paginated paper reads"]
async fn real_claude_paged_paper_smoke() {
    let cwd = tempfile::tempdir().unwrap();
    let path = super::super::provider_executable(super::super::Provider::Claude)
        .await
        .unwrap();
    let suffix = blake3::hash(cwd.path().to_string_lossy().as_bytes()).to_hex();
    let session_id = format!("550e8400-e29b-41d4-a716-{}", &suffix[..12]);
    let first_word = format!("NEUINK_FIRST_{}", &suffix[12..20]);
    let last_word = format!("NEUINK_LAST_{}", &suffix[20..28]);
    let first = format!(
        "[S1] segment_uid: fixture-a\nFirst verification word: {first_word}.\n{}",
        "Synthetic paper evidence. ".repeat(240)
    );
    let last = format!("[S2] segment_uid: fixture-b\nLast verification word: {last_word}.\n");
    let split = first.len();
    let total = split + last.len();
    let revision = suffix[..8].to_string();
    let continuation =
        json!({"entry_id":"fixture-paper","offset":split,"limit":8000,"revision":revision});
    let request: Request = serde_json::from_value(json!({
        "provider":"claude","runId":session_id,"root":cwd.path(),"conversationId":"paper-fixture",
        "sessionId":session_id,"resume":false,
        "prompt":json!({"request":"Read the entire parsed fixture-paper using NeuInk tools. Report the first and last verification words exactly with their source markers. If more is true, follow next_read before answering. This is a synthetic integration test; do not use native Read or shell or modify files.",
            "targets":{"entry":{"id":"fixture-paper","title":"Synthetic paper"}}}).to_string(),
        "tools":[{"name":"read_entry_assistant_context","description":"Read parsed paper text in bounded chunks. When more is true, continue with the exact next_read arguments until all required chunks are read. Never read CLI cache files with native Read.",
            "inputSchema":{"type":"object","properties":{"entry_id":{"type":"string"},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":100,"maximum":12000},"revision":{"type":"string"}},"required":["entry_id"],"additionalProperties":false}},
            {"name":"approve_tool","description":"Host permission callback. Do not invoke directly.","inputSchema":{"type":"object","properties":{"tool_name":{"type":"string"},"input":{"type":"object"}},"required":["tool_name","input"]}}]
    })).unwrap();
    let replies: Replies = Arc::new(Mutex::new(HashMap::new()));
    let pending = replies.clone();
    let reads = Arc::new(Mutex::new(Vec::new()));
    let seen_reads = reads.clone();
    let native_reads = Arc::new(AtomicUsize::new(0));
    let seen_native_reads = native_reads.clone();
    let (_cancel, rx) = watch::channel(false);
    let result = tokio::time::timeout(Duration::from_secs(90), execute(
        &request, cwd.path(), path, rx, replies,
        Arc::new(move |event| {
            if let Event::Message { value } = &event {
                if value["type"] == "assistant" {
                    if let Some(content) = value["message"]["content"].as_array() {
                        for block in content {
                            if block["type"] == "tool_use" && block["name"] == "Read" {
                                seen_native_reads.fetch_add(1, Ordering::SeqCst);
                            }
                        }
                    }
                }
            }
            if let Event::Tool { id, name, input } = event {
                let offset = input["offset"].as_u64().unwrap_or(0) as usize;
                let valid_read = name == "read_entry_assistant_context" && input["entry_id"] == "fixture-paper"
                    && (offset == 0 || input == continuation);
                let output = if valid_read {
                    seen_reads.lock().unwrap().push(offset);
                    let more = offset == 0;
                    json!({"content":[{"type":"text","text":json!({"kind":"read_entry_assistant_context","reading_mode":"parsed_markdown",
                        "entry_id":"fixture-paper","entry_title":"Synthetic paper","markdown":if more {&first} else {&last},
                        "source_markers":[if more {"[S1]"} else {"[S2]"}],"offset":offset,"chars_returned":if more {split} else {total-split},
                        "total_chars":total,"revision":revision,"more":more,"next_offset":if more {Some(split)} else {None},
                        "next_read":if more {continuation.clone()} else {Value::Null},"truncated_for_context":true}).to_string()}]})
                } else if name == "approve_tool" {
                    let allow = matches!(input["tool_name"].as_str(), Some("mcp__neuink__read_entry_assistant_context" | "ToolSearch"));
                    json!({"content":[{"type":"text","text":json!({"behavior":if allow {"allow"} else {"deny"},"updatedInput":input["input"]}).to_string()}]})
                } else {
                    json!({"isError":true,"content":[{"type":"text","text":"Use only the synthetic paper and its exact next_read arguments."}]})
                };
                if let Some(sender) = pending.lock().unwrap().remove(&id) {
                    let _ = sender.send(output);
                }
            }
            Ok(())
        })
    )).await.expect("Paper MCP smoke timeout").expect("Paper MCP integration failed");
    let answer = result["result"].as_str().unwrap_or("");
    assert!(
        reads.lock().unwrap().contains(&0),
        "Must read the first chunk"
    );
    assert!(
        reads.lock().unwrap().contains(&split),
        "Must follow next_read"
    );
    assert_eq!(
        native_reads.load(Ordering::SeqCst),
        0,
        "Must not fall back to native Read"
    );
    assert!(
        answer.contains(&first_word) && answer.contains(&last_word),
        "Must use evidence from both chunks"
    );
    assert!(
        answer.contains("[S1]") && answer.contains("[S2]"),
        "Must cite both returned source markers"
    );
}
