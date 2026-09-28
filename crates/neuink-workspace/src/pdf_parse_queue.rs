//! Parse metadata is the queue's source of truth; this file only persists waiting order.
use std::{collections::HashMap, fs, path::PathBuf};

use chrono::Utc;
use neuink_domain::{EntryId, EntryMeta, PdfParseState, PdfParseStatus};
use serde::{Deserialize, Serialize};

use crate::{atomic_write_json, Workspace, WorkspaceError};

#[derive(Debug, Serialize)]
pub struct PdfParseQueue {
    pub waiting: Vec<EntryMeta>,
    pub active: Vec<EntryMeta>,
    pub failed: Vec<EntryMeta>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParseQueueMove {
    First,
    Up,
    Down,
    Remove,
}

impl Workspace {
    fn parse_order_path(&self) -> PathBuf {
        self.layout().root().join("pdf-parse-order.json")
    }

    pub fn read_pdf_parse_queue(&self) -> Result<PdfParseQueue, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        self.pdf_parse_queue_unlocked()
    }

    fn pdf_parse_queue_unlocked(&self) -> Result<PdfParseQueue, WorkspaceError> {
        let order: Vec<EntryId> = match fs::read(self.parse_order_path()) {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e.into()),
        };
        let mut queue = PdfParseQueue {
            waiting: vec![],
            active: vec![],
            failed: vec![],
        };
        for entry in self.list_entries()? {
            match entry.pdf.as_ref().map(|pdf| pdf.parse.status) {
                Some(PdfParseStatus::Queued) => queue.waiting.push(entry),
                Some(
                    PdfParseStatus::Uploading | PdfParseStatus::Uploaded | PdfParseStatus::Parsing,
                ) => queue.active.push(entry),
                Some(PdfParseStatus::Failed) => queue.failed.push(entry),
                _ => {}
            }
        }
        let positions: HashMap<_, _> = order
            .iter()
            .enumerate()
            .map(|(index, id)| (id, index))
            .collect();
        queue.waiting.sort_by_cached_key(|entry| {
            (
                positions.get(&entry.id).copied().unwrap_or(usize::MAX),
                entry
                    .pdf
                    .as_ref()
                    .map(|pdf| pdf.parse.updated_at)
                    .unwrap_or(entry.created_at),
                entry.id.to_string(),
            )
        });
        Ok(queue)
    }

    /// Idempotent enqueue, including downloaded PDFs which have never been parsed.
    pub fn enqueue_pdf_parse(&self, id: &EntryId) -> Result<EntryMeta, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let entry = self.read_entry(id)?;
        let status = entry
            .pdf
            .as_ref()
            .ok_or_else(|| WorkspaceError::PdfMissing(id.to_string()))?
            .parse
            .status;
        if matches!(
            status,
            PdfParseStatus::Queued
                | PdfParseStatus::Uploading
                | PdfParseStatus::Uploaded
                | PdfParseStatus::Parsing
        ) {
            return Ok(entry);
        }
        // Remove obsolete ordering before re-enqueueing a previously completed item.
        let order: Vec<_> = self
            .pdf_parse_queue_unlocked()?
            .waiting
            .into_iter()
            .map(|e| e.id)
            .collect();
        atomic_write_json(self.parse_order_path(), &order)?;
        self.write_parse_queue_status(entry, PdfParseStatus::Queued, None)
    }

    pub fn move_pdf_parse(
        &self,
        id: &EntryId,
        movement: ParseQueueMove,
    ) -> Result<PdfParseQueue, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let mut queue = self.pdf_parse_queue_unlocked()?;
        let index = queue
            .waiting
            .iter()
            .position(|e| &e.id == id)
            .ok_or_else(|| {
                WorkspaceError::PdfQueue("任务已开始或已移出队列，请刷新后重试".into())
            })?;
        let entry = queue.waiting.remove(index);
        match movement {
            ParseQueueMove::Remove => {
                self.write_parse_queue_status(
                    entry,
                    PdfParseStatus::Canceled,
                    Some("已移出等待队列".into()),
                )?;
            }
            ParseQueueMove::First => queue.waiting.insert(0, entry),
            ParseQueueMove::Up => queue.waiting.insert(index.saturating_sub(1), entry),
            ParseQueueMove::Down => {
                let next = (index + 1).min(queue.waiting.len());
                queue.waiting.insert(next, entry);
            }
        }
        let order: Vec<_> = queue.waiting.iter().map(|e| &e.id).collect();
        atomic_write_json(self.parse_order_path(), &order)?;
        Ok(queue)
    }

    /// Claim and state transition share the metadata lock: two windows cannot submit twice.
    pub fn claim_next_pdf_parse(&self) -> Result<Option<EntryMeta>, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let queue = self.pdf_parse_queue_unlocked()?;
        if !queue.active.is_empty() {
            return Ok(None);
        }
        queue
            .waiting
            .into_iter()
            .next()
            .map(|entry| self.write_parse_queue_status(entry, PdfParseStatus::Uploading, None))
            .transpose()
    }

    fn write_parse_queue_status(
        &self,
        mut entry: EntryMeta,
        status: PdfParseStatus,
        message: Option<String>,
    ) -> Result<EntryMeta, WorkspaceError> {
        let parse = &mut entry
            .pdf
            .as_mut()
            .ok_or_else(|| WorkspaceError::PdfMissing(entry.id.to_string()))?
            .parse;
        if !PdfParseState::can_transition(parse.status, status) {
            return Err(WorkspaceError::InvalidPdfParseTransition(format!(
                "{:?} -> {:?}",
                parse.status, status
            )));
        }
        *parse = PdfParseState {
            status,
            updated_at: Utc::now(),
            message,
            task_id: None,
            endpoint: None,
        };
        entry.updated_at = Utc::now();
        atomic_write_json(self.layout().entry_meta_file(&entry.id), &entry)?;
        Ok(entry)
    }
}
