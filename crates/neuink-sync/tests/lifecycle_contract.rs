//! Live HTTPS check uses a fresh cloud library and disposable A/B workspaces.
use futures_util::FutureExt;
use neuink_sync::{workspace_sync::synchronize_workspace, SyncClient};
use neuink_workspace::{sync_journal::WorkspaceSyncBinding, Workspace};
use reqwest::Method;
use serde_json::json;
#[path = "support/fixture.rs"]
mod fixture;

#[tokio::test]
#[ignore = "requires explicit NEUINK_CONTRACT_* isolated account configuration"]
async fn https_entry_delete_restore_keeps_saved_content_and_conflicts() {
    let endpoint = std::env::var("NEUINK_CONTRACT_URL").unwrap();
    let client = match std::env::var("NEUINK_CONTRACT_CA") {
        Ok(path) => {
            SyncClient::with_trusted_certificate(&endpoint, &std::fs::read(path).unwrap()).unwrap()
        }
        Err(_) => SyncClient::new(&endpoint).unwrap(),
    };
    let session=client.request(Method::POST,"/v1/auth/login",None,Some(&json!({
        "username":std::env::var("NEUINK_ADMIN_USERNAME").unwrap(),"password":std::env::var("NEUINK_ADMIN_PASSWORD").unwrap(),"device_name":"isolated-lifecycle-contract"
    }))).await.unwrap();
    let access = session["access_token"].as_str().unwrap();
    let outcome=std::panic::AssertUnwindSafe(async {
        let info=client.discovery().await?;
        let library=client.request(Method::POST,"/v1/libraries",Some(access),Some(&json!({"name":"Isolated deletion/restoration contract"}))).await?;
        let binding=WorkspaceSyncBinding{server_id:info["server_id"].as_str().unwrap().into(),account_id:session["account_id"].as_str().unwrap().into(),library_id:library["id"].as_str().unwrap().into(),epoch:info["epoch"].as_str().unwrap().into()};
        let da=tempfile::tempdir().unwrap();let db=tempfile::tempdir().unwrap();
        let a=Workspace::create(da.path()).unwrap();let b=Workspace::create(db.path()).unwrap();
        a.bind_sync(&binding).unwrap();b.bind_sync(&binding).unwrap();
        let entry=a.create_entry("Lifecycle proof").unwrap(); let entry=a.create_note(&entry.id,"Evidence").unwrap();
        let neuink_domain::ContentItem::Note{note_id,..}=&entry.contents[0];
        a.update_note(&entry.id,note_id,"Evidence","Base text").unwrap();
        for w in [&a,&b] { let result=synchronize_workspace(w,&client,&binding,access).await?;assert!(result.failures.is_empty(),"{:?}",result.failures); }
        // Save offline, then delete before the next network exchange.
        a.update_note(&entry.id,note_id,"Evidence","Latest offline text before deletion").unwrap();
        a.delete_entry(&entry.id).unwrap();
        for _ in 0..3 { let result=synchronize_workspace(&a,&client,&binding,access).await?;assert!(result.failures.is_empty(),"{:?}",result.failures); }
        let result=synchronize_workspace(&b,&client,&binding,access).await?;assert!(result.failures.is_empty(),"{:?}",result.failures);
        assert!(b.list_entries().unwrap().is_empty());assert_eq!(b.list_trashed_entries().unwrap().len(),1);
        a.restore_entry(&entry.id).unwrap();
        for w in [&a,&b] { let result=synchronize_workspace(w,&client,&binding,access).await?;assert!(result.failures.is_empty(),"{:?}",result.failures); }
        assert_eq!(b.read_note(&entry.id,note_id).unwrap().markdown,"Latest offline text before deletion");
        child_roundtrip(&a, &b, &client, &binding, access).await?;
        b.update_note(&entry.id,note_id,"Evidence","B concurrent saved edit").unwrap();
        a.delete_entry(&entry.id).unwrap();
        for _ in 0..2 { synchronize_workspace(&a,&client,&binding,access).await?; }
        let result=synchronize_workspace(&b,&client,&binding,access).await?;
        assert!(result.conflicts>0);
        assert_eq!(b.read_note(&entry.id,note_id).unwrap().markdown,"B concurrent saved edit");
        println!("HTTPS lifecycle: offline edit retained; delete/restore roundtrip; concurrent edit preserved; disposable workspaces only");
        Ok::<(),String>(())
    }).catch_unwind().await;
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

async fn child_roundtrip(
    a: &Workspace,
    b: &Workspace,
    client: &SyncClient,
    binding: &WorkspaceSyncBinding,
    access: &str,
) -> Result<(), String> {
    let paper = fixture::paper(a);
    let id = &paper.entry_id;
    let note = &paper.notes[0];
    let uid = &paper.segment.uid;
    let (image_ref, _) = a.write_note_image(id, note, &paper.png).unwrap();
    let body = a.read_note(id, note).unwrap();
    a.update_note(
        id,
        note,
        "Note 0",
        format!("{}\n![image]({image_ref})", body.markdown),
    )
    .unwrap();
    a.upsert_segment_note(id, uid.clone(), "Saved segment thought".into())
        .unwrap();
    let annotation = a.read_annotations(id).unwrap()[0].annotation_id.clone();
    for w in [a, b] {
        let result = synchronize_workspace(w, client, binding, access).await?;
        assert!(result.failures.is_empty(), "{:?}", result.failures);
    }
    // A local save on the receiver creates its asset housekeeping manifest.
    let body = b.read_note(id, note).unwrap();
    b.update_note(id, note, "Note 0", body.markdown).unwrap();
    for w in [b, a] {
        let result = synchronize_workspace(w, client, binding, access).await?;
        assert!(result.failures.is_empty(), "{:?}", result.failures);
    }
    a.delete_note(id, note).unwrap();
    a.delete_annotation(id, &annotation).unwrap();
    a.delete_segment_note(id, uid.clone()).unwrap();
    for _ in 0..3 {
        let result = synchronize_workspace(a, client, binding, access).await?;
        assert!(result.failures.is_empty(), "{:?}", result.failures);
    }
    let result = synchronize_workspace(b, client, binding, access).await?;
    assert!(result.failures.is_empty(), "{:?}", result.failures);
    assert_eq!(b.list_entry_trash_items(id).unwrap().len(), 3);
    assert!(b.read_annotations(id).unwrap().is_empty());
    assert!(b.read_segment_notes(id).unwrap().is_empty());
    assert_eq!(b.read_entry(id).unwrap().contents.len(), 4);
    for trash in [
        format!("markdown_note:{note}"),
        format!("annotation:{annotation}"),
        format!("segment_note:{uid}"),
    ] {
        a.restore_trash_item(id, &trash).unwrap();
    }
    for w in [a, b] {
        let result = synchronize_workspace(w, client, binding, access).await?;
        assert!(result.failures.is_empty(), "{:?}", result.failures);
    }
    assert!(b.list_entry_trash_items(id).unwrap().is_empty());
    assert_eq!(b.read_annotations(id).unwrap()[0].annotation_id, annotation);
    assert_eq!(
        b.read_segment_notes(id).unwrap()[0].text,
        "Saved segment thought"
    );
    assert_eq!(
        b.read_note(id, note).unwrap().markdown,
        a.read_note(id, note).unwrap().markdown
    );
    assert_eq!(
        b.read_note_source_links(id, note).unwrap(),
        a.read_note_source_links(id, note).unwrap()
    );
    assert_eq!(
        std::fs::read(
            b.layout()
                .entry_note_assets_dir(id, note)
                .join(image_ref.rsplit('/').next().unwrap())
        )
        .unwrap(),
        paper.png
    );
    assert_eq!(
        std::fs::read(b.layout().entry_pdf_file(id)).unwrap(),
        paper.pdf
    );
    println!("HTTPS child lifecycle: note/source links, annotation, segment note delete/restore verified");
    Ok(())
}
