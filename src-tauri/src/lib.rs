// Only the debug-only devtools block needs `Manager` (for `get_webview_window`);
// the release updater path uses the inherent `App::handle`, so gate the import.
#[cfg(debug_assertions)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // First-launch hook. Phase 2 will register the Swift audio sidecar.
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

            // Auto-update: on launch, check the GitHub Release endpoint and,
            // if a newer signed build exists, download + install it in the
            // background. On macOS the new bundle is swapped in place and
            // takes effect on the next launch, so the running session is
            // never interrupted by a forced restart. Disabled in debug
            // builds, which have no signed updater artifacts to verify.
            #[cfg(not(debug_assertions))]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = check_for_updates(handle).await {
                        eprintln!("updater: check failed: {err}");
                    }
                });
            }

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

/// Launch-time update check, wired from the setup hook in release builds.
/// Errors (offline, no release yet, signature mismatch) are logged and
/// swallowed — a failed update check must never block the app from opening.
#[cfg(not(debug_assertions))]
async fn check_for_updates(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    use tauri_plugin_updater::UpdaterExt;

    if let Some(update) = app.updater()?.check().await? {
        eprintln!(
            "updater: installing {} (was {})",
            update.version, update.current_version
        );
        update.download_and_install(|_, _| {}, || {}).await?;
        eprintln!("updater: staged — applies on next launch");
    }
    Ok(())
}
