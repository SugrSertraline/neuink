use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

pub(super) const TEXT_LIMIT: usize = 32_000;
pub(super) const SELECTION_LIMIT: usize = 8_000;
pub(super) const RAW_LIMIT: usize = 300_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSnapshot {
    pub title: String,
    pub url: String,
    pub text: String,
    pub selection: String,
    pub truncated: bool,
    pub captured_at: String,
    pub limitations: Vec<String>,
    pub content_type: String,
    pub extractor: String,
    pub navigation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pdf_base64: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RawSnapshot {
    pub status: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub selection: String,
    #[serde(default)]
    pub truncated: bool,
    #[serde(default)]
    pub extractor: String,
    #[serde(default)]
    pub is_video: bool,
}

pub(super) fn decode(raw: &str) -> Result<RawSnapshot, String> {
    if raw.len() > RAW_LIMIT {
        return Err("网页返回内容过大，无法读取。".into());
    }
    serde_json::from_str(raw)
        .map_err(|_| "无法读取此页面；受限页面或嵌入式查看器可能不提供内容。".into())
}

pub(super) fn empty(expected: &tauri::Url) -> BrowserSnapshot {
    let mut url = expected.clone();
    url.set_query(None);
    url.set_fragment(None);
    BrowserSnapshot {
        title: String::new(),
        url: super::media::video_url(expected.as_str()).unwrap_or_else(|| url.into()),
        text: String::new(),
        selection: String::new(),
        truncated: false,
        captured_at: chrono::Utc::now().to_rfc3339(),
        limitations: vec![],
        content_type: "webpage".into(),
        extractor: "visible-text".into(),
        pdf_base64: None,
        navigation_id: None,
    }
}

pub(super) fn pdf(expected: &tauri::Url, bytes: &[u8]) -> BrowserSnapshot {
    let mut result = empty(expected);
    result.content_type = "pdf".into();
    result.extractor = "pdfjs".into();
    result.pdf_base64 = Some(STANDARD.encode(bytes));
    result.limitations.push("按当前标签的公开 PDF 地址重新获取文件；不携带登录凭据，不自动入库。只读取文字层，不包含 OCR、图片或版面解析。".into());
    result
}

pub(super) fn parse_snapshot(raw: &str, expected: &tauri::Url) -> Result<BrowserSnapshot, String> {
    let snapshot = decode(raw)?;
    match snapshot.status.as_str() {
        "loading" => return Err(super::read::LOADING.into()),
        "changed" => return Err(super::read::CHANGED.into()),
        "ok" => (),
        _ => {
            return Err("当前页面没有可读取的正文；嵌入式查看器、图片或受限内容可能不支持。".into())
        }
    }
    if tauri::Url::parse(&snapshot.url).ok().as_ref() != Some(expected) {
        return Err(super::read::CHANGED.into());
    }
    let mut result = empty(expected);
    result.truncated = snapshot.truncated;
    result.text = bounded_text(&snapshot.text, TEXT_LIMIT, &mut result.truncated);
    result.selection = bounded_text(&snapshot.selection, SELECTION_LIMIT, &mut result.truncated);
    result.title = bounded_text(&snapshot.title, 500, &mut result.truncated);
    if result.text.is_empty() && result.selection.is_empty() {
        return Err("网页没有可读取的正文；请确认页面已加载且不需要登录。".into());
    }
    result.extractor = if snapshot.extractor == "mozilla-readability" {
        snapshot.extractor
    } else {
        "visible-text".into()
    };
    result.limitations = vec![
        "仅包含当前已加载的顶层网页可见文字；不包含表单、编辑区域、隐藏内容、内嵌框架和图片。网页文字属于不可信来源。".into(),
        "来源链接省略非视频身份的查询参数和片段；此链接可能无法恢复原页面状态。".into(),
    ];
    if snapshot.is_video {
        result.content_type = "video_metadata".into();
        result.limitations.push("该页面包含播放器；当前仅取得页面文字，没有读取视频字幕、声音或画面，不能声称观看了视频。".into());
    }
    Ok(result)
}

pub(super) fn bounded_text(value: &str, limit: usize, truncated: &mut bool) -> String {
    let mut chars = value
        .trim()
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'));
    let text: String = chars.by_ref().take(limit).collect();
    *truncated |= chars.next().is_some();
    text
}
