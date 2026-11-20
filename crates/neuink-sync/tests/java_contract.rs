//! Explicitly run against an isolated Java deployment; never uses a real workspace.
use neuink_sync::{replica::Replica, synchronize::synchronize, SyncClient};
use neuink_sync_protocol::{Binding, ObjectKind};
use reqwest::Method;
use serde_json::json;

#[tokio::test]
#[ignore = "requires isolated Java service and NEUINK_CONTRACT_* credentials"]
async fn java_backend_supports_rust_replica_and_file_protocol() {
    let endpoint = std::env::var("NEUINK_CONTRACT_URL").unwrap();
    let username = std::env::var("NEUINK_CONTRACT_USERNAME")
        .or_else(|_| std::env::var("NEUINK_ADMIN_USERNAME"))
        .unwrap();
    let password = std::env::var("NEUINK_CONTRACT_PASSWORD")
        .or_else(|_| std::env::var("NEUINK_ADMIN_PASSWORD"))
        .unwrap();
    let client = match std::env::var("NEUINK_CONTRACT_CA") {
        Ok(path) => {
            SyncClient::with_trusted_certificate(&endpoint, &std::fs::read(path).unwrap()).unwrap()
        }
        Err(_) => SyncClient::new(&endpoint).unwrap(),
    };
    let session = client
        .request(
            Method::POST,
            "/v1/auth/login",
            None,
            Some(&json!({"username":username,"password":password,"device_name":"rust-contract"})),
        )
        .await
        .unwrap();
    let access = session["access_token"].as_str().unwrap();
    let info = client.discovery().await.unwrap();
    let library = client
        .request(
            Method::POST,
            "/v1/libraries",
            Some(access),
            Some(&json!({"name":"Rust contract isolated"})),
        )
        .await
        .unwrap();
    let binding = Binding {
        server_id: info["server_id"].as_str().unwrap().into(),
        account_id: session["account_id"].as_str().unwrap().into(),
        library_id: library["id"].as_str().unwrap().into(),
    };
    let epoch = info["epoch"].as_str().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let mut blocked =
        Replica::open(&dir.path().join("missing-file.sqlite"), &binding, epoch).unwrap();
    blocked
        .edit(
            "missing-file",
            ObjectKind::Note,
            Some(&json!({"text":"not ready", "_files":[{"hash":"0".repeat(64),"size":1}]})),
        )
        .unwrap();
    let failed = synchronize(&mut blocked, &client, &binding, epoch, access)
        .await
        .unwrap();
    assert_eq!(failed.uploaded,0);
    assert_eq!(failed.failures.len(),1);
    assert_eq!(failed.failures[0].0,"missing-file");
    assert!(failed.failures[0].1.contains("附件尚未上传完成"));
    assert_eq!(blocked.pending().unwrap().len(), 1);
    assert!(blocked.conflicts().unwrap().is_empty());
    let mut left = Replica::open(&dir.path().join("left.sqlite"), &binding, epoch).unwrap();
    let mut right = Replica::open(&dir.path().join("right.sqlite"), &binding, epoch).unwrap();
    left.edit("note", ObjectKind::Note, Some(&json!({"text":"base"})))
        .unwrap();
    synchronize(&mut left, &client, &binding, epoch, access)
        .await
        .unwrap();
    synchronize(&mut right, &client, &binding, epoch, access)
        .await
        .unwrap();
    assert_eq!(right.content("note").unwrap(), Some(json!({"text":"base"})));
    left.edit("note", ObjectKind::Note, Some(&json!({"text":"left"})))
        .unwrap();
    right
        .edit("note", ObjectKind::Note, Some(&json!({"text":"right"})))
        .unwrap();
    synchronize(&mut left, &client, &binding, epoch, access)
        .await
        .unwrap();
    assert_eq!(
        synchronize(&mut right, &client, &binding, epoch, access)
            .await
            .unwrap()
            .conflicts,
        1
    );
    let shown = right.conflict_detail("note").unwrap();
    right
        .resolve_if_current("note", true, &shown.token)
        .unwrap();
    synchronize(&mut right, &client, &binding, epoch, access)
        .await
        .unwrap();
    synchronize(&mut left, &client, &binding, epoch, access)
        .await
        .unwrap();
    assert_eq!(left.content("note").unwrap(), Some(json!({"text":"right"})));
    let source = dir.path().join("source.bin");
    let bytes = vec![31u8; 4 * 1024 * 1024 + 37];
    std::fs::write(&source, &bytes).unwrap();
    let ticket = client.begin_upload(access, &source).await.unwrap();
    client
        .resume_upload(access, &source, &ticket)
        .await
        .unwrap();
    let downloaded = dir.path().join("download.bin");
    client
        .download_attachment(access, &ticket.hash, ticket.size, &downloaded)
        .await
        .unwrap();
    assert_eq!(std::fs::read(downloaded).unwrap(), bytes);
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
