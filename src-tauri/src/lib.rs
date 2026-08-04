use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate::default())
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

            // macOS: the window uses `titleBarStyle: "Overlay"` (tauri.conf.json),
            // so web content fills the window under the traffic lights — the
            // seamless, Granola-style look with no system titlebar. That also
            // means there's no native titlebar to grab, so install a transparent
            // native drag strip across the top to keep the window movable. Done
            // entirely in Rust, so it works regardless of what the (remote) web
            // frontend loads.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(ns_window) = window.ns_window() {
                    macos_titlebar::install_drag_strip(ns_window);
                }
            }

            // Watch the microphone: when any app starts using it (a call
            // beginning), pop the "Meeting Detected" prompt. macOS only for now.
            #[cfg(target_os = "macos")]
            mic_monitor::start(app.handle().clone());

            // Auto-update: check the GitHub Release endpoint at launch and
            // then every 4 hours — an app kept open for days would otherwise
            // never notice a release (launch-only checking was exactly how
            // v0.2.1 went unseen). A newer signed build is downloaded +
            // staged in the background and applies on the next launch, so
            // the running session is never interrupted. Ticks are skipped
            // once an update is staged — nothing to re-download, and the
            // staged version applies on relaunch regardless. Disabled in
            // debug builds, which have no signed updater artifacts to verify.
            #[cfg(not(debug_assertions))]
            {
                const CHECK_INTERVAL: std::time::Duration =
                    std::time::Duration::from_secs(4 * 60 * 60);
                let handle = app.handle().clone();
                std::thread::spawn(move || loop {
                    let staged = handle
                        .try_state::<PendingUpdate>()
                        .and_then(|state| state.0.lock().ok().map(|slot| slot.is_some()))
                        .unwrap_or(false);
                    if !staged {
                        let check = check_for_updates(handle.clone());
                        if let Err(err) = tauri::async_runtime::block_on(check) {
                            eprintln!("updater: check failed: {err}");
                        }
                    }
                    std::thread::sleep(CHECK_INTERVAL);
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            start_meeting,
            dismiss_popup,
            dismiss_update_popup,
            restart_app,
            pending_update_version,
            pending_update_notes,
            widget_show,
            widget_hide,
            widget_stop,
            focus_main
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|app_handle, event| {
        // Dock-icon click while the main window is minimized: macOS only
        // auto-restores minimized windows when the app has NO visible windows,
        // and the floating recording widget counts as one — so restore the
        // main window ourselves.
        if let tauri::RunEvent::Reopen { .. } = event {
            if let Some(main) = app_handle.get_webview_window("main") {
                let _ = main.unminimize();
                let _ = main.show();
                let _ = main.set_focus();
            }
        }
    });
}

/// Sanity-check command — the renderer can call `invoke('ping')` to confirm
/// IPC is alive. Remove once real commands (audio capture, etc.) land.
#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

/// Called by the "Meeting Detected" popup's button. The popup can't create a
/// meeting itself (no session), so we send the main window — which is logged
/// in — to the quick-start route that creates a meeting and opens it, then
/// surface the main window and dismiss the popup.
#[tauri::command]
fn start_meeting(app: tauri::AppHandle) {
    // Close the popup before touching the main window: navigation + focus can
    // take visible time, and a popup that lingers through it reads as a
    // broken button.
    if let Some(popup) = app.get_webview_window("meeting-popup") {
        let _ = popup.close();
    }
    if let Some(main) = app.get_webview_window("main") {
        if let Ok(url) = tauri::Url::parse("https://contextbrain.vercel.app/api/meetings/quick-start")
        {
            let _ = main.navigate(url);
        }
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

/// Called by the popup on its 15s timeout (or a manual dismiss) to close itself.
#[tauri::command]
fn dismiss_popup(app: tauri::AppHandle) {
    if let Some(popup) = app.get_webview_window("meeting-popup") {
        let _ = popup.close();
    }
}

/// An update that's been downloaded and staged but not yet applied. The
/// "What's new" prompt reads the version for its header and the notes (the
/// GitHub release body, carried through latest.json) for its changelog.
#[derive(Clone)]
struct StagedUpdate {
    version: String,
    notes: Option<String>,
}

#[derive(Default)]
struct PendingUpdate(std::sync::Mutex<Option<StagedUpdate>>);

#[tauri::command]
fn pending_update_version(state: tauri::State<'_, PendingUpdate>) -> Option<String> {
    state
        .0
        .lock()
        .ok()
        .and_then(|slot| slot.as_ref().map(|u| u.version.clone()))
}

#[tauri::command]
fn pending_update_notes(state: tauri::State<'_, PendingUpdate>) -> Option<String> {
    state
        .0
        .lock()
        .ok()
        .and_then(|slot| slot.as_ref().and_then(|u| u.notes.clone()))
}

/// Close the "What's new" prompt without relaunching — the staged update
/// still applies on the next natural launch.
#[tauri::command]
fn dismiss_update_popup(app: tauri::AppHandle) {
    if let Some(popup) = app.get_webview_window("update-popup") {
        let _ = popup.close();
    }
}

/// Relaunch the app to apply a staged update (called by the prompt's button).
#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

/// Show the Granola-style floating recording widget — a small always-on-top,
/// transparent window loading /widget from the deployed frontend. Called by
/// the web frontend when a recording starts. Recording state itself flows
/// between the two windows over a same-origin BroadcastChannel, not IPC.
#[tauri::command]
fn widget_show(app: tauri::AppHandle) {
    use tauri::{LogicalPosition, WebviewUrl, WebviewWindowBuilder};

    if let Some(win) = app.get_webview_window("recording-widget") {
        let _ = win.show();
        return;
    }
    let Ok(url) = tauri::Url::parse("https://contextbrain.vercel.app/widget") else {
        return;
    };
    const WIDGET_W: f64 = 340.0;
    const WIDGET_H: f64 = 56.0;
    let built = WebviewWindowBuilder::new(
        &app,
        "recording-widget",
        WebviewUrl::External(url),
    )
    .title("Recording")
    .inner_size(WIDGET_W, WIDGET_H)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .accept_first_mouse(true)
    .build();
    match built {
        Ok(win) => {
            // Granola/Spotlight behavior: reclass the window into a
            // non-activating NSPanel so its buttons work without activating
            // the app — even while the main window is minimized — and without
            // stealing focus or window actions from the main window.
            #[cfg(target_os = "macos")]
            {
                let w = win.clone();
                let _ = win.run_on_main_thread(move || {
                    if let Ok(ptr) = w.ns_window() {
                        macos_panel::convert_to_nonactivating_panel(ptr);
                    }
                });
            }
            // Top-right of the current monitor, clear of the menu bar.
            if let Ok(Some(monitor)) = win.current_monitor() {
                let scale = monitor.scale_factor();
                let size = monitor.size().to_logical::<f64>(scale);
                let _ = win.set_position(LogicalPosition::new(
                    size.width - WIDGET_W - 20.0,
                    44.0,
                ));
            }
            let _ = win.show();
        }
        Err(e) => eprintln!("widget: create failed: {e}"),
    }
}

// The floating recording widget must accept clicks without activating the
// app (Spotlight-style). AppKit expresses that as a non-activating NSPanel —
// Tauri only creates NSWindows, so we reclass the live window into an NSPanel
// subclass. NSPanel adds no instance variables over NSWindow, which is what
// makes the isa-swizzle safe (the same technique tauri-nspanel uses).
#[cfg(target_os = "macos")]
mod macos_panel {
    use objc2::runtime::AnyObject;
    use objc2::{define_class, ClassType, MainThreadMarker};
    use objc2_app_kit::{NSPanel, NSWindowStyleMask};

    define_class!(
        #[unsafe(super(NSPanel))]
        #[name = "ContextBrainRecordingPanel"]
        struct RecordingPanel;

        impl RecordingPanel {
            // Key status is needed for the webview's buttons to interact
            // normally; the NonactivatingPanel style mask keeps that from
            // activating the app or raising other windows.
            #[unsafe(method(canBecomeKeyWindow))]
            fn can_become_key_window(&self) -> bool {
                true
            }

            #[unsafe(method(canBecomeMainWindow))]
            fn can_become_main_window(&self) -> bool {
                false
            }
        }
    );

    pub fn convert_to_nonactivating_panel(ns_window_ptr: *mut std::ffi::c_void) {
        if MainThreadMarker::new().is_none() {
            return;
        }
        let obj: &AnyObject = unsafe { &*(ns_window_ptr as *const AnyObject) };
        unsafe { AnyObject::set_class(obj, RecordingPanel::class()) };
        let panel: &NSPanel = unsafe { &*(ns_window_ptr as *const NSPanel) };
        panel.setStyleMask(panel.styleMask() | NSWindowStyleMask::NonactivatingPanel);
        panel.setBecomesKeyOnlyIfNeeded(true);
        panel.setFloatingPanel(true);
    }
}

/// Close the floating recording widget (recording stopped).
#[tauri::command]
fn widget_hide(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("recording-widget") {
        let _ = win.close();
    }
}

/// Raise the main window and open the recording's meeting page (called by the
/// widget's open button). Routed through Rust so it works even when the main
/// window is minimized and its page JS is suspended — eval wakes the webview.
#[tauri::command]
fn focus_main(app: tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
        let _ = main.eval("window.__cbRecordingOpen && window.__cbRecordingOpen()");
    }
}

/// Stop the active recording (called by the widget's stop button). The main
/// window's JS owns the mic + Deepgram connection, so we run the stop there —
/// via Rust rather than a web message, so a minimized/suspended main window
/// still executes it.
#[tauri::command]
fn widget_stop(app: tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.eval("window.__cbRecordingStop && window.__cbRecordingStop()");
    }
}

// Small native "Relaunch to update" prompt, shown after the updater stages a
// new version (release builds only). Native + local HTML, so it doesn't depend
// on the remote frontend or its bridge. Must be created on the main thread.
#[cfg(not(debug_assertions))]
fn show_update_popup(app: &tauri::AppHandle) {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    if let Some(win) = app.get_webview_window("update-popup") {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(
        app,
        "update-popup",
        WebviewUrl::App("update-popup.html".into()),
    )
    .title("Update ready")
    .inner_size(360.0, 300.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    // Same first-click rule as the meeting popup: the prompt is rarely the
    // key window, and its buttons must react to the first click.
    .accept_first_mouse(true)
    .center()
    .build();
}

// Detects when any app starts using the microphone (i.e. a call beginning) and
// pops the "Meeting Detected" prompt. Polls CoreAudio's
// `kAudioDevicePropertyDeviceIsRunningSomewhere` on the default input device —
// this is below the app layer, so it fires for Zoom, Google Meet, Teams,
// FaceTime, etc. alike, with no per-platform integration.
#[cfg(target_os = "macos")]
mod mic_monitor {
    use std::os::raw::c_void;
    use std::time::Duration;
    use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

    type AudioObjectID = u32;
    type OSStatus = i32;

    #[repr(C)]
    struct AudioObjectPropertyAddress {
        selector: u32,
        scope: u32,
        element: u32,
    }

    const fn fourcc(s: &[u8; 4]) -> u32 {
        ((s[0] as u32) << 24) | ((s[1] as u32) << 16) | ((s[2] as u32) << 8) | (s[3] as u32)
    }

    const SYSTEM_OBJECT: AudioObjectID = 1;
    const DEFAULT_INPUT_DEVICE: u32 = fourcc(b"dIn ");
    const IS_RUNNING_SOMEWHERE: u32 = fourcc(b"gone");
    const SCOPE_GLOBAL: u32 = fourcc(b"glob");
    const ELEMENT_MAIN: u32 = 0;

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioObjectGetPropertyData(
            object_id: AudioObjectID,
            address: *const AudioObjectPropertyAddress,
            qualifier_size: u32,
            qualifier: *const c_void,
            data_size: *mut u32,
            data: *mut c_void,
        ) -> OSStatus;
    }

    // Reads a single u32 property (global scope, main element) off an audio
    // object. Returns None on any CoreAudio error.
    fn get_u32(object: AudioObjectID, selector: u32) -> Option<u32> {
        let address = AudioObjectPropertyAddress {
            selector,
            scope: SCOPE_GLOBAL,
            element: ELEMENT_MAIN,
        };
        let mut value: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            AudioObjectGetPropertyData(
                object,
                &address,
                0,
                std::ptr::null(),
                &mut size,
                &mut value as *mut u32 as *mut c_void,
            )
        };
        (status == 0).then_some(value)
    }

    fn mic_in_use() -> bool {
        match get_u32(SYSTEM_OBJECT, DEFAULT_INPUT_DEVICE) {
            Some(device) if device != 0 => get_u32(device, IS_RUNNING_SOMEWHERE).unwrap_or(0) != 0,
            _ => false,
        }
    }

    pub fn start(app: AppHandle) {
        std::thread::spawn(move || {
            // Seed with the current state so we don't pop on launch if a call is
            // already in progress — only fire on a fresh activation.
            let mut was_active = mic_in_use();
            loop {
                std::thread::sleep(Duration::from_secs(2));
                let active = mic_in_use();
                if active && !was_active {
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || show_popup(&handle));
                }
                was_active = active;
            }
        });
    }

    // Window creation must happen on the main thread (callers use
    // `run_on_main_thread`). Reuses the popup if it's already open.
    fn show_popup(app: &AppHandle) {
        if let Some(win) = app.get_webview_window("meeting-popup") {
            let _ = win.show();
            let _ = win.set_focus();
            return;
        }
        let built = WebviewWindowBuilder::new(
            app,
            "meeting-popup",
            WebviewUrl::App("meeting-popup.html".into()),
        )
        .title("Meeting Detected")
        .inner_size(340.0, 158.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        // The user is mid-call, so the popup is usually not the key window.
        // Without this, macOS spends the first click focusing the window and
        // the button only reacts to the second — the "have to click twice" bug.
        .accept_first_mouse(true)
        .center()
        .build();

        // Safety net: close the popup after 15s even if the web layer's timer
        // never fires (e.g. the page failed to load). Matches the visible bar.
        if built.is_ok() {
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(15));
                let app = app.clone();
                let _ = app.clone().run_on_main_thread(move || {
                    if let Some(popup) = app.get_webview_window("meeting-popup") {
                        let _ = popup.close();
                    }
                });
            });
        }
    }
}

