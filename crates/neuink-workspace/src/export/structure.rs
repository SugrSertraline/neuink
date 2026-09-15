use neuink_domain::{SegmentType, SourceSegment};
use pulldown_cmark::{Event, Parser, Tag};

pub(super) fn format_segment(segment: &SourceSegment, body: &str) -> String {
    match segment.segment_type {
        SegmentType::Heading => {
            let level = segment
                .mineru_metadata
                .get("level")
                .or_else(|| segment.mineru_metadata.get("text_level"))
                .and_then(|level| level.parse::<usize>().ok())
                .unwrap_or(2)
                .clamp(1, 6);
            // Apply semantic headings even when MinerU's markdown is null; preserve existing bilingual headings.
            if Parser::new(body).any(|event| matches!(event, Event::Start(Tag::Heading { .. }))) {
                body.to_string()
            } else {
                body.split("\n\n")
                    .map(|part| {
                        if part.trim().starts_with("**") {
                            part.to_string()
                        } else {
                            format!("{} {}", "#".repeat(level), part.trim())
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n")
            }
        }
        _ if segment.block_role.as_deref() == Some("caption") => {
            format!("<div class=\"export-caption\">\n\n{body}\n\n</div>")
        }
        _ => body.to_string(),
    }
}
