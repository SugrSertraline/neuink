//! Privileged DOM overlay rectangles become holes in a browser's original native bounds.
use super::geometry::{bounds, BrowserBounds};
use serde::Deserialize;

const MAX_COORDINATE: f64 = 30000.0;
const MAX_OCCLUSIONS: usize = 8;

#[derive(Clone, Deserialize)]
pub struct Occlusion {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct PixelRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[derive(Debug)]
pub(super) struct ClipPlan {
    pub width: i32,
    pub height: i32,
    pub holes: Vec<PixelRect>,
}

pub(super) fn plan(
    view: &BrowserBounds,
    overlays: &[Occlusion],
    window_scale: f64,
) -> Result<ClipPlan, String> {
    if overlays.len() > MAX_OCCLUSIONS
        || !window_scale.is_finite()
        || !(0.1..=10.0).contains(&window_scale)
    {
        return Err("网页浮层区域无效".into());
    }
    let native = bounds(view.clone())?;
    let position = native.position.to_physical::<i32>(window_scale);
    let size = native.size.to_physical::<u32>(window_scale);
    if size.width > MAX_COORDINATE as u32 || size.height > MAX_COORDINATE as u32 {
        return Err("网页浮层区域无效".into());
    }
    let ratio = view.pixel_ratio.unwrap_or(window_scale);
    let mut holes = Vec::new();
    for overlay in overlays {
        if [overlay.x, overlay.y, overlay.width, overlay.height]
            .iter()
            .any(|value| !value.is_finite() || value.abs() > MAX_COORDINATE)
            || overlay.width < 0.0
            || overlay.height < 0.0
        {
            return Err("网页浮层区域无效".into());
        }
        let left = overlay.x.max(view.x);
        let top = overlay.y.max(view.y);
        let right = (overlay.x + overlay.width).min(view.x + view.width);
        let bottom = (overlay.y + overlay.height).min(view.y + view.height);
        if right <= left || bottom <= top {
            continue;
        }
        // Outward rounding prevents one-pixel native slivers over the DOM controls.
        // Subtract the same rounded physical origin used by the original bounds conversion.
        let rect = PixelRect {
            left: ((left * ratio).floor() as i32 - position.x).clamp(0, size.width as i32),
            top: ((top * ratio).floor() as i32 - position.y).clamp(0, size.height as i32),
            right: ((right * ratio).ceil() as i32 - position.x).clamp(0, size.width as i32),
            bottom: ((bottom * ratio).ceil() as i32 - position.y).clamp(0, size.height as i32),
        };
        if rect.right > rect.left && rect.bottom > rect.top {
            holes.push(rect);
        }
    }
    Ok(ClipPlan {
        width: size.width as i32,
        height: size.height as i32,
        holes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn view(ratio: Option<f64>) -> BrowserBounds {
        BrowserBounds {
            x: 320.0,
            y: 80.0,
            width: 600.0,
            height: 400.0,
            pixel_ratio: ratio,
        }
    }
    fn overlay(x: f64, y: f64, width: f64, height: f64) -> Occlusion {
        Occlusion {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn clipping_keeps_full_native_size_and_scales_ui_and_dpi_exactly_once() {
        for ratio in [1.0, 1.25, 1.5, 1.875] {
            let result = plan(
                &view(Some(ratio)),
                &[overlay(800.0, 360.0, 200.0, 200.0)],
                1.5,
            )
            .unwrap();
            assert_eq!(
                (result.width, result.height),
                ((600.0 * ratio) as i32, (400.0 * ratio) as i32)
            );
            assert_eq!(
                result.holes,
                vec![PixelRect {
                    left: (480.0 * ratio) as i32,
                    top: (280.0 * ratio) as i32,
                    right: (600.0 * ratio) as i32,
                    bottom: (400.0 * ratio) as i32
                }]
            );
        }
    }
    #[test]
    fn empty_and_outside_overlays_restore_the_complete_window_region() {
        for overlays in [
            vec![],
            vec![overlay(-100.0, -100.0, 40.0, 40.0)],
            vec![overlay(400.0, 100.0, 0.0, 4.0)],
        ] {
            assert!(plan(&view(Some(1.0)), &overlays, 1.0)
                .unwrap()
                .holes
                .is_empty());
        }
    }
    #[test]
    fn supports_multiple_overlays_negative_edges_and_full_coverage() {
        let result = plan(
            &view(Some(1.0)),
            &[
                overlay(-10.0, 70.0, 400.0, 40.0),
                overlay(800.0, 400.0, 200.0, 100.0),
            ],
            1.0,
        )
        .unwrap();
        assert_eq!(
            result.holes,
            vec![
                PixelRect {
                    left: 0,
                    top: 0,
                    right: 70,
                    bottom: 30
                },
                PixelRect {
                    left: 480,
                    top: 320,
                    right: 600,
                    bottom: 400
                }
            ]
        );
        assert_eq!(
            plan(&view(Some(1.0)), &[overlay(0.0, 0.0, 2000.0, 1000.0)], 1.0)
                .unwrap()
                .holes,
            vec![PixelRect {
                left: 0,
                top: 0,
                right: 600,
                bottom: 400
            }]
        );
    }
    #[test]
    fn fractional_edges_round_outward_relative_to_actual_native_origin() {
        let mut bounds = view(Some(1.25));
        bounds.x = 320.3;
        let result = plan(&bounds, &[overlay(400.1, 100.1, 10.2, 10.2)], 2.0).unwrap();
        assert_eq!(
            result.holes,
            vec![PixelRect {
                left: 100,
                top: 25,
                right: 113,
                bottom: 38
            }]
        );
        let fallback = plan(&view(None), &[overlay(400.0, 100.0, 10.0, 10.0)], 1.5).unwrap();
        assert_eq!(
            fallback.holes,
            vec![PixelRect {
                left: 120,
                top: 30,
                right: 135,
                bottom: 45
            }]
        );
    }
    #[test]
    fn malformed_or_unbounded_rectangles_are_rejected_before_native_calls() {
        for invalid in [
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
            30001.0,
            -30001.0,
        ] {
            assert!(plan(&view(Some(1.0)), &[overlay(invalid, 80.0, 2.0, 2.0)], 1.0).is_err());
        }
        assert!(plan(&view(Some(1.0)), &[overlay(0.0, 0.0, -1.0, 1.0)], 1.0).is_err());
        assert!(plan(&view(Some(1.0)), &vec![overlay(0.0, 0.0, 1.0, 1.0); 9], 1.0).is_err());
        assert!(plan(&view(Some(1.0)), &[], f64::NAN).is_err());
        assert!(plan(&view(Some(f64::NAN)), &[], 1.0).is_err());
    }
}
