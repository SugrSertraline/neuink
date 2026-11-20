use super::*;
use std::collections::BTreeMap;
#[derive(Serialize)]
pub struct ResolutionMember {
    pub id: String,
    pub kind: ObjectKind,
    pub base: Option<Value>,
    pub local: Option<Value>,
    pub remote: Option<Value>,
    pub revision: Option<u64>,
}
impl Replica {
    pub(crate) fn deletion_owner(&self, id: &str) -> Result<Option<String>> {
        let raw: Option<String> = self
            .db
            .query_row(
                "SELECT base_content FROM documents WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(error)?
            .flatten();
        let Some(raw) = raw else { return Ok(None) };
        let value: Value = serde_json::from_str(&raw).map_err(error)?;
        if value["document"]["entity_id"].as_str() != Some(id) {
            return Ok(None);
        }
        Ok(id.strip_prefix("entry:").map(str::to_owned).or_else(|| {
            value["document"]["payload"]["entry_id"]
                .as_str()
                .map(str::to_owned)
        }))
    }
    pub fn resolution_members(
        &self,
        owner: &str,
        local: &BTreeMap<String, Value>,
    ) -> Result<Vec<ResolutionMember>> {
        let mut stmt=self.db.prepare("SELECT d.id,d.kind,d.base_content,d.revision,c.remote FROM documents d LEFT JOIN conflicts c ON c.id=d.id ORDER BY d.id").map_err(error)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<u64>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            })
            .map_err(error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(error)?;
        let mut members = Vec::new();
        for (id, kind, base, revision, conflict) in rows {
            let base: Option<Value> = base
                .map(|raw| serde_json::from_str(&raw))
                .transpose()
                .map_err(error)?;
            let conflict: Option<RemoteChange> = conflict
                .map(|raw| serde_json::from_str(&raw))
                .transpose()
                .map_err(error)?;
            let current = local.get(&id).cloned();
            let remote = conflict
                .as_ref()
                .map(|c| c.content.clone())
                .unwrap_or_else(|| base.clone());
            let belongs = [current.as_ref(), base.as_ref(), remote.as_ref()]
                .into_iter()
                .flatten()
                .any(|v| {
                    v["document"]["payload"]["entry_id"].as_str() == Some(owner)
                        || v["document"]["entity_id"].as_str() == Some(&format!("entry:{owner}"))
                });
            if belongs {
                members.push(ResolutionMember {
                    id,
                    kind: serde_json::from_str(&kind).map_err(error)?,
                    base,
                    local: current,
                    remote,
                    revision: conflict.as_ref().map(|c| c.revision).or(revision),
                });
            }
        }
        Ok(members)
    }
    pub fn resolve_members(
        &mut self,
        members: &[ResolutionMember],
        keep_local: bool,
        events: &[String],
        token: &str,
    ) -> Result<()> {
        let tx = self.db.transaction().map_err(error)?;
        tx.execute(
            "INSERT OR IGNORE INTO rebaseline_archive(token,payload) VALUES(?1,?2)",
            params![token, encode(&members)?],
        )
        .map_err(error)?;
        for member in members {
            let selected = if keep_local {
                &member.local
            } else {
                &member.remote
            };
            let content = selected.as_ref().map(encode).transpose()?;
            let base = member.remote.as_ref().map(encode).transpose()?;
            tx.execute(
                "UPDATE documents SET content=?1,base_content=?2,revision=?3,dirty=?4 WHERE id=?5",
                params![
                    content,
                    base,
                    member.revision,
                    selected != &member.remote,
                    member.id
                ],
            )
            .map_err(error)?;
            tx.execute("INSERT INTO workspace_projection(object_id,observed) VALUES(?1,?2) ON CONFLICT(object_id) DO UPDATE SET observed=?2",params![member.id,member.local.as_ref().map(encode).transpose()?]).map_err(error)?;
            tx.execute("DELETE FROM conflicts WHERE id=?1", [&member.id])
                .map_err(error)?;
            tx.execute("DELETE FROM outbox WHERE object_id=?1", [&member.id])
                .map_err(error)?;
            if keep_local && selected.is_none() && member.remote.is_some() {
                tx.execute(
                    "INSERT OR REPLACE INTO resolved_deletions(id,kind) VALUES(?1,?2)",
                    params![member.id, encode(&member.kind)?],
                )
                .map_err(error)?;
            }
        }
        for event in events {
            tx.execute(
                "INSERT OR IGNORE INTO resolved_events(id) VALUES(?1)",
                [event],
            )
            .map_err(error)?;
        }
        tx.commit().map_err(error)
    }
    pub fn lifecycle_resolved(&self, id: &str) -> Result<bool> {
        self.db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM resolved_events WHERE id=?1)",
                [id],
                |r| r.get(0),
            )
            .map_err(error)
    }
    pub fn resolved_deletions(&self) -> Result<Vec<(String, ObjectKind)>> {
        let mut stmt = self
            .db
            .prepare("SELECT id,kind FROM resolved_deletions")
            .map_err(error)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(error)?;
        rows.into_iter()
            .map(|(id, kind)| Ok((id, serde_json::from_str(&kind).map_err(error)?)))
            .collect()
    }
    pub fn clear_resolved_deletion(&self, id: &str) -> Result<()> {
        self.db
            .execute("DELETE FROM resolved_deletions WHERE id=?1", [id])
            .map_err(error)?;
        Ok(())
    }
}
