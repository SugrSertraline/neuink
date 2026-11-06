use super::{
    arxiv_http::Transport,
    arxiv_runtime::{self, Cancellation, Outcome},
};
use serde_json::{json, Value};
use std::path::Path;

pub async fn run(
    root: &Path,
    args: &Value,
    enabled: bool,
    transport: &impl Transport,
    cancel: &Cancellation,
) -> Result<Value, String> {
    if !enabled {
        return Err("请先在工具与扩展中启用论文检索".into());
    }
    let output = arxiv_runtime::read_only(root, args, transport, cancel)
        .await
        .map_err(|error| {
            if let Some(gate) = error.gate { return gate.wire(); }
            let status = error
                .http_status
                .map(|status| format!(" HTTP {status}"))
                .unwrap_or_default();
            format!(
                "arXiv 检索失败（{}）{status}；本次未下载或添加论文",
                error.code
            )
        })?;
    let next = next_query(&output);
    let search_key = output
        .search_plan
        .as_ref()
        .map(|plan| json!([plan.effective_query, plan.sort_by, plan.sort_order]).to_string());
    let mut value = serde_json::to_value(output).map_err(|_| "arXiv 结果编码失败")?;
    value["next_query"] = next.unwrap_or(Value::Null);
    value["search_key"] = json!(search_key);
    Ok(value)
}

fn next_query(output: &Outcome) -> Option<Value> {
    let plan = output.search_plan.as_ref()?;
    let start = output.next_start?;
    if output.has_more == Some(false) || start >= 30_000 {
        return None;
    }
    Some(json!({"mode":"raw", "raw_query":plan.effective_query,
        "sort_by":plan.sort_by, "sort_order":plan.sort_order, "start":start,
        "page_size":plan.page_size, "max_results":plan.max_results.min(30_000 - start)}))
}
