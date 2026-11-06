use super::settings::{ensure_legacy_profile, read_settings, write_settings};
use neuink_config::{
    AppSettings, LlmProfile, TranslationKind, TranslationRoutingSettings, TranslationSource,
};
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub fn get_translation_routing<R: Runtime>(
    app: AppHandle<R>,
) -> Result<TranslationRoutingSettings, String> {
    let settings = read_settings(&app)?;
    let mut routing = settings.translation_routing.clone();
    if matches!(routing.default_source, TranslationSource::DefaultModel) {
        if let Some(id) = &settings.translation_llm_profile_id {
            routing.default_source = TranslationSource::Profile { profile_id: id.clone() };
        }
    }
    for source in [&mut routing.default_source, &mut routing.word, &mut routing.selection, &mut routing.segment, &mut routing.paragraph, &mut routing.document] {
        if matches!(source, TranslationSource::SelectionService) {
            *source = if settings.selection_translation.provider == neuink_config::SelectionTranslationProvider::ReadingModel {
                TranslationSource::DefaultModel
            } else { TranslationSource::Service { provider: settings.selection_translation.provider } };
        }
    }
    Ok(routing)
}

#[tauri::command]
pub fn save_translation_routing<R: Runtime>(
    app: AppHandle<R>,
    request: TranslationRoutingSettings,
) -> Result<TranslationRoutingSettings, String> {
    let mut settings = read_settings(&app)?;
    ensure_legacy_profile(&mut settings);
    validate(&request, &settings)?;
    settings.translation_routing = request.clone();
    write_settings(&app, &settings)?;
    Ok(request)
}

fn validate(routing: &TranslationRoutingSettings, settings: &AppSettings) -> Result<(), String> {
    for source in std::iter::once(&routing.default_source).chain([
        TranslationKind::Word,
        TranslationKind::Selection,
        TranslationKind::Segment,
        TranslationKind::Paragraph,
        TranslationKind::Document,
    ].into_iter().map(|kind| routing.source(kind))) {
        match source {
            TranslationSource::Profile { profile_id }
                if !settings.llm_profiles.iter().any(|p| p.id == *profile_id) =>
            {
                return Err("所选翻译模型已不存在，请重新选择模型。".into())
            }
            TranslationSource::Service { provider } => {
                let config = super::selection_translation::registry::configured(settings, *provider)?;
                super::selection_translation::validate(&config)?;
            }
            _ => {}
        }
    }
    Ok(())
}

pub(crate) fn resolve_profile(
    settings: &AppSettings,
    kind: TranslationKind,
) -> Result<Option<LlmProfile>, String> {
    let id = match settings.translation_routing.source(kind) {
        TranslationSource::DefaultModel => settings.translation_llm_profile_id.as_deref(),
        TranslationSource::Profile { profile_id } => Some(profile_id.as_str()),
        TranslationSource::SelectionService if settings.selection_translation.provider == neuink_config::SelectionTranslationProvider::ReadingModel => settings.translation_llm_profile_id.as_deref(),
        TranslationSource::SelectionService | TranslationSource::Service { .. } => return Err("此翻译类型应通过专用服务执行。".into()),
    };
    match id {
        None => Ok(None),
        Some(id) => settings
            .llm_profiles
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .map(Some)
            .ok_or_else(|| {
                "此翻译类型指定的模型已删除，请在设置 → 翻译中重新选择；不会自动改用其他模型。"
                    .into()
            }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn settings() -> AppSettings {
        serde_json::from_value(serde_json::json!({
            "translation_llm_profile_id": "default",
            "llm_profiles": [
                {"id":"default","name":"Default","base_url":"http://localhost","model":"fast"},
                {"id":"precise","name":"Precise","base_url":"http://localhost","model":"precise"}
            ]
        }))
        .unwrap()
    }
    #[test]
    fn independent_profile_and_default_are_resolved_without_silent_fallback() {
        let mut settings = settings();
        settings.translation_routing.paragraph = TranslationSource::Profile {
            profile_id: "precise".into(),
        };
        assert_eq!(
            resolve_profile(&settings, TranslationKind::Paragraph)
                .unwrap()
                .unwrap()
                .model,
            "precise"
        );
        assert_eq!(
            resolve_profile(&settings, TranslationKind::Document)
                .unwrap()
                .unwrap()
                .model,
            "fast"
        );
        settings.llm_profiles.retain(|p| p.id != "precise");
        assert!(resolve_profile(&settings, TranslationKind::Paragraph).is_err());
        settings.translation_routing.paragraph = TranslationSource::DefaultModel;
        assert_eq!(
            resolve_profile(&settings, TranslationKind::Paragraph)
                .unwrap()
                .unwrap()
                .model,
            "fast"
        );
    }
    #[test]
    fn services_are_available_for_all_translation_kinds() {
        let settings = settings();
        let mut routing = settings.translation_routing.clone();
    if matches!(routing.default_source, TranslationSource::DefaultModel) {
        if let Some(id) = &settings.translation_llm_profile_id {
            routing.default_source = TranslationSource::Profile { profile_id: id.clone() };
        }
    }
        assert!(validate(&routing, &settings).is_ok());
        routing.document = TranslationSource::SelectionService;
        assert!(validate(&routing, &settings).is_ok());
        routing.document = TranslationSource::Profile {
            profile_id: "missing".into(),
        };
        assert!(validate(&routing, &settings).is_err());
    }
}
