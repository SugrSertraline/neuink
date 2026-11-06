use super::*;
use super::arxiv_cache::{selected, remember, cache};
use super::{
    arxiv_http::{Reply, Transport},
    arxiv_runtime::Cancellation,
    network::StatusResponse,
};
use std::{collections::VecDeque, future::Future, pin::Pin};

struct Fixture(std::sync::Mutex<VecDeque<Reply>>);
impl Transport for Fixture {
    fn get(&self, _: reqwest::Url) -> Pin<Box<dyn Future<Output = Reply> + Send + '_>> {
        let next = self
            .0
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected network call");
        Box::pin(async { next })
    }
}
fn fixture(replies: Vec<Reply>) -> Fixture {
    Fixture(std::sync::Mutex::new(replies.into()))
}
fn page(start: u64, total: u64, id: &str) -> Reply {
    Ok(StatusResponse { status:200, retry_after:None,location:None,
        bytes:format!("<feed><totalResults>{total}</totalResults><startIndex>{start}</startIndex><itemsPerPage>1</itemsPerPage><entry><id>http://arxiv.org/abs/{id}</id><title>Fixture</title><summary>Abstract</summary><published>2024-01-01T00:00:00Z</published></entry></feed>").into_bytes() })
}
fn observe(case: &str, actual: Value) {
    println!("STEP5_JSON {}", json!({"case":case,"actual":actual}));
}

#[test]
fn registered_schema_and_native_opt_out() {
    let mut settings = neuink_config::ResearchSettings::default();
    let descriptors = enabled_descriptors(&settings);
    let descriptor = descriptors
        .iter()
        .find(|tool| tool.name == "arxiv_search")
        .unwrap();
    assert_eq!(
        descriptor.parameters_schema,
        arxiv_query::schema::input_schema()
    );
    settings.papers_enabled = false;
    assert!(!enabled_descriptors(&settings)
        .iter()
        .any(|tool| tool.name == "arxiv_search"));
    observe(
        "registration",
        json!({"enabled":true,"schema_equal":true,"disabled_absent":true,"default_descriptors":descriptors.len()}),
    );
}

#[tokio::test]
async fn service_freezes_continuation_and_keeps_preview_identity() {
    let temp = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(temp.path()).unwrap();
    let args = json!({"mode":"structured","query":"attention","days_back":7,"page_size":1,"max_results":1});
    let first = arxiv_service::run(
        temp.path(),
        &args,
        true,
        &fixture(vec![page(0, 3, "2401.00001v2")]),
        &Cancellation::default(),
    )
    .await
    .unwrap();
    assert_eq!(first["next_query"]["raw_query"], first["effective_query"]);
    assert_eq!(first["next_query"]["start"], 1);
    assert!(first.get("error").is_none());
    let second = arxiv_service::run(
        temp.path(),
        &first["next_query"],
        true,
        &fixture(vec![page(1, 3, "2401.00002v3")]),
        &Cancellation::default(),
    )
    .await
    .unwrap();
    assert_eq!(first["search_key"], second["search_key"]);
    assert_eq!(first["effective_query"], second["effective_query"]);
    let ids = vec![
        first["papers"][0]["id"].as_str().unwrap().to_string(),
        second["papers"][0]["id"].as_str().unwrap().to_string(),
    ];
    let chosen = selected(&Selection {
        root: temp.path().to_path_buf(),
        paper_ids: ids.clone(),
    })
    .unwrap();
    assert_eq!(chosen.iter().map(|p| p.id.clone()).collect::<Vec<_>>(), ids);
    observe(
        "continuation",
        json!({"first":first,"second":second,"preview_ids":ids,"real_network":false}),
    );
}

#[tokio::test]
async fn service_partial_disables_guessing_but_preserves_last_known_cursor() {
    let temp = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(temp.path()).unwrap();
    let error = Ok(StatusResponse {
        status: 404,
        location: None,
        retry_after: None,
        bytes: vec![],
    });
    let result = arxiv_service::run(
        temp.path(),
        &json!({"mode":"raw","raw_query":"ti:test","page_size":1,"max_results":2}),
        true,
        &fixture(vec![page(0, 3, "2401.00001v1"), error]),
        &Cancellation::default(),
    )
    .await
    .unwrap();
    assert_eq!(result["status"], "partial");
    assert_eq!(result["returned_count"], 1);
    assert!(result["has_more"].is_null());
    assert_eq!(result["next_query"]["start"], 1);
    assert_eq!(result["errors"][0]["http_status"], 404);
    observe("partial", result);
}

