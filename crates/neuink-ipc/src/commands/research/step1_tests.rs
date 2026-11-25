use super::*;
use super::arxiv_paper::ArxivPaper as Paper;
use std::{
    collections::BTreeMap,
    fs,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

fn snapshot(root: &Path) -> BTreeMap<String, String> {
    fn walk(root: &Path, path: &Path, rows: &mut BTreeMap<String, String>) {
        for entry in fs::read_dir(path).unwrap() {
            let path = entry.unwrap().path();
            let name = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if path.is_dir() {
                rows.insert(format!("{name}/"), "directory".into());
                walk(root, &path, rows);
            } else {
                rows.insert(
                    name,
                    blake3::hash(&fs::read(&path).unwrap()).to_hex().to_string(),
                );
            }
        }
    }
    let mut rows = BTreeMap::new();
    walk(root, root, &mut rows);
    rows
}

fn observe(id: &str, actual: Value) {
    println!("STEP1_JSON {}", json!({"case_id":id,"actual":actual}));
}

fn feed(count: usize) -> String {
    let entries: String = (1..=count).map(|i| format!(
        "<entry><id>https://arxiv.org/abs/2401.{i:05}v2</id><title>Fixture {i}</title><summary>Summary</summary><published>2024-01-01T00:00:00Z</published><updated>2024-01-02T00:00:00Z</updated><author><name>Author</name></author><category term=\"cs.LG\"/><arxiv:primary_category term=\"cs.LG\"/><arxiv:doi>10.1/fixture</arxiv:doi><arxiv:comment>Comment</arxiv:comment><arxiv:journal_ref>Journal</arxiv:journal_ref></entry>"
    )).collect();
    format!("<feed xmlns=\"http://www.w3.org/2005/Atom\" xmlns:arxiv=\"http://arxiv.org/schemas/atom\">{entries}</feed>")
}

#[test]
fn step1_parser_count_metadata_and_roundtrip() {
    for count in [0, 1, 20, 21, 30, 31, 100, 1000] {
        let xml = feed(count);
        let started = std::time::Instant::now();
        let papers = arxiv_feed::parse_arxiv(&xml).unwrap();
        let serialized = serde_json::to_vec(&papers).unwrap();
        let decoded: Vec<Paper> = serde_json::from_slice(&serialized).unwrap();
        assert_eq!(papers.len(), count);
        assert_eq!(decoded, papers);
        for (index, paper) in papers.iter().enumerate() {
            assert_eq!(paper.id, format!("arxiv:2401.{:05}v2", index + 1));
            assert_eq!(paper.arxiv.categories, Some(vec!["cs.LG".into()]));
            assert_eq!(paper.arxiv.primary_category.as_deref(), Some("cs.LG"));
            assert_eq!(paper.arxiv.updated.as_deref(), Some("2024-01-02T00:00:00Z"));
            assert_eq!(paper.arxiv.comment.as_deref(), Some("Comment"));
            assert_eq!(paper.arxiv.journal_ref.as_deref(), Some("Journal"));
            assert_eq!(paper.doi, "10.1/fixture");
        }
        observe(
            "T-STEP1-P10-COUNTS",
            json!({"input_count":count,"parsed_count":papers.len(),
            "xml_bytes":xml.len(),"json_bytes":serialized.len(),"elapsed_us":started.elapsed().as_micros(),
            "roundtrip_equal":decoded == papers,"peak_memory_measured":false}),
        );
    }
}

#[test]
fn step1_long_unicode_fields_and_old_record_compatibility() {
    let long = "研究🧪".repeat(5000);
    let authors = "<author><name>".to_string() + &long + "</name></author>";
    let xml = format!("<feed><entry><id>https://arxiv.org/abs/hep-th/9901001v2</id><title>{long}</title><summary>{long}</summary><published>1999-01-01</published>{}</entry></feed>", authors.repeat(60));
    let paper = arxiv_feed::parse_arxiv(&xml).unwrap().remove(0);
    assert_eq!(paper.id, "arxiv:hep-th/9901001v2");
    assert_eq!(paper.arxiv.base_id.as_deref(), Some("hep-th/9901001"));
    assert_eq!(paper.title, long);
    assert_eq!(paper.abstract_text, long);
    assert_eq!(paper.authors, vec![long.clone(); 60]);
    let mut legacy = serde_json::to_value(&paper).unwrap();
    for key in [
        "base_id",
        "categories",
        "primary_category",
        "published",
        "updated",
        "comment",
        "journal_ref",
        "rank",
    ] {
        legacy.as_object_mut().unwrap().remove(key);
    }
    let decoded: Paper = serde_json::from_value(legacy.clone()).unwrap();
    assert_eq!(decoded.arxiv, Default::default());
    assert_eq!(serde_json::to_value(decoded).unwrap(), legacy);
    observe(
        "T-STEP1-FIELDS",
        json!({"id":paper.id,"base_id":paper.arxiv.base_id,
        "title_bytes":paper.title.len(),"abstract_bytes":paper.abstract_text.len(),"authors":paper.authors.len(),
        "xml_bytes":xml.len(),"legacy_roundtrip":true}),
    );
}

#[tokio::test]
async fn step1_search_read_only_validation_and_outcomes() {
    for scenario in [
        "complete",
        "empty",
        "missing_layout",
        "bad_marker",
        "schema",
        "journal",
    ] {
        let temp = tempfile::tempdir().unwrap();
        if scenario != "empty" {
            neuink_workspace::Workspace::create(temp.path()).unwrap();
        }
        match scenario {
            "missing_layout" => fs::remove_dir(temp.path().join("conversations")).unwrap(),
            "bad_marker" => fs::write(temp.path().join("neuink.workspace.json"), "{").unwrap(),
            "schema" => fs::write(
                temp.path().join("neuink.workspace.json"),
                "{\"schema_version\":99,\"tags\":[]}",
            )
            .unwrap(),
            "journal" => fs::write(
                temp.path().join("tag-operation.journal.json"),
                "pending-evidence",
            )
            .unwrap(),
            _ => {}
        }
        let before = snapshot(temp.path());
        let polled = AtomicBool::new(false);
        let result = paper_search::read_only(temp.path(), async {
            polled.store(true, Ordering::SeqCst);
            Ok((providers::parse_arxiv(&feed(21)).unwrap(), BTreeMap::new()))
        })
        .await;
        let allowed = matches!(scenario, "complete" | "missing_layout");
        assert_eq!(result.is_ok(), allowed, "{scenario}: {result:?}");
        assert_eq!(polled.load(Ordering::SeqCst), allowed);
        assert_eq!(snapshot(temp.path()), before);
        if let Ok(ref output) = result {
            assert_eq!(output["papers"].as_array().unwrap().len(), 20);
            let root = temp.path().canonicalize().unwrap();
            let cached = cache().lock().unwrap();
            assert_eq!(cached.iter().filter(|p| p.root == root).count(), 20);
        }
        observe(
            "T-STEP1-READONLY",
            json!({"scenario":scenario,"accepted":result.is_ok(),
            "error":result.err(),"search_polled":polled.load(Ordering::SeqCst),
            "before":before,"after":snapshot(temp.path()),"full_tauri_command":false}),
        );
    }
    let temp = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(temp.path()).unwrap();
    let before = snapshot(temp.path());
    let failure =
        paper_search::read_only(temp.path(), async { Err("fixture network failure".into()) }).await;
    assert_eq!(failure.unwrap_err(), "fixture network failure");
    let cancelled = tokio::time::timeout(
        std::time::Duration::from_millis(10),
        paper_search::read_only(temp.path(), std::future::pending()),
    )
    .await;
    assert!(cancelled.is_err());
    assert_eq!(snapshot(temp.path()), before);
    let root = temp.path().canonicalize().unwrap();
    assert!(!cache().lock().unwrap().iter().any(|p| p.root == root));
    observe(
        "T-STEP1-READONLY-OUTCOMES",
        json!({"provider_error":"fixture network failure",
        "timeout_dropped_future":true,"before":before,"after":snapshot(temp.path()),"cache_rows":0}),
    );
}

#[tokio::test]
async fn step1_pending_transaction_during_search_is_not_recovered_or_cached() {
    let temp = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(temp.path()).unwrap();
    let result = paper_search::read_only(temp.path(), async {
        // Simulates another actor, not a write made by the search implementation.
        fs::write(
            temp.path().join("tag-operation.journal.json"),
            "external-pending",
        )
        .unwrap();
        Ok((providers::parse_arxiv(&feed(1)).unwrap(), BTreeMap::new()))
    })
    .await;
    assert!(result.unwrap_err().contains("事务"));
    assert_eq!(
        fs::read_to_string(temp.path().join("tag-operation.journal.json")).unwrap(),
        "external-pending"
    );
    let root = temp.path().canonicalize().unwrap();
    assert!(!cache().lock().unwrap().iter().any(|p| p.root == root));
    observe(
        "T-STEP1-PENDING-DURING-SEARCH",
        json!({"rejected":true,"journal_preserved":true,"cache_rows":0,
        "journal_created_by_fixture_actor":true,"concurrent_cross_process_atomicity_proven":false}),
    );
}

#[test]
fn step1_complete_records_survive_real_conversation_save_and_load() {
    use crate::commands::conversation::*;
    let temp = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(temp.path()).unwrap();
    let papers = arxiv_feed::parse_arxiv(&feed(100)).unwrap();
    let conversation = create_conversation(CreateConversationRequest {
        root: temp.path().to_path_buf(),
        title: "Step1 fixture".into(),
        scope_snapshot: ScopeSnapshot::default(),
    })
    .unwrap();
    let part = json!({"type":"tool-result","id":"step1","toolName":"arxiv_search","summary":"Fixture",
        "researchCacheSource":"arxiv_search","researchSearch":{"schema_version":1,"status":"ok"},"researchPapers":papers});
    append_conversation_messages(AppendConversationMessagesRequest {
        root: temp.path().to_path_buf(),
        conversation_id: conversation.id.clone(),
        messages: vec![ConversationMessageInput {
            role: ConversationRole::Assistant,
            content: "Fixture result".into(),
            source_links: vec![],
            tool_events: vec![],
            note_proposals: vec![],
            parts: vec![part.clone()],
        }],
    })
    .unwrap();
    let loaded = load_conversation(ConversationRequest {
        root: temp.path().to_path_buf(),
        conversation_id: conversation.id,
    })
    .unwrap();
    assert_eq!(loaded.messages[0].parts, vec![part]);
    let restored: Vec<Paper> =
        serde_json::from_value(loaded.messages[0].parts[0]["researchPapers"].clone()).unwrap();
    assert_eq!(restored, papers);
    observe(
        "T-STEP1-CONVERSATION-DISK",
        json!({"saved_count":papers.len(),"loaded_count":restored.len(),
        "all_fields_equal":restored == papers,"workspace":"temporary","network":false}),
    );
}

#[test]
fn step1_public_limit_preserved_and_step5_tool_is_registered() {
    let descriptors = enabled_descriptors(&neuink_config::ResearchSettings::default());
    let search = descriptors
        .iter()
        .find(|d| d.name == "search_papers")
        .unwrap();
    assert_eq!(
        search.parameters_schema["properties"]["limit"]["maximum"],
        10
    );
    assert!(descriptors.iter().any(|d| d.name == "arxiv_search"));
    observe(
        "T-STEP1-SCOPE",
        json!({"maximum":10,"arxiv_search_registered":true}),
    );
}

#[test]
fn step1_cache_capacity_is_still_a_separate_limit() {
    let temp = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(temp.path()).unwrap();
    let root = temp.path().canonicalize().unwrap();
    let before = snapshot(temp.path());
    let papers = arxiv_feed::parse_arxiv(&feed(513)).unwrap();
    arxiv_cache::remember(&root, &papers).unwrap();
    let old = arxiv_cache::selected(&Selection {
        root: root.clone(),
        paper_ids: vec![papers[0].id.clone()],
    });
    let newest = arxiv_cache::selected(&Selection {
        root: root.clone(),
        paper_ids: vec![papers[512].id.clone()],
    })
    .unwrap();
    assert!(old.is_err());
    assert_eq!(newest, vec![papers[512].clone()]);
    assert_eq!(
        arxiv_cache::cache()
            .lock()
            .unwrap()
            .iter()
            .filter(|p| p.root == root)
            .count(),
        512
    );
    assert_eq!(snapshot(temp.path()), before);
    observe(
        "T-STEP1-CACHE-CAPACITY",
        json!({"parsed_count":papers.len(),"cached_count":512,
        "oldest_select_error":old.err(),"newest_select_id":newest[0].id,"workspace_unchanged":true}),
    );
}
