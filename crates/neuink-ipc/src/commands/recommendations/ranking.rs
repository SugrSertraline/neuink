//! Interest extraction, deduplication and deterministic recommendation ranking.
use super::*;
fn management_tag(value: &str) -> bool {
    value.trim().chars().all(|c| c.is_numeric())
        || [
            "待读",
            "已读",
            "未读",
            "未解析",
            "已解析",
            "重要",
            "todo",
            "read",
            "unread",
        ]
        .contains(&value.to_lowercase().as_str())
}
pub(super) fn interests(
    workspace: &Workspace,
    entries: &[EntryMeta],
    day: NaiveDate,
) -> Result<Vec<String>, String> {
    let tags = workspace.list_tags().map_err(|e| e.to_string())?;
    let states = workspace.list_reading_states().map_err(|e| e.to_string())?;
    let mut scores: BTreeMap<String, f64> = BTreeMap::new();
    for reading in states {
        let recent: Vec<_> = reading
            .state
            .daily_active_ms
            .iter()
            .filter_map(|(date, ms)| {
                NaiveDate::parse_from_str(date, "%Y-%m-%d")
                    .ok()
                    .filter(|date| *ms > 0 && *date <= day && *date > day - Duration::days(14))
                    .map(|date| (date, *ms))
            })
            .collect();
        if recent.is_empty() {
            continue;
        }
        let Some(entry) = entries.iter().find(|entry| entry.id == reading.entry_id) else {
            continue;
        };
        let weight: f64 = recent
            .iter()
            .map(|(date, ms)| {
                (1.0 + (*ms as f64 / 60_000.0).min(30.0) / 30.0)
                    / (1.0 + (day - *date).num_days() as f64 / 7.0)
            })
            .sum::<f64>();
        for tag in tags
            .iter()
            .filter(|tag| entry.tags.contains(&tag.id) && !management_tag(&tag.name))
        {
            *scores.entry(tag.name.clone()).or_default() += weight;
        }
    }
    let mut topics: Vec<_> = scores
        .into_iter()
        // Keep labels for display; query aliases are shared with candidate matching.
        .filter(|(topic, _)| !query::terms(topic).is_empty())
        .collect();
    topics.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    Ok(topics
        .into_iter()
        .take(10)
        .map(|(topic, _)| topic)
        .collect())
}
pub(super) fn base_id(id: &str) -> String {
    let mut value = id.trim().trim_start_matches("arxiv:");
    for prefix in [
        "https://arxiv.org/abs/",
        "http://arxiv.org/abs/",
        "https://arxiv.org/pdf/",
        "https://arxiv.org/html/",
    ] {
        value = value.trim_start_matches(prefix);
    }
    let value = value.trim_end_matches(".pdf");
    value
        .rsplit_once('v')
        .filter(|(_, suffix)| !suffix.is_empty() && suffix.bytes().all(|c| c.is_ascii_digit()))
        .map(|(base, _)| base)
        .unwrap_or(value)
        .to_lowercase()
}
pub(super) fn rank(
    candidates: Vec<RecommendedPaper>,
    interests: &[String],
    history: &Recommendations,
    entries: &[EntryMeta],
    date: &str,
) -> Vec<RecommendedPaper> {
    let mut seen = BTreeSet::new();
    let mut scored = Vec::new();
    for mut p in candidates {
        let id = base_id(&p.paper.id);
        let text = format!(
            "{} {} {}",
            p.paper.title,
            p.paper.abstract_text,
            p.categories.join(" ")
        )
        .to_lowercase();
        if !seen.insert(id.clone())
            || history
                .feedback
                .iter()
                .any(|f| f.ignored && base_id(&f.id) == id)
        {
            continue;
        }
        if entries.iter().any(|entry| {
            entry.title.eq_ignore_ascii_case(&p.paper.title)
                || entry.fields.iter().any(|(key, value)| {
                    (key == "doi"
                        && !p.paper.doi.is_empty()
                        && value
                            .trim_start_matches("https://doi.org/")
                            .eq_ignore_ascii_case(&p.paper.doi))
                        || ([
                            "url",
                            "source_url",
                            "pdf_source_url",
                            "arxiv_id",
                            "research_id",
                        ]
                        .contains(&key.as_str())
                            && base_id(value) == id)
                })
        }) {
            continue;
        }
        let since = NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .ok()
            .map(|d| (d - Duration::days(14)).to_string())
            .unwrap_or_default();
        if history
            .batches
            .iter()
            .filter(|b| {
                b.date != date && b.date.as_str() >= since.as_str() && b.date.as_str() <= date
            })
            .any(|b| b.papers.iter().any(|old| base_id(&old.paper.id) == id))
        {
            continue;
        }
        p.matched_interests = interests
            .iter()
            .filter(|topic| query::matches(&text, topic))
            .cloned()
            .collect();
        if p.matched_interests.is_empty() {
            continue;
        }
        p.reasons = vec![
            format!(
                "与近期阅读标签「{}」相关",
                p.matched_interests
                    .iter()
                    .take(3)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("、")
            ),
            "基于 arXiv 标题、摘要与分类匹配；未验证全文".into(),
        ];
        scored.push(p);
    }
    scored.sort_by(|a, b| {
        b.matched_interests
            .len()
            .cmp(&a.matched_interests.len())
            .then(b.published.cmp(&a.published))
    });
    let mut counts = BTreeMap::new();
    let mut result = Vec::new();
    for paper in scored {
        let topic = paper.matched_interests.first().cloned().unwrap_or_default();
        let count = counts.entry(topic).or_insert(0);
        if *count >= 4 && interests.len() > 1 {
            continue;
        }
        *count += 1;
        result.push(paper);
        if result.len() == 10 {
            break;
        }
    }
    result
}
