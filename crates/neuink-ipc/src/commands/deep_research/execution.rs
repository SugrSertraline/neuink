//! Background execution and durable progress; independent of any open panel.
use super::*;
pub(super) async fn execute(
    cache: PathBuf,
    root: PathBuf,
    mut task: ResearchTask,
    mut payload: Value,
    cancel: &mut oneshot::Receiver<()>,
) {
    let result = async {
        let ws = Workspace::open_existing(&root).map_err(|e| e.to_string())?;
        let key = payload["search_key"].as_str().map(str::to_owned);
        let retriever = retriever::start_with_key(root.clone(), key).await?;
        payload["retriever_endpoint"] = json!(retriever.endpoint);
        payload.as_object_mut().map(|p| p.remove("search_key"));
        let mut last_save = std::time::Instant::now();
        let mut result = runtime::run(
            &cache,
            &task.id.clone(),
            payload,
            task.timeout_seconds + 10,
            cancel,
            |event| {
                let sources = retriever.sources();
                let sources_changed = task.source_urls != sources;
                task.source_urls = sources;
                let stage = if event["stage"] == "planning" { "正在规划研究" }
                else if event["stage"] == "writing" || event["event"] == "writing_report" {
                    "正在整理带引用的报告"
                } else {
                    "正在检索和阅读来源"
                };
                let stage_changed = task.stage != stage;
                let mut changed = stage_changed || sources_changed;
                if event["type"] == "report_delta" || event["type"] == "report_snapshot" {
                    let text = event["text"].as_str().unwrap_or("");
                    if text.len() + if event["type"] == "report_delta" { task.report.len() } else { 0 } > 1024 * 1024 {
                        return Err("报告超过支持大小，已停止并保留现有内容".into());
                    }
                    if event["type"] == "report_snapshot" { task.report = text.into(); } else { task.report.push_str(text); }
                    changed = true;
                }
                if changed {
                    task.stage = if task.report.is_empty() {
                        stage.into()
                    } else {
                        "正在整理带引用的报告".into()
                    };
                    task.updated_at = Utc::now().to_rfc3339();
                    if stage_changed || last_save.elapsed() >= std::time::Duration::from_millis(750) {
                        ws.write_research_task(&task).map_err(|_| "研究进度保存失败，请检查磁盘")?;
                        last_save = std::time::Instant::now();
                    }
                }
                set_stage(&task.id, &task.stage);
                Ok(())
            },
        )
        .await;
        if let Ok(value) = &mut result { value["source_urls"] = json!(retriever.sources()); }
        result
    }
    .await;
    match result {
        Ok(value) => {
            task.report = value["report"].as_str().unwrap_or("").to_owned();
            task.source_urls = value["source_urls"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter(|s| network::public_url(s).is_ok())
                .take(100)
                .map(str::to_owned)
                .collect();
            let unverified =
                neuink_workspace::deep_research::unverified_links(&task.report, &task.source_urls);
            if !unverified.is_empty() {
                task.report.push_str("\n\n---\n\n**引用核查提示：以下链接未能与工具返回的检索来源对应，请打开原文核对后再引用。**\n\n");
                for (i, url) in unverified.iter().take(20).enumerate() {
                    task.report
                        .push_str(&format!("- 待核查 {}：{}\n", i + 1, url));
                }
            }
            task.status = if task.report.trim().is_empty() {
                "failed"
            } else {
                "completed"
            }
            .into();
            task.stage = if task.status == "completed" {
                "研究完成"
            } else {
                "未取得报告"
            }
            .into();
        }
        Err(error) => {
            task.status = if error.starts_with("已取消") {
                "cancelled"
            } else {
                "failed"
            }
            .into();
            task.stage = if task.status == "cancelled" {
                "已取消"
            } else {
                "研究未完成"
            }
            .into();
            task.error = Some(error);
        }
    }
    task.updated_at = Utc::now().to_rfc3339();
    let persisted = Workspace::open_existing(&root).and_then(|ws| ws.write_research_task(&task));
    let error = if persisted.is_err() {
        if let Ok(mut c) = control().lock() {
            c.pending = Some((root, task.clone()));
        }
        Some("研究结果暂未保存，请保持应用打开并重试保存".into())
    } else {
        task.error.clone()
    };
    finish(&task.id, error);
}
