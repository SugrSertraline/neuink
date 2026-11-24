//! PDF page rasterization inside the process, using PDFium (BSD-3).
//!
//! Why this exists: the visual channel needs page pixels, and previously the local Python
//! service produced them with PyMuPDF (AGPL). Rendering here removes that dependency and
//! the AGPL obligation, and lets the encoder be either the local service or a remote API —
//! both only ever receive images.
//!
//! Linking is **dynamic**: `pdfium.dll` ships in the app resources and is bound once at
//! startup. If it is missing, page sources are simply unavailable and the channel degrades
//! to MinerU assets, with a fixed reason instead of a crash.
//!
//! PDFium is not thread-safe: one instance is bound behind a mutex and every render runs
//! inside that mutex.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// Rendering DPI, matching what the service used before the move.
pub const RENDER_DPI: f32 = 110.0;

/// Fixed reason reported when PDFium could not be bound.
pub const REASON_PDFIUM_UNAVAILABLE: &str = "pdfium_unavailable";

struct BoundPdfium {
    pdfium: pdfium_render::prelude::Pdfium,
}

static PDFIUM: OnceLock<Mutex<Option<BoundPdfium>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<BoundPdfium>> {
    PDFIUM.get_or_init(|| Mutex::new(None))
}

/// Binds a PDFium dynamic library. Idempotent: a later call with the same path is a no-op.
pub fn bind(dll_path: &Path) -> Result<(), String> {
    let mut guard = slot().lock().map_err(|_| "PDFium 绑定锁被污染".to_string())?;
    if guard.is_some() {
        return Ok(());
    }
    // The helper expects a *directory*; accept a full DLL path as well so callers can pass
    // either the resource directory or the file itself.
    let directory = if dll_path.is_dir() {
        dll_path.to_path_buf()
    } else {
        dll_path.parent().map(|parent| parent.to_path_buf()).ok_or_else(|| {
            format!("PDFium 路径无效：{}", dll_path.display())
        })?
    };
    let library = pdfium_render::prelude::Pdfium::pdfium_platform_library_name_at_path(&directory);
    let pdfium = pdfium_render::prelude::Pdfium::new(
        pdfium_render::prelude::Pdfium::bind_to_library(library)
            .map_err(|error| format!("无法绑定 PDFium（{}）：{error}", dll_path.display()))?,
    );
    *guard = Some(BoundPdfium { pdfium });
    Ok(())
}

/// Binds from `NEUINK_PDFIUM_DLL` when set, so headless tools (the retrieval probe) can
/// rasterize without an app handle.
pub fn bind_from_env() -> bool {
    match std::env::var_os("NEUINK_PDFIUM_DLL") {
        Some(path) => bind(&PathBuf::from(path)).is_ok(),
        None => available(),
    }
}

/// Whether page rendering is available right now.
pub fn available() -> bool {
    slot().lock().map(|guard| guard.is_some()).unwrap_or(false)
}

/// Renders one page to PNG bytes at [`RENDER_DPI`].
pub fn render_page(pdf_path: &Path, page_index: u32) -> Result<Vec<u8>, String> {
    render_crops(pdf_path, page_index, None)?.into_iter().next().ok_or_else(|| "渲染结果为空".to_string())
}

/// Renders a page and, when `regions` is set, its geometric crops.
///
/// Crops reuse the measured layout: top half, bottom half, left half, right half.
pub fn render_crops(
    pdf_path: &Path,
    page_index: u32,
    regions: Option<usize>,
) -> Result<Vec<Vec<u8>>, String> {
    render_entry_pages(pdf_path, &[page_index], regions)?
        .remove(&page_index)
        .ok_or_else(|| "渲染结果为空".to_string())
}

/// Renders every requested page from one PDF open.
///
/// The map key is the page index. Each value is the full page, then the geometric crops
/// when `regions` is set. An empty page list does not touch PDFium.
pub fn render_entry_pages(
    pdf_path: &Path,
    pages: &[u32],
    regions: Option<usize>,
) -> Result<BTreeMap<u32, Vec<Vec<u8>>>, String> {
    if pages.is_empty() {
        return Ok(BTreeMap::new());
    }
    let guard = slot().lock().map_err(|_| "PDFium 绑定锁被污染".to_string())?;
    let bound = guard.as_ref().ok_or_else(|| REASON_PDFIUM_UNAVAILABLE.to_string())?;
    let document = bound
        .pdfium
        .load_pdf_from_file(pdf_path, None)
        .map_err(|error| format!("无法打开 PDF：{error}"))?;
    let mut ordered = pages.to_vec();
    ordered.sort_unstable();
    ordered.dedup();
    let mut rendered = BTreeMap::new();
    for page_index in ordered {
        let page = document
            .pages()
            .get(page_index as i32)
            .map_err(|error| format!("无法读取第 {page_index} 页：{error}"))?;
        let image = page
            .render_with_config(
                &pdfium_render::prelude::PdfRenderConfig::new()
                    .set_target_width((612.0 * RENDER_DPI / 72.0) as i32)
                    .rotate_if_landscape(
                        pdfium_render::prelude::PdfPageRenderRotation::None,
                        true,
                    ),
            )
            .map_err(|error| format!("渲染失败：{error}"))?
            .as_image()
            .map_err(|error| format!("位图转换失败：{error}"))?;
        let image = image.to_rgba8();
        let mut out = Vec::with_capacity(1 + regions.unwrap_or(0));
        out.push(encode_png(&image)?);
        if let Some(count) = regions {
            let width = image.width();
            let height = image.height();
            let boxes: [image::math::Rect; 4] = [
                image::math::Rect { x: 0, y: 0, width, height: height / 2 },
                image::math::Rect { x: 0, y: height / 2, width, height: height / 2 },
                image::math::Rect { x: 0, y: 0, width: width / 2, height },
                image::math::Rect { x: width / 2, y: 0, width: width / 2, height },
            ];
            for box_ in boxes.iter().take(count.min(boxes.len())) {
                let cropped =
                    image::imageops::crop_imm(&image, box_.x, box_.y, box_.width, box_.height);
                out.push(encode_png(&cropped.to_image())?);
            }
        }
        rendered.insert(page_index, out);
    }
    Ok(rendered)
}

fn encode_png(image: &image::RgbaImage) -> Result<Vec<u8>, String> {
    let mut buffer = Vec::new();
    image::DynamicImage::ImageRgba8(image.clone())
        .write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::Png)
        .map_err(|error| format!("PNG 编码失败：{error}"))?;
    Ok(buffer)
}

/// Resource directory the DLL is expected in, plus the platform library file name.
pub fn default_dll_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join(pdfium_render::prelude::Pdfium::pdfium_platform_library_name())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_page_list_does_not_open_the_pdf() {
        let rendered = render_entry_pages(Path::new("missing.pdf"), &[], None).expect("empty");
        assert!(rendered.is_empty());
    }
}



