//! Opt-in public acceptance. Never runs during ordinary cargo test.
use super::*;
use super::super::{arxiv_http::Native, arxiv_runtime::Cancellation, arxiv_service, paper_search};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn write_new(path: &Path, value: &Value) {
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(path).unwrap();
    file.write_all(serde_json::to_string_pretty(value).unwrap().as_bytes()).unwrap();
}
fn setup(stage: &str) -> (Arc<ArxivGate>, PathBuf, tempfile::TempDir) {
    assert_eq!(std::env::var("NEUINK_GATE_PUBLIC_ACCEPTANCE").as_deref(), Ok("YES"));
    let evidence = PathBuf::from(std::env::var("NEUINK_GATE_ACCEPTANCE_EVIDENCE").unwrap());
    assert!(evidence.is_dir());
    let data = PathBuf::from(std::env::var("NEUINK_GATE_ACCEPTANCE_DATA").unwrap());
    assert!(data.is_absolute());
    std::fs::create_dir_all(&data).unwrap();
    let gate = Arc::new(ArxivGate::new(Some(data.join("arxiv-gate-state.json"))));
    assert!(SHARED.set(gate.clone()).is_ok(), "shared gate must be unset in this test process");
    acceptance_observer::install(evidence.join(format!("{stage}-http.json")), if stage == "load" {30} else {12}, 600);
    let workspace = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(workspace.path()).unwrap();
    (gate, evidence, workspace)
}
async fn new_search(root: &Path, args: Value) -> Result<Value, String> {
    arxiv_service::run(root, &args, true, &Native, &Cancellation::default()).await
}
async fn legacy(root: &Path) -> Result<Value, String> {
    scope("legacy_tool", 180, paper_search::read_only(root, paper_search::search("transformer", 3, "arxiv"))).await
}
async fn recommendation(data: &Path) -> Result<Value, String> {
    crate::commands::recommendations::acceptance_fetch(&data.join("cache"), "cat:cs.LG").await
        .map(|papers| json!({"status":"ok","returned_count":papers.len(),
            "paper_ids":papers.iter().map(|p|&p.paper.id).collect::<Vec<_>>()}))
        .map_err(|error| error.gate.map(|gate|gate.wire()).unwrap_or(error.message))
}
fn summarize(result: Result<Value, String>) -> Value {
    match result {
        Ok(value) => json!({"ok":true,"status":value.get("status").cloned().unwrap_or(json!("ok")),
            "returned_count":value.get("returned_count").cloned().unwrap_or_else(||json!(value["papers"].as_array().map(Vec::len))),
            "paper_ids":value.get("paper_ids").cloned().unwrap_or_else(||json!(value["papers"].as_array().map(|rows|rows.iter().map(|p|p["id"].clone()).collect::<Vec<_>>()))),
            "transport_calls":value.get("transport_calls"),"errors":value.get("errors"),
            "source_errors":value.get("source_errors"),"missing_ids":value.get("missing_ids")}),
        Err(error) => json!({"ok":false,"gate":from_wire(&error),
            "local_error":if from_wire(&error).is_some(){None}else{Some(error)}}),
    }
}
fn rate_limited(gate: &ArxivGate) -> bool {
    gate.traces().iter().any(|row|row.code.as_deref()==Some("rate_limited"))
}
fn case(evidence: &Path, label: &str, result: Result<Value, String>, gate: &ArxivGate) -> bool {
    let actual = summarize(result);
    println!("GATE_ACCEPT_CASE {}", json!({"case":label,"actual":actual}));
    write_new(&evidence.join(format!("{label}.json")), &json!({"case":label,"actual":actual,"traces":gate.traces()}));
    actual["ok"] == true && actual["status"] == "ok"
        && actual["returned_count"].as_u64().is_some_and(|count|count > 0)
        && actual["source_errors"].as_object().is_none_or(|rows|rows.is_empty())
        && actual["errors"].as_array().is_none_or(|rows|rows.is_empty())
        && actual["errors"].as_object().is_none_or(|rows|rows.is_empty())
}
fn finish(evidence: &Path, stage: &str, gate: &ArxivGate, passed: bool) {
    let report = acceptance_observer::report();
    let valid_spacing = report["end_to_next_start_gaps_ms"].as_array().unwrap().iter().all(|gap|gap.as_i64().unwrap() >= 2999);
    let passed = passed && !rate_limited(gate) && valid_spacing && report["peak_active"].as_u64().unwrap() <= 1;
    write_new(&evidence.join(format!("{stage}-summary.json")), &json!({"stage":stage,"passed":passed,
        "rate_limited":rate_limited(gate),"spacing_valid":valid_spacing,
        "metrics":report,"traces":gate.traces(),"models_called":0,"pdf_downloaded":false}));
    assert!(passed, "Public acceptance stage failed; inspect saved evidence. No automatic rerun.");
}

