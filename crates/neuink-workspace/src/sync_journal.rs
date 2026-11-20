//! Durable local publication events. No networking or credentials belong here.
use crate::{atomic_write_json, Workspace, WorkspaceError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, io::ErrorKind, path::PathBuf};

const BINDING_FILE: &str = "sync-binding.json";
const OUTBOX: &str = "sync-outbox";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceSyncBinding {
    pub server_id: String,
    pub account_id: String,
    pub library_id: String,
    pub epoch: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct LocalContentEvent {
    pub sequence: u64,
    pub event_id: String,
    pub binding: WorkspaceSyncBinding,
    /// Restricted ContentTarget values and before/after bytes from the recovery record.
    /// The network adapter must translate these into domain objects, not raw paths.
    pub transaction: Value,
}

impl LocalContentEvent {
    pub fn affected_entities(&self) -> Result<std::collections::BTreeSet<String>, WorkspaceError> {
        crate::content_transaction::sync_entity_keys(&self.transaction)
    }
}

fn failure(message: &str) -> WorkspaceError {
    WorkspaceError::ContentTransaction(message.into())
}
fn valid_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
impl WorkspaceSyncBinding {
    fn validate(&self) -> Result<(), WorkspaceError> {
        if [
            &self.server_id,
            &self.account_id,
            &self.library_id,
            &self.epoch,
        ]
        .into_iter()
        .all(|id| valid_id(id))
        {
            Ok(())
        } else {
            Err(failure("同步绑定标识无效"))
        }
    }
}

impl Workspace {
    pub(crate) fn next_content_sync_sequence(&self) -> Result<u64, WorkspaceError> {
        let current: u64 = match fs::read(self.sync_path("sync-sequence.json")?) {
            Ok(raw) => serde_json::from_slice(&raw)?,
            Err(error) if error.kind() == ErrorKind::NotFound => 0,
            Err(error) => return Err(error.into()),
        };
        current
            .checked_add(1)
            .ok_or_else(|| failure("本地同步序号已耗尽"))
    }
    fn sync_path(&self, name: &str) -> Result<PathBuf, WorkspaceError> {
        let path = self.layout().root().join(name);
        self.validate_note_workspace_path(&path)?;
        Ok(path)
    }
    pub fn sync_binding(&self) -> Result<Option<WorkspaceSyncBinding>, WorkspaceError> {
        match fs::read(self.sync_path(BINDING_FILE)?) {
            Ok(raw) => {
                let binding: WorkspaceSyncBinding = serde_json::from_slice(&raw)?;
                binding.validate()?;
                Ok(Some(binding))
            }
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }
    /// First binding only. Changing accounts/libraries needs a separate reconciliation flow.
    pub fn bind_sync(&self, binding: &WorkspaceSyncBinding) -> Result<(), WorkspaceError> {
        binding.validate()?;
        let _guard = self.begin_tag_safe_mutation()?;
        if let Some(current) = self.sync_binding()? {
            if current == *binding {
                return Ok(());
            }
            return Err(failure("资料库已绑定其他同步目标，请先完成迁移核对"));
        }
        let outbox = self.sync_path(OUTBOX)?;
        if outbox.exists() && fs::read_dir(outbox)?.next().is_some() {
            return Err(failure("仍有旧绑定的待同步记录，不能绑定新账号"));
        }
        atomic_write_json(self.sync_path(BINDING_FILE)?, binding)
    }
    pub(crate) fn publish_content_sync_event(
        &self,
        binding: &WorkspaceSyncBinding,
        raw: &[u8],
    ) -> Result<(), WorkspaceError> {
        binding.validate()?;
        if self.sync_binding()?.as_ref() != Some(binding) {
            return Err(failure("保存期间同步绑定已改变，恢复记录已保留"));
        }
        let transaction: Value = serde_json::from_slice(raw)?;
        let event_id = blake3::hash(&serde_json::to_vec(&transaction)?)
            .to_hex()
            .to_string();
        let directory = self.sync_path(OUTBOX)?;
        fs::create_dir_all(&directory)?;
        let path = directory.join(format!("{event_id}.json"));
        self.validate_note_workspace_path(&path)?;
        let sequence = transaction["sync_sequence"]
            .as_u64()
            .filter(|n| *n > 0)
            .ok_or_else(|| failure("本地同步序号无效"))?;
        let event = LocalContentEvent {
            sequence,
            event_id,
            binding: binding.clone(),
            transaction,
        };
        // Replaying the same recovery record produces the same ID and bytes.
        atomic_write_json(path, &event)?;
        atomic_write_json(self.sync_path("sync-sequence.json")?, &sequence)
    }
    pub fn pending_content_events(&self) -> Result<Vec<LocalContentEvent>, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let directory = self.sync_path(OUTBOX)?;
        let entries = match fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let binding = self.sync_binding()?;
        let mut events = Vec::new();
        for item in entries {
            let path = item?.path();
            if path.extension().and_then(|v| v.to_str()) != Some("json") {
                continue;
            }
            self.validate_note_workspace_path(&path)?;
            let event: LocalContentEvent = serde_json::from_slice(&fs::read(&path)?)?;
            let expected_id = blake3::hash(&serde_json::to_vec(&event.transaction)?)
                .to_hex()
                .to_string();
            if !valid_id(&event.event_id)
                || path.file_stem().and_then(|v| v.to_str()) != Some(event.event_id.as_str())
                || binding.as_ref() != Some(&event.binding)
                || expected_id != event.event_id
                || event.sequence == 0
                || event.transaction["sync_sequence"].as_u64() != Some(event.sequence)
                || event.transaction["sync_binding"] != serde_json::to_value(&event.binding)?
            {
                return Err(failure("待同步记录与资料库绑定不一致，已停止处理"));
            }
            events.push(event);
        }
        events.sort_by_key(|event| event.sequence);
        if events
            .windows(2)
            .any(|pair| pair[0].sequence == pair[1].sequence)
        {
            return Err(failure("待同步记录序号重复，已停止处理"));
        }
        Ok(events)
    }
    /// Only acknowledge after the adapter durably accepts the event.
    pub fn acknowledge_content_event(
        &self,
        binding: &WorkspaceSyncBinding,
        id: &str,
    ) -> Result<(), WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        if !valid_id(id) || self.sync_binding()?.as_ref() != Some(binding) {
            return Err(failure("不能确认其他账号或资料库的同步记录"));
        }
        let path = self.sync_path(OUTBOX)?.join(format!("{id}.json"));
        self.validate_note_workspace_path(&path)?;
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}
