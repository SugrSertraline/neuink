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

#[path = "zotero/note_write.rs"]
mod note_write;
#[path = "zotero/note_import.rs"]
mod note_import;

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ZoteroRequest {
    Settings,
    SetEnabled { enabled: bool },
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
    SetHidden {
        root: PathBuf,
        snapshot_id: String,
        paper_id: String,
        hidden: bool,
    },
    SetEntryHidden {
        root: PathBuf,
        entry_id: neuink_domain::EntryId,
        hidden: bool,
    },
    NoteOrigin { root: PathBuf, entry_id: neuink_domain::EntryId, note_id: neuink_domain::NoteId },
    ImportLocal { root: PathBuf, source_entry_id: neuink_domain::EntryId, #[serde(default)] force_new: bool },
    NoteImportList { root: PathBuf, source_entry_id: neuink_domain::EntryId, target_entry_id: neuink_domain::EntryId },
    ImportNotes { root: PathBuf, source_entry_id: neuink_domain::EntryId, target_entry_id: neuink_domain::EntryId, selected: Vec<neuink_workspace::source_notes::SourceNoteSelection> },
    PreviewNote { root: PathBuf, entry_id: neuink_domain::EntryId, note_id: neuink_domain::NoteId },
    OverwriteNote { root: PathBuf, entry_id: neuink_domain::EntryId, note_id: neuink_domain::NoteId,
        html: String, expected_version: u64, expected_server_id: String, confirmed: bool },
    Import {
        root: PathBuf,
        snapshot_id: String,
        paper_id: String,
        attachment_key: Option<String>,
        #[serde(default)]
        confirmed_duplicate_hash: Option<String>,
        #[serde(default)]
        catalog: bool,
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
    match request {
        ZoteroRequest::PreviewNote { root, entry_id, note_id } => return note_write::preview(&root, &entry_id, &note_id).await,
        ZoteroRequest::OverwriteNote { root, entry_id, note_id, html, expected_version, expected_server_id, confirmed } =>
            return note_write::overwrite(&root, &entry_id, &note_id, &html, expected_version, &expected_server_id, confirmed).await,
        other => return tauri::async_runtime::spawn_blocking(move || execute(&app, other))
            .await.map_err(|_| "Zotero 操作被中断，请重试。".to_string())?,
    }
}

fn execute<R: Runtime>(app: &AppHandle<R>, request: ZoteroRequest) -> Result<Value, String> {
    match request {
        ZoteroRequest::ImportLocal { root, source_entry_id, force_new } => {
            let workspace = Workspace::open_existing(&root).map_err(|e| e.to_string())?;
            if !force_new {
                if let Some(id) = workspace.entry_source_kinds().map_err(|e| e.to_string())?.get(source_entry_id.as_str()).and_then(|info| info.local_copy_ids.first()) {
                    return Ok(json!({"entry_id": id, "created": false}));
                }
            }
            let library = match read_library(&source_settings(app)?) {
                Ok(library) => library,
                Err(_) => return workspace.copy_source_to_local(&source_entry_id, force_new)
                    .map(|result| json!({ "entry_id": result.entry_id, "created": result.created, "used_cached_source": true })).map_err(|e| e.to_string()),
            };
            let sources = workspace.zotero_sources(&source_entry_id).map_err(|e| e.to_string())?;
            let paper = sources.iter().filter(|source| source.source_id == library.source_id).find_map(|source| library.papers.iter().find(|paper| paper.id == source.item_id));
            let used_cached_source = paper.is_none();
            let result = if let Some(paper) = paper { workspace.import_current_zotero_copy(&source_entry_id, &library, paper, force_new) }
                else { workspace.copy_source_to_local(&source_entry_id, force_new) };
            result.map(|result| json!({ "entry_id": result.entry_id, "created": result.created, "used_cached_source": used_cached_source })).map_err(|e| e.to_string())
        }
        ZoteroRequest::NoteImportList { root, source_entry_id, target_entry_id } => {
            note_import::execute(&root, &source_entry_id, &target_entry_id, &source_settings(app)?, None)
        }
        ZoteroRequest::ImportNotes { root, source_entry_id, target_entry_id, selected } => {
            note_import::execute(&root, &source_entry_id, &target_entry_id, &source_settings(app)?, Some(&selected))
        }
        ZoteroRequest::CatalogTags { root } => {
            let workspace = Workspace::open_existing(root).map_err(|_| "NeuInk 资料库不可用。")?;
            Ok(json!(workspace
                .list_tags()
                .map_err(|_| "无法读取标签目录。")?))
        }
        ZoteroRequest::NoteOrigin { root, entry_id, note_id } => {
            Ok(json!(note_write::origin(&root, &entry_id, &note_id)?))
        }
        ZoteroRequest::PreviewNote { .. } | ZoteroRequest::OverwriteNote { .. } => unreachable!("async note request is handled before blocking dispatch"),
        ZoteroRequest::Settings => Ok(json!(read_settings(app)?.zotero)),
        ZoteroRequest::SetEnabled { enabled } => {
            let mut settings = read_settings(app)?;
            settings.zotero.enabled = enabled;
            write_settings(app, &settings)?;
            let _ = app.emit("zotero-settings-changed", ());
            Ok(json!(settings.zotero))
        }
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
                enabled: settings.zotero.enabled,
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
                enabled: true,
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
            let hidden = workspace.hidden_zotero_papers(&library.source_id)
                .map_err(|_| "无法读取隐藏记录，请检查 NeuInk 资料库。")?;
            let changed = workspace.zotero_changed_papers(&library)
                .map_err(|_| "无法核对 Zotero 来源变化。")?;
            let fingerprints = workspace.zotero_paper_fingerprints(&library)
                .map_err(|_| "无法核对 Zotero 来源版本。")?;
            let organization_updated = workspace.refresh_zotero_organization(&library)
                .map_err(|_| "无法保存 Zotero 来源分类和标签，本地标签未修改。")?;
            let snapshot_id = neuink_domain::EntryId::new().to_string();
            let response =
                json!({"snapshot_id": snapshot_id, "library": library, "existing": existing, "hidden": hidden, "changed": changed, "fingerprints": fingerprints, "organization_updated": organization_updated});
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
        ZoteroRequest::SetHidden { root, snapshot_id, paper_id, hidden } => {
            let source_id = {
                let cache = snapshots().lock().map_err(|_| "Zotero 读取暂不可用，请重启。")?;
                let snapshot = cache.get(&snapshot_id)
                    .filter(|s| s.at.elapsed() < Duration::from_secs(1800))
                    .ok_or("论文列表已过期，请刷新后重试。")?;
                if root.canonicalize().map_err(|_| "资料库路径不可用。")? != snapshot.root {
                    return Err("资料库已切换，请刷新列表。".into());
                }
                if !snapshot.library.papers.iter().any(|paper| paper.id == paper_id) {
                    return Err("论文不在本次读取结果中，请刷新列表。".into());
                }
                snapshot.library.source_id.clone()
            };
            let workspace = Workspace::open_existing(&root).map_err(|_| "NeuInk 资料库不可用。")?;
            workspace.set_zotero_paper_hidden(&source_id, &paper_id, hidden)
                .map_err(|_| "保存隐藏状态失败，请检查资料库。")?;
            Ok(json!({"hidden": hidden}))
        }
        ZoteroRequest::SetEntryHidden { root, entry_id, hidden } => {
            let workspace = Workspace::open_existing(&root).map_err(|_| "NeuInk 资料库不可用。")?;
            workspace.set_imported_zotero_entry_hidden(&entry_id, hidden).map_err(|error| error.to_string())?;
            Ok(json!({"hidden": hidden}))
        }
        ZoteroRequest::Import {
            root,
            snapshot_id,
            paper_id,
            attachment_key,
            confirmed_duplicate_hash,
            catalog,
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
            let result = (if catalog { workspace.index_zotero_paper(&library, paper, attachment_key.as_deref()) }
                else { workspace.import_zotero_paper_with_confirmation(&library, paper, attachment_key.as_deref(), confirmed_duplicate_hash.as_deref()) })
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

fn source_settings<R: Runtime>(app: &AppHandle<R>) -> Result<SourceSettings, String> {
    let settings = read_settings(app)?.zotero;
    Ok(SourceSettings { data_directory: settings.data_directory.map(PathBuf::from), linked_attachment_directory: settings.linked_attachment_directory.map(PathBuf::from) })
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
