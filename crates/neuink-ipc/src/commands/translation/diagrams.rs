use std::{collections::HashMap, ops::Range};

use serde::Deserialize;
use serde_json::{json, Value};

use super::{protect_formula_spans, restore_formula_spans, ProtectedFormulaText};

pub(super) struct DiagramText {
    pub text: String,
    blocks: Vec<String>,
    labels: Vec<Label>,
}

struct Label {
    block: usize,
    range: Range<usize>,
    source: ProtectedFormulaText,
}

#[derive(Debug, Deserialize)]
pub(super) struct TranslatedLabel {
    label_id: usize,
    translated_text: String,
}

impl DiagramText {
    pub fn prepare(source: &str) -> Self {
        let mut result = Self {
            text: source.to_string(),
            blocks: Vec::new(),
            labels: Vec::new(),
        };
        let ranges = mermaid_blocks(source);
        for range in &ranges {
            let block = &source[range.clone()];
            let block_id = result.blocks.len();
            for range in label_ranges(block) {
                result.labels.push(Label {
                    block: block_id,
                    source: protect_formula_spans(&block[range.clone()], false),
                    range,
                });
            }
            result.blocks.push(block.to_string());
        }
        for (index, range) in ranges.into_iter().enumerate().rev() {
            result
                .text
                .replace_range(range, &format!("⟪NEUINK_DIAGRAM_{index}⟫"));
        }
        result
    }

    pub fn input_labels(&self) -> Vec<Value> {
        self.labels
            .iter()
            .enumerate()
            .map(|(id, label)| json!({"label_id": id, "source_text": label.source.text}))
            .collect()
    }

    pub fn contains_mermaid(&self) -> bool {
        !self.blocks.is_empty()
    }

    pub fn restore(&self, text: &str, translations: &[TranslatedLabel]) -> Result<String, String> {
        let mut by_id = HashMap::new();
        for label in translations {
            if label.label_id >= self.labels.len()
                || by_id
                    .insert(label.label_id, &label.translated_text)
                    .is_some()
            {
                return Err("Mermaid 译文包含未知或重复的文字编号，请重试该片段。".into());
            }
        }
        let mut blocks = self.blocks.clone();
        for (id, label) in self.labels.iter().enumerate().rev() {
            let translated = by_id
                .get(&id)
                .filter(|value| !value.trim().is_empty())
                .ok_or("Mermaid 译文遗漏了图中文字，请重试该片段。")?;
            let translated =
                restore_formula_spans(&escape_label(translated), &label.source.formulas)?;
            blocks[label.block].replace_range(label.range.clone(), &translated);
        }
        let mut restored = text.to_string();
        for (index, block) in blocks.iter().enumerate() {
            let token = format!("⟪NEUINK_DIAGRAM_{index}⟫");
            if restored.matches(&token).count() != 1 {
                return Err("Mermaid 图结构占位符被修改，请重试该片段。".into());
            }
            restored = restored.replacen(&token, block, 1);
        }
        Ok(restored)
    }
}

fn mermaid_blocks(source: &str) -> Vec<Range<usize>> {
    let mut ranges = Vec::new();
    let mut offset = 0;
    let mut opening: Option<(usize, String)> = None;
    for line in source.split_inclusive('\n') {
        let trimmed = line.trim();
        if let Some((start, fence)) = &opening {
            if trimmed.starts_with(fence) && trimmed.chars().all(|c| c == '`' || c == '~') {
                ranges.push(*start..offset + line.len());
                opening = None;
            }
        } else if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            let fence: String = trimmed
                .chars()
                .take_while(|c| *c == '`' || *c == '~')
                .collect();
            if trimmed[fence.len()..]
                .trim()
                .eq_ignore_ascii_case("mermaid")
            {
                opening = Some((offset, fence));
            }
        }
        offset += line.len();
    }
    // Unclosed fences are still protected; never ask the model to repair syntax.
    if let Some((start, _)) = opening {
        ranges.push(start..source.len());
    }
    if ranges.is_empty() && diagram_kind(source.trim()).is_some() {
        ranges.push(0..source.len());
    }
    ranges
}

fn diagram_kind(source: &str) -> Option<&str> {
    let source = diagram_body(source)?;
    let first = source.split_whitespace().next()?;
    [
        "flowchart",
        "graph",
        "sequenceDiagram",
        "stateDiagram-v2",
        "classDiagram",
        "erDiagram",
        "mindmap",
        "timeline",
        "gantt",
        "pie",
        "journey",
    ]
    .contains(&first)
    .then_some(first)
}

// Bare Mermaid can also start with YAML front matter. Its settings are never
// diagram labels, even when a value is a quoted string such as "dark".
fn diagram_body(source: &str) -> Option<&str> {
    let mut lines = source.split_inclusive('\n');
    if lines.next()?.trim() != "---" {
        return Some(source);
    }
    let mut offset = source.split_inclusive('\n').next()?.len();
    for line in lines {
        offset += line.len();
        if line.trim() == "---" {
            return Some(source[offset..].trim_start());
        }
    }
    None
}

