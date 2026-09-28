//! Remote pages live in isolated child WebViews, never in the privileged application WebView.
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, Runtime, WebviewUrl};

const PREFIX: &str = "browser-";
// Concurrent creates must not race the child count or register the same label twice.
static CREATE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
#[derive(Clone, Deserialize)]
pub struct BrowserBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[derive(Deserialize)]
pub struct BrowserRequest {
    id: String,
    action: String,
    url: Option<String>,
    bounds: Option<BrowserBounds>,
    visible: Option<bool>,
}
#[derive(Clone, Serialize)]
struct BrowserEvent {
    id: String,
    url: Option<String>,
    title: Option<String>,
    loading: Option<bool>,
    error: Option<String>,
}

fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
fn remote_url(raw: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(raw).map_err(|_| "网址无效")?;
    let host = url
        .host_str()
        .unwrap_or_default()
        .trim_end_matches('.')
        .to_lowercase();
    if raw.len() > 8192
        || !matches!(url.scheme(), "http" | "https")
        || host.is_empty()
        || !url.username().is_empty()
        || url.password().is_some()
        || host == "localhost"
        || host.ends_with(".localhost")
        || host == "[::1]"
        || host == "0.0.0.0"
        || host.starts_with("127.")
    {
        return Err("仅允许不含账号密码的 HTTP(S) 网址；不允许访问本机应用地址。".into());
    }
    Ok(url)
}
fn publish<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    url: Option<String>,
    title: Option<String>,
    loading: Option<bool>,
    error: Option<String>,
) {
    let _ = app.emit_to(
        "main",
        "neuink:browser-state",
        BrowserEvent {
            id: id.into(),
            url,
            title,
            loading,
            error,
        },
    );
}
fn bounds(value: BrowserBounds) -> Result<tauri::Rect, String> {
    if [value.x, value.y, value.width, value.height]
        .iter()
        .any(|v| !v.is_finite())
        || value.x < 0.0
        || value.y < 0.0
        || value.width < 1.0
        || value.height < 1.0
        || [value.x, value.y, value.width, value.height]
            .iter()
            .any(|v| *v > 30000.0)
    {
        return Err("网页区域尺寸无效".into());
    }
    Ok(tauri::Rect {
        position: tauri::LogicalPosition::new(value.x, value.y).into(),
        size: tauri::LogicalSize::new(value.width, value.height).into(),
    })
}

