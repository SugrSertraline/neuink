use super::{error, Replica, Result};
use rusqlite::OptionalExtension;

impl Replica {
    /// Persist quota suspension independently of the outbox. Unknown capacity
    /// stays blocked until an explicit retry; a failed probe must not unblock it.
    pub fn uploads_blocked(&self, available: Option<u64>, explicit_retry: bool) -> Result<bool> {
        let prior: Option<Option<u64>> = self
            .db
            .query_row("SELECT available FROM upload_gate WHERE id=1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(error)?;
        let blocked = prior.is_some_and(|previous| {
            !explicit_retry && !matches!((previous, available), (Some(old), Some(now)) if now > old)
        });
        if !blocked {
            self.db
                .execute("DELETE FROM upload_gate", [])
                .map_err(error)?;
        }
        Ok(blocked)
    }

    pub fn suspend_uploads(&self, available: Option<u64>) -> Result<()> {
        self.db.execute("INSERT INTO upload_gate VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET available=excluded.available", [available]).map_err(error)?;
        Ok(())
    }

    pub fn has_upload_gate(&self) -> Result<bool> {
        self.db
            .query_row("SELECT EXISTS(SELECT 1 FROM upload_gate)", [], |r| r.get(0))
            .map_err(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quota_suspension_survives_reopen_and_only_capacity_or_explicit_retry_unblocks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("replica.sqlite");
        let binding = neuink_sync_protocol::Binding {
            server_id: "s".into(),
            account_id: "a".into(),
            library_id: "l".into(),
        };
        let replica = Replica::open(&path, &binding, "epoch").unwrap();
        replica.suspend_uploads(Some(100)).unwrap();
        drop(replica);
        let replica = Replica::open(&path, &binding, "epoch").unwrap();
        assert!(replica.uploads_blocked(Some(100), false).unwrap());
        assert!(replica.uploads_blocked(Some(90), false).unwrap());
        assert!(replica.uploads_blocked(None, false).unwrap());
        assert!(!replica.uploads_blocked(Some(101), false).unwrap());
        assert!(!replica.has_upload_gate().unwrap());
        replica.suspend_uploads(None).unwrap();
        assert!(replica.uploads_blocked(Some(1000), false).unwrap());
        assert!(!replica.uploads_blocked(None, true).unwrap());
    }
}