#[tokio::test]
async fn service_refuses_disabled_invalid_empty_workspace_and_cancel_without_network() {
    let temp = tempfile::tempdir().unwrap();
    let args = json!({"mode":"ids","ids":["2401.00001v1"]});
    let none = fixture(vec![]);
    assert!(
        arxiv_service::run(temp.path(), &args, false, &none, &Cancellation::default())
            .await
            .unwrap_err()
            .contains("启用")
    );
    assert!(
        arxiv_service::run(temp.path(), &args, true, &none, &Cancellation::default())
            .await
            .unwrap_err()
            .contains("workspace_unavailable")
    );
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    neuink_workspace::Workspace::create(temp.path()).unwrap();
    assert!(arxiv_service::run(
        temp.path(),
        &json!({"mode":"ids","ids":["2401.00001v1"],"start":0}),
        true,
        &none,
        &Cancellation::default()
    )
    .await
    .is_err());
    let cancel = Cancellation::default();
    cancel.cancel();
    assert!(arxiv_service::run(temp.path(), &args, true, &none, &cancel)
        .await
        .unwrap_err()
        .contains("cancelled"));
    observe(
        "preflight",
        json!({"disabled_rejected":true,"missing_workspace_rejected":true,"invalid_fields_rejected":true,"cancelled":true,"network_calls":0}),
    );
}

#[tokio::test]
#[ignore = "explicit native service live probe; temporary workspace only, no downloads"]
async fn step5_live_service() {
    let temp = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(temp.path()).unwrap();
    let result = arxiv_service::run(
        temp.path(),
        &json!({"mode":"ids","ids":["1706.03762v1"]}),
        true,
        &arxiv_http::Native,
        &Cancellation::default(),
    )
    .await
    .unwrap();
    assert_eq!(result["papers"][0]["id"], "arxiv:1706.03762v1");
    assert_eq!(
        selected(&Selection {
            root: temp.path().to_path_buf(),
            paper_ids: vec!["arxiv:1706.03762v1".into()]
        })
        .unwrap()
        .len(),
        1
    );
    observe(
        "live_service",
        json!({"result":result,"preview_count":1,"downloaded":false}),
    );
}

#[tokio::test]
async fn cached_preview_isolates_workspaces_and_expiry_and_latest_metadata() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(a.path()).unwrap();
    neuink_workspace::Workspace::create(b.path()).unwrap();
    let args = json!({"mode":"raw","raw_query":"ti:test","page_size":1,"max_results":1});
    let result = arxiv_service::run(
        a.path(),
        &args,
        true,
        &fixture(vec![page(0, 1, "2401.00001v1")]),
        &Cancellation::default(),
    )
    .await
    .unwrap();
    let id = result["papers"][0]["id"].as_str().unwrap().to_string();
    assert!(selected(&Selection {
        root: b.path().to_path_buf(),
        paper_ids: vec![id.clone()]
    })
    .is_err());
    let canonical = a.path().canonicalize().unwrap();
    let mut replacement = selected(&Selection {
        root: a.path().to_path_buf(),
        paper_ids: vec![id.clone()],
    })
    .unwrap()
    .remove(0);
    replacement.title = "Updated metadata".into();
    remember(&canonical, &[replacement]).unwrap();
    assert_eq!(
        selected(&Selection {
            root: a.path().to_path_buf(),
            paper_ids: vec![id.clone()]
        })
        .unwrap()[0]
            .title,
        "Updated metadata"
    );
    {
        let mut rows = cache().lock().unwrap();
        let row = rows
            .iter_mut()
            .find(|r| r.root == canonical && r.paper.id == id)
            .unwrap();
        row.at = Instant::now() - Duration::from_secs(3601);
    }
    assert!(selected(&Selection {
        root: a.path().to_path_buf(),
        paper_ids: vec![id]
    })
    .unwrap_err()
    .contains("过期"));
    observe(
        "cache_isolation",
        json!({"cross_workspace_rejected":true,"metadata_replaced":true,"expired_requires_search":true,"downloaded":false}),
    );
}
