//! Remote pages live in isolated child WebViews, never in the privileged application WebView.
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, Runtime, WebviewUrl};

#[path = "browser_bounds.rs"]
mod geometry;
#[path = "browser_media.rs"]
mod media;
#[path = "browser_occlusion.rs"]
mod occlusion;
#[path = "browser_occlusion_geometry.rs"]
mod occlusion_geometry;
#[path = "browser_popup.rs"]
mod popup;
#[path = "browser_read.rs"]
mod read;
#[path = "browser_snapshot.rs"]
mod snapshot;
#[path = "browser_zoom.rs"]
mod zoom;
use geometry::bounds;
pub use geometry::BrowserBounds;
pub use read::ReadBrowserRequest;
pub use snapshot::BrowserSnapshot;

const PREFIX: &str = "browser-";
// Concurrent creates must not race the child count or register the same label twice.
static CREATE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
#[derive(Deserialize)]
pub struct BrowserRequest {
    id: String,
    action: String,
    url: Option<String>,
    bounds: Option<BrowserBounds>,
    visible: Option<bool>,
    zoom: Option<f64>,
    occlusions: Option<Vec<occlusion_geometry::Occlusion>>,
}
#[derive(Clone, Serialize)]
struct BrowserEvent {
    id: String,
    navigation_id: Option<String>,
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
            navigation_id: read::navigation_id(id),
            url,
            title,
            loading,
            error,
        },
    );
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
        read::forget(&request.id)?;
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
        let popup_requests = popup::PopupRequests::default();
        let download_app = app.clone();
        let download_id = request.id.clone();
        let read_state = read::TabReadState::new();
        let nav_read_state = read_state.clone();
        let page_read_state = read_state.clone();
        let blank = tauri::Url::parse("about:blank").map_err(|_| "无法初始化空白页")?;
        let builder = tauri::webview::WebviewBuilder::new(&label, WebviewUrl::External(blank))
            .incognito(true)
            .focused(false)
            .use_https_scheme(false)
            .disable_drag_drop_handler()
            .zoom_hotkeys_enabled(true)
            .on_navigation(move |url| {
                if url.as_str() == "about:blank" {
                    return true;
                }
                let allowed = remote_url(url.as_str()).is_ok();
                if allowed {
                    nav_read_state.navigate();
                }
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
                    if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                        page_read_state.finish();
                    } else {
                        page_read_state.navigate();
                    }
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
            .on_new_window(move |url, _features| {
                popup::forward_new_window(
                    &popup_requests,
                    &popup_id,
                    url.as_str(),
                    |event| {
                        popup_app
                            .emit_to("main", "neuink:browser-open-tab", event)
                            .map_err(|_| "无法打开新网页标签，请重试。".into())
                    },
                    |error| publish(&popup_app, &popup_id, None, None, None, Some(error)),
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
        let zoom_app = app.clone();
        let zoom_id = request.id.clone();
        if let Err(error) = super::browser_isolation::isolate(
            &view,
            move || {
                let _ = focus_app.emit_to("main", "neuink:browser-focus", &focus_id);
            },
            move |factor| {
                let _ = zoom::publish(&zoom_app, &zoom_id, factor);
            },
        )
        .await
        {
            let _ = view.close();
            return Err(error);
        }
        read::remember(&request.id, read_state)?;
        if view.hide().is_err() || view.navigate(url).is_err() {
            let _ = read::forget(&request.id);
            let _ = view.close();
            return Err("初始化网页失败".into());
        }
        return Ok(());
    }
    let view = app.get_webview(&label).ok_or("网页尚未打开")?;
    if request.action == "zoom" {
        let factor = zoom::validate(request.zoom)?;
        return zoom::apply(&view, app, request.id, factor).await;
    }
    let result = match request.action.as_str() {
        "navigate" => view.navigate(remote_url(request.url.as_deref().ok_or("请输入网址")?)?),
        "reload" => view.reload(),
        "back" => view.eval("history.back()"),
        "forward" => view.eval("history.forward()"),
        "stop" => view.eval("window.stop()"),
        "layout" => {
            if request.visible == Some(true) {
                let requested = request.bounds.ok_or("缺少网页区域")?;
                let scale = view
                    .window()
                    .scale_factor()
                    .map_err(|_| "无法读取网页区域比例")?;
                let plan = occlusion_geometry::plan(
                    &requested,
                    request.occlusions.as_deref().unwrap_or_default(),
                    scale,
                )?;
                view.set_bounds(bounds(requested)?)
                    .map_err(|_| "调整网页区域失败")?;
                occlusion::apply(&app, &view, plan).await?;
                view.show()
            } else {
                view.hide()
            }
        }
        _ => return Err("未知网页操作".into()),
    };
    result.map_err(|_| "网页操作失败，请重试".into())
}

#[tauri::command]
pub async fn read_browser_tab<R: Runtime>(
    app: tauri::AppHandle<R>,
    webview: tauri::Webview<R>,
    request: ReadBrowserRequest,
) -> Result<BrowserSnapshot, String> {
    read::capture(&app, &webview, request).await
}

#[tauri::command]
pub fn cancel_browser_read<R: Runtime>(
    app: tauri::AppHandle<R>,
    webview: tauri::Webview<R>,
    call_id: String,
) -> Result<(), String> {
    read::cancel(&app, &webview, &call_id)
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
    fn identities_are_bounded() {
        assert!(valid_id("abc-123"));
        assert!(!valid_id("../main"));
        assert!(!valid_id(""));
    }
}
