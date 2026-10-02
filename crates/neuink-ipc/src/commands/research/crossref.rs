use super::{free_web::plain, network, providers::short, Paper};
use serde_json::Value;

pub async fn search(query: &str, count: usize) -> Result<Vec<Paper>, String> {
    let mut url = network::public_url("https://api.crossref.org/works")?;
    url.query_pairs_mut()
        .append_pair("query", query)
        .append_pair("rows", &count.to_string());
    let bytes = network::get(url.as_str(), 2 * 1024 * 1024).await?;
    parse(&serde_json::from_slice(&bytes).map_err(|_| "Crossref 响应格式无效")?)
}

fn parse(value: &Value) -> Result<Vec<Paper>, String> {
    let rows = value["message"]["items"]
        .as_array()
        .ok_or("Crossref 缺少结果列表")?;
    Ok(rows
        .iter()
        .take(20)
        .filter_map(|p| {
            let doi = p["DOI"].as_str()?.trim();
            if !doi.starts_with("10.")
                || !doi.contains('/')
                || doi.len() > 300
                || doi.chars().any(char::is_whitespace)
            {
                return None;
            }
            let title = p["title"][0].as_str()?;
            let abstract_doc = scraper::Html::parse_fragment(p["abstract"].as_str().unwrap_or(""));
            let abstract_text = plain(abstract_doc.root_element(), 6000);
            let evidence_level = if abstract_text.is_empty() {
                "metadata"
            } else {
                "abstract"
            }
            .into();
            let mut url = network::public_url("https://doi.org/").ok()?;
            // set_path encodes '?' and '#' instead of treating DOI suffixes as URL components.
            url.set_path(doi);
            Some(Paper {
                id: format!("crossref:{}", doi.to_ascii_lowercase()),
                title: short(title, 2000),
                doi: doi.into(),
                url: url.into(),
                authors: p["author"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .take(40)
                    .map(|a| {
                        short(
                            &format!(
                                "{} {}",
                                a["given"].as_str().unwrap_or(""),
                                a["family"].as_str().unwrap_or("")
                            )
                            .trim(),
                            200,
                        )
                    })
                    .collect(),
                year: p["published"]["date-parts"][0][0]
                    .as_u64()
                    .map(|n| n.to_string())
                    .unwrap_or_default(),
                // Crossref TDM links are not evidence of open access; do not offer paywalled links as public PDFs.
                pdf_url: None,
                abstract_text,
                evidence_level,
                provider: "crossref".into(),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn metadata_does_not_claim_full_text_or_open_access() {
        let papers = parse(&json!({"message":{"items":[{"DOI":"10.1234/abc?x","title":["Paper"],"link":[{"URL":"https://publisher.org/paid.pdf","content-type":"application/pdf"}]},{"DOI":"bad","title":["Invalid"]}]}})).unwrap();
        assert_eq!(papers.len(), 1);
        assert_eq!(papers[0].evidence_level, "metadata");
        assert_eq!(papers[0].url, "https://doi.org/10.1234/abc%3Fx");
        assert!(papers[0].pdf_url.is_none());
    }
    #[test]
    fn cleans_jats_abstract_and_keeps_authors() {
        let papers = parse(&json!({"message":{"items":[{"DOI":"10.1234/test","title":["Paper"],"abstract":"<jats:p>Hello &amp; world</jats:p>","author":[{"given":"A","family":"B"}],"published":{"date-parts":[[2025,1]]}}]}})).unwrap();
        assert_eq!(papers[0].abstract_text, "Hello & world");
        assert_eq!(papers[0].year, "2025");
        assert_eq!(papers[0].authors, vec!["A B"]);
    }
    #[tokio::test]
    #[ignore = "Public Crossref request; no credentials or writes"]
    async fn live_crossref_search() {
        let papers = search("Attention is all you need", 2).await.unwrap();
        assert!(!papers.is_empty());
        assert!(papers.iter().all(|p| p.doi.starts_with("10.")));
    }
}
