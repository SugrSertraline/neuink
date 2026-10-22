use super::*;
use neuink_config::RecentWorkspace;

fn fixture() -> (tempfile::TempDir, PortablePaths) {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("neuink.portable.json"), r#"{"version":1}"#).unwrap();
    let paths = PortablePaths::detect(&root.path().join("Neuink.exe"))
        .unwrap()
        .unwrap();
    (root, paths)
}

#[test]
fn windows_installed_and_portable_modes_always_use_adjacent_data() {
    let root = tempfile::tempdir().unwrap();
    let exe = root.path().join("Neuink.exe");
    assert!(PortablePaths::detect_mode(&exe, false).unwrap().is_none());
    assert_eq!(
        PortablePaths::detect_mode(&exe, true)
            .unwrap()
            .unwrap()
            .data(),
        root.path().join("data")
    );
    fs::write(
        root.path().join("neuink.data-location.json"),
        r#"{"version":1,"data_directory":"D:/elsewhere"}"#,
    )
    .unwrap();
    assert_eq!(
        PortablePaths::detect_mode(&exe, true)
            .unwrap()
            .unwrap()
            .data(),
        root.path().join("data")
    );
    for invalid in ["", "{", r#"{"version":2}"#] {
        fs::write(root.path().join("neuink.portable.json"), invalid).unwrap();
        assert!(PortablePaths::detect_mode(&exe, false).is_err());
    }
}

#[cfg(debug_assertions)]
#[test]
fn debug_data_override_requires_an_existing_absolute_library() {
    let root = tempfile::tempdir().unwrap();
    assert!(PortablePaths::validate_dev_data_root(root.path().to_path_buf()).is_err());
    fs::create_dir(root.path().join("library")).unwrap();
    assert_eq!(
        PortablePaths::validate_dev_data_root(root.path().to_path_buf()).unwrap(),
        root.path()
    );
    assert!(PortablePaths::validate_dev_data_root(PathBuf::from("relative/data")).is_err());
}

#[test]
fn moved_package_keeps_settings_and_data_without_old_absolute_paths() {
    let (root, paths) = fixture();
    fs::create_dir_all(paths.data.join("library")).unwrap();
    fs::write(paths.data.join("library/note.md"), "user note").unwrap();
    let mut settings = AppSettings {
        workspace_root: Some("D:/old-library".into()),
        recent_workspaces: vec![RecentWorkspace {
            root: "D:/old-library".into(),
            last_opened_at_ms: 1,
        }],
        theme: Some("dark".into()),
        ..Default::default()
    };
    paths.store_settings(&mut settings);
    neuink_workspace::atomic_write_json(paths.data.join("settings.json"), &settings).unwrap();
    let destination = tempfile::tempdir().unwrap();
    let moved = destination.path().join("移动后的 Neuink");
    fs::rename(root.path(), &moved).unwrap();
    let next = PortablePaths::detect(&moved.join("Neuink.exe"))
        .unwrap()
        .unwrap();
    let mut restored: AppSettings =
        serde_json::from_slice(&fs::read(next.data.join("settings.json")).unwrap()).unwrap();
    next.resolve_settings(&mut restored).unwrap();
    assert!(restored.workspace_root.is_none());
    assert!(restored.recent_workspaces.is_empty());
    assert_eq!(restored.theme.as_deref(), Some("dark"));
    assert_eq!(
        fs::read_to_string(next.data.join("library/note.md")).unwrap(),
        "user note"
    );
}

#[test]
fn lock_prevents_two_writers_and_releases_without_stale_pid() {
    let (_root, paths) = fixture();
    let guard = paths.lock().unwrap();
    assert!(paths.lock().is_err());
    drop(guard);
    assert!(paths.lock().is_ok());
}

#[test]
fn unwritable_data_fails_without_falling_back_and_legacy_path_cannot_redirect() {
    let (_root, paths) = fixture();
    fs::write(paths.data(), "not a directory").unwrap();
    assert!(paths.lock().is_err());
    for path in ["../outside", "D:/neuink_data", "library-imported"] {
        let mut settings = AppSettings {
            workspace_root: Some(path.into()),
            ..Default::default()
        };
        paths.resolve_settings(&mut settings).unwrap();
        assert!(settings.workspace_root.is_none());
    }
}
