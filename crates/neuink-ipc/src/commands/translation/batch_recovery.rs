use super::*;

impl LlmClient {
    pub(super) async fn translate_batch_recovering(
        &self,
        entry_title: &str,
        context: &TranslationPaperContext,
        batch: Vec<SourceSegment>,
        control: &TranslationTaskControl,
        mut persist: impl FnMut(Vec<TranslatedSegment>) -> Result<(), String>,
    ) -> Result<(), String> {
        let mut pending = vec![(batch, false)];
        let mut requests = 0usize;
        while let Some((segments, individual_retry)) = pending.pop() {
            if control.pause_requested() {
                break;
            }
            let mut completed = Vec::new();
            if requests >= MAX_BATCH_RECOVERY_REQUESTS {
                completed.extend(segments.iter().map(|segment| {
                    failed_segment(segment, "单项自动重试已达上限，请在翻译任务中重试失败项")
                }));
            } else {
                requests += 1;
                match self.translate_batch(entry_title, context, &segments).await {
                    Ok(translated) => {
                        let mut missing = Vec::new();
                        for segment in segments {
                            if translated
                                .get(&segment.uid)
                                .is_some_and(|text| !text.trim().is_empty())
                            {
                                completed.push(translated_segment(
                                    &segment,
                                    translated.get(&segment.uid),
                                ));
                            } else {
                                missing.push(segment);
                            }
                        }
                        retry_individually_or_fail(
                            missing,
                            "模型未返回该片段的有效译文",
                            individual_retry,
                            &mut pending,
                            &mut completed,
                        );
                    }
                    Err(error) => {
                        if should_retry_individually(&error) {
                            retry_individually_or_fail(
                                segments,
                                &format!("翻译模型调用失败：{error}"),
                                individual_retry,
                                &mut pending,
                                &mut completed,
                            );
                        } else {
                            completed.extend(segments.iter().map(|segment| {
                                failed_segment(segment, &format!("翻译模型调用失败：{error}"))
                            }));
                        }
                    }
                }
            }
            // Stop drops this future at the next await. Commit every completed
            // response before issuing another request so paid work survives it.
            if !completed.is_empty() {
                persist(completed)?;
            }
        }
        Ok(())
    }
}
