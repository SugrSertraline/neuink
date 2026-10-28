use crate::Workspace;
use chrono::{TimeZone, Utc};
use neuink_domain::{ReadingSession, ReadingStateUpdate};

fn checkpoint(id: &str, date: &str, second: u32) -> ReadingStateUpdate {
    let start = Utc.with_ymd_and_hms(2026, 10, 23, 12, 0, 0).unwrap();
    ReadingStateUpdate {
        // Must be ignored when an idempotent session checkpoint is present.
        active_ms_delta: 999_999,
        reading_session: Some(ReadingSession {
            id: id.into(),
            local_date: date.into(),
            started_at: start,
            ended_at: start + chrono::Duration::seconds(second.into()),
            active_ms: second as u64 * 1000,
        }),
        ..Default::default()
    }
}

#[test]
fn reading_sessions_survive_reopen_and_replay_without_double_counting() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    let entry = workspace.create_entry("sessions").unwrap();
    let first = checkpoint("session-a", "2026-10-23", 15);
    workspace
        .update_reading_state(&entry.id, first.clone())
        .unwrap();
    let reopened = Workspace::open(dir.path()).unwrap();
    let replay = reopened.update_reading_state(&entry.id, first).unwrap();
    assert_eq!(replay.state.total_active_ms, 15_000);
    let saved = reopened
        .update_reading_state(&entry.id, checkpoint("session-a", "2026-10-23", 30))
        .unwrap();
    assert_eq!(saved.state.total_active_ms, 30_000);
    assert_eq!(saved.state.session_count, 1);
    assert_eq!(saved.state.reading_sessions.len(), 1);
    assert_eq!(saved.state.daily_active_ms["2026-10-23"], 30_000);
    let late = reopened
        .update_reading_state(&entry.id, checkpoint("session-a", "2026-10-23", 20))
        .unwrap();
    assert_eq!(late.state.total_active_ms, 30_000);
    assert_eq!(late.state.reading_sessions[0].active_ms, 30_000);
}

#[test]
fn reading_sessions_preserve_legacy_totals_and_split_dates() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    let entry = workspace.create_entry("legacy").unwrap();
    let path = workspace.layout().entry_reading_state_file(&entry.id);
    std::fs::write(&path, r#"{"version":1,"total_active_ms":60000,"daily_active_ms":{"2026-10-23":60000},"session_count":2}"#).unwrap();
    assert!(workspace
        .read_reading_state(&entry.id)
        .unwrap()
        .state
        .reading_sessions
        .is_empty());
    workspace
        .update_reading_state(&entry.id, checkpoint("before-midnight", "2026-10-23", 10))
        .unwrap();
    let saved = workspace
        .update_reading_state(&entry.id, checkpoint("after-midnight", "2026-10-24", 5))
        .unwrap();
    assert_eq!(saved.state.daily_active_ms["2026-10-23"], 70_000);
    assert_eq!(saved.state.daily_active_ms["2026-10-24"], 5_000);
    assert_eq!(saved.state.total_active_ms, 75_000);
    assert_eq!(saved.state.session_count, 4);
    assert_eq!(
        Workspace::open(dir.path())
            .unwrap()
            .read_reading_state(&entry.id)
            .unwrap(),
        saved
    );
}

#[test]
fn invalid_or_conflicting_session_cannot_modify_saved_state() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    let entry = workspace.create_entry("validation").unwrap();
    workspace
        .update_reading_state(&entry.id, checkpoint("same-id", "2026-10-23", 10))
        .unwrap();
    let path = workspace.layout().entry_reading_state_file(&entry.id);
    let before = std::fs::read(&path).unwrap();
    for update in [
        checkpoint("same-id", "2026-10-24", 20),
        checkpoint("invalid-date", "2026-02-30", 10),
        checkpoint("", "2026-10-23", 10),
    ] {
        assert!(workspace.update_reading_state(&entry.id, update).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
    let mut excessive = checkpoint("excessive", "2026-10-23", 10);
    excessive.reading_session.as_mut().unwrap().active_ms = 11_000;
    assert!(workspace
        .update_reading_state(&entry.id, excessive)
        .is_err());
    assert_eq!(std::fs::read(&path).unwrap(), before);
}
