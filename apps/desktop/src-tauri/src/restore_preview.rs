//! Keeps the last visible frame over WebView2 while Windows restores its surface.
//! WebView2 can expose an empty parent surface for a few frames after minimize.

use std::ffi::c_void;
use std::io::Write;
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use tauri::WebviewWindow;

type Handle = *mut c_void;
type SubclassProc = unsafe extern "system" fn(Handle, u32, usize, isize, usize, usize) -> isize;

#[repr(C)]
#[derive(Default)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[repr(C)]
#[derive(Default)]
struct Point {
    x: i32,
    y: i32,
}

#[repr(C)]
#[derive(Default)]
struct BitmapInfoHeader {
    size: u32,
    width: i32,
    height: i32,
    planes: u16,
    bit_count: u16,
    compression: u32,
    size_image: u32,
    x_pels_per_meter: i32,
    y_pels_per_meter: i32,
    colors_used: u32,
    colors_important: u32,
}

#[repr(C)]
#[derive(Default)]
struct BitmapInfo {
    header: BitmapInfoHeader,
    first_color: u32,
}

fn bitmap_info(width: i32, height: i32) -> BitmapInfo {
    BitmapInfo {
        header: BitmapInfoHeader {
            size: std::mem::size_of::<BitmapInfoHeader>() as u32,
            width,
            height: -height,
            planes: 1,
            bit_count: 32,
            ..Default::default()
        },
        ..Default::default()
    }
}

fn pixel_count(width: i32, height: i32) -> Option<usize> {
    if !(100..=10000).contains(&width) || !(100..=10000).contains(&height) {
        return None;
    }
    (width as usize)
        .checked_mul(height as usize)?
        .checked_mul(4)
}

#[link(name = "user32")]
unsafe extern "system" {
    fn CreateWindowExW(
        ex_style: u32,
        class: *const u16,
        title: *const u16,
        style: u32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        parent: Handle,
        menu: Handle,
        instance: Handle,
        param: Handle,
    ) -> Handle;
    fn DestroyWindow(window: Handle) -> i32;
    fn GetClientRect(window: Handle, rect: *mut Rect) -> i32;
    fn ClientToScreen(window: Handle, point: *mut Point) -> i32;
    fn FindWindowExW(parent: Handle, after: Handle, class: *const u16, title: *const u16)
        -> Handle;
    fn GetDC(window: Handle) -> Handle;
    fn PrintWindow(window: Handle, dc: Handle, flags: u32) -> i32;
    fn ReleaseDC(window: Handle, dc: Handle) -> i32;
    fn SendMessageW(window: Handle, message: u32, wparam: usize, lparam: isize) -> isize;
    fn SetWindowPos(
        window: Handle,
        after: Handle,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        flags: u32,
    ) -> i32;
    fn ShowWindow(window: Handle, command: i32) -> i32;
    fn IsIconic(window: Handle) -> i32;
    fn SetTimer(window: Handle, id: usize, delay: u32, callback: Handle) -> usize;
    fn KillTimer(window: Handle, id: usize) -> i32;
    fn PostMessageW(window: Handle, message: u32, wparam: usize, lparam: isize) -> i32;
    fn SetProcessDpiAwarenessContext(value: Handle) -> i32;
}

#[link(name = "gdi32")]
unsafe extern "system" {
    fn CreateCompatibleDC(dc: Handle) -> Handle;
    fn CreateCompatibleBitmap(dc: Handle, width: i32, height: i32) -> Handle;
    fn DeleteDC(dc: Handle) -> i32;
    fn SelectObject(dc: Handle, object: Handle) -> Handle;
    fn DeleteObject(object: Handle) -> i32;
    fn GetDIBits(
        dc: Handle,
        bitmap: Handle,
        start_scan: u32,
        scan_lines: u32,
        bits: *mut c_void,
        info: *mut BitmapInfo,
        usage: u32,
    ) -> i32;
    fn CreateDIBSection(
        dc: Handle,
        info: *const BitmapInfo,
        usage: u32,
        bits: *mut Handle,
        section: Handle,
        offset: u32,
    ) -> Handle;
}

