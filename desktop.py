#!/usr/bin/env python3
"""
OnyxTube Cross-Platform Native Desktop Shell
Supports:
- Linux: GTK3 + WebKit2GTK 4.1 (primary), pywebview, or Chromium/Edge --app mode
- Windows: pywebview (Edge WebView2) or Edge/Chrome --app mode
- macOS: pywebview (Cocoa WKWebView) or Chrome/Safari app fallback
"""
from __future__ import annotations

import argparse
import os
import platform
import shutil
import signal
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

APP_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from server import _default_app_data_dir, start_background_server  # noqa: E402

DEFAULT_DESKTOP_PORT = 18472


def _detect_webkit2_version() -> str | None:
    if platform.system() != "Linux":
        return None
    if not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        return None
    try:
        os.environ.setdefault("GST_PLUGIN_FEATURE_RANK", "vah264dec:NONE,vavp9dec:NONE")
        import gi

        gi.require_version("Gtk", "3.0")
        gi.require_version("Gdk", "3.0")
        for ver in ("4.1", "4.0"):
            try:
                gi.require_version("WebKit2", ver)
                return ver
            except Exception:
                continue
    except Exception:
        return None
    return None


def _has_gtk_webkit() -> bool:
    return _detect_webkit2_version() is not None


def build_webview(data_dir: Path):
    """Build a WebKit2GTK WebView on Linux (also used by automated WebKit2GTK tests)."""
    os.environ.setdefault("GST_PLUGIN_FEATURE_RANK", "vah264dec:NONE,vavp9dec:NONE")
    import gi

    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    webkit_ver = _detect_webkit2_version() or "4.1"
    gi.require_version("WebKit2", webkit_ver)
    from gi.repository import Gtk, WebKit2  # noqa: E402

    data_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = data_dir / "cache"
    for sub in ("WebKitCache", "CacheStorage"):
        shutil.rmtree(cache_dir / sub, ignore_errors=True)

    manager = WebKit2.WebsiteDataManager(
        base_data_directory=str(data_dir / "data"),
        base_cache_directory=str(cache_dir),
    )
    context = WebKit2.WebContext.new_with_website_data_manager(manager)
    context.set_cache_model(WebKit2.CacheModel.DOCUMENT_VIEWER)

    settings = WebKit2.Settings()
    settings.set_enable_javascript(True)
    settings.set_enable_html5_local_storage(True)
    settings.set_enable_smooth_scrolling(True)
    settings.set_media_playback_requires_user_gesture(False)
    settings.set_enable_fullscreen(True)
    settings.set_enable_mediasource(True)
    settings.set_enable_developer_extras(True)

    gtk_settings = Gtk.Settings.get_default()
    if gtk_settings is not None:
        gtk_settings.set_property("gtk-application-prefer-dark-theme", True)

    webview = WebKit2.WebView.new_with_context(context)
    webview.set_settings(settings)

    def _on_permission_request(_wv, req) -> bool:
        try:
            if isinstance(req, WebKit2.NotificationPermissionRequest):
                req.allow()
                return True
        except Exception:
            pass
        return False

    webview.connect("permission-request", _on_permission_request)

    ucm = webview.get_user_content_manager()
    if ucm is not None:
        def _on_theme_msg(_mgr, result) -> None:
            try:
                mode = result.get_js_value().to_string().strip().lower()
                if gtk_settings is not None:
                    gtk_settings.set_property("gtk-application-prefer-dark-theme", mode != "light")
            except Exception:
                pass

        ucm.register_script_message_handler("onyxTheme")
        ucm.connect("script-message-received::onyxTheme", _on_theme_msg)

    return webview


