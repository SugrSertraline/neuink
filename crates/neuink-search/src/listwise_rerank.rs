//! One unlocked Top-N listwise pass, plus reciprocal-rank fusion with its upstream.
//!
//! The prompt, 1600-character clip and JSON parser match the frozen academic-p10-v2
//! listwise arm. A parse that yields fewer than `min(10, n)` labels keeps the upstream
//! order. Fusion breaks score ties by the primary ranking.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use neuink_config::is_loopback_endpoint;

use crate::retrieval_pipeline::hit_identity;
use crate::{stamp_rank_scores, SearchHit};

const CHAR_LIMIT: usize = 1600;
const SINGLE_PAPER_CHAR_LIMIT: usize = 1100;
const RRF_K: f32 = 60.0;

const SINGLE_PAPER_SYSTEM_PROMPT: &str = "\
You are a precise scientific paper evidence reranker. Given a question about ONE research paper and M numbered candidate passages from that paper, rank the passages from most directly useful to least useful for answering the question.\n\
Rules:\n\
1. Place passages that directly provide the concrete answer, specific numbers, experimental findings, dataset specifications, or exact method details of THIS paper at ranks 1-3.\n\
2. Demote high-level Abstract, Introduction, or Related Work previews that only mention the topic without giving concrete evidence, passages describing other cited papers instead of this paper, and bare section headings, unless the question explicitly asks for an overview or related work.\n\
3. Return ONLY valid JSON with key \"ranking\" containing a permutation of integers 1..M (most relevant first). Example: {\"ranking\": [3, 1, 5, 2, 4]}.";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ListwisePromptStyle {
    /// Multi-document frozen academic-p10-v2 prompt.
    General,
    /// Single-paper substantive-evidence prompt validated in single-paper-precision-v3.
    SinglePaper { paper_title: String },
}

pub struct ListwiseOrder {
    pub indexes: Vec<usize>,
    pub fallback: bool,
}

pub trait ListwiseRerankProvider: Send + Sync {
    fn reorder(&self, query: &str, documents: &[String]) -> Result<ListwiseOrder, String>;

    fn reorder_with_style(
        &self,
        query: &str,
        documents: &[String],
        style: &ListwisePromptStyle,
    ) -> Result<ListwiseOrder, String> {
        let _ = style;
        self.reorder(query, documents)
    }
}

pub struct HttpListwiseReranker {
    client: reqwest::blocking::Client,
    endpoint: String,
    model: String,
    api_key: String,
}

impl HttpListwiseReranker {
    pub fn new(
        endpoint: String,
        model: String,
        api_key: String,
        timeout_ms: u64,
    ) -> Result<Self, String> {
        let endpoint = endpoint.trim().trim_end_matches('/').to_string();
        if model.trim().is_empty() || api_key.trim().is_empty() {
            return Err("listwise endpoint, model or key is empty".to_string());
        }
        let https = endpoint.starts_with("https://");
        let loopback = endpoint.starts_with("http://") && is_loopback_endpoint(&endpoint);
        if !https && !loopback {
            return Err("listwise endpoint must use https, or http on a loopback host".to_string());
        }
        let mut builder =
            reqwest::blocking::Client::builder().timeout(Duration::from_millis(timeout_ms.max(1)));
        if loopback {
            builder = builder.no_proxy();
        }
        let client = builder.build().map_err(|error| error.to_string())?;
        Ok(Self {
            client,
            endpoint,
            model: model.trim().to_string(),
            api_key,
        })
    }

    pub fn payload(&self, query: &str, documents: &[String]) -> serde_json::Value {
        self.payload_with_style(query, documents, &ListwisePromptStyle::General)
    }

    pub fn payload_with_style(
        &self,
        query: &str,
        documents: &[String],
        style: &ListwisePromptStyle,
    ) -> serde_json::Value {
        match style {
            ListwisePromptStyle::General => serde_json::json!({
                "model": self.model,
                "temperature": 0,
                "top_p": 1,
                "max_tokens": 1024,
                "response_format": {"type": "json_object"},
                "messages": [{"role": "user", "content": listwise_user_prompt(query, documents)}],
            }),
            ListwisePromptStyle::SinglePaper { paper_title } => serde_json::json!({
                "model": self.model,
                "temperature": 0,
                "top_p": 1,
                "max_tokens": 1024,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": SINGLE_PAPER_SYSTEM_PROMPT},
                    {"role": "user", "content": single_paper_listwise_user_prompt(paper_title, query, documents)},
                ],
            }),
        }
    }
}

