use super::settings::{ensure_legacy_profile, read_settings, write_settings};
use neuink_config::{
    AppSettings, LlmProfile, TranslationKind, TranslationRoutingSettings, TranslationSource,
};
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub fn get_translation_routing<R: Runtime>(
    app: AppHandle<R>,
) -> Result<TranslationRoutingSettings, String> {
    Ok(read_settings(&app)?.translation_routing)
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
    for kind in [
        TranslationKind::Word,
        TranslationKind::Selection,
        TranslationKind::Segment,
        TranslationKind::Paragraph,
        TranslationKind::Document,
    ] {
        match routing.source(kind) {
            TranslationSource::Profile { profile_id }
                if !settings.llm_profiles.iter().any(|p| p.id == *profile_id) =>
            {
                return Err("所选翻译模型已不存在，请重新选择模型。".into())
            }
            TranslationSource::SelectionService
                if !matches!(kind, TranslationKind::Word | TranslationKind::Selection) =>
            {
                return Err("专用选区服务仅适用于单词和选中文字；结构化翻译需要模型。".into())
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
        TranslationSource::SelectionService => return Err("此翻译类型应通过选区服务执行。".into()),
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

pub(crate) fn read_profile<R: Runtime>(
    app: &AppHandle<R>,
    kind: TranslationKind,
) -> Result<Option<LlmProfile>, String> {
    let mut settings = read_settings(app)?;
    ensure_legacy_profile(&mut settings);
    resolve_profile(&settings, kind)
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
    fn structured_translation_cannot_select_a_plain_text_service() {
        let settings = settings();
        let mut routing = settings.translation_routing.clone();
        assert!(validate(&routing, &settings).is_ok());
        routing.document = TranslationSource::SelectionService;
        assert!(validate(&routing, &settings).is_err());
        routing.document = TranslationSource::Profile {
            profile_id: "missing".into(),
        };
        assert!(validate(&routing, &settings).is_err());
    }
}
