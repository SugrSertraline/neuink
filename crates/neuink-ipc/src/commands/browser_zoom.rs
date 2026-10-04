//! Zoom changes do not navigate, reload, or invalidate the assistant's document identity.
use serde::Serialize;
use tauri::{Emitter, Runtime};

const MIN_ZOOM: f64 = 0.5;
const MAX_ZOOM: f64 = 3.0;

#[derive(Serialize, Clone)]
struct BrowserZoomEvent<'a> {
    id: &'a str,
    zoom: f64,
}

pub(super) fn validate(value: Option<f64>) -> Result<f64, String> {
    value
        .filter(|value| value.is_finite() && (MIN_ZOOM..=MAX_ZOOM).contains(value))
        .ok_or_else(|| "网页缩放比例必须在 50% 到 300% 之间。".into())
}

pub(super) fn publish<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    factor: f64,
) -> Result<(), String> {
    // WebView2's own keyboard/wheel range may exceed the toolbar presets. Report
    // the actual positive factor instead of claiming a clamped, inaccurate value.
    if !factor.is_finite() || factor <= 0.0 {
        return Err("无法读取网页缩放比例".into());
    }
    app.emit_to(
        "main",
        "neuink:browser-zoom",
        BrowserZoomEvent { id, zoom: factor },
    )
    .map_err(|_| "无法更新网页缩放状态".into())
}

#[cfg(windows)]
pub(super) async fn apply<R: Runtime>(
    view: &tauri::Webview<R>,
    app: tauri::AppHandle<R>,
    id: String,
    factor: f64,
) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| {
        // This is the same native operation used by Tauri/Wry set_zoom. Performing
        // it here lets us acknowledge the actual value, including unchanged/reset
        // requests for which WebView2 may not emit ZoomFactorChanged.
        let result = (|| -> Result<(), String> {
            let mut actual = factor;
            unsafe {
                let controller = platform.controller();
                controller
                    .SetZoomFactor(factor)
                    .map_err(|_| "调整网页缩放失败")?;
                controller
                    .ZoomFactor(&mut actual)
                    .map_err(|_| "无法读取网页缩放比例")?;
            }
            publish(&app, &id, actual)
        })();
        let _ = sender.send(result);
    })
    .map_err(|_| "调整网页缩放失败")?;
    match tokio::time::timeout(std::time::Duration::from_secs(10), receiver).await {
        Ok(Ok(result)) => result,
        _ => Err("调整网页缩放超时，请重试。".into()),
    }
}

#[cfg(not(windows))]
pub(super) async fn apply<R: Runtime>(
    _view: &tauri::Webview<R>,
    _app: tauri::AppHandle<R>,
    _id: String,
    _factor: f64,
) -> Result<(), String> {
    Err("当前平台尚未支持内置网页缩放。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toolbar_zoom_accepts_boundaries_and_non_preset_factors() {
        for factor in [0.5, 0.67, 1.0, 1.2345, 3.0] {
            assert_eq!(validate(Some(factor)), Ok(factor));
        }
    }

    #[test]
    fn toolbar_zoom_rejects_missing_non_finite_and_out_of_range_values() {
        for factor in [
            None,
            Some(f64::NAN),
            Some(f64::INFINITY),
            Some(f64::NEG_INFINITY),
            Some(0.0),
            Some(-1.0),
            Some(0.4999),
            Some(3.0001),
        ] {
            assert!(validate(factor).is_err());
        }
    }

    #[test]
    fn native_zoom_event_has_no_navigation_fields_or_clamping() {
        let event = BrowserZoomEvent {
            id: "paper-browser",
            zoom: 4.0,
        };
        let encoded = serde_json::to_value(event).unwrap();
        assert_eq!(
            encoded,
            serde_json::json!({ "id": "paper-browser", "zoom": 4.0 })
        );
    }
}
