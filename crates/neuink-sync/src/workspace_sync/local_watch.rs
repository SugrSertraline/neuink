//! File events are hints, with a periodic metadata fallback and explicit trust loss.
use neuink_workspace::Workspace;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
const MAX_WATCHERS: usize = if cfg!(test) { 128 } else { 4 };

#[derive(Default)]
struct Hints {
    generation: u64,
    paths: BTreeSet<String>,
    rescan: bool,
    failed: bool,
}
struct Watched {
    _watcher: Option<RecommendedWatcher>,
    hints: Arc<Mutex<Hints>>,
    stamp: String,
    scanned: Instant,
    used: Instant,
    generation: u64,
    entries: BTreeMap<String, u64>,
}
fn watchers() -> &'static Mutex<BTreeMap<PathBuf, Watched>> {
    static WATCHERS: OnceLock<Mutex<BTreeMap<PathBuf, Watched>>> = OnceLock::new();
    WATCHERS.get_or_init(Default::default)
}
fn relevant(path: &str) -> bool {
    matches!(
        path.split('/').next().unwrap_or(""),
        "entries" | "tag-reading" | "daily" | "conversations" | "ideation"
    ) || matches!(
        path,
        "neuink.workspace.json"
            | "user-preferences.json"
            | "lifecycle-sequence.json"
            | "child-lifecycle-sequence.json"
            | "sync-sequence.json"
    ) || path.ends_with(".journal.json")
}
fn ingest(hints: &mut Hints, root: &Path, result: notify::Result<Event>) {
    let event = match result {
        Ok(event) => event,
        Err(_) => {
            hints.rescan = true;
            hints.failed = true;
            hints.generation = hints.generation.wrapping_add(1);
            return;
        }
    };
    if event.need_rescan() {
        hints.rescan = true;
    }
    if matches!(event.kind, EventKind::Access(_)) {
        return;
    }
    let mut changed = hints.rescan;
    for path in event.paths {
        if path == root {
            hints.rescan = true;
            changed = true;
            continue;
        }
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        let relative = relative.to_string_lossy().replace('\\', "/");
        if relevant(&relative) {
            changed = true;
            if hints.paths.len() >= 2048 {
                hints.rescan = true;
                hints.paths.clear();
            } else {
                hints.paths.insert(relative);
            }
        }
    }
    if changed {
        hints.generation = hints.generation.wrapping_add(1);
    }
}
fn create(root: &Path) -> Watched {
    let hints = Arc::new(Mutex::new(Hints::default()));
    let sink = hints.clone();
    let watched_root = root.to_owned();
    let watcher = notify::recommended_watcher(move |result| {
        if let Ok(mut hints) = sink.lock() {
            ingest(&mut hints, &watched_root, result);
        }
    })
    .and_then(|mut watcher| {
        watcher.watch(root, RecursiveMode::Recursive)?;
        Ok(watcher)
    })
    .ok();
    Watched {
        _watcher: watcher,
        hints,
        stamp: String::new(),
        scanned: Instant::now(),
        used: Instant::now(),
        generation: 0,
        entries: BTreeMap::new(),
    }
}
/// Cheap scheduler key. No PDF bytes are read here. Failed/unavailable native
/// watches fall back to a metadata walk every ten seconds; healthy ones every minute.
pub(super) fn change_stamp(workspace: &Workspace) -> Result<String, String> {
    let root = workspace.layout().root();
    let mut watches = watchers().lock().map_err(|_| "文件变化监听状态不可用")?;
    watches.retain(|_, watch| watch.used.elapsed() < Duration::from_secs(15 * 60));
    if watches.len() >= MAX_WATCHERS && !watches.contains_key(root) {
        watches.clear();
    }
    // Reopening a watch starts a new coverage interval. Files may have changed
    // while this library was inactive, including with preserved timestamps.
    if !watches.contains_key(root) {
        super::invalidate_local_observation(workspace)?;
    }
    let watch = watches
        .entry(root.to_owned())
        .or_insert_with(|| create(root));
    watch.used = Instant::now();
    let (generation, paths, rescan, failed) = {
        let mut hints = watch.hints.lock().map_err(|_| "文件变化通知不可用")?;
        (
            hints.generation,
            std::mem::take(&mut hints.paths),
            std::mem::take(&mut hints.rescan),
            hints.failed,
        )
    };
    if rescan {
        super::invalidate_local_observation(workspace)?;
        watch.entries.clear();
    } else if !paths.is_empty() {
        neuink_workspace::sync_export::invalidate_incremental_paths(
            root,
            &paths.iter().cloned().collect::<Vec<_>>(),
        )
        .map_err(|e| e.to_string())?;
        let entries: Vec<_> = paths
            .iter()
            .filter_map(|p| {
                let mut parts = p.split('/');
                (parts.next() == Some("entries"))
                    .then(|| parts.next().map(str::to_owned))
                    .flatten()
            })
            .collect();
        if watch.entries.len() >= 4096 {
            watch.entries.clear();
            super::candidates::invalidate_candidates(workspace);
        }
        for entry in &entries {
            watch.entries.insert(entry.clone(), generation);
        }
        super::candidates::invalidate_entries(workspace, &entries);
        // Whole directory rename/removal or shared metadata needs all candidates.
        if paths
            .iter()
            .any(|p| p == "entries" || p == "neuink.workspace.json")
        {
            super::candidates::invalidate_candidates(workspace);
        }
    }
    let fallback = if watch._watcher.is_none() || failed {
        10
    } else {
        60
    };
    if watch.stamp.is_empty()
        || generation != watch.generation
        || watch.scanned.elapsed() >= Duration::from_secs(fallback)
    {
        watch.stamp =
            neuink_workspace::sync_control::change_stamp(root).map_err(|e| e.to_string())?;
        watch.scanned = Instant::now();
    }
    watch.generation = generation;
    Ok(format!("{}:{generation}", watch.stamp))
}
pub(super) fn entry_generation(root: &Path, entry: &str) -> u64 {
    watchers()
        .lock()
        .ok()
        .and_then(|w| w.get(root).and_then(|w| w.entries.get(entry).copied()))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn event_filter_ignores_reads_and_sync_cache_but_keeps_rename_both_sides() {
        let root = Path::new("library");
        let mut hints = Hints::default();
        ingest(
            &mut hints,
            root,
            Ok(
                Event::new(EventKind::Access(notify::event::AccessKind::Read))
                    .add_path(root.join("entries/a/paper.pdf")),
            ),
        );
        ingest(
            &mut hints,
            root,
            Ok(
                Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
                    .add_path(root.join("sync-cache/blob")),
            ),
        );
        assert_eq!(hints.generation, 0);
        ingest(
            &mut hints,
            root,
            Ok(
                Event::new(EventKind::Modify(notify::event::ModifyKind::Name(
                    notify::event::RenameMode::Both,
                )))
                .add_path(root.join("entries/a/paper.pdf"))
                .add_path(root.join("entries/b/paper.pdf")),
            ),
        );
        assert_eq!(hints.paths.len(), 2);
        assert_eq!(hints.generation, 1);
    }
    #[test]
    fn watcher_overflow_and_errors_drop_trust() {
        let root = Path::new("library");
        let mut hints = Hints::default();
        ingest(
            &mut hints,
            root,
            Ok(Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan)),
        );
        assert!(hints.rescan);
        ingest(
            &mut hints,
            root,
            Err(notify::Error::generic("watch failed")),
        );
        assert!(hints.failed && hints.rescan);
    }
    #[test]
    fn native_event_changes_scheduler_key_even_when_file_attributes_are_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let entry = workspace.create_entry("External editor").unwrap();
        let path = workspace.layout().entry_dir(&entry.id).join("external.bin");
        std::fs::write(&path, b"before").unwrap();
        let before = change_stamp(&workspace).unwrap();
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        std::fs::write(&path, b"after!").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
        let until = Instant::now() + Duration::from_secs(3);
        while change_stamp(&workspace).unwrap() == before && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_ne!(change_stamp(&workspace).unwrap(), before);
        watchers().lock().unwrap().remove(workspace.layout().root());
    }
}
