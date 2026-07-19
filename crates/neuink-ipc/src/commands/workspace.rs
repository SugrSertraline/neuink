use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use neuink_config::{AppSettings, RecentWorkspace, TranslationAutomationSettings};
use neuink_domain::{EntryMeta, TagMeta};
use neuink_workspace::atomic_write_json;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

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
pub struct MigrateWorkspaceRootRequest {
    pub root: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct ForgetRecentWorkspaceRequest {
    pub root: String,
}

#[derive(Debug, Serialize)]
pub struct WorkspaceSettingsResponse {
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

#[derive(Debug, Serialize)]
pub struct MigrateWorkspaceRootResponse {
    pub from_root: PathBuf,
    pub root: PathBuf,
    pub restart_requested: bool,
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
    open_workspace_response(workspace)
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
    let root = normalize_target_path(&request.root)?;
    ensure_empty_target_dir(&root)?;
    let workspace =
        neuink_workspace::Workspace::create(&root).map_err(|error| error.to_string())?;
    let mut settings = read_settings(&app)?;
    set_active_workspace(&mut settings, workspace.layout().root());
    write_settings(&app, &settings)?;
    open_workspace_response(workspace)
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
    open_workspace_response(workspace)
}

#[tauri::command]
pub fn migrate_workspace_root<R: Runtime>(
    app: AppHandle<R>,
    request: MigrateWorkspaceRootRequest,
) -> Result<MigrateWorkspaceRootResponse, String> {
    let from_root = current_workspace_root(&app)?;
    let to_root = request.root;
    if to_root.as_os_str().is_empty() {
        return Err("workspace path is required".to_string());
    }

    let from_root = canonicalize_existing(&from_root)?;
    let to_root = normalize_target_path(&to_root)?;
    if from_root == to_root {
        return Err("目标路径已经是当前工作区。".to_string());
    }
    if to_root.starts_with(&from_root) {
        return Err("不能把工作区迁移到当前工作区的子目录。".to_string());
    }
    ensure_empty_target_dir(&to_root)?;
    copy_dir_recursive(&from_root, &to_root).map_err(|error| {
        format!(
            "迁移复制失败；原工作区未改动，目标目录 {} 可能保留部分文件：{error}",
            to_root.to_string_lossy()
        )
    })?;

    let workspace = neuink_workspace::Workspace::open_existing(&to_root)
        .map_err(|error| format!("工作区复制完成，但验证失败：{error}"))?;
    let mut settings = read_settings(&app)?;
    set_active_workspace(&mut settings, workspace.layout().root());
    write_settings(&app, &settings)?;
    app.request_restart();

    Ok(MigrateWorkspaceRootResponse {
        from_root,
        root: workspace.layout().root().to_path_buf(),
        restart_requested: true,
    })
}

fn switch_workspace_root_impl<R: Runtime>(
    app: &AppHandle<R>,
    root: PathBuf,
) -> Result<OpenDevWorkspaceResponse, String> {
    let inspection = inspect_workspace_path_value(&root, Some(&current_workspace_root(app)?))?;
    if !matches!(inspection.kind, WorkspacePathKind::ValidWorkspace) {
        return Err(inspection.message);
    }
    let workspace = neuink_workspace::Workspace::open_existing(&inspection.root)
        .map_err(|error| error.to_string())?;
    let mut settings = read_settings(app)?;
    set_active_workspace(&mut settings, workspace.layout().root());
    write_settings(app, &settings)?;
    open_workspace_response(workspace)
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

fn open_workspace_response(
    workspace: neuink_workspace::Workspace,
) -> Result<OpenDevWorkspaceResponse, String> {
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

fn default_workspace_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("dev-library"))
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

pub(crate) fn read_settings<R: Runtime>(app: &AppHandle<R>) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

fn write_settings<R: Runtime>(app: &AppHandle<R>, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    atomic_write_json(path, settings).map_err(|error| error.to_string())
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;
    Ok(config_dir.join("settings.json"))
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

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(from).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            copy_dir_recursive(&source, &target)?;
        } else if file_type.is_file() {
            fs::copy(&source, &target).map_err(|error| {
                format!(
                    "复制文件失败 {} -> {}: {error}",
                    source.to_string_lossy(),
                    target.to_string_lossy()
                )
            })?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn display_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
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
