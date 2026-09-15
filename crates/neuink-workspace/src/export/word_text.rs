use docx_rs::{BreakType, LineSpacing, Paragraph, Run, RunFonts};
use scraper::ElementRef;

pub(super) fn text_paragraph(text: &str) -> Paragraph {
    let mut run = Run::new();
    for (index, line) in text.lines().enumerate() {
        if index > 0 {
            run = run.add_break(BreakType::TextWrapping);
        }
        run = run.add_text(line);
    }
    base_paragraph().add_run(run)
}

pub(super) fn base_paragraph() -> Paragraph {
    Paragraph::new().line_spacing(LineSpacing::new().line(300).after(120))
}

// Keep emphasis and inline code instead of flattening every block to a single unformatted run.
pub(super) fn rich_paragraph(element: ElementRef<'_>) -> Paragraph {
    inline(element, base_paragraph(), Run::new(), 0)
}

fn inline(
    element: ElementRef<'_>,
    mut paragraph: Paragraph,
    style: Run,
    depth: usize,
) -> Paragraph {
    if depth > 64 {
        return paragraph.add_run(style.add_text(plain_text(element)));
    }
    for child in element.children() {
        if let Some(text) = child.value().as_text() {
            paragraph = paragraph.add_run(style.clone().add_text(text.to_string()));
        } else if let Some(child) = ElementRef::wrap(child) {
            let styled = match child.value().name() {
                "script" | "style" | "img" => continue,
                "br" => {
                    paragraph = paragraph.add_run(Run::new().add_break(BreakType::TextWrapping));
                    continue;
                }
                "strong" | "b" => style.clone().bold(),
                "em" | "i" => style.clone().italic(),
                "del" | "s" => style.clone().strike(),
                "code" => style
                    .clone()
                    .fonts(RunFonts::new().ascii("Consolas").hi_ansi("Consolas"))
                    .size(20),
                _ => style.clone(),
            };
            paragraph = inline(child, paragraph, styled, depth + 1);
            if child.value().name() == "a" {
                if let Some(href) = child
                    .attr("href")
                    .filter(|href| href.starts_with("https://") || href.starts_with("http://"))
                {
                    if plain_text(child).trim() != href {
                        paragraph = paragraph.add_run(style.clone().add_text(format!(" ({href})")));
                    }
                }
            }
        }
    }
    paragraph
}

pub(super) fn plain_text(element: ElementRef<'_>) -> String {
    let mut text = String::new();
    for node in element.descendants().skip(1) {
        if let Some(value) = node.value().as_text() {
            text.push_str(value);
        } else if let Some(child) = ElementRef::wrap(node) {
            match child.value().name() {
                "br" | "p" | "li" | "tr" | "h1" | "h2" | "h3" | "h4" | "pre" | "blockquote" => {
                    text.push('\n')
                }
                "td" | "th" => text.push('\t'),
                "img" => text.push_str(&format!(
                    "[{}]",
                    child
                        .attr("alt")
                        .filter(|value| !value.is_empty())
                        .unwrap_or("图片")
                )),
                "a" => {
                    if let Some(href) = child
                        .attr("href")
                        .filter(|href| href.starts_with("https://") || href.starts_with("http://"))
                    {
                        text.push_str(&format!("({href}) "));
                    }
                }
                _ => {}
            }
        }
    }
    text
}
