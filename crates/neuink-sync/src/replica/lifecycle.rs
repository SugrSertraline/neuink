use super::{encode, error, Replica, Result};
use rusqlite::{params, OptionalExtension};
use serde_json::Value;

impl Replica {
    pub fn lifecycle_deleting(&self, event: &str) -> Result<bool> {
        self.db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM lifecycle_phase WHERE event_id=?)",
                [event],
                |r| r.get(0),
            )
            .map_err(error)
    }
    pub fn begin_lifecycle_delete(&self, event: &str) -> Result<()> {
        self.db
            .execute("INSERT OR IGNORE INTO lifecycle_phase VALUES(?)", [event])
            .map_err(error)?;
        Ok(())
    }
    pub fn settled_content(&self, id: &str, content: Option<&Value>) -> Result<bool> {
        let value = content.map(encode).transpose()?;
        let settled: Option<bool> = self.db.query_row("SELECT revision IS NOT NULL AND dirty=0 AND content IS ?2 AND base_content IS ?2 AND NOT EXISTS(SELECT 1 FROM outbox WHERE object_id=?1) AND NOT EXISTS(SELECT 1 FROM conflicts WHERE id=?1) FROM documents WHERE id=?1", params![id,value],|r|r.get(0)).optional().map_err(error)?;
        Ok(settled.unwrap_or(false))
    }
}
