use std::{collections::BTreeSet, fs};

use chrono::Utc;
use neuink_domain::{EntryId, EntryReadingState, ReadingState, ReadingStateUpdate};

use crate::{atomic_write_json, Workspace, WorkspaceError};

const MAX_ACTIVE_DELTA_MS: u64 = 5 * 60 * 1_000;

impl Workspace {
    pub fn read_reading_state(
        &self,
        entry_id: &EntryId,
    ) -> Result<EntryReadingState, WorkspaceError> {
        let entry = self.read_entry(entry_id)?;
        let path = self.layout().entry_reading_state_file(entry_id);
        let mut state = if path.exists() {
            serde_json::from_slice::<ReadingState>(&fs::read(path)?)?
        } else {
            ReadingState::default()
        };
        reconcile_document(
            &mut state,
            entry.pdf.as_ref().map(|pdf| pdf.content_hash.as_str()),
        );
        normalize_pages(&mut state);
        Ok(EntryReadingState {
            entry_id: entry_id.clone(),
            state,
        })
    }

    pub fn list_reading_states(&self) -> Result<Vec<EntryReadingState>, WorkspaceError> {
        self.list_entries()?
            .into_iter()
            .map(|entry| self.read_reading_state(&entry.id))
            .collect()
    }

    pub fn update_reading_state(
        &self,
        entry_id: &EntryId,
        update: ReadingStateUpdate,
    ) -> Result<EntryReadingState, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let entry = self.read_entry(entry_id)?;
        let path = self.layout().entry_reading_state_file(entry_id);
        let mut state = if path.exists() {
            serde_json::from_slice::<ReadingState>(&fs::read(&path)?)?
        } else {
            ReadingState::default()
        };

        reconcile_document(
            &mut state,
            entry.pdf.as_ref().map(|pdf| pdf.content_hash.as_str()),
        );
        state.mode = update.mode;
        state.page_count = update.page_count;
        state.current_page_idx = update
            .current_page_idx
            .filter(|page_idx| *page_idx < state.page_count);

        let mut visited = state.visited_pages.into_iter().collect::<BTreeSet<_>>();
        visited.extend(
            update
                .visited_pages
                .into_iter()
                .filter(|page_idx| *page_idx < state.page_count),
        );
        state.visited_pages = visited.into_iter().collect();

        let active_delta = update.active_ms_delta.min(MAX_ACTIVE_DELTA_MS);
        if active_delta > 0 {
            state.total_active_ms = state.total_active_ms.saturating_add(active_delta);
            if let Some(local_date) = update.local_date.filter(|value| valid_date_key(value)) {
                let daily = state.daily_active_ms.entry(local_date).or_default();
                *daily = daily.saturating_add(active_delta);
            }
        }
        if update.session_start {
            state.session_count = state.session_count.saturating_add(1);
        }
        if active_delta > 0 || state.current_page_idx.is_some() {
            state.last_read_at = Some(Utc::now());
        }
        normalize_pages(&mut state);
        atomic_write_json(path, &state)?;

        Ok(EntryReadingState {
            entry_id: entry_id.clone(),
            state,
        })
    }
}

fn reconcile_document(state: &mut ReadingState, content_hash: Option<&str>) {
    if state.document_hash.as_deref() == content_hash {
        return;
    }
    state.document_hash = content_hash.map(str::to_string);
    state.current_page_idx = None;
    state.page_count = 0;
    state.visited_pages.clear();
}

fn normalize_pages(state: &mut ReadingState) {
    state
        .visited_pages
        .retain(|page_idx| *page_idx < state.page_count);
    state.visited_pages.sort_unstable();
    state.visited_pages.dedup();
    if state
        .current_page_idx
        .is_some_and(|page_idx| page_idx >= state.page_count)
    {
        state.current_page_idx = None;
    }
}

fn valid_date_key(value: &str) -> bool {
    value.len() == 10
        && value
            .chars()
            .enumerate()
            .all(|(index, character)| match index {
                4 | 7 => character == '-',
                _ => character.is_ascii_digit(),
            })
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use neuink_domain::{ReadingMode, ReadingStateUpdate};

    use crate::Workspace;

    #[test]
    fn persists_and_accumulates_normalized_reading_state() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("neuink_reading_state_{suffix}"));
        let workspace = Workspace::create(&root).unwrap();
        let entry = workspace.create_entry("Reading state").unwrap();

        let saved = workspace
            .update_reading_state(
                &entry.id,
                ReadingStateUpdate {
                    mode: ReadingMode::Pdf,
                    current_page_idx: Some(4),
                    page_count: 5,
                    visited_pages: vec![4, 1, 1, 8],
                    active_ms_delta: 12_500,
                    session_start: true,
                    local_date: Some("2026-09-04".to_string()),
                },
            )
            .unwrap();

        assert_eq!(saved.state.current_page_idx, Some(4));
        assert_eq!(saved.state.visited_pages, vec![1, 4]);
        assert_eq!(saved.state.total_active_ms, 12_500);
        assert_eq!(saved.state.daily_active_ms["2026-09-04"], 12_500);
        assert_eq!(saved.state.session_count, 1);
        assert!(workspace
            .layout()
            .entry_reading_state_file(&entry.id)
            .is_file());

        let reopened = Workspace::open(&root).unwrap();
        assert_eq!(reopened.read_reading_state(&entry.id).unwrap(), saved);
        fs::remove_dir_all(root).unwrap();
    }
}
