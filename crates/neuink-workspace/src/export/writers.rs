use super::{model::PreparedExport, resources::html_fragment, PaperExportFormat};
use super::{
    word_text::{plain_text, rich_paragraph, text_paragraph},
    ExportImageWidth,
};
use docx_rs::{
    AlignmentType, BorderType, Docx, LineSpacing, PageMargin, Paragraph, Pic, Run, RunFonts, Style,
    StyleType, Table, TableBorder, TableBorderPosition, TableBorders, TableCell, TableCellMargins,
    TableLayoutType, TableRow, VAlignType, WidthType,
};
use scraper::{ElementRef, Selector};
use std::{
    collections::BTreeSet,
    io::{Cursor, Write},
};
use zip::{write::SimpleFileOptions, ZipWriter};

pub(super) fn write(
    prepared: &PreparedExport,
    format: PaperExportFormat,
) -> Result<Vec<u8>, String> {
    match format {
        PaperExportFormat::Docx => write_docx(prepared),
        PaperExportFormat::Txt => Ok(format!(
            "{}\n",
            plain_text(html_fragment(&prepared.markdown).root_element()).trim()
        )
        .into_bytes()),
        PaperExportFormat::MarkdownZip => write_zip(prepared),
    }
}

fn write_zip(prepared: &PreparedExport) -> Result<Vec<u8>, String> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut add = |name: &str, bytes: &[u8]| -> Result<(), String> {
        zip.start_file(name, options)
            .map_err(|error| error.to_string())?;
        zip.write_all(bytes).map_err(|error| error.to_string())
    };
    add("paper.md", prepared.markdown.as_bytes())?;
    let mut coverage = serde_json::to_value(&prepared.report).map_err(|error| error.to_string())?;
    if let Some(diagrams) = coverage["diagrams"].as_array_mut() {
        for diagram in diagrams {
            if let Some(diagram) = diagram.as_object_mut() {
                diagram.remove("code");
            }
        }
    }
    add(
        "coverage.json",
        &serde_json::to_vec_pretty(&coverage).map_err(|error| error.to_string())?,
    )?;
    add("README.txt", "NeuInk 整理的解析资料包，不是原始 MinerU ZIP。\n入口：paper.md；图片：assets；内容检查：coverage.json。\n不包含原始 PDF、私人笔记、会话或账号设置。\n".as_bytes())?;
    let mut written = BTreeSet::new();
    for asset in prepared.assets.values() {
        if written.insert(&asset.name) {
            add(&asset.name, &asset.png)?;
        }
    }
    for (name, code) in &prepared.diagram_sources {
        add(name, code.as_bytes())?;
    }
    Ok(zip
        .finish()
        .map_err(|error| error.to_string())?
        .into_inner())
}

fn write_docx(prepared: &PreparedExport) -> Result<Vec<u8>, String> {
    let mut doc = Docx::new()
        .page_size(11906, 16838)
        .page_margin(
            PageMargin::new()
                .top(1134)
                .bottom(1134)
                .left(1134)
                .right(1134),
        )
        .default_fonts(
            RunFonts::new()
                .ascii("Calibri")
                .hi_ansi("Calibri")
                .east_asia("Microsoft YaHei"),
        )
        .default_size(22);
    for (name, size) in [
        ("Title", 36),
        ("Heading1", 30),
        ("Heading2", 26),
        ("Heading3", 24),
        ("Heading4", 23),
        ("Heading5", 22),
        ("Heading6", 22),
    ] {
        doc = doc.add_style(
            Style::new(name, StyleType::Paragraph)
                .name(name)
                .size(size)
                .bold()
                .color("000000"),
        );
    }
    doc = doc.add_style(
        Style::new("Caption", StyleType::Paragraph)
            .name("Caption")
            .size(20)
            .color("595959"),
    );
    doc = doc.add_style(
        Style::new("SourceCode", StyleType::Paragraph)
            .name("Source Code")
            .size(20)
            .fonts(
                RunFonts::new()
                    .ascii("Consolas")
                    .hi_ansi("Consolas")
                    .east_asia("Microsoft YaHei"),
            ),
    );
    let html = html_fragment(&prepared.markdown);
    let mut writer = DocumentWriter { doc, prepared };
    writer.elements(html.root_element(), 0);
    let mut buffer = Cursor::new(Vec::new());
    writer
        .doc
        .build()
        .pack(&mut buffer)
        .map_err(|error| error.to_string())?;
    Ok(buffer.into_inner())
}

