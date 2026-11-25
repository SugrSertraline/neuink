use super::*;
use crate::Workspace;

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "neuink-read-only-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn missing_path_and_file_are_rejected_without_initialization() {
    let temp = TestDirectory::new();
    let missing = temp.path().join("missing");
    assert!(matches!(
        validate_workspace_read_only(&missing),
        Err(WorkspaceError::WorkspaceMissing(_))
    ));
    assert!(!missing.exists());
    let file = temp.path().join("file");
    fs::write(&file, "untouched").unwrap();
    assert!(matches!(
        validate_workspace_read_only(&file),
        Err(WorkspaceError::WorkspaceNotDirectory(_))
    ));
    assert_eq!(fs::read_to_string(file).unwrap(), "untouched");
}

#[test]
fn missing_marker_bad_schema_and_pending_journal_are_read_only() {
    let temp = TestDirectory::new();
    assert!(matches!(
        validate_workspace_read_only(temp.path()),
        Err(WorkspaceError::WorkspaceMarkerMissing(_))
    ));
    assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 0);
    let marker = temp.path().join("neuink.workspace.json");
    for contents in [
        "{",
        "{}",
        "{\"schema_version\":99}",
        "{\"schema_version\":1,\"tags\":false}",
    ] {
        fs::write(&marker, contents).unwrap();
        assert!(validate_workspace_read_only(temp.path()).is_err());
        assert_eq!(fs::read_to_string(&marker).unwrap(), contents);
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    }
    fs::write(&marker, "{\"schema_version\":1}").unwrap();
    assert_eq!(
        validate_workspace_read_only(temp.path()).unwrap(),
        temp.path().canonicalize().unwrap()
    );
    assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    let journal = temp.path().join("tag-operation.journal.json");
    fs::write(&journal, "pending-journal-evidence").unwrap();
    assert!(validate_workspace_read_only(temp.path())
        .unwrap_err()
        .to_string()
        .contains("事务"));
    assert_eq!(
        fs::read_to_string(journal).unwrap(),
        "pending-journal-evidence"
    );
}

#[test]
fn original_open_still_repairs_layout_after_read_only_validation() {
    let temp = TestDirectory::new();
    Workspace::create(temp.path()).unwrap();
    let conversations = temp.path().join("conversations");
    fs::remove_dir(&conversations).unwrap();
    validate_workspace_read_only(temp.path()).unwrap();
    assert!(!conversations.exists());
    Workspace::open_existing(temp.path()).unwrap();
    assert!(conversations.is_dir());
}
