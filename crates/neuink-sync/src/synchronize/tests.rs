use super::*;
use std::io::{Read, Write};

#[tokio::test]
async fn quota_failure_preserves_queue_and_still_receives_remote_changes() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let server_id = "1".repeat(64);
    let epoch = "2".repeat(64);
    let discovery = json!({"protocol_version":1,"server_id":server_id,"epoch":epoch});
    let server = std::thread::spawn(move || {
        for (path, status, body) in [
            ("/.well-known/neuink-sync", 200, discovery),
            ("/v1/me", 200, json!({"account_id":"account"})),
            (
                "/changes?",
                200,
                json!({"changes":[],"revision":0,"epoch":epoch,"has_more":false}),
            ),
            ("/operations", 507, json!({"error":"quota_exceeded"})),
            (
                "/changes?",
                200,
                json!({"changes":[{"object_id":"note:remote","kind":"note","content":{"text":"remote"},"deleted":false,"revision":1}],"revision":1,"epoch":epoch,"has_more":false}),
            ),
        ] {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            let headers = String::from_utf8(request).unwrap();
            assert!(headers.lines().next().unwrap().contains(path));
            let length = headers
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length: ")
                        .and_then(|v| v.parse::<usize>().ok())
                })
                .unwrap_or(0);
            let mut payload = vec![0; length];
            stream.read_exact(&mut payload).unwrap();
            let body = body.to_string();
            write!(stream, "HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        }
    });
    let dir = tempfile::tempdir().unwrap();
    let binding = Binding {
        server_id,
        account_id: "account".into(),
        library_id: "3".repeat(64),
    };
    let mut replica =
        Replica::open(&dir.path().join("state.sqlite"), &binding, &"2".repeat(64)).unwrap();
    replica
        .edit(
            "note:a",
            neuink_sync_protocol::ObjectKind::Note,
            Some(&json!({"text":"local"})),
        )
        .unwrap();
    let client = SyncClient::new(&endpoint).unwrap();
    let result = synchronize(
        &mut replica,
        &client,
        &binding,
        &"2".repeat(64),
        "test-token",
    )
    .await
    .unwrap();
    server.join().unwrap();
    assert_eq!(result.failures.len(), 1);
    assert_eq!(result.uploaded, 0);
    assert_eq!(result.downloaded, 1);
    assert_eq!(
        replica.content("note:remote").unwrap(),
        Some(json!({"text":"remote"}))
    );
    assert_eq!(replica.pending().unwrap().len(), 1);
    assert!(replica.has_upload_gate().unwrap());
    assert!(client.quota_exceeded());
}

#[tokio::test]
async fn expired_cursor_stops_before_publishing_pending_edits() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let epoch = "2".repeat(64);
    let server_id = "1".repeat(64);
    let discovery = json!({"protocol_version":1,"server_id":server_id,"epoch":epoch});
    let server = std::thread::spawn(move || {
        for (path, status, body) in [
            ("/.well-known/neuink-sync", 200, discovery),
            ("/v1/me", 200, json!({"account_id":"account"})),
            ("/changes?", 409, json!({"error":"cursor_expired"})),
        ] {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            assert!(String::from_utf8(request)
                .unwrap()
                .lines()
                .next()
                .unwrap()
                .contains(path));
            let body = body.to_string();
            write!(stream,"HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        }
    });
    let dir = tempfile::tempdir().unwrap();
    let binding = Binding {
        server_id,
        account_id: "account".into(),
        library_id: "3".repeat(64),
    };
    let mut replica = Replica::open(&dir.path().join("state.sqlite"), &binding, &epoch).unwrap();
    replica
        .edit(
            "note:a",
            neuink_sync_protocol::ObjectKind::Note,
            Some(&json!({"text":"unsent local edit"})),
        )
        .unwrap();
    let pending = replica.pending().unwrap();
    let client = SyncClient::new(&endpoint).unwrap();
    assert!(synchronize(&mut replica, &client, &binding, &epoch, "test")
        .await
        .is_err());
    server.join().unwrap();
    assert_eq!(
        replica.pending().unwrap()[0].operation_id,
        pending[0].operation_id
    );
    assert_eq!(replica.cursor().unwrap(), 0);
}
