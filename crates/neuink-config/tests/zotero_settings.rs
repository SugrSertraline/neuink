use neuink_config::{AppSettings, ZoteroSettings};

#[test]
fn old_settings_remain_readable_and_zotero_paths_round_trip() {
    let mut settings: AppSettings =
        serde_json::from_str(r#"{"workspace_root":"D:\\资料","theme":"slate"}"#).unwrap();
    assert_eq!(settings.zotero, ZoteroSettings::default());
    settings.zotero = ZoteroSettings {
        data_directory: Some(r"D:\文献资料\Zotero".into()),
        linked_attachment_directory: Some(r"E:\附件".into()),
    };
    let restored: AppSettings =
        serde_json::from_str(&serde_json::to_string(&settings).unwrap()).unwrap();
    assert_eq!(restored, settings);
    assert_eq!(restored.workspace_root.as_deref(), Some(r"D:\资料"));
    assert_eq!(restored.theme.as_deref(), Some("slate"));
}
