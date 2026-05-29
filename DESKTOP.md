# ContextBrain — desktop app

The desktop app is a Tauri 2 shell wrapping the same Next.js code that runs in the browser. The WebView loads from `https://contextbrain.app` (production) or `http://localhost:3000` (`tauri dev`). All secrets stay on Vercel — the desktop binary never sees an API key. Native code only ships for the things browsers literally can't do: system audio capture, deep-link OAuth, native menus, code-signed updates.

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
    "url": "https://contextbrain.app",
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

- `src-tauri/target/release/bundle/dmg/ContextBrain_*.dmg` (macOS, unsigned)
- `src-tauri/target/release/bundle/macos/ContextBrain.app` (raw `.app`)
- `src-tauri/target/release/bundle/msi/ContextBrain_*.msi` (Windows, when built on Windows)

The unsigned build is fine for local testing. For a **public, signed, downloadable** build, don't sign locally — use the release workflow below.

---

## Releasing a signed download (CI)

`.github/workflows/release.yml` builds macOS (universal), signs and notarizes it, and publishes the `.dmg` to a **draft** GitHub Release. Trigger it with a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Then open the repo's Releases tab, review the drafted assets, and publish.

### Required GitHub repo secrets (macOS signing + notarization)

Add these under **Settings → Secrets and variables → Actions**:

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of your exported "Developer ID Application" cert (`.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | the password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple Developer account email |
| `APPLE_PASSWORD` | an **app-specific password** (appleid.apple.com → Sign-In and Security) |
| `APPLE_TEAM_ID` | your 10-char Team ID |

Export the cert to base64 locally:

```bash
# From Keychain Access, export your "Developer ID Application" cert as cert.p12, then:
base64 -i cert.p12 | pbcopy   # paste into the APPLE_CERTIFICATE secret
security find-identity -p codesigning -v   # shows the exact APPLE_SIGNING_IDENTITY string
```

### Required GitHub repo secrets (auto-updater signing)

These are **separate** from the Apple cert — they're Tauri's own minisign keypair, used to sign the update artifact so installed apps only accept updates we produced.

| Secret | What it is |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of the generated private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the key's password (empty string if generated without one) |

The keypair was generated with `npx tauri signer generate -w ~/.tauri/contextbrain-updater.key`. The **public** half is committed in `tauri.conf.json` (`plugins.updater.pubkey`); the **private** half lives only at `~/.tauri/contextbrain-updater.key` and must never be committed. Upload it to GitHub without it ever touching the clipboard or logs:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/contextbrain-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body ""   # empty: generated without a password
```

> Back this private key up somewhere safe (a password manager). If it's lost, you cannot ship updates that existing installs will accept — you'd have to re-distribute a fresh download with a new key.

### Windows

macOS only for now. Windows builds (signing cert, MSI) are deferred — see Phase 5 below.

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
- **Phase 6 — Auto-update** — ✅ done. `bundle.createUpdaterArtifacts` is on, the updater pubkey is in `tauri.conf.json`, the release workflow signs the artifact and uploads `latest.json`, and `src-tauri/src/lib.rs` checks for updates on launch (release builds only). See "How auto-update works" below.

Until those phases land, the desktop app is functionally equivalent to opening the web app in Chrome — except deep-link auth, native menus, and auto-update are pre-wired, and the binary is the same shape as the eventual production build.

---

## How auto-update works

1. On launch, release builds spawn a background check (`check_for_updates` in `src-tauri/src/lib.rs`) against the `plugins.updater.endpoints` URL — the `latest.json` asset on the newest GitHub Release.
2. If `latest.json` advertises a version newer than the running one **and** its signature verifies against the embedded pubkey, the new `.dmg` is downloaded and installed in the background.
3. On macOS the bundle is swapped in place, so the update applies the **next** time the app is opened — the current session is never interrupted. Check failures (offline, no release yet, bad signature) are logged and ignored.

To ship an update: bump `version` in `tauri.conf.json` (and `src-tauri/Cargo.toml`), tag, push, and publish the resulting draft release. `latest.json` resolves via `/releases/latest/`, so it only goes live once the release is **published** (not while it's a draft).

---

## Notes

- The Rust target directory (`src-tauri/target/`) is ~2–3 GB after a first build. It's gitignored. Periodically `cargo clean -p contextbrain` from `src-tauri/` if you're tight on disk.
- The updater is **enabled**. Every release must be signed with the same `TAURI_SIGNING_PRIVATE_KEY` — a release built without it (or with a different key) won't be accepted by installed apps. Never rotate the key without re-distributing a fresh download.
