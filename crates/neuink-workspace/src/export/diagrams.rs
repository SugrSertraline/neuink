use super::{model::*, resources};
use base64::Engine;
use neuink_domain::{SegmentType, SourceSegment};
use pulldown_cmark::{CodeBlockKind, Event, Parser, Tag, TagEnd};
use std::{collections::BTreeSet, ops::Range};

pub(super) struct DiagramBlock {
    pub range: Range<usize>,
    pub diagram: ExportDiagram,
}

pub(super) fn extract(source: &str, segment: &SourceSegment) -> Vec<DiagramBlock> {
    let mut blocks = Vec::new();
    let mut events = Parser::new(source).into_offset_iter();
    while let Some((event, range)) = events.next() {
        let Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(language))) = event else {
            continue;
        };
        if !language.trim().eq_ignore_ascii_case("mermaid") {
            continue;
        }
        let mut code = String::new();
        let mut end = range.end;
        for (event, range) in events.by_ref() {
            end = end.max(range.end);
            match event {
                Event::Text(text) => code.push_str(&text),
                Event::End(TagEnd::CodeBlock) => break,
                _ => {}
            }
        }
        let hash = blake3::hash(format!("{}:{}:{code}", segment.uid, blocks.len()).as_bytes());
        blocks.push(DiagramBlock {
            range: range.start..end,
            diagram: ExportDiagram {
                id: hash.to_hex()[..24].into(),
                segment_uid: segment.uid.to_string(),
                page: segment.page_idx.saturating_add(1),
                code,
            },
        });
    }
    blocks
}

pub(super) fn source_body(segment: &SourceSegment) -> String {
    let source = super::source_text(segment);
    let mut body = source.to_string();
    if segment.segment_type == SegmentType::Figure
        && !segment.text.trim().is_empty()
        && !source.contains(segment.text.trim())
    {
        body.push_str(&format!("\n\n{}", segment.text));
    }
    // MinerU already fences code and Mermaid. A second fence turns diagrams into literal Markdown.
    if segment.segment_type == SegmentType::Code
        && !Parser::new(&body).any(|event| matches!(event, Event::Start(Tag::CodeBlock(_))))
    {
        let longest = body.split(|ch| ch != '`').map(str::len).max().unwrap_or(0);
        let fence = "`".repeat(longest.max(2) + 1);
        body = format!("{fence}\n{body}\n{fence}");
    }
    body
}

pub(super) fn apply_mode(
    source: &str,
    blocks: &[DiagramBlock],
    mode: DiagramExportMode,
    original_available: bool,
) -> String {
    let mut result = source.to_string();
    for block in blocks.iter().rev() {
        let replacement = match mode {
            DiagramExportMode::Original | DiagramExportMode::OriginalWithSource
                if original_available =>
            {
                String::new()
            }
            DiagramExportMode::Rendered => format!(
                "\n\n![Mermaid 重绘图](diagrams/{}.png)\n\n",
                block.diagram.id
            ),
            _ => continue, // Never silently remove a diagram whose original image is unavailable.
        };
        result.replace_range(block.range.clone(), &replacement);
    }
    result
}

// MinerU may put an image in markdown and Mermaid in text on the same figure.
// Only suppress that figure's original image when the user explicitly chose its alternate representation.
pub(super) fn without_images(source: &str) -> String {
    let mut ranges = Vec::new();
    let mut events = Parser::new(source).into_offset_iter();
    while let Some((event, range)) = events.next() {
        if matches!(event, Event::Start(Tag::Image { .. })) {
            let mut end = range.end;
            for (event, range) in events.by_ref() {
                end = end.max(range.end);
                if matches!(event, Event::End(TagEnd::Image)) {
                    break;
                }
            }
            ranges.push((range.start..end, String::new()));
        } else if let Event::Html(html) | Event::InlineHtml(html) = event {
            let mut fragment = scraper::Html::parse_fragment(&html);
            if let Ok(selector) = scraper::Selector::parse("img") {
                let ids: Vec<_> = fragment.select(&selector).map(|image| image.id()).collect();
                if !ids.is_empty() {
                    for id in ids {
                        if let Some(mut image) = fragment.tree.get_mut(id) {
                            image.detach();
                        }
                    }
                    ranges.push((range, fragment.root_element().inner_html()));
                }
            }
        }
    }
    let mut result = source.to_string();
    for (range, replacement) in ranges.into_iter().rev() {
        result.replace_range(range, &replacement);
    }
    result
}

pub(super) fn attach_rendered(
    prepared: &mut PreparedExport,
    rendered: &[RenderedExportDiagram],
    format: PaperExportFormat,
) -> Result<(), String> {
    let required = prepared.options.diagrams == DiagramExportMode::Rendered
        && format != PaperExportFormat::Txt;
    if !required {
        return if rendered.is_empty() {
            Ok(())
        } else {
            Err("当前格式不接受额外渲染图".into())
        };
    }
    if rendered.len() != prepared.report.diagrams.len() || rendered.len() > 200 {
        return Err("Mermaid 渲染图不完整，请重新导出或选择原图 / Mermaid 源码".into());
    }
    let mut seen = BTreeSet::new();
    let mut total = 0;
    for item in rendered {
        if !seen.insert(&item.id)
            || !prepared
                .report
                .diagrams
                .iter()
                .any(|diagram| diagram.id == item.id)
        {
            return Err("渲染图与当前解析片段不匹配".into());
        }
        total += item.png_base64.len();
        if item.png_base64.len() > 16 * 1024 * 1024 || total > 96 * 1024 * 1024 {
            return Err("Mermaid 渲染图过大，请选择原图或源码".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&item.png_base64)
            .map_err(|_| "渲染图编码无效")?;
        if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err("Mermaid 渲染结果必须是 PNG 图片".into());
        }
        let mut asset = resources::decode_asset(&bytes)?;
        asset.name = format!("diagrams/{}.png", item.id);
        resources::insert_asset(&mut prepared.assets, &asset.name.clone(), asset)?;
    }
    Ok(())
}