#[link(name = "comctl32")]
unsafe extern "system" {
    fn SetWindowSubclass(window: Handle, proc: SubclassProc, id: usize, data: usize) -> i32;
    fn RemoveWindowSubclass(window: Handle, proc: SubclassProc, id: usize) -> i32;
    fn DefSubclassProc(window: Handle, message: u32, wparam: usize, lparam: isize) -> isize;
}

#[link(name = "dwmapi")]
unsafe extern "system" {
    fn DwmSetWindowAttribute(
        window: Handle,
        attribute: u32,
        value: *const c_void,
        size: u32,
    ) -> i32;
}

const SUBCLASS_ID: usize = 0x4e49;
const TIMER_ID: usize = 0x4e49;
const WM_SIZE: u32 = 0x0005;
const WM_TIMER: u32 = 0x0113;
const WM_SYSCOMMAND: u32 = 0x0112;
const WM_NCDESTROY: u32 = 0x0082;
const WM_PREVIEW_MINIMIZE: u32 = 0x8000 + 0x49;
const SIZE_MINIMIZED: usize = 1;
const SC_MINIMIZE: usize = 0xf020;
const STM_SETIMAGE: u32 = 0x0172;
const WS_POPUP: u32 = 0x8000_0000;
const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
const WS_EX_NOACTIVATE: u32 = 0x0800_0000;
const SS_BITMAP: u32 = 0x000e;
const SW_HIDE: i32 = 0;
const SWP_NOACTIVATE: u32 = 0x0010;
const SWP_SHOWWINDOW: u32 = 0x0040;
const HWND_TOPMOST: Handle = -1isize as Handle;
const HWND_NOTOPMOST: Handle = -2isize as Handle;
const PW_RENDERFULLCONTENT: u32 = 0x0002;
const DWMWA_TRANSITIONS_FORCEDISABLED: u32 = 3;

#[derive(Default)]
struct Preview {
    window: usize,
    overlay: usize,
    bitmap: usize,
    minimized: bool,
    pending_minimize: bool,
}

static PREVIEW: OnceLock<Mutex<Preview>> = OnceLock::new();

fn preview() -> &'static Mutex<Preview> {
    PREVIEW.get_or_init(|| Mutex::new(Preview::default()))
}

fn lock_preview() -> std::sync::MutexGuard<'static, Preview> {
    preview()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
    let hwnd = window.hwnd()?.0 as Handle;
    let static_class: Vec<u16> = "STATIC\0".encode_utf16().collect();
    let mut rect = Rect::default();
    // WebView2's compositor paints above child HWNDs. An owned popup covers it.
    unsafe {
        if GetClientRect(hwnd, &mut rect) == 0 {
            return Ok(());
        }
        let overlay = CreateWindowExW(
            WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            static_class.as_ptr(),
            std::ptr::null(),
            WS_POPUP | SS_BITMAP,
            0,
            0,
            rect.right,
            rect.bottom,
            hwnd,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        );
        if overlay.is_null() {
            return Ok(());
        }
        // The preview appears at full size before DWM finishes the owner's
        // taskbar restore animation. Disable that transition on both windows
        // so the user does not see a second copy flying in behind the preview.
        let disable_transitions: i32 = 1;
        for target in [hwnd, overlay] {
            DwmSetWindowAttribute(
                target,
                DWMWA_TRANSITIONS_FORCEDISABLED,
                &disable_transitions as *const i32 as *const c_void,
                std::mem::size_of_val(&disable_transitions) as u32,
            );
        }
        if SetWindowSubclass(hwnd, restore_proc, SUBCLASS_ID, 0) == 0 {
            DestroyWindow(overlay);
            return Ok(());
        }
        let mut state = lock_preview();
        state.window = hwnd as usize;
        state.overlay = overlay as usize;
    }
    Ok(())
}

