//! Tauri installs the application asset protocol in every child WebView. Remove it BEFORE
//! navigating to remote content; IPC ACLs alone do not protect custom-protocol resources.
#[cfg(windows)]
pub async fn isolate<R: tauri::Runtime>(
    view: &tauri::Webview<R>,
    on_focus: impl Fn() + Send + 'static,
    on_zoom: impl Fn(f64) + Send + 'static,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_22, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
        COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
    };
    use webview2_com::{FocusChangedEventHandler, ZoomFactorChangedEventHandler};
    use windows_core::{Interface, HSTRING};
    let (sender, receiver) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| {
        // COM objects stay on WebView2's owning UI thread and are never retained by the host.
        let result = (|| -> windows_core::Result<()> {
            unsafe {
                let core = platform.controller().CoreWebView2()?;
                for scheme in ["asset", "tauri", "ipc"] {
                    // Must exactly match Wry 0.55's work_around_uri_prefix + '*', not just localhost.
                    let filter = HSTRING::from(format!("http://{scheme}.*"));
                    if let Ok(modern) = core.cast::<ICoreWebView2_22>() {
                        modern.RemoveWebResourceRequestedFilterWithRequestSourceKinds(
                            &filter,
                            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                            COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                        )?;
                    } else {
                        core.RemoveWebResourceRequestedFilter(
                            &filter,
                            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                        )?;
                    }
                }
                // Native child clicks do not bubble through the application's DOM pane.
                // The controller owns this callback and releases it with the child view.
                let mut token = 0;
                platform.controller().add_GotFocus(
                    &FocusChangedEventHandler::create(Box::new(move |_, _| {
                        on_focus();
                        Ok(())
                    })),
                    &mut token,
                )?;
                // Only native controller events are trusted; remote page scripts cannot
                // report a fake zoom value or access the privileged application IPC.
                let mut zoom_token = 0;
                platform.controller().add_ZoomFactorChanged(
                    &ZoomFactorChangedEventHandler::create(Box::new(move |controller, _| {
                        if let Some(controller) = controller {
                            let mut factor = 1.0;
                            controller.ZoomFactor(&mut factor)?;
                            on_zoom(factor);
                        }
                        Ok(())
                    })),
                    &mut zoom_token,
                )?;
                Ok(())
            }
        })();
        let _ = sender.send(result.is_ok());
    })
    .map_err(|_| "无法隔离网页资源")?;
    match tokio::time::timeout(std::time::Duration::from_secs(10), receiver).await {
        Ok(Ok(true)) => Ok(()),
        _ => Err("网页安全隔离失败，已阻止打开外部网站。".into()),
    }
}

#[cfg(not(windows))]
pub async fn isolate<R: tauri::Runtime>(
    _view: &tauri::Webview<R>,
    _on_focus: impl Fn() + Send + 'static,
    _on_zoom: impl Fn(f64) + Send + 'static,
) -> Result<(), String> {
    Err("当前平台尚未完成内置网页安全隔离，请使用外部浏览器。".into())
}
