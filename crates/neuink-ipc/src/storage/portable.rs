use neuink_config::AppSettings;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug)]
pub struct PortablePaths {
    pub(super) data: PathBuf,
}

impl PortablePaths {
    pub fn detect(executable: &Path) -> Result<Option<Self>, String> {
        let mut paths = Self::detect_mode(executable, cfg!(target_os = "windows"))?;
        #[cfg(debug_assertions)]
        if let (Some(paths), Some(data_root)) = (
            paths.as_mut(),
            std::env::var_os("NEUINK_DEV_DATA_DIR"),
        ) {
            paths.data = Self::validate_dev_data_root(PathBuf::from(data_root))?;
        }
        Ok(paths)
    }

    #[cfg(debug_assertions)]
    fn validate_dev_data_root(data_root: PathBuf) -> Result<PathBuf, String> {
        if !data_root.is_absolute() || !data_root.join("library").is_dir() {
            return Err("开发数据目录必须是包含 library 的绝对路径。".into());
        }
        Ok(data_root)
    }

    fn detect_mode(executable: &Path, windows_install: bool) -> Result<Option<Self>, String> {
        let root = executable.parent().ok_or("无法确定程序所在目录。")?;
        // Windows builds always keep data beside the executable, installed or unpacked.
        // Explicit markers let development/native smoke tests opt into the same isolated layout.
        if !windows_install {
            let marker = root.join("neuink.portable.json");
            let file = match fs::File::open(marker) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(_) => return Err("无法读取程序数据标记。".into()),
            };
            let mut bytes = Vec::new();
            file.take(4097)
                .read_to_end(&mut bytes)
                .map_err(|_| "无法读取程序数据标记。")?;
            let marker: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(|_| "程序数据标记损坏。")?;
            if bytes.len() > 4096 || marker["version"].as_u64() != Some(1) {
                return Err("程序数据标记版本无效。".into());
            }
        }
        Ok(Some(Self {
            data: root.join("data"),
        }))
    }

    pub fn data(&self) -> &Path {
        &self.data
    }

    /// An OS file lock is released on normal exit or process crash, without stale PID cleanup.
    pub fn lock(&self) -> Result<fs::File, String> {
        fs::create_dir_all(&self.data)
            .map_err(|_| "程序目录无法写入 data，请将 Neuink 安装或解压到当前用户可写的文件夹。")?;
        let file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(self.data.join("neuink.lock"))
            .map_err(|_| "便携目录无法写入，请检查移动盘连接、权限及剩余空间。")?;
        file.try_lock().map_err(|_| {
            "此便携资料目录正在使用，或移动盘不支持文件锁。请先关闭已打开的 Neuink。"
        })?;
        Ok(file)
    }

    pub fn initialization_script(&self) -> Result<String, String> {
        let value = serde_json::to_string(&self.data).map_err(|_| "便携目录名称无法读取。")?;
        let mut imported_library = "library".to_string();
        let imported = match fs::File::open(self.data.join("imported-profile.json")) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(4097)
                    .read_to_end(&mut bytes)
                    .map_err(|_| "无法读取旧阅读偏好的迁移记录。")?;
                let record: serde_json::Value =
                    serde_json::from_slice(&bytes).map_err(|_| "旧阅读偏好的迁移记录损坏。")?;
                let root = record["workspaceRoot"]
                    .as_str()
                    .filter(|root| !root.is_empty() && root.len() <= 2048)
                    .ok_or("旧阅读偏好的迁移记录格式无效。")?;
                if bytes.len() > 4096 {
                    return Err("旧阅读偏好的迁移记录过大。".into());
                }
                if let Some(library) = record["library"].as_str() {
                    if library.is_empty()
                        || library.len() > 128
                        || !library
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || c == '-')
                    {
                        return Err("旧阅读偏好的迁移目标无效。".into());
                    }
                    imported_library = library.into();
                }
                serde_json::to_string(root).map_err(|_| "旧阅读偏好的迁移记录格式无效。")?
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => "null".into(),
            Err(_) => return Err("无法读取旧阅读偏好的迁移记录。".into()),
        };
        let identity = serde_json::to_string(&format!("portable:{imported_library}"))
            .map_err(|_| "无法读取迁入资料库位置。")?;
        Ok(format!(";\nif (window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label === 'main') {{ Object.defineProperty(window, '__NEUINK_PORTABLE_DATA__', {{ value: {value} }}); Object.defineProperty(window, '__NEUINK_PORTABLE_IMPORTED_ROOT__', {{ value: {imported} }}); Object.defineProperty(window, '__NEUINK_PORTABLE_IMPORTED_IDENTITY__', {{ value: {identity} }}); }}"))
    }

    pub(super) fn resolve_settings(&self, settings: &mut AppSettings) -> Result<(), String> {
        // Stored legacy/custom paths cannot redirect the fixed package-local library.
        settings.workspace_root = None;
        settings.recent_workspaces.clear();
        Ok(())
    }

    pub(super) fn store_settings(&self, settings: &mut AppSettings) {
        settings.workspace_root = None;
        settings.recent_workspaces.clear();
    }
}

#[cfg(test)]
mod tests;