pub fn capture() {
    let (window, overlay) = {
        let state = lock_preview();
        (state.window, state.overlay)
    };
    let hwnd = window as Handle;
    if hwnd.is_null() || unsafe { IsIconic(hwnd) != 0 } {
        return;
    }
    // A separate process can read WebView2's composed pixels. In-process GDI
    // reads only the empty host surface, even from a background thread.
    let output = std::env::current_exe().ok().and_then(|exe| {
        Command::new(exe)
            .args(["--neuink-capture-preview", &window.to_string()])
            .output()
            .ok()
    });
    let Some(output) = output.filter(|result| result.status.success()) else {
        return;
    };
    let bytes = &output.stdout;
    if bytes.len() < 8 {
        return;
    }
    let width = i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    let height = i32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    let Some(size) = pixel_count(width, height) else {
        return;
    };
    if bytes.len() != size + 8 {
        return;
    }
    if bytes[8..]
        .chunks_exact(4)
        .step_by(128)
        .filter(|pixel| pixel[..3].iter().any(|value| *value < 200))
        .take(4)
        .count()
        < 4
    {
        return;
    }
    unsafe {
        let dc = GetDC(hwnd);
        if dc.is_null() {
            return;
        }
        let mut bits: Handle = std::ptr::null_mut();
        let bitmap = CreateDIBSection(
            dc,
            &bitmap_info(width, height),
            0,
            &mut bits,
            std::ptr::null_mut(),
            0,
        );
        ReleaseDC(hwnd, dc);
        if bitmap.is_null() || bits.is_null() {
            if !bitmap.is_null() {
                DeleteObject(bitmap);
            }
            return;
        }
        std::ptr::copy_nonoverlapping(bytes[8..].as_ptr(), bits as *mut u8, size);
        SendMessageW(overlay as Handle, STM_SETIMAGE, 0, bitmap as isize);
        let mut state = lock_preview();
        if state.window != window {
            DeleteObject(bitmap);
            return;
        }
        if state.bitmap != 0 {
            DeleteObject(state.bitmap as Handle);
        }
        state.bitmap = bitmap as usize;
    }
}

pub fn maybe_run_capture_helper() {
    if std::env::args().nth(1).as_deref() != Some("--neuink-capture-preview") {
        return;
    }
    // Tauri normally configures DPI awareness during startup. The capture
    // helper exits before that startup, so match its physical pixel geometry.
    unsafe {
        SetProcessDpiAwarenessContext((-4isize) as Handle);
    }
    let success = std::env::args()
        .nth(2)
        .and_then(|value| value.parse::<usize>().ok())
        .is_some_and(capture_to_stdout);
    std::process::exit(if success { 0 } else { 1 });
}