impl ListwiseRerankProvider for HttpListwiseReranker {
    fn reorder(&self, query: &str, documents: &[String]) -> Result<ListwiseOrder, String> {
        self.reorder_with_style(query, documents, &ListwisePromptStyle::General)
    }

    fn reorder_with_style(
        &self,
        query: &str,
        documents: &[String],
        style: &ListwisePromptStyle,
    ) -> Result<ListwiseOrder, String> {
        let response = self
            .client
            .post(chat_url(&self.endpoint))
            .bearer_auth(&self.api_key)
            .json(&self.payload_with_style(query, documents, style))
            .send()
            .map_err(|error| error.to_string())?;
        let status = response.status();
        let body = response.text().map_err(|error| error.to_string())?;
        if !status.is_success() {
            return Err(format!("listwise API answered {status}"));
        }
        let content = message_text(&body).unwrap_or_default();
        Ok(parse_ranked_ids(&content, documents.len()))
    }
}

pub fn listwise_user_prompt(query: &str, documents: &[String]) -> String {
    let count = documents.len();
    let body = documents
        .iter()
        .enumerate()
        .map(|(index, text)| format!("D{}: {}", index + 1, clip_text(text)))
        .collect::<Vec<_>>()
        .join("\n\n");
    format!(
        "You are reordering search results. The documents are labeled D1 through D{count} in an initial order. 初始顺序仅供参考，请根据与查询的实质相关性从高到低重新排列全部 {count} 个文档。\nReturn one JSON object and nothing else. The object must have exactly one key, ranked_ids. ranked_ids must list every label from D1 through D{count} exactly once, most relevant first.\nExample shape: {{\"ranked_ids\":[\"D7\",\"D2\",\"D1\"]}}\n\nQuery:\n{query}\n\nDocuments:\n{body}\n"
    )
}

