#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(windows)]
    neuink_desktop_lib::restore_preview::maybe_run_capture_helper();
    neuink_desktop_lib::run();
}
