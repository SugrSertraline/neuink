use super::research::remember;
use chrono::{Duration, NaiveDate, Utc};
use neuink_domain::{
    recommendations::{
        RecommendationBatch, RecommendationFeedback, Recommendations, RecommendedPaper,
    },
    EntryMeta,
};
use neuink_workspace::Workspace;
use serde::Deserialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::OnceLock,
};
use tauri::{AppHandle, Runtime};

static GENERATION: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
#[derive(Deserialize)]
pub struct Request {
    root: PathBuf,
    action: Action,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Action {
    Read {
        date: Option<String>,
    },
    Generate {
        date: String,
        refresh: bool,
    },
    Feedback {
        id: String,
        ignored: bool,
        saved: bool,
    },
}

#[tauri::command]
pub async fn daily_recommendations<R: Runtime>(
    app: AppHandle<R>,
    request: Request,
) -> Result<Recommendations, String> {
    let root = request.root.canonicalize().map_err(|_| "资料库不可用")?;
    let workspace = Workspace::open_existing(&root).map_err(|e| e.to_string())?;
    let selected_date = match &request.action {
        Action::Read { date } => date.clone(),
        _ => None,
    };
    let result = match request.action {
        Action::Read { .. } => workspace.read_recommendations().map_err(|e| e.to_string()),
        Action::Feedback { id, ignored, saved } => workspace
            .update_recommendations(|state| {
                if !state
                    .batches
                    .iter()
                    .any(|b| b.papers.iter().any(|p| p.paper.id == id))
                {
                    return Err(neuink_workspace::WorkspaceError::Daily(
                        "推荐记录已不存在，请刷新".into(),
                    ));
                }
                if let Some(row) = state.feedback.iter_mut().find(|f| f.id == id) {
                    row.ignored = ignored;
                    row.saved = saved;
                } else {
                    state
                        .feedback
                        .push(RecommendationFeedback { id, ignored, saved });
                }
                Ok(())
            })
            .map_err(|e| e.to_string()),
        Action::Generate { date, refresh } => {
            let _guard = GENERATION
                .get_or_init(|| tokio::sync::Mutex::new(()))
                .lock()
                .await;
            let history = workspace
                .read_recommendations()
                .map_err(|e| e.to_string())?;
            if !refresh && has_daily_batch(&history, &date) {
                Ok(history)
            } else {
                // Daily recommendations are automatic; assistant tool toggles do not gate them.
                generate(
                    &workspace,
                    &date,
                    refresh,
                    &crate::storage::cache_dir(&app)?,
                )
                .await
            }
        }
    }?;
    let papers: Vec<_> = result
        .batches
        .iter()
        .rev()
        .enumerate()
        .filter(|(i, b)| *i < 7 || selected_date.as_deref() == Some(&b.date))
        .flat_map(|(_, batch)| batch.papers.iter().map(|p| p.paper.clone()))
        .collect();
    remember(&root, &papers)?;
    Ok(result)
}
async fn generate(
    workspace: &Workspace,
    date: &str,
    refresh: bool,
    cache: &Path,
) -> Result<Recommendations, String> {
    generate_with(workspace, date, refresh, |query| async move {
        client::fetch(cache, &query).await
    })
    .await
}

fn has_daily_batch(history: &Recommendations, date: &str) -> bool {
    history.batches.iter().any(|batch| {
        batch.date == date
            && (!batch.papers.is_empty() || batch.interest_key.starts_with("arxiv.py:"))
    })
}

async fn generate_with<F, Fut>(
    workspace: &Workspace,
    date: &str,
    refresh: bool,
    fetch: F,
) -> Result<Recommendations, String>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<RecommendedPaper>, client::FetchError>>,
{
    neuink_workspace::daily::validate_date(date).map_err(|e| e.to_string())?;
    let day = NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| "日期无效")?;
    if (day - Utc::now().date_naive()).num_days().abs() > 1 {
        return Err("只能生成今天的推荐，历史日期可查看已保存批次".into());
    }
    let history = workspace
        .read_recommendations()
        .map_err(|e| e.to_string())?;
    // A successful local day is authoritative, including a genuine empty result. No library scan,
    // Python preparation or network request occurs merely because today's interests have changed.
    if !refresh && has_daily_batch(&history, date) {
        return Ok(history);
    }
    let entries = workspace.list_entries().map_err(|e| e.to_string())?;
    let topics = interests(workspace, &entries, day)?;
    if topics.is_empty() {
        return Err("暂无近期阅读标签可用于推荐。阅读带研究标签的论文后再试；系统会自动识别常见中文标签和标签中的英文术语。".into());
    }
    let query = query::search_query(&topics);
    let interest_key = format!("arxiv.py:{}", blake3::hash(query.as_bytes()).to_hex());
    if let Some(message) = refresh_delay(&history, &interest_key, Utc::now(), date) {
        return Err(message.into());
    }
    workspace
        .update_recommendations(|state| {
            state.last_attempt_at = Some(Utc::now().to_rfc3339());
            state.last_error = None;
            // A killed app/installer must not cause immediate repeated calls on restart.
            state.retry_after = Some((Utc::now() + Duration::seconds(60)).to_rfc3339());
            Ok(())
        })
        .map_err(|e| e.to_string())?;
    let since = day - Duration::days(30);
    let search = format!(
        "({query}) AND submittedDate:[{}0000 TO {}2359]",
        since.format("%Y%m%d"),
        day.format("%Y%m%d")
    );
    let fetched = match fetch(search).await {
        Ok(papers) => papers,
        Err(error) => {
            workspace
                .update_recommendations(|state| {
                    state.last_error = Some(error.message.clone());
                    state.retry_after = Some(
                        (Utc::now() + Duration::seconds(error.retry_after_seconds)).to_rfc3339(),
                    );
                    Ok(())
                })
                .map_err(|e| e.to_string())?;
            return Err(error.message);
        }
    };
    let papers = rank(fetched, &topics, &history, &entries, date);
    let batch = RecommendationBatch {
        date: date.into(),
        generated_at: Utc::now().to_rfc3339(),
        interest_key,
        interests: topics,
        papers,
    };
    workspace
        .update_recommendations(|state| {
            state.batches.retain(|old| old.date != date);
            state.batches.push(batch);
            if state.batches.len() > 366 {
                state.batches.remove(0);
            }
            state.last_error = None;
            state.retry_after = None;
            Ok(())
        })
        .map_err(|e| e.to_string())
}

