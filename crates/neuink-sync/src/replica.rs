//! Durable replica journal. Desktop content adapters must commit through this
//! interface before treating a remote update as applied to the user workspace.
mod lifecycle;
mod rebaseline;
mod resolution;
pub use resolution::ResolutionMember;
pub use rebaseline::RebaselinePreview;
mod upload_gate;
use neuink_sync_protocol::{Binding, Mutation, ObjectKind, Operation};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

type Result<T> = std::result::Result<T, String>;
pub struct Replica {
    db: Connection,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct RemoteChange {
    pub object_id: String,
    pub kind: ObjectKind,
    pub content: Option<Value>,
    pub deleted: bool,
    pub revision: u64,
}
#[derive(Debug, Serialize)]
pub struct ConflictDetail {
    pub base: Option<Value>,
    pub local: Option<Value>,
    pub remote: RemoteChange,
    /// Changes whenever any side changes; prevents applying a stale user choice.
    pub token: String,
}
fn conflict_detail(db: &Connection, id: &str) -> Result<ConflictDetail> {
    let (base, local, raw): (Option<String>, Option<String>, String) = db
        .query_row("SELECT d.base_content,d.content,c.remote FROM documents d JOIN conflicts c ON c.id=d.id WHERE d.id=?1", [id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))
        .map_err(error)?;
    let token = blake3::hash(encode(&(&base, &local, &raw))?.as_bytes())
        .to_hex()
        .to_string();
    Ok(ConflictDetail {
        base: base
            .map(|v| serde_json::from_str(&v).map_err(error))
            .transpose()?,
        local: local
            .map(|v| serde_json::from_str(&v).map_err(error))
            .transpose()?,
        remote: serde_json::from_str(&raw).map_err(error)?,
        token,
    })
}
fn error(_: impl std::fmt::Display) -> String {
    "同步状态保存失败，原始资料未修改".into()
}
fn encode(v: &impl Serialize) -> Result<String> {
    serde_json::to_string(v).map_err(error)
}
impl Replica {
    /// A WAL read snapshot neither creates/migrates the journal nor takes the
    /// workspace's exclusive sync-task lock. Concurrent acknowledgements remain writable.
    pub fn read_snapshot(path: &Path, binding: &Binding, epoch: &str) -> Result<Self> {
        let db = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(error)?;
        db.busy_timeout(std::time::Duration::from_secs(5)).map_err(error)?;
        db.execute_batch("BEGIN DEFERRED").map_err(error)?;
        let replica = Self { db };
        replica.check_binding(binding, epoch)?;
        Ok(replica)
    }
    /// Classification is durable: losing a cache folder must not publish its
    /// old queued contents or turn a remote echo into an independent paper.
    pub fn exclude_source_entry(&self, entry_id: &str) -> Result<()> {
        self.db.execute("INSERT OR IGNORE INTO local_only_entries(entry_id) VALUES(?)", [entry_id])
            .map_err(error)?;
        Ok(())
    }
    pub fn check_binding(&self, binding: &Binding, epoch: &str) -> Result<()> {
        let (stored, stored_epoch): (String, String) = self
            .db
            .query_row("SELECT binding,epoch FROM identity WHERE id=1", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(error)?;
        if stored != encode(binding)? || stored_epoch != epoch {
            return Err("同步队列与服务器、账号、云端库或恢复代际不一致".into());
        }
        Ok(())
    }

    pub fn open(path: &Path, binding: &Binding, epoch: &str) -> Result<Self> {
        let mut db = Connection::open(path).map_err(error)?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(error)?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS identity (id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT NOT NULL, epoch TEXT NOT NULL, cursor INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,kind TEXT NOT NULL,content TEXT,base_content TEXT,revision INTEGER,dirty INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,object_id TEXT NOT NULL UNIQUE,payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS conflicts(id TEXT PRIMARY KEY,remote TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS lifecycle_phase(event_id TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS resolved_events(id TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS resolved_deletions(id TEXT PRIMARY KEY,kind TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS protocol_epoch(id INTEGER PRIMARY KEY CHECK(id=1),epoch TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS rebaseline_archive(token TEXT PRIMARY KEY,payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS upload_gate(id INTEGER PRIMARY KEY CHECK(id=1), available INTEGER);").map_err(error)?;
        db.execute_batch("CREATE TABLE IF NOT EXISTS workspace_projection(object_id TEXT PRIMARY KEY,observed TEXT);").map_err(error)?;
        // Retain legacy replica history, but never dispatch or apply source caches.
        db.execute_batch("CREATE TABLE IF NOT EXISTS local_only_entries(entry_id TEXT PRIMARY KEY);
            CREATE VIEW IF NOT EXISTS syncable_documents AS
            SELECT d.* FROM documents d WHERE NOT EXISTS (
                SELECT 1 FROM local_only_entries l WHERE d.id='entry:'||l.entry_id
                OR json_extract(d.content,'$.document.payload.entry_id')=l.entry_id
                OR json_extract(d.base_content,'$.document.payload.entry_id')=l.entry_id
                OR EXISTS(SELECT 1 FROM workspace_projection p WHERE p.object_id=d.id
                    AND json_extract(p.observed,'$.document.payload.entry_id')=l.entry_id));").map_err(error)?;
        let tx = db.transaction().map_err(error)?;
        let old: Option<(String, String)> = tx
            .query_row("SELECT binding,epoch FROM identity WHERE id=1", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()
            .map_err(error)?;
        let encoded = encode(binding)?;
        if let Some((previous, previous_epoch)) = old {
            if previous != encoded {
                return Err("此同步队列属于其他服务器、账号或资料库".into());
            }
            if previous_epoch != epoch {
                return Err("服务器已恢复或重建，需要重新核对同步基线".into());
            }
        } else {
            tx.execute(
                "INSERT INTO identity VALUES(1,?1,?2,0)",
                params![encoded, epoch],
            )
            .map_err(error)?;
        }
        tx.commit().map_err(error)?;
        Ok(Self { db })
    }
    /// A local edit and its dirty marker share one SQLite transaction.
    pub fn edit(&mut self, id: &str, kind: ObjectKind, content: Option<&Value>) -> Result<()> {
        if id.is_empty() {
            return Err("对象标识为空".into());
        }
        let tx = self.db.transaction().map_err(error)?;
        let value = content.map(encode).transpose()?;
        let kind = encode(&kind)?;
        let old: Option<(String, Option<String>)> = tx
            .query_row(
                "SELECT kind,content FROM documents WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(error)?;
        if let Some((old_kind, old_value)) = &old {
            if *old_kind != kind {
                return Err("对象类型不能改变".into());
            }
            if *old_value == value {
                return Ok(());
            }
        }
        if old.is_none() && value.is_none() {
            return Ok(());
        }
        tx.execute("INSERT INTO documents(id,kind,content,dirty) VALUES(?1,?2,?3,1) ON CONFLICT(id) DO UPDATE SET content=?3,dirty=1",params![id,kind,value]).map_err(error)?;
        tx.commit().map_err(error)
    }
    pub fn content(&self, id: &str) -> Result<Option<Value>> {
        let value: Option<String> = self
            .db
            .query_row("SELECT content FROM documents WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(error)?
            .flatten();
        value
            .map(|v| serde_json::from_str(&v).map_err(error))
            .transpose()
    }
    /// Freeze an operation before networking, so retries after crashes keep its ID.
    pub fn pending(&mut self) -> Result<Vec<Operation>> {
        let tx = self.db.transaction().map_err(error)?;
        let rows: Vec<(String, String, Option<String>, Option<String>, Option<u64>)> = {
            let mut stmt=tx.prepare("SELECT id,kind,content,base_content,revision FROM syncable_documents WHERE dirty=1 AND id NOT IN(SELECT id FROM conflicts) AND id NOT IN(SELECT object_id FROM outbox)").map_err(error)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                })
                .map_err(error)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(error)?;
            rows
        };
        let (binding, epoch): (String, String) = tx
            .query_row("SELECT binding,COALESCE((SELECT epoch FROM protocol_epoch WHERE id=1),epoch) FROM identity WHERE id=1", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .map_err(error)?;
        for (id, kind, content, base, revision) in rows {
            if content == base {
                tx.execute("UPDATE documents SET dirty=0 WHERE id=?1", [&id])
                    .map_err(error)?;
                continue;
            }
            let mutation = match content {
                Some(v) => {
                    let content = serde_json::from_str(&v).map_err(error)?;
                    if revision.is_some() && base.is_none() {
                        Mutation::Restore { content }
                    } else {
                        Mutation::Put { content }
                    }
                }
                None => Mutation::Delete,
            };
            let hash = blake3::hash(
                encode(&(
                    binding.as_str(),
                    epoch.as_str(),
                    id.as_str(),
                    revision,
                    &mutation,
                ))?
                .as_bytes(),
            )
            .to_hex()
            .to_string();
            let op = Operation {
                operation_id: hash.clone(),
                object_id: id.clone(),
                kind: serde_json::from_str(&kind).map_err(error)?,
                base_revision: revision,
                mutation,
            };
            tx.execute(
                "INSERT INTO outbox VALUES(?1,?2,?3)",
                params![hash, id, encode(&op)?],
            )
            .map_err(error)?;
        }
        let operations = {
            let mut stmt=tx.prepare("SELECT payload FROM outbox WHERE object_id IN(SELECT id FROM syncable_documents) AND object_id NOT IN(SELECT id FROM conflicts) ORDER BY id").map_err(error)?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(error)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(error)?;
            rows.into_iter()
                .map(|r| serde_json::from_str(&r).map_err(error))
                .collect::<Result<Vec<_>>>()?
        };
        tx.commit().map_err(error)?;
        Ok(operations)
    }
    pub fn acknowledge(&mut self, operation_id: &str, revision: u64) -> Result<()> {
        let tx = self.db.transaction().map_err(error)?;
        let payload: Option<String> = tx
            .query_row(
                "SELECT payload FROM outbox WHERE id=?1",
                [operation_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(error)?;
        let Some(payload) = payload else {
            return Ok(());
        };
        let op: Operation = serde_json::from_str(&payload).map_err(error)?;
        let base = match &op.mutation {
            Mutation::Put { content } | Mutation::Restore { content } => Some(encode(content)?),
            Mutation::Delete => None,
        };
        tx.execute("UPDATE documents SET base_content=?1,revision=?2,dirty=CASE WHEN content IS ?1 THEN 0 ELSE 1 END WHERE id=?3 AND (revision IS NULL OR revision<=?2)",params![base,revision,op.object_id]).map_err(error)?;
        tx.execute("DELETE FROM outbox WHERE id=?1", [operation_id])
            .map_err(error)?;
        tx.commit().map_err(error)
    }
    pub fn cursor(&self) -> Result<u64> {
        self.db
            .query_row("SELECT cursor FROM identity WHERE id=1", [], |r| r.get(0))
            .map_err(error)
    }
    /// Persist a conflict before advancing the download cursor. A conflict is not a dropped update.
    pub fn receive(&mut self, change: &RemoteChange) -> Result<()> {
        let tx = self.db.transaction().map_err(error)?;
        let cursor: u64 = tx
            .query_row("SELECT cursor FROM identity WHERE id=1", [], |r| r.get(0))
            .map_err(error)?;
        if change.revision <= cursor {
            return Ok(());
        }
        if change.deleted != change.content.is_none() {
            return Err("远端内容与删除状态不一致".into());
        }
        let old_kind: Option<String> = tx
            .query_row(
                "SELECT kind FROM documents WHERE id=?1",
                [&change.object_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(error)?;
        let incoming_kind = encode(&change.kind)?;
        if old_kind.is_some_and(|kind| kind != incoming_kind) {
            return Err("远端对象类型发生变化，已停止应用".into());
        }
        let incoming = change.content.as_ref().map(encode).transpose()?;
        let current: Option<(Option<String>, Option<u64>, bool)> = tx
            .query_row(
                "SELECT content,revision,dirty FROM documents WHERE id=?1",
                [&change.object_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(error)?;
        if current
            .as_ref()
            .is_some_and(|(_, version, _)| version.is_some_and(|v| v >= change.revision))
        {
            // Already acknowledged this revision; local edits after it remain dirty.
        } else if current
            .as_ref()
            .is_some_and(|(content, _, dirty)| *dirty && *content != incoming)
        {
            tx.execute("INSERT INTO conflicts(id,remote) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET remote=?2",params![change.object_id,encode(change)?]).map_err(error)?;
        } else {
            tx.execute("INSERT INTO documents(id,kind,content,base_content,revision,dirty) VALUES(?1,?2,?3,?3,?4,0) ON CONFLICT(id) DO UPDATE SET content=?3,base_content=?3,revision=?4,dirty=0",params![change.object_id,encode(&change.kind)?,incoming,change.revision]).map_err(error)?;
            tx.execute("DELETE FROM outbox WHERE object_id=?1", [&change.object_id])
                .map_err(error)?;
            tx.execute("DELETE FROM conflicts WHERE id=?1", [&change.object_id])
                .map_err(error)?;
        }
        tx.execute(
            "UPDATE identity SET cursor=?1 WHERE id=1",
            [change.revision],
        )
        .map_err(error)?;
        tx.commit().map_err(error)
    }
    pub fn conflict_count(&self) -> Result<usize> {
        self.db.query_row("SELECT COUNT(*) FROM conflicts WHERE id IN(SELECT id FROM syncable_documents)", [], |row| row.get(0)).map_err(error)
    }
    pub fn conflicts(&self) -> Result<Vec<RemoteChange>> {
        let mut stmt = self
            .db
            .prepare("SELECT remote FROM conflicts WHERE id IN(SELECT id FROM syncable_documents) ORDER BY id")
            .map_err(error)?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(error)?;
        rows.into_iter()
            .map(|r| serde_json::from_str(&r).map_err(error))
            .collect()
    }
    pub fn resolve(&mut self, id: &str, keep_local: bool) -> Result<()> {
        let token = self.conflict_detail(id)?.token;
        self.resolve_if_current(id, keep_local, &token)
    }
    pub fn conflict_detail(&self, id: &str) -> Result<ConflictDetail> {
        conflict_detail(&self.db, id)
    }
    /// UI callers must pass the token from the comparison they actually displayed.
    pub fn resolve_if_current(
        &mut self,
        id: &str,
        keep_local: bool,
        expected_token: &str,
    ) -> Result<()> {
        let tx = self.db.transaction().map_err(error)?;
        let detail = conflict_detail(&tx, id)?;
        if detail.token != expected_token {
            return Err("冲突内容已更新，请重新核对双方修改".into());
        }
        let remote = detail.remote;
        let content = remote.content.as_ref().map(encode).transpose()?;
        tx.execute("UPDATE documents SET base_content=?1,revision=?2,content=CASE WHEN ?3 THEN content ELSE ?1 END,dirty=CASE WHEN ?3 THEN 1 ELSE 0 END WHERE id=?4",params![content,remote.revision,keep_local,id]).map_err(error)?;
        tx.execute("DELETE FROM conflicts WHERE id=?1", [id])
            .map_err(error)?;
        tx.execute("DELETE FROM outbox WHERE object_id=?1", [id])
            .map_err(error)?;
        tx.commit().map_err(error)
    }
}

#[cfg(test)]
#[path = "replica_tests.rs"]
mod tests;

#[path = "projection.rs"]
mod projection;
pub use projection::Projection;