def shutdown_desktop_shell(win, webview, httpd):
    """Wire instant synchronous audio/WebProcess cutoff across delete-event, destroy, shortcuts, and signals."""
    from gi.repository import Gdk, GLib, Gtk  # noqa: E402

    closed = {"done": False}

    def stop_server_async() -> None:
        def _stop() -> None:
            try:
                httpd.server_close()
            except Exception:
                pass
            try:
                httpd.shutdown()
            except Exception:
                pass

        threading.Thread(target=_stop, name="onyxtube-httpd-stop", daemon=True).start()

    def terminate_now(*_args) -> bool:
        if closed["done"]:
            return False
        closed["done"] = True
        try:
            webview.set_is_muted(True)
        except Exception:
            pass
        try:
            webview.stop_loading()
        except Exception:
            pass
        try:
            webview.evaluate_javascript(
                "document.querySelectorAll('video,audio').forEach(m=>{try{m.pause();m.muted=true;m.volume=0;m.removeAttribute('src');m.load();}catch(e){}});",
                -1,
                None,
                None,
                None,
                None,
                None,
            )
        except Exception:
            pass
        try:
            win.hide()
        except Exception:
            pass
        try:
            webview.terminate_web_process()
        except Exception:
            pass
        stop_server_async()
        try:
            if Gtk.main_level() > 0:
                Gtk.main_quit()
        except Exception:
            pass
        return False

    def on_key_press(_widget, event) -> bool:
        state = getattr(event, "state", 0)
        keyval = getattr(event, "keyval", 0)
        if bool(state & Gdk.ModifierType.CONTROL_MASK) and keyval in (Gdk.KEY_q, Gdk.KEY_Q):
            win.close()
            return True
        return False

    win.connect("key-press-event", on_key_press)
    win.connect("delete-event", terminate_now)
    win.connect("destroy", terminate_now)
    signal.signal(signal.SIGINT, lambda *_: GLib.idle_add(win.close))
    signal.signal(signal.SIGTERM, lambda *_: GLib.idle_add(win.close))
    return terminate_now


def _run_gtk_webkit(httpd, actual_port: int, smoke_ms: int) -> int:
    os.environ.setdefault("GST_PLUGIN_FEATURE_RANK", "vah264dec:NONE,vavp9dec:NONE")
    import gi

    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    gi.require_version("WebKit2", "4.1")
    from gi.repository import Gdk, GLib, Gtk, WebKit2  # noqa: E402

    GLib.set_prgname("OnyxTube")
    GLib.set_application_name("OnyxTube")

    win = Gtk.Window(title="OnyxTube Desktop")
    win.set_default_size(1280, 820)
    win.set_size_request(360, 480)

    icon_path = APP_DIR / "onyxtube.svg"
    if icon_path.exists():
        try:
            win.set_icon_from_file(str(icon_path))
        except Exception:
            pass

    data_dir = _default_app_data_dir()
    webview = build_webview(data_dir)

    rgba = Gdk.RGBA()
    rgba.parse("#121316")
    webview.set_background_color(rgba)
    win.add(webview)

    webview.connect("enter-fullscreen", lambda _w: (win.fullscreen(), False)[1])
    webview.connect("leave-fullscreen", lambda _w: (win.unfullscreen(), False)[1])
    shutdown_desktop_shell(win, webview, httpd)

    uri = f"http://127.0.0.1:{actual_port}/"
    manager = webview.get_context().get_website_data_manager()
    loaded = {"done": False}

    def start_load() -> None:
        if not loaded["done"]:
            loaded["done"] = True
            webview.load_uri(uri)

    try:
        manager.clear(
            WebKit2.WebsiteDataTypes.DISK_CACHE | WebKit2.WebsiteDataTypes.MEMORY_CACHE,
            0,
            None,
            lambda *_args: start_load(),
            None,
        )
    except Exception:
        start_load()
    GLib.timeout_add(80, lambda: (start_load(), False)[1])
    win.show_all()

    if smoke_ms > 0:
        GLib.timeout_add(smoke_ms, win.close)

    Gtk.main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)


