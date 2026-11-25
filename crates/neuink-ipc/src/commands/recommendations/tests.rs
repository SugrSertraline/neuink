use super::ranking::base_id;
use super::*;
use neuink_domain::recommendations::Paper;

#[test]
fn changed_interests_can_refresh_and_failed_fetches_have_short_retry_delay() {
    let now = Utc::now();
    let mut history = Recommendations::default();
    history.last_attempt_at = Some(now.to_rfc3339());
    history.batches.push(RecommendationBatch {
        date: "2026-10-23".into(),
        generated_at: now.to_rfc3339(),
        interest_key: "old".into(),
        interests: vec![],
        papers: vec![paper("2601.00001", "diffusion")],
    });
    assert!(refresh_delay(&history, "old", now, "2026-10-23").is_some());
    assert!(
        refresh_delay(&history, "old", now, "2026-10-24").is_none(),
        "a new day must fetch even just after midnight"
    );
    assert!(refresh_delay(&history, "changed", now, "2026-10-23").is_none());
    history.batches[0].papers.clear();
    assert!(
        refresh_delay(&history, "old", now, "2026-10-23").is_some(),
        "successful empty batches use the same manual-refresh cooldown"
    );
    history.last_error = Some("network unavailable".into());
    assert!(refresh_delay(&history, "changed", now, "2026-10-23").is_some());
    assert!(refresh_delay(&history, "old", now + Duration::seconds(16), "2026-10-23").is_none());
    history.last_error = Some("arXiv HTTP 429".into());
    assert!(
        refresh_delay(&history, "old", now + Duration::seconds(30), "2026-10-23")
            .unwrap()
            .contains("30 秒")
    );
    assert!(refresh_delay(&history, "old", now + Duration::seconds(61), "2026-10-23").is_none());
}

pub(super) fn read_tagged_paper(workspace: &Workspace, date: &str, labels: &[&str]) -> EntryMeta {
    let tags = labels
        .iter()
        .map(|label| workspace.create_tag(*label, None).unwrap().id)
        .collect();
    let entry = workspace
        .create_entry_with_meta("Unrelated title about biology", BTreeMap::new(), tags)
        .unwrap();
    workspace
        .update_reading_state(
            &entry.id,
            neuink_domain::ReadingStateUpdate {
                active_ms_delta: 60_000,
                local_date: Some(date.into()),
                ..Default::default()
            },
        )
        .unwrap();
    entry
}

#[test]
fn topics_come_only_from_recent_reading_tags_and_weight_recency() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    read_tagged_paper(&workspace, "2026-10-24", &["扩散模型", "已读", "2026"]);
    read_tagged_paper(
        &workspace,
        "2026-10-11",
        &["对比学习（contrastive learning）"],
    );
    read_tagged_paper(&workspace, "2026-10-10", &["Expired"]);
    read_tagged_paper(&workspace, "2026-10-25", &["Future"]);
    let tag = workspace.create_tag("Unread", None).unwrap();
    workspace
        .create_entry_with_meta("Unread title", BTreeMap::new(), vec![tag.id])
        .unwrap();
    read_tagged_paper(&workspace, "2026-10-24", &[]);
    let topics = interests(
        &workspace,
        &workspace.list_entries().unwrap(),
        NaiveDate::from_ymd_opt(2026, 10, 24).unwrap(),
    )
    .unwrap();
    assert_eq!(topics, vec!["扩散模型", "对比学习（contrastive learning）"]);
    assert!(query::search_query(&topics).contains("diffusion"));
    assert!(!query::search_query(&topics).contains("biology"));
}