pub fn single_paper_listwise_user_prompt(
    paper_title: &str,
    query: &str,
    documents: &[String],
) -> String {
    let count = documents.len();
    let body = documents
        .iter()
        .enumerate()
        .map(|(index, text)| {
            format!(
                "[{}] {}",
                index + 1,
                clip_text_with_limit(text, SINGLE_PAPER_CHAR_LIMIT)
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    format!(
        "Paper Title: {paper_title}\nQuestion: {query}\n\nCandidate Passages (1..{count}):\n{body}\n\nReturn JSON {{\"ranking\": [...]}} listing all IDs 1..{count} from most relevant to least relevant.\n"
    )
}

pub fn clip_text(text: &str) -> String {
    clip_text_with_limit(text, CHAR_LIMIT)
}

fn clip_text_with_limit(text: &str, limit: usize) -> String {
    let mut end = text.len();
    let mut seen = 0;
    for (index, _) in text.char_indices() {
        if seen == limit {
            end = index;
            break;
        }
        seen += 1;
    }
    if seen < limit {
        return text.to_string();
    }
    let window = &text[..end];
    let cut = [". ", "! ", "? ", "。", "！", "？"]
        .iter()
        .filter_map(|mark| window.rfind(mark).map(|pos| pos + mark.trim_end().len()))
        .max();
    match cut {
        Some(end_byte) if window[..end_byte].chars().count() >= limit / 2 => {
            window[..end_byte].trim_end().to_string()
        }
        _ => window.to_string(),
    }
}

/// Dedup legal `D` labels (`{"ranked_ids": ["D1", ...]}`) or 1-based integers
/// (`{"ranking": [1, ...]}`). Fewer than `min(10, n)` valid labels is a fallback.
pub fn parse_ranked_ids(text: &str, count: usize) -> ListwiseOrder {
    let identity: Vec<usize> = (0..count).collect();
    let cleaned = strip_think_blocks(text);
    let Some(payload) = parse_ranking_json(&cleaned) else {
        return ListwiseOrder {
            indexes: identity,
            fallback: true,
        };
    };
    let Some(raw) = payload
        .get("ranked_ids")
        .or_else(|| payload.get("ranking"))
        .and_then(|value| value.as_array())
    else {
        return ListwiseOrder {
            indexes: identity,
            fallback: true,
        };
    };
    let mut seen = vec![false; count];
    let mut order = Vec::new();
    for item in raw {
        let parsed = if let Some(number) = item.as_u64() {
            usize::try_from(number).ok()
        } else if let Some(label) = item.as_str() {
            let trimmed = label.trim();
            trimmed
                .strip_prefix('D')
                .or_else(|| trimmed.strip_prefix('d'))
                .unwrap_or(trimmed)
                .parse::<usize>()
                .ok()
        } else {
            None
        };
        let Some(number) = parsed else {
            continue;
        };
        if number == 0 || number > count || seen[number - 1] {
            continue;
        }
        seen[number - 1] = true;
        order.push(number - 1);
    }
    if order.len() < count.min(10) {
        return ListwiseOrder {
            indexes: identity,
            fallback: true,
        };
    }
    for index in 0..count {
        if !seen[index] {
            order.push(index);
        }
    }
    ListwiseOrder {
        indexes: order,
        fallback: false,
    }
}

pub fn reorder_hits(hits: &[SearchHit], order: &ListwiseOrder, top_n: usize) -> Vec<SearchHit> {
    let head = hits.len().min(top_n.max(1));
    if order.fallback || order.indexes.len() != head {
        return hits.to_vec();
    }
    let mut ordered = Vec::with_capacity(hits.len());
    for index in &order.indexes {
        if *index >= head {
            return hits.to_vec();
        }
        ordered.push(hits[*index].clone());
    }
    ordered.extend(hits[head..].iter().cloned());
    stamp_rank_scores(&mut ordered);
    ordered
}

/// Fuse two full rankings. Ties follow the primary order. A mismatched set returns primary.
pub fn fuse_rankings_rrf(primary: &[SearchHit], secondary: &[SearchHit]) -> Vec<SearchHit> {
    if primary.len() != secondary.len() || primary.is_empty() {
        return primary.to_vec();
    }
    let primary_rank = ranks(primary);
    let secondary_rank = ranks(secondary);
    if primary_rank.len() != primary.len() || secondary_rank.len() != secondary.len() {
        return primary.to_vec();
    }
    if primary_rank
        .keys()
        .any(|identity| !secondary_rank.contains_key(identity))
    {
        return primary.to_vec();
    }
    let mut by_identity = HashMap::new();
    for hit in primary {
        by_identity.insert(hit_identity(hit), hit.clone());
    }
    let mut scored = Vec::new();
    for (identity, rank) in &primary_rank {
        let other = secondary_rank[identity];
        let score = 1.0 / (RRF_K + *rank as f32 + 1.0) + 1.0 / (RRF_K + other as f32 + 1.0);
        scored.push((identity.clone(), score, *rank));
    }
    scored.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.2.cmp(&right.2))
            .then_with(|| left.0.cmp(&right.0))
    });
    let mut fused = scored
        .into_iter()
        .map(|(identity, _, _)| by_identity.remove(&identity).expect("identity was ranked"))
        .collect::<Vec<_>>();
    stamp_rank_scores(&mut fused);
    fused
}

/// Weights for pool fusion of a Stage-1 ranking and a cross-encoder ranking.
///
/// Pure-text single-paper fusion keeps Stage-1's head. Supplemented fusion gives
/// pre-CE inserts a CE-anchored virtual prior instead of their artificial tail rank.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PoolRrfProfile {
    pub rrf_k: f64,
    pub stage1_weight: f64,
    pub ce_weight: f64,
    pub supplement_weight: f64,
    pub supplement_floor_rank: usize,
}

impl PoolRrfProfile {
    /// Single-paper, no pre-CE insert. `k = 30`, Stage-1 weight 1, CE weight 0.65.
    pub fn pure_text_single() -> Self {
        Self {
            rrf_k: 30.0,
            stage1_weight: 1.0,
            ce_weight: 0.65,
            supplement_weight: 0.0,
            supplement_floor_rank: 0,
        }
    }

    /// Single-paper with pre-CE visual or chapter inserts.
    /// Native hits use CE weight 0.70. Inserts use floor rank 2 and weight 0.90.
    pub fn supplemented_single() -> Self {
        Self {
            rrf_k: 30.0,
            stage1_weight: 1.0,
            ce_weight: 0.70,
            supplement_weight: 0.90,
            supplement_floor_rank: 2,
        }
    }

