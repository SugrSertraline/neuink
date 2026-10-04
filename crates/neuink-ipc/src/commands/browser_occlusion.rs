//! Window-region clipping of Wry's remote-only child container; never resize or hide the page.
use super::occlusion_geometry::ClipPlan;

#[cfg(windows)]
mod native {
    use super::ClipPlan;
    use tauri::{Manager, Runtime};
    use windows::Win32::{
        Foundation::HWND,
        Graphics::Gdi::{
            CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, HGDIOBJ, HRGN, RGN_DIFF,
            RGN_ERROR,
        },
        UI::WindowsAndMessaging::{
            GetClassNameW, GetClientRect, GetParent, GetWindowLongPtrW, GWL_STYLE, WS_CHILD,
        },
    };

    struct Region(HRGN);
    #[cfg(test)]
    thread_local! { static REGION_RELEASES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }
    impl Region {
        fn rectangle(left: i32, top: i32, right: i32, bottom: i32) -> Result<Self, String> {
            let region = unsafe { CreateRectRgn(left, top, right, bottom) };
            if region.is_invalid() {
                Err("无法创建网页浮层裁剪区域".into())
            } else {
                Ok(Self(region))
            }
        }
        fn transfer(self) {
            std::mem::forget(self);
        }
    }
    impl Drop for Region {
        fn drop(&mut self) {
            unsafe {
                let released = DeleteObject(HGDIOBJ(self.0 .0));
                #[cfg(test)]
                if released.as_bool() {
                    REGION_RELEASES.with(|count| count.set(count.get() + 1));
                }
                let _ = released;
            }
        }
    }

    fn region(plan: &ClipPlan) -> Result<Region, String> {
        let output = Region::rectangle(0, 0, plan.width, plan.height)?;
        for hole in &plan.holes {
            let removed = Region::rectangle(hole.left, hole.top, hole.right, hole.bottom)?;
            if unsafe { CombineRgn(Some(output.0), Some(output.0), Some(removed.0), RGN_DIFF) }
                == RGN_ERROR
            {
                return Err("无法合并网页浮层裁剪区域".into());
            }
        }
        Ok(output)
    }

    fn target_is_remote_container(
        candidate: usize,
        root: usize,
        main: usize,
        parent: usize,
        class: &str,
        style: u32,
    ) -> bool {
        candidate != 0
            && root != 0
            && main != 0
            && candidate != root
            && candidate != main
            && parent == root
            && class == "WRY_WEBVIEW"
            && style & WS_CHILD.0 != 0
    }

    fn install_region(hwnd: HWND, plan: &ClipPlan) -> Result<(), String> {
        if plan.holes.is_empty() {
            if unsafe { SetWindowRgn(hwnd, None, true) } == 0 {
                return Err("无法恢复网页显示区域".into());
            }
            return Ok(());
        }
        let mut actual = windows::Win32::Foundation::RECT::default();
        unsafe { GetClientRect(hwnd, &mut actual) }.map_err(|_| "无法读取网页区域")?;
        if actual.right - actual.left != plan.width || actual.bottom - actual.top != plan.height {
            return Err("网页区域已改变，请重新同步浮层".into());
        }
        let region = region(plan)?;
        if unsafe { SetWindowRgn(hwnd, Some(region.0), true) } == 0 {
            return Err("无法更新网页浮层裁剪区域".into());
        }
        // Windows owns and destroys the region after success, including on window close.
        region.transfer();
        Ok(())
    }

    async fn container<R: Runtime>(view: &tauri::Webview<R>) -> Result<usize, String> {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        view.with_webview(move |platform| {
            if sender.is_closed() {
                return;
            }
            let mut hwnd = HWND::default();
            let result = unsafe { platform.controller().ParentWindow(&mut hwnd) }
                .map(|_| hwnd.0 as usize)
                .map_err(|_| "无法确定网页窗口".to_string());
            let _ = sender.send(result);
        })
        .map_err(|_| "无法访问网页窗口")?;
        tokio::time::timeout(std::time::Duration::from_secs(5), receiver)
            .await
            .map_err(|_| "网页浮层同步超时")?
            .map_err(|_| "网页窗口已关闭")?
    }

