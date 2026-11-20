use super::*;
use serde_json::{json, Value};
use std::io::{Read, Write};

fn binding() -> Binding {
    Binding { server_id: "1".repeat(64), account_id: "2".repeat(64), library_id: "3".repeat(64) }
}
fn serve(responses: Vec<(&'static str, u16, Value)>) -> (String, std::thread::JoinHandle<()>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let thread = std::thread::spawn(move || {
        for (path, status, body) in responses {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(std::time::Instant::now() < deadline, "missing request");
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Err(e) => panic!("{e}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream.set_read_timeout(Some(std::time::Duration::from_secs(30))).unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") { stream.read_exact(&mut byte).unwrap(); request.push(byte[0]); }
            let request = String::from_utf8(request).unwrap();
            assert!(request.lines().next().unwrap().contains(path));
            if path != "/.well-known/neuink-sync" { assert!(request.to_ascii_lowercase().contains("authorization: bearer test-token")); }
            assert!(!request.lines().next().unwrap().contains("test-token"));
            let body = body.to_string();
            write!(stream, "HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        }
    });
    (endpoint, thread)
}

#[tokio::test]
async fn remote_hint_never_acknowledges_objects_or_advances_cursor() {
    let binding = binding(); let epoch = "4".repeat(64);
    let dir = tempfile::tempdir().unwrap();
    let mut replica = crate::replica::Replica::open(&dir.path().join("sync.sqlite"), &binding, &epoch).unwrap();
    let (endpoint, server) = serve(vec![("/revision?", 200, json!({"server_id":binding.server_id,"epoch":epoch,"revision":9,"changed":true}))]);
    let hint = SyncClient::new(&endpoint).unwrap().wait_for_revision(&binding, &epoch, replica.cursor().unwrap(), "test-token").await.unwrap();
    server.join().unwrap();
    assert!(hint.changed && hint.long_poll);
    assert_eq!(replica.cursor().unwrap(), 0);
    assert!(replica.pending().unwrap().is_empty());
}

#[tokio::test]
async fn same_revision_is_quiet_and_wrong_identity_is_rejected() {
    let binding = binding(); let epoch = "4".repeat(64);
    let (endpoint, server) = serve(vec![
        ("/revision?", 200, json!({"server_id":binding.server_id,"epoch":epoch,"revision":9})),
        ("/revision?", 200, json!({"server_id":"5".repeat(64),"epoch":epoch,"revision":10})),
        ("/revision?", 409, json!({"error":"cursor_expired"})),
    ]);
    let client = SyncClient::new(&endpoint).unwrap();
    assert!(!client.wait_for_revision(&binding, &epoch, 9, "test-token").await.unwrap().changed);
    assert!(client.wait_for_revision(&binding, &epoch, 9, "test-token").await.is_err());
    assert!(client.wait_for_revision(&binding, &epoch, 9, "test-token").await.unwrap_err().contains("过期"));
    server.join().unwrap();
}

#[tokio::test]
async fn older_server_falls_back_to_read_only_delta_probe() {
    let binding = binding(); let epoch = "4".repeat(64);
    let (endpoint, server) = serve(vec![
        ("/revision?", 404, json!({"error":"not_found"})),
        ("/.well-known/neuink-sync", 200, json!({"protocol_version":1,"server_id":binding.server_id,"epoch":epoch})),
        ("/changes?", 200, json!({"epoch":epoch,"revision":9,"changes":[],"has_more":false})),
    ]);
    let hint = SyncClient::new(&endpoint).unwrap().wait_for_revision(&binding, &epoch, 9, "test-token").await.unwrap();
    assert!(!hint.changed && !hint.long_poll);
    server.join().unwrap();
}