#[tauri::command]
pub async fn browser_command<R: Runtime>(
    app: tauri::AppHandle<R>,
    webview: tauri::Webview<R>,
    request: BrowserRequest,
) -> Result<(), String> {
    if webview.label() != "main" || !valid_id(&request.id) {
        return Err("网页操作未授权".into());
    }
    let label = format!("{PREFIX}{}", request.id);
    if request.action == "close" {
        if let Some(view) = app.get_webview(&label) {
            view.close().map_err(|_| "关闭网页失败")?;
        }
        return Ok(());
    }
    if request.action == "create" {
        let _creation_guard = CREATE_LOCK.lock().await;
        if app.get_webview(&label).is_some() {
            return Ok(());
        }
        if app
            .webviews()
            .keys()
            .filter(|label| label.starts_with(PREFIX))
            .count()
            >= 8
        {
            return Err("最多同时打开 8 个网页，请先关闭不需要的网页标签。".into());
        }
        let url = remote_url(request.url.as_deref().ok_or("请输入网址")?)?;
        let rect = bounds(request.bounds.ok_or("缺少网页区域")?)?;
        let window = app.get_window("main").ok_or("主窗口不可用")?;
        let nav_app = app.clone();
        let nav_id = request.id.clone();
        let page_app = app.clone();
        let page_id = request.id.clone();
        let title_app = app.clone();
        let title_id = request.id.clone();
        let popup_app = app.clone();
        let popup_id = request.id.clone();
        let download_app = app.clone();
        let download_id = request.id.clone();
        let blank = tauri::Url::parse("about:blank").map_err(|_| "无法初始化空白页")?;
        let builder = tauri::webview::WebviewBuilder::new(&label, WebviewUrl::External(blank))
            .incognito(true)
            .focused(false)
            .use_https_scheme(false)
            .disable_drag_drop_handler()
            .on_navigation(move |url| {
                if url.as_str() == "about:blank" {
                    return true;
                }
                let allowed = remote_url(url.as_str()).is_ok();
                publish(
                    &nav_app,
                    &nav_id,
                    allowed.then(|| url.to_string()),
                    None,
                    Some(allowed),
                    (!allowed).then(|| "已阻止非网页地址或本机应用地址。".into()),
                );
                allowed
            })
            .on_page_load(move |_, payload| {
                if remote_url(payload.url().as_str()).is_ok() {
                    publish(
                        &page_app,
                        &page_id,
                        Some(payload.url().to_string()),
                        None,
                        Some(!matches!(
                            payload.event(),
                            tauri::webview::PageLoadEvent::Finished
                        )),
                        None,
                    );
                }
            })
            .on_document_title_changed(move |_, title| {
                publish(
                    &title_app,
                    &title_id,
                    None,
                    Some(title.chars().take(200).collect()),
                    None,
                    None,
                )
            })
            .on_new_window(move |_, _| {
                publish(
                    &popup_app,
                    &popup_id,
                    None,
                    None,
                    None,
                    Some("网页请求打开新窗口；请复制链接，在新网页标签中打开。".into()),
                );
                tauri::webview::NewWindowResponse::Deny
            })
            .on_download(move |_, _| {
                publish(
                    &download_app,
                    &download_id,
                    None,
                    None,
                    Some(false),
                    Some("内置网页不自动下载文件。论文 PDF 请通过助手的导入确认下载。".into()),
                );
                false
            });
        // Async command avoids the WebView2 synchronous creation deadlock.
        let view = window
            .add_child(builder, rect.position, rect.size)
            .map_err(|_| "创建网页失败，请重试")?;
        if view.hide().is_err() {
            let _ = view.close();
            return Err("初始化网页失败".into());
        }
        let focus_app = app.clone();
        let focus_id = request.id.clone();
        if let Err(error) = super::browser_isolation::isolate(&view, move || {
            let _ = focus_app.emit_to("main", "neuink:browser-focus", &focus_id);
        })
        .await
        {
            let _ = view.close();
            return Err(error);
        }
        if view.hide().is_err() || view.navigate(url).is_err() {
            let _ = view.close();
            return Err("初始化网页失败".into());
        }
        return Ok(());
    }
    let view = app.get_webview(&label).ok_or("网页尚未打开")?;
    let result = match request.action.as_str() {
        "navigate" => view.navigate(remote_url(request.url.as_deref().ok_or("请输入网址")?)?),
        "reload" => view.reload(),
        "back" => view.eval("history.back()"),
        "forward" => view.eval("history.forward()"),
        "stop" => view.eval("window.stop()"),
        "layout" => {
            if request.visible == Some(true) {
                view.set_bounds(bounds(request.bounds.ok_or("缺少网页区域")?)?)
                    .map_err(|_| "调整网页区域失败")?;
                view.show()
            } else {
                view.hide()
            }
        }
        _ => return Err("未知网页操作".into()),
    };
    result.map_err(|_| "网页操作失败，请重试".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn external_pages_cannot_navigate_to_app_or_file_protocols() {
        for url in [
            "file:///C:/a",
            "javascript:alert(1)",
            "data:text/html,a",
            "tauri://localhost",
            "https://tauri.localhost/x",
            "http://127.1:1420",
            "http://[::1]",
            "https://user:secret@example.org",
            "http://localhost.",
        ] {
            assert!(remote_url(url).is_err(), "{url}");
        }
        assert!(remote_url("https://arxiv.org/abs/2603.05085").is_ok());
    }
    #[test]
    fn identities_and_geometry_are_bounded() {
        assert!(valid_id("abc-123"));
        assert!(!valid_id("../main"));
        assert!(!valid_id(""));
        assert!(bounds(BrowserBounds {
            x: 0.0,
            y: 60.0,
            width: 600.0,
            height: 400.0
        })
        .is_ok());
        assert!(bounds(BrowserBounds {
            x: f64::NAN,
            y: 0.0,
            width: 1.0,
            height: 1.0
        })
        .is_err());
    }
}
