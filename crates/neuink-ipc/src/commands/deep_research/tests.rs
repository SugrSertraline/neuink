use super::*;
use neuink_domain::deep_research::ResearchDocument;

#[test]
fn scope_requires_explicit_selection_and_detects_changes() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::create(dir.path()).unwrap();
    let entry = ws.create_entry("Test paper").unwrap();
    assert!(scope::freeze(&ws, &[]).unwrap().is_empty());
    assert!(scope::freeze(
        &ws,
        &[scope::Selection::Entry {
            entry_id: entry.id.to_string()
        }]
    )
    .is_err());
    assert!(scope::freeze(
        &ws,
        &[scope::Selection::Entry {
            entry_id: "../secret".into()
        }]
    )
    .is_err());
    let mut docs = vec![ResearchDocument {
        id: "one".into(),
        title: "A".into(),
        evidence_level: "abstract".into(),
        text: "before".into(),
    }];
    let first = scope_hash(&docs).unwrap();
    docs[0].text = "after".into();
    assert_ne!(scope_hash(&docs).unwrap(), first);
}

#[tokio::test]
#[ignore = "Explicit opt-in: real configured model plus public arXiv; credentials never printed or stored"]
async fn original_engine_real_mixed_scope() {
    let settings_file =
        std::env::var("NEUINK_RESEARCH_TEST_SETTINGS").expect("explicit settings path required");
    let selected =
        std::env::var("NEUINK_RESEARCH_TEST_PROFILE_ID").expect("explicit model profile required");
    let settings: Value = serde_json::from_slice(&std::fs::read(settings_file).unwrap()).unwrap();
    let profile = settings["llm_profiles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == selected)
        .unwrap()
        .clone();
    let data = tempfile::tempdir().unwrap();
    let ws = Workspace::create(data.path().join("library")).unwrap();
    let cache = PathBuf::from(std::env::var("NEUINK_RESEARCH_TEST_CACHE").expect("installed component cache required"));
    std::fs::create_dir_all(&cache).unwrap();
    runtime::check(&cache).await.unwrap();
    let endpoint = retriever::start(ws.layout().root().to_path_buf())
        .await
        .unwrap();
    let document = ResearchDocument { id:"attention-abstract".into(), title:"Attention Is All You Need — abstract excerpt".into(), evidence_level:"abstract".into(), text:"The Transformer is a network architecture based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. This supplied excerpt is abstract-level evidence only; it does not establish later efficient attention benchmark results.".into() };
    let (sender, mut cancel) = oneshot::channel();
    let payload = json!({"query":"Compare the supplied original Transformer abstract with efficient attention approaches. Use available primary academic sources. Write a Chinese report within 800 Chinese characters with verified source links and explain what cannot be concluded from abstracts.","profile":profile,"retriever_endpoint":endpoint.endpoint,"documents":[document]});
    let result = runtime::run(&cache, "real-test", payload, 620, &mut cancel, |_| Ok(()))
    .await
    .unwrap();
    drop(sender);
    if let Ok(output) = std::env::var("NEUINK_RESEARCH_TEST_REPORT") {
        std::fs::write(output, serde_json::to_vec_pretty(&result).unwrap()).unwrap();
    }
    let report = result["report"].as_str().unwrap();
    assert!(report
        .chars()
        .any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c)));
    assert!(
        !result["source_urls"].as_array().unwrap().is_empty(),
        "mixed task must include actual web evidence"
    );
    assert_eq!(result["local_sources"].as_array().unwrap().len(), 1);
    assert!(
        !report.contains("neuink-research-"),
        "temporary paths must not persist"
    );
    println!(
        "original version {}, report chars {}, web sources {}",
        result["version"],
        report.chars().count(),
        result["source_urls"].as_array().unwrap().len()
    );
}

#[tokio::test]
#[ignore = "Requires installed pinned Python runtime; no external model calls"]
async fn original_environment_cancels_and_rejects_unsupported_protocol_without_network() {
    let cache = PathBuf::from(std::env::var("NEUINK_RESEARCH_TEST_CACHE").expect("installed component cache required"));
    runtime::check(&cache).await.unwrap();
    let (sender, mut cancel) = oneshot::channel();
    sender.send(()).unwrap();
    let stopped = runtime::run(
        &cache,
        "cancel-test",
        json!({"action":"check"}),
        60,
        &mut cancel,
        |_| Ok(()),
    )
    .await;
    assert!(stopped.unwrap_err().contains("已取消"));
    let (_sender, mut cancel) = oneshot::channel();
    let result = runtime::run(
        &cache,
        "invalid-test",
        json!({"profile":{"api_protocol":"anthropic"},"query":"test"}),
        60,
        &mut cancel,
        |_| Ok(()),
    )
    .await;
    assert!(result.unwrap_err().contains("OpenAI"));
}
