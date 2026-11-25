use super::*;
use neuink_config::AppSettings;

pub(crate) const PROVIDERS: [Provider; 4] = [
    Provider::Niutrans,
    Provider::Deepl,
    Provider::Azure,
    Provider::QwenMt,
];

pub(crate) fn preset(provider: Provider) -> Settings {
    let (endpoint, model) = match provider {
        Provider::Niutrans => ("https://api.niutrans.com/NiuTransServer/translation", ""),
        Provider::Deepl => ("https://api-free.deepl.com/v2/translate", ""),
        Provider::Azure => (
            "https://api.cognitive.microsofttranslator.com/translate",
            "",
        ),
        Provider::QwenMt => (
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            "qwen-mt-flash",
        ),
        Provider::ReadingModel => ("", ""),
    };
    Settings {
        provider,
        endpoint: endpoint.into(),
        model: model.into(),
        region: String::new(),
    }
}

pub(crate) fn configured(app: &AppSettings, provider: Provider) -> Result<Settings, String> {
    if provider == Provider::ReadingModel {
        return Err("请选择专用翻译服务。".into());
    }
    Ok(app
        .translation_services
        .iter()
        .find(|s| s.provider == provider)
        .cloned()
        .or_else(|| {
            (app.selection_translation.provider == provider)
                .then(|| app.selection_translation.clone())
        })
        .unwrap_or_else(|| preset(provider)))
}

pub(super) fn upsert(app: &mut AppSettings, value: Settings) {
    if value.provider == Provider::ReadingModel {
        return;
    }
    if app.selection_translation.provider == value.provider {
        app.selection_translation = value.clone();
    }
    app.translation_services
        .retain(|s| s.provider != value.provider);
    app.translation_services.push(value);
}

#[tauri::command]
pub fn get_translation_services<R: Runtime>(app: AppHandle<R>) -> Result<Vec<State>, String> {
    let settings = read_settings(&app)?;
    PROVIDERS
        .into_iter()
        .map(|p| configured(&settings, p).map(state))
        .collect()
}

#[tauri::command]
pub fn save_translation_service<R: Runtime>(
    app: AppHandle<R>,
    request: Save,
) -> Result<State, String> {
    if request.settings.provider == Provider::ReadingModel {
        return Err("请选择专用翻译服务。".into());
    }
    validate(&request.settings)?;
    let resolved = key(&request.settings, request.api_key.as_deref())?;
    if request
        .api_key
        .as_ref()
        .is_some_and(|v| !v.trim().is_empty())
    {
        if !matches!(
            keyring::default::default_credential_builder().persistence(),
            keyring::credential::CredentialPersistence::UntilDelete
        ) {
            return Err("此构建未启用持久系统凭据库，无法保存翻译密钥".into());
        }
        credential(&request.settings)?
            .set_password(&resolved)
            .map_err(|_| "保存翻译密钥失败")?;
    }
    let mut settings = read_settings(&app)?;
    upsert(&mut settings, request.settings.clone());
    write_settings(&app, &settings)?;
    Ok(state(request.settings))
}

/// No Debug implementation: a running client contains a secret.
#[derive(Clone)]
pub(crate) struct ServiceClient {
    pub(crate) chunk_cache: Option<crate::commands::translation::chunk_cache::ChunkCache>,
    pub(crate) settings: Settings,
    api_key: String,
}

impl ServiceClient {
    /// Translate plain prose together and keep structured syntax local.
    pub(crate) async fn translate_prose(&self, source: &str) -> Result<String, String> {
        // Keep formatting locally instead of relying on a provider to echo markers.
        // Plain prose still uses one request per segment (except long segments).
        if text::parts(source).iter().any(|(part, translate)| !translate && !part.chars().all(char::is_whitespace)) {
            return self.translate(source).await;
        }
        // Plan every request before sending any paid work.
        let chunks = crate::commands::translation::chunks::split(source, 4500)?;
        let mut result = String::new();
        for chunk in &chunks {
            let cache_key = format!("{}:prose-v1:{}:{}", blake3::hash(source.as_bytes()), self.id(), blake3::hash(chunk.as_bytes()));
            let cached = if chunks.len() > 1 { self.chunk_cache.as_ref().map(|cache| cache.read(&cache_key)).transpose()?.flatten() } else { None };
            let value = if let Some(value) = cached { value } else {
                let value = transport::translate(&self.settings, &self.api_key, chunk).await?;
                if chunks.len() > 1 {
                    if let Some(cache) = &self.chunk_cache { cache.write(&cache_key, &value)?; }
                }
                value
            };
            if !result.is_empty() { result.push('\n'); }
            result.push_str(&value);
        }
        Ok(result)
    }
    pub(crate) fn new(settings: Settings) -> Result<Self, String> {
        validate(&settings)?;
        let api_key = key(&settings, None)?;
        Ok(Self { settings, api_key, chunk_cache: None })
    }
    #[cfg(test)]
    pub(crate) fn for_test(settings: Settings) -> Self {
        Self {
            chunk_cache: None,
            settings,
            api_key: "test-key".into(),
        }
    }
    pub(crate) fn id(&self) -> String {
        identity(&self.settings)
    }
    pub(crate) fn label(&self) -> String {
        match self.settings.provider {
            Provider::Niutrans => "小牛翻译".into(),
            Provider::Deepl => "DeepL".into(),
            Provider::Azure => "Azure Translator".into(),
            Provider::QwenMt => format!("Qwen-MT · {}", self.settings.model),
            Provider::ReadingModel => "默认模型".into(),
        }
    }
    pub(crate) async fn translate(&self, source: &str) -> Result<String, String> {
        if source.trim().is_empty() || source.chars().count() > 200_000 {
            return Err("翻译内容为空或超过 200000 字符，请缩小范围。".into());
        }
        // Preserve math/code/links locally: providers need not obey placeholder instructions.
        let mut output = String::new();
        for (part, translate) in text::parts(source) {
            if !translate || !part.chars().any(char::is_alphabetic) {
                output.push_str(part);
                continue;
            }
            for chunk in crate::commands::translation::chunks::split(part, 4500)? {
                if chunk.trim().is_empty() {
                    output.push_str(chunk);
                    continue;
                }
                output.push_str(&chunk[..chunk.len() - chunk.trim_start().len()]);
                let cache_key = format!("{}:service-segment-v2:{}:{}", blake3::hash(source.as_bytes()), self.id(), blake3::hash(chunk.as_bytes()));
                let cached = if source.len() > 4500 { self.chunk_cache.as_ref().map(|cache| cache.read(&cache_key)).transpose()?.flatten() } else { None };
                let translated = if let Some(value) = cached { value } else {
                    let value = transport::translate(&self.settings, &self.api_key, chunk).await?;
                    if source.len() > 4500 {
                        if let Some(cache) = &self.chunk_cache { cache.write(&cache_key, &value)?; }
                    }
                    value
                };
                output.push_str(&translated);
                output.push_str(&chunk[chunk.trim_end().len()..]);
            }
        }
        Ok(output)
    }
}

pub(crate) fn identity(settings: &Settings) -> String {
    // The queue pins non-secret configuration. Changing provider/endpoint/model requires a new task.
    let data = format!(
        "{:?}\n{}\n{}\n{}",
        settings.provider,
        settings.endpoint.trim(),
        settings.model.trim(),
        settings.region.trim()
    );
    format!("service:{}", blake3::hash(data.as_bytes()).to_hex())
}
