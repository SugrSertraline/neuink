//! Install the application's preassembled component. No system Python, shell or pip.
use super::{control, runtime, set_stage};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, io::{Read, Write}, path::{Path, PathBuf}, sync::{Arc, atomic::{AtomicBool, Ordering}}};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::oneshot;
#[path = "component_cleanup.rs"]
mod cleanup;

const ID: &str = "deerflow-2.1.0-9a11f9a-1";
const LIMIT: u64 = 4 * 1024 * 1024 * 1024;
#[derive(Deserialize)]
struct Manifest { component_id: String, platform: String, sha256: String, size: u64, files: BTreeMap<String, String> }
#[derive(Deserialize, Serialize)]
struct Pointer { component_id: String, directory: String }

pub fn environment(cache: &Path) -> PathBuf {
    let base = cache.join("research-components");
    let pointer = fs::read(base.join("current.json")).ok().and_then(|v| serde_json::from_slice::<Pointer>(&v).ok());
    if let Some(p) = pointer.filter(|p| p.component_id == ID && p.directory.strip_prefix(&format!("{ID}-"))
        .is_some_and(|suffix| !suffix.is_empty() && suffix.len() < 100 && suffix.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b)))) {
        return base.join(p.directory);
    }
    base.join(ID)
}
pub fn installed(cache: &Path) -> bool {
    let env = environment(cache);
    env.join("python/python.exe").is_file() && fs::read_to_string(env.join("ready")).ok().as_deref() == Some(ID)
}
pub fn invalidate(cache: &Path) {
    let _ = fs::remove_file(environment(cache).join("ready"));
}
pub fn bundle<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if !cfg!(all(windows, target_arch = "x86_64")) { return Err("此版本的研究组件暂支持 Windows 64 位".into()); }
    let mut candidates = Vec::new();
    if let Ok(path) = app.path().resource_dir() { candidates.push(path.join("resources/research-component")); }
    if let Ok(path) = std::env::current_exe() { if let Some(parent) = path.parent() { candidates.push(parent.join("resources/research-component")); } }
    #[cfg(debug_assertions)]
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/desktop/src-tauri/resources/research-component"));
    candidates.into_iter().find(|p| p.join("manifest.json").is_file() && p.join("component.zip").is_file())
        .ok_or_else(|| "此安装包缺少研究组件，请使用包含研究组件的完整版本更新应用。".into())
}
fn progress(id: &str, percent: u8) {
    if let Ok(mut c) = control().lock() {
        if let Some(run) = c.active.as_mut().filter(|r| r.id == id) { run.progress = Some(percent.min(100)); }
    }
}
fn cancelled(flag: &AtomicBool) -> Result<(), String> {
    if flag.load(Ordering::Relaxed) { Err("已取消安装，原有组件保持可用".into()) } else { Ok(()) }
}
fn safe_name(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('/') && !name.contains(['\\', ':', '\0'])
        && name.split('/').all(|part| {
            let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            !part.is_empty() && part != "." && part != ".." && !part.ends_with(['.', ' '])
                && !["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"].contains(&stem.as_str())
        })
}
fn unpack(cache: &Path, bundle: &Path, id: &str, cancel: &AtomicBool) -> Result<tempfile::TempDir, String> {
    let metadata = fs::metadata(bundle.join("manifest.json")).map_err(|_| "研究组件清单不可读")?;
    if metadata.len() > 32 * 1024 * 1024 { return Err("研究组件清单过大".into()); }
    let manifest: Manifest = serde_json::from_slice(&fs::read(bundle.join("manifest.json")).map_err(|_| "读取组件清单失败")?).map_err(|_| "研究组件清单无效")?;
    if manifest.component_id != ID || manifest.platform != "windows-x64" || manifest.size > LIMIT || manifest.files.len() > 200_000 {
        return Err("研究组件与应用版本不匹配，请更新完整安装包".into());
    }
    set_stage(id, "正在校验研究组件");
    let mut archive = fs::File::open(bundle.join("component.zip")).map_err(|_| "读取研究组件失败")?;
    if archive.metadata().map_err(|_| "组件不可读")?.len() != manifest.size { return Err("研究组件不完整，请重新下载应用安装包".into()); }
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 128 * 1024];
    let mut read = 0;
    loop {
        cancelled(cancel)?;
        let bytes = archive.read(&mut buffer).map_err(|_| "组件校验读取失败")?;
        if bytes == 0 { break; }
        hasher.update(&buffer[..bytes]); read += bytes as u64;
        progress(id, (read.saturating_mul(100) / manifest.size.max(1)) as u8);
    }
    if format!("{:x}", hasher.finalize()) != manifest.sha256 { return Err("研究组件校验失败，请重新下载应用安装包".into()); }
    let base = cache.join("research-components");
    fs::create_dir_all(&base).map_err(|_| "无法创建研究组件目录，请检查磁盘空间和权限")?;
    let staging = tempfile::Builder::new().prefix("install-").tempdir_in(base).map_err(|_| "无法准备安装目录")?;
    let archive = fs::File::open(bundle.join("component.zip")).map_err(|_| "无法读取组件")?;
    let mut zip = zip::ZipArchive::new(archive).map_err(|_| "研究组件压缩文件损坏")?;
    if zip.len() != manifest.files.len() { return Err("组件文件清单不一致".into()); }
    set_stage(id, "正在安装研究组件");
    let mut total = 0u64;
    let mut seen = std::collections::HashSet::new();
    for index in 0..zip.len() {
        cancelled(cancel)?;
        let mut entry = zip.by_index(index).map_err(|_| "组件文件损坏")?;
        let name = entry.name().to_owned();
        if !safe_name(&name) || !seen.insert(name.clone()) || entry.is_symlink() {
            return Err("组件包含无效文件路径".into());
        }
        let expected = manifest.files.get(&name).ok_or("组件包含未登记文件")?;
        total = total.checked_add(entry.size()).ok_or("组件过大")?;
        if total > LIMIT { return Err("组件解压大小超出限制".into()); }
        let output = staging.path().join(name);
        fs::create_dir_all(output.parent().ok_or("组件路径无效")?).map_err(|_| "安装目录不可写")?;
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(output).map_err(|_| "组件文件无法写入，请检查磁盘空间")?;
        let mut hash = Sha256::new();
        loop {
            cancelled(cancel)?;
            let size = entry.read(&mut buffer).map_err(|_| "组件解压失败")?;
            if size == 0 { break; }
            file.write_all(&buffer[..size]).map_err(|_| "组件写入失败，请检查磁盘空间")?;
            hash.update(&buffer[..size]);
        }
        if format!("{:x}", hash.finalize()) != *expected { return Err("组件内容校验失败".into()); }
        progress(id, (((index + 1) * 100) / manifest.files.len().max(1)) as u8);
    }
    Ok(staging)
}
pub async fn install(cache: PathBuf, bundle: PathBuf, id: String, mut cancel: oneshot::Receiver<()>) -> Result<(), String> {
    // The controller reserves installation exclusively against research tasks.
    // A failed health check falls through to a repair without touching the old copy.
    if installed(&cache) {
        set_stage(&id, "正在检查已有研究组件");
        let healthy = tokio::select! {
            _ = &mut cancel => return Err("已取消安装".into()),
            result = runtime::check(&cache) => result.is_ok(),
        };
        if healthy {
            cleanup::after_install(cache).await;
            set_stage(&id, "研究组件已就绪");
            return Ok(());
        }
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let (work_cache, work_id, flag) = (cache.clone(), id.clone(), cancelled.clone());
    let mut extraction = tokio::task::spawn_blocking(move || unpack(&work_cache, &bundle, &work_id, &flag));
    let staging = tokio::select! {
        _ = &mut cancel => { cancelled.store(true, Ordering::Relaxed); let _ = extraction.await; return Err("已取消安装".into()); },
        result = &mut extraction => result.map_err(|_| "组件安装异常，请重试")??,
    };
    set_stage(&id, "正在验证研究组件");
    if let Ok(mut c) = control().lock() { if let Some(active) = c.active.as_mut().filter(|r| r.id == id) { active.progress = None; } }
    tokio::select! {
        _ = &mut cancel => return Err("已取消安装".into()),
        result = runtime::check_at(staging.path(), &cache) => result?,
    }
    fs::write(staging.path().join("ready"), ID).map_err(|_| "组件状态保存失败")?;
    let directory = format!("{ID}-{id}");
    let destination = cache.join("research-components").join(&directory);
    fs::rename(staging.path(), &destination).map_err(|_| "无法启用研究组件，请重试")?;
    // Do not remove previous copies until verification AND the atomic switch succeed.
    let pointer = Pointer { component_id: ID.into(), directory };
    neuink_workspace::atomic_write(cache.join("research-components/current.json"), &serde_json::to_vec(&pointer).map_err(|_| "组件状态无效")?)
        .map_err(|_| "无法保存组件状态，请重试")?;
    cleanup::after_install(cache).await;
    set_stage(&id, "研究组件已就绪");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn archive_paths_and_installed_pointers_stay_inside_cache() {
        for name in ["../secret", "/outside", "C:/bad", "x:y", "a\\b", "a/../b", "a./b", "python/CON.py", "nul", "LPT1.txt"] { assert!(!safe_name(name)); }
        assert!(safe_name("python/Lib/site-packages/deerflow/client.py"));
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("research-components"); fs::create_dir_all(&root).unwrap();
        fs::write(root.join("current.json"), format!(r#"{{"component_id":"{ID}","directory":"../outside"}}"#)).unwrap();
        assert_eq!(environment(tmp.path()), root.join(ID)); assert!(!installed(tmp.path()));
        fs::write(root.join("current.json"), format!(r#"{{"component_id":"{ID}","directory":"{ID}-note_123"}}"#)).unwrap();
        assert_eq!(environment(tmp.path()), root.join(format!("{ID}-note_123")));
    }
    #[test]
    fn corrupt_or_cancelled_install_keeps_previous_component() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("cache");
        let bundle = tmp.path().join("bundle"); fs::create_dir_all(&bundle).unwrap();
        let old = cache.join("research-components").join(format!("{ID}-old"));
        fs::create_dir_all(old.join("python")).unwrap();
        fs::write(old.join("python/python.exe"), b"old runtime").unwrap();
        fs::write(old.join("ready"), ID).unwrap();
        let pointer = serde_json::to_vec(&Pointer { component_id: ID.into(), directory: format!("{ID}-old") }).unwrap();
        fs::write(cache.join("research-components/current.json"), &pointer).unwrap();
        fs::write(bundle.join("component.zip"), b"corrupt").unwrap();
        fs::write(bundle.join("manifest.json"), serde_json::to_vec(&serde_json::json!({"component_id":ID,"platform":"windows-x64","size":7,"sha256":"wrong","files":{}})).unwrap()).unwrap();
        assert!(unpack(&cache, &bundle, "new", &AtomicBool::new(false)).unwrap_err().contains("校验失败"));
        assert!(unpack(&cache, &bundle, "new", &AtomicBool::new(true)).unwrap_err().contains("已取消"));
        assert!(installed(&cache));
        assert_eq!(fs::read(cache.join("research-components/current.json")).unwrap(), pointer);
        assert_eq!(fs::read_dir(cache.join("research-components")).unwrap().count(), 2);
    }
    #[tokio::test]
    #[ignore = "Installs the preassembled local bundle into an explicitly selected cache; no network/model calls"]
    async fn installs_standalone_bundle() {
        let cache = PathBuf::from(std::env::var("NEUINK_RESEARCH_TEST_CACHE").expect("explicit cache required"));
        let bundle = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/desktop/src-tauri/resources/research-component");
        let (_sender, cancel) = oneshot::channel();
        install(cache.clone(), bundle, neuink_domain::NoteId::new().to_string(), cancel).await.unwrap();
        assert!(installed(&cache));
        runtime::check(&cache).await.unwrap();
        // A second request reuses the healthy environment even without an archive.
        let pointer = fs::read(cache.join("research-components/current.json")).unwrap();
        let (_sender, cancel) = oneshot::channel();
        install(cache.clone(), cache.join("missing-bundle"), neuink_domain::NoteId::new().to_string(), cancel).await.unwrap();
        assert_eq!(fs::read(cache.join("research-components/current.json")).unwrap(), pointer);
    }
}
