use super::*;
use crate::commands::selection_translation::registry::{preset, ServiceClient};
use neuink_config::SelectionTranslationProvider;
use std::{
    io::{Read, Write},
    net::TcpListener,
};

#[tokio::test]
async fn failed_long_segment_resumes_only_unfinished_chunks_after_reopen() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let endpoint = format!("http://{}/translate", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        let mut requests = Vec::new();
        while requests.len() < 3 && std::time::Instant::now() < deadline {
            let Ok((mut socket, _)) = listener.accept() else {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            };
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 8192];
            let body = loop {
                let n = socket.read(&mut buffer).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buffer[..n]);
                if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let length: usize = header
                        .lines()
                        .find_map(|v| v.strip_prefix("content-length:"))
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    if bytes.len() >= end + 4 + length {
                        break bytes[end + 4..end + 4 + length].to_vec();
                    }
                }
            };
            let (status, value) = if requests.len() == 1 {
                ("401 Unauthorized", "{}")
            } else if requests.is_empty() {
                ("200 OK", r#"{"tgt_text":"前半段。"}"#)
            } else {
                ("200 OK", r#"{"tgt_text":"后半段。"}"#)
            };
            write!(socket, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{value}", value.len()).unwrap();
            requests.push(body);
        }
        requests
    });
    let root = std::env::temp_dir().join(format!("neuink-chunks-{}", EntryId::new()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("Chunk recovery").unwrap();
    let segment = SourceSegment::new(
        SegmentType::Paragraph,
        0,
        None,
        "A complete sentence. ".repeat(300),
    );
    let client = || {
        let mut settings = preset(SelectionTranslationProvider::Niutrans);
        settings.endpoint = endpoint.clone();
        TranslationClient::Service(ServiceClient::for_test(settings))
            .with_checkpoint(Workspace::open(&root).unwrap(), entry.id.clone())
    };
    let context = empty_paper_context();
    assert!(client()
        .translate_batch("", &context, &[segment.clone()])
        .await
        .is_err());
    let resumed = client();
    let result = resumed
        .translate_batch("", &context, &[segment.clone()])
        .await
        .unwrap();
    assert_eq!(result[&segment.uid], "前半段。\n后半段。");
    resumed.commit_chunks(&source_text(&segment)).unwrap();
    assert_eq!(std::fs::read_dir(workspace.layout().entry_dir(&entry.id).join("translation-chunks")).unwrap().count(), 0);
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[1], requests[2]);
    assert_ne!(requests[0], requests[2]);
    // Test-owned isolated workspace only.
    std::fs::remove_dir_all(root).unwrap();
}
