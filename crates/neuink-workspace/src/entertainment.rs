use crate::{
    atomic_write_json,
    daily::{invalid, revision, validate_entertainment},
    Workspace, WorkspaceError,
};
use chrono::{DateTime, Duration, Utc};
use neuink_domain::daily::{EntertainmentRecord, EntertainmentState};
use serde::Serialize;
use std::fs;

#[derive(Clone, Debug, Serialize)]
pub struct EntertainmentSnapshot {
    pub revision: String,
    pub state: EntertainmentState,
}
impl Workspace {
    pub fn read_entertainment(&self) -> Result<EntertainmentSnapshot, WorkspaceError> {
        let path = self.daily_dir()?.join("entertainment.json");
        self.validate_note_workspace_path(&path)?;
        if !path.exists() {
            return Ok(EntertainmentSnapshot {
                revision: "missing".into(),
                state: EntertainmentState::default(),
            });
        }
        if fs::metadata(&path)?.len() > 16 * 1024 * 1024 {
            return Err(invalid("娱乐记录文件过大"));
        }
        let bytes = fs::read(path)?;
        let state = serde_json::from_slice(&bytes)?;
        validate_entertainment(&state)?;
        Ok(EntertainmentSnapshot {
            revision: revision(&bytes),
            state,
        })
    }
    pub fn update_entertainment(
        &self,
        update: impl FnOnce(&mut EntertainmentState) -> Result<(), WorkspaceError>,
    ) -> Result<EntertainmentSnapshot, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let mut current = self.read_entertainment()?;
        update(&mut current.state)?;
        validate_entertainment(&current.state)?;
        if serde_json::to_vec_pretty(&current.state)?.len() > 16 * 1024 * 1024 {
            return Err(invalid("娱乐记录文件过大，原文件未改变"));
        }
        atomic_write_json(self.daily_dir()?.join("entertainment.json"), &current.state)?;
        self.read_entertainment()
    }
}

/// Input is observed elapsed time only. Sleep/offline intervals never reach this function.
pub fn checkpoint(
    state: &mut EntertainmentState,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) -> Result<(), WorkspaceError> {
    let Some(timer) = state.timer.as_mut().filter(|timer| timer.running) else {
        return Ok(());
    };
    if end <= start || (end - start).num_seconds() > 30 {
        return Err(invalid("计时间隔无效"));
    }
    let previous = DateTime::parse_from_rfc3339(&timer.checkpoint_at)
        .map_err(|_| invalid("计时检查点无效"))?
        .with_timezone(&Utc);
    let mut cursor = start.max(previous); // retry/late checkpoints must not double count
    let offset = Duration::minutes(i64::from(timer.timezone_offset_minutes));
    while cursor < end {
        let local = cursor - offset;
        let date = local.format("%Y-%m-%d").to_string();
        let next_day = local
            .date_naive()
            .succ_opt()
            .ok_or_else(|| invalid("日期超出范围"))?
            .and_hms_opt(0, 0, 0)
            .ok_or_else(|| invalid("日期超出范围"))?
            .and_utc()
            + offset;
        let until = end.min(next_day);
        let id = format!("{}-{date}", timer.id);
        let delta = (until - cursor).num_milliseconds() as u64;
        if let Some(record) = state.records.iter_mut().find(|record| record.id == id) {
            record.active_ms += delta;
            record.ended_at = until.to_rfc3339();
        } else {
            state.records.push(EntertainmentRecord {
                id,
                date,
                started_at: cursor.to_rfc3339(),
                ended_at: until.to_rfc3339(),
                timezone_offset_minutes: timer.timezone_offset_minutes,
                active_ms: delta,
                category: timer.category.clone(),
                note: timer.note.clone(),
                deleted: false,
            });
        }
        cursor = until;
    }
    timer.checkpoint_at = end.max(previous).to_rfc3339();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use neuink_domain::daily::EntertainmentTimer;
    #[test]
    fn midnight_split_and_duplicate_checkpoint() {
        let start = DateTime::parse_from_rfc3339("2026-10-23T15:59:55Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut state = EntertainmentState {
            timer: Some(EntertainmentTimer {
                id: "session".into(),
                category: "游戏".into(),
                note: String::new(),
                running: true,
                checkpoint_at: start.to_rfc3339(),
                timezone_offset_minutes: -480,
            }),
            ..Default::default()
        };
        checkpoint(&mut state, start, start + Duration::seconds(10)).unwrap();
        checkpoint(&mut state, start, start + Duration::seconds(10)).unwrap();
        assert_eq!(state.records.len(), 2);
        assert_eq!(state.records[0].date, "2026-10-23");
        assert_eq!(state.records[1].date, "2026-10-24");
        assert_eq!(
            state.records.iter().map(|r| r.active_ms).sum::<u64>(),
            10_000
        );
        assert!(checkpoint(&mut state, start, start + Duration::hours(8)).is_err());
    }
}
