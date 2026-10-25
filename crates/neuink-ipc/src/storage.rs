//! Application storage. Portable installs keep their writable state beside the executable.
pub mod legacy_scan;
mod portable;
pub use portable::PortablePaths;

use neuink_config::AppSettings;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager, Runtime};

pub fn portable<R: Runtime>(app: &AppHandle<R>) -> Option<PortablePaths> {
    app.try_state::<PortablePaths>()
        .map(|state| state.inner().clone())
}

pub fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let directory = match portable(app) {
        Some(paths) => paths.data().to_path_buf(),
        None => app
            .path()
            .app_config_dir()
            .map_err(|_| "无法打开应用配置目录。")?,
    };
    fs::create_dir_all(&directory)
        .map_err(|_| "无法写入配置目录，请检查移动盘是否已连接并可写。")?;
    Ok(directory.join("settings.json"))
}

pub fn default_workspace_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Some(paths) = portable(app) {
        return Ok(paths.data().join("library"));
    }
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "无法打开应用数据目录。")?
        .join("dev-library"))
}

pub fn cache_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    match portable(app) {
        Some(paths) => Ok(paths.data().join("cache")),
        None => app
            .path()
            .app_cache_dir()
            .map_err(|_| "无法打开应用缓存目录。".into()),
    }
}

pub fn read_settings<R: Runtime>(app: &AppHandle<R>) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(AppSettings::default())
        }
        Err(_) => return Err("无法读取设置文件，请检查移动盘是否已连接。".into()),
    };
    let mut settings =
        serde_json::from_slice(&bytes).map_err(|_| "设置文件格式错误，请恢复备份后重试。")?;
    if let Some(paths) = portable(app) {
        paths.resolve_settings(&mut settings)?;
    }
    Ok(settings)
}

pub fn write_settings<R: Runtime>(
    app: &AppHandle<R>,
    settings: &AppSettings,
) -> Result<(), String> {
    let mut saved = settings.clone();
    if let Some(paths) = portable(app) {
        paths.store_settings(&mut saved);
    }
    neuink_workspace::atomic_write_json(settings_path(app)?, &saved)
        .map_err(|_| "设置未保存，请检查移动盘是否可写及剩余空间。".into())
}