// Native macOS drag strip for the frameless ("Overlay") window. With the title
// bar gone and web content filling the window, there's no native region to grab
// the window by — so we add a transparent NSView across the top that starts a
// window drag on mouse-down, while the native traffic lights (rendered above
// everything) still click through. Pure native — no web-side drag region, so
// it's independent of the remotely-hosted frontend.
//
// The window must NOT be movableByWindowBackground: WKWebView reports most
// non-interactive page regions as window background, so that flag made
// click-drags inside app content (panning the diagram canvas, dragging over
// empty list areas) move the whole window. The strip drags explicitly via
// performWindowDragWithEvent: instead, and the webview can never move the
// window.
#[cfg(target_os = "macos")]
mod macos_titlebar {
    use objc2::rc::Retained;
    use objc2::{define_class, msg_send, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSEvent, NSView, NSWindow};
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    define_class!(
        #[unsafe(super(NSView))]
        #[name = "ContextBrainDragStrip"]
        struct DragStrip;

        impl DragStrip {
            #[unsafe(method(mouseDown:))]
            fn mouse_down(&self, event: &NSEvent) {
                let Some(window) = self.window() else {
                    return;
                };
                // Double-click = the native titlebar action (zoom by default,
                // or whatever the user set in System Settings); single click
                // starts the window drag.
                if unsafe { event.clickCount() } >= 2 {
                    double_click_action(&window);
                } else {
                    window.performWindowDragWithEvent(event);
                }
            }
        }
    );

