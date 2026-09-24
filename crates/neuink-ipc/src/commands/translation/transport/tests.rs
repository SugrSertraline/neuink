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
