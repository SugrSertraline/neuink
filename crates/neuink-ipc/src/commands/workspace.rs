use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use neuink_config::{AppSettings, RecentWorkspace, TranslationAutomationSettings};
use neuink_domain::{EntryMeta, TagMeta};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
pub(crate) use crate::storage::read_settings;
use crate::storage::{default_workspace_root, write_settings};

#[derive(Debug, Deserialize)]
pub struct CreateWorkspaceRequest {
    pub root: PathBuf,
}

#[derive(Debug, Serialize)]
pub struct CreateWorkspaceResponse {
    pub root: PathBuf,
}

#[derive(Debug, Serialize)]
pub struct OpenDevWorkspaceResponse {
    pub root: PathBuf,
    pub entries: Vec<EntryMeta>,
    pub trashed_entries: Vec<EntryMeta>,
    pub tags: Vec<TagMeta>,
}

#[derive(Debug, Deserialize)]
pub struct SetWorkspaceRootRequest {
    pub root: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspacePathKind {
    ValidWorkspace,
    EmptyDirectory,
    NotWorkspace,
    InvalidWorkspace,
    SameAsCurrent,
}

#[derive(Debug, Serialize)]
pub struct WorkspacePathInspection {
    pub root: PathBuf,
    pub kind: WorkspacePathKind,
    pub entry_count: usize,
    pub trashed_entry_count: usize,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct ForgetRecentWorkspaceRequest {
    pub root: String,
}

#[derive(Debug, Serialize)]
pub struct WorkspaceSettingsResponse {
    pub data_root: Option<PathBuf>,
    pub legacy_import_notice: Option<String>,
    pub default_root: PathBuf,
    pub root: PathBuf,
    pub custom_root: Option<PathBuf>,
    pub translation_automation: TranslationAutomationSettings,
    pub recent_workspaces: Vec<RecentWorkspace>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTranslationAutomationSettingsRequest {
    pub auto_translate_pdf: bool,
    #[serde(default)]
    pub segment_types: Vec<String>,
}

#[tauri::command]
pub fn create_workspace(
    request: CreateWorkspaceRequest,
) -> Result<CreateWorkspaceResponse, String> {
    let root = normalize_target_path(&request.root)?;
    ensure_empty_target_dir(&root)?;
    let workspace =
        neuink_workspace::Workspace::create(&root).map_err(|error| error.to_string())?;
    Ok(CreateWorkspaceResponse {
        root: workspace.layout().root().to_path_buf(),
    })
}

#[tauri::command]
pub fn open_dev_workspace<R: Runtime>(
    app: AppHandle<R>,
) -> Result<OpenDevWorkspaceResponse, String> {
    let mut settings = read_settings(&app)?;
    let custom_root = settings
        .workspace_root
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from);
    let workspace = if let Some(root) = custom_root {
        neuink_workspace::Workspace::open_existing(root).map_err(|error| error.to_string())?
    } else {
        let root = default_workspace_root(&app)?;
        if root.join("neuink.workspace.json").is_file() {
            neuink_workspace::Workspace::open_existing(root).map_err(|error| error.to_string())?
        } else {
            neuink_workspace::Workspace::create(root).map_err(|error| error.to_string())?
        }
    };
    remember_workspace(&mut settings, workspace.layout().root());
    write_settings(&app, &settings)?;
    open_workspace_response(&app, workspace)
}

#[tauri::command]
pub fn inspect_workspace_path<R: Runtime>(
    app: AppHandle<R>,
    request: SetWorkspaceRootRequest,
) -> Result<WorkspacePathInspection, String> {
    let current_root = current_workspace_root(&app).ok();
    inspect_workspace_path_value(&request.root, current_root.as_deref())
}

#[tauri::command]
pub fn get_workspace_settings<R: Runtime>(
    app: AppHandle<R>,
) -> Result<WorkspaceSettingsResponse, String> {
    let settings = read_settings(&app)?;
    let default_root = default_workspace_root(&app)?;
    let custom_root = settings
        .workspace_root
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from);
    Ok(WorkspaceSettingsResponse {
        data_root: crate::storage::portable(&app).map(|paths| paths.data().to_path_buf()),
        legacy_import_notice: app.try_state::<crate::storage::legacy_scan::ScanReport>().and_then(|report| report.description()),
        root: custom_root.clone().unwrap_or_else(|| default_root.clone()),
        default_root,
        custom_root,
        translation_automation: settings.translation_automation,
        recent_workspaces: settings.recent_workspaces,
    })
}

#[tauri::command]
pub fn forget_recent_workspace<R: Runtime>(
    app: AppHandle<R>,
    request: ForgetRecentWorkspaceRequest,
) -> Result<WorkspaceSettingsResponse, String> {
    let mut settings = read_settings(&app)?;
    settings
        .recent_workspaces
        .retain(|item| !same_path_text(&item.root, &request.root));
    write_settings(&app, &settings)?;
    get_workspace_settings(app)
}

#[tauri::command]
pub fn update_translation_automation_settings<R: Runtime>(
    app: AppHandle<R>,
    request: UpdateTranslationAutomationSettingsRequest,
) -> Result<WorkspaceSettingsResponse, String> {
    let mut settings = read_settings(&app)?;
    settings.translation_automation = TranslationAutomationSettings {
        auto_translate_pdf: request.auto_translate_pdf,
        segment_types: request
            .segment_types
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect(),
    };
    write_settings(&app, &settings)?;
    get_workspace_settings(app)
}

#[tauri::command]
pub fn set_workspace_root<R: Runtime>(
    app: AppHandle<R>,
    request: SetWorkspaceRootRequest,
) -> Result<OpenDevWorkspaceResponse, String> {
    switch_workspace_root_impl(&app, request.root)
}

#[tauri::command]
pub fn switch_workspace_root<R: Runtime>(
    app: AppHandle<R>,
    request: SetWorkspaceRootRequest,
) -> Result<OpenDevWorkspaceResponse, String> {
    switch_workspace_root_impl(&app, request.root)
}

#[tauri::command]
pub fn create_and_set_workspace_root<R: Runtime>(
    app: AppHandle<R>,
    request: SetWorkspaceRootRequest,
) -> Result<OpenDevWorkspaceResponse, String> {
    reject_fixed_data_location(&app)?;
    let root = normalize_target_path(&request.root)?;
    ensure_empty_target_dir(&root)?;
    let workspace =
        neuink_workspace::Workspace::create(&root).map_err(|error| error.to_string())?;
    let mut settings = read_settings(&app)?;
    set_active_workspace(&mut settings, workspace.layout().root());
    write_settings(&app, &settings)?;
    open_workspace_response(&app, workspace)
}

#[tauri::command]
pub fn reset_workspace_root<R: Runtime>(
    app: AppHandle<R>,
) -> Result<OpenDevWorkspaceResponse, String> {
    let root = default_workspace_root(&app)?;
    let workspace = if root.join("neuink.workspace.json").is_file() {
        neuink_workspace::Workspace::open_existing(root).map_err(|error| error.to_string())?
    } else {
        neuink_workspace::Workspace::create(root).map_err(|error| error.to_string())?
    };
    let mut settings = read_settings(&app)?;
    settings.workspace_root = None;
    remember_workspace(&mut settings, workspace.layout().root());
    write_settings(&app, &settings)?;
    open_workspace_response(&app, workspace)
}

fn switch_workspace_root_impl<R: Runtime>(
    app: &AppHandle<R>,
    root: PathBuf,
) -> Result<OpenDevWorkspaceResponse, String> {
    reject_fixed_data_location(app)?;
    let inspection = inspect_workspace_path_value(&root, Some(&current_workspace_root(app)?))?;
    if !matches!(inspection.kind, WorkspacePathKind::ValidWorkspace) {
        return Err(inspection.message);
    }
    let workspace = neuink_workspace::Workspace::open_existing(&inspection.root)
        .map_err(|error| error.to_string())?;
    let mut settings = read_settings(app)?;
    set_active_workspace(&mut settings, workspace.layout().root());
    write_settings(app, &settings)?;
    open_workspace_response(app, workspace)
}

fn inspect_workspace_path_value(
    requested_root: &Path,
    current_root: Option<&Path>,
) -> Result<WorkspacePathInspection, String> {
    if requested_root.as_os_str().is_empty() {
        return Err("工作区路径不能为空。".to_string());
    }
    let root = normalize_target_path(requested_root)?;
    if let Some(current_root) = current_root {
        if current_root.exists() && canonicalize_existing(current_root)? == root {
            return Ok(WorkspacePathInspection {
                root: display_path(&root),
                kind: WorkspacePathKind::SameAsCurrent,
                entry_count: 0,
                trashed_entry_count: 0,
                message: "该工作区已经打开。".to_string(),
            });
        }
    }
    if !root.exists() {
        return Ok(WorkspacePathInspection {
            root: display_path(&root),
            kind: WorkspacePathKind::EmptyDirectory,
            entry_count: 0,
            trashed_entry_count: 0,
            message: "该目录尚不存在，可以在这里新建工作区。".to_string(),
        });
    }
    if !root.is_dir() {
        return Ok(WorkspacePathInspection {
            root: display_path(&root),
            kind: WorkspacePathKind::NotWorkspace,
            entry_count: 0,
            trashed_entry_count: 0,
            message: "所选路径不是文件夹。".to_string(),
        });
    }
    let marker = root.join("neuink.workspace.json");
    if !marker.is_file() {
        let is_empty = fs::read_dir(&root)
            .map_err(|error| error.to_string())?
            .next()
            .is_none();
        return Ok(WorkspacePathInspection {
            root: display_path(&root),
            kind: if is_empty {
                WorkspacePathKind::EmptyDirectory
            } else {
                WorkspacePathKind::NotWorkspace
            },
            entry_count: 0,
            trashed_entry_count: 0,
            message: if is_empty {
                "这是空文件夹，可以在这里新建工作区。".to_string()
            } else {
                "该文件夹不是 Neuink 工作区。为避免写入普通目录，请选择已有工作区或空文件夹。"
                    .to_string()
            },
        });
    }
    match neuink_workspace::Workspace::open_existing(&root) {
        Ok(workspace) => {
            let entries = workspace
                .list_entries()
                .map_err(|error| error.to_string())?;
            let trashed_entries = workspace
                .list_trashed_entries()
                .map_err(|error| error.to_string())?;
            Ok(WorkspacePathInspection {
                root: display_path(workspace.layout().root()),
                kind: WorkspacePathKind::ValidWorkspace,
                entry_count: entries.len(),
                trashed_entry_count: trashed_entries.len(),
                message: "已识别 Neuink 工作区。".to_string(),
            })
        }
        Err(error) => Ok(WorkspacePathInspection {
            root: display_path(&root),
            kind: WorkspacePathKind::InvalidWorkspace,
            entry_count: 0,
            trashed_entry_count: 0,
            message: format!("工作区文件无法读取：{error}"),
        }),
    }
}

fn set_active_workspace(settings: &mut AppSettings, root: &Path) {
    settings.workspace_root = Some(display_path(root).to_string_lossy().to_string());
    remember_workspace(settings, root);
}

fn remember_workspace(settings: &mut AppSettings, root: &Path) {
    let root = display_path(root).to_string_lossy().to_string();
    settings
        .recent_workspaces
        .retain(|item| !same_path_text(&item.root, &root));
    settings.recent_workspaces.insert(
        0,
        RecentWorkspace {
            root,
            last_opened_at_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or_default(),
        },
    );
    settings.recent_workspaces.truncate(8);
}

fn same_path_text(left: &str, right: &str) -> bool {
    if cfg!(windows) {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

fn open_workspace_response<R: Runtime>(
    app: &AppHandle<R>,
    workspace: neuink_workspace::Workspace,
) -> Result<OpenDevWorkspaceResponse, String> {
    // Picker grants last only for that process. Restore access to this verified
    // library on startup too, including UNC shares and arbitrary mapped drives.
    app.asset_protocol_scope()
        .allow_directory(workspace.layout().root(), true)
        .map_err(|_| "无法启用资料库图片访问，请重新打开资料库。".to_string())?;
    let entries = workspace
        .list_entries()
        .map_err(|error| error.to_string())?;
    let trashed_entries = workspace
        .list_trashed_entries()
        .map_err(|error| error.to_string())?;
    let tags = workspace.list_tags().map_err(|error| error.to_string())?;

    Ok(OpenDevWorkspaceResponse {
        root: workspace.layout().root().to_path_buf(),
        entries,
        trashed_entries,
        tags,
    })
}

pub(crate) fn current_workspace_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let settings = read_settings(app)?;
    Ok(settings
        .workspace_root
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or(default_workspace_root(app)?))
}

fn canonicalize_existing(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path)
        .map_err(|error| format!("无法读取当前工作区路径 {}: {error}", path.to_string_lossy()))
}

fn normalize_target_path(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return fs::canonicalize(path)
            .map_err(|error| format!("无法读取目标路径 {}: {error}", path.to_string_lossy()));
    }
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| "目标路径需要包含父目录。".to_string())?;
    let parent = fs::canonicalize(parent)
        .map_err(|error| format!("无法读取目标父目录 {}: {error}", parent.to_string_lossy()))?;
    let name = path
        .file_name()
        .ok_or_else(|| "目标路径需要包含目录名。".to_string())?;
    Ok(parent.join(name))
}

