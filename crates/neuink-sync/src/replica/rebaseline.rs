use super::*;
use std::collections::BTreeMap;

#[derive(Serialize)]
pub struct RebaselinePreview {
    pub token: String,
    pub remote_objects: usize,
    pub conflicts: usize,
    pub local_retained: usize,
    pub remote_applied: usize,
    pub epoch_changed: bool,
}
impl Replica {
    pub fn protocol_epoch(&self) -> Result<String> {
        self.db.query_row("SELECT COALESCE((SELECT epoch FROM protocol_epoch WHERE id=1),epoch) FROM identity WHERE id=1",[],|r|r.get(0)).map_err(error)
    }
    fn baseline_rows(&self) -> Result<Vec<(String, String, Option<String>, Option<String>)>> {
        let mut stmt = self
            .db
            .prepare("SELECT id,kind,content,base_content FROM documents ORDER BY id")
            .map_err(error)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(error)?;
        Ok(rows)
    }
    pub fn preview_rebaseline(
        &self,
        epoch: &str,
        revision: u64,
        snapshot: &[RemoteChange],
    ) -> Result<RebaselinePreview> {
        if epoch.len() != 64 || !epoch.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("服务器恢复标识无效".into());
        }
        let rows = self.baseline_rows()?;
        let mut remote = BTreeMap::new();
        for change in snapshot {
            if change.revision > revision
                || change.deleted != change.content.is_none()
                || remote.insert(change.object_id.clone(), change).is_some()
            {
                return Err("云端完整快照无效".into());
            }
        }
        let mut conflicts = 0;
        let mut local_retained = 0;
        let mut remote_applied = 0;
        for (id, kind, local, base) in &rows {
            if let Some(change) = remote.remove(id) {
                if encode(&change.kind)? != *kind {
                    return Err("重新核对时发现对象类型改变".into());
                }
                let incoming = change.content.as_ref().map(encode).transpose()?;
                if local == &incoming {
                } else if local == base {
                    remote_applied += 1;
                } else if incoming == *base {
                    local_retained += 1;
                } else {
                    conflicts += 1;
                }
            } else if local.is_some() {
                local_retained += 1;
            }
        }
        remote_applied += remote.values().filter(|r| r.content.is_some()).count();
        let token = blake3::hash(
            encode(&(
                self.protocol_epoch()?,
                self.cursor()?,
                &rows,
                epoch,
                revision,
                snapshot,
            ))?
            .as_bytes(),
        )
        .to_hex()
        .to_string();
        Ok(RebaselinePreview {
            token,
            remote_objects: snapshot.len(),
            conflicts,
            local_retained,
            remote_applied,
            epoch_changed: self.protocol_epoch()? != epoch,
        })
    }
    pub fn accept_rebaseline(
        &mut self,
        epoch: &str,
        revision: u64,
        snapshot: &[RemoteChange],
        token: &str,
    ) -> Result<()> {
        if self.preview_rebaseline(epoch, revision, snapshot)?.token != token {
            return Err("本地或云端内容已变化，请重新核对".into());
        }
        let rows = self.baseline_rows()?;
        let remote: BTreeMap<_, _> = snapshot.iter().map(|c| (c.object_id.as_str(), c)).collect();
        let tx = self.db.transaction().map_err(error)?;
        // Preserve the previous baseline and all in-flight operation IDs before rebuilding.
        let outbox: Vec<String> = {
            let mut stmt = tx
                .prepare("SELECT payload FROM outbox ORDER BY id")
                .map_err(error)?;
            let values = stmt
                .query_map([], |r| r.get(0))
                .map_err(error)?
                .collect::<std::result::Result<_, _>>()
                .map_err(error)?;
            values
        };
        tx.execute(
            "INSERT OR IGNORE INTO rebaseline_archive(token,payload) VALUES(?1,?2)",
            params![token, encode(&(&rows, outbox))?],
        )
        .map_err(error)?;
        tx.execute("DELETE FROM outbox", []).map_err(error)?;
        tx.execute("DELETE FROM conflicts", []).map_err(error)?;
        for (id, _, local, base) in &rows {
            if let Some(change) = remote.get(id.as_str()) {
                let incoming = change.content.as_ref().map(encode).transpose()?;
                if local != base && incoming != *base && local != &incoming {
                    tx.execute(
                        "INSERT INTO conflicts(id,remote) VALUES(?1,?2)",
                        params![id, encode(change)?],
                    )
                    .map_err(error)?;
                    // Keep original base for the three-way comparison.
                    tx.execute(
                        "UPDATE documents SET revision=?1,dirty=1 WHERE id=?2",
                        params![change.revision, id],
                    )
                    .map_err(error)?;
                } else {
                    let chosen = if local == base { &incoming } else { local };
                    tx.execute("UPDATE documents SET content=?1,base_content=?2,revision=?3,dirty=?4 WHERE id=?5",params![chosen,incoming,change.revision,chosen!=&incoming,id]).map_err(error)?;
                }
            } else {
                // Server rollback/omission never implies a local user deletion.
                tx.execute("UPDATE documents SET base_content=NULL,revision=NULL,dirty=CASE WHEN content IS NULL THEN 0 ELSE 1 END WHERE id=?1",[id]).map_err(error)?;
            }
        }
        for change in snapshot {
            tx.execute("INSERT OR IGNORE INTO documents(id,kind,content,base_content,revision,dirty) VALUES(?1,?2,?3,?3,?4,0)",params![change.object_id,encode(&change.kind)?,change.content.as_ref().map(encode).transpose()?,change.revision]).map_err(error)?;
        }
        tx.execute("INSERT INTO protocol_epoch(id,epoch) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET epoch=?1",[epoch]).map_err(error)?;
        tx.execute("UPDATE identity SET cursor=?1 WHERE id=1", [revision])
            .map_err(error)?;
        tx.commit().map_err(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn rebaseline_uses_the_new_epoch_for_operation_idempotency() {
        let dir=tempfile::tempdir().unwrap();let binding=Binding{server_id:"1".repeat(64),account_id:"2".repeat(64),library_id:"3".repeat(64)};
        let mut replica=Replica::open(&dir.path().join("replica.sqlite"),&binding,&"4".repeat(64)).unwrap();
        replica.edit("note:a",ObjectKind::Note,Some(&json!({"body":"Saved after backup"}))).unwrap();let original=replica.pending().unwrap()[0].operation_id.clone();
        let epoch="5".repeat(64);let preview=replica.preview_rebaseline(&epoch,0,&[]).unwrap();replica.accept_rebaseline(&epoch,0,&[],&preview.token).unwrap();
        assert_ne!(original,replica.pending().unwrap()[0].operation_id);
    }
    #[test]
    fn restored_server_keeps_edits_rebuilds_missing_and_rejects_stale_confirmation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("replica.sqlite");
        let binding = Binding {
            server_id: "a".repeat(64),
            account_id: "b".repeat(64),
            library_id: "c".repeat(64),
        };
        let old = "d".repeat(64);
        let new = "e".repeat(64);
        let mut replica = Replica::open(&path, &binding, &old).unwrap();
        for id in ["note:conflict", "note:missing", "note:remote"] {
            replica
                .edit(id, ObjectKind::Note, Some(&json!({"text":"base"})))
                .unwrap();
        }
        for (i, op) in replica.pending().unwrap().iter().enumerate() {
            replica
                .acknowledge(&op.operation_id, (i + 1) as u64)
                .unwrap();
        }
        replica
            .edit(
                "note:conflict",
                ObjectKind::Note,
                Some(&json!({"text":"local"})),
            )
            .unwrap();
        let remote = vec![
            RemoteChange {
                object_id: "note:conflict".into(),
                kind: ObjectKind::Note,
                content: Some(json!({"text":"remote"})),
                deleted: false,
                revision: 1,
            },
            RemoteChange {
                object_id: "note:remote".into(),
                kind: ObjectKind::Note,
                content: Some(json!({"text":"remote"})),
                deleted: false,
                revision: 2,
            },
        ];
        let preview = replica.preview_rebaseline(&new, 2, &remote).unwrap();
        assert_eq!(preview.conflicts, 1);
        assert_eq!(preview.local_retained, 1);
        assert_eq!(preview.remote_applied, 1);
        replica
            .edit(
                "note:missing",
                ObjectKind::Note,
                Some(&json!({"text":"new save"})),
            )
            .unwrap();
        assert!(replica
            .accept_rebaseline(&new, 2, &remote, &preview.token)
            .is_err());
        assert_eq!(replica.protocol_epoch().unwrap(), old);
        let preview = replica.preview_rebaseline(&new, 2, &remote).unwrap();
        replica
            .accept_rebaseline(&new, 2, &remote, &preview.token)
            .unwrap();
        drop(replica);
        let mut replica = Replica::open(&path, &binding, &old).unwrap();
        assert_eq!(replica.protocol_epoch().unwrap(), new);
        assert_eq!(
            replica.content("note:conflict").unwrap(),
            Some(json!({"text":"local"}))
        );
        assert_eq!(replica.conflicts().unwrap().len(), 1);
        assert_eq!(
            replica.content("note:remote").unwrap(),
            Some(json!({"text":"remote"}))
        );
        let pending = replica.pending().unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].object_id, "note:missing");
        assert_eq!(pending[0].base_revision, None);
    }
}
