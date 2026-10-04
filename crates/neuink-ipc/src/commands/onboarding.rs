//! Offline, complete onboarding demo; workspace owns all persistence.
use neuink_domain::EntryMeta;
use neuink_workspace::{onboarding::OnboardingDemo, Workspace};
use serde::Deserialize;
use std::{
    io::Read,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Deserialize)]
pub struct ImportOnboardingPaperRequest {
    pub root: PathBuf,
}

#[tauri::command]
pub async fn import_onboarding_paper<R: Runtime>(
    app: AppHandle<R>,
    request: ImportOnboardingPaperRequest,
) -> Result<EntryMeta, String> {
    let resources = app
        .path()
        .resolve("resources/onboarding", tauri::path::BaseDirectory::Resource)
        .map_err(|_| "缺少演示数据，无法演示：无法定位安装资源。".to_string())?;
    let availability = app
        .path()
        .resolve(
            "resources/onboarding-availability.json",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|_| "缺少演示数据，无法演示：无法定位演示资源状态。".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = Workspace::open(&request.root).map_err(|e| e.to_string())?;
        prepare_demo(&workspace, &resources, &availability)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn validate_availability(path: &Path) -> Result<(), String> {
    #[derive(Deserialize)]
    struct Availability {
        version: u32,
        included: bool,
    }
    let unavailable =
        || "缺少演示数据，无法演示：安装包未包含有效的演示资源状态；不会联网下载。".to_string();
    let file = std::fs::File::open(path).map_err(|_| unavailable())?;
    let mut bytes = Vec::new();
    file.take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| unavailable())?;
    if bytes.len() > 4096 {
        return Err(unavailable());
    }
    let availability: Availability = serde_json::from_slice(&bytes).map_err(|_| unavailable())?;
    if availability.version != 1 || !availability.included {
        return Err(unavailable());
    }
    Ok(())
}

fn prepare_demo(
    workspace: &Workspace,
    resources: &Path,
    availability: &Path,
) -> Result<EntryMeta, String> {
    // Tauri's incremental resource copy can leave an older bundle behind. Only
    // this build's explicit availability marker may authorize reading it.
    validate_availability(availability)?;
    // Re-read the complete bundle on every entry attempt, even if the workspace
    // already contains an edited demo. A cached entry is not resource validation.
    let read = |name: &str, limit: u64| -> Result<Vec<u8>, String> {
        let file = std::fs::File::open(resources.join(name)).map_err(|_| {
            format!(
                "缺少演示数据，无法演示：本地演示资料缺少 {name}，请检查安装资源；不会联网下载。"
            )
        })?;
        let mut bytes = Vec::new();
        file.take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| format!("缺少演示数据，无法演示：无法读取 {name}。"))?;
        if bytes.len() as u64 > limit {
            return Err(format!(
                "缺少演示数据，无法演示：演示资料 {name} 超过大小限制。"
            ));
        }
        Ok(bytes)
    };
    let notice = read("NOTICE.txt", 64 * 1024)?;
    if std::str::from_utf8(&notice).map_or(true, |text| text.trim().is_empty()) {
        return Err("缺少演示数据，无法演示：演示资料说明损坏。".to_string());
    }
    let demo: OnboardingDemo = serde_json::from_slice(&read("demo.json", 64 * 1024)?)
        .map_err(|_| "缺少演示数据，无法演示：演示资源清单损坏。".to_string())?;
    let segments: Vec<neuink_domain::SourceSegment> =
        serde_json::from_slice(&read("segments.json", 5 * 1024 * 1024)?)
            .map_err(|_| "缺少演示数据，无法演示：演示解析片段损坏。".to_string())?;
    workspace
        .install_onboarding_demo(
            &demo,
            &read("attention-is-all-you-need.pdf", 20 * 1024 * 1024)?,
            &segments,
            &read("mineru.zip", 20 * 1024 * 1024)?,
        )
        .map_err(|e| {
            let message = e.to_string();
            if message.starts_with("缺少演示数据，无法演示") {
                message
            } else {
                format!("缺少演示数据，无法演示：{message}")
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        io::{Cursor, Write},
    };

    fn write_availability(directory: &Path) -> PathBuf {
        let path = directory.join("onboarding-availability.json");
        fs::write(&path, br#"{"version":1,"included":true}"#).unwrap();
        path
    }

    fn write_fixture(resources: &Path) -> PathBuf {
        fs::create_dir_all(resources).unwrap();
        fs::write(resources.join("NOTICE.txt"), "Local test fixture").unwrap();
        let segment = neuink_domain::SourceSegment::new(
            neuink_domain::SegmentType::Paragraph,
            0,
            Some([10., 10., 500., 100.]),
            "An abstract".into(),
        );
        let pdf = b"%PDF-fixture";
        fs::write(resources.join("attention-is-all-you-need.pdf"), pdf).unwrap();
        fs::write(
            resources.join("segments.json"),
            serde_json::to_vec(&vec![segment.clone()]).unwrap(),
        )
        .unwrap();
        fs::write(resources.join("demo.json"), serde_json::to_vec(&serde_json::json!({
            "version":"attention-v1", "pdf_hash":blake3::hash(pdf).to_hex().to_string(), "segment_uid":segment.uid,
            "note_title":"Demo", "note_markdown":"Example {source}", "segment_note":"Example",
            "annotation":"Example", "translation":"示例译文"
        })).unwrap()).unwrap();
        let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, content) in [
            ("paper_middle.json", r#"{"pdf_info":[{"page_idx":0}]}"#),
            (
                "paper_content_list.json",
                r#"[{"type":"text","text":"An abstract"}]"#,
            ),
        ] {
            archive
                .start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            archive.write_all(content.as_bytes()).unwrap();
        }
        fs::write(
            resources.join("mineru.zip"),
            archive.finish().unwrap().into_inner(),
        )
        .unwrap();
        write_availability(resources.parent().unwrap())
    }

    #[test]
    fn every_prepare_rechecks_resources_even_when_an_edited_demo_already_exists() {
        let temp = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(temp.path().join("workspace")).unwrap();
        let resources = temp.path().join("resources");
        let availability = write_fixture(&resources);
        let entry = prepare_demo(&workspace, &resources, &availability).unwrap();
        let neuink_domain::ContentItem::Note { note_id, .. } = &entry.contents[0];
        workspace
            .update_note(&entry.id, note_id, "My title", "My edits")
            .unwrap();
        for name in [
            "demo.json",
            "segments.json",
            "attention-is-all-you-need.pdf",
            "mineru.zip",
            "NOTICE.txt",
        ] {
            let path = resources.join(name);
            let bytes = fs::read(&path).unwrap();
            fs::remove_file(&path).unwrap();
            assert!(prepare_demo(&workspace, &resources, &availability)
                .unwrap_err()
                .starts_with("缺少演示数据，无法演示"));
            assert_eq!(
                workspace.read_note(&entry.id, note_id).unwrap().markdown,
                "My edits"
            );
            assert_eq!(workspace.list_entries().unwrap().len(), 1);
            fs::write(&path, bytes).unwrap();
            assert_eq!(
                prepare_demo(&workspace, &resources, &availability)
                    .unwrap()
                    .id,
                entry.id
            );
        }
        assert!(prepare_demo(
            &workspace,
            &temp.path().join("another-install-without-assets"),
            &availability,
        )
        .is_err());
        fs::write(resources.join("segments.json"), b"[]").unwrap();
        assert!(prepare_demo(&workspace, &resources, &availability)
            .unwrap_err()
            .starts_with("缺少演示数据，无法演示"));
        assert_eq!(
            workspace.read_note(&entry.id, note_id).unwrap().markdown,
            "My edits"
        );
    }
    #[test]
    fn unavailable_manifest_rejects_stale_bundle_and_preserves_existing_demo_edits() {
        let temp = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(temp.path().join("workspace")).unwrap();
        let resources = temp.path().join("resources");
        let availability = write_fixture(&resources);
        let entry = prepare_demo(&workspace, &resources, &availability).unwrap();
        let neuink_domain::ContentItem::Note { note_id, .. } = &entry.contents[0];
        workspace
            .update_note(&entry.id, note_id, "My title", "My edits")
            .unwrap();
        // A complete stale bundle and a valid installed entry cannot override
        // missing, excluded or invalid state from the current installation.
        for manifest in [
            None,
            Some(r#"{"version":1,"included":false}"#),
            Some(r#"{"version":2,"included":true}"#),
            Some(r#"{"included":true}"#),
            Some(r#"{"version":1,"included":"true"}"#),
            Some("invalid json"),
        ] {
            match manifest {
                Some(content) => fs::write(&availability, content).unwrap(),
                None => fs::remove_file(&availability).unwrap(),
            }
            assert!(prepare_demo(&workspace, &resources, &availability)
                .unwrap_err()
                .starts_with("缺少演示数据，无法演示"));
            assert_eq!(workspace.list_entries().unwrap().len(), 1);
            assert_eq!(
                workspace.read_note(&entry.id, note_id).unwrap().markdown,
                "My edits"
            );
        }
        write_availability(temp.path());
        assert_eq!(
            prepare_demo(&workspace, &resources, &availability)
                .unwrap()
                .id,
            entry.id
        );
        assert_eq!(
            workspace.read_note(&entry.id, note_id).unwrap().markdown,
            "My edits"
        );
    }
    #[test]
    fn missing_assets_leave_library_unchanged_without_network_fallback() {
        let temp = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(temp.path()).unwrap();
        let availability = write_availability(temp.path());
        let error =
            prepare_demo(&workspace, &temp.path().join("missing"), &availability).unwrap_err();
        assert!(error.contains("不会联网下载"));
        assert!(workspace.list_entries().unwrap().is_empty());
    }
    #[test]
    #[ignore = "requires locally supplied PDF and MinerU assets, not distributed in Git"]
    fn real_local_bundle_has_parsing_images_notes_and_rebound_sources() {
        let resources = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src-tauri/resources/onboarding");
        let temp = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(temp.path()).unwrap();
        let availability = write_availability(temp.path());
        let original = workspace.create_entry("Attention Is All You Need").unwrap();
        let entry = prepare_demo(&workspace, &resources, &availability).unwrap();
        assert_ne!(entry.id, original.id);
        assert!(entry.title.contains("演示版"));
        assert_eq!(
            entry.pdf.as_ref().unwrap().parse.status,
            neuink_domain::PdfParseStatus::Succeeded
        );
        assert_eq!(workspace.read_segments(&entry.id).unwrap().len(), 165);
        assert!(workspace
            .read_mineru_middle_json(&entry.id)
            .unwrap()
            .is_some());
        assert!(workspace
            .layout()
            .entry_mineru_output_dir(&entry.id)
            .join("images")
            .is_dir());
        let segments = workspace.read_segments(&entry.id).unwrap();
        let images: Vec<_> = segments
            .iter()
            .filter_map(|segment| segment.asset_path.as_ref())
            .collect();
        assert!(!images.is_empty());
        assert!(images.iter().all(|path| workspace
            .layout()
            .entry_mineru_output_dir(&entry.id)
            .join(path)
            .is_file()));
        assert_eq!(workspace.read_segment_notes(&entry.id).unwrap().len(), 1);
        assert_eq!(workspace.read_annotations(&entry.id).unwrap().len(), 1);
        let neuink_domain::ContentItem::Note { note_id, .. } = &entry.contents[0];
        let note = workspace.read_note(&entry.id, note_id).unwrap();
        assert_eq!(note.links[0].sources[0].entry_id, entry.id);
        assert!(note.markdown.contains(&note.links[0].anchor_id));
        workspace
            .update_note(&entry.id, note_id, "我的修改", "保持用户编辑")
            .unwrap();
        assert!(
            prepare_demo(&workspace, &temp.path().join("missing"), &availability)
                .unwrap_err()
                .starts_with("缺少演示数据，无法演示")
        );
        let reused = prepare_demo(&workspace, &resources, &availability).unwrap();
        assert_eq!(entry.id, reused.id);
        assert_eq!(
            workspace.read_note(&entry.id, note_id).unwrap().markdown,
            "保持用户编辑"
        );
        assert_eq!(workspace.list_entries().unwrap().len(), 2);
    }
}
