use crate::ZoteroError;
use rusqlite::{
    backup::{Backup, StepResult},
    Connection, OpenFlags,
};
use std::{
    path::Path,
    time::{Duration, Instant},
};

pub(crate) fn snapshot(path: &Path) -> Result<Connection, ZoteroError> {
    let size = std::fs::metadata(path)
        .map_err(|_| ZoteroError::Read)?
        .len();
    if size > 512 * 1024 * 1024 {
        return Err(ZoteroError::Limit);
    }
    let source = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| ZoteroError::Read)?;
    source
        .busy_timeout(Duration::from_millis(300))
        .map_err(|_| ZoteroError::Read)?;
    source
        .execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;")
        .map_err(|_| ZoteroError::Read)?;
    let mut copy = Connection::open_in_memory().map_err(|_| ZoteroError::Read)?;
    {
        // SQLite's backup API includes committed WAL records. Copying sqlite alone does not.
        let backup = Backup::new(&source, &mut copy).map_err(|_| ZoteroError::Read)?;
        let start = Instant::now();
        loop {
            match backup.step(256).map_err(|_| ZoteroError::Read)? {
                StepResult::Done => break,
                StepResult::Busy | StepResult::Locked => {
                    std::thread::sleep(Duration::from_millis(30))
                }
                _ => std::thread::yield_now(),
            }
            if start.elapsed() > Duration::from_secs(15) {
                return Err(ZoteroError::Busy);
            }
        }
    }
    copy.execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;")
        .map_err(|_| ZoteroError::Read)?;
    Ok(copy)
}
