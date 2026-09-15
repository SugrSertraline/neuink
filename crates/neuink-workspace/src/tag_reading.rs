use std::{collections::BTreeSet, fs, path::PathBuf};

use chrono::Utc;
use neuink_domain::{EntryId, ReadingMode, SourceSegment, TagId, TagReadingWorkspace};
use serde::Serialize;

use crate::{atomic_write_json, workspace::collect_descendant_tag_ids, Workspace, WorkspaceError};

#[derive(Debug, Serialize)]
pub struct TagReadingMember {
    pub entry_id: EntryId,
    pub title: String,
    pub pdf_available: bool,
    pub reflow_available: bool,
    pub preferred_mode: ReadingMode,
    pub issue: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TagReadingResponse {
    pub state: TagReadingWorkspace,
    pub members: Vec<TagReadingMember>,
}

pub(crate) fn validate_id(id: &str) -> Result<(), WorkspaceError> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(WorkspaceError::TagReading("条目或标签标识无效".into()));
    }
    Ok(())
}

impl Workspace {
    pub(crate) fn tag_reading_path(&self, tag_id: &TagId) -> Result<PathBuf, WorkspaceError> {
        validate_id(tag_id.as_str())?;
        let path = self
            .layout()
            .root()
            .join("tag-reading")
            .join(format!("{tag_id}.json"));
        let mut existing = path.as_path();
        while !existing.exists() {
            existing = existing
                .parent()
                .ok_or_else(|| WorkspaceError::TagReading("阅读状态路径不可用".into()))?;
        }
        if !existing
            .canonicalize()?
            .starts_with(self.layout().root().canonicalize()?)
        {
            return Err(WorkspaceError::TagReading(
                "阅读状态路径超出资料库范围".into(),
            ));
        }
        Ok(path)
    }

