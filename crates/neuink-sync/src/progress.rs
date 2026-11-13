use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

#[derive(Clone, Default, Serialize)]
pub struct Progress {
    pub phase: String,
    pub scanned: usize,
    pub scan_total: usize,
    pub confirmed_bytes: u64,
    pub total_bytes: u64,
    pub published: usize,
    pub received: usize,
    pub applied: usize,
}
#[derive(Default)]
struct State {
    progress: Progress,
    files: BTreeMap<(bool, String), (u64, u64)>,
}
#[derive(Clone)]
pub(crate) struct Reporter {
    state: Arc<Mutex<State>>,
    report: Arc<dyn Fn(Progress) + Send + Sync>,
}
impl Reporter {
    pub fn new(report: impl Fn(Progress) + Send + Sync + 'static) -> Self {
        Self {
            state: Default::default(),
            report: Arc::new(report),
        }
    }
    fn update(&self, update: impl FnOnce(&mut State)) {
        if let Ok(mut state) = self.state.lock() {
            update(&mut state);
            // Keep publication order consistent across concurrent transfers.
            (self.report)(state.progress.clone());
        }
    }
    pub fn phase(&self, phase: &str) {
        self.update(|s| {
            s.progress.phase = phase.into();
            s.progress.scanned = 0;
            s.progress.scan_total = 0;
            transfer_totals(s);
        });
    }
    pub fn scan(&self, current: usize, total: usize) {
        self.update(|s| { s.progress.scanned = current; s.progress.scan_total = total; });
    }
    pub fn file(&self, upload: bool, hash: &str, offset: u64, size: u64) {
        self.update(|s| {
            s.files
                .insert((upload, hash.into()), (offset.min(size), size));
            transfer_totals(s);
        });
    }
    pub fn objects(&self, published: usize, received: usize, applied: usize) {
        self.update(|s| {
            s.progress.published = published;
            s.progress.received = received;
            s.progress.applied = applied;
        });
    }
}
fn transfer_totals(state: &mut State) {
    let upload = match state.progress.phase.as_str() {
        "uploading" => Some(true), "downloading" => Some(false), _ => None,
    };
    let (current, total) = state.files.iter()
        .filter(|((direction, _), _)| upload == Some(*direction))
        .fold((0, 0), |(a, b), (_, (current, total))| (a + current, b + total));
    state.progress.confirmed_bytes = current;
    state.progress.total_bytes = total;
}
impl crate::SyncClient {
    pub(crate) fn scan_progress(&self, current: usize, total: usize) {
        if let Some(p) = &self.progress { p.scan(current, total); }
    }
    pub fn with_progress(mut self, report: impl Fn(Progress) + Send + Sync + 'static) -> Self {
        self.progress = Some(Reporter::new(report));
        self
    }
    pub(crate) fn phase(&self, phase: &str) {
        if let Some(p) = &self.progress {
            p.phase(phase);
        }
    }
    pub(crate) fn file_progress(&self, upload: bool, hash: &str, offset: u64, size: u64) {
        if let Some(p) = &self.progress {
            p.file(upload, hash, offset, size);
        }
    }
    pub(crate) fn object_progress(&self, published: usize, received: usize, applied: usize) {
        if let Some(p) = &self.progress {
            p.objects(published, received, applied);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replayed_offsets_do_not_double_count_and_transfer_is_not_application() {
        let snapshots = Arc::new(Mutex::new(Vec::new()));
        let capture = snapshots.clone();
        let reporter = Reporter::new(move |value| capture.lock().unwrap().push(value));
        reporter.phase("uploading");
        reporter.file(true, "a", 40, 100);
        reporter.file(true, "a", 40, 100);
        reporter.file(true, "a", 100, 100);
        reporter.phase("downloading");
        reporter.file(false, "b", 50, 200);
        let snapshots = snapshots.lock().unwrap();
        let last = snapshots.last().unwrap();
        assert_eq!((last.confirmed_bytes, last.total_bytes), (50, 200));
        assert_eq!(last.applied, 0);
    }

    #[test]
    fn local_checks_clear_transfer_totals_and_report_real_scan_counts() {
        let snapshots = Arc::new(Mutex::new(Vec::new()));
        let capture = snapshots.clone();
        let reporter = Reporter::new(move |value| capture.lock().unwrap().push(value));
        reporter.phase("uploading");
        reporter.file(true, "a", 100, 100);
        reporter.phase("checking");
        reporter.scan(2, 8);
        let snapshots = snapshots.lock().unwrap();
        let last = snapshots.last().unwrap();
        assert_eq!((last.confirmed_bytes, last.total_bytes), (0, 0));
        assert_eq!((last.scanned, last.scan_total), (2, 8));
    }
}
