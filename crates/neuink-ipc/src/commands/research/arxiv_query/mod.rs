mod ids;
mod request;
pub mod schema;

use chrono::{DateTime, Datelike, Days, Timelike, Utc};
pub use ids::{normalize_id, ArxivId};
use request::*;
pub use request::{QueryError, SortBy, SortOrder};
use serde::Serialize;
use serde_json::Value;

const API_URL: &str = "https://export.arxiv.org/api/query";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct DateFilter {
    pub field: &'static str,
    pub from_utc: DateTime<Utc>,
    pub to_utc: DateTime<Utc>,
    pub precision: &'static str,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct SearchPlan {
    pub effective_query: String,
    pub sort_by: SortBy,
    pub sort_order: SortOrder,
    pub start: u64,
    pub page_size: u64,
    pub max_results: u64,
    pub date_filter: Option<DateFilter>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum PreparedQuery {
    Search { plan: SearchPlan },
    Ids { ids: Vec<ArxivId> },
}

impl PreparedQuery {
    pub fn initial_url(&self) -> Result<reqwest::Url, QueryError> {
        let mut url = reqwest::Url::parse(API_URL)
            .map_err(|_| QueryError::new("invalid_arguments", "endpoint", "检索服务地址无效"))?;
        match self {
            Self::Search { plan } => {
                url.query_pairs_mut()
                    .append_pair("search_query", &plan.effective_query)
                    .append_pair("start", &plan.start.to_string())
                    .append_pair(
                        "max_results",
                        &plan.page_size.min(plan.max_results).to_string(),
                    )
                    .append_pair("sortBy", plan.sort_by.parameter())
                    .append_pair("sortOrder", plan.sort_order.parameter());
            }
            Self::Ids { ids } => {
                let joined = ids
                    .iter()
                    .map(|id| id.id.as_str())
                    .collect::<Vec<_>>()
                    .join(",");
                url.query_pairs_mut()
                    .append_pair("id_list", &joined)
                    .append_pair("max_results", &ids.len().to_string());
            }
        }
        // Uses only the existing transport's pure URL validation, never DNS or HTTP.
        super::network::public_url(url.as_str()).map_err(|_| {
            QueryError::new(
                "encoded_url_limit",
                "query",
                "编码后的检索地址超过传输限制，请缩短条件或拆分 ID 列表",
            )
        })?;
        Ok(url)
    }
}

pub fn prepare(input: &Value, now: DateTime<Utc>) -> Result<PreparedQuery, QueryError> {
    let object = input.as_object().ok_or_else(|| {
        QueryError::new("invalid_arguments", "request", "检索参数必须是 JSON 对象")
    })?;
    if let Some((field, _)) = object.iter().find(|(_, value)| value.is_null()) {
        return Err(QueryError::new(
            "invalid_arguments",
            field,
            "可选字段应省略，不能显式传 null",
        ));
    }
    // JSON Schema integers are mathematical integers: accept 1.0 without rounding 1.5.
    let mut normalized = input.clone();
    for field in ["start", "page_size", "max_results", "days_back"] {
        if let Some(value) = normalized.get(field).and_then(Value::as_f64) {
            if value >= 0.0 && value <= u32::MAX as f64 && value.fract() == 0.0 {
                normalized[field] = Value::from(value as u64);
            }
        }
    }
    let request: Request = serde_json::from_value(normalized).map_err(|_| {
        QueryError::new(
            "invalid_arguments",
            "request",
            "参数类型、模式、字段或枚举无效",
        )
    })?;
    let prepared = match request {
        Request::Structured {
            query,
            keywords,
            search_field,
            categories,
            sort_by,
            sort_order,
            start,
            page_size,
            max_results,
            days_back,
        } => {
            if query.is_some() && keywords.is_some() {
                return Err(QueryError::new(
                    "invalid_arguments",
                    "query",
                    "query 与 keywords 不能同时使用",
                ));
            }
            let has_text = query.is_some() || keywords.is_some();
            if !has_text && search_field.is_some() {
                return Err(QueryError::new(
                    "invalid_arguments",
                    "search_field",
                    "没有文本条件时不能指定搜索字段",
                ));
            }
            let mut parts = Vec::new();
            if let Some(categories) = categories {
                list_length(categories.len(), MAX_CATEGORIES, "categories")?;
                let mut terms = Vec::new();
                for value in categories {
                    text(&value, MAX_CATEGORY_CHARS, "categories")?;
                    if !category(&value) {
                        return Err(QueryError::new(
                            "invalid_arguments",
                            "categories",
                            "分类格式无效",
                        ));
                    }
                    terms.push(format!("cat:{value}"));
                }
                parts.push(if terms.len() == 1 {
                    terms.remove(0)
                } else {
                    format!("({})", terms.join(" OR "))
                });
            }
            let terms = match (query, keywords) {
                (Some(query), None) => vec![query],
                (None, Some(keywords)) => {
                    list_length(keywords.len(), MAX_TERMS, "keywords")?;
                    keywords
                }
                _ => Vec::new(),
            };
            if has_text {
                let field = search_field.unwrap_or(SearchField::TitleAbstract);
                let mut expressions = Vec::new();
                for term in terms {
                    text(&term, MAX_QUERY_CHARS, "query/keywords")?;
                    if term.contains(['"', '\\']) {
                        return Err(QueryError::new(
                            "unrepresentable_literal",
                            "query/keywords",
                            "结构化短语暂不接受双引号或反斜杠，请显式使用 raw 模式",
                        ));
                    }
                    expressions.push(match field.prefix() {
                        Some(prefix) => format!("{prefix}:\"{term}\""),
                        None => format!("(ti:\"{term}\" OR abs:\"{term}\")"),
                    });
                }
                parts.push(format!("({})", expressions.join(" OR ")));
            }
            if parts.is_empty() {
                return Err(QueryError::new(
                    "invalid_arguments",
                    "request",
                    "至少提供文本或分类条件",
                ));
            }
            let date_filter = date_filter(days_back, now)?;
            if let Some(filter) = &date_filter {
                parts.push(format!(
                    "submittedDate:[{} TO {}]",
                    filter.from_utc.format("%Y%m%d%H%M"),
                    filter.to_utc.format("%Y%m%d%H%M")
                ));
            }
            search_plan(
                parts.join(" AND "),
                sort_by,
                sort_order,
                start,
                page_size,
                max_results,
                date_filter,
            )?
        }
        Request::Raw {
            raw_query,
            sort_by,
            sort_order,
            start,
            page_size,
            max_results,
        } => {
            text(&raw_query, MAX_RAW_CHARS, "raw_query")?;
            search_plan(
                raw_query,
                sort_by,
                sort_order,
                start,
                page_size,
                max_results,
                None,
            )?
        }
        Request::Ids { ids } => {
            list_length(ids.len(), MAX_IDS, "ids")?;
            let mut normalized: Vec<ArxivId> = Vec::new();
            for input in ids {
                let id = normalize_id(&input)?;
                if !normalized.iter().any(|old| old.id == id.id) {
                    normalized.push(id);
                }
            }
            PreparedQuery::Ids { ids: normalized }
        }
    };
    prepared.initial_url()?;
    Ok(prepared)
}

fn search_plan(
    query: String,
    sort_by: Option<SortBy>,
    sort_order: Option<SortOrder>,
    start: Option<u64>,
    page_size: Option<u64>,
    max_results: Option<u64>,
    date_filter: Option<DateFilter>,
) -> Result<PreparedQuery, QueryError> {
    let start = start.unwrap_or(0);
    let page_size = page_size.unwrap_or(DEFAULT_RESULTS);
    let max_results = max_results.unwrap_or(DEFAULT_RESULTS);
    if !(1..=MAX_RESULTS).contains(&page_size)
        || !(1..=MAX_RESULTS).contains(&max_results)
        || start
            .checked_add(max_results)
            .is_none_or(|end| end > MAX_WINDOW_END)
    {
        return Err(QueryError::new(
            "limit_exceeded",
            "pagination",
            "分页范围超过本地临时保护上限",
        ));
    }
    Ok(PreparedQuery::Search {
        plan: SearchPlan {
            effective_query: query,
            sort_by: sort_by.unwrap_or_default(),
            sort_order: sort_order.unwrap_or_default(),
            start,
            page_size,
            max_results,
            date_filter,
        },
    })
}

fn date_filter(days: Option<u64>, now: DateTime<Utc>) -> Result<Option<DateFilter>, QueryError> {
    let Some(days) = days else {
        return Ok(None);
    };
    let invalid = || {
        QueryError::new(
            "date_out_of_range",
            "days_back",
            "日期窗口必须为正整数，且在支持的日期范围内",
        )
    };
    if !(1..=MAX_DAYS_BACK).contains(&days) {
        return Err(invalid());
    }
    let end = now
        .with_second(0)
        .and_then(|at| at.with_nanosecond(0))
        .ok_or_else(invalid)?;
    let start = end.checked_sub_days(Days::new(days)).ok_or_else(invalid)?;
    if !(1..=9999).contains(&start.year()) || !(1..=9999).contains(&end.year()) {
        return Err(invalid());
    }
    Ok(Some(DateFilter {
        field: "published",
        from_utc: start,
        to_utc: end,
        precision: "minute",
    }))
}

#[cfg(test)]
mod edge_tests;
#[cfg(test)]
mod tests;