struct DocumentWriter<'a> {
    doc: Docx,
    prepared: &'a PreparedExport,
}

impl DocumentWriter<'_> {
    fn paragraph(&mut self, paragraph: Paragraph) {
        self.doc = std::mem::take(&mut self.doc).add_paragraph(paragraph);
    }

    fn elements(&mut self, parent: ElementRef<'_>, depth: usize) {
        if depth > 64 {
            self.paragraph(text_paragraph(&plain_text(parent)));
            return;
        }
        for child in parent.children() {
            if let Some(text) = child.value().as_text() {
                if !text.trim().is_empty() {
                    self.paragraph(text_paragraph(text));
                }
                continue;
            }
            let Some(element) = ElementRef::wrap(child) else {
                continue;
            };
            let name = element.value().name();
            match name {
                "script" | "style" => {}
                "table" => self.table(element),
                "img" => self.image(element),
                "ul" | "ol" => {
                    let mut index = element
                        .attr("start")
                        .and_then(|value| value.parse::<usize>().ok())
                        .unwrap_or(1);
                    for item in element.child_elements() {
                        if item.value().name() != "li" {
                            continue;
                        }
                        let prefix = if name == "ol" {
                            format!("{index}. ")
                        } else {
                            "• ".into()
                        };
                        self.paragraph(text_paragraph(&format!(
                            "{prefix}{}",
                            plain_text(item).trim()
                        )));
                        self.images(item);
                        index += 1;
                    }
                }
                "pre" => {
                    // One code line per paragraph permits page breaks in long Mermaid sources.
                    for line in plain_text(element).trim_end().lines() {
                        self.paragraph(
                            text_paragraph(line)
                                .style("SourceCode")
                                .line_spacing(LineSpacing::new().line(240).after(0)),
                        );
                    }
                    self.paragraph(Paragraph::new().line_spacing(LineSpacing::new().after(80)));
                }
                "p" | "blockquote" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                    let text = plain_text(element);
                    if element.text().any(|text| !text.trim().is_empty()) {
                        let mut paragraph = rich_paragraph(element);
                        paragraph = match name {
                            "h1" if text.trim() == self.prepared.title => {
                                paragraph.style("Title").keep_next(true)
                            }
                            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                                let level = name.as_bytes()[1] - b'1';
                                paragraph
                                    .style(&format!("Heading{}", level + 1))
                                    .outline_lvl(usize::from(level))
                                    .keep_next(true)
                                    .keep_lines(true)
                                    .line_spacing(LineSpacing::new().before(220).after(120))
                            }
                            "blockquote" => Paragraph::new()
                                .add_run(Run::new().add_text(text.trim()).size(18).color("595959")),
                            _ => paragraph,
                        };
                        if element
                            .ancestors()
                            .filter_map(ElementRef::wrap)
                            .any(|parent| parent.attr("class") == Some("export-caption"))
                        {
                            paragraph = paragraph
                                .style("Caption")
                                .align(AlignmentType::Center)
                                .keep_lines(true);
                        }
                        self.paragraph(paragraph);
                    }
                    self.images(element);
                }
                _ => self.elements(element, depth + 1),
            }
        }
    }

    fn images(&mut self, element: ElementRef<'_>) {
        if let Ok(selector) = Selector::parse("img") {
            for image in element.select(&selector) {
                self.image(image);
            }
        }
    }

    fn image(&mut self, image: ElementRef<'_>) {
        let Some(asset) = image.attr("src").and_then(|src| {
            self.prepared
                .assets
                .values()
                .find(|asset| asset.name == src)
        }) else {
            self.paragraph(text_paragraph("[图片资源不可用，请参见内容检查清单]"));
            return;
        };
        let fraction = match self.prepared.options.image_width {
            ExportImageWidth::Compact => 0.6,
            ExportImageWidth::Standard => 0.85,
            ExportImageWidth::Full => 1.0,
        };
        let scale = ((9638.0 / 15.0) * fraction / f64::from(asset.width))
            .min(760.0 / f64::from(asset.height))
            .min(1.0);
        let pic = Pic::new_with_dimensions(asset.png.clone(), asset.width, asset.height).size(
            (f64::from(asset.width) * scale * 9525.0) as u32,
            (f64::from(asset.height) * scale * 9525.0) as u32,
        );
        self.paragraph(
            Paragraph::new()
                .align(AlignmentType::Center)
                .keep_next(true)
                .line_spacing(LineSpacing::new().before(120).after(80))
                .add_run(Run::new().add_image(pic)),
        );
    }

    fn table(&mut self, element: ElementRef<'_>) {
        let Ok(row_selector) = Selector::parse("tr") else {
            return;
        };
        let Ok(complex_selector) = Selector::parse("[rowspan], table table") else {
            return;
        };
        let source_rows: Vec<_> = element
            .select(&row_selector)
            .map(|row| {
                row.child_elements()
                    .filter(|cell| matches!(cell.value().name(), "th" | "td"))
                    .collect::<Vec<_>>()
            })
            .collect();
        let columns = source_rows
            .iter()
            .map(|row| row.iter().map(|cell| colspan(*cell)).sum::<usize>())
            .max()
            .unwrap_or(0);
        if columns == 0 {
            self.paragraph(text_paragraph(&plain_text(element)));
            return;
        }
        if columns > 10 || element.select(&complex_selector).next().is_some() {
            self.paragraph(text_paragraph(
                "复杂表格按行保留文字，合并单元格版式请核对原文。",
            ));
            for row in source_rows {
                self.paragraph(text_paragraph(
                    &row.iter()
                        .map(|cell| plain_text(*cell))
                        .collect::<Vec<_>>()
                        .join(" | "),
                ));
            }
            self.images(element);
            return;
        }
        let column_width = 9638 / columns;
        let mut rows = Vec::new();
        for source_row in source_rows {
            let header = source_row.iter().any(|cell| cell.value().name() == "th");
            let mut cells = Vec::new();
            let mut occupied = 0;
            for cell in source_row {
                let span = colspan(cell);
                occupied += span;
                let mut rendered = TableCell::new()
                    .width(column_width * span, WidthType::Dxa)
                    .vertical_align(VAlignType::Center)
                    .grid_span(span)
                    .add_paragraph(
                        rich_paragraph(cell).line_spacing(LineSpacing::new().line(270).after(40)),
                    );
                if header {
                    rendered = rendered.shading(docx_rs::Shading::new().fill("EDEDED"));
                }
                cells.push(rendered);
            }
            for _ in occupied..columns {
                cells.push(TableCell::new().add_paragraph(Paragraph::new()));
            }
            let row = TableRow::new(cells);
            rows.push(row);
        }
        let mut borders = TableBorders::new();
        for position in [
            TableBorderPosition::Top,
            TableBorderPosition::Bottom,
            TableBorderPosition::Left,
            TableBorderPosition::Right,
            TableBorderPosition::InsideH,
            TableBorderPosition::InsideV,
        ] {
            borders = borders.set(
                TableBorder::new(position)
                    .border_type(BorderType::Single)
                    .size(4)
                    .color("D9D9D9"),
            );
        }
        let table = Table::new(rows)
            .set_grid(vec![column_width; columns])
            .width(9638, WidthType::Dxa)
            .layout(TableLayoutType::Fixed)
            .set_borders(borders)
            .margins(TableCellMargins::new().margin(100, 120, 100, 120));
        self.doc = std::mem::take(&mut self.doc).add_table(table);
        self.paragraph(Paragraph::new());
        self.images(element);
    }
}

fn colspan(cell: ElementRef<'_>) -> usize {
    cell.attr("colspan")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1)
        .clamp(1, 100)
}
