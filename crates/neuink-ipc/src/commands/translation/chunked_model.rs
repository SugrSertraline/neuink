use super::*;

impl LlmClient {
    pub(super) async fn translate_chunked_batch(
        &self,
        title: &str,
        context: &TranslationPaperContext,
        batch: &[SourceSegment],
    ) -> Result<HashMap<SegmentUid, String>, String> {
        let budget = translation_budgets(
            self.profile.max_context_length,
            self.profile.max_output_tokens,
        )
        .batch
        .min(self.profile.max_output_tokens.unwrap_or(8192) as usize * 6 / 10 * 19 / 10)
        .min(
            (self.profile.max_context_length.unwrap_or(128_000) as usize).saturating_sub(2048) / 3,
        );
        if budget < 128 {
            return Err(
                "模型上下文或输出预算过小，无法安全翻译片段，请在模型设置中提高上限。".into(),
            );
        }
        if batch.iter().map(|s| source_text(s).len()).sum::<usize>() <= budget {
            return self.translate_raw_batch(title, context, batch).await;
        }
        let mut output = HashMap::new();
        for segment in batch {
            let source = source_text(segment);
            if source.len() <= budget {
                output.extend(
                    self.translate_raw_batch(title, context, std::slice::from_ref(segment))
                        .await?,
                );
                continue;
            }
            if !matches!(
                segment.segment_type,
                SegmentType::Paragraph
                    | SegmentType::Heading
                    | SegmentType::AsideText
                    | SegmentType::PageFootnote
                    | SegmentType::PageHeader
                    | SegmentType::PageFooter
            ) {
                return Err("结构化片段超过模型预算，请提高上下文／输出上限；表格、公式和代码不会按标点拆开。".into());
            }
            let chunks = chunks::split(&source, budget)?;
            let mut translated = Vec::new();
            for (index, chunk) in chunks.iter().enumerate() {
                // Configuration, context and complete source all participate in cache identity.
                // Only the hash is used as a filename; keys and document text are never logged.
                let identity = json!([
                    "segment-chunks-v1",
                    self.profile.id,
                    self.profile.base_url,
                    self.profile.model,
                    self.profile.api_protocol,
                    self.profile.temperature,
                    self.profile.top_p,
                    self.profile.max_context_length,
                    self.profile.max_output_tokens,
                    title,
                    context.summary,
                    context.terminology,
                    segment.uid,
                    source,
                    index,
                    chunk
                ])
                .to_string();
                let key = format!("{}:{}", blake3::hash(source.as_bytes()), blake3::hash(identity.as_bytes()));
                let cached = self
                    .chunk_cache
                    .as_ref()
                    .map(|cache| cache.read(&key))
                    .transpose()?
                    .flatten();
                let text = if let Some(text) = cached {
                    text
                } else {
                    let mut part = segment.clone();
                    part.text = chunk.to_string();
                    part.markdown = None;
                    let mut values = self.translate_raw_batch(title, context, &[part]).await?;
                    let text = values
                        .remove(&segment.uid)
                        .filter(|s| !s.trim().is_empty())
                        .ok_or("模型未返回分块译文，请重试未完成的内容。")?;
                    if let Some(cache) = &self.chunk_cache {
                        cache.write(&key, &text)?;
                    }
                    text
                };
                translated.push(text);
            }
            output.insert(segment.uid.clone(), translated.join("\n"));
        }
        Ok(output)
    }
}