fn refresh_delay(
    history: &Recommendations,
    interest_key: &str,
    now: chrono::DateTime<Utc>,
    date: &str,
) -> Option<String> {
    if let Some(until) = history
        .retry_after
        .as_ref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
    {
        let remaining = (until.with_timezone(&Utc) - now).num_seconds();
        if remaining > 0 {
            return Some(format!(
                "获取冷却中，请在 {remaining} 秒后重试；已有推荐可继续查看。{}",
                if history
                    .last_error
                    .as_ref()
                    .is_some_and(|e| e.contains("HTTP 429"))
                {
                    "arXiv 仍可能限流（HTTP 429）。"
                } else {
                    ""
                }
            ));
        }
    }
    let attempted = history
        .last_attempt_at
        .as_ref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())?;
    let elapsed = (now - attempted.with_timezone(&Utc)).num_seconds();
    if history
        .last_error
        .as_ref()
        .is_some_and(|error| error.contains("HTTP 429"))
        && elapsed < 60
    {
        return Some(format!(
            "arXiv 暂时限制了请求频率（HTTP 429），请在 {} 秒后重试。",
            (60 - elapsed).clamp(1, 60)
        ));
    }
    if history.last_error.is_some() && elapsed < 15 {
        return Some("上次获取失败，请稍等 15 秒后重试".into());
    }
    if history.last_error.is_none()
        && elapsed < 300
        && history
            .batches
            .last()
            .is_some_and(|batch| batch.date == date && batch.interest_key == interest_key)
    {
        return Some("刚刚已获取推荐，请在 5 分钟后刷新".into());
    }
    None
}

mod client;
mod query;
mod ranking;
use ranking::{interests, rank};
#[cfg(test)]
mod cache_tests;
#[cfg(test)]
mod tests;
