//! Only retire completed, application-owned copies of the current component version.
use super::{environment, installed, ID};
use std::{fs, io, path::{Path, PathBuf}};

pub(super) async fn after_install(cache: PathBuf) {
    // Large Windows environments contain tens of thousands of files. Keep this off
    // the async executor; cleanup failure must not invalidate the verified runtime.
    match tokio::task::spawn_blocking(move || obsolete_copies(&cache)).await {
        Ok(Ok(())) => {},
        _ => eprintln!("Research component cleanup incomplete; will retry on next installation"),
    }
}

fn is_plain_directory(path: &Path) -> io::Result<bool> {
    let metadata = fs::symlink_metadata(path)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 { return Ok(false); }
    }
    Ok(metadata.is_dir() && !metadata.file_type().is_symlink())
}

fn obsolete_copies(cache: &Path) -> io::Result<()> {
    if !installed(cache) { return Ok(()); }
    let base = cache.join("research-components");
    if !is_plain_directory(&base)? { return Ok(()); }
    let base = fs::canonicalize(base)?;
    let active = fs::canonicalize(environment(cache))?;
    if active.parent() != Some(base.as_path()) { return Ok(()); }
    for entry in fs::read_dir(&base)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue; };
        let Some(suffix) = name.strip_prefix(&format!("{ID}-")) else { continue; };
        if suffix.is_empty() || suffix.len() >= 100 || !suffix.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b)) { continue; }
        let path = entry.path();
        if !is_plain_directory(&path)? { continue; }
        let path = fs::canonicalize(path)?;
        if path == active || path.parent() != Some(base.as_path()) { continue; }
        if fs::read_to_string(path.join("ready")).ok().as_deref() != Some(ID) { continue; }
        let lock = fs::read(path.join("source-lock.json")).ok()
            .and_then(|data| serde_json::from_slice::<serde_json::Value>(&data).ok());
        if lock.as_ref().and_then(|lock| lock["component_id"].as_str()) != Some(ID) { continue; }
        // Recheck the pointer before deletion. Failed repairs and unknown directories stay intact.
        if fs::canonicalize(environment(cache))? != active || !installed(cache) { return Ok(()); }
        fs::remove_dir_all(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn copy(cache: &Path, name: &str) -> PathBuf {
        let path = cache.join("research-components").join(name);
        fs::create_dir_all(path.join("python")).unwrap();
        fs::write(path.join("python/python.exe"), b"runtime").unwrap();
        fs::write(path.join("ready"), ID).unwrap();
        fs::write(path.join("source-lock.json"), serde_json::json!({"component_id":ID}).to_string()).unwrap();
        path
    }
    #[test]
    fn retires_only_completed_owned_copies_and_keeps_active_and_unknown_data() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path();
        let active = copy(cache, &format!("{ID}-active"));
        let old = copy(cache, &format!("{ID}-old"));
        let unknown = copy(cache, &format!("{ID}-unknown"));
        fs::remove_file(unknown.join("source-lock.json")).unwrap();
        let incomplete = copy(cache, &format!("{ID}-incomplete"));
        fs::remove_file(incomplete.join("ready")).unwrap();
        let other = copy(cache, "another-component-old");
        fs::write(cache.join("research-components/current.json"), serde_json::json!({"component_id":ID,"directory":format!("{ID}-active")}).to_string()).unwrap();
        obsolete_copies(cache).unwrap();
        assert!(!old.exists());
        for kept in [&active, &unknown, &incomplete, &other] { assert!(kept.exists()); }
        obsolete_copies(cache).unwrap();
        assert!(installed(cache));
    }
    #[test]
    fn missing_or_invalid_active_environment_never_removes_previous_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let old = copy(tmp.path(), &format!("{ID}-old"));
        obsolete_copies(tmp.path()).unwrap();
        assert!(old.exists());
        fs::write(tmp.path().join("research-components/current.json"), b"invalid").unwrap();
        obsolete_copies(tmp.path()).unwrap();
        assert!(old.exists());
    }
}
