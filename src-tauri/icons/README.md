# Icons

Tauri needs platform-specific icon sizes at bundle time. Generate them once from a single 1024×1024 PNG:

```bash
# from the project root
npx @tauri-apps/cli@^2 icon path/to/source-icon.png
```

That regenerates every size in this folder (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns` for macOS, `icon.ico` for Windows) and overwrites any placeholders.

Keep the source PNG in the design system, not in this folder — this folder only holds the generated outputs that ship in the binary.
