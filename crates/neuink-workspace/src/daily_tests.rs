use super::*;
use neuink_domain::daily::{DailyTodo, EntertainmentRecord, EntertainmentState};

#[test]
fn defaults_do_not_write_and_empty_layout_is_durable() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::create(dir.path()).unwrap();
    let snapshot = ws.read_daily_state().unwrap();
    assert_eq!(snapshot.revision, "missing");
    assert!(!ws.daily_dir().unwrap().exists());
    let mut state = snapshot.state;
    state.widgets.clear();
    state.todos.push(DailyTodo {
        id: "task-1".into(),
        list_id: "inbox".into(),
        text: "Read paper".into(),
        date: None,
        completed: false,
        deleted: false,
    });
    let saved = ws.save_daily_state("missing", state.clone()).unwrap();
    assert!(ws.save_daily_state("missing", state).is_err());
    let reloaded = Workspace::open_existing(dir.path())
        .unwrap()
        .read_daily_state()
        .unwrap();
    assert_eq!(saved.revision, reloaded.revision);
    assert!(reloaded.state.widgets.is_empty());
    assert_eq!(reloaded.state.todos.len(), 1);
}
#[test]
fn malformed_data_is_preserved_and_bad_references_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::create(dir.path()).unwrap();
    let mut state = DailyState::default();
    state.widgets[0].id = "../escape".into();
    assert!(ws.save_daily_state("missing", state).is_err());
    let path = ws.daily_dir().unwrap().join("state.json");
    atomic_write_json(&path, &serde_json::json!({"version":99})).unwrap();
    assert!(ws.read_daily_state().is_err());
    assert!(ws
        .save_daily_state("missing", DailyState::default())
        .is_err());
    assert!(fs::read_to_string(path).unwrap().contains("99"));
}
#[test]
fn daily_notes_are_atomic_date_owned_and_conflict_checked() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::create(dir.path()).unwrap();
    assert!(ws.read_daily_note("../../other").is_err());
    assert!(ws.read_daily_note("2026-02-30").is_err());
    let mut note = ws.read_daily_note("2026-10-23").unwrap();
    note.markdown = "## 阅读\n\n- [ ] 比较方法".into();
    let saved = ws.save_daily_note("2026-10-23", note.clone()).unwrap();
    assert!(ws.save_daily_note("2026-10-23", note).is_err());
    assert_eq!(
        ws.read_daily_note("2026-10-23").unwrap().markdown,
        saved.markdown
    );
    assert_eq!(ws.read_note_catalog().unwrap().notes.len(), 1);
    assert!(ws
        .read_daily_note("2026-10-24")
        .unwrap()
        .markdown
        .is_empty());
}
#[test]
fn entertainment_rejects_impossible_duration_and_duplicate_identity() {
    let mut state = EntertainmentState::default();
    let record = EntertainmentRecord {
        id: "one".into(),
        date: "2026-10-23".into(),
        started_at: "2026-10-23T00:00:00Z".into(),
        ended_at: "2026-10-23T00:01:00Z".into(),
        timezone_offset_minutes: -480,
        active_ms: 60_001,
        category: "游戏".into(),
        note: String::new(),
        deleted: false,
    };
    state.records.push(record);
    assert!(validate_entertainment(&state).is_err());
    state.records[0].active_ms = 60_000;
    assert!(validate_entertainment(&state).is_ok());
    state.records.push(state.records[0].clone());
    assert!(validate_entertainment(&state).is_err());
}
