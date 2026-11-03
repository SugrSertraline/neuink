use super::*;
use rusqlite::Connection;
use std::fs;

fn fixture() -> (tempfile::TempDir, Connection, SourceSettings) {
    let dir = tempfile::tempdir().unwrap();
    let db = Connection::open(dir.path().join("zotero.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE items(itemID INTEGER, itemTypeID INTEGER, libraryID INTEGER, key TEXT);
        CREATE TABLE itemTypes(itemTypeID INTEGER, typeName TEXT);
        CREATE TABLE deletedItems(itemID INTEGER);
        CREATE TABLE itemAttachments(itemID INTEGER, parentItemID INTEGER, linkMode INTEGER, contentType TEXT, path TEXT);
        CREATE TABLE fields(fieldID INTEGER, fieldName TEXT);
        CREATE TABLE itemData(itemID INTEGER, fieldID INTEGER, valueID INTEGER);
        CREATE TABLE itemDataValues(valueID INTEGER, value TEXT);
        CREATE TABLE creators(creatorID INTEGER, firstName TEXT, lastName TEXT);
        CREATE TABLE itemCreators(itemID INTEGER, creatorID INTEGER, creatorTypeID INTEGER, orderIndex INTEGER);
        CREATE TABLE creatorTypes(creatorTypeID INTEGER, creatorType TEXT);
        CREATE TABLE tags(tagID INTEGER, name TEXT);
        CREATE TABLE itemTags(itemID INTEGER, tagID INTEGER);
        CREATE TABLE collections(collectionID INTEGER, libraryID INTEGER, collectionName TEXT, parentCollectionID INTEGER);
        CREATE TABLE collectionItems(itemID INTEGER, collectionID INTEGER);
        CREATE TABLE groups(libraryID INTEGER, name TEXT);
        CREATE TABLE settings(setting TEXT, key TEXT, value TEXT);
        INSERT INTO settings VALUES('account','localUserKey','fixture-library');
        INSERT INTO itemTypes VALUES(1,'journalArticle'),(2,'attachment'),(3,'note'),(4,'annotation');
        INSERT INTO items VALUES(1,1,1,'PAPER001'),(2,2,1,'FILE0001'),(3,3,1,'NOTE0001'),(4,1,1,'TRASH001'),(5,1,2,'GROUP001');
        INSERT INTO deletedItems VALUES(4);
        INSERT INTO itemAttachments VALUES(2,1,0,'application/pdf','storage:论文.pdf');
        INSERT INTO fields VALUES(1,'title'),(2,'DOI'),(3,'abstractNote'),(4,'date');
        INSERT INTO itemDataValues VALUES(1,'中文论文'),(2,'10.1/test'),(3,'摘要'),(4,'2024-10-01');
        INSERT INTO itemData VALUES(1,1,1),(1,2,2),(1,3,3),(1,4,4);
        INSERT INTO creators VALUES(1,'Ada','Lovelace'),(2,'Grace','Hopper');
        INSERT INTO creatorTypes VALUES(10,'author'),(12,'editor');
        INSERT INTO itemCreators VALUES(1,1,10,0),(1,2,12,1);
        INSERT INTO tags VALUES(1,'time/series'); INSERT INTO itemTags VALUES(1,1);
        INSERT INTO collections VALUES(1,1,'研究',NULL),(2,1,'时间序列',1);
        INSERT INTO collectionItems VALUES(1,2); INSERT INTO groups VALUES(2,'小组');").unwrap();
    fs::create_dir_all(dir.path().join("storage/FILE0001")).unwrap();
    fs::write(
        dir.path().join("storage/FILE0001/论文.pdf"),
        b"%PDF-1.7\nfixture",
    )
    .unwrap();
    let settings = SourceSettings {
        data_directory: Some(dir.path().into()),
        linked_attachment_directory: None,
    };
    (dir, db, settings)
}

#[test]
fn reads_metadata_collections_and_local_files_without_touching_source() {
    let (dir, db, settings) = fixture();
    drop(db);
    let before = fs::read(dir.path().join("zotero.sqlite")).unwrap();
    let library = read_library(&settings).unwrap();
    assert_eq!(library.papers.len(), 2); // Child notes, attachments and trash are not papers.
    let paper = library.papers.iter().find(|p| p.key == "PAPER001").unwrap();
    assert_eq!(paper.title, "中文论文");
    assert_eq!(paper.authors, "Ada Lovelace");
    assert_eq!(paper.fields["zotero_editor"], "Grace Hopper");
    assert_eq!(paper.year, "2024");
    assert_eq!(paper.fields["description"], "摘要");
    assert_eq!(paper.fields["doi"], "10.1/test");
    assert_eq!(paper.tags, vec!["time/series"]);
    assert_eq!(paper.collection_ids.len(), 2);
    assert!(paper.attachments[0].available);
    assert_eq!(library.collections[1].path, "我的文库 / 研究 / 时间序列");
    assert_eq!(before, fs::read(dir.path().join("zotero.sqlite")).unwrap());
}

#[test]
fn snapshot_includes_committed_wal_while_zotero_is_open() {
    let (_dir, db, settings) = fixture();
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE itemDataValues SET value='来自 WAL' WHERE valueID=1;").unwrap();
    let library = read_library(&settings).unwrap();
    assert!(library.papers.iter().any(|p| p.title == "来自 WAL"));
}

#[test]
fn missing_and_relative_linked_files_are_distinct() {
    let (dir, db, mut settings) = fixture();
    db.execute_batch("UPDATE itemAttachments SET linkMode=2,path='attachments:files/paper.pdf';")
        .unwrap();
    let library = read_library(&settings).unwrap();
    let paper = library.papers.iter().find(|p| p.key == "PAPER001").unwrap();
    assert_eq!(
        paper.attachments[0].reason.as_deref(),
        Some("需要设置链接附件基础目录")
    );
    settings.linked_attachment_directory = Some(dir.path().join("wrong"));
    let library = read_library(&settings).unwrap();
    assert_eq!(
        library
            .papers
            .iter()
            .find(|p| p.key == "PAPER001")
            .unwrap()
            .attachments[0]
            .reason
            .as_deref(),
        Some("链接附件未找到，请检查基础目录或文件是否已移动")
    );
    fs::create_dir_all(dir.path().join("linked/files")).unwrap();
    fs::write(dir.path().join("linked/files/paper.pdf"), b"%PDF-").unwrap();
    settings.linked_attachment_directory = Some(dir.path().join("linked"));
    let library = read_library(&settings).unwrap();
    assert!(
        library
            .papers
            .iter()
            .find(|p| p.key == "PAPER001")
            .unwrap()
            .attachments[0]
            .available
    );
}

#[test]
fn stored_paths_cannot_escape_attachment_directory() {
    let (dir, db, settings) = fixture();
    fs::write(dir.path().join("outside.pdf"), b"%PDF-").unwrap();
    db.execute_batch("UPDATE itemAttachments SET path='storage:../../outside.pdf';")
        .unwrap();
    let library = read_library(&settings).unwrap();
    let file = &library
        .papers
        .iter()
        .find(|p| p.key == "PAPER001")
        .unwrap()
        .attachments[0];
    assert!(!file.available);
    assert!(file.path.is_none());
}

#[test]
fn linked_attachment_display_name_omits_internal_prefix() {
    let file = attachments::resolve(
        std::path::Path::new("unused"),
        None,
        "FILE0001".into(),
        2,
        "attachments:paper.pdf".into(),
    );
    assert_eq!(file.file_name, "paper.pdf");
}

#[test]
fn custom_profile_paths_and_escaped_preferences_are_discovered() {
    let (dir, _db, _) = fixture();
    let profiles = tempfile::tempdir().unwrap();
    fs::create_dir(profiles.path().join("custom")).unwrap();
    fs::write(
        profiles.path().join("profiles.ini"),
        "[Profile0]\nPath=custom\nIsRelative=1\nDefault=1",
    )
    .unwrap();
    fs::write(profiles.path().join("custom/prefs.js"), format!("user_pref(\"extensions.zotero.useDataDir\", true);\nuser_pref(\"extensions.zotero.dataDir\", {});\nuser_pref(\"other.setting\", \"ignored\");", serde_json::to_string(dir.path()).unwrap())).unwrap();
    let found = discovery::discover_in(None, Some(profiles.path()));
    assert_eq!(found.len(), 1);
    assert_eq!(
        found[0].data_directory.as_deref(),
        Some(dir.path().canonicalize().unwrap().as_path())
    );
}

#[test]
fn absent_or_unsupported_database_is_not_created_or_migrated() {
    let dir = tempfile::tempdir().unwrap();
    assert!(read_library(&SourceSettings {
        data_directory: Some(dir.path().into()),
        ..Default::default()
    })
    .is_err());
    assert!(!dir.path().join("zotero.sqlite").exists());
    fs::write(dir.path().join("zotero.sqlite"), b"not sqlite").unwrap();
    assert!(read_library(&SourceSettings {
        data_directory: Some(dir.path().into()),
        ..Default::default()
    })
    .is_err());
    assert_eq!(
        fs::read(dir.path().join("zotero.sqlite")).unwrap(),
        b"not sqlite"
    );
}
