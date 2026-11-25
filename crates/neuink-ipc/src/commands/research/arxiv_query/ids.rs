use super::request::{category, text, QueryError, MAX_ID_INPUT_CHARS};
use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ArxivId {
    pub id: String,
    pub base_id: String,
    pub version: Option<u32>,
}

pub fn normalize_id(input: &str) -> Result<ArxivId, QueryError> {
    text(input, MAX_ID_INPUT_CHARS, "ids")?;
    let input = input.trim();
    let value = if input.contains("://") {
        let url = reqwest::Url::parse(input).map_err(|_| invalid_id())?;
        if !matches!(url.scheme(), "http" | "https")
            || !matches!(
                url.host_str(),
                Some("arxiv.org" | "www.arxiv.org" | "export.arxiv.org")
            )
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(invalid_id());
        }
        let path = url.path();
        let path = path
            .strip_prefix("/abs/")
            .or_else(|| path.strip_prefix("/pdf/"))
            .ok_or_else(invalid_id)?;
        path.strip_suffix(".pdf").unwrap_or(path).to_string()
    } else {
        input.strip_prefix("arxiv:").unwrap_or(input).to_string()
    };
    // A legacy archive (for example solv-int) can contain v without a version suffix.
    let suffix = value
        .rsplit_once('v')
        .filter(|(_, suffix)| !suffix.is_empty() && suffix.bytes().all(|c| c.is_ascii_digit()));
    let (base, version) = if let Some((base, suffix)) = suffix {
        if suffix.starts_with('0') {
            return Err(invalid_id());
        }
        let version = suffix.parse::<u32>().map_err(|_| invalid_id())?;
        (base, Some(version))
    } else {
        (value.as_str(), None)
    };
    let valid = if let Some((archive, serial)) = base.split_once('/') {
        archive.len() <= 64
            && category(archive)
            && !archive.contains('*')
            && digits(serial, 7, 7)
            && month(serial)
    } else if let Some((prefix, serial)) = base.split_once('.') {
        digits(prefix, 4, 4) && month(prefix) && digits(serial, 4, 5)
    } else {
        false
    };
    if !valid {
        return Err(invalid_id());
    }
    Ok(ArxivId {
        base_id: base.into(),
        id: value,
        version,
    })
}

fn digits(value: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&value.len()) && value.bytes().all(|c| c.is_ascii_digit())
}
fn month(value: &str) -> bool {
    value
        .get(2..4)
        .is_some_and(|month| ("01"..="12").contains(&month))
}
fn invalid_id() -> QueryError {
    QueryError::new(
        "invalid_id",
        "ids",
        "论文标识无效；请使用完整 arXiv ID 或无额外参数的 arXiv 论文/PDF 链接",
    )
}