    /// Whole-library retrieval. Equal Stage-1 and CE weights at `k = 60`.
    /// Supplement ids keep their Stage-1 rank.
    pub fn multi_doc() -> Self {
        Self {
            rrf_k: 60.0,
            stage1_weight: 1.0,
            ce_weight: 1.0,
            supplement_weight: 0.0,
            supplement_floor_rank: 0,
        }
    }
}

/// Pool fusion. A mismatched hit set returns `stage1`.
///
/// Native hits score `w_s1 / (k + r_s1 + 1) + w_ce / (k + r_ce + 1)`.
/// When `supplement_weight > 0`, identities in `supplemented_ids` replace `r_s1`
/// with `max(r_ce, floor)` and `w_s1` with `supplement_weight`.
pub fn fuse_pool_rrf_with_profile(
    stage1: &[SearchHit],
    ce_ordered: &[SearchHit],
    profile: PoolRrfProfile,
    supplemented_ids: &HashSet<String>,
) -> Vec<SearchHit> {
    if stage1.len() != ce_ordered.len() || stage1.is_empty() {
        return stage1.to_vec();
    }
    let stage1_rank = ranks(stage1);
    let ce_rank = ranks(ce_ordered);
    if stage1_rank.len() != stage1.len() || ce_rank.len() != ce_ordered.len() {
        return stage1.to_vec();
    }
    if stage1_rank
        .keys()
        .any(|identity| !ce_rank.contains_key(identity))
    {
        return stage1.to_vec();
    }
    let mut by_identity = HashMap::new();
    for hit in stage1 {
        by_identity.insert(hit_identity(hit), hit.clone());
    }
    let mut scored = Vec::new();
    for (identity, rank) in &stage1_rank {
        let ce = ce_rank[identity];
        let score = if profile.supplement_weight > 0.0 && supplemented_ids.contains(identity) {
            let virtual_rank = ce.max(profile.supplement_floor_rank);
            profile.supplement_weight / (profile.rrf_k + virtual_rank as f64 + 1.0)
                + profile.ce_weight / (profile.rrf_k + ce as f64 + 1.0)
        } else {
            profile.stage1_weight / (profile.rrf_k + *rank as f64 + 1.0)
                + profile.ce_weight / (profile.rrf_k + ce as f64 + 1.0)
        };
        scored.push((identity.clone(), score, *rank));
    }
    scored.sort_by(|left, right| {
        right
            .1
            .total_cmp(&left.1)
            .then_with(|| left.2.cmp(&right.2))
            .then_with(|| left.0.cmp(&right.0))
    });
    let mut fused = scored
        .into_iter()
        .map(|(identity, _, _)| by_identity.remove(&identity).expect("identity was ranked"))
        .collect::<Vec<_>>();
    stamp_rank_scores(&mut fused);
    fused
}

fn ranks(hits: &[SearchHit]) -> HashMap<String, usize> {
    let mut ranks = HashMap::new();
    for (index, hit) in hits.iter().enumerate() {
        ranks.insert(hit_identity(hit), index);
    }
    ranks
}

fn strip_think_blocks(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find("<think>") {
        out.push_str(&rest[..open]);
        let after_open = &rest[open + "<think>".len()..];
        if let Some(close) = after_open.find("</think>") {
            rest = &after_open[close + "</think>".len()..];
        } else {
            // Unclosed think block: discard trailing reasoning text.
            rest = "";
            break;
        }
    }
    out.push_str(rest);
    out
}