fn ensure_empty_target_dir(path: &Path) -> Result<(), String> {
    if path.exists() {
        if !path.is_dir() {
            return Err("目标路径已存在，但不是目录。".to_string());
        }
        let mut entries = fs::read_dir(path).map_err(|error| error.to_string())?;
        if entries.next().is_some() {
            return Err("目标目录已存在且不为空。请选择空目录或新目录。".to_string());
        }
    } else {
        fs::create_dir_all(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
fn display_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(stripped) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{stripped}"));
    }
    if let Some(stripped) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }
    path.to_path_buf()
}

#[cfg(not(windows))]
fn display_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn network_workspace_paths_remain_absolute_when_saved() {
        for (input, expected) in [
            (r"\\?\UNC\office\NeuInk\资料库", r"\\office\NeuInk\资料库"),
            (r"\\office\NeuInk\资料库", r"\\office\NeuInk\资料库"),
            (r"\\?\D:\neuink_data", r"D:\neuink_data"),
            (r"Z:\", r"Z:\"),
        ] {
            let root = display_path(Path::new(input));
            assert_eq!(root, PathBuf::from(expected));
            assert!(root.is_absolute());
            let mut settings = AppSettings::default();
            set_active_workspace(&mut settings, Path::new(input));
            let saved = serde_json::to_vec(&settings).expect("serialize settings");
            let restored: AppSettings = serde_json::from_slice(&saved).expect("restore settings");
            assert_eq!(restored.workspace_root.as_deref(), Some(expected));
            assert_eq!(restored.recent_workspaces[0].root, expected);
        }
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "Requires an accessible localhost administrative SMB share; synthetic workspace only"]
    fn real_smb_workspace_round_trip_smoke() {
        let temp = tempfile::tempdir().expect("synthetic workspace directory");
        let local = temp.path().join("library");
        neuink_workspace::Workspace::create(&local).expect("create synthetic workspace");
        let absolute = display_path(&fs::canonicalize(&local).expect("canonical local path"));
        let text = absolute.to_str().expect("local path text");
        assert_eq!(text.as_bytes().get(1), Some(&b':'));
        let remote = PathBuf::from(format!(r"\\localhost\{}${}", &text[..1], &text[2..]));
        let inspected = inspect_workspace_path_value(&remote, None).expect("inspect over SMB");
        assert!(matches!(inspected.kind, WorkspacePathKind::ValidWorkspace));
        assert!(inspected.root.is_absolute());
        let mut settings = AppSettings::default();
        set_active_workspace(&mut settings, &inspected.root);
        let saved = serde_json::to_vec(&settings).expect("serialize network workspace");
        let restored: AppSettings =
            serde_json::from_slice(&saved).expect("restore network workspace");
        let reopened = neuink_workspace::Workspace::open_existing(restored.workspace_root.unwrap())
            .expect("reopen saved SMB workspace");
        let shared_note = reopened.layout().root().join("connection-test.md");
        for contents in [b"first write".as_slice(), b"updated from remote".as_slice()] {
            neuink_workspace::atomic_write(&shared_note, contents)
                .expect("atomic write through SMB");
            assert_eq!(
                fs::read(local.join("connection-test.md")).unwrap(),
                contents
            );
        }
    }

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "neuink-workspace-path-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ))
    }

    #[test]
    fn inspection_distinguishes_workspace_empty_and_ordinary_directories() {
        let valid = test_root("valid");
        let empty = test_root("empty");
        let ordinary = test_root("ordinary");
        neuink_workspace::Workspace::create(&valid).expect("valid workspace");
        fs::create_dir_all(&empty).expect("empty directory");
        fs::create_dir_all(&ordinary).expect("ordinary directory");
        fs::write(ordinary.join("unrelated.txt"), b"keep me").expect("ordinary file");

        let valid_result = inspect_workspace_path_value(&valid, None).expect("inspect valid");
        let empty_result = inspect_workspace_path_value(&empty, None).expect("inspect empty");
        let ordinary_result =
            inspect_workspace_path_value(&ordinary, None).expect("inspect ordinary");

        assert!(matches!(
            valid_result.kind,
            WorkspacePathKind::ValidWorkspace
        ));
        assert!(matches!(
            empty_result.kind,
            WorkspacePathKind::EmptyDirectory
        ));
        assert!(matches!(
            ordinary_result.kind,
            WorkspacePathKind::NotWorkspace
        ));
        assert!(!ordinary.join("neuink.workspace.json").exists());

        fs::remove_dir_all(valid).expect("cleanup valid");
        fs::remove_dir_all(empty).expect("cleanup empty");
        fs::remove_dir_all(ordinary).expect("cleanup ordinary");
    }

    #[test]
    fn inspection_reports_corrupt_and_current_workspaces_without_mutating_them() {
        let current = test_root("current");
        let corrupt = test_root("corrupt");
        neuink_workspace::Workspace::create(&current).expect("current workspace");
        fs::create_dir_all(&corrupt).expect("corrupt directory");
        fs::write(corrupt.join("neuink.workspace.json"), b"not json").expect("corrupt marker");

        let same_result =
            inspect_workspace_path_value(&current, Some(&current)).expect("inspect same");
        let corrupt_result = inspect_workspace_path_value(&corrupt, None).expect("inspect corrupt");

        assert!(matches!(same_result.kind, WorkspacePathKind::SameAsCurrent));
        assert!(matches!(
            corrupt_result.kind,
            WorkspacePathKind::InvalidWorkspace
        ));
        assert_eq!(
            fs::read(corrupt.join("neuink.workspace.json")).expect("read marker"),
            b"not json"
        );

        fs::remove_dir_all(current).expect("cleanup current");
        fs::remove_dir_all(corrupt).expect("cleanup corrupt");
    }
}

fn reject_fixed_data_location<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if crate::storage::portable(app).is_some() {
        return Err("数据固定保存在程序文件夹内，不能切换到外部资料库。".into());
    }
    Ok(())
}
