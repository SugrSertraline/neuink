#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;
    use tauri_plugin_dialog::DialogExt;

    let portable = std::env::current_exe()
        .map_err(|_| "无法确定程序所在目录。".to_string())
        .and_then(|exe| neuink_ipc::storage::PortablePaths::detect(&exe))
        .and_then(|paths| {
            paths
                .map(|paths| {
                    let lock = paths.lock()?;
                    let exe = std::env::current_exe().map_err(|_| "无法确定程序目录。")?;
                    let report = neuink_ipc::storage::legacy_scan::scan(&exe, paths.data())?;
                    let script = paths.initialization_script()?;
                    Ok::<_, String>((paths, lock, script, report))
                })
                .transpose()
        });
    let startup_error = portable.as_ref().err().cloned();
    let mut context = tauri::generate_context!();
    let mut builder = tauri::Builder::default();
    let mut portable_windows = None;
    let mut scan_warning = None;
    match portable {
        Ok(Some((paths, lock, script, report))) => {
            if !report.errors.is_empty() {
                scan_warning = report.description();
            }
            portable_windows = Some(
                context
                    .config()
                    .app
                    .windows
                    .iter()
                    .filter(|window| window.create)
                    .cloned()
                    .collect::<Vec<_>>(),
            );
            for window in &mut context.config_mut().app.windows {
                window.create = false;
            }
            builder = builder
                // Plugin scripts run after Tauri installs the current WebView metadata.
                .plugin(
                    tauri::plugin::Builder::<_, ()>::new("portable-storage")
                        .js_init_script(script)
                        .build(),
                )
                .manage(paths)
                .manage(report)
                .manage(lock);
        }
        Err(_) => {
            // Do not start a different, empty library after a portable storage failure.
            for window in &mut context.config_mut().app.windows {
                window.create = false;
            }
        }
        Ok(None) => {}
    }

    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .setup(move |app| {
            if let Some(error) = startup_error {
                app.dialog()
                    .message(&error)
                    .title("Neuink 无法打开数据目录")
                    .kind(tauri_plugin_dialog::MessageDialogKind::Error)
                    .blocking_show();
                return Err(std::io::Error::other(error).into());
            }
            if let Some(windows) = portable_windows {
                let paths = app.state::<neuink_ipc::storage::PortablePaths>();
                for window in windows {
                    // Config dataDirectory is resolved under AppLocalData by Tauri. The
                    // native builder accepts the absolute directory beside our executable.
                    tauri::WebviewWindowBuilder::from_config(app, &window)?
                        .data_directory(paths.data().join("webview"))
                        .build()?;
                }
            }
            if let (Some(window), Some(icon)) = (
                app.get_webview_window("main"),
                app.default_window_icon().cloned(),
            ) {
                let _ = window.set_icon(icon);
            }
            if let Some(warning) = scan_warning {
                app.dialog()
                    .message(warning)
                    .title("旧资料整理未全部完成")
                    .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
                    .blocking_show();
            }
            neuink_ipc::commands::search::spawn_search_cache_workers(app.handle().clone());
            Ok(())
        });
    let builder = neuink_ipc::register_commands(builder);

    if let Err(error) = builder.run(context) {
        eprintln!("error while running tauri application: {error}");
    }
}
