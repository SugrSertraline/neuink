mod source_catalog;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

use neuink_config::MineruSettings;
use neuink_workspace::Workspace;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use super::entry::{
    create_from_mineru_source_bytes,
    mineru_source::{read_mineru_source, source_pdf, source_pdf_hash, validate_single_result},
    CreateFromMineruClientResultRequest,
};
use crate::storage::{read_settings, write_settings};
use source_catalog::{scan_root_interruptible, MineruItem};

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum MineruRequest {
    Settings,
    SaveSettings {
        results_directory: Option<PathBuf>,
    },
    Discover {
        search_id: String,
    },
    CancelSearch {
        search_id: String,
    },
    Scan {
        root: PathBuf,
        search_id: String,
    },
    Import {
        root: PathBuf,
        snapshot_id: String,
        item_id: String,
    },
}

struct Snapshot {
    root: PathBuf,
    source_directory: PathBuf,
    items: HashMap<String, MineruItem>,
    at: Instant,
}

static SNAPSHOTS: OnceLock<Mutex<HashMap<String, Snapshot>>> = OnceLock::new();
static SEARCHES: OnceLock<Mutex<HashMap<String, (Arc<AtomicBool>, Instant)>>> = OnceLock::new();
fn snapshots() -> &'static Mutex<HashMap<String, Snapshot>> {
    SNAPSHOTS.get_or_init(Default::default)
}

fn searches() -> &'static Mutex<HashMap<String, (Arc<AtomicBool>, Instant)>> {
    SEARCHES.get_or_init(Default::default)
}

