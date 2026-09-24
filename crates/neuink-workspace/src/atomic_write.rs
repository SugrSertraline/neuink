use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;

use crate::WorkspaceError;

pub fn atomic_write_json<T: Serialize>(
    path: impl AsRef<Path>,
    value: &T,
) -> Result<(), WorkspaceError> {
    let bytes = serde_json::to_vec_pretty(value)?;
    atomic_write(path, &bytes)
}

pub fn atomic_write(path: impl AsRef<Path>, bytes: &[u8]) -> Result<(), WorkspaceError> {
    let path = path.as_ref();
    ensure_file_destination(path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let tmp_path = temp_path_for(path);
    let mut tmp_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp_path)?;
    // Covers write/sync/rename failures as well as the successful path.
    let _temporary = TemporaryFile(tmp_path.clone());
    let write_result = tmp_file.write_all(bytes).and_then(|_| tmp_file.sync_all());
    drop(tmp_file);
    write_result?;

    match fs::rename(&tmp_path, path) {
        Ok(()) => Ok(()),
        Err(error) if path.exists() => replace_existing(path, &tmp_path, error),
        Err(error) => {
            let _cleanup = fs::remove_file(&tmp_path);
            Err(error.into())
        }
    }
}

fn replace_existing(
    path: &Path,
    tmp_path: &Path,
    original_error: std::io::Error,
) -> Result<(), WorkspaceError> {
    ensure_file_destination(path)?;
    // Never remove another save's backup or a user's similarly named file.
    let backup_path = tmp_path.with_extension("bak");

    fs::rename(path, &backup_path)?;
    match fs::rename(tmp_path, path) {
        Ok(()) => {
            fs::remove_file(&backup_path)?;
            Ok(())
        }
        Err(error) => {
            let _restore = fs::rename(&backup_path, path);
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                Err(original_error.into())
            } else {
                Err(error.into())
            }
        }
    }
}

fn temp_path_for(path: &Path) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("neuink-write");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let sequence = NEXT.fetch_add(1, Ordering::Relaxed);
    path.with_file_name(format!(
        "{file_name}.{}.{nonce}.{sequence}.tmp",
        std::process::id()
    ))
}

fn ensure_file_destination(path: &Path) -> Result<(), WorkspaceError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if !meta.file_type().is_file() => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "save destination is not a regular file",
        )
        .into()),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

struct TemporaryFile(PathBuf);
impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::atomic_write;

    #[test]
    fn writes_file_contents() {
        let dir = std::env::temp_dir().join(format!("neuink_atomic_write_{}", unique_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("entry.meta.json");

        atomic_write(&path, br#"{"title":"A"}"#).unwrap();

        assert_eq!(fs::read_to_string(path).unwrap(), r#"{"title":"A"}"#);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_directory_destinations_without_moving_them_or_leaving_temporary_files() {
        let dir = std::env::temp_dir().join(format!("neuink_atomic_directory_{}", unique_suffix()));
        let target = dir.join("note.json");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("user-file"), "keep").unwrap();
        assert!(atomic_write(&target, b"replacement").is_err());
        assert_eq!(
            fs::read_to_string(target.join("user-file")).unwrap(),
            "keep"
        );
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_replacement_preserves_files_and_removes_temporary_file() {
        let dir = std::env::temp_dir().join(format!("neuink_atomic_locked_{}", unique_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("note.json");
        fs::write(&target, "keep").unwrap();
        // Force the fallback directly: an absent temporary file cannot replace
        // the destination; the original file must be restored.
        assert!(super::replace_existing(
            &target,
            &dir.join("missing.tmp"),
            std::io::Error::from(std::io::ErrorKind::PermissionDenied)
        )
        .is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "keep");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    fn unique_suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }
}
