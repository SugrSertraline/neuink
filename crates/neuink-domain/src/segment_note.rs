use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{DomainError, SegmentUid};

pub const MAX_SEGMENT_NOTE_CHARACTERS: usize = 500;

pub fn validate_segment_note_text(text: &str) -> Result<(), DomainError> {
    let actual = visible_segment_note_text(text).chars().count();
    if actual > MAX_SEGMENT_NOTE_CHARACTERS {
        return Err(DomainError::SegmentNoteTooLong {
            actual,
            max: MAX_SEGMENT_NOTE_CHARACTERS,
        });
    }

    Ok(())
}

pub fn visible_segment_note_text(markdown: &str) -> String {
    markdown
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(|line| {
            let line = strip_block_markdown(line);
            let line = strip_html_tags(line);
            let line = strip_markdown_links(&line);
            ["**", "__", "~~", "==", "`", "*", "_"]
                .into_iter()
                .fold(line, |value, marker| value.replace(marker, ""))
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&apos;", "'")
                .replace("&#39;", "'")
        })
        .collect()
}

fn strip_block_markdown(line: &str) -> &str {
    let trimmed = line.trim_start();
    if let Some(rest) = trimmed.strip_prefix("> ") {
        return rest;
    }

    let heading_end = trimmed
        .char_indices()
        .take_while(|(_, character)| *character == '#')
        .last()
        .map(|(index, character)| index + character.len_utf8());
    if let Some(end) = heading_end {
        if trimmed[end..].starts_with(' ') {
            return trimmed[end..].trim_start();
        }
    }

    for marker in ["- ", "* ", "+ "] {
        if let Some(rest) = trimmed.strip_prefix(marker) {
            return rest;
        }
    }

    let digits_end = trimmed
        .char_indices()
        .take_while(|(_, character)| character.is_ascii_digit())
        .last()
        .map(|(index, character)| index + character.len_utf8());
    if let Some(end) = digits_end {
        let rest = &trimmed[end..];
        if let Some(rest) = rest.strip_prefix(". ") {
            return rest;
        }
        if let Some(rest) = rest.strip_prefix(") ") {
            return rest;
        }
    }

    trimmed
}

fn strip_html_tags(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut in_tag = false;
    for character in text.chars() {
        match character {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => result.push(character),
            _ => {}
        }
    }
    result
}

fn strip_markdown_links(text: &str) -> String {
    let characters: Vec<char> = text.chars().collect();
    let mut result = String::with_capacity(text.len());
    let mut index = 0;
    while index < characters.len() {
        if characters[index] == '[' {
            if let Some(label_end) = characters[index + 1..]
                .iter()
                .position(|character| *character == ']')
            {
                let label_end = index + 1 + label_end;
                if characters.get(label_end + 1) == Some(&'(') {
                    if let Some(url_end) = characters[label_end + 2..]
                        .iter()
                        .position(|character| *character == ')')
                    {
                        result.extend(characters[index + 1..label_end].iter().copied());
                        index = label_end + 2 + url_end + 1;
                        continue;
                    }
                }
            }
        }
        result.push(characters[index]);
        index += 1;
    }
    result
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SegmentBlockNote {
    pub segment_uid: SegmentUid,
    pub text: String,
    #[serde(default)]
    pub bookmarked: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl SegmentBlockNote {
    pub fn new(segment_uid: SegmentUid, text: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            segment_uid,
            text: text.into(),
            bookmarked: false,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn update_text(&mut self, text: impl Into<String>) {
        self.text = text.into();
        self.updated_at = Utc::now();
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_segment_note_text, visible_segment_note_text};

    #[test]
    fn visible_text_ignores_formatting_and_line_breaks() {
        let markdown =
            "<span style=\"color: #da1e28\">红色</span>\n\n**加粗** [链接](https://example.com)";

        assert_eq!(visible_segment_note_text(markdown), "红色加粗 链接");
    }

    #[test]
    fn validation_uses_visible_text_length() {
        let markdown = format!("<span style=\"color: #da1e28\">{}</span>", "x".repeat(500));

        assert!(validate_segment_note_text(&markdown).is_ok());
    }
}
