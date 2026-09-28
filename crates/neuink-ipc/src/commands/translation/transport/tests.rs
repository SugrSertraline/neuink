use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::mpsc,
    thread,
};

#[tokio::test]
async fn publishes_before_completion_and_preserves_split_utf8_and_unterminated_sse_lines() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (seen, wait_for_preview) = mpsc::channel();
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0; 4096];
        loop {
            let count = socket.read(&mut buffer).unwrap();
            assert!(count > 0);
            bytes.extend_from_slice(&buffer[..count]);
            if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                let header = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                let length: usize = header
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length:"))
                    .unwrap()
                    .trim()
                    .parse()
                    .unwrap();
                if bytes.len() >= end + 4 + length {
                    break;
                }
            }
        }
        write!(
            socket,
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        let first = format!(
            "data: {}",
            json!({"choices":[{"delta":{"content":"{\"translation\":\"首段"}}]})
        );
        let split = first.find('首').unwrap() + 1;
        socket.write_all(&first.as_bytes()[..split]).unwrap();
        socket.flush().unwrap();
        thread::sleep(Duration::from_millis(15));
        socket.write_all(&first.as_bytes()[split..]).unwrap();
        socket.flush().unwrap();
        thread::sleep(Duration::from_millis(15));
        socket.write_all(b"\n\n").unwrap();
        socket.flush().unwrap();
        // The server does not send the rest until the UI output callback sees the prefix.
        wait_for_preview
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        write!(
            socket,
            "data: {}",
            json!({"choices":[{"delta":{"content":"内容\"}"}}]})
        )
        .unwrap();
    });
    let profile: LlmProfile = serde_json::from_value(json!({"id":"stream-test","name":"test","base_url":format!("http://{address}/v1"),"model":"test"})).unwrap();
    let mut client = LlmClient::new(profile);
    client.client = Client::builder().no_proxy().build().unwrap();
    let outputs = Arc::new(Mutex::new(Vec::new()));
    let received = outputs.clone();
    let progress = Arc::new(Mutex::new(Vec::new()));
    let counts = progress.clone();
    client.progress = Some(Arc::new(move |count| counts.lock().unwrap().push(count)));
    client.output = Some(Arc::new(move |text| {
        if text == "{\"translation\":\"首段" {
            let _ = seen.send(());
        }
        received.lock().unwrap().push(text.to_string());
    }));
    assert_eq!(
        client
            .generate_text("translate", "one paragraph")
            .await
            .unwrap(),
        "{\"translation\":\"首段内容\"}"
    );
    server.join().unwrap();
    assert!(progress
        .lock()
        .unwrap()
        .iter()
        .all(|count| *count <= "{\"translation\":\"首段内容\"}".chars().count()));
    assert!(progress
        .lock()
        .unwrap()
        .iter()
        .any(|count| *count == "{\"translation\":\"首段".chars().count()));
    assert!(outputs
        .lock()
        .unwrap()
        .iter()
        .any(|text| text == "{\"translation\":\"首段"));
    assert!(outputs
        .lock()
        .unwrap()
        .iter()
        .all(|text| !text.contains('�')));
}

#[tokio::test]
async fn stop_closes_a_stalled_http_stream_without_fallback_or_retry() {
    // A real local socket remains open until the client stops consuming it.
    for reason in [TranslationStop::Pause, TranslationStop::Cancel] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut socket = loop {
                if let Ok((socket, _)) = listener.accept() {
                    break socket;
                }
                assert!(Instant::now() < deadline, "request not received");
                thread::sleep(Duration::from_millis(5));
            };
            socket.set_nonblocking(false).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            loop {
                let mut buffer = [0; 4096];
                let n = socket.read(&mut buffer).unwrap();
                assert!(n > 0);
                request.extend_from_slice(&buffer[..n]);
                if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&request[..end]).to_lowercase();
                    let length: usize = header
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {}\n\n", json!({"choices":[{"delta":{"content":"部分译文"}}]})).unwrap();
            socket.flush().unwrap();
            let closed = match socket.read(&mut [0; 1]) {
                Ok(0) => true,
                Err(error) => matches!(
                    error.kind(),
                    std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
                ),
                _ => false,
            };
            assert!(closed, "stream should close when stopped");
            assert!(listener.accept().is_err(), "must not fall back or retry");
        });
        let control = Arc::new(TranslationTaskControl::default());
        let signal = control.clone();
        let profile = serde_json::from_value(json!({"id":"stop-stream", "name":"test", "base_url":format!("http://{address}/v1"), "model":"test"})).unwrap();
        let mut client = LlmClient::new(profile);
        client.client = Client::builder().no_proxy().build().unwrap();
        client.output = Some(Arc::new(move |text| {
            if text == "部分译文" {
                signal.request_stop(reason);
            }
        }));
        let result = timeout(
            Duration::from_secs(5),
            control.run_until_stopped(client.generate_text("translate", "test")),
        )
        .await
        .unwrap();
        assert!(result.is_none());
        tokio::task::spawn_blocking(move || server.join().unwrap())
            .await
            .unwrap();
    }
}
