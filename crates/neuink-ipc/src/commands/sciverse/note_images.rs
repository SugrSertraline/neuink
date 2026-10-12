use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD, Engine};
use neuink_domain::{EntryId, NoteId};
use neuink_sciverse::SciverseClient;
use neuink_workspace::{note_image::MAX_NOTE_IMAGE_BYTES, Workspace};
use reqwest::Url;
use serde::Deserialize;
use tauri::{AppHandle, Runtime};
use tokio::sync::Semaphore;

use super::{configured_client, ensure_enabled, read_settings};
use crate::commands::{entry::ImportNoteAssetResponse, research::network};

static IMAGE_DOWNLOADS: Semaphore = Semaphore::const_new(3);

#[derive(Deserialize)]
pub struct SaveSciverseNoteImageRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub note_id: NoteId,
    pub reference: String,
}

#[tauri::command]
pub async fn save_sciverse_note_image<R: Runtime>(
    app: AppHandle<R>,
    request: SaveSciverseNoteImageRequest,
) -> Result<ImportNoteAssetResponse, String> {
    let settings = read_settings(&app)?;
    ensure_enabled(settings.sciverse.enabled)?;
    let client = configured_client(&settings.sciverse)?;
    save_image(&client, &settings.sciverse.base_url, request).await
}

pub(super) async fn save_image(
    client: &SciverseClient,
    base_url: &str,
    request: SaveSciverseNoteImageRequest,
) -> Result<ImportNoteAssetResponse, String> {
    let _permit = IMAGE_DOWNLOADS
        .acquire()
        .await
        .map_err(|_| "图片下载已停止")?;
    let bytes = match image_source(&request.reference, base_url)? {
        ImageSource::Resource(file_name) => {
            client
                .resource_limited(&file_name, MAX_NOTE_IMAGE_BYTES as u64)
                .await
                .map_err(|error| match error.status().map(|status| status.as_u16()) {
                    Some(401 | 403) => "Sciverse 图片访问未获授权，请检查外部服务设置".to_string(),
                    Some(404) => "Sciverse 图片资源不存在".to_string(),
                    Some(429) => "Sciverse 请求额度或频率受限，请稍后重试".to_string(),
                    Some(413) => "图片超过 20 MB".to_string(),
                    _ => "Sciverse 图片下载失败，请稍后重试".to_string(),
                })?
                .bytes
        }
        // Credentials are only used by resource(), never forwarded to public image hosts.
        ImageSource::PublicUrl(url) => network::get(&url, MAX_NOTE_IMAGE_BYTES).await?,
        ImageSource::Data(bytes) => bytes,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = Workspace::open_existing(&request.root).map_err(|_| "资料库不可用")?;
        let (markdown_path, file_path) = workspace
            .write_note_image(&request.entry_id, &request.note_id, &bytes)
            .map_err(|_| "图片无效或笔记已不可用，未写入附件")?;
        Ok(ImportNoteAssetResponse {
            markdown_path,
            file_path: file_path.to_string_lossy().into_owned(),
        })
    })
    .await
    .map_err(|_| "保存图片任务未完成")?
}

#[derive(Debug, PartialEq)]
enum ImageSource {
    Resource(String),
    PublicUrl(String),
    Data(Vec<u8>),
}

fn image_source(reference: &str, base_url: &str) -> Result<ImageSource, String> {
    let reference = reference.trim();
    if reference.starts_with("data:") {
        let (header, encoded) = reference.split_once(',').ok_or("内嵌图片无效")?;
        if ![
            "data:image/png;base64",
            "data:image/jpeg;base64",
            "data:image/jpg;base64",
            "data:image/gif;base64",
            "data:image/webp;base64",
            "data:image/avif;base64",
        ]
        .contains(&header.to_ascii_lowercase().as_str())
        {
            return Err("内嵌图片格式不支持".into());
        }
        if encoded.len() > MAX_NOTE_IMAGE_BYTES.div_ceil(3) * 4 {
            return Err("图片超过 20 MB".into());
        }
        return STANDARD
            .decode(encoded)
            .map(ImageSource::Data)
            .map_err(|_| "内嵌图片无效".into());
    }
    let endpoint = Url::parse(&format!("{}/resource", base_url.trim_end_matches('/')))
        .map_err(|_| "Sciverse 服务地址无效")?;
    let resolved = if reference.starts_with("/resource?") || reference.starts_with("resource?") {
        endpoint.join(reference).ok()
    } else {
        Url::parse(reference).ok()
    };
    if let Some(mut url) = resolved {
        if url.origin() == endpoint.origin() && url.path() == endpoint.path() {
            let paths: Vec<_> = url
                .query_pairs()
                .filter(|(key, _)| key == "file_name")
                .collect();
            if paths.len() != 1 {
                return Err("Sciverse 图片缺少唯一资源路径".into());
            }
            return Ok(ImageSource::Resource(safe_resource_path(&paths[0].1)?));
        }
        if url.scheme() == "http" {
            url.set_scheme("https").map_err(|_| "图片地址无效")?;
        }
        return network::public_url(url.as_str())
            .map(|url| ImageSource::PublicUrl(url.to_string()));
    }
    // Paths in /content belong to Sciverse storage, not the paper's OA website.
    Ok(ImageSource::Resource(safe_resource_path(reference)?))
}

fn safe_resource_path(value: &str) -> Result<String, String> {
    let value = value.strip_prefix("./").unwrap_or(value);
    if value.is_empty()
        || value.starts_with('/')
        || value.contains("..")
        || value.contains(['\\', ':', '?', '#'])
        || value.chars().any(char::is_control)
    {
        return Err("Sciverse 图片资源路径无效".into());
    }
    Ok(value.to_string())
}

#[cfg(test)]
#[path = "note_images_tests.rs"]
mod tests;
