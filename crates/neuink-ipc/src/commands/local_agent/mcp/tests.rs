use super::*;

async fn fixture() -> (
    String,
    Bridge,
    mpsc::Receiver<Event>,
    watch::Sender<bool>,
    tokio::task::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/mcp", listener.local_addr().unwrap());
    let (events, rx) = mpsc::channel(32);
    let (cancel, signal) = watch::channel(false);
    let bridge = Bridge {
        connected: Arc::new(AtomicBool::new(false)),
        token: "test-secret".into(),
        tools: vec![Tool {
            name: "read_note".into(),
            description: "Read".into(),
            input_schema: json!({"type":"object"}),
        }],
        events,
        replies: Arc::new(Mutex::new(HashMap::new())),
        cancel: signal,
    };
    let server = tokio::spawn(serve(listener, bridge.clone()));
    (url, bridge, rx, cancel, server)
}
#[tokio::test]
async fn protocol_authentication_and_catalog_are_real_http() {
    let (url, _, _, cancel, server) = fixture().await;
    let client = reqwest::Client::new();
    assert_eq!(
        client
            .post(&url)
            .json(&json!({"id":1,"method":"tools/list"}))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .post(&url)
            .bearer_auth("test-secret")
            .header("Origin", "https://untrusted.example")
            .json(&json!({"id":1,"method":"tools/list"}))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let response: Value = client
        .post(&url)
        .bearer_auth("test-secret")
        .json(&json!({"id":1,"method":"initialize"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(response["result"]["protocolVersion"], "2025-03-26");
    let response: Value = client
        .post(&url)
        .bearer_auth("test-secret")
        .json(&json!({"id":2,"method":"tools/list"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        response["result"]["tools"][0]["inputSchema"]["type"],
        "object"
    );
    let response: Value = client
        .post(&url)
        .bearer_auth("test-secret")
        .json(&json!({"id":3,"method":"tools/call","params":{"name":"write_files"}}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(response.get("error").is_some());
    cancel.send(true).unwrap();
    server.await.unwrap();
}
#[tokio::test]
async fn tool_reply_is_single_use_and_cancellation_releases_pending_requests() {
    let (url, bridge, mut events, cancel, server) = fixture().await;
    let url2 = url.clone();
    let request = tokio::spawn(async move {
        reqwest::Client::new().post(url2).bearer_auth("test-secret").json(&json!({"id":1,"method":"tools/call","params":{"name":"read_note","arguments":{"note_id":"a"}}})).send().await.unwrap().json::<Value>().await.unwrap()
    });
    let Event::Tool { id, name, input } = events.recv().await.unwrap() else {
        panic!()
    };
    assert_eq!(name, "read_note");
    assert_eq!(input["note_id"], "a");
    let tx = bridge.replies.lock().unwrap().remove(&id).unwrap();
    tx.send(json!({"content":[{"type":"text","text":"read"}]}))
        .unwrap();
    assert!(bridge.replies.lock().unwrap().remove(&id).is_none());
    assert_eq!(
        request.await.unwrap()["result"]["content"][0]["text"],
        "read"
    );
    let waiting = tokio::spawn(async move {
        let _ = reqwest::Client::new()
            .post(url)
            .bearer_auth("test-secret")
            .json(
                &json!({"id":2,"method":"tools/call","params":{"name":"read_note","arguments":{}}}),
            )
            .send()
            .await;
    });
    let _ = events.recv().await.unwrap();
    assert_eq!(bridge.replies.lock().unwrap().len(), 1);
    cancel.send(true).unwrap();
    server.await.unwrap();
    waiting.await.unwrap();
    assert!(bridge.replies.lock().unwrap().is_empty());
}
#[tokio::test]
async fn rejects_oversized_bodies_before_allocating() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let sender = tokio::spawn(async move {
        let mut stream = TcpStream::connect(addr).await.unwrap();
        stream
            .write_all(
                format!(
                    "POST /mcp HTTP/1.1\r\nContent-Length: {}\r\n\r\n",
                    MAX_BODY + 1
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });
    let (mut socket, _) = listener.accept().await.unwrap();
    assert!(read_request(&mut socket).await.is_err());
    sender.await.unwrap();
}
