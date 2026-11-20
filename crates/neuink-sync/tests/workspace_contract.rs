//! Explicit isolated A/B workspaces and a fresh cloud library; never daily data.
#[path = "support/fixture.rs"]
mod fixture;
#[path = "support/reading.rs"]
mod reading;
use futures_util::FutureExt;
use neuink_domain::AnnotationImportance;
use neuink_sync::{workspace_sync::synchronize_workspace, SyncClient};
use neuink_workspace::{sync_journal::WorkspaceSyncBinding, Workspace};
use reqwest::Method;
use serde_json::json;

#[tokio::test]
#[ignore = "requires HTTPS Java/PostgreSQL and NEUINK_CONTRACT_* test account"]
async fn two_workspaces_roundtrip_papers_resume_transfers_and_preserve_conflicts() {
    let endpoint = std::env::var("NEUINK_CONTRACT_URL").unwrap();
    let client = match std::env::var("NEUINK_CONTRACT_CA") {
        Ok(path) => {
            SyncClient::with_trusted_certificate(&endpoint, &std::fs::read(path).unwrap()).unwrap()
        }
        Err(_) => SyncClient::new(&endpoint).unwrap(),
    };
    let session = client.request(Method::POST, "/v1/auth/login", None, Some(&json!({
        "username":std::env::var("NEUINK_CONTRACT_USERNAME").or_else(|_| std::env::var("NEUINK_ADMIN_USERNAME")).unwrap(),
        "password":std::env::var("NEUINK_CONTRACT_PASSWORD").or_else(|_| std::env::var("NEUINK_ADMIN_PASSWORD")).unwrap(),
        "device_name":"workspace-contract"
    }))).await.unwrap();
    let access = session["access_token"].as_str().unwrap();
    let outcome = std::panic::AssertUnwindSafe(async {
        let info = client.discovery().await.unwrap();
        let library = client
            .request(
                Method::POST,
                "/v1/libraries",
                Some(access),
                Some(&json!({"name":"Isolated Workspace roundtrip"})),
            )
            .await
            .unwrap();
        let binding = WorkspaceSyncBinding {
            server_id: info["server_id"].as_str().unwrap().into(),
            account_id: session["account_id"].as_str().unwrap().into(),
            library_id: library["id"].as_str().unwrap().into(),
            epoch: info["epoch"].as_str().unwrap().into(),
        };
        let a_dir = tempfile::tempdir().unwrap();
        let b_dir = tempfile::tempdir().unwrap();
        let a = Workspace::create(a_dir.path()).unwrap();
        let b = Workspace::create(b_dir.path()).unwrap();
        a.bind_sync(&binding).unwrap();
        b.bind_sync(&binding).unwrap();
        let paper = fixture::paper(&a);
        let entry_id = &paper.entry_id;
        let notes = &paper.notes;
        let ticket = client
            .begin_upload(access, &a.entry_pdf_path(entry_id).unwrap())
            .await?;
        assert!(ticket.id.is_some());
        client
            .upload_chunk(access, &ticket, 0, paper.pdf[..4 * 1024 * 1024].to_vec())
            .await?;
        // Simulate both clients exiting with a valid partial transfer, then retry.
        let pdf_resource = neuink_sync_protocol::document::Resource {
            name: "paper.pdf".into(),
            hash: ticket.hash.clone(),
            size: ticket.size,
        };
        std::fs::write(
            b.prepare_sync_download(&binding, &pdf_resource).unwrap(),
            &paper.pdf[..4 * 1024 * 1024],
        )
        .unwrap();
        let first = synchronize_workspace(&a, &client, &binding, access).await?;
        assert!(first.failures.is_empty(), "{:?}", first.failures);
        assert_eq!(first.published, 8);
        let received = synchronize_workspace(&b, &client, &binding, access).await?;
        assert!(received.failures.is_empty(), "{:?}", received.failures);
        assert_eq!(received.applied, 8);
        for note_id in notes {
            assert_eq!(
                b.read_note(entry_id, note_id).unwrap().markdown,
                a.read_note(entry_id, note_id).unwrap().markdown
            );
            assert_eq!(
                b.read_note(entry_id, note_id).unwrap().links,
                a.read_note(entry_id, note_id).unwrap().links
            );
        }
        assert_eq!(
            std::fs::read(b.entry_pdf_path(entry_id).unwrap()).unwrap(),
            paper.pdf
        );
        assert_eq!(
            b.read_segments(entry_id).unwrap(),
            vec![paper.segment.clone()]
        );
        assert_eq!(
            b.read_annotations(entry_id).unwrap(),
            a.read_annotations(entry_id).unwrap()
        );
        assert_eq!(
            std::fs::read(
                b.layout()
                    .entry_mineru_output_dir(entry_id)
                    .join("images/figure.png")
            )
            .unwrap(),
            paper.png
        );
        reading::populate(&a, entry_id, &paper.segment);
        for _ in 0..3 {
            let sent = synchronize_workspace(&a, &client, &binding, access).await?;
            assert!(sent.failures.is_empty(), "{:?}", sent.failures);
            let got = synchronize_workspace(&b, &client, &binding, access).await?;
            assert!(got.failures.is_empty(), "{:?}", got.failures);
        }
        reading::assert_received(&a, &b, entry_id);
        let preview =
            neuink_sync::workspace_sync::preview::inspect(&a, &client, &binding.library_id, access)
                .await?;
        assert_eq!(preview.new_attachment_bytes, 0);
        assert!(preview.existing_attachment_bytes > 4 * 1024 * 1024);
        assert!(preview.issues.is_empty());
        let baseline =
            neuink_sync::workspace_sync::rebaseline::reconcile(&b, &client, &binding, access, None)
                .await?;
        assert_eq!(baseline.conflicts, 0);
        assert!(!baseline.epoch_changed);
        neuink_sync::workspace_sync::rebaseline::reconcile(
            &b,
            &client,
            &binding,
            access,
            Some(&baseline.token),
        )
        .await?;
        let before = client
            .request(Method::GET, "/v1/storage", Some(access), None)
            .await
            .unwrap();
        assert_eq!(
            synchronize_workspace(&a, &client, &binding, access)
                .await?
                .published,
            0
        );
        assert_eq!(
            synchronize_workspace(&b, &client, &binding, access)
                .await?
                .published,
            0
        );
        let after = client
            .request(Method::GET, "/v1/storage", Some(access), None)
            .await
            .unwrap();
        assert_eq!(before, after);
        b.update_note(entry_id, &notes[0], "Note 0", "Edited on B")
            .unwrap();
        synchronize_workspace(&b, &client, &binding, access).await?;
        let updated = synchronize_workspace(&a, &client, &binding, access).await?;
        assert!(updated.failures.is_empty(), "{:?}", updated.failures);
        assert_eq!(
            a.read_note(entry_id, &notes[0]).unwrap().markdown,
            "Edited on B"
        );
        a.update_note(entry_id, &notes[0], "Note 0", "Offline A")
            .unwrap();
        b.update_note(entry_id, &notes[0], "Note 0", "Offline B")
            .unwrap();
        a.create_annotation(
            entry_id,
            paper.segment.uid.clone(),
            "comment".into(),
            "Independent annotation".into(),
            AnnotationImportance::Normal,
        )
        .unwrap();
        synchronize_workspace(&a, &client, &binding, access).await?;
        let conflict = synchronize_workspace(&b, &client, &binding, access).await?;
        assert!(conflict.conflicts >= 1);
        assert_eq!(
            b.read_note(entry_id, &notes[0]).unwrap().markdown,
            "Offline B"
        );
        assert_eq!(b.read_annotations(entry_id).unwrap().len(), 2);
        let identity = neuink_sync_protocol::Binding {
            server_id: binding.server_id.clone(),
            account_id: binding.account_id.clone(),
            library_id: binding.library_id.clone(),
        };
        let mut replica = neuink_sync::replica::Replica::open(
            &b.sync_replica_path(&binding).unwrap(),
            &identity,
            &binding.epoch,
        )
        .unwrap();
        for remote in replica.conflicts().unwrap() {
            let shown = replica.conflict_detail(&remote.object_id).unwrap();
            replica
                .resolve_if_current(&remote.object_id, true, &shown.token)
                .unwrap();
        }
        drop(replica);
        let resolved = synchronize_workspace(&b, &client, &binding, access).await?;
        assert_eq!(resolved.conflicts, 0);
        let restored = Workspace::open_existing(a_dir.path()).unwrap();
        synchronize_workspace(&restored, &client, &binding, access).await?;
        assert_eq!(
            restored.read_note(entry_id, &notes[0]).unwrap().markdown,
            "Offline B"
        );
        restored.delete_entry(entry_id).unwrap();
        let independent = restored
            .create_entry("Unaffected by another entry's deletion")
            .unwrap();
        b.update_note(
            entry_id,
            &notes[0],
            "Note 0",
            "Remote edit after local deletion",
        )
        .unwrap();
        synchronize_workspace(&b, &client, &binding, access).await?;
        let blocked = synchronize_workspace(&restored, &client, &binding, access).await?;
        assert!(!blocked.failures.is_empty());
        assert_eq!(blocked.published, 1);
        assert_eq!(restored.list_entries().unwrap().len(), 1);
        assert!(restored.layout().trashed_entry_dir(entry_id).exists());
        synchronize_workspace(&b, &client, &binding, access).await?;
        assert_eq!(
            b.read_entry(&independent.id).unwrap().title,
            independent.title
        );
        assert_eq!(b.read_note(entry_id,&notes[0]).unwrap().markdown,"Remote edit after local deletion");
        let conflict_id=format!("note:{}",notes[0]);
        let group=neuink_sync::workspace_sync::conflicts::group::inspect(&restored,&binding,&conflict_id)?;
        assert!(group.local_deleted);assert!(!group.remote_deleted);
        neuink_sync::workspace_sync::conflicts::group::resolve(&restored,&binding,&conflict_id,&group.token,false)?;
        let accepted=synchronize_workspace(&restored,&client,&binding,access).await?;
        assert!(accepted.failures.is_empty(),"{:?}",accepted.failures);
        assert_eq!(restored.read_note(entry_id,&notes[0]).unwrap().markdown,"Remote edit after local deletion");
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
