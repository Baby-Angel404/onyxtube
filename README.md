<div align="center">

<img src="onyxtube.svg" alt="OnyxTube Logo" width="88" height="88" />

# OnyxTube

**Lightweight, privacy-focused desktop YouTube client for Linux, Windows, and macOS.**  
Zero YouTube `<iframe>` embeds. Native HTML5 streaming. Local-first subscriptions and settings.

[![Cross-Platform CI](https://github.com/Baby-Angel404/onyxtube/actions/workflows/ci.yml/badge.svg)](https://github.com/Baby-Angel404/onyxtube/actions/workflows/ci.yml)
[![Release Builds](https://github.com/Baby-Angel404/onyxtube/actions/workflows/release.yml/badge.svg)](https://github.com/Baby-Angel404/onyxtube/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/Platform-Linux%20%7C%20Windows%20%7C%20macOS-1f2328)
![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)

[Download Latest Release](https://github.com/Baby-Angel404/onyxtube/releases/latest) · [Report Bug](https://github.com/Baby-Angel404/onyxtube/issues) · [Workflows](https://github.com/Baby-Angel404/onyxtube/actions)

</div>

---

## Prebuilt Downloads

Download standalone packages directly from [GitHub Releases](https://github.com/Baby-Angel404/onyxtube/releases/latest):

| OS | Artifact | Native Backend | Notes |
| :--- | :--- | :--- | :--- |
| **Linux (x86_64)** | `OnyxTube-Linux-x86_64.AppImage` | GTK 3 + WebKit2GTK (`4.1` / `4.0`) | Built on Ubuntu 22.04 (GLIBC 2.35+); auto-falls back to `pywebview` or `--app` browser |
| **Windows (x86_64)** | `OnyxTube-Windows-x86_64.exe` | Edge WebView2 (`pywebview`) | Single-file executable; auto-falls back to Edge/Chrome `--app` mode |
| **macOS** | `OnyxTube-macOS.dmg` | Cocoa WKWebView (`pywebview`) | Drag `OnyxTube.app` to Applications; auto-falls back to Chrome/Safari |

```bash
# Linux AppImage quick launch
chmod +x OnyxTube-Linux-x86_64.AppImage
./OnyxTube-Linux-x86_64.AppImage

# On distros without libfuse2 (e.g., Ubuntu 24.04+)
./OnyxTube-Linux-x86_64.AppImage --appimage-extract-and-run
```

---

## Key Features

| Area | What OnyxTube Does |
| :--- | :--- |
| **Native HTML5 Player** | Plays directly in `<video>` with zero YouTube branding and zero `<iframe>` embeds. |
| **Range Streaming Proxy** | Local `/api/media` HTTP Range proxy with 512 KB chunking, block-0 pre-warming, and automatic `yt-dlp` fallback for smooth seeking. |
| **SponsorBlock Built-In** | Automatically skips sponsor, intro, outro, and self-promo segments with visual timeline markers. |
| **FreeTube-Style Settings** | Searchable settings panel covering General, Theme, Player, SponsorBlock, Distraction-Free toggles, and Data Backup/Restore. |
| **Themes & Layouts** | **Studio Ink**, **Midnight AMOLED**, **Warm Paper**, **Matcha Cream**, and **Sunset Sand**, plus customizable navigation and seekbar styles. |
| **Local-First Privacy** | Subscriptions, watch history, Watch Later, playlists, and preferences stay strictly on your machine. |

---

## Run From Source

<details>
<summary><strong>Linux (Ubuntu, Debian, Fedora, Arch, etc.)</strong></summary>

```bash
git clone https://github.com/Baby-Angel404/onyxtube.git
cd onyxtube
./install-desktop.sh
onyxtube
```

Or build the AppImage locally:

```bash
./build-appimage.sh
./dist/OnyxTube-x86_64.AppImage --appimage-extract-and-run
```

</details>

<details>
<summary><strong>Windows 10 / 11</strong></summary>

1. Install **Python 3.10+** from [python.org](https://www.python.org/downloads/).
2. Clone or extract the repository and run `install-windows.bat` (installs `yt-dlp` + `pywebview` and creates a Desktop shortcut).
3. Double-click **OnyxTube** on your Desktop or run `launch-onyxtube.bat`.

</details>

<details>
<summary><strong>macOS</strong></summary>

```bash
git clone https://github.com/Baby-Angel404/onyxtube.git
cd onyxtube
python3 -m pip install -r requirements.txt
chmod +x launch-onyxtube.sh launch-onyxtube.command
./launch-onyxtube.sh
```

</details>

---

## Verification & CI Matrix

Every push to `main` is verified across desktop OS runners and 5 Linux distribution containers:

- **Desktop Runners**: `ubuntu-latest`, `windows-latest`, `macos-latest` (`py_compile`, `node --check`, native `pywebview`/browser smoke tests, and Playwright UI E2E via `test_ci_e2e.py`).
- **Linux Distro Matrix**: `ubuntu:22.04`, `ubuntu:24.04`, `debian:bookworm`, `fedora:41`, `archlinux:latest`.

Run checks locally:

```bash
node --check app.js
python3 -m py_compile desktop.py server.py test_ci_e2e.py test_e2e.py
ONYXTUBE_DISABLE_DESKTOP_NOTIFY=1 python3 test_ci_e2e.py
```

---

## License

Released under the [MIT License](LICENSE).
