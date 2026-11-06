//! A translation task pins a model or dedicated service; neither silently falls back.
use super::*;
use crate::commands::{
    selection_translation::registry::{self, ServiceClient},
    settings,
};
use neuink_config::{
    AppSettings, SelectionTranslationProvider, TranslationKind, TranslationSource,
};

#[derive(Clone)]
pub(super) enum TranslationClient {
    Model(LlmClient),
    Service(ServiceClient),
}

impl From<LlmProfile> for TranslationClient {
    fn from(profile: LlmProfile) -> Self {
        Self::Model(LlmClient::new(profile))
    }
}

impl TranslationClient {
    pub(super) fn commit_chunks(&self, source: &str) -> Result<(), String> {
        let cache = match self { Self::Model(client) => &client.chunk_cache, Self::Service(client) => &client.chunk_cache };
        if let Some(cache) = cache { cache.committed(source)?; }
        Ok(())
    }
    pub(super) fn with_checkpoint(mut self, workspace: Workspace, entry: EntryId) -> Self {
        let cache = Some(chunk_cache::ChunkCache::new(workspace, entry));
        match &mut self {
            Self::Model(client) => client.chunk_cache = cache,
            Self::Service(client) => client.chunk_cache = cache,
        }
        self
    }
    pub(super) fn read<R: Runtime>(
        app: &AppHandle<R>,
        kind: TranslationKind,
    ) -> Result<Self, String> {
        let mut settings = settings::read_settings(app)?;
        settings::ensure_legacy_profile(&mut settings);
        Self::resolve(&settings, kind)
    }
    fn resolve(settings: &AppSettings, kind: TranslationKind) -> Result<Self, String> {
        let provider = match settings.translation_routing.source(kind) {
            TranslationSource::Service { provider } => Some(*provider),
            TranslationSource::SelectionService
                if settings.selection_translation.provider
                    != SelectionTranslationProvider::ReadingModel =>
            {
                Some(settings.selection_translation.provider)
            }
            _ => None,
        };
        if let Some(provider) = provider {
            return ServiceClient::new(registry::configured(settings, provider)?)
                .map(Self::Service);
        }
        crate::commands::translation_routing::resolve_profile(settings, kind)?
            .map(Self::from)
            .ok_or_else(|| "请在设置 → 翻译中配置翻译服务或默认翻译模型。".into())
    }
    pub(super) fn resume(
        settings: &AppSettings,
        id: &str,
        label: Option<&str>,
    ) -> Result<Self, String> {
        if id.starts_with("service:") {
            let config = registry::PROVIDERS
                .into_iter()
                .filter_map(|p| registry::configured(settings, p).ok())
                .find(|s| registry::identity(s) == id)
                .ok_or("此任务使用的翻译服务配置已更改，请恢复配置，或取消任务后重新翻译。")?;
            return ServiceClient::new(config).map(Self::Service);
        }
        let profile = settings
            .llm_profiles
            .iter()
            .find(|p| p.id == id)
            .ok_or("此任务使用的模型配置已删除，请恢复配置，或取消任务后重新翻译。")?;
        if label != Some(profile.model.as_str()) {
            return Err("此任务使用的模型已更改，请恢复配置，或取消任务后重新翻译。".into());
        }
        Ok(profile.clone().into())
    }
    pub(super) fn id(&self) -> String {
        match self {
            Self::Model(v) => v.profile.id.clone(),
            Self::Service(v) => v.id(),
        }
    }
    pub(super) fn label(&self) -> String {
        match self {
            Self::Model(v) => v.profile.model.clone(),
            Self::Service(v) => v.label(),
        }
    }
    pub(super) fn llm(&self) -> Result<&LlmClient, String> {
        match self {
            Self::Model(v) => Ok(v),
            _ => Err("专用翻译服务不执行模型提示词。".into()),
        }
    }
    pub(super) fn is_service(&self) -> bool {
        matches!(self, Self::Service(_))
    }
    pub(super) fn batch_budget(&self) -> usize {
        match self {
            Self::Model(v) => {
                translation_budgets(v.profile.max_context_length, v.profile.max_output_tokens).batch
            }
            Self::Service(_) => 4500,
        }
    }
    pub(super) fn with_progress(self, progress: TranslationProgressSink) -> Self {
        match self {
            Self::Model(v) => Self::Model(v.with_progress(progress)),
            v => v,
        }
    }
    pub(super) async fn translate_batch(
        &self,
        title: &str,
        context: &TranslationPaperContext,
        batch: &[SourceSegment],
    ) -> Result<HashMap<SegmentUid, String>, String> {
        match self {
            Self::Model(client) => client.translate_batch(title, context, batch).await,
            Self::Service(client) => {
                let mut output = HashMap::new();
                for segment in batch {
                    let text = source_text(segment);
                    let translated =
                        if matches!(segment.segment_type, SegmentType::Math | SegmentType::Code) {
                            text
                        } else if matches!(segment.segment_type, SegmentType::Paragraph | SegmentType::Heading | SegmentType::AsideText | SegmentType::PageFootnote | SegmentType::PageHeader | SegmentType::PageFooter) {
                            client.translate_prose(&text).await?
                        } else {
                            client.translate(&text).await?
                        };
                    output.insert(segment.uid.clone(), translated);
                }
                Ok(output)
            }
        }
    }
    pub(super) async fn translate_batch_recovering(
        &self,
        title: &str,
        context: &TranslationPaperContext,
        batch: Vec<SourceSegment>,
        control: &TranslationTaskControl,
        mut persist: impl FnMut(Vec<TranslatedSegment>) -> Result<(), String>,
    ) -> Result<(), String> {
        let mut persist = |segments: Vec<TranslatedSegment>| {
            let completed = segments.iter().filter(|s| matches!(s.status, TranslatedSegmentStatus::Translated))
                .map(|s| s.source_text.clone()).collect::<Vec<_>>();
            persist(segments)?;
            for source in completed { self.commit_chunks(&source)?; }
            Ok(())
        };
        if let Self::Model(client) = self {
            return client
                .translate_batch_recovering(title, context, batch, control, persist)
                .await;
        }
        for segment in batch {
            if control.pause_requested() {
                break;
            }
            // Commit each segment before issuing another paid request. The outer task
            // drops this future on pause/cancel, releasing all service scheduler slots.
            match self
                .translate_batch(title, context, std::slice::from_ref(&segment))
                .await
            {
                Ok(values) => {
                    persist(vec![translated_segment(&segment, values.get(&segment.uid))])?
                }
                Err(error) => {
                    persist(vec![failed_segment(&segment, &error)])?;
                    // Provider failures belong to this fragment; the user can retry it
                    // after the remaining fragments finish. Persistence errors still propagate.
                }
            }
        }
        Ok(())
    }
}
