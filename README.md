# OnyxTube

**OnyxTube** is a lightweight, privacy-focused native desktop YouTube client for **Linux**, **Windows**, and **macOS** with zero YouTube branding, zero `<iframe>` embeds, built-in SponsorBlock, local subscriptions, and FreeTube-inspired settings.

## Features

- **Native HTML5 Video & Audio Proxy**: Streams directly via local Range-capable proxy (`/api/media`) with 512KB chunking, block-0 pre-warming, and automatic `yt-dlp` fallback.
- **Cross-Platform Desktop Shell**:
  - **Linux**: Native `GTK 3` + `WebKit2GTK 4.1` window (`desktop.py`), with `pywebview` and `--app` browser fallbacks.
  - **Windows**: `pywebview` (Edge WebView2) or Microsoft Edge/Chrome `--app` mode (`launch-onyxtube.bat`).
  - **macOS**: `pywebview` (Cocoa WKWebView) or Chrome/Safari fallback (`launch-onyxtube.command` / `launch-onyxtube.sh`).
- **Privacy & Focus**: Local subscriptions, watch history, playlists, SponsorBlock auto-skip, Distraction-Free toggles, Sleep Timer, and MediaSession hardware keys.
- **Customizable UI**: Multiple themes (Studio Ink, Midnight AMOLED, Warm Paper, Matcha Cream, Sunset Sand), navigation layouts, seekbar styles, and persistent preferences.

## Quick Start

### Linux
```bash
# Ensure GTK3 + WebKit2GTK Python bindings and yt-dlp are installed
./install-desktop.sh
onyxtube
```

### Windows
1. Install Python 3.10+ from [python.org](https://www.python.org/downloads/).
2. Run `install-windows.bat` (installs `yt-dlp` and `pywebview`, creates a Desktop shortcut).
3. Double-click **OnyxTube** on your Desktop or run `launch-onyxtube.bat`.

### macOS
```bash
python3 -m pip install -r requirements.txt
chmod +x launch-onyxtube.sh launch-onyxtube.command
./launch-onyxtube.sh
```

## Prebuilt Releases (AppImage, Windows EXE, macOS DMG)

Push a version tag (e.g. `git tag v1.0.0 && git push origin v1.0.0`) or trigger **Build Cross-Platform Releases** manually in GitHub Actions to generate:
- **Linux**: `OnyxTube-Linux-x86_64.AppImage` (also buildable locally via `./build-appimage.sh`)
- **Windows**: `OnyxTube-Windows-x86_64.exe`
- **macOS**: `OnyxTube-macOS.dmg`

## Running Tests

```bash
node --check app.js
python3 -m py_compile desktop.py server.py test_e2e.py
ONYXTUBE_DISABLE_DESKTOP_NOTIFY=1 python3 test_e2e.py
```

## License

[MIT](LICENSE)
