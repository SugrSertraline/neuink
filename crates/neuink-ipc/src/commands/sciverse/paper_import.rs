use super::pdf_download::{download_open_access_pdf, looks_like_pdf, normalize_pdf_url};
use super::{
    configured_client, ensure_enabled, read_settings, PrepareSciversePaperImportRequest,
    SciversePaperImportPreparation,
};
use neuink_sciverse::{SciverseClient, SciverseError};
use serde_json::Value;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub async fn prepare_sciverse_paper_import<R: Runtime>(
    app: AppHandle<R>,
    request: PrepareSciversePaperImportRequest,
) -> Result<SciversePaperImportPreparation, String> {
    let settings = read_settings(&app)?;
    ensure_enabled(settings.sciverse.enabled)?;
    let client = configured_client(&settings.sciverse)?;
    tokio::time::timeout(
        std::time::Duration::from_secs(120),
        prepare_paper_import(Some(&client), request),
    )
    .await
    .map_err(|_| "获取 PDF 超时，请稍后在条目详情重试。".to_string())?
}

pub(super) async fn prepare_paper_import(
    client: Option<&SciverseClient>,
    request: PrepareSciversePaperImportRequest,
) -> Result<SciversePaperImportPreparation, String> {
    let mut preparation = SciversePaperImportPreparation {
        title: request.title.trim().to_string(),
        doc_id: request.doc_id.trim().to_string(),
        doi: clean_optional(request.doi),
        authors: Vec::new(),
        abstract_text: None,
        publication_year: None,
        venue: None,
        access_oa_url: clean_optional(request.access_oa_url),
        access_license: None,
        pdf_path: None,
        pdf_source_url: None,
        degradation_reason: None,
        resource_attempts: Vec::new(),
    };
    if preparation.title.is_empty() {
        return Err("论文标题不能为空。".to_string());
    }

    let mut failures = Vec::new();
    let metadata = if let Some(client) = client {
        match client
            .paper_metadata(&preparation.doc_id, preparation.doi.as_deref())
            .await
        {
            Ok(value) => value,
            Err(error) => {
                failures.push(sciverse_failure(&error));
                None
            }
        }
    } else {
        None
    };
    if let Some(metadata) = metadata.as_ref() {
        apply_paper_metadata(&mut preparation, &metadata);
    }

    let mut resource_candidates = Vec::new();
    push_unique(
        &mut resource_candidates,
        clean_optional(request.resource_file_name),
    );
    if let Some(metadata) = metadata.as_ref() {
        collect_pdf_resource_candidates(metadata, &mut resource_candidates);
    }
    for file_name in &resource_candidates {
        let Some(client) = client else {
            break;
        };
        match client.resource(file_name).await {
            Ok(resource) if looks_like_pdf(&resource.bytes) => {
                preparation.pdf_path = Some(save_import_pdf(&preparation.doc_id, &resource.bytes)?);
                break;
            }
            Ok(_) => failures.push(format!("资源 {file_name} 不是 PDF")),
            Err(error) => failures.push(sciverse_failure(&error)),
        }
    }

    if preparation.pdf_path.is_none() {
        let mut open_access_urls = Vec::new();
        push_unique(&mut open_access_urls, preparation.access_oa_url.clone());
        if let Some(metadata) = metadata.as_ref() {
            collect_open_access_pdf_urls(metadata, &mut open_access_urls);
        }
        for url in &open_access_urls {
            match download_open_access_pdf(url).await {
                Ok(bytes) => {
                    preparation.pdf_path =
                        Some(save_import_pdf(&preparation.doc_id, &bytes.bytes)?);
                    preparation.pdf_source_url = Some(bytes.source_url);
                    break;
                }
                Err(error) => failures.push(error),
            }
        }
    }

    if preparation.pdf_path.is_none() {
        preparation.degradation_reason = Some(if failures.is_empty() {
            "尚未找到可下载的 PDF，可以稍后重试或上传本地文件。".to_string()
        } else {
            format!(
                "未获取到 PDF。{}",
                failures
                    .last()
                    .map(String::as_str)
                    .unwrap_or("没有可用来源")
            )
        });
    }
    preparation.resource_attempts = failures;
    Ok(preparation)
}

fn push_unique(candidates: &mut Vec<String>, value: Option<String>) {
    if let Some(value) = value {
        if !candidates.iter().any(|candidate| candidate == &value) {
            candidates.push(value);
        }
    }
}

fn collect_pdf_resource_candidates(value: &Value, candidates: &mut Vec<String>) {
    for key in ["file_name", "resource_file_name", "pdf_path"] {
        for path in metadata_strings(&value[key]) {
            if path.to_ascii_lowercase().ends_with(".pdf") && is_safe_resource_path(&path) {
                push_unique(candidates, Some(path));
            }
        }
    }
    candidates.truncate(4);
}

pub(super) fn collect_open_access_pdf_urls(value: &Value, candidates: &mut Vec<String>) {
    for key in ["access_oa_url", "pdf_url"] {
        for url in metadata_strings(&value[key]) {
            push_unique(candidates, normalize_pdf_url(&url).ok());
        }
    }
    if let Some(locations) = value["locations"].as_array() {
        for location in locations.iter().take(30) {
            let is_oa = location["is_oa"].as_bool().unwrap_or_else(|| {
                location["is_oa"]
                    .as_str()
                    .is_some_and(|v| v.eq_ignore_ascii_case("true"))
            });
            if !is_oa {
                continue;
            }
            for key in ["pdf_url", "url", "landing_page_url"] {
                for url in metadata_strings(&location[key]) {
                    push_unique(candidates, normalize_pdf_url(&url).ok());
                }
            }
        }
    }
    // Try explicit PDF links before landing pages, without losing alternative OA locations.
    candidates.sort_by_key(|url| {
        !url.split('?')
            .next()
            .unwrap_or(url)
            .to_ascii_lowercase()
            .contains(".pdf")
    });
    candidates.truncate(8);
}

