//! Convert the privileged app's DOM viewport into the native child WebView rectangle.
use serde::Deserialize;

const MAX_COORDINATE: f64 = 30000.0;

#[derive(Clone, Deserialize)]
pub struct BrowserBounds {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) width: f64,
    pub(super) height: f64,
    pub(super) pixel_ratio: Option<f64>,
}

pub(super) fn bounds(value: BrowserBounds) -> Result<tauri::Rect, String> {
    let coordinates = [value.x, value.y, value.width, value.height];
    if coordinates
        .iter()
        .any(|v| !v.is_finite() || *v > MAX_COORDINATE)
        || value.x < 0.0
        || value.y < 0.0
        || value.width < 1.0
        || value.height < 1.0
    {
        return Err("网页区域尺寸无效".into());
    }
    if let Some(ratio) = value.pixel_ratio {
        if !ratio.is_finite() || !(0.1..=10.0).contains(&ratio) {
            return Err("网页区域像素比例无效".into());
        }
        let [x, y, width, height] = coordinates.map(|coordinate| coordinate * ratio);
        if [x, y, width, height]
            .iter()
            .any(|coordinate| *coordinate > MAX_COORDINATE)
        {
            return Err("网页区域尺寸无效".into());
        }
        // Main-WebView devicePixelRatio already includes both its UI zoom and OS
        // DPI. Physical coordinates avoid Wry applying OS scaling a second time.
        // Remote-page zoom is independent and must never enter this conversion.
        return Ok(tauri::Rect {
            position: tauri::PhysicalPosition::new(x.round() as i32, y.round() as i32).into(),
            size: tauri::PhysicalSize::new(
                width.round().max(1.0) as u32,
                height.round().max(1.0) as u32,
            )
            .into(),
        });
    }
    // Requests without the explicit DOM pixel ratio retain their logical-unit contract.
    Ok(tauri::Rect {
        position: tauri::LogicalPosition::new(value.x, value.y).into(),
        size: tauri::LogicalSize::new(value.width, value.height).into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn example(pixel_ratio: Option<f64>) -> BrowserBounds {
        BrowserBounds {
            x: 320.0,
            y: 80.0,
            width: 600.0,
            height: 400.0,
            pixel_ratio,
        }
    }

    #[test]
    fn dom_bounds_apply_combined_ui_zoom_and_os_dpi_exactly_once() {
        for ratio in [1.0, 1.25, 1.5, 1.875] {
            let rect = bounds(example(Some(ratio))).unwrap();
            assert!(matches!(rect.position, tauri::Position::Physical(_)));
            assert!(matches!(rect.size, tauri::Size::Physical(_)));
            // A 150% monitor must not multiply an already physical rectangle again.
            assert_eq!(
                rect.position.to_physical::<i32>(1.5),
                tauri::PhysicalPosition::new((320.0 * ratio) as i32, (80.0 * ratio) as i32)
            );
            assert_eq!(
                rect.size.to_physical::<u32>(1.5),
                tauri::PhysicalSize::new((600.0 * ratio) as u32, (400.0 * ratio) as u32)
            );
        }
    }

    #[test]
    fn omitted_pixel_ratio_preserves_logical_coordinates() {
        let request: BrowserBounds = serde_json::from_value(serde_json::json!({
            "x": 320.0, "y": 80.0, "width": 600.0, "height": 400.0
        }))
        .unwrap();
        let rect = bounds(request).unwrap();
        assert!(matches!(rect.position, tauri::Position::Logical(_)));
        assert!(matches!(rect.size, tauri::Size::Logical(_)));
        assert_eq!(rect.size.to_physical::<u32>(1.5).width, 900);
    }

    #[test]
    fn malformed_pixel_ratios_are_rejected() {
        for ratio in [
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
            -1.0,
            0.0,
            0.099,
            10.001,
        ] {
            assert!(bounds(example(Some(ratio))).is_err(), "ratio {ratio}");
        }
        assert!(bounds(example(Some(0.1))).is_ok());
        assert!(bounds(example(Some(10.0))).is_ok());
    }

    #[test]
    fn malformed_or_excessive_geometry_is_rejected_before_native_calls() {
        for invalid in [f64::NAN, f64::INFINITY, -1.0, 30001.0] {
            let mut value = example(Some(1.25));
            value.x = invalid;
            assert!(bounds(value).is_err());
        }
        let mut value = example(Some(1.0));
        value.width = 0.0;
        assert!(bounds(value).is_err());
        let mut value = example(Some(2.0));
        value.width = 20000.0;
        assert!(bounds(value).is_err());
    }

    #[test]
    fn physical_geometry_rounds_to_pixels_without_zero_sized_views() {
        let mut value = example(Some(0.1));
        value.x = 3.5;
        value.y = 9.5;
        value.width = 1.0;
        value.height = 1.0;
        let rect = bounds(value).unwrap();
        assert_eq!(
            rect.position.to_physical::<i32>(2.0),
            tauri::PhysicalPosition::new(0, 1)
        );
        assert_eq!(
            rect.size.to_physical::<u32>(2.0),
            tauri::PhysicalSize::new(1, 1)
        );
    }
}
