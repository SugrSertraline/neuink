use super::*;

pub(super) async fn translate(
    request: TranslateEntrySegmentRequest,
    client: TranslationClient,
) -> Result<EntryTranslationResponse, String> {
    let workspace = Workspace::open(request.root.clone()).map_err(|error| error.to_string())?;
    let client = client.with_checkpoint(workspace.clone(), request.entry_id.clone());
    let (title, segment, context) = {
        let _guard = TRANSLATION_START_LOCK
            .lock()
            .map_err(|error| error.to_string())?;
        let entry = workspace
            .read_entry(&request.entry_id)
            .map_err(|error| error.to_string())?;
        let existing = workspace
            .read_entry_translation(&request.entry_id)
            .map_err(|error| error.to_string())?;
        ensure_idle(existing.as_ref())?;
        let segments = workspace
            .read_segments(&request.entry_id)
            .map_err(|error| error.to_string())?;
        let segment = neuink_domain::find_source_segment(&segments, &request.segment_uid)
            .ok_or_else(|| "Source segment not found.".to_string())?;
        if !should_translate_segment(&segment) {
            return Err("This block is not suitable for translation.".to_string());
        }
        if existing.is_none() {
            let translation = new_translation(
                request.entry_id.clone(),
                request.source_language,
                request.target_language,
                Some(client.label()),
                segments.len(),
            );
            workspace
                .write_entry_translation(&request.entry_id, &translation)
                .map_err(|error| error.to_string())?;
        }
        let context = existing
            .and_then(|translation| translation.paper_context)
            .unwrap_or(TranslationPaperContext {
                summary: String::new(),
                terminology: Vec::new(),
                generated_at: Utc::now(),
            });
        (entry.title, segment, context)
    };
    let translated = client
        .translate_batch(&title, &context, std::slice::from_ref(&segment))
        .await?;
    let saved = save(
        &workspace,
        &request.entry_id,
        translated_segment(&segment, translated.get(&segment.uid)),
    )?;
    client.commit_chunks(&source_text(&segment))?;
    Ok(saved)
}

fn ensure_idle(translation: Option<&EntryTranslation>) -> Result<(), String> {
    if translation.is_some_and(|translation| translation.task.is_some()) {
        return Err(
            "此条目有运行中或已暂停的翻译任务，请先完成或取消任务后再单独翻译片段。".into(),
        );
    }
    Ok(())
}

pub(super) fn save(
    workspace: &Workspace,
    entry_id: &EntryId,
    segment: TranslatedSegment,
) -> Result<EntryTranslationResponse, String> {
    // A full task may start while the independent model request is in flight.
    // Recheck its ownership under the same lock as start/resume/cancel.
    let _guard = TRANSLATION_START_LOCK
        .lock()
        .map_err(|error| error.to_string())?;
    let mut translation = workspace
        .read_entry_translation(entry_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "translation has not been started".to_string())?;
    ensure_idle(Some(&translation))?;
    let current = workspace.read_segments(entry_id).map_err(|error| error.to_string())?;
    let current = neuink_domain::find_source_segment(&current, &segment.segment_uid)
        .ok_or("原片段已删除，未保存过时的翻译结果。")?;
    if source_text(&current) != segment.source_text {
        return Err("原片段已修改，未保存过时的翻译结果，请重新翻译。".into());
    }
    upsert_segments(&mut translation, [segment]);
    translation.status = TranslationStatus::Partial;
    translation.error = None;
    recompute_progress(&mut translation);
    translation.updated_at = Utc::now();
    workspace
        .write_entry_translation(entry_id, &translation)
        .map_err(|error| error.to_string())?;
    Ok(EntryTranslationResponse {
        translation: Some(translation),
    })
}
