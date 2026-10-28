//! Durable sidebar configuration and user activity. Revision checks serialize UI edits.
use crate::{atomic_write_json, Workspace, WorkspaceError};
use chrono::{DateTime, NaiveDate};
use neuink_domain::{daily::DailyState, NoteOwner};
use serde::Serialize;
use std::{collections::BTreeSet, fs, path::PathBuf};

pub(crate) fn invalid(message: &str) -> WorkspaceError {
    WorkspaceError::Daily(message.into())
}
pub fn validate_date(date: &str) -> Result<(), WorkspaceError> {
    if date.len() != 10 || NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
        return Err(invalid("日期无效，请使用 YYYY-MM-DD"));
    }
    Ok(())
}
pub(crate) fn valid_id(id: &str) -> Result<(), WorkspaceError> {
    if id.is_empty()
        || id.len() > 100
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err(invalid("记录标识无效"));
    }
    Ok(())
}
pub(crate) fn revision(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}
#[derive(Clone, Debug, Serialize)]
pub struct DailySnapshot {
    pub revision: String,
    pub state: DailyState,
}

impl Workspace {
    pub fn daily_dir(&self) -> Result<PathBuf, WorkspaceError> {
        let path = self.layout().root().join("daily");
        self.validate_note_workspace_path(&path)?;
        Ok(path)
    }
    pub fn read_daily_state(&self) -> Result<DailySnapshot, WorkspaceError> {
        let path = self.daily_dir()?.join("state.json");
        self.validate_note_workspace_path(&path)?;
        if !path.exists() {
            return Ok(DailySnapshot {
                revision: "missing".into(),
                state: DailyState::default(),
            });
        }
        if fs::metadata(&path)?.len() > 8 * 1024 * 1024 {
            return Err(invalid("每日数据过大，请保留文件并联系支持"));
        }
        let bytes = fs::read(path)?;
        let state = serde_json::from_slice(&bytes)?;
        validate_state(&state)?;
        Ok(DailySnapshot {
            revision: revision(&bytes),
            state,
        })
    }
    pub fn save_daily_state(
        &self,
        expected: &str,
        state: DailyState,
    ) -> Result<DailySnapshot, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let current = self.read_daily_state()?;
        if current.revision != expected {
            return Err(invalid(
                "每日数据已被另一处修改，请重新载入后重试；本次内容未覆盖原文件",
            ));
        }
        validate_state(&state)?;
        if serde_json::to_vec_pretty(&state)?.len() > 8 * 1024 * 1024 {
            return Err(invalid("每日数据过大，请先整理历史待办；原文件未改变"));
        }
        let path = self.daily_dir()?.join("state.json");
        atomic_write_json(path, &state)?;
        self.read_daily_state()
    }
}
fn unique<'a>(ids: impl Iterator<Item = &'a str>) -> Result<(), WorkspaceError> {
    let mut seen = BTreeSet::new();
    for id in ids {
        valid_id(id)?;
        if !seen.insert(id) {
            return Err(invalid("记录标识重复"));
        }
    }
    Ok(())
}
pub fn validate_state(state: &DailyState) -> Result<(), WorkspaceError> {
    if state.version != 1 {
        return Err(invalid("每日数据来自不兼容版本，未覆盖原文件"));
    }
    if state.widgets.len() > 32 || state.lists.len() > 100 || state.todos.len() > 20_000 {
        return Err(invalid("每日记录超过支持数量，请先整理历史记录"));
    }
    unique(state.widgets.iter().map(|v| v.id.as_str()))?;
    unique(state.lists.iter().map(|v| v.id.as_str()))?;
    unique(state.todos.iter().map(|v| v.id.as_str()))?;
    for list in &state.lists {
        if list.title.trim().is_empty() || list.title.len() > 300 {
            return Err(invalid("待办清单名称无效"));
        }
    }
    for widget in &state.widgets {
        if widget.title.len() > 300 {
            return Err(invalid("组件名称过长"));
        }
        if let Some(target) = &widget.note {
            valid_id(target.note_id.as_str())?;
            match &target.owner {
                NoteOwner::Entry { entry_id } => valid_id(entry_id.as_str())?,
                NoteOwner::TagReading { tag_id } => valid_id(tag_id.as_str())?,
                NoteOwner::Daily { date } => validate_date(date)?,
            }
        }
        if !state.lists.iter().any(|list| list.id == widget.list_id) {
            return Err(invalid("组件引用的待办清单不存在"));
        }
    }
    for todo in &state.todos {
        if todo.text.trim().is_empty()
            || todo.text.len() > 10_000
            || !state.lists.iter().any(|list| list.id == todo.list_id)
        {
            return Err(invalid("待办内容或所属清单无效"));
        }
        if let Some(date) = &todo.date {
            validate_date(date)?;
        }
    }
    for values in [
        &state.recommendation_preferences.interests,
        &state.recommendation_preferences.exclusions,
    ] {
        if values.len() > 30 || values.iter().any(|v| v.trim().is_empty() || v.len() > 200) {
            return Err(invalid("兴趣或排除方向过多、过长或为空"));
        }
    }
    Ok(())
}
pub(crate) fn validate_entertainment(
    state: &neuink_domain::daily::EntertainmentState,
) -> Result<(), WorkspaceError> {
    if state.version != 1 || state.records.len() > 50_000 {
        return Err(invalid("娱乐记录版本或数量不兼容"));
    }
    unique(state.records.iter().map(|v| v.id.as_str()))?;
    for record in &state.records {
        validate_date(&record.date)?;
        if !(-840..=840).contains(&record.timezone_offset_minutes) {
            return Err(invalid("娱乐记录时区无效"));
        }
        let start = DateTime::parse_from_rfc3339(&record.started_at)
            .map_err(|_| invalid("开始时间无效"))?;
        let end =
            DateTime::parse_from_rfc3339(&record.ended_at).map_err(|_| invalid("结束时间无效"))?;
        let local_start = start.with_timezone(&chrono::Utc)
            - chrono::Duration::minutes(i64::from(record.timezone_offset_minutes));
        let local_end = end.with_timezone(&chrono::Utc)
            - chrono::Duration::minutes(i64::from(record.timezone_offset_minutes));
        if local_start.format("%Y-%m-%d").to_string() != record.date
            || (local_end - chrono::Duration::milliseconds(1)).date_naive()
                > local_start.date_naive()
        {
            return Err(invalid("娱乐记录必须按当地日期拆分"));
        }
        if end < start
            || record.active_ms > (end - start).num_milliseconds().max(0) as u64
            || record.active_ms > 86_400_000
            || record.category.trim().is_empty()
            || record.category.len() > 200
            || record.note.len() > 10_000
        {
            return Err(invalid("娱乐记录时间、分类或备注无效"));
        }
    }
    if let Some(timer) = &state.timer {
        valid_id(&timer.id)?;
        DateTime::parse_from_rfc3339(&timer.checkpoint_at)
            .map_err(|_| invalid("计时检查点无效"))?;
        if timer.category.trim().is_empty()
            || timer.category.len() > 200
            || timer.note.len() > 10_000
            || !(-840..=840).contains(&timer.timezone_offset_minutes)
        {
            return Err(invalid("计时分类、备注或时区无效"));
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "daily_tests.rs"]
mod tests;