fn search_flag(search_id: &str, cancel: bool) -> Result<Arc<AtomicBool>, String> {
    if search_id.is_empty() || search_id.len() > 80 {
        return Err("MinerU 查找标识无效。".into());
    }
    let mut entries = searches().lock().map_err(|_| "MinerU 查找状态暂不可用。")?;
    entries.retain(|_, (_, at)| at.elapsed() < Duration::from_secs(300));
    let (flag, _) = entries
        .entry(search_id.to_owned())
        .or_insert_with(|| (Arc::new(AtomicBool::new(false)), Instant::now()));
    if cancel {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(Arc::clone(flag))
}

#[tauri::command]
pub async fn mineru<R: Runtime>(
    app: AppHandle<R>,
    request: MineruRequest,
) -> Result<Value, String> {
    if let MineruRequest::CancelSearch { search_id } = &request {
        search_flag(search_id, true)?;
        return Ok(json!({}));
    }
    tauri::async_runtime::spawn_blocking(move || execute(&app, request))
        .await
        .map_err(|_| "MinerU 操作被中断，请重试。".to_string())?
}

fn execute<R: Runtime>(app: &AppHandle<R>, request: MineruRequest) -> Result<Value, String> {
    match request {
        MineruRequest::Settings => {
            let mut settings = read_settings(app)?.mineru;
            settings.results_directory = settings
                .results_directory
                .map(|path| display_path(Path::new(&path)));
            Ok(json!(settings))
        }
        MineruRequest::SaveSettings { results_directory } => {
            let directory = results_directory
                .map(|path| {
                    if !path.is_dir() {
                        return Err("MinerU 结果目录不存在，请重新选择。".to_string());
                    }
                    path.canonicalize()
                        .map_err(|_| "无法访问 MinerU 结果目录。".to_string())
                })
                .transpose()?;
            let mut settings = read_settings(app)?;
            settings.mineru = MineruSettings {
                results_directory: directory.as_deref().map(display_path),
            };
            write_settings(app, &settings)?;
            let _ = app.emit("mineru-settings-changed", ());
            Ok(json!(settings.mineru))
        }
        MineruRequest::Discover { search_id } => {
            let flag = search_flag(&search_id, false)?;
            let result = (|| -> Result<Value, String> {
                let mut found = Vec::new();
                for directory in default_roots(app) {
                    if flag.load(Ordering::Relaxed) {
                        return Err("MinerU 查找已取消。".into());
                    }
                    match scan_root_interruptible(&directory, || flag.load(Ordering::Relaxed)) {
                        Ok(catalog) if !catalog.items.is_empty() => found.push(json!({
                            "results_directory": display_path(&directory),
                            "count": catalog.items.len(),
                            "truncated": catalog.truncated,
                        })),
                        Err(error) if flag.load(Ordering::Relaxed) => return Err(error),
                        _ => {}
                    }
                }
                Ok(json!(found))
            })();
            if let Ok(mut entries) = searches().lock() {
                entries.remove(&search_id);
            }
            result
        }
        MineruRequest::CancelSearch { search_id } => {
            search_flag(&search_id, true)?;
            Ok(json!({}))
        }
        MineruRequest::Scan { root, search_id } => {
            let flag = search_flag(&search_id, false)?;
            let result = (|| -> Result<Value, String> {
                Workspace::open_existing(&root)
                    .map_err(|_| "NeuInk 资料库不可用，请重新打开后重试。")?;
                let directory = read_settings(app)?
                    .mineru
                    .results_directory
                    .ok_or("请先选择 MinerU 结果目录。")?;
                let directory = PathBuf::from(directory);
                let catalog = scan_root_interruptible(&directory, || flag.load(Ordering::Relaxed))?;
                if flag.load(Ordering::Relaxed) {
                    return Err("MinerU 查找已取消。".into());
                }
                let snapshot_id = neuink_domain::EntryId::new().to_string();
                let items = catalog.items;
                let visible_items = items
                    .iter()
                    .map(|item| {
                        json!({
                            "id": item.id,
                            "path": display_path(Path::new(&item.path)),
                            "title": item.title,
                            "kind": item.kind,
                            "has_pdf": item.has_pdf,
                        })
                    })
                    .collect::<Vec<_>>();
                let response = json!({"snapshot_id": snapshot_id, "source_directory": display_path(&directory), "items": visible_items, "truncated": catalog.truncated});
                let mut cache = snapshots()
                    .lock()
                    .map_err(|_| "MinerU 列表暂不可用，请重启。")?;
                cache.retain(|_, item| item.at.elapsed() < Duration::from_secs(1800));
                if cache.len() >= 4 {
                    if let Some(oldest) = cache
                        .iter()
                        .min_by_key(|(_, value)| value.at)
                        .map(|(key, _)| key.clone())
                    {
                        cache.remove(&oldest);
                    }
                }
                cache.insert(
                    snapshot_id,
                    Snapshot {
                        root: root.canonicalize().map_err(|_| "资料库路径不可用。")?,
                        source_directory: directory
                            .canonicalize()
                            .map_err(|_| "MinerU 结果目录已不可用，请重新选择。")?,
                        items: items
                            .into_iter()
                            .map(|item| (item.id.clone(), item))
                            .collect(),
                        at: Instant::now(),
                    },
                );
                Ok(response)
            })();
            if let Ok(mut entries) = searches().lock() {
                entries.remove(&search_id);
            }
            result
        }
        MineruRequest::Import {
            root,
            snapshot_id,
            item_id,
        } => {
            let item = preview_item(app, &root, &snapshot_id, &item_id)?;
            if !item.has_pdf {
                return Err("此解析结果缺少原 PDF，不能新建条目；可导入到已有 PDF 条目。".into());
            }
            let source = PathBuf::from(&item.path);
            let zip_bytes = read_mineru_source(&source)?;
            validate_single_result(&zip_bytes)?;
            let pdf_name = source_pdf(&zip_bytes)?.ok_or("结果中的原 PDF 已丢失，请刷新列表。")?;
            let pdf_hash = source_pdf_hash(&zip_bytes, &pdf_name)?;
            let workspace = Workspace::open_existing(&root).map_err(|_| "NeuInk 资料库不可用。")?;
            if let Some(entry) = workspace
                .list_entries()
                .map_err(|error| error.to_string())?
                .into_iter()
                .find(|entry| {
                    entry
                        .pdf
                        .as_ref()
                        .is_some_and(|pdf| pdf.content_hash == pdf_hash)
                })
            {
                return Ok(
                    json!({"status": "skipped", "entry_id": entry.id, "title": entry.title}),
                );
            }
            let imported = create_from_mineru_source_bytes(
                CreateFromMineruClientResultRequest {
                    root: root.clone(),
                    title: item.title.clone(),
                    fields: Default::default(),
                    tags: Vec::new(),
                    zip_path: source,
                },
                zip_bytes,
            )?;
            let _ = app.emit("mineru-library-changed", json!({"root": root}));
            Ok(
                json!({"status": "imported", "entry_id": imported.entry.id, "title": imported.entry.title}),
            )
        }
    }
}

fn default_roots<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    let resolver = app.path();
    let mut paths = Vec::new();
    if let Ok(path) = resolver.download_dir() {
        paths.push(path);
    }
    if let Ok(path) = resolver.document_dir() {
        paths.push(path.join("MinerU"));
    }
    if let Ok(path) = resolver.desktop_dir() {
        paths.push(path.join("MinerU"));
    }
    if let Ok(home) = resolver.home_dir() {
        paths.extend([
            home.join("mineru-downloads"),
            home.join("MinerU"),
            home.join(".mineru/output"),
        ]);
    }
    if let Some(appdata) = std::env::var_os(if cfg!(windows) {
        "APPDATA"
    } else {
        "XDG_DATA_HOME"
    }) {
        paths.push(Path::new(&appdata).join("MinerU"));
    }
    if cfg!(windows) {
        if let Some(local_appdata) = std::env::var_os("LOCALAPPDATA") {
            paths.push(Path::new(&local_appdata).join("MinerU"));
        }
    }
    let mut unique = Vec::new();
    for path in paths {
        if let Ok(path) = path.canonicalize() {
            if !unique.contains(&path) {
                unique.push(path);
            }
        }
    }
    unique
}

fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    let leading_slashes = text.bytes().take_while(|byte| *byte == b'\\').count();
    let Some(rest) = text
        .get(leading_slashes..)
        .filter(|rest| leading_slashes >= 2 && rest.starts_with("?\\"))
    else {
        return text.into_owned();
    };
    let rest = &rest[2..];
    rest.strip_prefix("UNC\\")
        .map(|unc| format!(r"\\{unc}"))
        .unwrap_or_else(|| rest.to_owned())
}

#[cfg(test)]
mod tests {
    use super::display_path;
    use std::path::Path;

    #[test]
    fn hides_windows_extended_path_prefixes() {
        assert_eq!(
            display_path(Path::new(r"\\?\C:\Users\paper")),
            r"C:\Users\paper"
        );
        assert_eq!(
            display_path(Path::new(r"\\\\?\C:\Users\paper")),
            r"C:\Users\paper"
        );
        assert_eq!(
            display_path(Path::new(r"\\?\UNC\server\paper")),
            r"\\server\paper"
        );
    }
}

fn preview_item<R: Runtime>(
    app: &AppHandle<R>,
    root: &std::path::Path,
    snapshot_id: &str,
    item_id: &str,
) -> Result<source_catalog::MineruItem, String> {
    Ok({
        let cache = snapshots()
            .lock()
            .map_err(|_| "MinerU 列表暂不可用，请重启。")?;
        let snapshot = cache
            .get(snapshot_id)
            .filter(|value| value.at.elapsed() < Duration::from_secs(1800))
            .ok_or("结果列表已过期，请刷新后重新选择。")?;
        if root.canonicalize().map_err(|_| "资料库路径不可用。")? != snapshot.root {
            return Err("资料库已切换，请重新打开导入窗口。".into());
        }
        let configured = read_settings(app)?
            .mineru
            .results_directory
            .ok_or("MinerU 结果目录已改变，请刷新列表。")?;
        if PathBuf::from(configured)
            .canonicalize()
            .map_err(|_| "MinerU 结果目录已不可用，请重新选择。")?
            != snapshot.source_directory
        {
            return Err("MinerU 结果目录已改变，请刷新列表。".into());
        }
        snapshot
            .items
            .get(item_id)
            .cloned()
            .ok_or("结果不在本次读取列表中，请刷新。")?
    })
}

pub(crate) fn preview_source_path<R: Runtime>(
    app: &AppHandle<R>,
    root: &std::path::Path,
    snapshot_id: &str,
    item_id: &str,
) -> Result<PathBuf, String> {
    Ok(PathBuf::from(
        preview_item(app, root, snapshot_id, item_id)?.path,
    ))
}
