//! Recovery record for child recycle-bin writes and note/asset moves.
use super::{StoredTrashRecord, Workspace};
use crate::{atomic_write_json, sync_journal::WorkspaceSyncBinding, WorkspaceError};
use neuink_domain::EntryId;
use neuink_sync_protocol::document::EntityDocument;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};
const JOURNAL: &str = "child-trash.journal.json";

pub(crate) struct Plan {
    pub entry: EntryId,
    pub entity: String,
    pub restored: bool,
    pub writes: Vec<(PathBuf, Vec<u8>)>,
    pub moves: Vec<(PathBuf, PathBuf)>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Write {
    path: String,
    before: Option<String>,
    after: Vec<u8>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Move {
    source: String,
    target: String,
    files: BTreeMap<String, String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChildEvent {
    pub version: u16,
    pub sequence: u64,
    pub event_id: String,
    pub entry_id: EntryId,
    pub entity_id: String,
    pub restored: bool,
    pub binding: Option<WorkspaceSyncBinding>,
    pub documents: Vec<EntityDocument>,
    pub issue: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    event: ChildEvent,
    writes: Vec<Write>,
    moves: Vec<Move>,
}
fn failure(message: &str) -> WorkspaceError {
    WorkspaceError::ContentTransaction(message.into())
}
fn hash(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}
fn current(path: &Path) -> Result<Option<String>, WorkspaceError> {
    Ok(crate::sync_export::files::fingerprint(path)?.map(|(hash, _)| hash))
}
fn inventory(path: &Path) -> Result<BTreeMap<String, String>, WorkspaceError> {
    fn visit(
        base: &Path,
        path: &Path,
        result: &mut BTreeMap<String, String>,
    ) -> Result<(), WorkspaceError> {
        let metadata = fs::symlink_metadata(path)?;
        if metadata.file_type().is_symlink() {
            return Err(failure("回收站操作拒绝链接"));
        }
        let name = path
            .strip_prefix(base)
            .map_err(|_| failure("回收站路径越界"))?
            .to_string_lossy()
            .replace('\\', "/");
        if metadata.is_dir() {
            result.insert(format!("{name}/"), String::new());
            for item in fs::read_dir(path)? {
                visit(base, &item?.path(), result)?;
            }
        } else if metadata.is_file() {
            result.insert(
                name,
                current(path)?.ok_or_else(|| failure("回收站源文件缺失"))?,
            );
        } else {
            return Err(failure("回收站源不是普通文件"));
        }
        Ok(())
    }
    let mut result = BTreeMap::new();
    visit(path, path, &mut result)?;
    Ok(result)
}
impl Workspace {
    fn child_path(&self, relative: &str) -> Result<PathBuf, WorkspaceError> {
        Ok(crate::sync_export::files::safe_path(
            &self.layout().root().canonicalize()?,
            relative,
        )?)
    }
    fn child_relative(&self, path: &Path) -> Result<String, WorkspaceError> {
        // Plans use layout paths; validation below canonicalizes every component.
        let value = path
            .strip_prefix(self.layout().root())
            .map_err(|_| failure("回收站目标越界"))?
            .to_string_lossy()
            .replace('\\', "/");
        self.child_path(&value)?;
        Ok(value)
    }
    pub(crate) fn commit_child_trash(&self, plan: Plan) -> Result<(), WorkspaceError> {
        let counter = self.child_path("child-lifecycle-sequence.json")?;
        let previous: u64 = match fs::read(&counter) {
            Ok(raw) => serde_json::from_slice(&raw)?,
            Err(e) if e.kind() == ErrorKind::NotFound => 0,
            Err(e) => return Err(e.into()),
        };
        let sequence = previous
            .checked_add(1)
            .ok_or_else(|| failure("回收站事件序号已耗尽"))?;
        atomic_write_json(counter, &sequence)?;
        let mut event = ChildEvent {
            version: 1,
            sequence,
            event_id: EntryId::new().to_string(),
            entry_id: plan.entry,
            entity_id: plan.entity,
            restored: plan.restored,
            binding: self.sync_binding()?,
            documents: Vec::new(),
            issue: None,
        };
        if !event.restored {
            if let Some(binding) = &event.binding {
                match crate::sync_export::export_entry_locked(
                    self.layout().root(),
                    event.entry_id.as_str(),
                ) {
                    Ok(bundle) => match self.stage_sync_bundle_locked(binding, &bundle) {
                        Ok(()) => {
                            event.documents = bundle
                                .manifest()
                                .documents
                                .iter()
                                .filter(|d| {
                                    d.entity_id == event.entity_id
                                        || (event.entity_id.starts_with("note:")
                                            && d.entity_id == format!("entry:{}", event.entry_id))
                                })
                                .cloned()
                                .collect()
                        }
                        Err(_) => {
                            event.issue =
                                Some("删除前内容暂存失败，已保留回收站，云端删除等待处理".into())
                        }
                    },
                    Err(_) => {
                        event.issue = Some(
                            "删除前内容未通过完整性检查，已保留回收站，云端删除等待处理".into(),
                        )
                    }
                }
            }
        }
        let mut writes = Vec::new();
        for (path, after) in plan.writes {
            writes.push(Write {
                path: self.child_relative(&path)?,
                before: current(&path)?,
                after,
            });
        }
        for doc in &event.documents {
            let path = format!(
                "entries/{}/.trash/sync/{}.json",
                event.entry_id,
                blake3::hash(doc.entity_id.as_bytes()).to_hex()
            );
            writes.push(Write {
                before: current(&self.child_path(&path)?)?,
                path,
                after: serde_json::to_vec(doc)?,
            });
        }
        let mut moves = Vec::new();
        for (source, target) in plan.moves {
            if source.exists() {
                if target.exists() {
                    let name = target
                        .file_name()
                        .and_then(|n| n.to_str())
                        .ok_or_else(|| failure("回收站文件名无效"))?;
                    let archive = self
                        .layout()
                        .entry_trash_dir(&event.entry_id)
                        .join("history")
                        .join(&event.event_id)
                        .join(name);
                    moves.push(Move {
                        source: self.child_relative(&target)?,
                        target: self.child_relative(&archive)?,
                        files: inventory(&target)?,
                    });
                }
                moves.push(Move {
                    source: self.child_relative(&source)?,
                    target: self.child_relative(&target)?,
                    files: inventory(&source)?,
                });
            }
        }
        let journal = Journal {
            event,
            writes,
            moves,
        };
        let path = self.child_path(JOURNAL)?;
        if path.exists() {
            return Err(failure("仍有回收站操作待恢复"));
        }
        self.validate_child_trash(&journal)?;
        atomic_write_json(path, &journal)?;
        self.recover_child_trash()
    }
    fn validate_child_trash(&self, journal: &Journal) -> Result<(), WorkspaceError> {
        let event = &journal.event;
        crate::tag_reading::validate_id(event.entry_id.as_str())?;
        crate::tag_reading::validate_id(&event.event_id)?;
        if event.version != 1
            || event.sequence == 0
            || event.binding != self.sync_binding()?
            || journal.writes.is_empty()
        {
            return Err(failure("回收站记录版本或同步绑定不一致"));
        }
        let prefix = format!("entries/{}/", event.entry_id);
        let allowed = |path: &str| {
            path.strip_prefix(&prefix).is_some_and(|tail| {
                matches!(
                    tail,
                    "entry.meta.json"
                        | "paper.annotations.json"
                        | "segment-notes.json"
                        | ".trash/items.json"
                ) || tail
                    .strip_prefix(".trash/sync/")
                    .and_then(|s| s.strip_suffix(".json"))
                    .is_some_and(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit()))
            })
        };
        if journal.writes.len() > 4 || journal.moves.len() > 6 {
            return Err(failure("回收站恢复记录超出范围"));
        }
        let mut seen = std::collections::BTreeSet::new();
        for write in &journal.writes {
            if !allowed(&write.path) || !seen.insert(write.path.to_lowercase()) {
                return Err(failure("回收站记录包含重复或越界目标"));
            }
            let current = current(&self.child_path(&write.path)?)?;
            if current != write.before && current != Some(hash(&write.after)) {
                return Err(failure("回收站恢复遇到新修改，原文件及恢复记录均已保留"));
            }
        }
        let mut sources = std::collections::BTreeSet::new();
        for movement in &journal.moves {
            let note = event
                .entity_id
                .strip_prefix("note:")
                .ok_or_else(|| failure("非笔记实体不能移动笔记文件"))?;
            crate::tag_reading::validate_id(note)?;
            let pairs = ["md", "links.json", "assets"].map(|extension| {
                (
                    format!("{prefix}notes/{note}.{extension}"),
                    format!("{prefix}.trash/notes/{note}.{extension}"),
                )
            });
            let archive_prefix = format!("{prefix}.trash/history/{}/", event.event_id);
            let archiving = movement
                .target
                .strip_prefix(&archive_prefix)
                .is_some_and(|name| {
                    pairs.iter().any(|(active, trash)| {
                        (movement.source == *active || movement.source == *trash)
                            && active.rsplit('/').next() == Some(name)
                    })
                });
            let valid = archiving
                || pairs.iter().any(|(active, trash)| {
                    if event.restored {
                        &movement.source == trash && &movement.target == active
                    } else {
                        &movement.source == active && &movement.target == trash
                    }
                });
            if !valid
                || movement.source == movement.target
                || !sources.insert(movement.source.to_lowercase())
                || !seen.insert(movement.target.to_lowercase())
            {
                return Err(failure("回收站移动路径无效"));
            }
            let source = self.child_path(&movement.source)?;
            let target = self.child_path(&movement.target)?;
            if source.exists() && target.exists() {
                let source_files = inventory(&source)?;
                let target_files = inventory(&target)?;
                let completed = target_files == movement.files
                    && journal.moves.iter().any(|other| {
                        other.target == movement.source && other.files == source_files
                    });
                let awaiting = source_files == movement.files
                    && journal.moves.iter().any(|other| {
                        other.source == movement.target && other.files == target_files
                    });
                if !completed && !awaiting {
                    return Err(failure("回收站存在同名内容，未覆盖任何一方"));
                }
            } else {
                let path = if source.exists() { source } else { target };
                if !path.exists() || inventory(&path)? != movement.files {
                    return Err(failure("回收站移动内容已变化，操作记录已保留"));
                }
            }
        }
        Ok(())
    }
    pub(crate) fn recover_child_trash(&self) -> Result<(), WorkspaceError> {
        let path = self.child_path(JOURNAL)?;
        let raw = match fs::read(&path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e.into()),
        };
        let journal: Journal = serde_json::from_slice(&raw)?;
        self.validate_child_trash(&journal)?;
        for movement in &journal.moves {
            let source = self.child_path(&movement.source)?;
            let target = self.child_path(&movement.target)?;
            if target.exists() && inventory(&target)? == movement.files {
                continue;
            }
            if source.exists() {
                fs::create_dir_all(target.parent().ok_or_else(|| failure("回收站目录无效"))?)?;
                fs::rename(source, target)?;
            }
        }
        for write in &journal.writes {
            let target = self.child_path(&write.path)?;
            let actual = current(&target)?;
            if actual == Some(hash(&write.after)) {
                continue;
            }
            if actual != write.before {
                return Err(failure("回收站保存遇到新修改，已停止覆盖"));
            }
            crate::atomic_write(target, &write.after)?;
        }
        if journal.event.binding.is_some() {
            atomic_write_json(
                self.child_path(&format!(
                    "sync-child-lifecycle/{}.json",
                    journal.event.event_id
                ))?,
                &journal.event,
            )?;
        }
        fs::remove_file(path)?;
        Ok(())
    }
}

pub(super) fn records_bytes(records: &[StoredTrashRecord]) -> Result<Vec<u8>, WorkspaceError> {
    Ok(serde_json::to_vec_pretty(records)?)
}

#[cfg(test)]
#[path = "trash_transaction_tests.rs"]
mod tests;

#[path = "trash_events.rs"]
mod events;
