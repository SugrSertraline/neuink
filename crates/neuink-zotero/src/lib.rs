//! Read-only local Zotero adapter. Never creates or updates a source database.
mod attachments;
mod database;
pub mod discovery;
mod reader;

use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf};

pub use reader::read_library;

#[derive(Debug, thiserror::Error)]
pub enum ZoteroError {
    #[error("请选择包含 zotero.sqlite 的 Zotero 数据目录，而不是程序安装目录。")]
    Directory,
    #[error("无法读取 Zotero 资料库。请检查文件权限，关闭 Zotero 后重试。")]
    Read,
    #[error("Zotero 资料库正在忙碌，请稍后重试；仍失败时请关闭 Zotero。")]
    Busy,
    #[error("此 Zotero 资料库结构暂不支持或文件损坏，未修改任何源数据。")]
    Schema,
    #[error("Zotero 资料库超过本次读取上限，请选择较小的资料库。")]
    Limit,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default)]
pub struct SourceSettings {
    pub data_directory: Option<PathBuf>,
    pub linked_attachment_directory: Option<PathBuf>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Library {
    pub source_id: String,
    pub data_directory: PathBuf,
    pub collections: Vec<Collection>,
    pub papers: Vec<Paper>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub path: String,
    pub parent_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Paper {
    pub id: String,
    pub key: String,
    pub library_id: i64,
    pub library_name: String,
    pub title: String,
    pub authors: String,
    pub year: String,
    pub fields: BTreeMap<String, String>,
    pub tags: Vec<String>,
    pub collection_ids: Vec<String>,
    pub attachments: Vec<Attachment>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Attachment {
    pub key: String,
    pub file_name: String,
    pub available: bool,
    pub reason: Option<String>,
    // Only the native adapter can resolve paths; IPC import accepts keys, not paths.
    #[serde(skip)]
    pub path: Option<PathBuf>,
    #[serde(skip)]
    pub file_size: u64,
    #[serde(skip)]
    pub modified: Option<std::time::SystemTime>,
}

#[cfg(test)]
mod tests;
