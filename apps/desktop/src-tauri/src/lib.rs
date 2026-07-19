#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            if let (Some(window), Some(icon)) = (
                app.get_webview_window("main"),
                app.default_window_icon().cloned(),
            ) {
                let _ = window.set_icon(icon);
            }
            neuink_ipc::commands::search::spawn_search_cache_workers(app.handle().clone());
            Ok(())
        });
    let builder = neuink_ipc::register_commands(builder);

    if let Err(error) = builder.run(tauri::generate_context!()) {
        eprintln!("error while running tauri application: {error}");
    }
}
