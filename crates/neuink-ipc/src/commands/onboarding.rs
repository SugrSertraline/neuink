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
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = Workspace::open(&request.root).map_err(|e| e.to_string())?;
        prepare_demo(&workspace, &resources)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn prepare_demo(workspace: &Workspace, resources: &Path) -> Result<EntryMeta, String> {
    if let Some(entry) = workspace
        .find_onboarding_demo()
        .map_err(|e| e.to_string())?
    {
        return Ok(entry);
    }
    let read = |name: &str, limit: u64| -> Result<Vec<u8>, String> {
        let file = std::fs::File::open(resources.join(name))
            .map_err(|_| format!("本地演示资料缺少 {name}，请检查安装资源；不会联网下载。"))?;
        let mut bytes = Vec::new();
        file.take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > limit {
            return Err(format!("演示资料 {name} 超过大小限制"));
        }
        Ok(bytes)
    };
    let demo: OnboardingDemo =
        serde_json::from_slice(&read("demo.json", 64 * 1024)?).map_err(|e| e.to_string())?;
    let segments: Vec<neuink_domain::SourceSegment> =
        serde_json::from_slice(&read("segments.json", 5 * 1024 * 1024)?)
            .map_err(|e| e.to_string())?;
    workspace
        .install_onboarding_demo(
            &demo,
            &read("attention-is-all-you-need.pdf", 20 * 1024 * 1024)?,
            &segments,
            &read("mineru.zip", 20 * 1024 * 1024)?,
        )
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_assets_leave_library_unchanged_without_network_fallback() {
        let temp = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(temp.path()).unwrap();
        let error = prepare_demo(&workspace, &temp.path().join("missing")).unwrap_err();
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
        let original = workspace.create_entry("Attention Is All You Need").unwrap();
        let entry = prepare_demo(&workspace, &resources).unwrap();
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
        let reused = prepare_demo(&workspace, &temp.path().join("missing")).unwrap();
        assert_eq!(entry.id, reused.id);
        assert_eq!(
            workspace.read_note(&entry.id, note_id).unwrap().markdown,
            "保持用户编辑"
        );
        assert_eq!(workspace.list_entries().unwrap().len(), 2);
    }
}