    pub(super) async fn apply<R: Runtime>(
        app: &tauri::AppHandle<R>,
        view: &tauri::Webview<R>,
        plan: ClipPlan,
    ) -> Result<(), String> {
        if !view
            .label()
            .strip_prefix(super::super::PREFIX)
            .is_some_and(super::super::valid_id)
            || view.window().label() != "main"
        {
            return Err("网页浮层操作未授权".into());
        }
        let root = app
            .get_window("main")
            .ok_or("主窗口不可用")?
            .hwnd()
            .map_err(|_| "主窗口不可用")?
            .0 as usize;
        let main = container(&app.get_webview("main").ok_or("主网页窗口不可用")?).await?;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        view.with_webview(move |platform| {
            // A cancelled/expired layout must not leave a late region on another document.
            if sender.is_closed() {
                return;
            }
            let mut validated_target = None;
            let result = (|| -> Result<(), String> {
                let mut hwnd = HWND::default();
                unsafe { platform.controller().ParentWindow(&mut hwnd) }
                    .map_err(|_| "无法确定网页窗口")?;
                let parent = unsafe { GetParent(hwnd) }.map_err(|_| "网页子窗口不可用")?;
                let mut class = [0u16; 64];
                let count = unsafe { GetClassNameW(hwnd, &mut class) }.max(0) as usize;
                let class = String::from_utf16_lossy(&class[..count]);
                let style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) } as u32;
                if !target_is_remote_container(
                    hwnd.0 as usize,
                    root,
                    main,
                    parent.0 as usize,
                    &class,
                    style,
                ) {
                    return Err("已阻止裁剪非网页子窗口".into());
                }
                // Wry 0.55 creates a borderless WRY_WEBVIEW container and passes that HWND
                // to CreateCoreWebView2Controller. ParentWindow is NOT the app root HWND.
                validated_target = Some(hwnd);
                let update = install_region(hwnd, &plan);
                if update.is_err() {
                    unsafe {
                        let _ = SetWindowRgn(hwnd, None, true);
                    }
                }
                update
            })();
            if sender.send(result).is_err() {
                if let Some(hwnd) = validated_target {
                    // Cancellation can race the synchronous native update itself.
                    unsafe {
                        let _ = SetWindowRgn(hwnd, None, true);
                    }
                }
            }
        })
        .map_err(|_| "无法同步网页浮层")?;
        tokio::time::timeout(std::time::Duration::from_secs(5), receiver)
            .await
            .map_err(|_| "网页浮层同步超时")?
            .map_err(|_| "网页窗口已关闭")?
    }

    #[cfg(test)]
    mod tests {
        use super::super::super::occlusion_geometry::PixelRect;
        use super::*;
        use windows::Win32::Graphics::Gdi::{GetWindowRgn, PtInRegion};
        use windows::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, WS_POPUP};

        #[test]
        fn main_root_main_webview_and_unowned_windows_are_never_valid_clip_targets() {
            assert!(target_is_remote_container(
                3,
                1,
                2,
                1,
                "WRY_WEBVIEW",
                WS_CHILD.0
            ));
            for target in [0, 1, 2] {
                assert!(!target_is_remote_container(
                    target,
                    1,
                    2,
                    1,
                    "WRY_WEBVIEW",
                    WS_CHILD.0
                ));
            }
            assert!(!target_is_remote_container(
                3,
                1,
                2,
                4,
                "WRY_WEBVIEW",
                WS_CHILD.0
            ));
            assert!(!target_is_remote_container(
                3,
                1,
                2,
                1,
                "Chrome_WidgetWin_0",
                WS_CHILD.0
            ));
            assert!(!target_is_remote_container(3, 1, 2, 1, "WRY_WEBVIEW", 0));
        }
        #[test]
        fn real_gdi_region_excludes_only_overlay_union_without_changing_other_points() {
            let plan = ClipPlan {
                width: 600,
                height: 400,
                holes: vec![
                    PixelRect {
                        left: 400,
                        top: 200,
                        right: 600,
                        bottom: 400,
                    },
                    PixelRect {
                        left: 300,
                        top: 300,
                        right: 500,
                        bottom: 400,
                    },
                ],
            };
            let clipped = region(&plan).unwrap();
            unsafe {
                assert!(PtInRegion(clipped.0, 100, 100).as_bool());
                assert!(!PtInRegion(clipped.0, 450, 250).as_bool());
                assert!(!PtInRegion(clipped.0, 350, 350).as_bool());
                assert!(PtInRegion(clipped.0, 350, 250).as_bool());
                assert!(!PtInRegion(clipped.0, 650, 100).as_bool());
            }
        }

        #[test]
        fn owned_regions_are_freed_after_failure_and_transferred_only_after_success() {
            let owned = Region::rectangle(0, 0, 20, 20).unwrap();
            let raw = owned.0;
            assert_eq!(unsafe { SetWindowRgn(HWND::default(), Some(raw), true) }, 0);
            let before = REGION_RELEASES.with(|count| count.get());
            drop(owned);
            assert_eq!(REGION_RELEASES.with(|count| count.get()), before + 1);
            let mut rect = windows::Win32::Foundation::RECT::default();

            // A hidden, test-owned Win32 window only; never a user/app WebView HWND.
            struct TestWindow(HWND);
            impl Drop for TestWindow {
                fn drop(&mut self) {
                    unsafe {
                        let _ = DestroyWindow(self.0);
                    }
                }
            }
            let window = TestWindow(unsafe {
                CreateWindowExW(
                    Default::default(),
                    windows::core::w!("STATIC"),
                    windows::core::w!("region-test"),
                    WS_POPUP,
                    0,
                    0,
                    200,
                    100,
                    None,
                    None,
                    None,
                    None,
                )
                .unwrap()
            });
            let plan = ClipPlan {
                width: 200,
                height: 100,
                holes: vec![PixelRect {
                    left: 100,
                    top: 50,
                    right: 200,
                    bottom: 100,
                }],
            };
            let before = REGION_RELEASES.with(|count| count.get());
            install_region(window.0, &plan).unwrap();
            // Only the temporary subtraction region was freed; the installed region belongs to Windows.
            assert_eq!(REGION_RELEASES.with(|count| count.get()), before + 1);
            let observed = Region::rectangle(0, 0, 0, 0).unwrap();
            assert_ne!(unsafe { GetWindowRgn(window.0, observed.0) }, RGN_ERROR);
            assert!(unsafe { PtInRegion(observed.0, 10, 10) }.as_bool());
            assert!(!unsafe { PtInRegion(observed.0, 150, 75) }.as_bool());
            install_region(
                window.0,
                &ClipPlan {
                    holes: vec![],
                    ..plan
                },
            )
            .unwrap();
            assert_eq!(unsafe { GetWindowRgn(window.0, observed.0) }, RGN_ERROR);
            unsafe { GetClientRect(window.0, &mut rect) }.unwrap();
            assert_eq!((rect.right, rect.bottom), (200, 100));
        }
    }
}

#[cfg(windows)]
pub(super) async fn apply<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    view: &tauri::Webview<R>,
    plan: ClipPlan,
) -> Result<(), String> {
    native::apply(app, view, plan).await
}

#[cfg(not(windows))]
pub(super) async fn apply<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    _view: &tauri::Webview<R>,
    plan: ClipPlan,
) -> Result<(), String> {
    if plan.holes.is_empty() {
        Ok(())
    } else {
        Err("当前平台尚未支持网页局部浮层裁剪".into())
    }
}