fn label_ranges(block: &str) -> Vec<Range<usize>> {
    let flowchart = block
        .lines()
        .any(|line| matches!(diagram_kind(line.trim()), Some("graph" | "flowchart")));
    let mut ranges = Vec::new();
    let mut offset = 0;
    let mut before_body = true;
    let mut in_front_matter = false;
    for line in block.split_inclusive('\n') {
        let trimmed = line.trim();
        if in_front_matter {
            if trimmed == "---" {
                in_front_matter = false;
            }
            offset += line.len();
            continue;
        }
        if before_body && trimmed == "---" {
            before_body = false;
            in_front_matter = true;
            offset += line.len();
            continue;
        }
        if !trimmed.is_empty()
            && !trimmed.starts_with("```")
            && !trimmed.starts_with("~~~")
            && !trimmed.starts_with("%%")
        {
            before_body = false;
        }
        if trimmed.starts_with("%%")
            || trimmed.starts_with("```")
            || trimmed.starts_with("~~~")
            || trimmed.contains("@{")
            || ["style ", "classDef ", "linkStyle ", "click "]
                .iter()
                .any(|prefix| trimmed.starts_with(prefix))
        {
            offset += line.len();
            continue;
        }
        let bytes = line.as_bytes();
        let mut index = 0;
        while index < bytes.len() {
            let open = bytes[index];
            let close = match open {
                b'"' => b'"',
                b'[' if flowchart => b']',
                b'(' if flowchart => b')',
                b'{' if flowchart && bytes.get(index.wrapping_sub(1)) != Some(&b'@') => b'}',
                b'|' if flowchart => b'|',
                _ => {
                    index += 1;
                    continue;
                }
            };
            let mut start = index + 1;
            while open != b'"' && open != b'|' && bytes.get(start) == Some(&open) {
                start += 1;
            }
            let mut end = start;
            let mut quoted = false;
            while end < bytes.len() {
                if bytes[end] == b'"' && open != b'"' && (end == 0 || bytes[end - 1] != b'\\') {
                    quoted = !quoted;
                }
                if bytes[end] == close && !quoted && (end == 0 || bytes[end - 1] != b'\\') {
                    break;
                }
                end += 1;
            }
            if end == bytes.len() {
                index += 1;
                continue;
            }
            let mut label_end = end;
            while start + 1 < label_end
                && matches!(
                    (bytes[start], bytes[label_end - 1]),
                    (b'[', b']') | (b'(', b')') | (b'{', b'}') | (b'/', b'/')
                )
            {
                start += 1;
                label_end -= 1;
            }
            // Keep quote and Markdown-string wrappers as part of the structure.
            if bytes.get(start) == Some(&b'"')
                && bytes.get(label_end.wrapping_sub(1)) == Some(&b'"')
            {
                start += 1;
                label_end -= 1;
            }
            if bytes.get(start) == Some(&b'`')
                && bytes.get(label_end.wrapping_sub(1)) == Some(&b'`')
            {
                start += 1;
                label_end -= 1;
            }
            if start < label_end && line[start..label_end].chars().any(char::is_alphabetic) {
                ranges.push(offset + start..offset + label_end);
            }
            index = end + 1;
        }
        offset += line.len();
    }
    ranges
        .into_iter()
        .flat_map(|range| label_text_ranges(block, range))
        .collect()
}

fn label_text_ranges(block: &str, range: Range<usize>) -> Vec<Range<usize>> {
    let mut result = Vec::new();
    let mut start = range.start;
    let mut cursor = start;
    while let Some(relative) = block[cursor..range.end].find('<') {
        let opening = cursor + relative;
        let Some(end) = block[opening..range.end].find('>') else {
            break;
        };
        let closing = opening + end + 1;
        let tag = block[opening + 1..closing - 1]
            .trim_start_matches('/')
            .split([' ', '/'])
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        if ["br", "b", "strong", "i", "em", "span", "sub", "sup"].contains(&tag.as_str()) {
            if block[start..opening].chars().any(char::is_alphabetic) {
                result.push(start..opening);
            }
            start = closing;
        }
        cursor = closing;
    }
    if block[start..range.end].chars().any(char::is_alphabetic) {
        result.push(start..range.end);
    }
    result
}

fn escape_label(text: &str) -> String {
    let mut output = String::new();
    for ch in text.chars() {
        match ch {
            '"' | '[' | ']' | '(' | ')' | '{' | '}' | '|' | '<' | '>' | '`' | '\\' => {
                output.push_str(&format!("#{};", u32::from(ch)))
            }
            '\n' | '\r' => output.push(' '),
            _ => output.push(ch),
        }
    }
    output
}

#[cfg(test)]
mod tests;
