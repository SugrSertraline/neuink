use super::{current_sync_root, read, scheduler, tasks, Request};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Runtime};

/// Local/offline actions complete without acquiring the credential lock.
pub(super) async fn handle<R: Runtime>(
    app: &AppHandle<R>,
    request: &Request,
) -> Result<Option<Value>, String> {
    if let Request::SyncEntryStatus { root } = request {
        let root = current_sync_root(app, root)?;
        let account = read(app)?;
        return tokio::task::spawn_blocking(move || {
            let workspace = neuink_workspace::Workspace::open_existing(&root).map_err(|e|e.to_string())?;
            if let Some(binding) = workspace.sync_binding().map_err(|e|e.to_string())? {
                if account.account_id.as_ref() != Some(&binding.account_id) || account.server_id != binding.server_id {
                    return Err("当前账号与资料库同步绑定不一致".to_owned());
                }
            }
            serde_json::to_value(neuink_sync::workspace_sync::entry_status::inspect(&workspace)?)
                .map(Some).map_err(|_| "无法读取论文同步状态".to_owned())
        }).await.map_err(|_| "论文同步状态检查中断")?;
    }
    if matches!(request, Request::RecoveryInspect | Request::RecoveryRetry | Request::RecoveryKeepCurrent { .. }) {
        let root=super::super::workspace::current_workspace_root(app)?.canonicalize().map_err(|_|"无法定位资料库")?;
        if tasks::status(&root)?.running {return Err("请先取消当前同步，再处理恢复记录".into());}
        let value=match request {
            Request::RecoveryInspect=>serde_json::to_value(neuink_workspace::recovery_control::inspect(&root)?).map_err(|_|"无法返回恢复记录")?,
            Request::RecoveryRetry=>{neuink_workspace::recovery_control::retry(&root)?;json!({"ok":true})}
            Request::RecoveryKeepCurrent{name,token}=>json!({"archive":neuink_workspace::recovery_control::keep_current(&root,name,token)?}),
            _=>return Err("恢复操作无效".into()),
        };
        return Ok(Some(value));
    }
    if matches!(request, Request::SyncStatus) {
        let root = super::super::workspace::current_workspace_root(&app)?
            .canonicalize()
            .map_err(|_| "无法定位当前资料库")?;
        let workspace =
            neuink_workspace::Workspace::open_existing(&root).map_err(|e| e.to_string())?;
        let binding = workspace.sync_binding().map_err(|e| e.to_string())?;
        let conflict_root = root.clone();
        let conflict_binding = binding.clone();
        let conflict_count = tokio::task::spawn_blocking(move || {
            let workspace = neuink_workspace::Workspace::open_existing(&conflict_root).map_err(|e| e.to_string())?;
            match conflict_binding {
                Some(binding) => neuink_sync::workspace_sync::conflicts::count(&workspace, &binding),
                None => Ok(0),
            }
        }).await.map_err(|_| "冲突状态检查中断".to_owned()).and_then(|value| value);
        let (conflict_count, conflict_error) = match conflict_count {
            Ok(count) => (Some(count), None),
            Err(error) => (None, Some(error)),
        };
        return Ok(Some(
            json!({"root":root, "binding":binding, "conflict_count":conflict_count, "conflict_error":conflict_error, "task":tasks::status(&root)?, "control":workspace.sync_control().map_err(|e| e.to_string())?, "schedule":scheduler::view(&root)?}),
        ));
    }
    if let Request::SyncPause { root, paused } = &request {
        let root = current_sync_root(&app, root)?;
        let workspace =
            neuink_workspace::Workspace::open_existing(&root).map_err(|e| e.to_string())?;
        let control = workspace
            .set_sync_paused(*paused)
            .map_err(|e| e.to_string())?;
        if *paused {
            tasks::cancel(&root)?;
        } else {
            scheduler::reset(&root)?;
        }
        return serde_json::to_value(control)
            .map(Some)
            .map_err(|_| "无法返回同步设置".into());
    }
    if let Request::SyncWake { root } = &request {
        let root = current_sync_root(&app, root)?;
        if !scheduler::view(&root)?.blocked {
            scheduler::reset(&root)?;
        }
        return Ok(Some(Value::Null));
    }
    if let Request::SyncAuto { root } = &request {
        let root = current_sync_root(&app, root)?;
        let workspace =
            neuink_workspace::Workspace::open_existing(&root).map_err(|e| e.to_string())?;
        let account = read(&app)?;
        let binding = workspace.sync_binding().map_err(|e| e.to_string())?;
        if account.account_id.is_none()
            || binding.as_ref().is_none_or(|binding| {
                Some(&binding.account_id) != account.account_id.as_ref()
                    || binding.server_id != account.server_id
            })
            || workspace.sync_control().map_err(|e| e.to_string())?.paused
            || tasks::status(&root)?.running
        {
            return Ok(Some(Value::Null));
        }
        let stamp_root = root.clone();
        let stamp = tokio::task::spawn_blocking(move || {
            neuink_workspace::sync_control::change_stamp(&stamp_root)
        })
        .await
        .map_err(|_| "本地同步检查中断")?
        .map_err(|_| "本地同步检查未完成，请检查资料库")?;
        if !scheduler::claim(&root, stamp)? {
            return Ok(Some(Value::Null));
        }
    }
    if let Request::SyncConflicts { root }
    | Request::SyncDeletionGroup { root, .. }
    | Request::SyncResolveDeletionGroup { root, .. }
    | Request::SyncConflict { root, .. }
    | Request::SyncResolve { root, .. }
    | Request::SyncMergeNote { root, .. } = &request
    {
        let root = current_sync_root(&app, root)?;
        let workspace =
            neuink_workspace::Workspace::open_existing(&root).map_err(|e| e.to_string())?;
        let binding = workspace
            .sync_binding()
            .map_err(|e| e.to_string())?
            .ok_or("请先确认同步绑定")?;
        let account = read(&app)?;
        if account.account_id.is_some()
            && (account.account_id.as_ref() != Some(&binding.account_id)
                || account.server_id != binding.server_id)
        {
            return Err("当前账号与此资料库绑定不一致，请切回原账号或退出后查看本地内容".into());
        }
        let result = match &request {
            Request::SyncDeletionGroup { id, .. } => serde_json::to_value(neuink_sync::workspace_sync::conflicts::group::inspect(&workspace,&binding,id)?),
            Request::SyncResolveDeletionGroup { id, token, keep_local, .. } => {
                neuink_sync::workspace_sync::conflicts::group::resolve(&workspace,&binding,id,token,*keep_local)?;
                scheduler::reset(&root)?;Ok(json!({"ok":true}))
            }
            Request::SyncConflicts { .. } => serde_json::to_value(
                neuink_sync::workspace_sync::conflicts::list(&workspace, &binding)?,
            ),
            Request::SyncConflict { id, .. } => serde_json::to_value(
                neuink_sync::workspace_sync::conflicts::detail(&workspace, &binding, id)?,
            ),
            Request::SyncResolve {
                id,
                token,
                keep_local,
                ..
            } => {
                neuink_sync::workspace_sync::conflicts::resolve(
                    &workspace,
                    &binding,
                    id,
                    token,
                    *keep_local,
                )?;
                scheduler::reset(&root)?;
                Ok(json!({"ok":true}))
            }
            Request::SyncMergeNote {
                id,
                token,
                markdown,
                ..
            } => {
                neuink_sync::workspace_sync::conflicts::merge_note(
                    &workspace, &binding, id, token, markdown,
                )?;
                let _ = app.emit("cloud-library-changed", json!({"root":root}));
                scheduler::reset(&root)?;
                Ok(json!({"ok":true}))
            }
            _ => return Err("不支持的冲突操作".into()),
        };
        return result.map(Some).map_err(|_| "无法返回冲突状态".into());
    }
    if let Request::SyncCancel { root } = &request {
        let root = root.canonicalize().map_err(|_| "无法定位同步资料库")?;
        tasks::cancel(&root)?;
        return Ok(Some(json!({"ok":true})));
    }
    if matches!(request, Request::Preview | Request::SyncPreview { .. }) {
        let root = match &request {
            Request::SyncPreview { root } => current_sync_root(&app, root)?,
            _ => super::super::workspace::current_workspace_root(&app)?,
        };
        return tokio::task::spawn_blocking(move || {
            let inventory = neuink_workspace::sync_inventory::preview(&root).map_err(|_| {
                "无法完成同步预览，文件可能正在修改或包含外部链接，请稍后重试".to_string()
            })?;
            serde_json::to_value(inventory).map_err(|_| "无法返回同步预览".to_string())
        })
        .await
        .map_err(|_| "同步预览未完成".to_string())?
        .map(Some);
    }
    Ok(None)
}
