// Local standalone builds are also launched from a desktop shortcut. Windows
// must not create a console window for either debug or release executables.
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    #[cfg(windows)]
    neuink_desktop_lib::restore_preview::maybe_run_capture_helper();
    neuink_desktop_lib::run();
}