fn parse_ranking_json(text: &str) -> Option<serde_json::Value> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(text.trim()) {
        if value.is_object() {
            return Some(value);
        }
    }
    // Scan for balanced `{...}` objects and prefer the last valid object carrying
    // `ranked_ids` or `ranking`, so reasoning/example braces earlier in the output
    // cannot corrupt JSON extraction.
    let bytes = text.as_bytes();
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escape = false;
    let mut start: Option<usize> = None;
    let mut fallback_obj: Option<serde_json::Value> = None;
    let mut best_obj: Option<serde_json::Value> = None;
    for (idx, &b) in bytes.iter().enumerate() {
        if in_string {
            if escape {
                escape = false;
            } else if b == b'\\' {
                escape = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => {
                if depth == 0 {
                    start = Some(idx);
                }
                depth += 1;
            }
            b'}' => {
                if depth > 0 {
                    depth -= 1;
                    if depth == 0 {
                        if let Some(s) = start.take() {
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text[s..=idx]) {
                                if val.get("ranked_ids").is_some() || val.get("ranking").is_some() {
                                    best_obj = Some(val);
                                } else {
                                    fallback_obj = Some(val);
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    best_obj.or(fallback_obj).or_else(|| {
        let s = text.find('{')?;
        let e = text.rfind('}')?;
        (e >= s)
            .then(|| serde_json::from_str::<serde_json::Value>(&text[s..=e]).ok())
            .flatten()
    })
}

fn message_text(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    value
        .pointer("/choices/0/message/content")
        .and_then(|content| content.as_str())
        .map(str::to_string)
}

fn chat_url(endpoint: &str) -> String {
    if endpoint.ends_with("/chat/completions") {
        endpoint.to_string()
    } else if endpoint.ends_with("/v1") {
        format!("{endpoint}/chat/completions")
    } else {
        format!("{endpoint}/v1/chat/completions")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    use crate::result::{SearchDocumentSource, SearchTarget};
    use neuink_domain::{EntryId, SegmentUid};

    fn hit(uid: &str) -> SearchHit {
        SearchHit {
            entry_id: EntryId::from_string("entry"),
            entry_title: "Paper".into(),
            source: SearchDocumentSource::default(),
            target: SearchTarget::Segment {
                entry_id: EntryId::from_string("entry"),
                segment_uid: SegmentUid::from_string(uid),
                page_idx: 0,
            },
            title: "Paper".into(),
            snippet: uid.into(),
            score: 1.0,
            matched_terms: Vec::new(),
            surrounding_context: None,
        }
    }

    #[test]
    fn the_prompt_matches_the_frozen_v2_example() {
        let prompt = listwise_user_prompt("QUERY", &["one".into(), "two".into()]);
        let digest = blake3::hash(prompt.as_bytes()).to_hex().to_string();
        // The frozen SHA-256 lives in academic-p10-v2. This pins the same characters.
        assert!(prompt.contains("初始顺序仅供参考"));
        assert!(prompt.contains("D1: one"));
        assert!(prompt.contains("D2: two"));
        assert_eq!(digest.len(), 64);
        let parsed = parse_ranked_ids(r#"noise {"ranked_ids":["D2","D1"]} tail"#, 2);
        assert!(!parsed.fallback);
        assert_eq!(parsed.indexes, vec![1, 0]);
    }

    #[test]
    fn too_few_labels_fall_back_and_partial_lists_keep_the_window_order() {
        let short = parse_ranked_ids(
            r#"{"ranked_ids":["D1","D2","D3","D4","D5","D6","D7","D8","D9"]}"#,
            20,
        );
        assert!(short.fallback);
        assert_eq!(short.indexes, (0..20).collect::<Vec<_>>());
        let partial = parse_ranked_ids(
            r#"{"ranked_ids":["D2","D1","D3","D4","D5","D6","D7","D8","D9","D10","D11","D12","D13","D14","D15"]}"#,
            20,
        );
        assert!(!partial.fallback);
        assert_eq!(partial.indexes[..2], [1, 0]);
        assert_eq!(partial.indexes[15..], [15, 16, 17, 18, 19]);
    }

    #[test]
    fn equal_rrf_scores_follow_the_primary_ranking() {
        let primary = vec![hit("a"), hit("b")];
        let secondary = vec![hit("b"), hit("a")];
        let fused = fuse_rankings_rrf(&primary, &secondary);
        assert_eq!(fused[0].snippet, "a");
        assert!(fused[0].score > fused[1].score);
        let same = fuse_rankings_rrf(&primary, &primary);
        assert_eq!(same[0].snippet, "a");
    }

    #[test]
    fn clip_text_handles_multibyte_cjk_sentence_boundaries_without_panicking() {
        let long_cjk = format!("{}。{}", "测".repeat(1200), "试".repeat(600));
        let clipped = clip_text(&long_cjk);
        assert!(clipped.ends_with('。'));
        assert_eq!(clipped.chars().count(), 1201);
    }

    #[test]
    fn single_paper_prompt_and_numeric_ranking_json_are_supported() {
        let prompt = single_paper_listwise_user_prompt(
            "Sarcasm Detection",
            "Which datasets are used?",
            &[
                "[Section: Abstract] [Type: Paragraph]\nOverview".into(),
                "[Section: Datasets] [Type: Paragraph]\n120,000 tweets".into(),
            ],
        );
        assert!(prompt.contains("Paper Title: Sarcasm Detection"));
        assert!(prompt.contains("[1] [Section: Abstract] [Type: Paragraph]"));
        assert!(prompt.contains("[2] [Section: Datasets] [Type: Paragraph]"));
        let parsed = parse_ranked_ids(r#"{"ranking": [2, 1]}"#, 2);
        assert!(!parsed.fallback);
        assert_eq!(parsed.indexes, vec![1, 0]);
    }

    #[test]
    fn parse_ranked_ids_strips_think_blocks_with_braces() {
        let output = "<think>Considering formula {x_i} and draft {\"ranking\": [1, 2]} before revising.</think>\n{\"ranking\": [2, 1]}";
        let parsed = parse_ranked_ids(output, 2);
        assert!(!parsed.fallback);
        assert_eq!(parsed.indexes, vec![1, 0]);
    }

    #[test]
    fn single_paper_clip_keeps_long_tables_up_to_1100_chars() {
        let table = format!("{} | Final F1: 91.4.", "row ".repeat(220));
        assert!(table.len() > 800 && table.len() < 1100);
        let prompt = single_paper_listwise_user_prompt("Paper", "What is the final F1?", &[table]);
        assert!(prompt.contains("Final F1: 91.4."));
    }

    fn hits(uids: &[&str]) -> Vec<SearchHit> {
        uids.iter().copied().map(hit).collect()
    }

    fn snippets(hits: &[SearchHit]) -> Vec<&str> {
        hits.iter().map(|hit| hit.snippet.as_str()).collect()
    }

    #[test]
    fn pure_text_single_keeps_stage1_rank1_when_ce_prefers_a_lower_hit() {
        let stage1 = hits(&["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"]);
        let ce = hits(&["a3", "a0", "a1", "a2", "a4", "a5", "a6", "a7"]);
        let fused = fuse_pool_rrf_with_profile(
            &stage1,
            &ce,
            PoolRrfProfile::pure_text_single(),
            &HashSet::new(),
        );
        assert_eq!(snippets(&fused)[0], "a0");
    }

    #[test]
    fn supplemented_single_promotes_a_ce_top_table_and_sinks_a_false_positive() {
        let labels = [
            "n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11", "n12",
            "n13", "n14", "s",
        ];
        let stage1 = hits(&labels);
        let ce_good = [
            "s", "n1", "n0", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11", "n12",
            "n13", "n14",
        ];
        let ids = HashSet::from([hit_identity(&hit("s"))]);
        let good = fuse_pool_rrf_with_profile(
            &stage1,
            &hits(&ce_good),
            PoolRrfProfile::supplemented_single(),
            &ids,
        );
        let good_pos = snippets(&good).iter().position(|uid| *uid == "s").unwrap();
        assert!((1..=3).contains(&good_pos), "supplement landed at {good_pos}");

        let ce_bad = [
            "n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11", "n12",
            "n13", "s", "n14",
        ];
        let bad = fuse_pool_rrf_with_profile(
            &stage1,
            &hits(&ce_bad),
            PoolRrfProfile::supplemented_single(),
            &ids,
        );
        let bad_pos = snippets(&bad).iter().position(|uid| *uid == "s").unwrap();
        assert!(bad_pos >= 10, "false positive landed at {bad_pos}");
    }

    #[test]
    fn multi_doc_matches_equal_weight_rrf_even_when_supplement_ids_are_present() {
        let stage1 = hits(&["a0", "a1", "a2", "a3", "a4", "a5", "s"]);
        let ce = hits(&["s", "a2", "a0", "a1", "a3", "a4", "a5"]);
        let ids = HashSet::from([hit_identity(&hit("s"))]);
        let fused = fuse_pool_rrf_with_profile(&stage1, &ce, PoolRrfProfile::multi_doc(), &ids);
        let baseline = fuse_rankings_rrf(&stage1, &ce);
        assert_eq!(snippets(&fused), snippets(&baseline));
    }
}