pub(super) fn metadata_strings(value: &Value) -> Vec<String> {
    if let Some(value) = value.as_str() {
        return clean_text(value).into_iter().collect();
    }
    value
        .as_array()
        .into_iter()
        .flatten()
        .take(30)
        .filter_map(Value::as_str)
        .filter_map(clean_text)
        .collect()
}

pub(super) fn sciverse_failure(error: &SciverseError) -> String {
    match error.status().map(|s| s.as_u16()) {
        Some(401 | 403) => "Sciverse 凭据或资源权限不可用，请检查工具设置。".into(),
        Some(429) => "Sciverse 请求额度已达上限，请稍后重试。".into(),
        Some(status) => format!("Sciverse 查询失败（HTTP {status}），请稍后重试。"),
        None => "Sciverse 连接失败或响应异常，请稍后重试。".into(),
    }
}

fn is_safe_resource_path(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('/')
        && !value.contains('\\')
        && !value.split('/').any(|segment| segment == "..")
        && !value.contains("://")
}

fn apply_paper_metadata(preparation: &mut SciversePaperImportPreparation, value: &Value) {
    if let Some(title) = value
        .get("title")
        .and_then(Value::as_str)
        .and_then(clean_text)
    {
        preparation.title = title;
    }
    preparation.doi = preparation.doi.take().or_else(|| {
        value
            .get("doi")
            .and_then(Value::as_str)
            .and_then(clean_text)
    });
    preparation.abstract_text = value
        .get("abstract")
        .and_then(Value::as_str)
        .and_then(clean_text);
    preparation.publication_year = value
        .get("publication_published_year")
        .and_then(Value::as_f64)
        .filter(|year| year.is_finite() && year.fract() == 0.0 && (1.0..=9999.0).contains(year))
        .map(|year| year as u32);
    preparation.venue = value
        .get("publication_venue_name_unified")
        .and_then(Value::as_str)
        .and_then(clean_text);
    preparation.access_oa_url = preparation
        .access_oa_url
        .take()
        .or_else(|| metadata_strings(&value["access_oa_url"]).into_iter().next());
    preparation.access_license = metadata_strings(&value["access_license"])
        .into_iter()
        .next();
    preparation.authors = value
        .get("author")
        .and_then(Value::as_array)
        .map(|authors| {
            authors
                .iter()
                .filter_map(|author| {
                    author.as_str().and_then(clean_text).or_else(|| {
                        author
                            .get("name")
                            .and_then(Value::as_str)
                            .and_then(clean_text)
                    })
                })
                .collect()
        })
        .unwrap_or_default();
}

fn save_import_pdf(doc_id: &str, bytes: &[u8]) -> Result<String, String> {
    let safe_id = doc_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(48)
        .collect::<String>();
    let directory = std::env::temp_dir().join("neuink-sciverse-imports");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path: PathBuf = directory.join(format!(
        "{}-{}.pdf",
        if safe_id.is_empty() {
            "paper"
        } else {
            &safe_id
        },
        neuink_domain::EntryId::new()
    ));
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| clean_text(&value))
}

fn clean_text(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn real_oa_arrays_and_boolean_strings_yield_only_this_papers_locations() {
        let metadata = json!({
            "access_oa_url":["http://www.bis.org/publ/work395.pdf"],
            "locations":[
                {"is_oa":"true","url":"http://www.bis.org/publ/work395.pdf"},
                {"is_oa":true,"url":"https://example.org/article"},
                {"is_oa":"false","url":"https://example.org/paid.pdf"}
            ],
            "references":[{"pdf_url":"https://example.org/unrelated.pdf","file_name":"other.pdf"}]
        });
        let mut candidates = vec![];
        collect_open_access_pdf_urls(&metadata, &mut candidates);
        assert_eq!(
            candidates,
            vec![
                "https://www.bis.org/publ/work395.pdf",
                "https://example.org/article"
            ]
        );
        let mut resources = vec![];
        collect_pdf_resource_candidates(&metadata, &mut resources);
        assert!(resources.is_empty());
    }

    #[tokio::test]
    async fn metadata_types_are_normalized_and_missing_pdf_remains_retryable() {
        let mut result = prepare_paper_import(
            None,
            PrepareSciversePaperImportRequest {
                doc_id: "paper".into(),
                title: "Paper".into(),
                doi: None,
                access_oa_url: None,
                resource_file_name: None,
            },
        )
        .await
        .unwrap();
        assert!(result.pdf_path.is_none());
        assert!(result.degradation_reason.is_some());
        apply_paper_metadata(
            &mut result,
            &json!({"publication_published_year":2014.0,"access_oa_url":["http://www.bis.org/publ/work395.pdf"],"access_license":["cc-by"],"author":[{"name":"Claudio Borio"}]}),
        );
        assert_eq!(result.publication_year, Some(2014));
        assert_eq!(result.access_license.as_deref(), Some("cc-by"));
        assert_eq!(
            result.access_oa_url.as_deref(),
            Some("http://www.bis.org/publ/work395.pdf")
        );
        assert_eq!(result.authors, vec!["Claudio Borio"]);
    }
}
