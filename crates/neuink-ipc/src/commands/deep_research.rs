//! Application-owned task lifecycle. Planning and synthesis run in the original package.
mod retriever;
mod runtime;
mod scope;
mod thread;
mod component;
#[cfg(test)]
mod tests;
use crate::{
    commands::{
        local_agent::process::ProcessTree,
        research::{network, settings as search_settings},
        settings,
    },
    storage,
};
use chrono::Utc;
use neuink_domain::{deep_research::ResearchTask, NoteId};
use neuink_workspace::Workspace;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};
use tauri::{AppHandle, Runtime};
use tokio::sync::oneshot;

struct Active {
    id: String,
    root: PathBuf,
    stage: String,
    cancel: Option<oneshot::Sender<()>>,
    tree: Option<Arc<ProcessTree>>,
    installation: bool,
    progress: Option<u8>,
}
#[derive(Default)]
struct Controller {
    active: Option<Active>,
    ready: bool,
    error: Option<String>,
    pending: Option<(PathBuf, ResearchTask)>,
}
static CONTROL: OnceLock<Mutex<Controller>> = OnceLock::new();
fn control() -> &'static Mutex<Controller> {
    CONTROL.get_or_init(|| Mutex::new(Controller::default()))
}
fn set_stage(id: &str, stage: &str) {
    if let Ok(mut c) = control().lock() {
        if let Some(run) = c.active.as_mut().filter(|r| r.id == id) {
            run.stage = stage.into();
        }
    }
}
fn reserve(root: PathBuf, id: &str, installation: bool) -> Result<oneshot::Receiver<()>, String> {
    let mut c = control().lock().map_err(|_| "研究控制器不可用")?;
    if c.active.is_some() || c.pending.is_some() {
        return Err("已有研究或安装正在进行，或存在未保存报告，请先处理".into());
    }
    let (tx, rx) = oneshot::channel();
    c.error = None;
    c.active = Some(Active {
        root,
        id: id.into(),
        stage: "准备中".into(),
        cancel: Some(tx),
        tree: None,
        installation,
        progress: None,
    });
    Ok(rx)
}
fn finish(id: &str, error: Option<String>) {
    if let Ok(mut c) = control().lock() {
        if c.active.as_ref().is_some_and(|r| r.id == id) {
            c.active = None;
            c.error = error;
        }
    }
}

