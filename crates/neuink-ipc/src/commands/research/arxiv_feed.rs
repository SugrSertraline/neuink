use super::arxiv_paper::{ArxivMetadata, ArxivPaper as Paper};
use serde::Deserialize;

#[derive(Deserialize)]
struct Feed {
    #[serde(default, rename = "totalResults")]
    total: Option<u64>,
    #[serde(default, rename = "startIndex")]
    start: Option<u64>,
    #[serde(default, rename = "itemsPerPage")]
    page_size: Option<u64>,
    #[serde(default)]
    entry: Vec<AtomPaper>,
}

#[derive(Deserialize)]
struct AtomPaper {
    id: String,
    title: String,
    summary: String,
    #[serde(default)]
    published: String,
    #[serde(default)]
    updated: Option<String>,
    #[serde(default)]
    author: Vec<Author>,
    #[serde(default)]
    category: Vec<Category>,
    #[serde(default)]
    primary_category: Option<Category>,
    #[serde(default)]
    doi: Option<String>,
    #[serde(default)]
    comment: Option<String>,
    #[serde(default)]
    journal_ref: Option<String>,
}

#[derive(Deserialize)]
struct Author {
    name: String,
}

#[derive(Deserialize)]
struct Category {
    #[serde(rename = "@term")]
    term: String,
}

pub struct Page {
    pub papers: Vec<Paper>,
    pub total: Option<u64>,
    pub start: Option<u64>,
    pub page_size: Option<u64>,
}

pub fn parse_page(xml: &str) -> Result<Page, &'static str> {
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut depth = 0u32;
    let mut root = false;
    loop {
        match reader.read_event() {
            Ok(quick_xml::events::Event::Start(e)) => {
                if depth == 0 {
                    if root || e.local_name().as_ref() != b"feed" {
                        return Err("invalid_feed");
                    }
                    root = true;
                }
                depth += 1;
            }
            Ok(quick_xml::events::Event::Empty(e)) if depth == 0 => {
                if root || e.local_name().as_ref() != b"feed" {
                    return Err("invalid_feed");
                }
                root = true;
            }
            Ok(quick_xml::events::Event::End(_)) => {
                depth = depth.checked_sub(1).ok_or("invalid_feed")?;
            }
            Ok(quick_xml::events::Event::Eof) if root && depth == 0 => break,
            Ok(quick_xml::events::Event::DocType(_) | quick_xml::events::Event::Eof) => {
                return Err("invalid_feed")
            }
            Ok(quick_xml::events::Event::Decl(_) | quick_xml::events::Event::Comment(_)) => {}
            Ok(quick_xml::events::Event::Text(t))
                if depth == 0 && !t.iter().all(u8::is_ascii_whitespace) =>
            {
                return Err("invalid_feed")
            }
            Ok(_) => {}
            Err(_) => return Err("invalid_feed"),
        }
    }
    let feed: Feed = quick_xml::de::from_str(xml).map_err(|_| "invalid_feed")?;
    if feed.entry.iter().any(|p| p.id.contains("/api/errors")) {
        return Err("upstream_query_error");
    }
    for paper in &feed.entry {
        if chrono::DateTime::parse_from_rfc3339(&paper.published).is_err()
            || paper
                .updated
                .as_ref()
                .is_some_and(|value| chrono::DateTime::parse_from_rfc3339(value).is_err())
        {
            return Err("invalid_feed");
        }
    }
    let total = feed.total;
    let start = feed.start;
    let page_size = feed.page_size;
    let papers = convert(feed).map_err(|_| "invalid_feed")?;
    Ok(Page {
        papers,
        total,
        start,
        page_size,
    })
}

pub fn parse_arxiv(xml: &str) -> Result<Vec<Paper>, String> {
    let feed: Feed = quick_xml::de::from_str(xml).map_err(|_| "arXiv 鍝嶅簲鏍煎紡鏃犳晥")?;
    convert(feed)
}

fn convert(feed: Feed) -> Result<Vec<Paper>, String> {
    // The bounded transport limits bytes. Parsing must not silently drop records or fields.
    feed.entry
        .into_iter()
        .map(|p| {
            if p.published.is_empty() {
                return Err("arXiv 缂哄皯鍙戣〃鏃堕棿".into());
            }
            let id = p.id.split("/abs/").nth(1).ok_or("arXiv 璁烘枃鏍囪瘑鏃犳晥")?;
            if id.is_empty()
                || id.len() > 100
                || !id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || ".-/".contains(c))
                || id.contains("..")
            {
                return Err("arXiv 璁烘枃鏍囪瘑鏃犳晥".into());
            }
            let base_id = id
                .rsplit_once('v')
                .filter(|(_, version)| {
                    !version.is_empty() && version.bytes().all(|c| c.is_ascii_digit())
                })
                .map_or(id, |(base, _)| base);
            Ok(Paper {
                id: format!("arxiv:{id}"),
                title: p.title.split_whitespace().collect::<Vec<_>>().join(" "),
                authors: p.author.into_iter().map(|a| a.name).collect(),
                year: p.published.get(..4).unwrap_or("").to_string(),
                abstract_text: p.summary,
                doi: p.doi.unwrap_or_default(),
                url: format!("https://arxiv.org/abs/{id}"),
                pdf_url: Some(format!("https://arxiv.org/pdf/{id}")),
                provider: "arxiv".into(),
                evidence_level: "abstract".into(),
                arxiv: ArxivMetadata {
                    base_id: Some(base_id.to_string()),
                    categories: Some(p.category.into_iter().map(|c| c.term).collect()),
                    primary_category: p.primary_category.map(|c| c.term),
                    published: Some(p.published),
                    updated: p.updated,
                    comment: p.comment,
                    journal_ref: p.journal_ref,
                    rank: None,
                },
            })
        })
        .collect()
}
