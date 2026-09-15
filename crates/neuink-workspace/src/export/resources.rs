use image::{ImageFormat, ImageReader};
use pulldown_cmark::{html, Event, Options, Parser, Tag, TagEnd};
use scraper::{Html, Selector};
use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
};

use super::model::ExportAsset;

const MAX_ASSET_BYTES: u64 = 24 * 1024 * 1024;
const MAX_EXPORT_ASSET_BYTES: usize = 192 * 1024 * 1024;

pub(super) fn html_fragment(markdown: &str) -> Html {
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_MATH
        | Options::ENABLE_FOOTNOTES;
    let mut rendered = String::new();
    html::push_html(&mut rendered, Parser::new_ext(markdown, options));
    Html::parse_fragment(&rendered)
}

pub(super) fn image_references(markdown: &str) -> Vec<String> {
    let Ok(selector) = Selector::parse("img[src]") else {
        return Vec::new();
    };
    html_fragment(markdown)
        .select(&selector)
        .filter_map(|image| image.attr("src").map(str::to_owned))
        .collect()
}

// Rewrite only image destinations, never matching words in the paper's prose or code.
pub(super) fn rewrite_images(markdown: &str, destinations: &BTreeMap<String, String>) -> String {
    let mut edits = Vec::new();
    let mut events = Parser::new_ext(markdown, Options::all()).into_offset_iter();
    while let Some((event, range)) = events.next() {
        match event {
            Event::Start(Tag::Image { dest_url, .. }) => {
                let mut alt = String::new();
                let mut end = range.end;
                for (inner, inner_range) in events.by_ref() {
                    end = end.max(inner_range.end);
                    match inner {
                        Event::Text(text) | Event::Code(text) => alt.push_str(&text),
                        Event::End(TagEnd::Image) => break,
                        _ => {}
                    }
                }
                if let Some(destination) = destinations.get(dest_url.as_ref()) {
                    let alt = alt
                        .replace('\\', "\\\\")
                        .replace('[', "\\[")
                        .replace(']', "\\]");
                    edits.push((range.start..end, format!("![{alt}]({destination})")));
                }
            }
            Event::Html(raw) | Event::InlineHtml(raw) => {
                let mut fragment = Html::parse_fragment(&raw);
                let Ok(selector) = Selector::parse("img[src]") else {
                    continue;
                };
                let updates: Vec<_> = fragment
                    .select(&selector)
                    .filter_map(|image| {
                        destinations
                            .get(image.attr("src")?)
                            .map(|target| (image.id(), target.clone()))
                    })
                    .collect();
                if updates.is_empty() {
                    continue;
                }
                for (id, target) in updates {
                    if let Some(mut node) = fragment.tree.get_mut(id) {
                        if let scraper::Node::Element(element) = node.value() {
                            for (name, value) in &mut element.attrs {
                                if name.local.as_ref() == "src" {
                                    *value = target.as_str().into();
                                }
                            }
                        }
                    }
                }
                edits.push((range, fragment.root_element().inner_html()));
            }
            _ => {}
        }
    }
    let mut result = markdown.to_string();
    for (range, replacement) in edits.into_iter().rev() {
        result.replace_range(range, &replacement);
    }
    result
}

pub(super) fn safe_asset_path(root: &Path, reference: &str) -> Result<PathBuf, String> {
    if reference.contains([':', '\\', '\0', '?', '#']) || reference.starts_with('/') {
        return Err("图片引用不是安全的本地相对路径".into());
    }
    let relative = Path::new(reference);
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
    {
        return Err("图片路径越过解析资源目录".into());
    }
    let base = root.canonicalize().map_err(|_| "解析资源目录不存在")?;
    let candidate = base
        .join(relative)
        .canonicalize()
        .map_err(|_| "引用的图片文件不存在")?;
    if !candidate.starts_with(&base) || !candidate.is_file() {
        return Err("图片不在解析资源目录内".into());
    }
    Ok(candidate)
}

pub(super) fn load_asset(root: &Path, reference: &str) -> Result<ExportAsset, String> {
    let path = safe_asset_path(root, reference)?;
    let file = fs::File::open(path).map_err(|_| "无法读取图片")?;
    let mut bytes = Vec::new();
    file.take(MAX_ASSET_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取图片")?;
    if bytes.len() as u64 > MAX_ASSET_BYTES {
        return Err("单张图片超过 24 MB 导出限制".into());
    }
    decode_asset(&bytes)
}

pub(super) fn decode_asset(bytes: &[u8]) -> Result<ExportAsset, String> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "无法识别图片格式")?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(12000);
    limits.max_image_height = Some(12000);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|_| "图片损坏、格式暂不支持或尺寸过大")?;
    let (width, height) = (decoded.width(), decoded.height());
    let mut png = Cursor::new(Vec::new());
    decoded
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|_| "图片转换失败")?;
    let png = png.into_inner();
    if png.len() as u64 > MAX_ASSET_BYTES {
        return Err("图片转换后超过 24 MB 导出限制".into());
    }
    let name = format!("assets/{}.png", &blake3::hash(&png).to_hex()[..24]);
    Ok(ExportAsset {
        name,
        png,
        width,
        height,
    })
}

pub(super) fn insert_asset(
    assets: &mut BTreeMap<String, ExportAsset>,
    reference: &str,
    asset: ExportAsset,
) -> Result<(), String> {
    if assets.values().map(|asset| asset.png.len()).sum::<usize>() + asset.png.len()
        > MAX_EXPORT_ASSET_BYTES
    {
        return Err("图片总量超过 192 MB，请拆分资料后重试".into());
    }
    assets.insert(reference.to_string(), asset);
    Ok(())
}

pub(super) fn validate_target(
    root: &Path,
    target: &Path,
    extension: &str,
) -> Result<PathBuf, String> {
    if !target.is_absolute() || target.extension().and_then(|part| part.to_str()) != Some(extension)
    {
        return Err(format!("请选择扩展名为 .{extension} 的绝对文件路径"));
    }
    let parent = target
        .parent()
        .ok_or("导出位置无效")?
        .canonicalize()
        .map_err(|_| "导出文件夹不存在")?;
    let name = target.file_name().ok_or("导出文件名无效")?;
    if name.to_string_lossy().contains(':') {
        return Err("导出文件名无效".into());
    }
    let resolved = parent.join(name);
    let root = root.canonicalize().map_err(|_| "资料库不可用")?;
    if parent.starts_with(root)
        || parent
            .ancestors()
            .any(|path| path.join("neuink.workspace.json").is_file())
    {
        return Err("请导出到资料库之外，避免覆盖原始资料".into());
    }
    if let Ok(meta) = fs::symlink_metadata(&resolved) {
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err("导出目标不是普通文件，请选择新文件名".into());
        }
        if resolved
            .with_file_name(format!("{}.bak", name.to_string_lossy()))
            .exists()
        {
            return Err("目标已有同名备份文件，请选择新文件名，避免覆盖备份".into());
        }
    }
    Ok(resolved)
}
