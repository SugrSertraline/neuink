use crate::storage::{read_settings, write_settings};
use neuink_config::ZoteroSettings;
use neuink_workspace::Workspace;
use neuink_zotero::{discovery, read_library, Library, SourceSettings};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ZoteroRequest {
    Settings,
    CatalogTags {
        root: PathBuf,
    },
    SaveSettings {
        data_directory: Option<PathBuf>,
        linked_attachment_directory: Option<PathBuf>,
    },
    Discover,
    Scan {
        root: PathBuf,
    },
    Import {
        root: PathBuf,
        snapshot_id: String,
        paper_id: String,
        attachment_key: Option<String>,
    },
}

struct Snapshot {
    root: PathBuf,
    library: Arc<Library>,
    at: Instant,
}
static SNAPSHOTS: OnceLock<Mutex<HashMap<String, Snapshot>>> = OnceLock::new();
fn snapshots() -> &'static Mutex<HashMap<String, Snapshot>> {
    SNAPSHOTS.get_or_init(Default::default)
}

#[tauri::command]
pub async fn zotero<R: Runtime>(
    app: AppHandle<R>,
    request: ZoteroRequest,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || execute(&app, request))
        .await
        .map_err(|_| "Zotero 操作被中断，请重试。".to_string())?
}

fn execute<R: Runtime>(app: &AppHandle<R>, request: ZoteroRequest) -> Result<Value, String> {
    match request {
        ZoteroRequest::CatalogTags { root } => {
            let workspace = Workspace::open_existing(root).map_err(|_| "NeuInk 资料库不可用。")?;
            Ok(json!(workspace
                .list_tags()
                .map_err(|_| "无法读取标签目录。")?))
        }
        ZoteroRequest::Settings => Ok(json!(read_settings(app)?.zotero)),
        ZoteroRequest::SaveSettings {
            data_directory,
            linked_attachment_directory,
        } => {
            let data_directory = data_directory
                .as_deref()
                .map(discovery::normalize_directory)
                .transpose()
                .map_err(|e| e.to_string())?;
            let linked = linked_attachment_directory
                .map(|p| {
                    if !p.is_dir() {
                        return Err("链接附件基础目录不存在，请重新选择。".to_string());
                    }
                    p.canonicalize()
                        .map_err(|_| "无法访问链接附件目录。".to_string())
                })
                .transpose()?;
            let linked = linked.or_else(|| {
                discovery::discover()
                    .into_iter()
                    .find(|c| c.data_directory == data_directory)
                    .and_then(|c| c.linked_attachment_directory)
            });
            let mut settings = read_settings(app)?;
            settings.zotero = ZoteroSettings {
                data_directory: data_directory.map(display_path),
                linked_attachment_directory: linked.map(display_path),
            };
            write_settings(app, &settings)?;
            let _ = app.emit("zotero-settings-changed", ());
            Ok(json!(settings.zotero))
        }
        ZoteroRequest::Discover => Ok(json!(discovery::discover()
            .into_iter()
            .map(|s| ZoteroSettings {
                data_directory: s.data_directory.map(display_path),
                linked_attachment_directory: s.linked_attachment_directory.map(display_path)
            })
            .collect::<Vec<_>>())),
        ZoteroRequest::Scan { root } => {
            let source = read_settings(app)?.zotero;
            let settings = SourceSettings {
                data_directory: source.data_directory.map(PathBuf::from),
                linked_attachment_directory: source.linked_attachment_directory.map(PathBuf::from),
            };
            let library = read_library(&settings).map_err(|e| e.to_string())?;
            let workspace = Workspace::open_existing(&root)
                .map_err(|_| "NeuInk 资料库不可用，请重新打开后重试。")?;
            let existing = workspace
                .zotero_matches(&library.source_id)
                .map_err(|_| "无法读取导入记录，请检查 NeuInk 资料库。")?;
            let snapshot_id = neuink_domain::EntryId::new().to_string();
            let response =
                json!({"snapshot_id": snapshot_id, "library": library, "existing": existing});
            let mut cache = snapshots()
                .lock()
                .map_err(|_| "Zotero 读取暂不可用，请重启。")?;
            cache.retain(|_, item| item.at.elapsed() < Duration::from_secs(1800));
            if cache.len() >= 4 {
                if let Some(oldest) = cache
                    .iter()
                    .min_by_key(|(_, v)| v.at)
                    .map(|(k, _)| k.clone())
                {
                    cache.remove(&oldest);
                }
            }
            cache.insert(
                snapshot_id,
                Snapshot {
                    root: root.canonicalize().map_err(|_| "资料库路径不可用。")?,
                    library: Arc::new(library),
                    at: Instant::now(),
                },
            );
            Ok(response)
        }
        ZoteroRequest::Import {
            root,
            snapshot_id,
            paper_id,
            attachment_key,
        } => {
            let library = {
                let cache = snapshots()
                    .lock()
                    .map_err(|_| "Zotero 读取暂不可用，请重启。")?;
                let snapshot = cache
                    .get(&snapshot_id)
                    .filter(|s| s.at.elapsed() < Duration::from_secs(1800))
                    .ok_or("论文列表已过期，请刷新后重新选择。")?;
                if root.canonicalize().map_err(|_| "资料库路径不可用。")? != snapshot.root
                {
                    return Err("资料库已切换，请重新打开导入窗口。".into());
                }
                Arc::clone(&snapshot.library)
            };
            let paper = library
                .papers
                .iter()
                .find(|p| p.id == paper_id)
                .ok_or("论文不在本次读取结果中，请刷新列表。")?;
            let workspace = Workspace::open_existing(&root).map_err(|_| "NeuInk 资料库不可用。")?;
            let result = workspace
                .import_zotero_paper(&library, paper, attachment_key.as_deref())
                .map_err(|e| {
                    if let neuink_workspace::WorkspaceError::Zotero(message) = e {
                        message
                    } else {
                        "保存论文失败，请检查 NeuInk 资料库权限和剩余磁盘空间，然后重试。".into()
                    }
                })?;
            let _ = app.emit("zotero-library-changed", json!({"root": root}));
            Ok(json!(result))
        }
    }
}

fn display_path(path: PathBuf) -> String {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else {
        text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
    }
}

/// Only resolve attachments that were included in this workspace's scanned library.
pub(crate) fn preview_pdf_path(
    root: &std::path::Path,
    snapshot_id: &str,
    paper_id: &str,
    attachment_key: &str,
) -> Result<PathBuf, String> {
    let cache = snapshots().lock().map_err(|_| "Zotero 列表暂不可用。")?;
    let snapshot = cache
        .get(snapshot_id)
        .filter(|s| s.at.elapsed() < Duration::from_secs(1800))
        .ok_or("论文列表已过期，请刷新后重新选择。")?;
    if root.canonicalize().map_err(|_| "资料库路径不可用。")? != snapshot.root {
        return Err("资料库已切换，请刷新列表。".into());
    }
    snapshot
        .library
        .papers
        .iter()
        .find(|paper| paper.id == paper_id)
        .and_then(|paper| {
            paper
                .attachments
                .iter()
                .find(|file| file.key == attachment_key && file.available)
        })
        .and_then(|file| file.path.clone())
        .ok_or_else(|| "此论文没有可预览的本地 PDF。".into())
}
