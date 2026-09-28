use super::pdf_parse_queue::ParseQueueMove;
use crate::Workspace;
use neuink_domain::{EntryMeta, PdfParseStatus};
use std::{
    fs,
    sync::{Arc, Barrier},
    time::{SystemTime, UNIX_EPOCH},
};

struct Fixture {
    workspace: Workspace,
    root: std::path::PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "neuink_parse_queue_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        Self {
            workspace: Workspace::create(&root).unwrap(),
            root,
        }
    }
    fn pdf(&self, title: &str) -> EntryMeta {
        let entry = self.workspace.create_entry(title).unwrap();
        let path = self.root.join("input.pdf");
        fs::write(&path, b"%PDF-1.4\nfixture").unwrap();
        self.workspace.import_pdf(&entry.id, path).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn downloaded_pdf_must_enqueue_before_upload_and_duplicate_enqueue_is_idempotent() {
    let f = Fixture::new();
    let w = &f.workspace;
    let pdf = f.pdf("Downloaded");
    assert_eq!(pdf.pdf.unwrap().parse.status, PdfParseStatus::NotStarted);
    assert!(w.read_pdf_parse_queue().unwrap().waiting.is_empty());
    assert!(w
        .set_pdf_parse_state(&pdf.id, PdfParseStatus::Uploading, None)
        .is_err());
    w.enqueue_pdf_parse(&pdf.id).unwrap();
    w.enqueue_pdf_parse(&pdf.id).unwrap();
    assert_eq!(w.read_pdf_parse_queue().unwrap().waiting.len(), 1);
    let claimed = w.claim_next_pdf_parse().unwrap().unwrap();
    assert_eq!(claimed.pdf.unwrap().parse.status, PdfParseStatus::Uploading);
    assert_eq!(
        w.enqueue_pdf_parse(&pdf.id)
            .unwrap()
            .pdf
            .unwrap()
            .parse
            .status,
        PdfParseStatus::Uploading
    );
    assert!(w.claim_next_pdf_parse().unwrap().is_none());
}

#[test]
fn order_is_persistent_and_controls_dispatch_not_only_the_display() {
    let f = Fixture::new();
    let w = &f.workspace;
    let a = f.pdf("A");
    let b = f.pdf("B");
    let c = f.pdf("C");
    for id in [&a.id, &b.id, &c.id] {
        w.enqueue_pdf_parse(id).unwrap();
    }
    w.move_pdf_parse(&c.id, ParseQueueMove::Up).unwrap();
    assert_eq!(w.read_pdf_parse_queue().unwrap().waiting[1].id, c.id);
    w.move_pdf_parse(&c.id, ParseQueueMove::Down).unwrap();
    w.move_pdf_parse(&c.id, ParseQueueMove::First).unwrap();
    let reopened = Workspace::open(&f.root).unwrap();
    assert_eq!(reopened.claim_next_pdf_parse().unwrap().unwrap().id, c.id);
    assert!(w.move_pdf_parse(&c.id, ParseQueueMove::Remove).is_err());
    w.set_pdf_parse_state(&c.id, PdfParseStatus::Failed, Some("offline".into()))
        .unwrap();
    assert_eq!(w.claim_next_pdf_parse().unwrap().unwrap().id, a.id);
    assert_eq!(w.read_pdf_parse_queue().unwrap().failed.len(), 1);
}

#[test]
fn removing_waiter_keeps_pdf_and_can_be_explicitly_requeued() {
    let f = Fixture::new();
    let w = &f.workspace;
    let a = f.pdf("A");
    let b = f.pdf("B");
    w.enqueue_pdf_parse(&a.id).unwrap();
    w.enqueue_pdf_parse(&b.id).unwrap();
    w.move_pdf_parse(&a.id, ParseQueueMove::Remove).unwrap();
    assert!(w.entry_pdf_path(&a.id).unwrap().exists());
    assert_eq!(
        w.read_entry(&a.id).unwrap().pdf.unwrap().parse.status,
        PdfParseStatus::Canceled
    );
    w.enqueue_pdf_parse(&a.id).unwrap();
    assert_eq!(
        w.read_pdf_parse_queue()
            .unwrap()
            .waiting
            .iter()
            .map(|e| &e.id)
            .collect::<Vec<_>>(),
        vec![&b.id, &a.id]
    );
}

#[test]
fn parallel_windows_only_claim_one_task() {
    let f = Fixture::new();
    for title in ["A", "B"] {
        let e = f.pdf(title);
        f.workspace.enqueue_pdf_parse(&e.id).unwrap();
    }
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let w = f.workspace.clone();
            let b = barrier.clone();
            std::thread::spawn(move || {
                b.wait();
                w.claim_next_pdf_parse().unwrap()
            })
        })
        .collect();
    assert_eq!(
        handles
            .into_iter()
            .filter_map(|h| h.join().unwrap())
            .count(),
        1
    );
}

#[test]
fn broken_order_does_not_silently_reorder_or_start_tasks() {
    let f = Fixture::new();
    let e = f.pdf("A");
    f.workspace.enqueue_pdf_parse(&e.id).unwrap();
    fs::write(f.root.join("pdf-parse-order.json"), b"broken").unwrap();
    assert!(f.workspace.claim_next_pdf_parse().is_err());
    assert_eq!(
        f.workspace
            .read_entry(&e.id)
            .unwrap()
            .pdf
            .unwrap()
            .parse
            .status,
        PdfParseStatus::Queued
    );
}