    fn load_tag_reading(&self, tag_id: &TagId) -> Result<TagReadingWorkspace, WorkspaceError> {
        let path = self.tag_reading_path(tag_id)?;
        if !self.list_tags()?.iter().any(|tag| tag.id == *tag_id) {
            return Err(WorkspaceError::TagMissing(tag_id.to_string()));
        }
        let state: TagReadingWorkspace = match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                TagReadingWorkspace::new(tag_id.clone())
            }
            Err(error) => return Err(error.into()),
        };
        validate_state(&state, tag_id)?;
        Ok(state)
    }

    pub fn read_tag_reading(&self, tag_id: &TagId) -> Result<TagReadingResponse, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let state = self.load_tag_reading(tag_id)?;
        let members = self.tag_reading_members(&state)?;
        Ok(TagReadingResponse { state, members })
    }

    pub fn save_tag_reading(
        &self,
        mut state: TagReadingWorkspace,
        expected_revision: u64,
    ) -> Result<TagReadingWorkspace, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        validate_state(&state, &state.tag_id)?;
        let previous = self.load_tag_reading(&state.tag_id)?;
        if previous.revision != expected_revision || state.revision != expected_revision {
            return Err(WorkspaceError::TagReading(
                "阅读状态已被更新，请重新载入后再操作；未覆盖已保存进度".into(),
            ));
        }
        let members: BTreeSet<_> = self
            .tag_reading_members(&state)?
            .into_iter()
            .map(|member| member.entry_id)
            .collect();
        for id in state.member_states.keys() {
            if !members.contains(id)
                && previous.member_states.get(id) != state.member_states.get(id)
            {
                return Err(WorkspaceError::TagReading(
                    "不能为标签范围之外的条目新增阅读进度".into(),
                ));
            }
        }
        // An old UI cannot erase task history for members temporarily removed from a tag.
        for (id, history) in previous.member_states {
            state.member_states.entry(id).or_insert(history);
        }
        for id in [&state.active_entry_id, &state.compare_entry_id]
            .into_iter()
            .flatten()
        {
            if !members.contains(id)
                && previous.active_entry_id.as_ref() != Some(id)
                && previous.compare_entry_id.as_ref() != Some(id)
            {
                return Err(WorkspaceError::TagReading(
                    "所选论文已不属于当前标签，请刷新队列".into(),
                ));
            }
        }
        state.revision = expected_revision
            .checked_add(1)
            .ok_or_else(|| WorkspaceError::TagReading("阅读状态版本超出范围".into()))?;
        state.updated_at = Utc::now();
        atomic_write_json(self.tag_reading_path(&state.tag_id)?, &state)?;
        Ok(state)
    }

    fn tag_reading_members(
        &self,
        state: &TagReadingWorkspace,
    ) -> Result<Vec<TagReadingMember>, WorkspaceError> {
        let tags = self.list_tags()?;
        let ids = if state.include_descendants {
            collect_descendant_tag_ids(&tags, &state.tag_id)
        } else {
            BTreeSet::from([state.tag_id.clone()])
        };
        let mut entries = self.list_entries()?;
        entries.retain(|entry| entry.tags.iter().any(|id| ids.contains(id)));
        entries.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
        entries
            .into_iter()
            .map(|entry| {
                validate_id(entry.id.as_str())?;
                let pdf_available = fs::metadata(self.layout().entry_pdf_file(&entry.id))
                    .is_ok_and(|meta| meta.is_file() && meta.len() > 0);
                // Inspect normalized segments, not all PDF bytes or derived image previews.
                let segments = match fs::read(self.layout().entry_segments_file(&entry.id)) {
                    Ok(bytes) => serde_json::from_slice::<Vec<SourceSegment>>(&bytes)
                        .map_err(|e| e.to_string()),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
                    Err(error) => Err(error.to_string()),
                };
                let reflow_available = segments.as_ref().is_ok_and(|segments| {
                    segments.iter().any(|segment| {
                        !segment.text.trim().is_empty()
                            || segment
                                .markdown
                                .as_ref()
                                .is_some_and(|text| !text.trim().is_empty())
                            || segment.asset_path.is_some()
                    })
                });
                let issue = if segments.is_err() {
                    Some("解析内容无法读取，可重试或重新解析".into())
                } else if !pdf_available && !reflow_available {
                    Some("没有可读的原 PDF 或解析内容".into())
                } else {
                    None
                };
                let mode = self
                    .read_reading_state(&entry.id)
                    .map(|saved| saved.state.mode)
                    .unwrap_or(ReadingMode::Pdf);
                let preferred_mode =
                    if !pdf_available || (mode == ReadingMode::Reflow && reflow_available) {
                        ReadingMode::Reflow
                    } else {
                        ReadingMode::Pdf
                    };
                Ok(TagReadingMember {
                    entry_id: entry.id,
                    title: entry.title,
                    pdf_available,
                    reflow_available,
                    preferred_mode,
                    issue,
                })
            })
            .collect()
    }
}

fn validate_state(state: &TagReadingWorkspace, tag_id: &TagId) -> Result<(), WorkspaceError> {
    validate_id(tag_id.as_str())?;
    if let Some(target) = &state.active_note {
        validate_id(target.note_id.as_str())?;
        match &target.owner {
            neuink_domain::NoteOwner::Entry { entry_id } => validate_id(entry_id.as_str())?,
            neuink_domain::NoteOwner::TagReading { tag_id: owner_id } => {
                if owner_id != tag_id {
                    return Err(WorkspaceError::TagReading("综合笔记不属于当前标签".into()));
                }
            }
        }
    }
    if state.version != 1 || state.tag_id != *tag_id {
        return Err(WorkspaceError::TagReading(
            "阅读状态格式不兼容，请保留文件并升级应用；未重置进度".into(),
        ));
    }
    if !state.split_ratio.is_finite()
        || !(0.2..=0.8).contains(&state.split_ratio)
        || state.member_states.len() > 100_000
    {
        return Err(WorkspaceError::TagReading(
            "阅读布局或成员状态超出范围".into(),
        ));
    }
    if state.active_entry_id.is_some() && state.active_entry_id == state.compare_entry_id {
        return Err(WorkspaceError::TagReading(
            "当前论文和对照论文不能相同".into(),
        ));
    }
    for id in state
        .member_states
        .keys()
        .chain(state.active_entry_id.iter())
        .chain(state.compare_entry_id.iter())
    {
        validate_id(id.as_str())?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "tag_reading_tests.rs"]
mod tests;
