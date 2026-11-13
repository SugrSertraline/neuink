use super::{observe::Observation, wire};
use crate::replica::Replica;
use neuink_sync_protocol::document::EntityDocument;
use neuink_workspace::{
    entry_lifecycle::{EntryLifecycleAction, EntryLifecycleEvent},
    sync_journal::WorkspaceSyncBinding,
    Workspace,
};
use std::collections::{BTreeMap, BTreeSet};

pub(super) struct Lifecycle {
    events: Vec<EntryLifecycleEvent>,
    deleting: BTreeSet<String>,
    blocked: BTreeSet<String>,
}
impl Lifecycle {
    pub fn load(
        workspace: &Workspace,
        binding: &WorkspaceSyncBinding,
        replica: &Replica,
        documents: &mut BTreeMap<String, EntityDocument>,
        scan: &mut Observation,
    ) -> Result<Self, String> {
        let all = workspace
            .pending_entry_lifecycle_events()
            .map_err(|e| e.to_string())?;
        let child_owners: BTreeSet<_> = workspace
            .pending_child_lifecycle_events()
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|e| e.entry_id.to_string())
            .collect();
        let mut latest = BTreeMap::new();
        for event in &all {
        if replica.lifecycle_resolved(&event.event_id)? {
            workspace.acknowledge_entry_lifecycle_event(binding,&event.event_id).map_err(|e|e.to_string())?;
            continue;
        }

            latest.insert(event.entry_id.to_string(), event);
        }
        let mut state = Self {
            events: Vec::new(),
            deleting: BTreeSet::new(),
            blocked: BTreeSet::new(),
        };
        for (entry, event) in latest {
            if event.action == EntryLifecycleAction::Restore {
                // The local restore is explicit. Normal observation retains any
                // in-flight old operation until its acknowledgement, then restores.
                if documents.contains_key(&format!("entry:{entry}")) {
                    for older in all.iter().filter(|e| e.entry_id == event.entry_id) {
                        workspace
                            .acknowledge_entry_lifecycle_event(binding, &older.event_id)
                            .map_err(|e| e.to_string())?;
                    }
                }
                continue;
            }
            if workspace.layout().entry_dir(&event.entry_id).exists() {
                state.blocked.insert(entry.clone());
                scan.failures.push((
                    entry,
                    "删除意图与当前目录不一致，请显式恢复或处理冲突".into(),
                ));
                continue;
            }
            if let Some(issue) = &event.snapshot_issue {
                state.blocked.insert(entry.clone());
                scan.failures.push((entry, issue.clone()));
                continue;
            }
            if event.documents.is_empty() {
                state.blocked.insert(entry.clone());
                scan.failures
                    .push((entry, "删除前快照缺失，未发布云端删除".into()));
                continue;
            }
            let deleting = replica.lifecycle_deleting(&event.event_id)?;
            for document in &event.documents {
                if deleting {
                    state.deleting.insert(document.entity_id.clone());
                } else {
                    if documents
                        .insert(document.entity_id.clone(), document.clone())
                        .is_some()
                    {
                        return Err("删除快照与其他条目的实体标识冲突".into());
                    }
                }
            }
            // Finish explicit child trash operations against the frozen parent
            // before deleting that parent. Otherwise the catalog snapshots race.
            if !deleting && child_owners.contains(&entry) {
                continue;
            }
            state.events.push(event.clone());
        }
        Ok(state)
    }

    pub fn observe_deletions(
        &mut self,
        workspace: &Workspace,
        binding: &WorkspaceSyncBinding,
        replica: &mut Replica,
        scan: &mut Observation,
    ) -> Result<(), String> {
        let conflicts = replica
            .conflicts()?
            .into_iter()
            .map(|c| c.object_id)
            .collect::<BTreeSet<_>>();
        for event in &self.events {
            let has_conflict = event
                .documents
                .iter()
                .any(|d| conflicts.contains(&d.entity_id));
            if has_conflict {
                self.blocked.insert(event.entry_id.to_string());
            }
            let mut deleting = replica.lifecycle_deleting(&event.event_id)?;
            if !deleting && !has_conflict {
                let mut settled = true;
                for document in &event.documents {
                    settled &= replica
                        .settled_content(&document.entity_id, Some(&wire::encode(document)?))?;
                }
                if settled {
                    replica.begin_lifecycle_delete(&event.event_id)?;
                    deleting = true;
                }
            }
            if deleting {
                for document in &event.documents {
                    replica.observe_workspace(&document.entity_id, document.kind.clone(), None)?;
                    self.deleting.insert(document.entity_id.clone());
                    if !has_conflict {
                        scan.ready.insert(document.entity_id.clone());
                    }
                }
                let mut settled = true;
                for document in &event.documents {
                    settled &= replica.settled_content(&document.entity_id, None)?;
                }
                if settled {
                    for older in workspace
                        .pending_entry_lifecycle_events()
                        .map_err(|e| e.to_string())?
                        .into_iter()
                        .filter(|older| {
                            older.entry_id == event.entry_id && older.sequence <= event.sequence
                        })
                    {
                        workspace
                            .acknowledge_entry_lifecycle_event(binding, &older.event_id)
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
            if has_conflict {
                for document in &event.documents {
                    scan.ready.remove(&document.entity_id);
                }
                scan.failures.push((
                    event.entry_id.to_string(),
                    "删除与云端修改冲突，已保留删除前快照及回收站资料".into(),
                ));
            }
        }
        Ok(())
    }
    pub fn owns_absence(&self, id: &str, owner: &str) -> bool {
        self.deleting.contains(id) || self.blocked.contains(owner)
    }
    pub fn blocked_owners(&self) -> &BTreeSet<String> {
        &self.blocked
    }
}
