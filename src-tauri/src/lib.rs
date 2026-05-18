use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // First-launch hook. Phase 2 will register the Swift audio sidecar
            // and Phase 6 will wire the updater's auto-check here.
            //
            // Devtools live behind the `devtools` cargo feature, which is
            // off in release. `#[cfg(debug_assertions)]` (attribute form,
            // not the `cfg!(…)` macro) drops the whole block at compile
            // time when building for release so the method lookup never
            // happens.
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ping]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Sanity-check command — the renderer can call `invoke('ping')` to confirm
/// IPC is alive. Remove once real commands (audio capture, etc.) land.
#[tauri::command]
fn ping() -> &'static str {
    "pong"
}