def _run_pywebview(httpd, actual_port: int, smoke_ms: int) -> int:
    import webview  # type: ignore[import-not-found]

    uri = f"http://127.0.0.1:{actual_port}/"
    window = webview.create_window(
        "OnyxTube Desktop",
        url=uri,
        width=1280,
        height=820,
        min_size=(360, 480),
        background_color="#121316",
    )

    if smoke_ms > 0:
        def _auto_close() -> None:
            time.sleep(smoke_ms / 1000.0)
            try:
                window.destroy()
            except Exception:
                pass

        threading.Thread(target=_auto_close, daemon=True, name="onyxtube-smoke-close").start()

    try:
        webview.start(private_mode=False)
    except Exception:
        return _run_browser_app_fallback(httpd, actual_port, smoke_ms)
    finally:
        if not httpd._BaseServer__is_shut_down if hasattr(httpd, "_BaseServer__is_shut_down") else False:
            try:
                httpd.server_close()
                httpd.shutdown()
            except Exception:
                pass
    return 0


def _find_app_browser() -> str | None:
    sys_name = platform.system()
    candidates: list[str] = []
    if sys_name == "Windows":
        for env_var in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
            base = os.environ.get(env_var)
            if base:
                candidates.extend([
                    str(Path(base) / "Microsoft" / "Edge" / "Application" / "msedge.exe"),
                    str(Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe"),
                    str(Path(base) / "BraveSoftware" / "Brave-Browser" / "Application" / "brave.exe"),
                ])
    elif sys_name == "Darwin":
        candidates.extend([
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ])
    else:
        for cmd in ("google-chrome", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"):
            found = shutil.which(cmd)
            if found:
                candidates.append(found)
    for cand in candidates:
        if cand and Path(cand).is_file():
            return cand
    return None


def _run_browser_app_fallback(httpd, actual_port: int, smoke_ms: int) -> int:
    uri = f"http://127.0.0.1:{actual_port}/"
    if smoke_ms > 0:
        time.sleep(min(smoke_ms / 1000.0, 2.0))
        httpd.server_close()
        httpd.shutdown()
        return 0

    browser_bin = _find_app_browser()
    proc: subprocess.Popen | None = None
    if browser_bin:
        data_dir = _default_app_data_dir() / "app-profile"
        data_dir.mkdir(parents=True, exist_ok=True)
        proc = subprocess.Popen([
            browser_bin,
            f"--app={uri}",
            f"--user-data-dir={data_dir}",
            "--no-first-run",
            "--disable-default-apps",
        ])
        proc.wait()
    else:
        webbrowser.open(uri)
        print(f"OnyxTube berjalan di {uri}. Tekan Ctrl+C untuk keluar.", flush=True)
        try:
            while True:
                time.sleep(1.0)
        except KeyboardInterrupt:
            pass
    try:
        httpd.server_close()
        httpd.shutdown()
    except Exception:
        pass
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="OnyxTube Native Desktop Client")
    parser.add_argument("--port", type=int, default=int(os.environ.get("ONYXTUBE_PORT", DEFAULT_DESKTOP_PORT)))
    parser.add_argument("--smoke-ms", type=int, default=0, help="Auto-close after N ms (smoke testing)")
    parser.add_argument(
        "--backend",
        choices=("auto", "gtk", "pywebview", "browser"),
        default=os.environ.get("ONYXTUBE_BACKEND", "auto"),
        help="Desktop UI backend",
    )
    args = parser.parse_args()

    try:
        httpd, actual_port = start_background_server("127.0.0.1", args.port)
    except OSError:
        httpd, actual_port = start_background_server("127.0.0.1", 0)

    backend = args.backend
    if backend == "auto":
        if _has_gtk_webkit():
            backend = "gtk"
        else:
            try:
                import webview  # noqa: F401

                backend = "pywebview"
            except Exception:
                backend = "browser"

    if backend == "gtk":
        return _run_gtk_webkit(httpd, actual_port, args.smoke_ms)
    if backend == "pywebview":
        return _run_pywebview(httpd, actual_port, args.smoke_ms)
    return _run_browser_app_fallback(httpd, actual_port, args.smoke_ms)


if __name__ == "__main__":
    raise SystemExit(main())