fn capture_to_stdout(window: usize) -> bool {
    let hwnd = window as Handle;
    let webview_class: Vec<u16> = "WRY_WEBVIEW\0".encode_utf16().collect();
    unsafe {
        let webview = FindWindowExW(
            hwnd,
            std::ptr::null_mut(),
            webview_class.as_ptr(),
            std::ptr::null(),
        );
        if webview.is_null() {
            return false;
        }
        let mut rect = Rect::default();
        if GetClientRect(webview, &mut rect) == 0 {
            return false;
        }
        let Some(size) = pixel_count(rect.right, rect.bottom) else {
            return false;
        };
        let source_dc = GetDC(webview);
        if source_dc.is_null() {
            return false;
        }
        let memory_dc = CreateCompatibleDC(source_dc);
        let bitmap = CreateCompatibleBitmap(source_dc, rect.right, rect.bottom);
        let captured = if !memory_dc.is_null() && !bitmap.is_null() {
            let previous = SelectObject(memory_dc, bitmap);
            let result = PrintWindow(webview, memory_dc, PW_RENDERFULLCONTENT) != 0;
            SelectObject(memory_dc, previous);
            result
        } else {
            false
        };
        let written = if captured {
            let mut pixels = vec![0u8; size];
            let mut info = bitmap_info(rect.right, rect.bottom);
            let extracted = GetDIBits(
                source_dc,
                bitmap,
                0,
                rect.bottom as u32,
                pixels.as_mut_ptr() as Handle,
                &mut info,
                0,
            ) == rect.bottom;
            let mut stdout = std::io::stdout().lock();
            extracted
                && stdout.write_all(&rect.right.to_le_bytes()).is_ok()
                && stdout.write_all(&rect.bottom.to_le_bytes()).is_ok()
                && stdout.write_all(&pixels).is_ok()
        } else {
            false
        };
        if !bitmap.is_null() {
            DeleteObject(bitmap);
        }
        if !memory_dc.is_null() {
            DeleteDC(memory_dc);
        }
        ReleaseDC(webview, source_dc);
        written
    }
}

unsafe extern "system" fn restore_proc(
    hwnd: Handle,
    message: u32,
    wparam: usize,
    lparam: isize,
    _id: usize,
    _data: usize,
) -> isize {
    match message {
        WM_SYSCOMMAND if wparam & 0xfff0 == SC_MINIMIZE => {
            let mut state = lock_preview();
            if !state.pending_minimize {
                state.pending_minimize = true;
                let window = hwnd as usize;
                // Keep the window visible until the frame is copied.
                std::thread::spawn(move || {
                    capture();
                    unsafe {
                        PostMessageW(window as Handle, WM_PREVIEW_MINIMIZE, 0, 0);
                    }
                });
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(650));
                    if lock_preview().pending_minimize {
                        unsafe {
                            PostMessageW(window as Handle, WM_PREVIEW_MINIMIZE, 0, 0);
                        }
                    }
                });
            }
            return 0;
        }
        WM_PREVIEW_MINIMIZE => {
            let mut state = lock_preview();
            if !state.pending_minimize {
                return 0;
            }
            state.pending_minimize = false;
            drop(state);
            return DefSubclassProc(hwnd, WM_SYSCOMMAND, SC_MINIMIZE, 0);
        }
        WM_SIZE if wparam == SIZE_MINIMIZED => lock_preview().minimized = true,
        WM_SIZE => {
            let mut state = lock_preview();
            if state.minimized && state.bitmap != 0 {
                state.minimized = false;
                let mut rect = Rect::default();
                let mut origin = Point::default();
                if GetClientRect(hwnd, &mut rect) != 0 && ClientToScreen(hwnd, &mut origin) != 0 {
                    SetWindowPos(
                        state.overlay as Handle,
                        HWND_TOPMOST,
                        origin.x,
                        origin.y,
                        rect.right,
                        rect.bottom,
                        SWP_NOACTIVATE | SWP_SHOWWINDOW,
                    );
                    SetTimer(hwnd, TIMER_ID, 650, std::ptr::null_mut());
                }
            }
        }
        WM_TIMER if wparam == TIMER_ID => {
            KillTimer(hwnd, TIMER_ID);
            let state = lock_preview();
            ShowWindow(state.overlay as Handle, SW_HIDE);
            SetWindowPos(
                state.overlay as Handle,
                HWND_NOTOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | 0x0001 | 0x0002,
            );
            return 0;
        }
        WM_NCDESTROY => {
            KillTimer(hwnd, TIMER_ID);
            RemoveWindowSubclass(hwnd, restore_proc, SUBCLASS_ID);
            let mut state = lock_preview();
            if state.bitmap != 0 {
                DeleteObject(state.bitmap as Handle);
            }
            *state = Preview::default();
        }
        _ => {}
    }
    DefSubclassProc(hwnd, message, wparam, lparam)
}
