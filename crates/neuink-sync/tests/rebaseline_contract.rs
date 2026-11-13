//! Run only against the disposable restored deployment: cleanup affects its test account history.
use neuink_domain::ContentItem;
use neuink_sync::{
    workspace_sync::{conflicts, rebaseline, synchronize_workspace},
    SyncClient,
};
use neuink_workspace::{sync_journal::WorkspaceSyncBinding, Workspace};
use reqwest::Method;
use serde_json::json;
#[tokio::test]
#[ignore = "requires explicit isolated NEUINK_RESTORE_URL, trusted CA and test credentials"]
async fn restored_epoch_and_expired_cursor_preserve_saved_local_edits() {
    let url = std::env::var("NEUINK_RESTORE_URL").unwrap();
    assert!(
        url.ends_with(":18794"),
        "Only the explicitly disposable restored service is permitted"
    );
    let client = SyncClient::with_trusted_certificate(
        &url,
        &std::fs::read(std::env::var("NEUINK_CONTRACT_CA").unwrap()).unwrap(),
    )
    .unwrap();
    let session=client.request(Method::POST,"/v1/auth/login",None,Some(&json!({"username":std::env::var("NEUINK_ADMIN_USERNAME").unwrap(),"password":std::env::var("NEUINK_ADMIN_PASSWORD").unwrap(),"device_name":"restoration-contract"}))).await.unwrap();
    let access = session["access_token"].as_str().unwrap();
    let info = client.discovery().await.unwrap();
    let library = client
        .request(
            Method::POST,
            "/v1/libraries",
            Some(access),
            Some(&json!({"name":"Disposable restored epoch acceptance"})),
        )
        .await
        .unwrap();
    let binding = WorkspaceSyncBinding {
        server_id: info["server_id"].as_str().unwrap().into(),
        account_id: session["account_id"].as_str().unwrap().into(),
        library_id: library["id"].as_str().unwrap().into(),
        epoch: info["epoch"].as_str().unwrap().into(),
    };
    let mut old = binding.clone();
    old.epoch = std::env::var("NEUINK_ORIGINAL_EPOCH").unwrap();
    assert_ne!(old.epoch, binding.epoch);
    let da = tempfile::tempdir().unwrap();
    let db = tempfile::tempdir().unwrap();
    let a = Workspace::create(da.path()).unwrap();
    let b = Workspace::create(db.path()).unwrap();
    a.bind_sync(&binding).unwrap();
    b.bind_sync(&old).unwrap();
    let entry = a.create_entry("Remote restored paper").unwrap();
    let entry = a.create_note(&entry.id, "Evidence").unwrap();
    let ContentItem::Note { note_id, .. } = &entry.contents[0];
    synchronize_workspace(&a, &client, &binding, access)
        .await
        .unwrap();
    let local = b.create_entry("Saved after backup").unwrap();
    assert!(synchronize_workspace(&b, &client, &old, access)
        .await
        .is_err());
    let preview = rebaseline::reconcile(&b, &client, &old, access, None)
        .await
        .unwrap();
    assert!(preview.epoch_changed);
    assert!(preview.local_retained >= 1);
    rebaseline::reconcile(&b, &client, &old, access, Some(&preview.token))
        .await
        .unwrap();
    let received = synchronize_workspace(&b, &client, &old, access)
        .await
        .unwrap();
    assert!(received.failures.is_empty(), "{:?}", received.failures);
    assert_eq!(b.read_entry(&local.id).unwrap().title, "Saved after backup");
    for text in ["First remote edit", "Second remote edit"] {
        a.update_note(&entry.id, note_id, "Evidence", text).unwrap();
        synchronize_workspace(&a, &client, &binding, access)
            .await
            .unwrap();
    }
    b.update_note(&entry.id, note_id, "Evidence", "Unsynced saved local edit")
        .unwrap();
    let cleanup = client
        .request(Method::GET, "/v1/storage/cleanup", Some(access), None)
        .await
        .unwrap();
    client
        .request(
            Method::POST,
            "/v1/storage/cleanup",
            Some(access),
            Some(&json!({"token":cleanup["token"]})),
        )
        .await
        .unwrap();
    assert!(synchronize_workspace(&b, &client, &old, access)
        .await
        .unwrap_err()
        .contains("过期"));
    let preview = rebaseline::reconcile(&b, &client, &old, access, None)
        .await
        .unwrap();
    assert!(preview.conflicts >= 1);
    rebaseline::reconcile(&b, &client, &old, access, Some(&preview.token))
        .await
        .unwrap();
    assert_eq!(
        b.read_note(&entry.id, note_id).unwrap().markdown,
        "Unsynced saved local edit"
    );
    let identity = neuink_sync_protocol::Binding {
        server_id: old.server_id.clone(),
        account_id: old.account_id.clone(),
        library_id: old.library_id.clone(),
    };
    let ids=conflicts::list(&b,&old).unwrap();
    assert!(ids.contains(&format!("note:{note_id}")));
    for id in ids {
        let replica=neuink_sync::replica::Replica::open(&b.sync_replica_path(&old).unwrap(),&identity,&old.epoch).unwrap();
        let detail=replica.conflict_detail(&id).unwrap();drop(replica);
        conflicts::resolve(&b,&old,&id,&detail.token,true).unwrap();
    }
    let result = synchronize_workspace(&b, &client, &old, access)
        .await
        .unwrap();
    assert!(result.failures.is_empty(), "{:?}", result.failures);
    synchronize_workspace(&a, &client, &binding, access)
        .await
        .unwrap();
    assert_eq!(
        a.read_note(&entry.id, note_id).unwrap().markdown,
        "Unsynced saved local edit"
    );
    client
        .request(
            Method::POST,
            "/v1/auth/logout",
            Some(access),
            Some(&json!({})),
        )
        .await
        .unwrap();
}
