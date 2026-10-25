use super::super::research::network;
use reqwest::Url;
use scraper::{Html, Selector};

const MAX_PDF_BYTES: usize = 64 * 1024 * 1024;

pub(super) struct DownloadedPdf {
    pub bytes: Vec<u8>,
    pub source_url: String,
}

pub(super) fn looks_like_pdf(bytes: &[u8]) -> bool {
    // A MIME label alone accepts HTML error pages and truncated transfers.
    bytes.starts_with(b"%PDF-")
        && bytes[bytes.len().saturating_sub(4096)..]
            .windows(5)
            .any(|part| part == b"%%EOF")
}

pub(super) fn normalize_pdf_url(value: &str) -> Result<String, String> {
    let mut url = Url::parse(value.trim()).map_err(|_| "PDF 来源网址无效".to_string())?;
    // Historical OA metadata often retains HTTP. Upgrade it, never downgrade a
    // redirect or disable certificate checks when a server lacks HTTPS.
    if url.scheme() == "http" && url.port_or_known_default() == Some(80) {
        url.set_scheme("https").map_err(|_| "PDF 来源网址无效")?;
        url.set_port(None).map_err(|_| "PDF 来源端口无效")?;
    }
    if matches!(
        url.host_str(),
        Some("arxiv.org" | "www.arxiv.org" | "export.arxiv.org")
    ) {
        if let Some(id) = url.path().strip_prefix("/abs/") {
            let path = format!("/pdf/{id}");
            url.set_path(&path);
        }
    }
    url.set_fragment(None);
    network::public_url(url.as_str()).map(|url| url.into())
}

pub(super) async fn download_open_access_pdf(value: &str) -> Result<DownloadedPdf, String> {
    let start = normalize_pdf_url(value)?;
    let mut current = start.clone();
    for depth in 0..2 {
        let response = network::fetch(&current, MAX_PDF_BYTES).await?;
        if looks_like_pdf(&response.bytes) {
            return Ok(DownloadedPdf {
                bytes: response.bytes,
                source_url: start,
            });
        }
        if depth == 0
            && response
                .content_type
                .to_ascii_lowercase()
                .contains("text/html")
        {
            if response.bytes.len() > 2 * 1024 * 1024 {
                return Err("来源网页过大，未读取下载地址。".into());
            }
            if let Some(url) =
                landing_page_pdf(&String::from_utf8_lossy(&response.bytes), &response.url)
            {
                if url != current {
                    current = url;
                    continue;
                }
            }
        }
        return Err(
            "来源没有返回完整 PDF，可能需要登录或暂不提供下载。可稍后重试或上传本地文件。".into(),
        );
    }
    Err("未找到可下载的 PDF。".into())
}

fn landing_page_pdf(html: &str, base: &Url) -> Option<String> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("meta[name], meta[property]").ok()?;
    let declared = document.select(&selector).find_map(|node| {
        let name = node
            .value()
            .attr("name")
            .or_else(|| node.value().attr("property"))?;
        if ![
            "citation_pdf_url",
            "eprints.document_url",
            "wkhealth_pdf_url",
        ]
        .contains(&name.to_ascii_lowercase().as_str())
        {
            return None;
        }
        let url = base.join(node.value().attr("content")?).ok()?;
        normalize_pdf_url(url.as_str()).ok()
    });
    if declared.is_some() {
        return declared;
    }
    // Some repositories migrated their old *.pdf URLs to article pages. Follow
    // only an unambiguous, explicitly labelled PDF download on the same origin.
    let links = Selector::parse("a[href]").ok()?;
    let mut candidates = std::collections::BTreeSet::new();
    for node in document.select(&links) {
        let label = node
            .text()
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_ascii_lowercase();
        let label = label.split_whitespace().collect::<Vec<_>>().join(" ");
        let explicit = label == "pdf"
            || label.starts_with("pdf (")
            || label.starts_with("pdf（")
            || label == "download pdf"
            || label == "下载 pdf"
            || label == "下载pdf";
        if !explicit {
            continue;
        }
        let Some(url) = node
            .value()
            .attr("href")
            .and_then(|href| base.join(href).ok())
        else {
            continue;
        };
        if url.origin() == base.origin() && url.path().to_ascii_lowercase().ends_with(".pdf") {
            if let Ok(url) = normalize_pdf_url(url.as_str()) {
                candidates.insert(url);
            }
        }
    }
    if candidates.len() == 1 {
        candidates.into_iter().next()
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn upgrades_historical_http_links_without_allowing_private_targets() {
        assert_eq!(
            normalize_pdf_url("http://www.bis.org/publ/work395.pdf").unwrap(),
            "https://www.bis.org/publ/work395.pdf"
        );
        assert_eq!(
            normalize_pdf_url("http://arxiv.org/abs/1706.03762").unwrap(),
            "https://arxiv.org/pdf/1706.03762"
        );
        for url in [
            "http://127.0.0.1/p.pdf",
            "https://user:secret@example.org/p.pdf",
            "file:///p.pdf",
            "http://example.org:8080/p.pdf",
        ] {
            assert!(normalize_pdf_url(url).is_err());
        }
    }
    #[test]
    fn accepts_complete_binary_and_rejects_html_or_truncated_pdf() {
        assert!(looks_like_pdf(b"%PDF-1.7\nbody\n%%EOF\n"));
        assert!(!looks_like_pdf(b"%PDF-1.7\n"));
        assert!(!looks_like_pdf(b"<html>login %%EOF</html>"));
    }
    #[test]
    fn follows_declared_pdf_only_and_resolves_relative_urls() {
        let base = Url::parse("https://example.org/papers/42").unwrap();
        assert_eq!(
            landing_page_pdf(
                "<meta name='citation_pdf_url' content='../files/42.pdf'>",
                &base
            )
            .as_deref(),
            Some("https://example.org/files/42.pdf")
        );
        assert!(landing_page_pdf(
            "<a href='reference.pdf'>An unrelated cited paper</a>",
            &base
        )
        .is_none());
        assert!(landing_page_pdf(
            "<meta name='citation_pdf_url' content='https://127.0.0.1/private.pdf'>",
            &base
        )
        .is_none());
    }
    #[test]
    fn follows_unambiguous_repository_download_after_migration() {
        let base = Url::parse("https://www.bis.org/publications/working-paper-395").unwrap();
        let html = "<a href='/publications/working-paper-395.pdf'>PDF (38 Pages)</a><a href='/publications/working-paper-395.pdf'>PDF (38 Pages)</a>";
        assert_eq!(
            landing_page_pdf(html, &base).as_deref(),
            Some("https://www.bis.org/publications/working-paper-395.pdf")
        );
        assert!(landing_page_pdf(
            "<a href='/one.pdf'>PDF</a><a href='/two.pdf'>PDF</a>",
            &base
        )
        .is_none());
    }
}
