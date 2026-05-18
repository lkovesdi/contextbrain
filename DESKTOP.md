# MeetingBrain — desktop app

The desktop app is a Tauri 2 shell wrapping the same Next.js code that runs in the browser. The WebView loads from `https://meetingbrain.app` (production) or `http://localhost:3000` (`tauri dev`). All secrets stay on Vercel — the desktop binary never sees an API key. Native code only ships for the things browsers literally can't do: system audio capture, deep-link OAuth, native menus, code-signed updates.

This document walks through running the desktop shell locally and shipping a signed build.

---

## One-time toolchain setup

1. **Rust** — `rustup` is the only blessed way. Tauri's CLI explicitly warns against Homebrew Rust.
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source ~/.cargo/env
   rustc --version  # should print a 1.7x.x stable
   ```

2. **Xcode Command Line Tools** (macOS).
   ```bash
   xcode-select --install
   ```
   You also need the full Xcode app from the App Store to access `xcrun notarytool` for signed builds, but the CLI tools are enough for `tauri dev`.

3. **Windows toolchain** (Windows builds only).
   - Install [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload.
   - Tauri's CLI then handles WebView2 + the rest automatically.

4. **Confirm**.
   ```bash
   npx tauri info
   ```
   Every line under `Environment` should show ✔.

---

## Running the desktop app in dev

From the project root:

```bash
npm run tauri:dev
```

What happens:

1. `before_dev_command` in `src-tauri/tauri.conf.json` runs `npm --prefix .. run dev`, which spawns `next dev` on port 3000.
2. Rust compiles `src-tauri` (first run: ~2 min cold, ~10 s warm).
3. A native window opens, WebView pointed at `http://localhost:3000`. DevTools open automatically in debug mode (`window.open_devtools()` in `src-tauri/src/lib.rs`).
4. Hot reload works as in the browser — edit any React file, the WebView refreshes.

To exit, close the window or `Ctrl-C` in the terminal.

---

## Pointing the desktop at production

Edit `src-tauri/tauri.conf.json`, change `app.windows[0].url`:

```json
"windows": [
  {
    "label": "main",
    "url": "https://meetingbrain.app",
    …
  }
]
```

`devUrl` (used by `tauri:dev`) stays as `http://localhost:3000`. The two URLs are independent: dev loads `devUrl`, `tauri build` produces a binary that loads `url`.

---

## Building a desktop binary

```bash
npm run tauri:build
```

This produces:

- `src-tauri/target/release/bundle/dmg/MeetingBrain_*.dmg` (macOS, unsigned)
- `src-tauri/target/release/bundle/macos/MeetingBrain.app` (raw `.app`)
- `src-tauri/target/release/bundle/msi/MeetingBrain_*.msi` (Windows, when built on Windows)

The unsigned build is fine for local testing. Signing + notarization (Phase 3 / Phase 5) is wired through CI, not here.

---

## Icons

Drop a 1024×1024 PNG anywhere (a `design/` folder works), then:

```bash
npm run tauri:icon path/to/source-icon.png
```

That regenerates every size in `src-tauri/icons/`. Commit the outputs.

---

## What's stubbed out

The scaffold is intentionally thin — just enough to compile and open a window. Each later phase fills in one piece:

- **Phase 2 — macOS audio sidecar** wires a Swift binary into `src-tauri/binaries/`, spawned from Rust, surfaced to the renderer through a `start_audio_capture` Tauri command. The `Recorder.tsx` Tauri branch swaps `getUserMedia` for that command.
- **Phase 3 — macOS signing + notarization** adds an Apple Developer ID cert to a GitHub Actions secret, calls `xcrun notarytool submit` in the workflow, staples the result to the `.dmg`.
- **Phase 4 — Windows audio sidecar** ships a WASAPI loopback capture binary alongside the Swift one, picked by `cfg(target_os)`.
- **Phase 5 — Windows signing + MSI installer**.
- **Phase 6 — Auto-update** — flip `bundle.updater.active = true` in `tauri.conf.json`, generate a Tauri signing keypair, host `latest.json` on a GitHub Release.

Until those phases land, the desktop app is functionally equivalent to opening the web app in Chrome — except deep-link auth and native menus are pre-wired, and the binary is the same shape as the eventual production build.

---

## Notes

- The Rust target directory (`src-tauri/target/`) is ~2–3 GB after a first build. It's gitignored. Periodically `cargo clean -p meetingbrain` from `src-tauri/` if you're tight on disk.
- The updater is **disabled by default** in `tauri.conf.json` (`active: false`). Don't flip it on until Phase 6 generates the signing key — releases without a verified signature will reject updates and risk shipping a build that can never be updated again.
