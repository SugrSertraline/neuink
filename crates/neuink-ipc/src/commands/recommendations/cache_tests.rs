use super::*;

fn workspace() -> (tempfile::TempDir, Workspace, String) {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    let date = Utc::now().format("%Y-%m-%d").to_string();
    super::tests::read_tagged_paper(&workspace, &date, &["diffusion"]);
    (dir, workspace, date)
}

#[tokio::test]
async fn successful_empty_day_survives_restart_and_interest_changes_without_fetch() {
    let (dir, workspace, date) = workspace();
    let first = generate_with(&workspace, &date, false, |_| async { Ok(vec![]) })
        .await
        .unwrap();
    assert_eq!(first.batches.len(), 1);
    assert!(first.batches[0].papers.is_empty());
    let reopened = Workspace::open_existing(dir.path()).unwrap();
    let entry = reopened.list_entries().unwrap().remove(0);
    reopened
        .update_entry_meta(&entry.id, entry.title, entry.fields, vec![])
        .unwrap();
    // Even without any searchable interests (or Python/network), the persisted batch must win.
    let cached = generate_with(&reopened, &date, false, |_| async {
        panic!("must not fetch twice");
    })
    .await
    .unwrap();
    assert_eq!(
        first.batches[0].generated_at,
        cached.batches[0].generated_at
    );
    assert_eq!(first.last_attempt_at, cached.last_attempt_at);
}

#[tokio::test]
async fn previous_day_does_not_prevent_fetch_and_legacy_empty_is_replaced() {
    let (_dir, workspace, date) = workspace();
    let yesterday = (Utc::now() - Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();
    workspace
        .update_recommendations(|state| {
            for (date, key) in [
                (yesterday.clone(), "arxiv.py:old"),
                (date.clone(), "v2:legacy"),
            ] {
                state.batches.push(RecommendationBatch {
                    date,
                    generated_at: Utc::now().to_rfc3339(),
                    interest_key: key.into(),
                    interests: vec![],
                    papers: vec![],
                });
            }
            Ok(())
        })
        .unwrap();
    let result = generate_with(&workspace, &date, false, |_| async { Ok(vec![]) })
        .await
        .unwrap();
    assert_eq!(result.batches.len(), 2);
    assert_eq!(result.batches[0].date, yesterday);
    assert!(result.batches[1].interest_key.starts_with("arxiv.py:"));
}

#[tokio::test]
async fn failed_fetch_is_not_a_completed_day_and_persists_server_retry_deadline() {
    let (dir, workspace, date) = workspace();
    let result = generate_with(&workspace, &date, false, |_| async {
        Err(client::FetchError {
            message: "arXiv HTTP 429".into(),
            retry_after_seconds: 600,
        })
    })
    .await;
    assert!(result.is_err());
    let reopened = Workspace::open_existing(dir.path()).unwrap();
    let saved = reopened.read_recommendations().unwrap();
    assert!(saved.batches.is_empty());
    let deadline =
        chrono::DateTime::parse_from_rfc3339(saved.retry_after.as_deref().unwrap()).unwrap();
    assert!((deadline.with_timezone(&Utc) - Utc::now()).num_seconds() >= 590);
    let again = generate_with(&reopened, &date, false, |_| async {
        panic!("cooldown must survive restart");
    })
    .await;
    assert!(again.unwrap_err().contains("冷却"));
    reopened
        .update_recommendations(|state| {
            state.last_attempt_at = Some((Utc::now() - Duration::hours(1)).to_rfc3339());
            state.retry_after = Some((Utc::now() - Duration::seconds(1)).to_rfc3339());
            Ok(())
        })
        .unwrap();
    assert!(
        generate_with(&reopened, &date, false, |_| async { Ok(vec![]) })
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn failed_manual_refresh_preserves_batch_and_local_reads_ignore_cooldown() {
    let (_dir, workspace, date) = workspace();
    let first = generate_with(&workspace, &date, false, |_| async { Ok(vec![]) })
        .await
        .unwrap();
    workspace
        .update_recommendations(|state| {
            state.last_attempt_at = Some((Utc::now() - Duration::minutes(10)).to_rfc3339());
            Ok(())
        })
        .unwrap();
    assert!(generate_with(&workspace, &date, true, |_| async {
        Err("offline".to_string().into())
    })
    .await
    .is_err());
    let cached = generate_with(&workspace, &date, false, |_| async {
        panic!("must serve cache after a failed refresh");
    })
    .await
    .unwrap();
    assert_eq!(
        cached.batches[0].generated_at,
        first.batches[0].generated_at
    );
    assert_eq!(cached.last_error.as_deref(), Some("offline"));
}

#[tokio::test]
async fn legacy_manual_preferences_never_change_tag_queries_or_ranking() {
    let (_dir, workspace, date) = workspace();
    let mut prefs = workspace.read_daily_state().unwrap();
    prefs.state.recommendation_preferences.interests = vec!["robotics".into()];
    prefs.state.recommendation_preferences.exclusions = vec!["diffusion".into()];
    prefs.state.recommendation_preferences.enabled = false;
    workspace
        .save_daily_state(&prefs.revision, prefs.state)
        .unwrap();
    let result = generate_with(&workspace, &date, false, |query| async move {
        assert!(query.contains("diffusion"));
        assert!(!query.contains("robotics"));
        Ok(vec![super::tests::paper("2601.00001", "diffusion")])
    })
    .await
    .unwrap();
    assert_eq!(result.batches[0].interests, vec!["diffusion"]);
    assert_eq!(result.batches[0].papers.len(), 1);
}

#[tokio::test]
async fn missing_recent_tags_does_not_fetch_or_mark_today_completed() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    let date = Utc::now().format("%Y-%m-%d").to_string();
    let result = generate_with(&workspace, &date, false, |_| async {
        panic!("no terms must not reach network");
    })
    .await;
    assert!(result.unwrap_err().starts_with("暂无近期阅读标签"));
    assert!(workspace.read_recommendations().unwrap().batches.is_empty());
}
