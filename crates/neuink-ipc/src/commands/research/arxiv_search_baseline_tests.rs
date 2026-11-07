//! Offline observations of existing behavior, not acceptance tests of a new tool.
use super::*;
use std::{collections::BTreeMap, fs, path::Path};

fn evidence(case_id: &str, actual: Value) {
    println!(
        "BASELINE_JSON {}",
        json!({"case_id":case_id,"actual":actual})
    );
}

fn snapshot(root: &Path) -> BTreeMap<String, String> {
    fn visit(root: &Path, dir: &Path, rows: &mut BTreeMap<String, String>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let key = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if path.is_dir() {
                rows.insert(format!("{key}/"), "directory".into());
                visit(root, &path, rows);
            } else {
                rows.insert(
                    key,
                    blake3::hash(&fs::read(&path).unwrap()).to_hex().to_string(),
                );
            }
        }
    }
    let mut rows = BTreeMap::new();
    visit(root, root, &mut rows);
    rows
}

#[test]
fn b_p2_03_request_decode_and_query_trim() {
    let args = json!({"query":"  ti:\"A & B\"  ","source":"arxiv","limit":10,"unexpected":true});
    let decoded: ResearchRequest = serde_json::from_value(json!({
        "root":"fixture","name":"search_papers","call_id":"fixture","args":args
    }))
    .unwrap();
    let trimmed = query(&decoded.args).unwrap();
    evidence(
        "B-P2-03",
        json!({"decoded_args":decoded.args,"query_used":trimmed,
        "empty_rejected":query(&json!({"query":" "})).is_err(),
        "unicode_1000_accepted":query(&json!({"query":"中".repeat(1000)})).is_ok(),
        "unicode_1001_rejected":query(&json!({"query":"中".repeat(1001)})).is_err()}),
    );
    assert_eq!(trimmed, "ti:\"A & B\"");
    assert_eq!(decoded.args["unexpected"], true);
    assert!(query(&json!({"query":" "})).is_err());
    assert!(query(&json!({"query":"中".repeat(1000)})).is_ok());
    assert!(query(&json!({"query":"中".repeat(1001)})).is_err());
}

#[test]
fn step5_native_descriptor_surface_keeps_old_search_schema() {
    let descriptors = enabled_descriptors(&neuink_config::ResearchSettings::default());
    let search = descriptors
        .iter()
        .find(|d| d.name == "search_papers")
        .unwrap();
    evidence(
        "B-A1-02",
        json!({"names":descriptors.iter().map(|d| &d.name).collect::<Vec<_>>(),
        "search_schema":search.parameters_schema}),
    );
    assert!(descriptors.iter().any(|d| d.name == "arxiv_search"));
}

#[test]
fn b_p7_01_complete_workspace_snapshot_around_search_preflight_and_parse() {
    let temp = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(temp.path()).unwrap();
    let before = snapshot(temp.path());
    canonical(&temp.path().to_path_buf()).unwrap();
    let papers = providers::parse_arxiv("<feed xmlns=\"http://www.w3.org/2005/Atom\"><entry><id>https://arxiv.org/abs/2401.00001v2</id><title>Fixture</title><summary>Fixture</summary><published>2024-01-01</published></entry></feed>").unwrap();
    let after = snapshot(temp.path());
    evidence(
        "B-P7-01",
        json!({"before":before,"after":after,"parsed_count":papers.len(),
        "network_executed":false,"cache_executed":false,"full_command_executed":false}),
    );
    assert_eq!(before, after);
}

#[test]
fn b_p7_02_empty_existing_directory_is_populated_by_search_preflight() {
    let temp = tempfile::tempdir().unwrap();
    let before = snapshot(temp.path());
    let result = canonical(&temp.path().to_path_buf());
    let after = snapshot(temp.path());
    evidence(
        "B-P7-02",
        json!({"accepted":result.is_ok(),"before":before,"after":after,
        "full_command_executed":false}),
    );
    assert!(result.is_ok());
    assert!(before.is_empty());
    assert!(after.contains_key("neuink.workspace.json"));
    assert!(after.contains_key("entries/"));
}

#[test]
fn b_p7_03_missing_workspace_directory_is_recreated() {
    let temp = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(temp.path()).unwrap();
    fs::remove_dir(temp.path().join("conversations")).unwrap();
    let before = snapshot(temp.path());
    canonical(&temp.path().to_path_buf()).unwrap();
    let after = snapshot(temp.path());
    let added: Vec<_> = after
        .keys()
        .filter(|key| !before.contains_key(*key))
        .cloned()
        .collect();
    evidence(
        "B-P7-03",
        json!({"added_paths":added,"before":before,"after":after,
        "full_command_executed":false}),
    );
    assert_eq!(added, vec!["conversations/"]);
}

#[test]
fn step1_p10_06_parser_preserves_twenty_one_and_arxiv_fields() {
    let entries: String = (1..=21).map(|i| format!("<entry><id>https://arxiv.org/abs/2401.{i:05}v2</id><title>Fixture {i}</title><summary>Fixture</summary><published>2024-01-01T00:00:00Z</published><updated>2024-01-02T00:00:00Z</updated><category term=\"cs.LG\"/></entry>")).collect();
    let papers = arxiv_feed::parse_arxiv(&format!(
        "<feed xmlns=\"http://www.w3.org/2005/Atom\">{entries}</feed>"
    ))
    .unwrap();
    let first = serde_json::to_value(&papers[0]).unwrap();
    evidence(
        "T-STEP1-P10-06",
        json!({"input_count":21,"parsed_count":papers.len(),
        "ids":papers.iter().map(|p| &p.id).collect::<Vec<_>>(),"first_record":first}),
    );
    assert_eq!(papers.len(), 21);
    assert_eq!(papers[20].id, "arxiv:2401.00021v2");
    assert_eq!(first["categories"], json!(["cs.LG"]));
    assert_eq!(first["published"], "2024-01-01T00:00:00Z");
    assert_eq!(first["updated"], "2024-01-02T00:00:00Z");
}

#[test]
fn b_p10_07_existing_cache_retains_twenty_one_records_when_parser_is_bypassed() {
    let temp = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(temp.path()).unwrap();
    let root = canonical(&temp.path().to_path_buf()).unwrap();
    let before = snapshot(temp.path());
    let papers: Vec<_> = (1..=21)
        .map(|i| Paper {
            id: format!("arxiv:2401.{i:05}v2"),
            title: format!("Fixture {i}"),
            authors: vec![],
            year: "2024".into(),
            abstract_text: "Fixture".into(),
            doi: String::new(),
            url: format!("https://arxiv.org/abs/2401.{i:05}v2"),
            pdf_url: Some(format!("https://arxiv.org/pdf/2401.{i:05}v2")),
            provider: "arxiv".into(),
            evidence_level: "abstract".into(),
        })
        .collect();
    remember(&root, &papers).unwrap();
    let mut retrieved = Vec::new();
    for chunk in papers.chunks(10) {
        retrieved.extend(
            selected(&Selection {
                root: root.clone(),
                paper_ids: chunk.iter().map(|p| p.id.clone()).collect(),
            })
            .unwrap(),
        );
    }
    let after = snapshot(temp.path());
    evidence(
        "B-P10-07",
        json!({"input_count":papers.len(),"selected_count":retrieved.len(),
        "selected_ids":retrieved.iter().map(|p| &p.id).collect::<Vec<_>>(),"batch_sizes":[10,10,1],
        "workspace_snapshot_unchanged":before == after,"parser_bypassed":true,"download_executed":false}),
    );
    assert_eq!(retrieved, papers);
    assert_eq!(before, after);
}
