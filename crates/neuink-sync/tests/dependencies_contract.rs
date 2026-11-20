//! Real dependency-connected Workspace roundtrip; synthetic papers only.
#[path = "support/fixture.rs"]
mod fixture;
use futures_util::FutureExt;
use neuink_sync::{workspace_sync::synchronize_workspace, SyncClient};
use neuink_workspace::{sync_journal::WorkspaceSyncBinding, Workspace};
use reqwest::Method;
use serde_json::json;

#[tokio::test]
#[ignore = "requires HTTPS Java/PostgreSQL and NEUINK_CONTRACT_* test account"]
async fn source_papers_images_and_tag_hierarchy_roundtrip_through_https() {
    let endpoint = std::env::var("NEUINK_CONTRACT_URL").unwrap();
    let client = match std::env::var("NEUINK_CONTRACT_CA") {
        Ok(path) => {
            SyncClient::with_trusted_certificate(&endpoint, &std::fs::read(path).unwrap()).unwrap()
        }
        Err(_) => SyncClient::new(&endpoint).unwrap(),
    };
    let session = client.request(Method::POST,"/v1/auth/login",None,Some(&json!({
        "username": std::env::var("NEUINK_CONTRACT_USERNAME").or_else(|_|std::env::var("NEUINK_ADMIN_USERNAME")).unwrap(),
        "password": std::env::var("NEUINK_CONTRACT_PASSWORD").or_else(|_|std::env::var("NEUINK_ADMIN_PASSWORD")).unwrap(),
        "device_name":"dependency-contract"
    }))).await.unwrap();
    let access = session["access_token"].as_str().unwrap();
    let outcome = std::panic::AssertUnwindSafe(async {
        let info = client.discovery().await?;
        let library = client
            .request(
                Method::POST,
                "/v1/libraries",
                Some(access),
                Some(&json!({"name":"Isolated dependency roundtrip"})),
            )
            .await?;
        let binding = WorkspaceSyncBinding {
            server_id: info["server_id"].as_str().unwrap().into(),
            account_id: session["account_id"].as_str().unwrap().into(),
            library_id: library["id"].as_str().unwrap().into(),
            epoch: info["epoch"].as_str().unwrap().into(),
        };
        let left = tempfile::tempdir().unwrap();
        let right = tempfile::tempdir().unwrap();
        let a = Workspace::create(left.path()).unwrap();
        let b = Workspace::create(right.path()).unwrap();
        a.bind_sync(&binding).unwrap();
        b.bind_sync(&binding).unwrap();
        let first = fixture::paper(&a);
        let second = fixture::paper(&a);
        let parent = a.create_tag("Research", None).unwrap();
        let child = a.create_tag("Methods", Some(parent.id.clone())).unwrap();
        for (paper, other) in [(&first, &second), (&second, &first)] {
            let entry = a.read_entry(&paper.entry_id).unwrap();
            a.update_entry_meta(&entry.id, entry.title, entry.fields, vec![child.id.clone()])
                .unwrap();
            let link = a
                .create_note_source_link(
                    &entry.id,
                    &paper.notes[0],
                    &other.entry_id,
                    other.segment.uid.clone(),
                )
                .unwrap();
            let note = a.read_note(&entry.id, &paper.notes[0]).unwrap();
            a.update_note(
                &entry.id,
                &paper.notes[0],
                "Comparison",
                format!("{}\nRelated paper [^{}]", note.markdown, link.anchor_id),
            )
            .unwrap();
        }
        let upload = synchronize_workspace(&a, &client, &binding, access).await?;
        assert!(upload.failures.is_empty(), "{:?}", upload.failures);
        assert_eq!(upload.published, 18);
        assert!(a.pending_content_events().unwrap().is_empty());
        let download = synchronize_workspace(&b, &client, &binding, access).await?;
        assert!(download.failures.is_empty(), "{:?}", download.failures);
        assert_eq!(download.applied, 18);
        assert!(b.list_tags().unwrap().contains(&child));
        for (paper, other) in [(&first, &second), (&second, &first)] {
            assert_eq!(
                b.read_entry(&paper.entry_id).unwrap().tags,
                vec![child.id.clone()]
            );
            assert_eq!(
                b.read_note(&paper.entry_id, &paper.notes[0]).unwrap().links,
                a.read_note(&paper.entry_id, &paper.notes[0]).unwrap().links
            );
            assert!(b
                .read_note(&paper.entry_id, &paper.notes[0])
                .unwrap()
                .links
                .iter()
                .flat_map(|l| &l.sources)
                .any(|s| s.entry_id == other.entry_id && s.segment_uid == other.segment.uid));
            assert_eq!(
                std::fs::read(b.entry_pdf_path(&paper.entry_id).unwrap()).unwrap(),
                paper.pdf
            );
            assert_eq!(
                std::fs::read(
                    b.layout()
                        .entry_mineru_output_dir(&paper.entry_id)
                        .join("images/figure.png")
                )
                .unwrap(),
                paper.png
            );
        }
        b.rename_tag(&child.id, "Verified methods").unwrap();
        let previous = b.read_note(&first.entry_id, &first.notes[0]).unwrap();
        let edited = format!(
            "Edited with both source papers present\n{}",
            previous.markdown
        );
        b.update_note(&first.entry_id, &first.notes[0], "Comparison", &edited)
            .unwrap();
        let update = synchronize_workspace(&b, &client, &binding, access).await?;
        assert!(update.failures.is_empty(), "{:?}", update.failures);
        let received = synchronize_workspace(&a, &client, &binding, access).await?;
        assert!(received.failures.is_empty(), "{:?}", received.failures);
        assert_eq!(
            a.list_tags()
                .unwrap()
                .into_iter()
                .find(|t| t.id == child.id)
                .unwrap()
                .name,
            "Verified methods"
        );
        assert_eq!(
            a.read_note(&first.entry_id, &first.notes[0])
                .unwrap()
                .markdown,
            edited
        );
        assert_eq!(
            synchronize_workspace(&b, &client, &binding, access)
                .await?
                .published,
            0
        );
        Ok::<(), String>(())
    })
    .catch_unwind()
    .await;
    client
        .request(
            Method::POST,
            "/v1/auth/logout",
            Some(access),
            Some(&json!({})),
        )
        .await
        .unwrap();
    match outcome {
        Ok(result) => result.unwrap(),
        Err(panic) => std::panic::resume_unwind(panic),
    }
}
