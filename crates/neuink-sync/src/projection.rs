//! Crash-safe handoff between the network replica and actual workspace files.
use super::*;

#[derive(Debug, Serialize)]
pub struct Projection {
    pub object_id: String,
    pub expected: Option<Value>,
    pub target: Option<Value>,
    pub token: String,
}

fn decode(raw: Option<String>) -> Result<Option<Value>> {
    raw.map(|value| serde_json::from_str(&value).map_err(error))
        .transpose()
}
fn projection(db: &Connection, id: &str) -> Result<Projection> {
    let (expected, target, revision): (Option<String>, Option<String>, Option<u64>) = db.query_row(
        "SELECT p.observed,d.content,d.revision FROM documents d LEFT JOIN workspace_projection p ON p.object_id=d.id WHERE d.id=? AND NOT EXISTS(SELECT 1 FROM conflicts c WHERE c.id=d.id)",
        [id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).map_err(error)?;
    let token = blake3::hash(encode(&(id, &expected, &target, revision))?.as_bytes())
        .to_hex()
        .to_string();
    Ok(Projection {
        object_id: id.into(),
        expected: decode(expected)?,
        target: decode(target)?,
        token,
    })
}

impl Replica {
    /// Previously published local observations, used to distinguish a deletion
    /// from a new remote object that has not yet reached the workspace.
    pub fn observed_workspace_documents(&self) -> Result<Vec<(String, Value)>> {
        let mut stmt = self.db.prepare("SELECT object_id,observed FROM workspace_projection WHERE observed IS NOT NULL AND object_id IN(SELECT id FROM syncable_documents) ORDER BY object_id").map_err(error)?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(error)?;
        rows.into_iter()
            .map(|(id, value)| Ok((id, serde_json::from_str(&value).map_err(error)?)))
            .collect()
    }

    /// Observe local files before upload and again before applying downloaded changes.
    /// An edit during network I/O must become a conflict, never a silent rebase.
    pub fn observe_workspace(
        &mut self,
        id: &str,
        kind: ObjectKind,
        value: Option<&Value>,
    ) -> Result<()> {
        if id.is_empty() {
            return Err("对象标识为空".into());
        }
        let tx = self.db.transaction().map_err(error)?;
        let observed = value.map(encode).transpose()?;
        let previous: Option<String> = tx
            .query_row(
                "SELECT observed FROM workspace_projection WHERE object_id=?",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(error)?
            .flatten();
        let current: Option<(String, Option<String>, Option<u64>, bool)> = tx
            .query_row(
                "SELECT kind,content,revision,dirty FROM documents WHERE id=?",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(error)?;
        let encoded_kind = encode(&kind)?;
        if let Some((stored_kind, _, _, _)) = &current {
            if *stored_kind != encoded_kind {
                return Err("对象类型不能改变".into());
            }
        }
        if observed != previous {
            if let Some((_, remote, revision, dirty)) = &current {
                if observed != *remote {
                    if !dirty && *remote != previous {
                        let revision = revision.ok_or("远端内容缺少版本，已停止应用")?;
                        let remote_change = RemoteChange {
                            object_id: id.into(),
                            kind,
                            content: decode(remote.clone())?,
                            deleted: remote.is_none(),
                            revision,
                        };
                        tx.execute("INSERT INTO conflicts(id,remote) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET remote=?2",params![id,encode(&remote_change)?]).map_err(error)?;
                        tx.execute(
                            "UPDATE documents SET base_content=? WHERE id=?",
                            params![previous, id],
                        )
                        .map_err(error)?;
                    }
                    tx.execute(
                        "UPDATE documents SET content=?,dirty=1 WHERE id=?",
                        params![observed, id],
                    )
                    .map_err(error)?;
                }
            } else if observed.is_some() {
                tx.execute(
                    "INSERT INTO documents(id,kind,content,dirty) VALUES(?,?,?,1)",
                    params![id, encoded_kind, observed],
                )
                .map_err(error)?;
            }
        }
        tx.execute("INSERT INTO workspace_projection(object_id,observed) VALUES(?,?) ON CONFLICT(object_id) DO UPDATE SET observed=EXCLUDED.observed",params![id,observed]).map_err(error)?;
        tx.commit().map_err(error)
    }

    /// Return only a bounded batch. Conflicted documents cannot be applied.
    pub fn pending_projections(&self) -> Result<Vec<Projection>> {
        self.pending_projections_limit(4)
    }

    pub fn pending_projections_limit(&self, limit: usize) -> Result<Vec<Projection>> {
        if limit == 0 || limit > 10000 {
            return Err("入站批次大小无效".into());
        }
        let mut stmt=self.db.prepare("SELECT d.id FROM syncable_documents d LEFT JOIN workspace_projection p ON p.object_id=d.id WHERE d.content IS NOT p.observed AND NOT EXISTS(SELECT 1 FROM conflicts c WHERE c.id=d.id) ORDER BY d.id LIMIT ?").map_err(error)?;
        let ids = stmt
            .query_map([limit], |row| row.get::<_, String>(0))
            .map_err(error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(error)?;
        ids.into_iter()
            .map(|id| projection(&self.db, &id))
            .collect()
    }

    pub fn acknowledge_projection_group(&mut self, items: &[(String, String)]) -> Result<()> {
        let tx = self.db.transaction().map_err(error)?;
        for (id, token) in items {
            let current = projection(&tx, id)?;
            if &current.token != token {
                return Err("同步组已改变，未确认部分删除".into());
            }
            tx.execute("INSERT INTO workspace_projection(object_id,observed) VALUES(?,?) ON CONFLICT(object_id) DO UPDATE SET observed=EXCLUDED.observed",params![id,current.target.as_ref().map(encode).transpose()?]).map_err(error)?;
        }
        tx.commit().map_err(error)
    }

    /// Call only after a workspace compare-and-swap has durably applied the target.
    /// If the process dies first, observe_workspace recognizes the already-applied content.
    pub fn acknowledge_projection(&mut self, id: &str, token: &str) -> Result<()> {
        let tx = self.db.transaction().map_err(error)?;
        let current = projection(&tx, id)?;
        if current.token != token {
            return Err("同步内容已改变，请重新核对后应用".into());
        }
        tx.execute("INSERT INTO workspace_projection(object_id,observed) VALUES(?,?) ON CONFLICT(object_id) DO UPDATE SET observed=EXCLUDED.observed",params![id,current.target.as_ref().map(encode).transpose()?]).map_err(error)?;
        tx.commit().map_err(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn setup() -> (tempfile::TempDir, Replica) {
        let dir = tempfile::tempdir().unwrap();
        let replica = Replica::open(
            &dir.path().join("replica"),
            &Binding {
                server_id: "s".into(),
                account_id: "a".into(),
                library_id: "l".into(),
            },
            "e",
        )
        .unwrap();
        (dir, replica)
    }
    fn remote(value: &str, revision: u64) -> RemoteChange {
        RemoteChange {
            object_id: "n".into(),
            kind: ObjectKind::Note,
            content: Some(json!(value)),
            deleted: false,
            revision,
        }
    }
    #[test]
    fn acknowledged_annotation_coordinates_do_not_requeue_after_json_roundtrip() {
        let (_dir, mut replica) = setup();
        let value = json!({"rects": [[177.0800018310547_f64, 423.95001220703125_f64,
            234.5800018310547_f64, 442.05999755859375_f64]]});
        replica.observe_workspace("annotation:a", ObjectKind::Annotation, Some(&value)).unwrap();
        let op = replica.pending().unwrap().remove(0);
        replica.acknowledge(&op.operation_id, 1).unwrap();
        let persisted = replica.observed_workspace_documents().unwrap().remove(0).1;
        assert_eq!(persisted, value, "JSON decoding must preserve exact coordinate values");
        for _ in 0..3 {
            replica.observe_workspace("annotation:a", ObjectKind::Annotation, Some(&value)).unwrap();
            assert!(replica.pending().unwrap().is_empty());
            assert!(replica.pending_projections().unwrap().is_empty());
        }
    }

    #[test]
    fn editing_during_download_preserves_both_sides() {
        let (_dir, mut replica) = setup();
        replica.receive(&remote("base", 1)).unwrap();
        let pending = replica.pending_projections().unwrap().remove(0);
        replica.acknowledge_projection("n", &pending.token).unwrap();
        replica.receive(&remote("remote", 2)).unwrap();
        replica
            .observe_workspace("n", ObjectKind::Note, Some(&json!("local")))
            .unwrap();
        let conflict = replica.conflict_detail("n").unwrap();
        assert_eq!(conflict.base, Some(json!("base")));
        assert_eq!(conflict.local, Some(json!("local")));
        assert_eq!(conflict.remote.content, Some(json!("remote")));
        assert!(replica.pending_projections().unwrap().is_empty());
        assert!(replica.pending().unwrap().is_empty());
    }
    #[test]
    fn crash_after_file_apply_does_not_upload_remote_content_again() {
        let (_dir, mut replica) = setup();
        replica.receive(&remote("downloaded", 1)).unwrap();
        replica
            .observe_workspace("n", ObjectKind::Note, Some(&json!("downloaded")))
            .unwrap();
        assert!(replica.pending_projections().unwrap().is_empty());
        assert!(replica.pending().unwrap().is_empty());
        replica.receive(&remote("next", 2)).unwrap();
        let old = replica.pending_projections().unwrap().remove(0);
        replica.receive(&remote("newer", 3)).unwrap();
        assert!(replica.acknowledge_projection("n", &old.token).is_err());
    }
    #[test]
    fn unchanged_files_are_not_mistaken_for_new_local_edits() {
        let (_dir, mut replica) = setup();
        replica
            .observe_workspace("n", ObjectKind::Note, Some(&json!("local")))
            .unwrap();
        let op = replica.pending().unwrap().remove(0);
        replica.acknowledge(&op.operation_id, 1).unwrap();
        replica.receive(&remote("remote", 2)).unwrap();
        replica
            .observe_workspace("n", ObjectKind::Note, Some(&json!("local")))
            .unwrap();
        assert!(replica.conflicts().unwrap().is_empty());
        let change = replica.pending_projections().unwrap().remove(0);
        assert_eq!(change.expected, Some(json!("local")));
        assert_eq!(change.target, Some(json!("remote")));
    }
}