#[derive(Deserialize)]
pub struct Request {
    root: PathBuf,
    action: Action,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Action {
    Status,
    Check,
    Install,
    Cancel,
    List,
    RetrySave,
    Get {
        id: String,
    },
    Thread { id: String },
    Papers {
        id: String,
    },
    PreviewScope {
        selections: Vec<scope::Selection>,
    },
    Start {
        id: String,
        query: String,
        profile_id: String,
        #[serde(default)]
        parent_id: Option<String>,
        selections: Vec<scope::Selection>,
        scope_hash: String,
    },
    PreviewNote {
        id: String,
        entry_id: String,
    },
}
#[tauri::command]
pub async fn deep_research<R: Runtime>(
    app: AppHandle<R>,
    request: Request,
) -> Result<Value, String> {
    let root = request.root.canonicalize().map_err(|_| "资料库不可用")?;
    let ws = Workspace::open_existing(&root).map_err(|e| e.to_string())?;
    let cache = storage::cache_dir(&app)?;
    match request.action {
        Action::Status => {
            let mut c = control().lock().map_err(|_| "研究状态不可用")?;
            if c.active.is_none() { c.ready = component::installed(&cache); }
            Ok(
                json!({"ready":c.ready,"version":runtime::VERSION,"error":c.error,"pending_save":c.pending.as_ref().is_some_and(|(r,_)| r == &root), "pending_task_id":c.pending.as_ref().filter(|(r,_)| r == &root).map(|(_,t)| &t.id),
                "active":c.active.as_ref().map(|r| json!({"id":if r.root == root { Some(&r.id) } else {None},"stage":r.stage,"installation":r.installation,"progress":r.progress}))}),
            )
        }
        Action::Check => {
            // Prevent a check process from reading a component being retired by installation.
            let id = NoteId::new().to_string();
            let mut cancel = reserve(root, &id, true)?;
            let result = tokio::select! {
                _ = &mut cancel => {
                    finish(&id, None);
                    return Err("已取消检查".into());
                },
                result = runtime::check(&cache) => result,
            };
            if result.is_err() { component::invalidate(&cache); }
            if let Ok(mut c) = control().lock() {
                c.ready = result.is_ok();
                c.error = result.clone().err();
            }
            finish(&id, result.clone().err());
            result?;
            Ok(json!({"ready":true,"version":runtime::VERSION}))
        }
        Action::Install => {
            let bundle = component::bundle(&app)?;
            let id = NoteId::new().to_string();
            let cancel = reserve(root, &id, true)?;
            tauri::async_runtime::spawn(async move {
                let result = component::install(cache, bundle, id.clone(), cancel).await;
                if let Ok(mut c) = control().lock() {
                    c.ready = result.is_ok();
                }
                finish(&id, result.err());
            });
            Ok(json!({"started":true}))
        }
        Action::Cancel => {
            let mut c = control().lock().map_err(|_| "研究状态不可用")?;
            if let Some(run) = c.active.as_mut().filter(|r| r.root == root) {
                run.stage = "正在取消".into();
                if let Some(tx) = run.cancel.take() {
                    let _ = tx.send(());
                }
            }
            Ok(json!({"cancelled":true}))
        }
        Action::RetrySave => {
            let mut c = control().lock().map_err(|_| "研究状态不可用")?;
            if let Some((r, task)) = c.pending.as_ref().filter(|(r, _)| r == &root) {
                Workspace::open_existing(r)
                    .and_then(|w| w.write_research_task(task))
                    .map_err(|_| "报告仍无法保存，请检查磁盘空间和权限")?;
                c.pending = None;
                c.error = None;
            }
            Ok(json!({"saved":true}))
        }
        Action::List => {
            let mut tasks = ws.list_research_tasks().map_err(|e| e.to_string())?;
            let active = control()
                .lock()
                .map_err(|_| "研究状态不可用")?
                .active
                .as_ref()
                .filter(|r| r.root == root)
                .map(|r| r.id.clone());
            for task in &mut tasks {
                if task.status == "running" && active.as_deref() != Some(&task.id) {
                    task.status = "interrupted".into();
                    task.stage = "上次退出时中断".into();
                    task.error =
                        Some("应用曾退出，任务不会自动重新发送；可查看范围后重新研究".into());
                    ws.write_research_task(task).map_err(|e| e.to_string())?;
                }
            }
            Ok(json!(tasks.iter().map(|t| json!({"id":t.id,"query":t.query,"created_at":t.created_at,"status":t.status,"stage":t.stage,"model":t.model,"error":t.error})).collect::<Vec<_>>()))
        }
        Action::Get { id } => {
            if let Ok(c) = control().lock() {
                if let Some((r, t)) = &c.pending {
                    if r == &root && t.id == id {
                        return Ok(json!(t));
                    }
                }
            }
            Ok(json!(ws
                .read_research_task(&id)
                .map_err(|e| e.to_string())?))
        }
        Action::Thread { id } => Ok(json!(thread::read(&ws, &id)?)),
        Action::PreviewScope { selections } => {
            let documents = scope::freeze(&ws, &selections)?;
            Ok(
                json!({"scope_hash":scope_hash(&documents)?,"documents":documents.iter().map(|d| json!({"id":d.id,"title":d.title,"evidence_level":d.evidence_level,"characters":d.text.chars().count()})).collect::<Vec<_>>()}),
            )
        }
        Action::PreviewNote { id, entry_id } => {
            super::assistant::research_note::preview(&ws, &id, &entry_id)
        }
        Action::Papers { id } => {
            let task = ws.read_research_task(&id).map_err(|e| e.to_string())?;
            let mut ids = Vec::new();
            for source in &task.source_urls {
                if let Ok(url) = network::public_url(source) {
                    if url
                        .host_str()
                        .is_some_and(|h| h == "arxiv.org" || h == "www.arxiv.org")
                    {
                        for prefix in ["/abs/", "/pdf/", "/html/"] {
                            if let Some(id) = url.path().strip_prefix(prefix) {
                                let id = id.trim_end_matches(".pdf").to_owned();
                                if !ids.contains(&id) && ids.len() < 10 {
                                    ids.push(id);
                                }
                            }
                        }
                    }
                }
            }
            let papers = super::research::providers::arxiv_by_ids(&ids).await?;
            super::research::remember(&root, &papers)?;
            Ok(json!(papers))
        }
        Action::Start {
            id,
            query,
            profile_id,
            parent_id,
            selections,
            scope_hash: expected,
        } => {
            if query.trim().is_empty() || query.len() > 10_000 {
                return Err("请填写研究问题（不超过 10000 字节）".into());
            }
            if id.len() != 36 || !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
                return Err("研究任务标识无效".into());
            }
            if let Ok(existing) = ws.read_research_task(&id) {
                return Ok(json!(existing));
            }
            let settings = settings::get_llm_settings(app.clone())?;
            let profile = settings
                .profiles
                .into_iter()
                .find(|p| p.id == profile_id)
                .ok_or("所选模型配置已失效")?;
            if profile.api_protocol != neuink_config::LlmApiProtocol::OpenaiCompatible {
                return Err("Research 当前支持 OpenAI 兼容接口，请选择兼容模型".into());
            }
            if profile.model.trim().is_empty() || profile.base_url.trim().is_empty() {
                return Err("请先完整配置研究模型".into());
            }
            let search_key = search_settings::web_key().ok();
            let history = thread::context(&ws, parent_id.as_deref(), &id)?;
            let timeout_seconds = 3600;
            let documents = scope::freeze(&ws, &selections)?;
            if scope_hash(&documents)? != expected {
                return Err("所选资料已变化，请重新预览后启动".into());
            }
            let mut cancel = reserve(root.clone(), &id, false)?;
            if let Err(error) = runtime::check(&cache).await {
                component::invalidate(&cache);
                finish(&id, Some(error.clone()));
                return Err(error);
            }
            let now = Utc::now().to_rfc3339();
            let task = ResearchTask {
                version: 1,
                id: id.clone(),
                query: query.trim().into(),
                parent_id,
                created_at: now.clone(),
                updated_at: now,
                status: "running".into(),
                stage: "准备研究".into(),
                profile_id,
                model: profile.model.clone(),
                retriever: "auto".into(),
                depth: "deep".into(),
                timeout_seconds,
                documents: documents.clone(),
                source_urls: Vec::new(),
                report: String::new(),
                error: None,
                engine_version: runtime::VERSION.into(),
                engine: "deerflow".into(),
                cost_estimate: None,
            };
            if let Err(e) = ws.write_research_task(&task) {
                finish(&id, None);
                return Err(e.to_string());
            }
            let payload = json!({"query":task.query,"profile":profile,"timeout_seconds":timeout_seconds,"documents":documents,"history":history,"search_key":search_key});
            let initial = task.clone();
            tauri::async_runtime::spawn(async move {
                execute(cache, root, task, payload, &mut cancel).await;
            });
            Ok(json!(initial))
        }
    }
}
fn scope_hash(
    documents: &[neuink_domain::deep_research::ResearchDocument],
) -> Result<String, String> {
    Ok(
        blake3::hash(&serde_json::to_vec(documents).map_err(|_| "资料快照无效")?)
            .to_hex()
            .to_string(),
    )
}
pub fn shutdown() {
    if let Ok(mut c) = control().lock() {
        if let Some(mut run) = c.active.take() {
            if let Some(tx) = run.cancel.take() {
                let _ = tx.send(());
            }
            drop(run.tree.take());
        }
        if let Some((root, task)) = &c.pending {
            if let Ok(ws) = Workspace::open_existing(root) {
                let _ = ws.write_research_task(task);
            }
        }
    }
}

mod execution;
use execution::execute;
