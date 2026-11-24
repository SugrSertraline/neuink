use neuink_domain::{CanonicalSectionRole, EntryId, NoteId, SegmentType, SegmentUid, TagId};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SearchDocument {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub source: SearchDocumentSource,
    pub target: SearchTarget,
    pub title: String,
    pub sections: Vec<SearchTextSection>,
    pub boost: f32,
}

impl SearchDocument {
    pub fn text_for_snippet(&self) -> String {
        self.sections
            .iter()
            .find(|section| section.label == "body" && !section.text.trim().is_empty())
            .or_else(|| {
                self.sections
                    .iter()
                    .find(|section| !section.text.trim().is_empty())
            })
            .map(|section| section.text.clone())
            .unwrap_or_else(|| self.title.clone())
    }
}

/// Returns true when `text` contains an HTML `<table` tag (case-insensitive).
pub(crate) fn contains_html_table(text: &str) -> bool {
    let bytes = text.as_bytes();
    if bytes.len() < 6 {
        return false;
    }
    bytes.windows(6).any(|window| {
        window[0] == b'<'
            && window[1].eq_ignore_ascii_case(&b't')
            && window[2].eq_ignore_ascii_case(&b'a')
            && window[3].eq_ignore_ascii_case(&b'b')
            && window[4].eq_ignore_ascii_case(&b'l')
            && window[5].eq_ignore_ascii_case(&b'e')
    })
}

fn find_ascii_icase(haystack: &str, needle: &str, from: usize) -> Option<usize> {
    let h = haystack.as_bytes();
    let n = needle.as_bytes();
    if n.is_empty() || from + n.len() > h.len() {
        return None;
    }
    for i in from..=(h.len() - n.len()) {
        if h[i..i + n.len()].eq_ignore_ascii_case(n) {
            return Some(i);
        }
    }
    None
}

