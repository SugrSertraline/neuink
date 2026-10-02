use super::{crossref, providers, Paper};
use std::{collections::BTreeMap, future::Future, time::Duration};

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
                bounded(providers::arxiv(query, count)).await
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