#[tokio::test]
#[ignore = "Explicit public arXiv acceptance, opt-in required; no PDF or model"]
async fn gate_acceptance_simple_live() {
    let (gate, evidence, workspace) = setup("simple");
    let data = PathBuf::from(std::env::var("NEUINK_GATE_ACCEPTANCE_DATA").unwrap());
    let mut passed = case(&evidence, "simple-new-id", new_search(workspace.path(), json!({"mode":"ids","ids":["1706.03762v1"]})).await, &gate);
    if !rate_limited(&gate) {
        passed &= case(&evidence, "simple-legacy", legacy(workspace.path()).await, &gate);
    }
    if !rate_limited(&gate) {
        passed &= case(&evidence, "simple-recommendation", recommendation(&data).await, &gate);
    }
    finish(&evidence, "simple", &gate, passed);
}

#[tokio::test]
#[ignore = "FINAL stage only: bounded live load after simple/native acceptance"]
async fn gate_acceptance_load_live() {
    let (gate, evidence, workspace) = setup("load");
    let checkpoint: Value = serde_json::from_slice(&std::fs::read(evidence.join("preload-checkpoint.json")).unwrap()).unwrap();
    assert_eq!(checkpoint["earlier_stages_recorded"], true);
    let simple: Value = serde_json::from_slice(&std::fs::read(evidence.join("simple-summary.json")).unwrap()).unwrap();
    assert_eq!(simple["passed"], true, "Do not load-test a failed basic connection");
    let data = PathBuf::from(std::env::var("NEUINK_GATE_ACCEPTANCE_DATA").unwrap());
    let root = workspace.path();
    let work = async {
        for round in 0..6 {
            let result = if round % 2 == 0 {
                new_search(root, json!({"mode":"structured","query":"transformer","page_size":3,"max_results":3})).await
            } else { legacy(root).await };
            if !case(&evidence, &format!("load-sequential-{}",round+1), result, &gate) { return false; }
        }
        let paged = json!({"mode":"raw","raw_query":"cat:cs.LG","page_size":5,"max_results":15});
        let result = new_search(root, paged.clone()).await;
        let complete_pages = result.as_ref().is_ok_and(|v|v["transport_calls"]==3 && v["returned_count"]==15);
        if !case(&evidence, "load-pagination", result, &gate) || !complete_pages { return false; }
        let (recommended, paginated, old) = tokio::join!(recommendation(&data), new_search(root, paged), legacy(root));
        let complete_pages = paginated.as_ref().is_ok_and(|v|v["transport_calls"]==3 && v["returned_count"]==15);
        let a = case(&evidence, "load-cross-recommendation", recommended, &gate);
        let b = case(&evidence, "load-cross-pagination", paginated, &gate);
        let c = case(&evidence, "load-cross-legacy", old, &gate);
        a && b && c && complete_pages
    };
    let passed = tokio::time::timeout(Duration::from_secs(600), work).await.unwrap_or(false);
    finish(&evidence, "load", &gate, passed);
}