    fn double_click_action(window: &NSWindow) {
        use objc2_foundation::{ns_string, NSUserDefaults};
        let action = unsafe {
            NSUserDefaults::standardUserDefaults().stringForKey(ns_string!("AppleActionOnDoubleClick"))
        };
        let action = action.map(|s| s.to_string());
        match action.as_deref() {
            Some("Minimize") => unsafe { window.miniaturize(None) },
            Some("None") => {}
            _ => unsafe { window.performZoom(None) },
        }
    }

    pub fn install_drag_strip(ns_window_ptr: *mut std::ffi::c_void) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        // SAFETY: called on the main thread during `setup`, with the pointer
        // Tauri handed us for the live "main" NSWindow.
        let ns_window: &NSWindow = unsafe { &*(ns_window_ptr as *const NSWindow) };

        let Some(content_view) = ns_window.contentView() else {
            return;
        };
        let bounds = content_view.bounds();
        let strip_height = 28.0;
        // AppKit's origin is bottom-left, so the top strip sits at the top of
        // the content view's height; the autoresizing mask keeps it pinned
        // full-width to the top as the window resizes.
        let frame = NSRect {
            origin: NSPoint {
                x: 0.0,
                y: bounds.size.height - strip_height,
            },
            size: NSSize {
                width: bounds.size.width,
                height: strip_height,
            },
        };
        let strip: Retained<DragStrip> =
            unsafe { msg_send![DragStrip::alloc(mtm), initWithFrame: frame] };
        strip.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewMinYMargin,
        );
        content_view.addSubview(&strip);
    }
}

/// Launch-time update check, wired from the setup hook in release builds.
/// Errors (offline, no release yet, signature mismatch) are logged and
/// swallowed — a failed update check must never block the app from opening.
#[cfg(not(debug_assertions))]
async fn check_for_updates(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    use tauri_plugin_updater::UpdaterExt;

    if let Some(update) = app.updater()?.check().await? {
        let version = update.version.clone();
        // Release notes travel from the GitHub release body via latest.json's
        // `notes` field into `update.body` — the popup renders them.
        let notes = update.body.clone();
        eprintln!(
            "updater: installing {} (was {})",
            update.version, update.current_version
        );
        update.download_and_install(|_, _| {}, || {}).await?;
        eprintln!("updater: staged — applies on relaunch");

        // Remember the staged version + notes, then surface the "What's new"
        // prompt so the user can apply it now instead of on their next launch.
        if let Some(state) = app.try_state::<PendingUpdate>() {
            if let Ok(mut slot) = state.0.lock() {
                *slot = Some(StagedUpdate { version, notes });
            }
        }
        let app = app.clone();
        let _ = app
            .clone()
            .run_on_main_thread(move || show_update_popup(&app));
    }
    Ok(())
}
