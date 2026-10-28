//! Opt-in integration smoke test. Sends synthetic text only and stores results
//! in a temporary workspace, never in the user's library.
use super::*;

pub(super) fn selected_profile() -> LlmProfile {
    let path = std::env::var("NEUINK_LIVE_SETTINGS").expect("set NEUINK_LIVE_SETTINGS explicitly");
    let bytes = std::fs::read(path).expect("cannot read settings");
    let settings: Value = serde_json::from_slice(&bytes).expect("invalid settings JSON");
    let id = settings["translation_llm_profile_id"]
        .as_str()
        .expect("select a task model");
    let profile = settings["llm_profiles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|profile| profile["id"].as_str() == Some(id))
        .expect("task model missing");
    serde_json::from_value(profile.clone()).expect("invalid task model profile")
}

fn checked<T>(result: Result<T, String>) -> T {
    result.unwrap_or_else(|error| {
        // Never print a provider response that could echo credentials or text.
        let category = if error.contains("LLM_TRANSLATION_") {
            "model output rejected"
        } else if error.contains("LLM request failed") {
            "HTTP failure"
        } else if error.contains("request") {
            "transport failure"
        } else {
            "translation validation failure"
        };
        panic!("live translation failed: {category} (response omitted)");
    })
}

#[tokio::test]
#[ignore = "requires NEUINK_LIVE_SETTINGS; sends synthetic single and batch requests"]
async fn live_selected_model_single_and_batch_translation() {
    let profile = selected_profile();
    let temp = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(temp.path()).unwrap();
    let entry = workspace
        .create_entry("Translation integration test")
        .unwrap();
    let segments = vec![
        SourceSegment::new(SegmentType::Paragraph, 0, None, "The model predicts traffic flow using historical observations. The loss is $L = x^2$.".into()),
        SourceSegment::new(SegmentType::Heading, 0, None, "## Experimental Results".into()),
        SourceSegment::new(SegmentType::Table, 1, None, "<table><tr><th>Method</th><th>Error</th></tr><tr><td>Baseline</td><td>3.5</td></tr></table>".into()),
    ];
    workspace.write_segments(&entry.id, &segments).unwrap();
    let single = checked(
        single_segment::translate(
            TranslateEntrySegmentRequest {
                root: temp.path().into(),
                entry_id: entry.id.clone(),
                segment_uid: segments[0].uid.clone(),
                source_language: "en".into(),
                target_language: "zh-CN".into(),
            },
            profile.clone(),
        )
        .await,
    );
    let translation = single.translation.unwrap();
    assert_eq!(translation.progress.translated, 1);
    let first = translation.segments[0].translated_text.as_ref().unwrap();
    assert!(first.contains("$L = x^2$"));
    assert!(first
        .chars()
        .any(|ch| ('\u{4e00}'..='\u{9fff}').contains(&ch)));

    let context = TranslationPaperContext {
        summary: "A synthetic traffic forecasting experiment.".into(),
        terminology: vec![],
        generated_at: Utc::now(),
    };
    let mut completed = Vec::new();
    checked(
        LlmClient::new(profile)
            .translate_batch_recovering(
                "Translation integration test",
                &context,
                segments.clone(),
                &TranslationTaskControl::default(),
                |batch| {
                    completed.extend(batch);
                    Ok(())
                },
            )
            .await,
    );
    assert_eq!(completed.len(), segments.len());
    for segment in completed {
        assert!(
            matches!(segment.status, TranslatedSegmentStatus::Translated),
            "batch segment did not complete (provider detail omitted)"
        );
        assert!(segment
            .translated_text
            .as_ref()
            .is_some_and(|text| !text.trim().is_empty()));
        checked(single_segment::save(&workspace, &entry.id, segment));
    }
    let reopened = Workspace::open(temp.path())
        .unwrap()
        .read_entry_translation(&entry.id)
        .unwrap()
        .unwrap();
    assert_eq!(reopened.progress.translated, segments.len());
    assert_eq!(reopened.progress.failed, 0);
}
