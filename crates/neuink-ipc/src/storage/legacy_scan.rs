use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Default, Serialize)]
pub struct ScanReport {
    pub imported: usize,
    pub recycled: usize,
    pub conflicts: usize,
    pub errors: Vec<String>,
}

impl ScanReport {
    pub fn description(&self) -> Option<String> {
        if self.imported == 0 && self.errors.is_empty() {
            return None;
        }
        Some(format!("本次启动已合并 {} 个旧资料库，{} 个旧目录已放入回收站；保留当前数据，跳过 {} 项冲突。{}",
            self.imported, self.recycled, self.conflicts,
            if self.errors.is_empty() { String::new() } else { format!(" {}", self.errors.join(" ")) }))
    }
}

/// Only two explicit locations: sibling of the program directory and root of its local drive.
pub fn candidates(executable: &Path) -> Vec<PathBuf> {
    let Some(program) = executable.parent() else {
        return Vec::new();
    };
    let mut paths = Vec::new();
    if let Some(parent) = program.parent() {
        paths.push(parent.join("neuink_data"));
    }
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        if let Some(Component::Prefix(prefix)) = executable.components().next() {
            if let Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) = prefix.kind() {
                let root = PathBuf::from(format!("{}:\\neuink_data", drive as char));
                if !paths.iter().any(|path| {
                    path.to_string_lossy()
                        .eq_ignore_ascii_case(&root.to_string_lossy())
                }) {
                    paths.push(root);
                }
            }
        }
    }
    paths
}

pub fn scan(executable: &Path, data: &Path) -> Result<ScanReport, String> {
    // Recovery errors stop startup: do not create a new empty library over an interrupted publish.
    neuink_workspace::legacy_import::recover(data)?;
    let report = scan_candidates(&candidates(executable), data, recycle);
    neuink_workspace::legacy_import::recover(data)?;
    Ok(report)
}

fn scan_candidates(
    sources: &[PathBuf],
    data: &Path,
    mut recycle: impl FnMut(&Path) -> Result<(), String>,
) -> ScanReport {
    let mut report = ScanReport::default();
    let mut seen = std::collections::BTreeSet::new();
    for source in sources {
        if !source.exists() {
            continue;
        }
        let result = (|| {
            // A directory with this name but no Neuink marker is never removed.
            if !source.join("neuink.workspace.json").is_file() {
                return Err("发现同名文件夹但不是 Neuink 资料库，已保留。".into());
            }
            let canonical = std::fs::canonicalize(source).map_err(|_| "旧目录不可读，已保留。")?;
            if !seen.insert(canonical) {
                return Ok(());
            }
            let imported = neuink_workspace::legacy_import::merge(source, data)?;
            report.imported += 1;
            report.conflicts += imported.conflicts;
            if !imported.source_unchanged(source)? {
                return Err("旧资料整理后又发生变化，原目录未清理。".into());
            }
            recycle(source)?;
            report.recycled += 1;
            Ok::<_, String>(())
        })();
        if let Err(error) = result {
            report.errors.push(error);
        }
    }
    report
}

#[cfg(windows)]
fn recycle(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::{System::Com::*, UI::Shell::*},
    };
    let path = path.to_path_buf();
    // A dedicated apartment cannot conflict with Tauri/WebView's COM initialization.
    std::thread::spawn(move || unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|_| "无法启动系统回收站，旧目录已保留。")?;
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe {
                    CoUninitialize();
                }
            }
        }
        let _apartment = Apartment;
        let operation = (|| -> windows::core::Result<()> {
            let files: IFileOperation =
                CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)?;
            // WANTNUKEWARNING + NOERRORUI cancels when recycling isn't possible rather than
            // silently converting the operation into permanent deletion (e.g. a removable disk).
            files.SetOperationFlags(
                FOF_NO_UI
                    | FOF_ALLOWUNDO
                    | FOF_WANTNUKEWARNING
                    | FOFX_RECYCLEONDELETE
                    | FOFX_EARLYFAILURE,
            )?;
            let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)?;
            files.DeleteItem(&item, None)?;
            files.PerformOperations()?;
            if files.GetAnyOperationsAborted()?.as_bool() || path.exists() {
                return Err(windows::core::Error::from_hresult(
                    windows::Win32::Foundation::E_ABORT,
                ));
            }
            Ok(())
        })();
        operation
            .map_err(|_| "资料已合并，但旧目录无法放入回收站，已保留；不会永久删除。".to_string())
    })
    .join()
    .map_err(|_| "系统回收站操作未完成，旧目录已保留。".to_string())?
}

#[cfg(not(windows))]
fn recycle(_path: &Path) -> Result<(), String> {
    Err("当前平台未启用旧目录回收，原目录已保留。".into())
}

#[cfg(test)]
mod tests;
