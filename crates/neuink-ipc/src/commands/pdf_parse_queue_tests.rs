use super::{
    entry::{submit_queued_pdf_parse, SubmitQueuedPdfParseRequest},
    pdf_parse_queue::{process_pdf_parse_queue, DispatchRequest},
};
use neuink_domain::PdfParseStatus;
use neuink_workspace::Workspace;
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    time::{Duration, Instant},
};

fn server(status: &str, body: &str) -> (String, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/tasks", listener.local_addr().unwrap());
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    let thread = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut socket = loop {
            if let Ok((socket, _)) = listener.accept() {
                break socket;
            }
            assert!(Instant::now() < deadline, "parser was not called");
            std::thread::sleep(Duration::from_millis(10));
        };
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut buffer = [0; 4096];
            let count = socket.read(&mut buffer).unwrap();
            assert_ne!(count, 0);
            bytes.extend_from_slice(&buffer[..count]);
            if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                let length: usize = headers
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
        socket.write_all(response.as_bytes()).unwrap();
    });
    (url, thread)
}

#[tokio::test]
async fn downloaded_pdf_queue_dispatch_failure_and_interrupted_recovery() {
    let temp = tempfile::tempdir().unwrap();
    let w = Workspace::create(temp.path()).unwrap();
    let path = temp.path().join("downloaded.pdf");
    fs::write(&path, b"%PDF-1.4\nfixture").unwrap();
    let a = w.create_entry("downloaded").unwrap();
    let b = w.create_entry("next").unwrap();
    w.import_pdf(&a.id, &path).unwrap();
    w.import_pdf(&b.id, &path).unwrap();
    let (endpoint, http) = server("200 OK", r#"{"task_id":"remote-1","state":"queued"}"#);
    let response = submit_queued_pdf_parse(SubmitQueuedPdfParseRequest {
        root: temp.path().into(),
        entry_id: a.id.clone(),
        endpoint: endpoint.clone(),
        api_key: None,
    })
    .await
    .unwrap();
    assert_eq!(
        response.entry.pdf.unwrap().parse.status,
        PdfParseStatus::Queued
    );
    w.enqueue_pdf_parse(&b.id).unwrap();
    process_pdf_parse_queue(DispatchRequest {
        root: temp.path().into(),
        endpoint: endpoint.clone(),
        api_key: None,
    })
    .await
    .unwrap();
    http.join().unwrap();
    let current = w.read_entry(&a.id).unwrap().pdf.unwrap().parse;
    assert_eq!(current.status, PdfParseStatus::Parsing);
    assert_eq!(current.task_id.as_deref(), Some("remote-1"));
    // Still-running remote task prevents dispatching the next queued item.
    process_pdf_parse_queue(DispatchRequest {
        root: temp.path().into(),
        endpoint,
        api_key: None,
    })
    .await
    .unwrap();
    assert_eq!(
        w.read_entry(&b.id).unwrap().pdf.unwrap().parse.status,
        PdfParseStatus::Queued
    );
    w.set_pdf_parse_state(&a.id, PdfParseStatus::Failed, Some("remote failure".into()))
        .unwrap();
    let (endpoint, http) = server("403 Forbidden", r#"{"error":"denied"}"#);
    process_pdf_parse_queue(DispatchRequest {
        root: temp.path().into(),
        endpoint: endpoint.clone(),
        api_key: None,
    })
    .await
    .unwrap();
    http.join().unwrap();
    assert_eq!(
        w.read_entry(&b.id).unwrap().pdf.unwrap().parse.status,
        PdfParseStatus::Failed
    );
    // A restart leaves Uploading without task id. Recover to an explicit failure, never retry it.
    w.enqueue_pdf_parse(&a.id).unwrap();
    w.claim_next_pdf_parse().unwrap().unwrap();
    process_pdf_parse_queue(DispatchRequest {
        root: temp.path().into(),
        endpoint: endpoint.clone(),
        api_key: None,
    })
    .await
    .unwrap();
    assert!(w
        .read_entry(&a.id)
        .unwrap()
        .pdf
        .unwrap()
        .parse
        .message
        .unwrap()
        .contains("上次提交已中断"));
    // Missing local file also leaves a terminal failure, not a permanent uploading/queued status.
    w.enqueue_pdf_parse(&b.id).unwrap();
    fs::remove_file(w.entry_pdf_path(&b.id).unwrap()).unwrap();
    process_pdf_parse_queue(DispatchRequest {
        root: temp.path().into(),
        endpoint,
        api_key: None,
    })
    .await
    .unwrap();
    assert_eq!(
        w.read_entry(&b.id).unwrap().pdf.unwrap().parse.status,
        PdfParseStatus::Failed
    );
    assert!(w.read_pdf_parse_queue().unwrap().active.is_empty());
    assert!(w.read_pdf_parse_queue().unwrap().waiting.is_empty());
}
