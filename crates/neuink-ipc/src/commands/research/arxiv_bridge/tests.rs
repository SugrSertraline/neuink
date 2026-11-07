use super::*;
#[tokio::test]
async fn rejects_unauthorized_and_non_api_requests_without_network() {
    let gate = Arc::new(ArxivGate::new(None));
    let bridge = Bridge::start_with(gate, Context::new("test", 120))
        .await
        .unwrap();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let response = client
        .post(&bridge.endpoint)
        .json(&serde_json::json!({"url":"https://export.arxiv.org/api/query","method":"GET"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 403);
    let response = client
        .post(&bridge.endpoint)
        .header("X-Proxy-Token", &bridge.token)
        .json(&serde_json::json!({"url":"https://arxiv.org/pdf/a","method":"GET"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
    let endpoint = bridge.endpoint.clone();
    drop(bridge);
    tokio::task::yield_now().await;
    assert!(client.post(endpoint).send().await.is_err());
}

struct Fixture(u16, std::sync::atomic::AtomicUsize);
impl arxiv_gate::Sender for Fixture {
    fn send(
        &self,
        _: reqwest::Url,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<Output = Result<arxiv_gate::GateResponse, GateError>>
                + Send
                + '_,
        >,
    > {
        self.1.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Box::pin(async move {
            Ok(super::super::network::StatusResponse{status:self.0,retry_after:Some("120".into()),location:None,
            bytes:br#"<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom"><opensearch:totalResults>1</opensearch:totalResults><entry><id>http://arxiv.org/abs/2610.12345v1</id><title>Fixture</title><published>2026-10-23T00:00:00Z</published><updated>2026-10-23T00:00:00Z</updated><summary>Abstract</summary><author><name>Example</name></author><category term="cs.LG"/><arxiv:primary_category term="cs.LG"/></entry></feed>"#.to_vec()})
        })
    }
}
#[tokio::test]
#[ignore = "Requires NEUINK_ARXIV_GATE_TEST_PYTHON with pinned recommendation dependencies; local only"]
async fn pinned_python_child_uses_rust_host_and_shared_gate_without_public_network() {
    let python = std::env::var_os("NEUINK_ARXIV_GATE_TEST_PYTHON")
        .map(std::path::PathBuf::from)
        .expect("Set the documented test interpreter");
    assert!(
        python.is_file(),
        "Run documented pinned test environment preparation first"
    );
    let script = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/desktop/resources/recommendations/arxiv_client.py");
    for status in [200, 429] {
        let gate = Arc::new(ArxivGate::new(None));
        let sender = Arc::new(Fixture(status, Default::default()));
        let bridge = Bridge::start_sender(
            gate.clone(),
            Context::new("python-test", 120),
            sender.clone(),
        )
        .await
        .unwrap();
        let mut command = tokio::process::Command::new(&python);
        command
            .args(["-I", "-B"])
            .arg(&script)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command.kill_on_drop(true).spawn().unwrap();
        let input=serde_json::json!({"query":"fixture","gate_url":bridge.endpoint,"gate_token":bridge.token}).to_string()+"\n";
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .await
            .unwrap();
        let output = tokio::time::timeout(Duration::from_secs(10), child.wait_with_output())
            .await
            .unwrap()
            .unwrap();
        assert!(output.status.success());
        let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        if status == 200 {
            assert_eq!(result["papers"][0]["id"], "arxiv:2610.12345v1");
        } else {
            assert_eq!(result["gate_error"]["code"], "rate_limited");
            assert_eq!(result["gate_error"]["retry_after_seconds"], 120);
            let error = gate
                .request_with(
                    reqwest::Url::parse("https://export.arxiv.org/api/query").unwrap(),
                    Context::new("chat", 180),
                    sender.as_ref(),
                )
                .await
                .unwrap_err();
            assert_eq!(error.code, "cooldown");
        }
        assert_eq!(sender.1.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
}

struct Hanging;
impl arxiv_gate::Sender for Hanging {
    fn send(
        &self,
        _: reqwest::Url,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<Output = Result<arxiv_gate::GateResponse, GateError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(std::future::pending())
    }
}
async fn connect_request(bridge: &Bridge) -> TcpStream {
    let url = reqwest::Url::parse(&bridge.endpoint).unwrap();
    let mut socket = TcpStream::connect(("127.0.0.1", url.port().unwrap()))
        .await
        .unwrap();
    let body =
        serde_json::json!({"url":"https://export.arxiv.org/api/query","method":"GET"}).to_string();
    let request=format!("POST /arxiv-request HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Proxy-Token: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",bridge.token,body.len(),body);
    socket.write_all(request.as_bytes()).await.unwrap();
    socket
}
async fn wait_trace(gate: &ArxivGate, state: &str) {
    tokio::time::timeout(Duration::from_secs(2), async {
        while !gate.traces().iter().any(|r| r.state == state) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}
#[tokio::test]
async fn disconnect_and_host_shutdown_cancel_sending_requests_and_release_gate() {
    for shutdown in [false, true] {
        let gate = Arc::new(ArxivGate::new(None));
        let bridge = Bridge::start_sender(
            gate.clone(),
            Context::new("cancel-test", 120),
            Arc::new(Hanging),
        )
        .await
        .unwrap();
        let socket = connect_request(&bridge).await;
        wait_trace(&gate, "sending").await;
        if shutdown {
            drop(bridge);
            drop(socket);
            wait_trace(&gate, "cancelled").await;
        } else {
            drop(socket);
            wait_trace(&gate, "cancelled").await;
            drop(bridge);
        }
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            gate.request_with(
                reqwest::Url::parse("https://export.arxiv.org/api/query").unwrap(),
                Context::new("after-cancel", 180),
                &Fixture(200, Default::default()),
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(result.status, 200);
    }
}
#[tokio::test]
async fn bridge_rejects_browser_origin_extra_headers_and_oversized_body_before_gate() {
    let gate = Arc::new(ArxivGate::new(None));
    let sender = Arc::new(Fixture(200, Default::default()));
    let bridge = Bridge::start_sender(gate, Context::new("security", 120), sender.clone())
        .await
        .unwrap();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    for payload in [
        serde_json::json!({"url":"http://127.0.0.1/api/query","method":"GET"}),
        serde_json::json!({"url":"https://export.arxiv.org/api/query","method":"POST"}),
        serde_json::json!({"url":"https://export.arxiv.org/api/query","method":"GET","headers":{"Authorization":"secret"}}),
    ] {
        assert_eq!(
            client
                .post(&bridge.endpoint)
                .header("X-Proxy-Token", &bridge.token)
                .json(&payload)
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
    }
    assert_eq!(
        client
            .post(&bridge.endpoint)
            .header("X-Proxy-Token", &bridge.token)
            .header("Origin", "https://example.invalid")
            .json(&serde_json::json!({}))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    // A rejected body need not be uploaded. Avoid Windows resetting a socket with unread body bytes.
    let url = reqwest::Url::parse(&bridge.endpoint).unwrap();
    let mut socket = TcpStream::connect(("127.0.0.1", url.port().unwrap()))
        .await
        .unwrap();
    let request=format!("POST /arxiv-request HTTP/1.1\r\nX-Proxy-Token: {}\r\nContent-Type: application/json\r\nContent-Length: 16385\r\n\r\n",bridge.token);
    socket.write_all(request.as_bytes()).await.unwrap();
    let mut response = String::new();
    socket.read_to_string(&mut response).await.unwrap();
    assert!(response.starts_with("HTTP/1.1 413"));
    assert_eq!(sender.1.load(std::sync::atomic::Ordering::SeqCst), 0);
}