#[test]
fn unread_and_untagged_library_does_not_invent_interests() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    let tag = workspace.create_tag("diffusion", None).unwrap();
    workspace
        .create_entry_with_meta("Diffusion Models", BTreeMap::new(), vec![tag.id])
        .unwrap();
    read_tagged_paper(&workspace, "2026-10-24", &[]);
    assert!(interests(
        &workspace,
        &workspace.list_entries().unwrap(),
        NaiveDate::from_ymd_opt(2026, 10, 24).unwrap()
    )
    .unwrap()
    .is_empty());
}
#[tokio::test]
#[ignore = "Explicit opt-in: public arXiv API, isolated workspace; no model calls"]
async fn real_daily_recommendations_cache_and_feedback() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    let date = Utc::now().format("%Y-%m-%d").to_string();
    read_tagged_paper(
        &workspace,
        &date,
        &[
            "交通流量预测",
            "pems交通数据集",
            "对比学习（contrastive learning）",
            "扩散模型",
        ],
    );
    // Reproduce a legacy empty batch for today: it must not mask the repaired retrieval.
    workspace
        .update_recommendations(|state| {
            state.batches.push(RecommendationBatch {
                date: date.clone(),
                generated_at: Utc::now().to_rfc3339(),
                interest_key: "legacy".into(),
                interests: vec!["交通流量预测".into()],
                papers: vec![],
            });
            Ok(())
        })
        .unwrap();
    let cache =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/recommendation-test-cache");
    let result = generate(&workspace, &date, false, &cache).await.unwrap();
    let batch = result.batches.last().unwrap();
    assert_eq!(batch.date, date);
    assert!(
        !batch.papers.is_empty(),
        "public query returned no current candidates"
    );
    for paper in &batch.papers {
        assert!(!paper.matched_interests.is_empty());
        assert!(!paper.reasons.is_empty());
        println!(
            "{} | {} | {:?}",
            paper.paper.id, paper.paper.title, paper.matched_interests
        );
    }
    let cached = generate(&workspace, &date, false, &cache).await.unwrap();
    assert_eq!(
        cached.batches.last().unwrap().generated_at,
        batch.generated_at
    );
    let reopened = Workspace::open_existing(dir.path())
        .unwrap()
        .read_recommendations()
        .unwrap();
    assert_eq!(
        reopened.batches.last().unwrap().papers.len(),
        batch.papers.len()
    );
}
pub(super) fn paper(id: &str, topic: &str) -> RecommendedPaper {
    RecommendedPaper {
        paper: Paper {
            id: format!("arxiv:{id}"),
            title: format!("{topic} research {id}"),
            authors: vec![],
            year: "2026".into(),
            abstract_text: topic.into(),
            doi: String::new(),
            url: format!("https://arxiv.org/abs/{id}"),
            pdf_url: None,
            provider: "arxiv".into(),
            evidence_level: "abstract".into(),
        },
        published: "2026-10-20T00:00:00Z".into(),
        updated: "2026-10-22T00:00:00Z".into(),
        categories: vec!["cs.LG".into()],
        matched_interests: vec![],
        reasons: vec![],
    }
}
#[test]
fn chinese_and_bilingual_labels_rank_english_papers() {
    for label in ["对比学习（contrastive learning）", "对比学习"] {
        let result = rank(
            vec![paper(
                "2601.00001",
                "Contrastive learning for traffic forecasting",
            )],
            &[label.into()],
            &Recommendations::default(),
            &[],
            "2026-10-24",
        );
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_interests, vec![label]);
        assert!(result[0].reasons[0].contains("近期阅读标签"));
    }
}
#[test]
fn deduplicates_versions_imported_urls_feedback_and_recent_batches() {
    assert_eq!(
        base_id("https://arxiv.org/pdf/2401.00100v12.pdf"),
        "2401.00100"
    );
    let mut history = Recommendations::default();
    history.feedback.push(RecommendationFeedback {
        id: "arxiv:2601.00002v1".into(),
        ignored: true,
        saved: false,
    });
    history.batches.push(RecommendationBatch {
        date: "2026-10-22".into(),
        generated_at: String::new(),
        interest_key: String::new(),
        interests: vec![],
        papers: vec![paper("2601.00003v1", "diffusion")],
    });
    let mut entry = EntryMeta::new("Existing").unwrap();
    entry.fields.insert(
        "pdf_source_url".into(),
        "https://arxiv.org/pdf/2601.00004v1.pdf".into(),
    );
    let result = rank(
        vec![
            paper("2601.00001v1", "diffusion"),
            paper("2601.00001v2", "diffusion"),
            paper("2601.00002v2", "diffusion"),
            paper("2601.00003v2", "diffusion"),
            paper("2601.00004v2", "diffusion"),
            paper("2601.00005", "biology"),
        ],
        &["diffusion".into()],
        &history,
        &[entry],
        "2026-10-23",
    );
    assert_eq!(result.len(), 1);
    assert_eq!(base_id(&result[0].paper.id), "2601.00001");
    assert!(!result[0].reasons.is_empty());
}
#[test]
fn calendar_window_expires_old_recommendations() {
    let mut history = Recommendations::default();
    history.batches.push(RecommendationBatch {
        date: "2025-10-22".into(),
        generated_at: String::new(),
        interest_key: String::new(),
        interests: vec![],
        papers: vec![paper("2601.00001", "diffusion")],
    });
    assert_eq!(
        rank(
            vec![paper("2601.00001", "diffusion")],
            &["diffusion".into()],
            &history,
            &[],
            "2026-10-23"
        )
        .len(),
        1
    );
}
