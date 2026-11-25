use super::*;

pub(super) fn payload(settings: &Settings, text: &str) -> Value {
    match settings.provider {
        Provider::Azure => json!([{ "Text": text }]),
        Provider::Deepl => json!({ "text": [text], "target_lang": "ZH-HANS" }),
        Provider::QwenMt => {
            json!({ "model": settings.model.trim(), "messages": [{"role":"user", "content":text}],
            "translation_options": {"source_lang":"auto", "target_lang":"Chinese"}, "stream":false })
        }
        Provider::Niutrans => json!({"from":"auto", "to":"zh", "src_text":text}),
        Provider::ReadingModel => Value::Null,
    }
}
pub(super) fn extract(provider: Provider, body: &Value) -> Result<String, String> {
    if provider == Provider::Niutrans && body.get("error_code").is_some() {
        let code = body["error_code"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| body["error_code"].to_string());
        if code != "0" {
            let reason = match code.as_str() {
                "10001" => "请求过于频繁，请稍后重试",
                "10003" => "请求文字过长，请缩小范围",
                "13001" => "额度不足或没有服务权限，请检查账户",
                "13002" => "API Key 无效或未授权，请检查密钥",
                "13003" => "文字未通过服务内容检查",
                "13008" => "请求超时，请重试",
                _ => "请求未成功，请检查 API Key、额度和服务配置",
            };
            // This response may echo apikey and private source text. Never return its raw fields.
            return Err(format!("小牛翻译：{reason}。"));
        }
    }
    if provider == Provider::QwenMt
        && body
            .pointer("/choices/0/finish_reason")
            .and_then(Value::as_str)
            .is_some_and(|v| v != "stop")
    {
        return Err("Qwen-MT 返回的译文不完整，请缩小内容范围后重试。".into());
    }
    let text = match provider {
        Provider::Azure => body.pointer("/0/translations/0/text"),
        Provider::Deepl => body.pointer("/translations/0/text"),
        Provider::QwenMt => body.pointer("/choices/0/message/content"),
        Provider::Niutrans => body.get("tgt_text"),
        Provider::ReadingModel => None,
    }
    .and_then(Value::as_str)
    .unwrap_or_default()
    .trim();
    if text.is_empty() {
        Err("翻译服务未返回译文，请检查服务类型与模型名称".into())
    } else {
        Ok(text.to_string())
    }
}
pub(super) async fn translate(
    settings: &Settings,
    api_key: &str,
    text: &str,
) -> Result<String, String> {
    validate(settings)?;
    let text = text.trim();
    if text.is_empty() || text.chars().count() > 12000 {
        return Err("请选择 1–12000 个字符进行快速翻译".into());
    }
    let mut url = Url::parse(settings.endpoint.trim()).map_err(|_| "翻译地址无效")?;
    if settings.provider == Provider::Azure {
        url.set_query(None);
        url.query_pairs_mut()
            .append_pair("api-version", "3.0")
            .append_pair("to", "zh-Hans");
    }
    let _permit = super::super::translation::service_request_slot().await?;
    if settings.provider == Provider::Niutrans {
        niutrans_slot().await;
    }
    let mut body = payload(settings, text);
    if settings.provider == Provider::Niutrans {
        body["apikey"] = json!(api_key);
    }
    let mut request = client()?.post(url).json(&body);
    request = match settings.provider {
        Provider::Azure => {
            let mut request = request.header("Ocp-Apim-Subscription-Key", api_key);
            if !settings.region.trim().is_empty() {
                request = request.header("Ocp-Apim-Subscription-Region", settings.region.trim());
            }
            request
        }
        Provider::Deepl => request.header("Authorization", format!("DeepL-Auth-Key {api_key}")),
        Provider::QwenMt => request.bearer_auth(api_key),
        Provider::Niutrans => request,
        Provider::ReadingModel => return Err("请使用整体翻译模型进行翻译".into()),
    };
    let mut response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            "翻译服务响应超时（30 秒），请重试或更换服务"
        } else {
            "无法连接翻译服务，请检查地址和网络"
        }
    })?;
    if !response.status().is_success() {
        return Err(format!(
            "翻译服务请求失败（HTTP {}），请检查密钥、额度和请求地址",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "读取翻译结果失败或超时")?
    {
        if bytes.len() + chunk.len() > 512 * 1024 {
            return Err("翻译响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = serde_json::from_slice(&bytes)
        .map_err(|_| "翻译服务返回格式不匹配，请检查服务类型和地址")?;
    extract(settings.provider, &body)
}

async fn niutrans_slot() {
    static LAST: OnceLock<tokio::sync::Mutex<Option<tokio::time::Instant>>> = OnceLock::new();
    let mut last = LAST
        .get_or_init(|| tokio::sync::Mutex::new(None))
        .lock()
        .await;
    if let Some(previous) = *last {
        tokio::time::sleep_until(previous + Duration::from_millis(250)).await;
    }
    *last = Some(tokio::time::Instant::now());
}
