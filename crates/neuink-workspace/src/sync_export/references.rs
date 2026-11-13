use super::{invalid, Exporter};
use neuink_sync_protocol::document::{portable_resource_name, Resource};
use std::io;

pub(super) fn host_path(value: &str) -> bool {
    let value = value.trim();
    value.starts_with('/')
        || value.starts_with('\\')
        || value.to_ascii_lowercase().starts_with("file:")
        || (value.len() > 2
            && value.as_bytes()[0].is_ascii_alphabetic()
            && value.as_bytes()[1] == b':')
}

pub(super) fn validate_bbox(bbox: [f32; 4]) -> io::Result<()> {
    if bbox.iter().any(|n| !n.is_finite()) || bbox[2] < bbox[0] || bbox[3] < bbox[1] {
        return Err(invalid("片段或批注坐标无效"));
    }
    Ok(())
}

fn relative(reference: &str) -> io::Result<&str> {
    let reference = reference.strip_prefix("./").unwrap_or(reference);
    if !portable_resource_name(reference) || reference.contains('%') {
        let reason = if reference.is_empty() {
            "图片引用为空，无法核对对应附件"
        } else if reference.contains('%') {
            "图片引用含 URL 编码，需先规范化为托管资源路径"
        } else if host_path(reference) || reference.contains(':') {
            "图片引用是本机路径或暂不支持的资源地址"
        } else if reference.split('/').any(|part| part == "..") {
            "图片引用越过资源目录，未导出"
        } else {
            "图片引用包含跨平台不支持的文件名或路径字符"
        };
        return Err(invalid(reason));
    }
    Ok(reference)
}

impl Exporter {
    fn add_asset(
        &mut self,
        entry_id: &str,
        path: &str,
        resources: &mut Vec<Resource>,
    ) -> io::Result<()> {
        let extension = std::path::Path::new(path)
            .extension()
            .and_then(|part| part.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(
            extension.as_str(),
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "bmp" | "tif" | "tiff" | "svg"
        ) {
            return Err(invalid("图片引用指向非图片文件，未导出"));
        }
        let name = format!("entries/{entry_id}/{path}");
        if resources.iter().any(|resource| resource.name == name) {
            return Ok(());
        }
        let resource = self.files.resource(&name, &name)?;
        resources.push(resource);
        Ok(())
    }

    pub(super) fn parse_asset(
        &mut self,
        entry_id: &str,
        reference: Option<&str>,
        resources: &mut Vec<Resource>,
    ) -> io::Result<()> {
        if let Some(reference) = reference {
            self.add_asset(
                entry_id,
                &format!("mineru-output/{}", relative(reference)?),
                resources,
            )?;
        }
        Ok(())
    }

    pub(super) fn markdown_assets(
        &mut self,
        entry_id: &str,
        note_id: Option<&str>,
        markdown: &str,
        resources: &mut Vec<Resource>,
    ) -> io::Result<()> {
        // Reuse the exporter's Markdown + HTML parser, including reference-style
        // images, rather than looking for file names with a regular expression.
        for reference in crate::export::image_references(markdown) {
            if reference.starts_with("https://") || reference.starts_with("http://") {
                // No background network fetches. Users must see that an external
                // image is still external and is not included in the quota estimate.
                self.notice(
                    "external_image",
                    entry_id,
                    "含外部图片链接，未下载或计入附件，离线时可能不可见",
                );
                continue;
            }
            if reference.starts_with("data:image/") {
                continue;
            }
            let reference = relative(&reference)?;
            if let Some(note_id) = note_id {
                if !reference.starts_with(&format!("{note_id}.assets/")) {
                    return Err(invalid("笔记引用了非托管附件，未导出"));
                }
                self.add_asset(entry_id, &format!("notes/{reference}"), resources)?;
            } else {
                self.parse_asset(entry_id, Some(reference), resources)?;
            }
        }
        // Never serialize file:// links, UNC or absolute local destinations from
        // Markdown links. Ordinary prose is user content, not configuration.
        for event in pulldown_cmark::Parser::new_ext(markdown, pulldown_cmark::Options::all()) {
            if let pulldown_cmark::Event::Start(pulldown_cmark::Tag::Link { dest_url, .. }) = event
            {
                if host_path(&dest_url) {
                    return Err(invalid("正文链接含本机路径，请改为托管附件或公开网址"));
                }
            }
        }
        let selector =
            scraper::Selector::parse("a[href]").map_err(|_| invalid("链接解析器不可用"))?;
        if crate::export::html_fragment(markdown)
            .select(&selector)
            .any(|link| link.attr("href").is_some_and(host_path))
        {
            return Err(invalid("正文链接含本机路径，请改为托管附件或公开网址"));
        }
        Ok(())
    }
}
