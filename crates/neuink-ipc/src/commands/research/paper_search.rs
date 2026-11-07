use super::{crossref, providers, Paper};
use serde_json::{json, Value};
use std::{collections::BTreeMap, future::Future, path::Path, time::Duration};

pub async fn read_only(
    root: &Path,
    search: impl Future<Output = Result<(Vec<Paper>, BTreeMap<String, String>), String>>,
) -> Result<Value, String> {
    let root = neuink_workspace::validate_workspace_read_only(root).map_err(read_only_error)?;
    let (papers, errors) = search.await?;
    // The workspace may have changed while the network future was suspended.
    neuink_workspace::validate_workspace_read_only(&root).map_err(read_only_error)?;
    super::remember(&root, &papers)?;
    let source_errors:BTreeMap<String,super::arxiv_gate::GateError>=errors.iter()
        .filter_map(|(source,error)|super::arxiv_gate::from_wire(error).map(|gate|(source.clone(),gate))).collect();
    let errors:BTreeMap<String,String>=errors.into_iter().map(|(source,error)|{
        let message=source_errors.get(&source).map(|e|e.message()).unwrap_or(error);(source,message)
    }).collect();
    Ok(
        json!({"papers":papers,"errors":errors,"source_errors":source_errors,"retrieved_at":chrono::Utc::now().to_rfc3339(),
        "notice":"这些是检索元数据和摘要，不代表已读全文。只能引用返回的 URL。下载请调用 import_papers 等待用户确认；不得自行编造 PDF 地址。"}),
    )
}

fn read_only_error(error: neuink_workspace::WorkspaceError) -> String {
    use neuink_workspace::WorkspaceError;
    match error {
        WorkspaceError::TagReading(message) => message,
        WorkspaceError::WorkspaceSchemaUnsupported(_) => {
            "资料库版本不受支持，搜索未执行写盘".into()
        }
        WorkspaceError::WorkspaceMarkerMissing(_) => "缺少资料库标记，搜索不会初始化该目录".into(),
        WorkspaceError::WorkspaceMissing(_) | WorkspaceError::WorkspaceNotDirectory(_) => {
            "资料库目录不可用，搜索不会创建目录".into()
        }
        _ => "无法读取有效资料库标记，请检查资料库；搜索未执行修复".into(),
    }
}

pub async fn bounded<T>(future: impl Future<Output = Result<T, String>>) -> Result<T, String> {
    tokio::time::timeout(Duration::from_secs(25), future)
        .await
        .map_err(|_| "公开检索服务超时，请稍后重试".to_string())?
}

pub async fn search(
    query: &str,
    count: usize,
    source: &str,
) -> Result<(Vec<Paper>, BTreeMap<String, String>), String> {
    if !["all", "arxiv", "crossref", "openalex"].contains(&source) {
        return Err("不支持的论文来源".into());
    }
    // OpenAlex's anonymous quota is limited; keep explicit access without making it a default dependency.
    let (arxiv, crossref, openalex) = tokio::join!(
        async {
            if ["all", "arxiv"].contains(&source) {
                providers::arxiv(query, count).await
            } else {
                Ok(vec![])
            }
        },
        async {
            if ["all", "crossref"].contains(&source) {
                bounded(crossref::search(query, count)).await
            } else {
                Ok(vec![])
            }
        },
        async {
            if source == "openalex" {
                bounded(providers::openalex(query, count)).await
            } else {
                Ok(vec![])
            }
        },
    );
    merge(
        count,
        source,
        [
            ("arxiv", arxiv),
            ("crossref", crossref),
            ("openalex", openalex),
        ],
    )
}

fn merge<const N: usize>(
    count: usize,
    source: &str,
    results: [(&str, Result<Vec<Paper>, String>); N],
) -> Result<(Vec<Paper>, BTreeMap<String, String>), String> {
    let mut errors = BTreeMap::new();
    let mut sources = Vec::new();
    for (name, result) in results {
        match result {
            Ok(rows) => sources.push(rows),
            Err(error) => {
                errors.insert(name.to_string(), error);
            }
        }
    }
    if (source == "all" && errors.contains_key("arxiv") && errors.contains_key("crossref"))
        || errors.contains_key(source)
    {
        // Keep the exact typed host failure for single-source failures and all-source failures.
        if let Some(error)=errors.get("arxiv").and_then(|v|super::arxiv_gate::from_wire(v)) {return Err(error.wire());}
        return Err(format!(
            "论文检索服务不可用：{}",
            errors
                .iter()
                .map(|(n, e)| format!("{n}: {e}"))
                .collect::<Vec<_>>()
                .join("；")
        ));
    }
    let mut papers: Vec<Paper> = Vec::new();
    for index in 0..count {
        for rows in &sources {
            if let Some(p) = rows.get(index) {
                if papers.len() < count
                    && !papers.iter().any(|old| {
                        old.id == p.id
                            || (!p.doi.is_empty() && old.doi.eq_ignore_ascii_case(&p.doi))
                    })
                {
                    papers.push(p.clone());
                }
            }
        }
    }
    Ok((papers, errors))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn paper(id: &str, doi: &str) -> Paper {
        Paper {
            id: id.into(),
            doi: doi.into(),
            title: id.into(),
            authors: vec![],
            year: String::new(),
            abstract_text: String::new(),
            url: "https://example.org".into(),
            pdf_url: None,
            provider: "test".into(),
            evidence_level: "metadata".into(),
        }
    }
    #[test]
    fn partial_failure_is_visible_and_does_not_discard_success() {
        let (papers, errors) = merge(
            5,
            "all",
            [
                ("arxiv", Err("timeout".into())),
                ("crossref", Ok(vec![paper("c", "10.1/a")])),
            ],
        )
        .unwrap();
        assert_eq!(papers.len(), 1);
        assert!(errors.contains_key("arxiv"));
        assert!(merge(
            5,
            "all",
            [
                ("arxiv", Err("timeout".into())),
                ("crossref", Err("429".into()))
            ]
        )
        .is_err());
    }
    #[test]
    fn deduplicates_doi_and_enforces_total_limit() {
        let (papers, _) = merge(
            2,
            "all",
            [
                (
                    "arxiv",
                    Ok(vec![paper("a", "10.1/A"), paper("b", "10.1/b")]),
                ),
                (
                    "crossref",
                    Ok(vec![paper("c", "10.1/a"), paper("d", "10.1/d")]),
                ),
            ],
        )
        .unwrap();
        assert_eq!(papers.len(), 2);
        assert_eq!(papers[0].id, "a");
        assert_eq!(papers[1].id, "b");
    }
}