fn decode_basic_html_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn strip_cell_html(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    let mut prev_space = true;
    while let Some(ch) = chars.next() {
        if ch == '<' {
            if let Some(&next) = chars.peek() {
                if next.is_ascii_alphabetic() || next == '/' {
                    for inner in chars.by_ref() {
                        if inner == '>' {
                            break;
                        }
                    }
                    if !prev_space {
                        out.push(' ');
                        prev_space = true;
                    }
                    continue;
                }
            }
        }
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    decode_basic_html_entities(out.trim())
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn format_single_html_table(table_html: &str) -> String {
    let mut rows: Vec<String> = Vec::new();
    let mut pos = 0usize;
    while let Some(tr_start) = find_ascii_icase(table_html, "<tr", pos) {
        let Some(tr_open_end) = table_html[tr_start..].find('>') else {
            break;
        };
        let row_body_start = tr_start + tr_open_end + 1;
        let row_end = find_ascii_icase(table_html, "</tr>", row_body_start)
            .or_else(|| find_ascii_icase(table_html, "<tr", row_body_start))
            .unwrap_or(table_html.len());
        let row_slice = &table_html[row_body_start..row_end];

        let mut cells: Vec<String> = Vec::new();
        let mut cpos = 0usize;
        while cpos < row_slice.len() {
            let next_td = find_ascii_icase(row_slice, "<td", cpos);
            let next_th = find_ascii_icase(row_slice, "<th", cpos);
            let Some((cell_start, is_th)) = (match (next_td, next_th) {
                (Some(a), Some(b)) => Some(if a <= b { (a, false) } else { (b, true) }),
                (Some(a), None) => Some((a, false)),
                (None, Some(b)) => Some((b, true)),
                (None, None) => None,
            }) else {
                break;
            };
            let Some(open_end) = row_slice[cell_start..].find('>') else {
                break;
            };
            let content_start = cell_start + open_end + 1;
            let close_tag = if is_th { "</th>" } else { "</td>" };
            let content_end = find_ascii_icase(row_slice, close_tag, content_start)
                .unwrap_or(row_slice.len());
            let cell_text = strip_cell_html(&row_slice[content_start..content_end]);
            cells.push(cell_text.replace('|', "/"));
            cpos = (content_end + close_tag.len()).min(row_slice.len());
        }
        if !cells.is_empty() && cells.iter().any(|cell| !cell.is_empty()) {
            rows.push(format!("|{}|", cells.join("|")));
        }
        pos = if row_end < table_html.len() && table_html[row_end..].len() >= 5
            && table_html.as_bytes()[row_end..row_end + 5].eq_ignore_ascii_case(b"</tr>")
        {
            row_end + 5
        } else {
            row_end
        };
    }
    if rows.is_empty() {
        strip_cell_html(table_html)
    } else {
        rows.join("\n")
    }
}

/// Converts verbose HTML `<table>...</table>` markup (e.g. from MinerU) into compact
/// pipe-delimited rows (`|col1|col2|...|`) so full academic comparison tables—including
/// the bottom proposed-method row—fit within reader snippet and surrounding-context budgets.
pub(crate) fn compact_html_table_if_present(text: &str) -> String {
    if !contains_html_table(text) {
        return text.split_whitespace().collect::<Vec<_>>().join(" ");
    }
    let mut parts: Vec<String> = Vec::new();
    let mut pos = 0usize;
    while let Some(table_start) = find_ascii_icase(text, "<table", pos) {
        let before = text[pos..table_start]
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if !before.is_empty() {
            parts.push(before);
        }
        let table_end = find_ascii_icase(text, "</table>", table_start)
            .map(|idx| idx + "</table>".len())
            .unwrap_or(text.len());
        let formatted = format_single_html_table(&text[table_start..table_end]);
        if !formatted.is_empty() {
            parts.push(formatted);
        }
        pos = table_end;
    }
    if pos < text.len() {
        let after = text[pos..]
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if !after.is_empty() {
            parts.push(after);
        }
    }
    parts.join("\n")
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SearchTextSection {
    pub label: String,
    pub text: String,
    pub boost: f32,
}

impl SearchTextSection {
    pub fn title(text: impl Into<String>) -> Self {
        Self {
            label: "title".to_string(),
            text: text.into(),
            boost: 2.4,
        }
    }

    pub fn body(text: impl Into<String>) -> Self {
        Self {
            label: "body".to_string(),
            text: text.into(),
            boost: 1.0,
        }
    }

    pub fn with_boost(label: impl Into<String>, text: impl Into<String>, boost: f32) -> Self {
        Self {
            label: label.into(),
            text: text.into(),
            boost,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct SearchDocumentSource {
    pub kind: SearchDocumentSourceKind,
    pub label: String,
    #[serde(default)]
    pub field_name: Option<String>,
    #[serde(default)]
    pub tag_id: Option<TagId>,
    #[serde(default)]
    pub note_id: Option<NoteId>,
    #[serde(default)]
    pub segment_uid: Option<SegmentUid>,
    #[serde(default)]
    pub page_idx: Option<u32>,
    #[serde(default)]
    pub section_id: Option<String>,
    #[serde(default)]
    pub section_path: Option<String>,
    #[serde(default)]
    pub section_role: Option<CanonicalSectionRole>,
    #[serde(default)]
    pub segment_type: Option<SegmentType>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchDocumentSourceKind {
    #[default]
    EntryTitle,
    EntryField,
    EntryTag,
    NoteTitle,
    NoteBody,
    SegmentNote,
    Annotation,
    PdfPage,
    Segment,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SearchTarget {
    Entry {
        entry_id: EntryId,
    },
    Note {
        entry_id: EntryId,
        note_id: NoteId,
    },
    Page {
        entry_id: EntryId,
        page_idx: u32,
    },
    Segment {
        entry_id: EntryId,
        segment_uid: SegmentUid,
        page_idx: u32,
    },
}

impl Default for SearchTarget {
    fn default() -> Self {
        Self::Entry {
            entry_id: EntryId::from_string(String::new()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SearchResults {
    pub query: String,
    pub mode: String,
    pub index_generation: u64,
    pub total_hit_count: usize,
    pub entries: Vec<SearchEntryGroup>,
    #[serde(default)]
    pub warnings: Vec<String>,
    /// Optional audit tag indicating which rerank rung ran on this result set (`off`, `cross_encoder`, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rerank_used: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SearchEntryGroup {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub hit_count: usize,
    pub max_score: f32,
    pub hits: Vec<SearchHit>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SearchHit {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub source: SearchDocumentSource,
    pub target: SearchTarget,
    pub title: String,
    pub snippet: String,
    pub score: f32,
    pub matched_terms: Vec<String>,
    /// Read-only same-section `[Prev]`/`[Next]` context populated strictly *after* final ranking.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surrounding_context: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::{compact_html_table_if_present, contains_html_table};

    #[test]
    fn compact_html_table_compresses_rows_and_preserves_math_and_entities() {
        let html = concat!(
            "<table>",
            "<tr><td rowspan=\"2\">Method</td><td colspan=\"2\">M3DocVQA</td></tr>",
            "<tr><td>Recall</td><td>All &amp; K &lt; 10</td></tr>",
            "<tr><td>MultiDocFusion</td><td>83.0</td><td>70.5</td></tr>",
            "<tr><td>HiKEY</td><td>84.9</td><td>73.6</td></tr>",
            "</table>"
        );
        assert!(contains_html_table(html));
        let compact = compact_html_table_if_present(html);
        assert_eq!(
            compact,
            "|Method|M3DocVQA|\n|Recall|All & K < 10|\n|MultiDocFusion|83.0|70.5|\n|HiKEY|84.9|73.6|"
        );
        assert!(compact.len() * 2 < html.len() + 40);
    }

    #[test]
    fn compact_html_table_keeps_plain_prose_whitespace_collapsed() {
        let prose = "HiKEY improves   retrieval  when K < 10.";
        assert!(!contains_html_table(prose));
        assert_eq!(
            compact_html_table_if_present(prose),
            "HiKEY improves retrieval when K < 10."
        );
    }
}
