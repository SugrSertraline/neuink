use super::entry::mineru_source::{read_mineru_source, source_pdf};
use serde::Deserialize;
use std::{
    fs::File,
    io::{Cursor, Read},
    path::PathBuf,
};
use tauri::{AppHandle, Runtime};

const MAX_PREVIEW_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum ImportPreviewRequest {
    Mineru {
        root: PathBuf,
        snapshot_id: String,
        item_id: String,
    },
    Zotero {
        root: PathBuf,
        snapshot_id: String,
        paper_id: String,
        attachment_key: String,
    },
}

#[tauri::command]
pub async fn read_import_preview<R: Runtime>(
    app: AppHandle<R>,
    request: ImportPreviewRequest,
) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = match request {
            ImportPreviewRequest::Mineru {
                root,
                snapshot_id,
                item_id,
            } => {
                let path = super::mineru::preview_source_path(&app, &root, &snapshot_id, &item_id)?;
                let bytes = read_mineru_source(&path)?;
                read_archive_pdf(&bytes)?
            }
            ImportPreviewRequest::Zotero {
                root,
                snapshot_id,
                paper_id,
                attachment_key,
            } => {
                let path = super::zotero::preview_pdf_path(
                    &root,
                    &snapshot_id,
                    &paper_id,
                    &attachment_key,
                )?;
                let file = File::open(path).map_err(|_| "PDF 已移动或无法读取，请刷新列表。")?;
                read_bounded_pdf(file, None)?
            }
        };
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|_| "PDF 预览读取被中断，请重试。".to_string())?
}

fn read_archive_pdf(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let name = source_pdf(bytes)?.ok_or("此结果缺少原 PDF，无法预览。")?;
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "解析结果压缩包无法读取。")?;
    let file = archive
        .by_name(&name)
        .map_err(|_| "结果中的 PDF 已丢失。")?;
    let size = file.size();
    read_bounded_pdf(file, Some(size))
}

fn read_bounded_pdf(reader: impl Read, size: Option<u64>) -> Result<Vec<u8>, String> {
    if size.is_some_and(|size| size > MAX_PREVIEW_BYTES) {
        return Err("PDF 超过 64 MB，请导入后在阅读器中打开。".into());
    }
    let mut bytes = Vec::new();
    reader
        .take(MAX_PREVIEW_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "PDF 读取失败，请刷新后重试。")?;
    if bytes.len() as u64 > MAX_PREVIEW_BYTES {
        return Err("PDF 超过 64 MB，请导入后在阅读器中打开。".into());
    }
    if !bytes.starts_with(b"%PDF-") {
        return Err("文件不是有效的 PDF。".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn preview_requires_pdf_and_enforces_size() {
        assert!(read_bounded_pdf(Cursor::new(b"not pdf"), None).is_err());
        assert!(read_bounded_pdf(Cursor::new(b"%PDF-1.7"), Some(MAX_PREVIEW_BYTES + 1)).is_err());
        assert_eq!(
            read_bounded_pdf(Cursor::new(b"%PDF-1.7"), None).unwrap(),
            b"%PDF-1.7"
        );
    }

    #[test]
    fn archive_preview_uses_original_pdf_and_rejects_ambiguity() {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for name in ["result/other.pdf", "result/paper_origin.pdf"] {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(format!("%PDF-1.7 {name}").as_bytes())
                .unwrap();
        }
        let bytes = zip.finish().unwrap().into_inner();
        assert_eq!(
            read_archive_pdf(&bytes).unwrap(),
            b"%PDF-1.7 result/paper_origin.pdf"
        );
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for name in ["one.pdf", "two.pdf"] {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"%PDF-1.7").unwrap();
        }
        assert!(read_archive_pdf(&zip.finish().unwrap().into_inner()).is_err());
    }
}
