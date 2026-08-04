fn main() {
    // App commands must be declared here so tauri-build generates
    // `allow-<command>` permissions for the capability files — required for
    // the remotely-hosted frontend (capabilities/remote.json) to invoke them.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "ping",
            "start_meeting",
            "dismiss_popup",
            "dismiss_update_popup",
            "restart_app",
            "pending_update_version",
            "pending_update_notes",
            "widget_show",
            "widget_hide",
            "widget_stop",
            "focus_main",
        ])),
    )
    .expect("failed to run tauri-build");
}
