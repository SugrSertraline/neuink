use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
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
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let tmp_path = temp_path_for(path);
    let mut tmp_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp_path)?;
    tmp_file.write_all(bytes)?;
    tmp_file.sync_all()?;
    drop(tmp_file);

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
    let backup_path = backup_path_for(path);
    if backup_path.exists() {
        fs::remove_file(&backup_path)?;
    }

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
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("neuink-write");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    path.with_file_name(format!("{file_name}.{nonce}.tmp"))
}

fn backup_path_for(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("neuink-write");
    path.with_file_name(format!("{file_name}.bak"))
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

    fn unique_suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }
}
