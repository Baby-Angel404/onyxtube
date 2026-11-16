#!/usr/bin/env python3
"""
OnyxTube Local Server
Provides static desktop UI assets plus local API endpoints:
- /api/trending?tab=all|news|gaming|music|sports|tech
- /api/search?q=<query_or_url>
- /api/subscriptions?channels=UC...,UC...
- /api/stream?id=<11-char-id>
- /api/media?id=<11-char-id>&itag=<format-id> (Range-capable streaming proxy)
- /api/suggest?q=<query>
- /api/comments?id=<11-char-id>
- /api/channel?id=<UC...>
- /api/subtitle?id=<11-char-id>&lang=<code_>
"""
from __future__ import annotations

import argparse
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import gzip
import http.client
import http.server
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from importlib.util import find_spec
from pathlib import Path
from socketserver import ThreadingMixIn

_ORIG_GETADDRINFO = socket.getaddrinfo


def _ipv4_first_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    if family in (0, socket.AF_UNSPEC):
        try:
            res = _ORIG_GETADDRINFO(host, port, socket.AF_INET, type, proto, flags)
            if res:
                return res
        except OSError:
            pass
    return _ORIG_GETADDRINFO(host, port, family, type, proto, flags)


socket.getaddrinfo = _ipv4_first_getaddrinfo  # type: ignore[assignment]

ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
# Only the UI assets the app actually loads; everything else in the project tree stays private.
STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/app.js": "app.js",
    "/styles.css": "styles.css",
    "/tokens.css": "tokens.css",
    "/onyxtube.svg": "onyxtube.svg",
}


def _resolve_ytdlp_cmd() -> list[str]:
    """Locate yt-dlp executable or python -m yt_dlp across Linux, Windows, and macOS."""
    candidates: list[str] = []
    env_bin = os.environ.get("ONYXTUBE_YTDLP", "").strip()
    if env_bin:
        candidates.append(env_bin)
    for exe_name in ("yt-dlp", "yt-dlp.exe"):
        path_bin = shutil.which(exe_name)
        if path_bin:
            candidates.append(path_bin)
    home = Path.home()
    candidates.extend([
        str(home / ".local" / "bin" / "yt-dlp"),
        str(home / ".local" / "bin" / "yt-dlp.exe"),
        "/opt/homebrew/bin/yt-dlp",
        "/usr/local/bin/yt-dlp",
    ])
    if os.name == "nt":
        local_app = Path(os.environ.get("LOCALAPPDATA") or (home / "AppData" / "Local"))
        candidates.append(str(local_app / "Microsoft" / "WinGet" / "Links" / "yt-dlp.exe"))
    for cand in candidates:
        if cand and Path(cand).is_file() and (os.name == "nt" or os.access(cand, os.X_OK)):
            return [cand]
    if not getattr(sys, "frozen", False) and find_spec("yt_dlp") is not None:
        return [sys.executable, "-m", "yt_dlp"]
    return []


def _resolve_ytdlp_bin() -> str:
    cmd = _resolve_ytdlp_cmd()
    return cmd[0] if cmd else (os.environ.get("ONYXTUBE_YTDLP", "").strip() or "yt-dlp")


def _default_app_data_dir() -> Path:
    sys_name = platform.system()
    home = Path.home()
    if sys_name == "Windows":
        base = Path(os.environ.get("LOCALAPPDATA") or (home / "AppData" / "Local"))
        return base / "OnyxTube"
    if sys_name == "Darwin":
        return home / "Library" / "Application Support" / "OnyxTube"
    base = Path(os.environ.get("XDG_DATA_HOME") or (home / ".local" / "share"))
    return base / "onyxtube"


VIDEO_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")
CHANNEL_ID_RE = re.compile(r"^UC[a-zA-Z0-9_-]{20,26}$")
LANG_CODE_RE = re.compile(r"^[a-zA-Z0-9._-]{2,20}$")
INNERTUBE_KEY_RE = re.compile(r'"INNERTUBE_API_KEY":"([^"]+)"')
INNERTUBE_CLIENT = {
    "clientName": "WEB",
    "clientVersion": "2.20241126.01.00",
    "hl": "id",
    "gl": "ID",
}
THUMB_VID_RE = re.compile(r"/vi(?:_webp)?/([a-zA-Z0-9_-]{11})/")
AD_KEYS = ("adSlotRenderer", "promotedSparklesWebRenderer", "promotedVideoRenderer", "searchPyvRenderer")
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

CACHE_LOCK = threading.Lock()
INNERTUBE_API_KEY = ""
FEED_CACHE: dict[str, dict] = {}
STREAM_CACHE: dict[str, tuple[float, dict]] = {}
COMMENTS_CACHE: dict[str, tuple[float, dict]] = {}
CHANNEL_CACHE: dict[str, tuple[float, dict]] = {}
SUGGEST_CACHE: dict[str, tuple[float, list[str]]] = {}
SUBTITLE_REGISTRY: dict[tuple[str, str], dict] = {}
SUBTITLE_DATA_CACHE: dict[tuple[str, str], bytes] = {}
MEDIA_REGISTRY: dict[tuple[str, str], dict] = {}
FEED_TTL_SEC = 600.0
STREAM_TTL_SEC = 3600.0

BLOCK_SIZE = 512 * 1024
SMALL_PROBE_MAX = 128 * 1024
MAX_CACHED_BLOCKS = 64
MAX_PROBE_ENTRIES = 24
MEDIA_EXECUTOR = ThreadPoolExecutor(max_workers=24, thread_name_prefix="onyxtube-stream")
PREFETCH_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="onyxtube-prefetch")
STREAM_LOCK = threading.Lock()
STREAM_BLOCKS: OrderedDict[tuple[str, str, int], "StreamBlock"] = OrderedDict()
PROBE_CACHE: OrderedDict[tuple[str, str, int, int], tuple[bytes, dict]] = OrderedDict()
MEDIA_META_CACHE: dict[tuple[str, str], dict] = {}
RESOLVE_LOCKS: dict[str, threading.Lock] = {}
PREFETCH_LOCK = threading.Lock()
PREFETCH_IN_FLIGHT: set[str] = set()

HTTPS_POOL_LOCK = threading.Lock()
HTTPS_POOL: dict[str, list[http.client.HTTPSConnection]] = {}
RESOLVED_CDN_URLS: dict[tuple[str, str], tuple[float, str]] = {}
CDN_URL_TTL_SEC = 300.0

APP_CACHE_DIR = _default_app_data_dir() / "cache"
PERSISTENT_STREAM_FILE = APP_CACHE_DIR / "stream_cache_v1.json"
YTDLP_STATE_FILE = APP_CACHE_DIR / "ytdlp_state.json"
YTDLP_STATE_LOCK = threading.Lock()
YTDLP_STATE: dict[str, object] = {
    "version": "",
    "binPath": "",
    "updating": False,
    "lastChecked": 0.0,
    "lastResult": "Siap",
}


def _load_persistent_stream_cache() -> None:
    try:
        if not PERSISTENT_STREAM_FILE.is_file():
            return
        raw = json.loads(PERSISTENT_STREAM_FILE.read_text(encoding="utf-8"))
        now = time.time()
        with CACHE_LOCK, STREAM_LOCK:
            for vid, entry in (raw.get("streams") or {}).items():
                ts = float(entry.get("ts") or 0.0)
                if (now - ts) < 2700.0 and isinstance(entry.get("payload"), dict):
                    STREAM_CACHE[vid] = (ts, entry["payload"])
                    for itag, mreg in (entry.get("media") or {}).items():
                        if isinstance(mreg, dict) and mreg.get("url"):
                            MEDIA_REGISTRY[(vid, itag)] = mreg
                    for itag, meta in (entry.get("meta") or {}).items():
                        if isinstance(meta, dict):
                            MEDIA_META_CACHE[(vid, itag)] = meta
    except Exception:
        pass


def _save_persistent_stream_entry(video_id: str, ts: float, payload: dict) -> None:
    try:
        APP_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        now = time.time()
        with CACHE_LOCK, STREAM_LOCK:
            active_vids = [
                k for k, (t, _) in sorted(STREAM_CACHE.items(), key=lambda x: x[1][0], reverse=True)
                if (now - t) < 2700.0
            ][:36]
            out_streams: dict[str, dict] = {}
            for vid in active_vids:
                t_val, pl = STREAM_CACHE[vid]
                media_map = {
                    itag: reg for (v_id, itag), reg in MEDIA_REGISTRY.items() if v_id == vid
                }
                meta_map = {
                    itag: meta for (v_id, itag), meta in MEDIA_META_CACHE.items() if v_id == vid
                }
                out_streams[vid] = {"ts": t_val, "payload": pl, "media": media_map, "meta": meta_map}
        tmp_path = PERSISTENT_STREAM_FILE.with_suffix(".tmp")
        tmp_path.write_text(json.dumps({"streams": out_streams}), encoding="utf-8")
        tmp_path.replace(PERSISTENT_STREAM_FILE)
    except Exception:
        pass


def get_ytdlp_status(run_update: bool = False) -> dict:
    yt_cmd = _resolve_ytdlp_cmd()
    yt_bin = yt_cmd[0] if yt_cmd else ""
    with YTDLP_STATE_LOCK:
        YTDLP_STATE["binPath"] = " ".join(yt_cmd) if yt_cmd else "yt-dlp"
        if not YTDLP_STATE["version"] and yt_cmd:
            try:
                ver = subprocess.check_output([*yt_cmd, "--version"], stderr=subprocess.DEVNULL, text=True, timeout=6).strip()
                YTDLP_STATE["version"] = ver
            except Exception:
                pass
        if not run_update:
            return dict(YTDLP_STATE)
        if YTDLP_STATE["updating"]:
            return dict(YTDLP_STATE)
        YTDLP_STATE["updating"] = True

    msg = ""
    try:
        if not yt_cmd:
            raise RuntimeError("yt-dlp belum terpasang")
        if len(yt_cmd) >= 3 and yt_cmd[1] == "-m":
            proc = subprocess.run([sys.executable, "-m", "pip", "install", "-U", "yt-dlp"], capture_output=True, text=True, timeout=60)
        else:
            proc = subprocess.run([*yt_cmd, "-U"], capture_output=True, text=True, timeout=45)
        out = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
        if proc.returncode != 0 or "pip" in out.lower() or "pipx" in out.lower():
            pipx_bin = shutil.which("pipx")
            if pipx_bin:
                p2 = subprocess.run([pipx_bin, "upgrade", "yt-dlp"], capture_output=True, text=True, timeout=60)
                if p2.returncode == 0:
                    out = ((p2.stdout or "") + "\n" + (p2.stderr or "")).strip() or out
        ver_after = subprocess.check_output([*yt_cmd, "--version"], stderr=subprocess.DEVNULL, text=True, timeout=6).strip()
        last_line = [ln.strip() for ln in out.splitlines() if ln.strip()][-1] if out else "Selesai diperiksa"
        msg = f"Aktif ({ver_after or 'terbaru'}): {last_line[:120]}"
    except Exception as exc:
        msg = f"Pemeriksaan selesai ({exc})"
    finally:
        with YTDLP_STATE_LOCK:
            if ver_after if "ver_after" in locals() and ver_after else False:
                YTDLP_STATE["version"] = ver_after
            YTDLP_STATE["lastChecked"] = time.time()
            YTDLP_STATE["lastResult"] = msg or "Sudah versi terbaru"
            YTDLP_STATE["updating"] = False
            try:
                APP_CACHE_DIR.mkdir(parents=True, exist_ok=True)
                YTDLP_STATE_FILE.write_text(json.dumps(YTDLP_STATE), encoding="utf-8")
            except Exception:
                pass
    with YTDLP_STATE_LOCK:
        return dict(YTDLP_STATE)


def maybe_auto_update_ytdlp_async() -> None:
    def _worker() -> None:
        try:
            if YTDLP_STATE_FILE.is_file():
                saved = json.loads(YTDLP_STATE_FILE.read_text(encoding="utf-8"))
                with YTDLP_STATE_LOCK:
                    YTDLP_STATE["lastChecked"] = float(saved.get("lastChecked") or 0.0)
                    if saved.get("version"):
                        YTDLP_STATE["version"] = str(saved["version"])
                    if saved.get("lastResult"):
                        YTDLP_STATE["lastResult"] = str(saved["lastResult"])
            status = get_ytdlp_status(run_update=False)
            if (time.time() - float(status.get("lastChecked") or 0.0)) > 86400.0:
                get_ytdlp_status(run_update=True)
        except Exception:
            pass

    threading.Thread(target=_worker, daemon=True, name="onyxtube-ytdlp-check").start()


def send_desktop_notification(title: str, body: str) -> bool:
    if os.environ.get("ONYXTUBE_DISABLE_DESKTOP_NOTIFY") == "1" or not title:
        return False
    sys_name = platform.system()
    try:
        if sys_name == "Darwin":
            osascript = shutil.which("osascript")
            if not osascript:
                return False
            t_esc = title[:120].replace('"', '\\"')
            b_esc = body[:240].replace('"', '\\"')
            subprocess.Popen(
                [osascript, "-e", f'display notification "{b_esc}" with title "{t_esc}"'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        if sys_name == "Windows":
            return False
        notify_bin = shutil.which("notify-send")
        if not notify_bin:
            return False
        subprocess.Popen(
            [notify_bin, "-a", "OnyxTube", "-i", "onyxtube", title[:120], body[:240]],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True
    except Exception:
        return False



def _get_https_conn(host: str, timeout: float = 15.0) -> http.client.HTTPSConnection:
    with HTTPS_POOL_LOCK:
        lst = HTTPS_POOL.get(host)
        while lst:
            conn = lst.pop()
            if conn.sock is not None:
                try:
                    conn.sock.settimeout(timeout)
                except Exception:
                    pass
                return conn
    conn = http.client.HTTPSConnection(host, timeout=timeout)

    def _ipv4_connect() -> None:
        infos = socket.getaddrinfo(conn.host, conn.port, socket.AF_INET, socket.SOCK_STREAM)
        af, socktype, proto, _, sa = infos[0]
        sock = socket.socket(af, socktype, proto)
        sock.settimeout(conn.timeout)
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        sock.connect(sa)
        conn.sock = conn._context.wrap_socket(sock, server_hostname=conn.host)

    conn.connect = _ipv4_connect  # type: ignore[method-assign]
    return conn


def _put_https_conn(host: str, conn: http.client.HTTPSConnection) -> None:
    if conn.sock is None:
        return
    with HTTPS_POOL_LOCK:
        lst = HTTPS_POOL.setdefault(host, [])
        if len(lst) < 16:
            lst.append(conn)
            return
    try:
        conn.close()
    except Exception:
        pass


def _invalidate_cdn_url(video_id: str, itag: str) -> None:
    with HTTPS_POOL_LOCK:
        RESOLVED_CDN_URLS.pop((video_id, itag), None)


def _open_upstream_range(
    video_id: str,
    itag: str,
    entry: dict,
    range_header: str,
    timeout: float = 15.0,
) -> tuple[http.client.HTTPSConnection, http.client.HTTPResponse, str]:
    now = time.monotonic()
    url = entry["url"]
    with HTTPS_POOL_LOCK:
        cached = RESOLVED_CDN_URLS.get((video_id, itag))
        if cached and (now - cached[0]) < CDN_URL_TTL_SEC:
            url = cached[1]
    base_headers = {"User-Agent": USER_AGENT, **entry.get("headers", {}), "Range": range_header}

    fresh_retried = False
    for _hop in range(6):
        parsed = urllib.parse.urlsplit(url)
        host = parsed.netloc
        path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        conn = _get_https_conn(host, timeout=timeout)
        try:
            conn.request("GET", path, headers=base_headers)
            resp = conn.getresponse()
            if resp.status in (301, 302, 303, 307, 308):
                loc = resp.getheader("Location")
                resp.read()
                if not getattr(resp, "will_close", False):
                    _put_https_conn(host, conn)
                else:
                    conn.close()
                if loc:
                    url = urllib.parse.urljoin(url, loc)
                    with HTTPS_POOL_LOCK:
                        RESOLVED_CDN_URLS[(video_id, itag)] = (time.monotonic(), url)
                    continue
            return conn, resp, host
        except Exception:
            try:
                conn.close()
            except Exception:
                pass
            if not fresh_retried:
                fresh_retried = True
                _invalidate_cdn_url(video_id, itag)
                url = entry["url"]
                continue
            raise
    raise urllib.error.URLError("Too many redirects from upstream CDN")

CATEGORY_SOURCES = {
    "news": ("url", "https://www.youtube.com/channel/UCYfdidRxbB8Qhf0Nx7ioOYw"),
    "gaming": ("url", "https://www.youtube.com/gaming"),
    "sports": ("url", "https://www.youtube.com/channel/UCEgdi0XIXXZ-qJOFPf4JSKw"),
    "music": ("search", "official music video 2026"),
    "tech": ("search", "linux software engineering hardware review 2026"),
}

CATEGORY_EXTRA_QUERIES = {
    "all": [
        "musik hits terbaru indonesia 2026",
        "berita nasional terkini indonesia",
        "gameplay pc terbaru 2026",
        "review teknologi smartphone laptop 2026",
        "highlight pertandingan olahraga terbaru",
        "documentary science nature 4k",
    ],
    "news": ["berita terkini indonesia hari ini", "world breaking news report", "investigasi berita terbaru"],
    "gaming": ["gameplay pc walkthrough 2026", "esports tournament highlights", "game review trailer 2026"],
    "music": ["official music video trending", "lofi hip hop study beats", "live acoustic session music"],
    "sports": ["football highlights goals 2026", "badminton basketball match highlights", "motorsport highlights"],
    "tech": ["linux programming architecture tutorial", "pc hardware review benchmark", "software engineering talk"],
}


def _http_get_bytes(url: str, headers: dict[str, str] | None = None, timeout: float = 10.0) -> tuple[int, dict, bytes]:
    req_headers = {
        "User-Agent": USER_AGENT,
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip",
    }
    if headers:
        req_headers.update(headers)
    last_exc: Exception | None = None
    for attempt in range(3):
        req = urllib.request.Request(url, headers=req_headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                if resp.headers.get("Content-Encoding", "").lower() == "gzip":
                    raw = gzip.decompress(raw)
                return resp.status, dict(resp.headers), raw
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 429, 500, 502, 503, 504) and attempt < 2:
                last_exc = exc
                time.sleep(0.5 * (attempt + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            if attempt < 2:
                last_exc = exc
                time.sleep(0.5 * (attempt + 1))
                continue
            raise
    raise last_exc if last_exc is not None else RuntimeError("HTTP request failed")


def _http_post_json(url: str, payload: dict, headers: dict[str, str] | None = None, timeout: float = 10.0) -> dict:
    """Send a JSON POST request and decode the JSON response."""
    req_headers = {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip",
    }
    if headers:
        req_headers.update(headers)
    body = json.dumps(payload).encode("utf-8")
    last_exc: Exception | None = None
    for attempt in range(3):
        req = urllib.request.Request(url, data=body, headers=req_headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                if resp.headers.get("Content-Encoding", "").lower() == "gzip":
                    raw = gzip.decompress(raw)
                return json.loads(raw.decode("utf-8", errors="ignore"))
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 429, 500, 502, 503, 504) and attempt < 2:
                last_exc = exc
                time.sleep(0.5 * (attempt + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            if attempt < 2:
                last_exc = exc
                time.sleep(0.5 * (attempt + 1))
                continue
            raise
    raise last_exc if last_exc is not None else RuntimeError("HTTP request failed")


def format_compact_count(value: int | float | None) -> str:
    """Format an integer count compactly in Indonesian style."""
    if not isinstance(value, (int, float)) or value <= 0:
        return ""
    num = float(value)
    if num >= 1_000_000_000:
        return f"{num / 1_000_000_000:.1f} M".replace(".0 ", " ")
    if num >= 1_000_000:
        return f"{num / 1_000_000:.1f} jt".replace(".0 ", " ")
    if num >= 1_000:
        return f"{num / 1_000:.1f} rb".replace(".0 ", " ")
    return str(int(num))


def _join_runs(node: dict | None) -> str:
    if not isinstance(node, dict):
        return ""
    if "simpleText" in node:
        return str(node["simpleText"])
    if "content" in node and isinstance(node["content"], str):
        return node["content"]
    runs = node.get("runs")
    if isinstance(runs, list):
        return "".join(str(r.get("text", "")) for r in runs if isinstance(r, dict))
    return ""


def _extract_browse_id(node: dict | None) -> str:
    if not isinstance(node, dict):
        return ""
    runs = node.get("runs")
    if isinstance(runs, list):
        for r in runs:
            if not isinstance(r, dict):
                continue
            bid = r.get("navigationEndpoint", {}).get("browseEndpoint", {}).get("browseId")
            if isinstance(bid, str) and bid.startswith("UC"):
                return bid
    return ""


def _extract_initial_data(html: str) -> dict | None:
    for marker in ("var ytInitialData = ", 'window["ytInitialData"] = ', "ytInitialData = "):
        idx = html.find(marker)
        if idx == -1:
            continue
        start = html.find("{", idx + len(marker))
        if start == -1:
            continue
        try:
            obj, _ = json.JSONDecoder().raw_decode(html, start)
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            continue
    return None


def _parse_standard_renderer(vr: dict, seen: set[str]) -> dict | None:
    vid = str(vr.get("videoId", ""))
    if not VIDEO_ID_RE.match(vid) or vid in seen:
        return None
    title = _join_runs(vr.get("title"))
    if not title:
        return None
    owner_node = vr.get("ownerText") or vr.get("longBylineText") or vr.get("shortBylineText") or vr.get("bylineText")
    author = _join_runs(owner_node) or "Creator YouTube"
    author_id = _extract_browse_id(owner_node)
    duration = _join_runs(vr.get("lengthText")) or "LIVE"
    views = _join_runs(vr.get("shortViewCountText")) or _join_runs(vr.get("viewCountText"))
    published = _join_runs(vr.get("publishedTimeText"))
    seen.add(vid)
    return {
        "id": vid,
        "title": title,
        "author": author,
        "authorId": author_id,
        "duration": duration,
        "views": views,
        "published": published,
        "thumbnail": f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg",
    }


def _parse_lockup_renderer(lu: dict, seen: set[str]) -> dict | None:
    vid = str(lu.get("contentId", ""))
    if not VIDEO_ID_RE.match(vid):
        raw_str = json.dumps(lu.get("contentImage", {}))
        m = THUMB_VID_RE.search(raw_str)
        if m:
            vid = m.group(1)
    if not VIDEO_ID_RE.match(vid) or vid in seen:
        return None

    meta = lu.get("metadata", {}).get("lockupMetadataViewModel", {})
    title = _join_runs(meta.get("title"))
    if not title:
        return None

    rows = meta.get("metadata", {}).get("contentMetadataViewModel", {}).get("metadataRows", [])
    author = ""
    views = ""
    published = ""
    if len(rows) >= 1 and isinstance(rows[0], dict):
        parts = rows[0].get("metadataParts", [])
        if parts and isinstance(parts[0], dict):
            author = _join_runs(parts[0].get("text"))
    if len(rows) >= 2 and isinstance(rows[1], dict):
        parts = rows[1].get("metadataParts", [])
        if len(parts) >= 1 and isinstance(parts[0], dict):
            views = _join_runs(parts[0].get("text"))
        if len(parts) >= 2 and isinstance(parts[1], dict):
            published = _join_runs(parts[1].get("text"))

    author_id = (
        meta.get("image", {})
        .get("decoratedAvatarViewModel", {})
        .get("rendererContext", {})
        .get("commandContext", {})
        .get("onTap", {})
        .get("innertubeCommand", {})
        .get("browseEndpoint", {})
        .get("browseId", "")
    )
    duration = ""
    overlays = lu.get("contentImage", {}).get("thumbnailViewModel", {}).get("overlays", [])
    for ov in overlays if isinstance(overlays, list) else []:
        badges = ov.get("thumbnailBottomOverlayViewModel", {}).get("badges", [])
        if badges and isinstance(badges[0], dict):
            txt = badges[0].get("thumbnailBadgeViewModel", {}).get("text")
            if txt:
                duration = str(txt)
                break

    seen.add(vid)
    return {
        "id": vid,
        "title": title,
        "author": author.strip() or "Creator YouTube",
        "authorId": author_id if str(author_id).startswith("UC") else "",
        "duration": duration or "Video",
        "views": views,
        "published": published,
        "thumbnail": f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg",
    }


def _collect_videos(node, results: list[dict], seen: set[str], limit: int) -> None:
    if len(results) >= limit:
        return
    if isinstance(node, list):
        for item in node:
            _collect_videos(item, results, seen, limit)
            if len(results) >= limit:
                return
        return
    if not isinstance(node, dict):
        return
    if any(k in node for k in AD_KEYS):
        return

    for key in ("videoRenderer", "gridVideoRenderer", "videoCardRenderer", "compactVideoRenderer"):
        if isinstance(node.get(key), dict):
            item = _parse_standard_renderer(node[key], seen)
            if item:
                results.append(item)
            return

    if isinstance(node.get("lockupViewModel"), dict):
        item = _parse_lockup_renderer(node["lockupViewModel"], seen)
        if item:
            results.append(item)
        return

    for val in node.values():
        _collect_videos(val, results, seen, limit)
        if len(results) >= limit:
            return


def _remember_api_key(html: str) -> str:
    global INNERTUBE_API_KEY
    m = INNERTUBE_KEY_RE.search(html)
    if m:
        key = m.group(1)
        with CACHE_LOCK:
            INNERTUBE_API_KEY = key
        return key
    with CACHE_LOCK:
        return INNERTUBE_API_KEY


def _get_innertube_api_key() -> str:
    with CACHE_LOCK:
        key = INNERTUBE_API_KEY
    if key:
        return key
    _, _, raw = _http_get_bytes("https://www.youtube.com/results?search_query=music", timeout=10.0)
    return _remember_api_key(raw.decode("utf-8", errors="ignore"))


def _extract_feed_continuation(node) -> str:
    """Extract the bottom-of-feed Innertube continuation token from continuationItemRenderer."""
    tokens: list[str] = []
    stack: list[object] = [node]
    while stack:
        cur = stack.pop()
        if isinstance(cur, dict):
            cir = cur.get("continuationItemRenderer")
            if isinstance(cir, dict):
                trigger = str(cir.get("trigger") or "CONTINUATION_TRIGGER_ON_ITEM_SHOWN")
                cmd = (cir.get("continuationEndpoint") or {}).get("continuationCommand") or {}
                tok = cmd.get("token")
                if isinstance(tok, str) and tok and trigger == "CONTINUATION_TRIGGER_ON_ITEM_SHOWN":
                    tokens.append(tok)
            for v in reversed(list(cur.values())):
                if isinstance(v, (dict, list)):
                    stack.append(v)
        elif isinstance(cur, list):
            for item in reversed(cur):
                if isinstance(item, (dict, list)):
                    stack.append(item)
    return tokens[-1] if tokens else ""


def _innertube_continuation(endpoint: str, token: str, api_key: str = "") -> dict:
    key = api_key or _get_innertube_api_key()
    if not key or not token:
        return {}
    return _http_post_json(
        f"https://www.youtube.com/youtubei/v1/{endpoint}?key={key}",
        {"context": {"client": INNERTUBE_CLIENT}, "continuation": token},
        timeout=10.0,
    )


def search_youtube_page(query: str, token: str = "", min_initial: int = 34) -> dict:
    """Fetch paginated YouTube search results with continuation token for infinite scroll."""
    results: list[dict] = []
    seen: set[str] = set()
    next_token = ""
    api_key = ""

    if token:
        resp = _innertube_continuation("search", token)
        if resp:
            _collect_videos(resp, results, seen, 120)
            next_token = _extract_feed_continuation(resp)
            if next_token == token:
                next_token = ""
        return {"query": query, "results": results, "nextToken": next_token, "hasMore": bool(next_token)}

    url = f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(query)}"
    _, _, raw_bytes = _http_get_bytes(url, timeout=10.0)
    html = raw_bytes.decode("utf-8", errors="ignore")
    api_key = _remember_api_key(html)
    data = _extract_initial_data(html)
    if not data:
        return {"query": query, "results": [], "nextToken": "", "hasMore": False}

    _collect_videos(data, results, seen, 120)
    next_token = _extract_feed_continuation(data)

    # Immediately pull page 2 when page 1 has fewer than ~34 items so scrollbars fill right away.
    if next_token and len(results) < min_initial and api_key:
        try:
            resp2 = _innertube_continuation("search", next_token, api_key)
            _collect_videos(resp2, results, seen, 120)
            tok2 = _extract_feed_continuation(resp2)
            next_token = tok2 if tok2 != next_token else ""
        except Exception:
            pass

    return {"query": query, "results": results, "nextToken": next_token, "hasMore": bool(next_token)}


def search_youtube(query: str, limit: int = 36) -> list[dict]:
    page = search_youtube_page(query, "", min_initial=min(limit, 36))
    return page["results"][:limit]


def _fetch_url_with_continuation(url: str, limit: int = 120) -> tuple[list[dict], str, str]:
    _, _, raw_bytes = _http_get_bytes(url, timeout=10.0)
    html = raw_bytes.decode("utf-8", errors="ignore")
    api_key = _remember_api_key(html)
    data = _extract_initial_data(html)
    if not data:
        return [], "", api_key
    results: list[dict] = []
    _collect_videos(data, results, set(), limit)
    return results, _extract_feed_continuation(data), api_key


def _fetch_url_videos(url: str, limit: int = 40) -> list[dict]:
    results, _, _ = _fetch_url_with_continuation(url, limit=limit)
    return results


def fetch_trending_page(tab: str = "all", offset: int = 0, limit: int = 28, force_refresh: bool = False) -> dict:
    """Return a paginated slice of Beranda videos and auto-extend via search continuations on deep scroll."""
    clean_tab = tab if tab in ("all", *CATEGORY_SOURCES.keys()) else "all"
    safe_offset = max(0, offset)
    safe_limit = max(8, min(limit, 48))
    now = time.time()

    with CACHE_LOCK:
        entry = None if force_refresh else FEED_CACHE.get(clean_tab)
        if entry and (now - entry.get("ts", 0.0)) >= FEED_TTL_SEC:
            entry = None

    if entry is None:
        items: list[dict] = []
        seen: set[str] = set()
        cont_token = ""
        cont_endpoint = "search"
        topic_idx = 0

        if clean_tab == "all":
            targets = ["news", "gaming", "music", "sports", "tech"]

            def load_cat(name: str) -> list[dict]:
                kind, target = CATEGORY_SOURCES[name]
                try:
                    if kind == "search":
                        return search_youtube_page(target, "", min_initial=34)["results"]
                    return _fetch_url_with_continuation(target, limit=80)[0]
                except Exception:
                    return []

            with ThreadPoolExecutor(max_workers=5) as pool:
                batches = list(pool.map(load_cat, targets))

            max_len = max((len(b) for b in batches), default=0)
            for idx in range(max_len):
                for batch in batches:
                    if idx < len(batch):
                        item = batch[idx]
                        if item["id"] not in seen:
                            seen.add(item["id"])
                            items.append(item)
        else:
            kind, target = CATEGORY_SOURCES[clean_tab]
            if kind == "search":
                page = search_youtube_page(target, "", min_initial=38)
                for item in page["results"]:
                    if item["id"] not in seen:
                        seen.add(item["id"])
                        items.append(item)
                cont_token = page["nextToken"]
                cont_endpoint = "search"
            else:
                vids, tok, _ = _fetch_url_with_continuation(target, limit=120)
                for item in vids:
                    if item["id"] not in seen:
                        seen.add(item["id"])
                        items.append(item)
                cont_token = tok
                cont_endpoint = "browse"
                extra_list = CATEGORY_EXTRA_QUERIES.get(clean_tab, [])
                if len(items) < 42 and extra_list:
                    try:
                        extra_page = search_youtube_page(extra_list[0], "", min_initial=34)
                        topic_idx = 1
                        for item in extra_page["results"]:
                            if item["id"] not in seen:
                                seen.add(item["id"])
                                items.append(item)
                        if not cont_token and extra_page["nextToken"]:
                            cont_token = extra_page["nextToken"]
                            cont_endpoint = "search"
                    except Exception:
                        pass

        entry = {
            "ts": now,
            "items": items,
            "seen": seen,
            "cont_token": cont_token,
            "cont_endpoint": cont_endpoint,
            "topic_idx": topic_idx,
            "lock": threading.Lock(),
        }
        if items:
            with CACHE_LOCK:
                FEED_CACHE[clean_tab] = entry

    extra_topics = CATEGORY_EXTRA_QUERIES.get(clean_tab, [])
    with entry["lock"]:
        while len(entry["items"]) < safe_offset + safe_limit:
            added = 0
            tok = entry.get("cont_token") or ""
            ep = entry.get("cont_endpoint") or "search"
            if tok:
                try:
                    resp = _innertube_continuation(ep, tok)
                    batch: list[dict] = []
                    _collect_videos(resp, batch, set(entry["seen"]), 120)
                    for item in batch:
                        if item["id"] not in entry["seen"]:
                            entry["seen"].add(item["id"])
                            entry["items"].append(item)
                            added += 1
                    new_tok = _extract_feed_continuation(resp)
                    entry["cont_token"] = new_tok if new_tok and new_tok != tok else ""
                except Exception:
                    entry["cont_token"] = ""
            if added == 0 and not entry.get("cont_token"):
                tidx = int(entry.get("topic_idx") or 0)
                if tidx >= len(extra_topics):
                    break
                entry["topic_idx"] = tidx + 1
                try:
                    page = search_youtube_page(extra_topics[tidx], "", min_initial=36)
                    for item in page["results"]:
                        if item["id"] not in entry["seen"]:
                            entry["seen"].add(item["id"])
                            entry["items"].append(item)
                            added += 1
                    entry["cont_token"] = page["nextToken"]
                    entry["cont_endpoint"] = "search"
                except Exception:
                    pass
                if added == 0 and not entry.get("cont_token"):
                    continue
            elif added == 0:
                break

        slice_items = list(entry["items"][safe_offset : safe_offset + safe_limit])
        next_offset = safe_offset + len(slice_items)
        has_more = (
            next_offset < len(entry["items"])
            or bool(entry.get("cont_token"))
            or int(entry.get("topic_idx") or 0) < len(extra_topics)
        )

    return {
        "tab": clean_tab,
        "results": slice_items,
        "offset": safe_offset,
        "nextOffset": next_offset,
        "hasMore": has_more,
    }


def fetch_trending(tab: str = "all", force_refresh: bool = False) -> list[dict]:
    return fetch_trending_page(tab, offset=0, limit=30, force_refresh=force_refresh)["results"]


def fetch_subscriptions(channel_ids: list[str]) -> list[dict]:
    valid_ids = [cid.strip() for cid in channel_ids if re.fullmatch(r"UC[a-zA-Z0-9_-]{10,40}", cid.strip())][:24]
    if not valid_ids:
        return []

    ns = {
        "a": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
        "media": "http://search.yahoo.com/mrss/",
    }

    def fetch_one(cid: str) -> list[dict]:
        with CACHE_LOCK:
            ch_cached = CHANNEL_CACHE.get(cid)
            if ch_cached and (time.monotonic() - ch_cached[0]) < 600.0:
                ch_vids = list((ch_cached[1] or {}).get("videos") or [])[:8]
                if ch_vids:
                    out_cached: list[dict] = []
                    for idx, v in enumerate(ch_vids):
                        item = dict(v)
                        item["authorId"] = cid
                        item.setdefault("publishedIso", f"0000-00-00T00:00:{8 - idx:02d}Z")
                        out_cached.append(item)
                    return out_cached

        items: list[dict] = []
        try:
            _, _, raw = _http_get_bytes(f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}", timeout=5.5)
            root = ET.fromstring(raw)
            channel_title = (root.findtext("a:title", default="", namespaces=ns) or "").strip()
            for entry in root.findall("a:entry", ns)[:8]:
                vid = (entry.findtext("yt:videoId", default="", namespaces=ns) or "").strip()
                if not VIDEO_ID_RE.match(vid):
                    continue
                title = (entry.findtext("a:title", default="", namespaces=ns) or "").strip()
                published = (entry.findtext("a:published", default="", namespaces=ns) or "").strip()
                stats_el = entry.find("media:group/media:community/media:statistics", ns)
                views_num = int(stats_el.attrib.get("views", "0")) if stats_el is not None else 0
                views_str = f"{views_num:,} x ditonton" if views_num else ""
                items.append({
                    "id": vid,
                    "title": title,
                    "author": channel_title or "Channel Langganan",
                    "authorId": cid,
                    "duration": "Rilis",
                    "views": views_str,
                    "published": published[:10] if published else "",
                    "publishedIso": published,
                    "thumbnail": f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg",
                })
        except Exception:
            items = []

        if items:
            return items

        try:
            _, _, html_bytes = _http_get_bytes(f"https://www.youtube.com/channel/{cid}/videos?hl=id", timeout=8.0)
            html = html_bytes.decode("utf-8", errors="ignore")
            data = _extract_initial_data(html)
            if data:
                channel_title = (
                    data.get("metadata", {}).get("channelMetadataRenderer", {}).get("title")
                    or data.get("header", {}).get("pageHeaderRenderer", {}).get("pageTitle")
                    or ""
                ).strip()
                scraped: list[dict] = []
                _collect_videos(data, scraped, set(), 8)
                for idx, item in enumerate(scraped):
                    raw_author = item.get("author", "")
                    if not item.get("views") and raw_author and raw_author != channel_title:
                        item["views"] = raw_author
                    if channel_title:
                        item["author"] = channel_title
                    elif item.get("author") == raw_author:
                        item["author"] = "Channel Langganan"
                    item["authorId"] = cid
                    item["publishedIso"] = f"0000-00-00T00:00:{8 - idx:02d}Z"
                if scraped:
                    return scraped
        except Exception:
            pass

        with CACHE_LOCK:
            fallback_vids = [
                {
                    "id": vdata.get("id", vid_key),
                    "title": vdata.get("title", "Video Channel"),
                    "author": vdata.get("author", "Channel Langganan"),
                    "authorId": cid,
                    "duration": vdata.get("duration", "Video"),
                    "views": vdata.get("views", ""),
                    "published": vdata.get("published", ""),
                    "publishedIso": "0000-00-00T00:00:01Z",
                    "thumbnail": vdata.get("thumbnail") or f"https://i.ytimg.com/vi/{vid_key}/mqdefault.jpg",
                }
                for vid_key, (_, vdata) in STREAM_CACHE.items()
                if isinstance(vdata, dict) and vdata.get("authorId") == cid
            ]
        return fallback_vids[:8]

    with ThreadPoolExecutor(max_workers=6) as pool:
        all_batches = list(pool.map(fetch_one, valid_ids))

    combined = [item for batch in all_batches for item in batch]
    combined.sort(key=lambda x: x.get("publishedIso", ""), reverse=True)
    return combined[:48]


WATCH_COMMENT_TOKENS: dict[str, tuple[str, str]] = {}


def _fetch_watch_related(video_id: str) -> list[dict]:
    try:
        _, _, raw = _http_get_bytes(f"https://www.youtube.com/watch?v={video_id}&hl=id", timeout=7.0)
        html = raw.decode("utf-8", errors="ignore")
        api_key = _remember_api_key(html)
        data = _extract_initial_data(html)
        if not data:
            return []
        ctok = _find_comment_continuation(data)
        if api_key and ctok:
            with CACHE_LOCK:
                if len(WATCH_COMMENT_TOKENS) > 120:
                    WATCH_COMMENT_TOKENS.clear()
                WATCH_COMMENT_TOKENS[video_id] = (api_key, ctok)
        related: list[dict] = []
        _collect_videos(data, related, {video_id}, 14)
        return related
    except Exception:
        return []


def _fetch_sponsorblock(video_id: str) -> list[dict]:
    try:
        cats = json.dumps(["sponsor", "selfpromo", "intro", "outro", "interaction"])
        url = f"https://sponsor.ajay.app/api/skipSegments?videoID={video_id}&categories={urllib.parse.quote(cats)}"
        _, _, raw = _http_get_bytes(url, timeout=3.0)
        data = json.loads(raw.decode("utf-8", errors="replace"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _extract_fast_android_info(video_id: str) -> dict | None:
    """Resolve direct HTTPS video/audio formats and captions via ANDROID Innertube in ~0.3s."""
    try:
        payload = {
            "videoId": video_id,
            "context": {
                "client": {
                    "clientName": "ANDROID",
                    "clientVersion": "20.10.38",
                    "androidSdkVersion": 34,
                    "hl": "id",
                    "gl": "ID",
                }
            },
            "contentCheckOk": True,
            "racyCheckOk": True,
        }
        ua = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip"
        data = _http_post_json(
            "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
            payload,
            headers={"User-Agent": ua},
            timeout=5.0,
        )
        sd = data.get("streamingData") or {}
        raw_fmts = (sd.get("formats") or []) + (sd.get("adaptiveFormats") or [])
        formats: list[dict] = []
        for f in raw_fmts:
            url = f.get("url")
            if not url:
                continue
            mime_raw = str(f.get("mimeType") or "")
            mime_base = mime_raw.split(";")[0].strip().lower()
            codecs_part = mime_raw.split("codecs=")[1].strip('" ') if "codecs=" in mime_raw else ""
            if mime_base.startswith("audio/"):
                vcodec = "none"
                acodec = codecs_part or "opus"
                ext = "m4a" if "mp4" in mime_base else "webm"
            else:
                ext = "mp4" if "mp4" in mime_base else "webm"
                if "," in codecs_part:
                    parts = [c.strip() for c in codecs_part.split(",", 1)]
                    vcodec, acodec = parts[0], parts[1]
                else:
                    vcodec = codecs_part or ("vp9" if ext == "webm" else "avc1")
                    acodec = "none"
            clen = f.get("contentLength")
            filesize = int(clen) if str(clen or "").isdigit() else None
            raw_itag = str(f.get("itag") or "")
            atrack = f.get("audioTrack") if isinstance(f.get("audioTrack"), dict) else {}
            is_drc = bool(f.get("isDrc") or "drc=1" in url)
            is_dub = bool(
                ("acont=dubbed" in url)
                or (atrack and not atrack.get("audioIsDefault", True))
            )
            if is_dub:
                continue
            fid = f"{raw_itag}-drc" if is_drc else raw_itag
            formats.append({
                "protocol": "https",
                "url": url,
                "format_id": fid,
                "ext": ext,
                "vcodec": vcodec,
                "acodec": acodec,
                "height": int(f.get("height") or 0),
                "abr": float(f.get("bitrate") or 0) / 1000.0,
                "filesize": filesize,
                "http_headers": {"User-Agent": ua},
            })
        if len(formats) < 2:
            return None
        vd = data.get("videoDetails") or {}
        dur_sec = int(vd.get("lengthSeconds") or 0) if str(vd.get("lengthSeconds") or "").isdigit() else 0
        m, s = divmod(dur_sec, 60)
        h, m = divmod(m, 60)
        dur_str = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
        thumbs = ((vd.get("thumbnail") or {}).get("thumbnails") or [])
        thumb_url = str(thumbs[-1].get("url") or "") if thumbs else f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
        subtitles: dict[str, list[dict]] = {}
        auto_caps: dict[str, list[dict]] = {}
        cap_tracks = ((data.get("captions") or {}).get("playerCaptionsTracklistRenderer") or {}).get("captionTracks") or []
        for tr in cap_tracks:
            if not isinstance(tr, dict):
                continue
            lang = str(tr.get("languageCode") or "").strip()
            burl = str(tr.get("baseUrl") or "").strip()
            if not lang or not burl:
                continue
            name_obj = tr.get("name") or {}
            name = str(name_obj.get("simpleText") or _join_runs(name_obj) or lang)
            target = auto_caps if tr.get("kind") == "asr" else subtitles
            target.setdefault(lang, []).append({"ext": "srv1", "url": burl, "name": name})
        return {
            "formats": formats,
            "title": vd.get("title") or "Video Tanpa Judul",
            "uploader": vd.get("author") or "Creator",
            "channel_id": vd.get("channelId") or "",
            "duration": dur_sec,
            "duration_string": dur_str if dur_sec else "",
            "view_count": int(vd.get("viewCount") or 0) if str(vd.get("viewCount") or "").isdigit() else 0,
            "like_count": 0,
            "description": vd.get("shortDescription") or "",
            "thumbnail": thumb_url,
            "subtitles": subtitles,
            "automatic_captions": auto_caps,
            "chapters": [],
        }
    except Exception:
        return None


YTDLP_UPGRADE_IN_FLIGHT: set[str] = set()


def _run_ytdlp_json(video_id: str) -> dict:
    yt_cmd = _resolve_ytdlp_cmd()
    if not yt_cmd:
        try:
            import yt_dlp  # type: ignore[import-not-found]

            opts = {
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
                "skip_download": True,
                "cachedir": str(APP_CACHE_DIR / "ytdlp"),
            }
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
        except Exception as exc:
            raise RuntimeError(
                "yt-dlp tidak ditemukan. Pasang yt-dlp (pip install yt-dlp / pipx install yt-dlp) "
                "atau set ONYXTUBE_YTDLP ke path binary-nya, lalu mulai ulang aplikasi."
            ) from exc
    cmd = [
        *yt_cmd,
        "--force-ipv4",
        "--no-warnings",
        "--no-playlist",
        "--cache-dir",
        str(APP_CACHE_DIR / "ytdlp"),
        "--extractor-args",
        "youtube:player_skip=hls,dash,configs",
        "-J",
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.PIPE, text=True, timeout=22)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"yt-dlp gagal (exit {exc.returncode}): {(exc.stderr or '').strip()[-400:]}") from exc
    return json.loads(out)


def resolve_stream(video_id: str, force_refresh: bool = False) -> dict:
    if not VIDEO_ID_RE.match(video_id):
        raise ValueError("Video ID tidak valid.")

    with CACHE_LOCK:
        vlock = RESOLVE_LOCKS.setdefault(video_id, threading.RLock())
        if not force_refresh:
            cached = STREAM_CACHE.get(video_id)
            if cached and (time.time() - cached[0]) < STREAM_TTL_SEC:
                return cached[1]

    with vlock:
        now = time.time()
        if not force_refresh:
            with CACHE_LOCK:
                cached = STREAM_CACHE.get(video_id)
                if cached and (now - cached[0]) < STREAM_TTL_SEC:
                    return cached[1]
        return _resolve_stream_locked(video_id, now, force_ytdlp=force_refresh)


def _resolve_stream_locked(video_id: str, now: float, force_ytdlp: bool = False) -> dict:
    with CACHE_LOCK:
        prev_entry = STREAM_CACHE.get(video_id)
    prev_payload = prev_entry[1] if prev_entry else None

    def run_extractor() -> dict:
        if not force_ytdlp:
            fast_info = _extract_fast_android_info(video_id)
            if fast_info is not None:
                return fast_info
        return _run_ytdlp_json(video_id)

    if force_ytdlp and isinstance(prev_payload, dict):
        info = run_extractor()
        related = prev_payload.get("related") or []
        segments = prev_payload.get("sponsorSegments") or []
    else:
        with ThreadPoolExecutor(max_workers=3) as pool:
            fut_yt = pool.submit(run_extractor)
            fut_rel = pool.submit(_fetch_watch_related, video_id)
            fut_sb = pool.submit(_fetch_sponsorblock, video_id)
            info = fut_yt.result(timeout=24)
            try:
                related = fut_rel.result(timeout=7.0)
            except Exception:
                related = []
            try:
                segments = fut_sb.result(timeout=3.5)
            except Exception:
                segments = []

    formats = [f for f in (info.get("formats") or []) if f.get("protocol") == "https" and f.get("url")]

    with HTTPS_POOL_LOCK:
        for k in [k for k in RESOLVED_CDN_URLS if k[0] == video_id]:
            RESOLVED_CDN_URLS.pop(k, None)

    # Prefer WebM Opus non-DRC audio (Matroska Cues enable single-hop seeks); fallback cleanly to M4A
    all_audio = [
        f for f in formats
        if f.get("vcodec") == "none" and f.get("acodec") not in (None, "none")
    ]
    all_audio.sort(
        key=lambda f: (
            0 if int(f.get("preference") or 0) < -5 else 1,
            2 if f.get("ext") == "webm" else (1 if f.get("ext") == "m4a" else 0),
            0 if str(f.get("format_id") or "").endswith("-drc") else 1,
            float(f.get("abr") or 0),
        ),
        reverse=True,
    )
    best_audio = all_audio[0] if all_audio else None

    for af in reversed(all_audio):
        raw_afid = str(af.get("format_id", "aud"))
        base_afid = raw_afid.split("-")[0]
        amime = "audio/mp4" if af.get("ext") == "m4a" else f"audio/{af.get('ext', 'webm')}"
        aentry = {
            "url": af["url"],
            "headers": af.get("http_headers") or {},
            "mime": amime,
        }
        afs = af.get("filesize")
        with CACHE_LOCK:
            MEDIA_REGISTRY[(video_id, raw_afid)] = aentry
            if base_afid:
                MEDIA_REGISTRY[(video_id, base_afid)] = aentry
        if isinstance(afs, int) and afs > 0:
            with STREAM_LOCK:
                MEDIA_META_CACHE[(video_id, raw_afid)] = {"total_size": afs, "content_type": amime}
                if base_afid:
                    MEDIA_META_CACHE[(video_id, base_afid)] = {"total_size": afs, "content_type": amime}

    audio_url = ""
    if best_audio:
        raw_best_afid = str(best_audio.get("format_id", "aud"))
        afid = raw_best_afid.split("-")[0] or raw_best_afid
        audio_mime = "audio/mp4" if best_audio.get("ext") == "m4a" else f"audio/{best_audio.get('ext', 'webm')}"
        best_aentry = {
            "url": best_audio["url"],
            "headers": best_audio.get("http_headers") or {},
            "mime": audio_mime,
        }
        with CACHE_LOCK:
            MEDIA_REGISTRY[(video_id, raw_best_afid)] = best_aentry
            MEDIA_REGISTRY[(video_id, afid)] = best_aentry
            MEDIA_REGISTRY.setdefault((video_id, "251"), best_aentry)
            MEDIA_REGISTRY.setdefault((video_id, "140"), best_aentry)
        afs = best_audio.get("filesize")
        if isinstance(afs, int) and afs > 0:
            with STREAM_LOCK:
                MEDIA_META_CACHE[(video_id, raw_best_afid)] = {"total_size": afs, "content_type": audio_mime}
                MEDIA_META_CACHE[(video_id, afid)] = {"total_size": afs, "content_type": audio_mime}
        audio_url = f"/api/media?id={video_id}&itag={urllib.parse.quote(afid)}"

    # Prefer Cues-indexed WebM VP9 (single-hop seek, 0 moof scanning) and muxed MP4; fallback to AVC1 H.264 MP4
    by_height: dict[int, dict] = {}
    for f in formats:
        vcodec = str(f.get("vcodec") or "none")
        if vcodec == "none":
            continue
        height = int(f.get("height") or 0)
        if height <= 0 or height > 1080:
            continue
        ext = str(f.get("ext") or "")
        raw_vfid = str(f.get("format_id", f"v{height}"))
        fid = raw_vfid.split("-")[0] or raw_vfid
        is_muxed = str(f.get("acodec") or "none") != "none"
        is_vp9 = ext == "webm" and vcodec.startswith("vp9")
        is_avc = ext == "mp4" and vcodec.startswith("avc")
        is_sr = raw_vfid.endswith("-sr")
        vmime = "video/mp4" if ext == "mp4" else "video/webm"
        ventry = {
            "url": f["url"],
            "headers": f.get("http_headers") or {},
            "mime": vmime,
        }
        vfs = f.get("filesize")
        with CACHE_LOCK:
            MEDIA_REGISTRY[(video_id, raw_vfid)] = ventry
            if not is_sr or (video_id, fid) not in MEDIA_REGISTRY:
                MEDIA_REGISTRY[(video_id, fid)] = ventry
        if isinstance(vfs, int) and vfs > 0:
            with STREAM_LOCK:
                MEDIA_META_CACHE[(video_id, raw_vfid)] = {"total_size": vfs, "content_type": vmime}
                if not is_sr or (video_id, fid) not in MEDIA_META_CACHE:
                    MEDIA_META_CACHE[(video_id, fid)] = {"total_size": vfs, "content_type": vmime}
        if not (is_vp9 or is_avc or is_muxed) and height in by_height:
            continue
        prev = by_height.get(height)
        score = (6 if is_vp9 else (3 if is_avc else 1)) + (1.5 if is_muxed else 0) + (0 if is_sr else 0.3)
        if not prev or score > prev["_score"]:
            by_height[height] = {
                "_score": score,
                "fid": fid,
                "label": f"{height}p",
                "height": height,
                "muxed": is_muxed,
                "url": f["url"],
                "headers": f.get("http_headers") or {},
                "mime": vmime,
                "filesize": vfs,
            }

    qualities: list[dict] = []
    for height in sorted(by_height.keys(), reverse=True):
        entry = by_height[height]
        fid = entry["fid"]
        with CACHE_LOCK:
            MEDIA_REGISTRY[(video_id, fid)] = {
                "url": entry["url"],
                "headers": entry["headers"],
                "mime": entry["mime"],
            }
        vfs = entry.get("filesize")
        if isinstance(vfs, int) and vfs > 0:
            with STREAM_LOCK:
                MEDIA_META_CACHE[(video_id, fid)] = {"total_size": vfs, "content_type": entry["mime"]}
        qualities.append({
            "itag": fid,
            "label": entry["label"],
            "height": height,
            "muxed": entry["muxed"],
            "videoUrl": f"/api/media?id={video_id}&itag={urllib.parse.quote(fid)}",
            "audioUrl": "" if entry["muxed"] else audio_url,
        })

    if not qualities and audio_url:
        qualities.append({
            "itag": "audio",
            "label": "Audio",
            "height": 0,
            "muxed": True,
            "videoUrl": audio_url,
            "audioUrl": "",
        })

    if not qualities:
        raise RuntimeError("Tidak ada stream HTML5 yang tersedia untuk video ini.")

    # Pick highest <= 720p for crisp fast startup
    default_q = next((q for q in qualities if q["height"] <= 720), qualities[-1])

    duration_sec = int(info.get("duration") or 0)
    view_count = int(info.get("view_count") or 0)
    like_count = int(info.get("like_count") or 0)
    follower_count = info.get("channel_follower_count") or info.get("follower_count")
    chapters = _extract_chapters(info)
    existing_caps = (prev_payload or {}).get("captions") if force_ytdlp and isinstance(prev_payload, dict) else None
    captions = existing_caps if existing_caps else _extract_caption_tracks(video_id, info)
    payload = {
        "id": video_id,
        "title": str(info.get("title") or "Video Tanpa Judul"),
        "author": str(info.get("uploader") or info.get("channel") or "Creator"),
        "authorId": str(info.get("channel_id") or ""),
        "durationSec": duration_sec,
        "duration": info.get("duration_string") or "",
        "views": f"{view_count:,} x ditonton" if view_count else "",
        "likeCount": like_count,
        "likeCountText": format_compact_count(like_count),
        "followerCountText": format_compact_count(follower_count),
        "published": str(info.get("upload_date") or ""),
        "description": str(info.get("description") or "")[:3000],
        "thumbnail": str(info.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"),
        "qualities": qualities,
        "defaultItag": default_q["itag"],
        "sponsorSegments": segments,
        "chapters": chapters,
        "captions": captions,
        "related": related,
    }
    with CACHE_LOCK:
        STREAM_CACHE[video_id] = (now, payload)
    _save_persistent_stream_entry(video_id, now, payload)
    return payload


def _extract_chapters(info: dict) -> list[dict]:
    """Extract sorted chapter markers from yt-dlp video metadata."""
    chapters: list[dict] = []
    for ch in info.get("chapters") or []:
        if not isinstance(ch, dict):
            continue
        title = str(ch.get("title") or "").strip()
        start = float(ch.get("start_time") or 0)
        end = float(ch.get("end_time") or 0)
        if title and end > start:
            chapters.append({"title": title, "startTime": round(start, 2), "endTime": round(end, 2)})
    return chapters


def _extract_caption_tracks(video_id: str, info: dict) -> list[dict]:
    """Extract WebVTT subtitle tracks and register them for local same-origin serving."""
    raw_tracks: list[tuple[str, bool, str, str, str]] = []
    for auto_flag, source_key in ((False, "subtitles"), (True, "automatic_captions")):
        src_map = info.get(source_key) or {}
        if not isinstance(src_map, dict):
            continue
        for lang, variants in src_map.items():
            if not LANG_CODE_RE.match(str(lang)) or not isinstance(variants, list):
                continue
            chosen = next((v for v in variants if v.get("ext") == "vtt" and v.get("url") and "tlang=" not in str(v.get("url"))), None)
            if not chosen:
                chosen = next((v for v in variants if v.get("ext") in ("srt", "srv1") and v.get("url") and "tlang=" not in str(v.get("url"))), None)
            if not chosen:
                continue
            base_name = str(chosen.get("name") or lang)
            label = f"{base_name} (Otomatis)" if auto_flag and "(auto" not in base_name.lower() else base_name
            raw_tracks.append((str(lang), auto_flag, label, str(chosen["url"]), str(chosen.get("ext") or "vtt")))

    seen_langs: set[str] = set()
    ordered: list[dict] = []

    def _priority(item: tuple[str, bool, str, str, str]) -> tuple[int, int, str]:
        lang, is_auto = item[0], item[1]
        base = lang.split("-")[0].lower()
        pref = 0 if lang == "id" else (1 if base == "id" else (2 if lang in ("en", "en-orig") else (3 if base == "en" else 4)))
        return (1 if is_auto else 0, pref, lang)

    for lang, is_auto, label, url, ext in sorted(raw_tracks, key=_priority):
        if lang in seen_langs:
            continue
        seen_langs.add(lang)
        with CACHE_LOCK:
            SUBTITLE_REGISTRY[(video_id, lang)] = {"url": url, "ext": ext, "label": label}
        ordered.append({
            "lang": lang,
            "label": label,
            "auto": is_auto,
            "url": f"/api/subtitle?id={video_id}&lang={urllib.parse.quote(lang)}",
        })
        if len(ordered) >= 18:
            break
    return ordered


def _format_vtt_ts(sec: float) -> str:
    total_ms = max(0, int(round(sec * 1000)))
    h, rem = divmod(total_ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def _convert_to_webvtt(raw: bytes, ext: str) -> bytes:
    text = raw.decode("utf-8", errors="ignore").lstrip("\ufeff")
    if text.startswith("WEBVTT"):
        return text.encode("utf-8")
    if ext == "srv1" or text.lstrip().startswith("<"):
        try:
            root = ET.fromstring(text)
            lines = ["WEBVTT", ""]
            for el in root.findall(".//text"):
                start = float(el.attrib.get("start") or 0)
                dur = float(el.attrib.get("dur") or 2.0)
                body = "".join(el.itertext()).strip()
                if body:
                    lines.append(f"{_format_vtt_ts(start)} --> {_format_vtt_ts(start + max(0.2, dur))}")
                    lines.append(body)
                    lines.append("")
            return "\n".join(lines).encode("utf-8")
        except Exception:
            pass
    converted = re.sub(r"(\d{2}:\d{2}:\d{2}),(\d{3})", r"\1.\2", text)
    return ("WEBVTT\n\n" + converted).encode("utf-8")


def fetch_subtitle_vtt(video_id: str, lang: str) -> bytes:
    """Fetch and cache a same-origin WebVTT subtitle track for a video."""
    with CACHE_LOCK:
        cached = SUBTITLE_DATA_CACHE.get((video_id, lang))
        entry = SUBTITLE_REGISTRY.get((video_id, lang))
    if cached is not None:
        return cached
    if entry is None:
        resolve_stream(video_id)
        with CACHE_LOCK:
            entry = SUBTITLE_REGISTRY.get((video_id, lang))
    if entry is None:
        raise KeyError("Track subtitle tidak ditemukan.")
    _, _, raw = _http_get_bytes(entry["url"], timeout=8.0)
    vtt = _convert_to_webvtt(raw, entry.get("ext", "vtt"))
    with CACHE_LOCK:
        if len(SUBTITLE_DATA_CACHE) > 80:
            SUBTITLE_DATA_CACHE.clear()
        SUBTITLE_DATA_CACHE[(video_id, lang)] = vtt
    return vtt


def fetch_search_suggestions(query: str) -> list[str]:
    """Fetch clean YouTube search autocomplete suggestions."""
    clean = query.strip()
    if not clean or len(clean) > 120:
        return []
    key = clean.lower()
    now = time.monotonic()
    with CACHE_LOCK:
        cached = SUGGEST_CACHE.get(key)
        if cached and (now - cached[0]) < 300.0:
            return cached[1]
    url = f"https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=id&q={urllib.parse.quote_plus(clean)}"
    _, _, raw = _http_get_bytes(url, timeout=4.0)
    parsed = json.loads(raw.decode("utf-8", errors="ignore"))
    items = [str(s) for s in (parsed[1][:10] if len(parsed) > 1 and isinstance(parsed[1], list) else []) if isinstance(s, str)]
    with CACHE_LOCK:
        if len(SUGGEST_CACHE) > 200:
            SUGGEST_CACHE.clear()
        SUGGEST_CACHE[key] = (now, items)
    return items


def _find_comment_continuation(data: dict) -> str:
    """Locate the YouTube comment section continuation token inside ytInitialData."""
    preferred: list[str] = []
    fallback: list[str] = []
    stack: list[tuple[object, bool]] = [(data, False)]
    while stack:
        node, in_comments = stack.pop()
        if isinstance(node, dict):
            sec_id = node.get("sectionIdentifier") or node.get("panelIdentifier") or node.get("targetId") or ""
            is_comment_ctx = in_comments or ("comment" in str(sec_id).lower())
            cmd = node.get("continuationCommand")
            if isinstance(cmd, dict) and isinstance(cmd.get("token"), str):
                tok = cmd["token"]
                if is_comment_ctx:
                    preferred.append(tok)
                else:
                    fallback.append(tok)
            for v in node.values():
                if isinstance(v, (dict, list)):
                    stack.append((v, is_comment_ctx))
        elif isinstance(node, list):
            for item in node:
                if isinstance(item, (dict, list)):
                    stack.append((item, in_comments))
    if preferred:
        return preferred[0]
    return ""


def _find_next_comments_continuation(resp: dict) -> str:
    """Locate the main comments pagination token (excluding reply-thread buttons)."""
    endpoints = resp.get("onResponseReceivedEndpoints") or []
    for ep in endpoints:
        if not isinstance(ep, dict):
            continue
        cmd = ep.get("reloadContinuationItemsCommand") or ep.get("appendContinuationItemsAction") or {}
        if not isinstance(cmd, dict):
            continue
        citems = cmd.get("continuationItems") or []
        for item in reversed(citems):
            if not isinstance(item, dict):
                continue
            cir = item.get("continuationItemRenderer")
            if isinstance(cir, dict) and not cir.get("button"):
                tok = ((cir.get("continuationEndpoint") or {}).get("continuationCommand") or {}).get("token")
                if isinstance(tok, str) and tok:
                    return tok
    return ""


def fetch_video_comments_page(video_id: str, token: str = "", limit: int = 24) -> dict:
    """Fetch paginated public comments for a video via Innertube /next."""
    now = time.monotonic()
    clean_tok = (token or "").strip()
    if not clean_tok:
        with CACHE_LOCK:
            cached = COMMENTS_CACHE.get(video_id)
            if cached and (now - cached[0]) < 300.0:
                return cached[1]

    api_key = ""
    use_tok = clean_tok
    if not use_tok:
        with CACHE_LOCK:
            pre_tok = WATCH_COMMENT_TOKENS.get(video_id)
        if pre_tok:
            api_key, use_tok = pre_tok
        else:
            _, _, raw = _http_get_bytes(f"https://www.youtube.com/watch?v={video_id}&hl=id", timeout=9.0)
            html = raw.decode("utf-8", errors="ignore")
            api_key = _remember_api_key(html)
            data = _extract_initial_data(html)
            if not api_key or not data:
                return {"comments": [], "nextToken": "", "hasMore": False}
            use_tok = _find_comment_continuation(data)
            if not use_tok:
                return {"comments": [], "nextToken": "", "hasMore": False}

    try:
        resp = _innertube_continuation("next", use_tok, api_key)
    except urllib.error.HTTPError:
        return {"comments": [], "nextToken": "", "hasMore": False}

    comments: list[dict] = []
    seen: set[str] = set()
    mutations = ((resp.get("frameworkUpdates") or {}).get("entityBatchUpdate") or {}).get("mutations") or []
    for mut in mutations:
        payload = ((mut or {}).get("payload") or {}).get("commentEntityPayload")
        if not isinstance(payload, dict):
            continue
        props = payload.get("properties") or {}
        author = payload.get("author") or {}
        toolbar = payload.get("toolbar") or {}
        text = str((props.get("content") or {}).get("content") or "").strip()
        if not text:
            continue
        cid = str(props.get("commentId") or f"{author.get('displayName', '')}:{text[:40]}")
        if cid in seen:
            continue
        seen.add(cid)
        likes = str(toolbar.get("likeCountNotliked") or toolbar.get("likeCountLiked") or "").strip()
        comments.append({
            "id": cid,
            "author": str(author.get("displayName") or "Pengguna"),
            "authorId": str(author.get("channelId") or ""),
            "avatar": str(author.get("avatarThumbnailUrl") or ""),
            "published": str(props.get("publishedTime") or ""),
            "text": text[:1200],
            "likes": likes,
            "replies": str(toolbar.get("replyCount") or "").strip(),
            "isPinned": bool(props.get("pinnedText")),
        })
        if len(comments) >= limit:
            break

    if not comments:
        # Legacy commentRenderer fallback
        stack: list[object] = [resp]
        while stack and len(comments) < limit:
            node = stack.pop()
            if isinstance(node, dict):
                cr = node.get("commentRenderer")
                if isinstance(cr, dict):
                    text = _join_runs(cr.get("contentText")).strip()
                    author_name = _join_runs(cr.get("authorText")) or "Pengguna"
                    cid = str(cr.get("commentId") or f"{author_name}:{text[:40]}")
                    if text and cid not in seen:
                        seen.add(cid)
                        thumbs = ((cr.get("authorThumbnail") or {}).get("thumbnails") or [])
                        comments.append({
                            "id": cid,
                            "author": author_name,
                            "authorId": _extract_browse_id(cr.get("authorEndpoint")),
                            "avatar": str(thumbs[-1].get("url") or "") if thumbs else "",
                            "published": _join_runs(cr.get("publishedTimeText")),
                            "text": text[:1200],
                            "likes": _join_runs(cr.get("voteCount")) or str(cr.get("likeCount") or ""),
                            "replies": "",
                            "isPinned": bool(cr.get("pinnedCommentBadge")),
                        })
                for v in node.values():
                    if isinstance(v, (dict, list)):
                        stack.append(v)
            elif isinstance(node, list):
                stack.extend(node)

    next_tok = _find_next_comments_continuation(resp)
    if next_tok == use_tok:
        next_tok = ""
    result = {"comments": comments, "nextToken": next_tok, "hasMore": bool(next_tok)}

    if not clean_tok:
        with CACHE_LOCK:
            if len(COMMENTS_CACHE) > 80:
                COMMENTS_CACHE.clear()
            COMMENTS_CACHE[video_id] = (now, result)
    return result


def fetch_video_comments(video_id: str, limit: int = 24) -> list[dict]:
    return fetch_video_comments_page(video_id, limit=limit)["comments"]


def _extract_channel_metadata(data: dict, channel_id: str) -> dict:
    meta_r = ((data.get("metadata") or {}).get("channelMetadataRenderer")) or {}
    title = str(meta_r.get("title") or "")
    description = str(meta_r.get("description") or "")[:600]
    thumbs = (meta_r.get("avatar") or {}).get("thumbnails") or []
    avatar = str(thumbs[-1].get("url") or "") if thumbs else ""
    subscriber_text = ""

    header = data.get("header") or {}
    c4 = header.get("c4TabbedHeaderRenderer") or {}
    if c4:
        title = title or str(c4.get("title") or "")
        subscriber_text = _join_runs(c4.get("subscriberCountText"))
        if not avatar:
            c4_thumbs = (c4.get("avatar") or {}).get("thumbnails") or []
            if c4_thumbs:
                avatar = str(c4_thumbs[-1].get("url") or "")

    ph = ((header.get("pageHeaderRenderer") or {}).get("content") or {}).get("pageHeaderViewModel") or {}
    if ph:
        if not title:
            title = str((((ph.get("title") or {}).get("dynamicTextViewModel") or {}).get("text") or {}).get("content") or "")
        rows = (((ph.get("metadata") or {}).get("contentMetadataViewModel") or {}).get("metadataRows")) or []
        for row in rows:
            for part in (row or {}).get("metadataParts") or []:
                txt = str(((part or {}).get("text") or {}).get("content") or "")
                if "subscriber" in txt.lower():
                    subscriber_text = txt
        if not avatar:
            sources = (((((ph.get("image") or {}).get("decoratedAvatarViewModel") or {}).get("avatar") or {}).get("avatarViewModel") or {}).get("image") or {}).get("sources") or []
            if sources:
                avatar = str(sources[-1].get("url") or "")

    return {
        "id": channel_id,
        "title": title or "Channel YouTube",
        "description": description,
        "subscriberText": subscriber_text,
        "avatar": avatar,
    }


def fetch_channel_page(channel_id: str, offset: int = 0, limit: int = 30) -> dict:
    """Fetch public channel metadata and paginated uploaded videos."""
    now = time.monotonic()
    safe_offset = max(0, offset)
    safe_limit = max(8, min(limit, 60))

    with CACHE_LOCK:
        cached = CHANNEL_CACHE.get(channel_id)
        entry = cached[1] if cached and (now - cached[0]) < 600.0 else None

    if entry is None:
        _, _, raw = _http_get_bytes(f"https://www.youtube.com/channel/{channel_id}/videos?hl=id", timeout=10.0)
        html = raw.decode("utf-8", errors="ignore")
        _remember_api_key(html)
        data = _extract_initial_data(html)
        if not data:
            raise RuntimeError("Halaman channel tidak dapat diurai.")

        info = _extract_channel_metadata(data, channel_id)
        seen_ids: set[str] = set()
        videos: list[dict] = []
        _collect_videos(data, videos, seen_ids, 240)
        for v in videos:
            if not v.get("author") or v["author"] == "Creator":
                v["author"] = info["title"]
            if not v.get("authorId"):
                v["authorId"] = channel_id

        entry = {
            "info": info,
            "videos": videos,
            "seen": seen_ids,
            "cont_token": _extract_feed_continuation(data),
            "lock": threading.Lock(),
        }
        with CACHE_LOCK:
            if len(CHANNEL_CACHE) > 60:
                CHANNEL_CACHE.clear()
            CHANNEL_CACHE[channel_id] = (now, entry)

    with entry["lock"]:
        info = entry["info"]
        while len(entry["videos"]) < safe_offset + safe_limit and entry.get("cont_token"):
            tok = entry["cont_token"]
            try:
                resp = _innertube_continuation("browse", tok)
            except Exception:
                entry["cont_token"] = ""
                break
            batch: list[dict] = []
            _collect_videos(resp, batch, set(entry["seen"]), 120)
            added = 0
            for v in batch:
                if v["id"] not in entry["seen"]:
                    entry["seen"].add(v["id"])
                    if not v.get("author") or v["author"] == "Creator":
                        v["author"] = info["title"]
                    if not v.get("authorId"):
                        v["authorId"] = channel_id
                    entry["videos"].append(v)
                    added += 1
            new_tok = _extract_feed_continuation(resp)
            entry["cont_token"] = new_tok if new_tok and new_tok != tok else ""
            if added == 0:
                break

        slice_items = list(entry["videos"][safe_offset : safe_offset + safe_limit])
        next_offset = safe_offset + len(slice_items)
        has_more = next_offset < len(entry["videos"]) or bool(entry.get("cont_token"))

    return {
        **info,
        "videos": slice_items,
        "offset": safe_offset,
        "nextOffset": next_offset,
        "hasMore": has_more,
        "total": len(entry["videos"]),
    }


RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")
CONTENT_RANGE_TOTAL_RE = re.compile(r"/(\d+)$")


def _ensure_media_entry(video_id: str, itag: str, failed_url: str | None = None) -> dict | None:
    with CACHE_LOCK:
        entry = MEDIA_REGISTRY.get((video_id, itag))
        vlock = RESOLVE_LOCKS.setdefault(video_id, threading.RLock())
    if entry is not None and (failed_url is None or entry.get("url") != failed_url):
        return entry
    if failed_url is not None:
        _invalidate_cdn_url(video_id, itag)
    with vlock:
        with CACHE_LOCK:
            cur = MEDIA_REGISTRY.get((video_id, itag))
        need_refresh = (cur is None) or (failed_url is not None and cur.get("url") == failed_url)
        if need_refresh:
            resolve_stream(video_id, force_refresh=(failed_url is not None))
        with CACHE_LOCK:
            return MEDIA_REGISTRY.get((video_id, itag))


class StreamBlock:
    __slots__ = (
        "start_byte",
        "end_limit",
        "buf",
        "total_size",
        "content_type",
        "done",
        "truncated",
        "aborted",
        "error",
        "cond",
        "readers",
        "last_touch",
        "grace_until",
    )

    def __init__(self, start_byte: int, content_type: str, is_prefetch: bool = False, initial_readers: int = 0):
        now = time.monotonic()
        self.start_byte = start_byte
        self.end_limit = start_byte + BLOCK_SIZE
        self.buf = bytearray()
        self.total_size: int | None = None
        self.content_type = content_type
        self.done = False
        self.truncated = False
        self.aborted = False
        self.error: Exception | None = None
        self.cond = threading.Condition()
        self.readers = initial_readers
        self.last_touch = now
        self.grace_until = now + (8.0 if is_prefetch else 2.5)


def _pump_block(video_id: str, itag: str, b_start: int, block: StreamBlock) -> None:
    failed_url: str | None = None
    key = (video_id, itag, b_start)
    try:
        for attempt in range(3):
            entry = _ensure_media_entry(video_id, itag, failed_url=failed_url)
            if not entry:
                raise KeyError("Format not found")

            with STREAM_LOCK:
                cached_meta = dict(MEDIA_META_CACHE.get((video_id, itag)) or {})
            total_size = cached_meta.get("total_size")
            if isinstance(total_size, int) and b_start >= total_size:
                with block.cond:
                    block.total_size = total_size
                    block.end_limit = total_size
                    block.done = True
                    block.cond.notify_all()
                return

            b_end = (min(b_start + BLOCK_SIZE, total_size) - 1) if isinstance(total_size, int) else (b_start + BLOCK_SIZE - 1)
            conn = None
            try:
                conn, resp, host = _open_upstream_range(video_id, itag, entry, f"bytes={b_start}-{b_end}", timeout=20.0)
                if resp.status == 416:
                    cr = resp.getheader("Content-Range", "")
                    resp.read()
                    if not getattr(resp, "will_close", False):
                        _put_https_conn(host, conn)
                    else:
                        conn.close()
                    m_tot = CONTENT_RANGE_TOTAL_RE.search(cr)
                    tot_val = int(m_tot.group(1)) if m_tot else cached_meta.get("total_size")
                    with STREAM_LOCK:
                        meta = dict(MEDIA_META_CACHE.get((video_id, itag)) or {"content_type": entry.get("mime", "video/webm")})
                        if tot_val is not None:
                            meta["total_size"] = tot_val
                        MEDIA_META_CACHE[(video_id, itag)] = meta
                    with block.cond:
                        block.total_size = tot_val
                        if isinstance(tot_val, int):
                            block.end_limit = min(block.end_limit, tot_val)
                        block.done = True
                        block.cond.notify_all()
                    return

                if resp.status in (403, 429):
                    resp.read()
                    conn.close()
                    _invalidate_cdn_url(video_id, itag)
                    if attempt < 2 and len(block.buf) == 0:
                        failed_url = entry["url"]
                        time.sleep(0.5 * (attempt + 1))
                        continue
                    raise urllib.error.HTTPError(entry["url"], resp.status, resp.reason, resp.headers, None)

                if resp.status >= 400:
                    resp.read()
                    conn.close()
                    raise urllib.error.HTTPError(entry["url"], resp.status, resp.reason, resp.headers, None)

                ct = resp.getheader("Content-Type") or entry.get("mime", "video/webm")
                cr = resp.getheader("Content-Range", "")
                m_tot = CONTENT_RANGE_TOTAL_RE.search(cr)
                discovered_total = int(m_tot.group(1)) if m_tot else cached_meta.get("total_size")
                if discovered_total is None and resp.status == 200 and b_start == 0:
                    cl = resp.getheader("Content-Length")
                    if cl and cl.isdigit():
                        discovered_total = int(cl)

                with STREAM_LOCK:
                    meta = {"total_size": discovered_total, "content_type": ct}
                    MEDIA_META_CACHE[(video_id, itag)] = meta
                with block.cond:
                    block.content_type = ct
                    block.total_size = discovered_total
                    if isinstance(discovered_total, int):
                        block.end_limit = min(b_start + BLOCK_SIZE, discovered_total)
                    block.cond.notify_all()

                while True:
                    piece = resp.read(32768)
                    if not piece:
                        break
                    now = time.monotonic()
                    with block.cond:
                        block.buf.extend(piece)
                        block.cond.notify_all()
                        should_abort = block.aborted or (
                            block.readers <= 0
                            and now > block.grace_until
                            and (now - block.last_touch) > 2.0
                        )
                        if should_abort:
                            block.truncated = True
                            block.done = True
                            block.cond.notify_all()
                    if should_abort:
                        try:
                            conn.close()
                        except Exception:
                            pass
                        with STREAM_LOCK:
                            if STREAM_BLOCKS.get(key) is block:
                                del STREAM_BLOCKS[key]
                        return

                if not getattr(resp, "will_close", False):
                    _put_https_conn(host, conn)
                else:
                    conn.close()

                if block.total_size is None and resp.status == 200 and b_start == 0:
                    with STREAM_LOCK:
                        MEDIA_META_CACHE[(video_id, itag)] = {"total_size": len(block.buf), "content_type": ct}
                    with block.cond:
                        block.total_size = len(block.buf)
                        block.end_limit = len(block.buf)

                with block.cond:
                    block.end_limit = min(block.end_limit, b_start + len(block.buf))
                    block.done = True
                    block.cond.notify_all()
                return
            except urllib.error.HTTPError as err:
                if err.code in (403, 429) and attempt < 2 and len(block.buf) == 0:
                    failed_url = entry["url"]
                    time.sleep(0.5 * (attempt + 1))
                    continue
                with block.cond:
                    block.error = err
                    block.done = True
                    block.cond.notify_all()
                return
            except Exception as exc:
                if conn is not None:
                    try:
                        conn.close()
                    except Exception:
                        pass
                if attempt < 2 and len(block.buf) == 0:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                with block.cond:
                    block.error = exc
                    block.done = True
                    block.cond.notify_all()
                return
    except Exception as exc:
        with block.cond:
            block.error = exc
            block.done = True
            block.cond.notify_all()


def _find_covering_chunk_locked(
    video_id: str,
    itag: str,
    pos: int,
    max_ahead: int = 384 * 1024,
) -> tuple[tuple[str, str, int], StreamBlock] | None:
    for key, blk in reversed(STREAM_BLOCKS.items()):
        vid, tg, b_start = key
        if vid != video_id or tg != itag or pos < b_start:
            continue
        with blk.cond:
            if blk.aborted or blk.truncated or (blk.error is not None and len(blk.buf) == 0):
                continue
            if pos >= blk.end_limit:
                continue
            avail_end = b_start + len(blk.buf)
            if pos < avail_end or (not blk.done and (pos - avail_end) <= max_ahead):
                return key, blk
    return None


def _abort_orphan_blocks_locked(video_id: str, itag: str, keep_pos: int) -> None:
    now = time.monotonic()
    for key, blk in list(STREAM_BLOCKS.items()):
        vid, tg, b_start = key
        if vid != video_id or tg != itag or b_start == keep_pos:
            continue
        with blk.cond:
            # Cancel non-contiguous in-flight orphan downloads immediately when user seeks elsewhere
            if blk.readers <= 0 and not blk.done and (b_start + BLOCK_SIZE) != keep_pos and (now - blk.last_touch) > 0.02:
                blk.aborted = True
                blk.truncated = True
                blk.done = True
                blk.cond.notify_all()


def _get_or_start_block(
    video_id: str,
    itag: str,
    pos: int,
    default_ct: str,
    *,
    is_prefetch: bool = False,
    register_reader: bool = False,
) -> StreamBlock:
    now = time.monotonic()
    with STREAM_LOCK:
        found = _find_covering_chunk_locked(video_id, itag, pos, max_ahead=(BLOCK_SIZE if is_prefetch else 768 * 1024))
        if found is not None:
            key, blk = found
            with blk.cond:
                blk.last_touch = now
                if register_reader:
                    blk.readers += 1
            STREAM_BLOCKS.move_to_end(key)
            return blk

        if not is_prefetch:
            _abort_orphan_blocks_locked(video_id, itag, pos)

        key = (video_id, itag, pos)
        blk = StreamBlock(pos, default_ct, is_prefetch=is_prefetch, initial_readers=(1 if register_reader else 0))
        STREAM_BLOCKS[key] = blk
        while len(STREAM_BLOCKS) > MAX_CACHED_BLOCKS:
            evict_key = None
            for cand_key, cand_blk in STREAM_BLOCKS.items():
                if cand_key == key:
                    continue
                if not str(cand_blk.content_type or "").startswith("audio/"):
                    evict_key = cand_key
                    break
            evicted = STREAM_BLOCKS.pop(evict_key) if evict_key is not None else STREAM_BLOCKS.popitem(last=False)[1]
            with evicted.cond:
                if not evicted.done and evicted.readers <= 0:
                    evicted.aborted = True
                    evicted.truncated = True
                    evicted.done = True
                    evicted.cond.notify_all()
    MEDIA_EXECUTOR.submit(_pump_block, video_id, itag, pos, blk)
    return blk


def _fetch_small_probe(video_id: str, itag: str, entry: dict, req_start: int, req_end: int) -> tuple[bytes, dict]:
    pkey = (video_id, itag, req_start, req_end)
    with STREAM_LOCK:
        cached = PROBE_CACHE.get(pkey)
        if cached is not None:
            PROBE_CACHE.move_to_end(pkey)
            return cached

    failed_url: str | None = None
    for attempt in range(3):
        cur_entry = _ensure_media_entry(video_id, itag, failed_url=failed_url) or entry
        conn = None
        try:
            conn, resp, host = _open_upstream_range(video_id, itag, cur_entry, f"bytes={req_start}-{req_end}", timeout=15.0)
            if resp.status in (403, 429):
                resp.read()
                conn.close()
                _invalidate_cdn_url(video_id, itag)
                if attempt < 2:
                    failed_url = cur_entry["url"]
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise urllib.error.HTTPError(cur_entry["url"], resp.status, resp.reason, resp.headers, None)
            if resp.status >= 400:
                resp.read()
                conn.close()
                raise urllib.error.HTTPError(cur_entry["url"], resp.status, resp.reason, resp.headers, None)
            ct = resp.getheader("Content-Type") or cur_entry.get("mime", "video/webm")
            cr = resp.getheader("Content-Range", "")
            m_tot = CONTENT_RANGE_TOTAL_RE.search(cr)
            raw = resp.read()
            if not getattr(resp, "will_close", False):
                _put_https_conn(host, conn)
            else:
                conn.close()
            tot = int(m_tot.group(1)) if m_tot else (len(raw) if resp.status == 200 and req_start == 0 else None)
            meta = {"total_size": tot, "content_type": ct}
            with STREAM_LOCK:
                if tot is not None:
                    MEDIA_META_CACHE[(video_id, itag)] = meta
                PROBE_CACHE[pkey] = (raw, meta)
                PROBE_CACHE.move_to_end(pkey)
                while len(PROBE_CACHE) > MAX_PROBE_ENTRIES:
                    PROBE_CACHE.popitem(last=False)
            return raw, meta
        except urllib.error.HTTPError as err:
            if err.code in (403, 429) and attempt < 2:
                failed_url = cur_entry["url"]
                time.sleep(0.5 * (attempt + 1))
                continue
            raise
    raise RuntimeError("Probe failed")


class OnyxHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, directory: str | None = None, **kwargs):
        super().__init__(*args, directory=directory or str(ROOT), **kwargs)

    def end_headers(self) -> None:
        if not getattr(self, "path", "").startswith("/api/"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
        super().end_headers()

    def handle(self) -> None:
        try:
            super().handle()
        except (ConnectionResetError, BrokenPipeError, TimeoutError):
            self.close_connection = True

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _proxy_media(self, video_id: str, itag: str, head_only: bool = False) -> None:
        if not VIDEO_ID_RE.match(video_id) or not itag:
            self.send_error(400, "Invalid media request")
            return

        sent_headers = False
        try:
            entry = _ensure_media_entry(video_id, itag)
        except Exception as exc:
            self.send_error(502, f"Stream lookup failed: {exc}")
            return
        if not entry:
            self.send_error(404, "Format not found")
            return

        range_hdr = self.headers.get("Range")
        req_start = 0
        req_end: int | None = None
        suffix_len: int | None = None
        if range_hdr:
            m = RANGE_RE.match(range_hdr.strip())
            if m:
                s_raw, e_raw = m.group(1), m.group(2)
                if s_raw == "" and e_raw != "":
                    suffix_len = int(e_raw)
                else:
                    req_start = int(s_raw) if s_raw else 0
                    req_end = int(e_raw) if e_raw else None
            else:
                range_hdr = None

        if req_end is not None and req_end < req_start:
            self.send_response(416)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        default_ct = entry.get("mime", "video/mp4")
        active_blk: StreamBlock | None = None

        def release_active_blk() -> None:
            nonlocal active_blk
            if active_blk is not None:
                with active_blk.cond:
                    active_blk.readers = max(0, active_blk.readers - 1)
                    active_blk.last_touch = time.monotonic()
                active_blk = None

        try:
            with STREAM_LOCK:
                cached_meta = dict(MEDIA_META_CACHE.get((video_id, itag)) or {})
                covering_req = (
                    _find_covering_chunk_locked(video_id, itag, req_start, max_ahead=256 * 1024)
                    if suffix_len is None
                    else None
                )
            cached_total = cached_meta.get("total_size")

            if suffix_len is not None and isinstance(cached_total, int) and cached_total > 0:
                req_start = max(0, cached_total - suffix_len)
                req_end = cached_total - 1
                suffix_len = None
                with STREAM_LOCK:
                    covering_req = _find_covering_chunk_locked(video_id, itag, req_start, max_ahead=256 * 1024)

            if head_only and isinstance(cached_total, int) and cached_total > 0:
                ct = cached_meta.get("content_type") or default_ct
                if req_start >= cached_total:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{cached_total}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                actual_end = min(req_end, cached_total - 1) if req_end is not None else (cached_total - 1)
                content_len = actual_end - req_start + 1
                is_partial = range_hdr is not None
                self.send_response(206 if is_partial else 200)
                self.send_header("Content-Type", ct)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(content_len))
                if is_partial:
                    self.send_header("Content-Range", f"bytes {req_start}-{actual_end}/{cached_total}")
                self.send_header("Cache-Control", "private, max-age=1800")
                self.end_headers()
                return

            if suffix_len is None and isinstance(cached_total, int) and cached_total > 0 and req_start >= cached_total:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{cached_total}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return

            # Handle explicit small byte-range probes and near-EOF open-ended tail probes directly without spawning 4MB downloads
            near_eof_probe = (
                suffix_len is None
                and req_end is None
                and isinstance(cached_total, int)
                and cached_total > req_start
                and (cached_total - req_start) <= SMALL_PROBE_MAX
            )
            probe_req_end = (cached_total - 1) if (near_eof_probe and isinstance(cached_total, int)) else req_end
            is_small_probe = (
                not head_only
                and suffix_len is None
                and probe_req_end is not None
                and probe_req_end >= req_start
                and (probe_req_end - req_start + 1) <= SMALL_PROBE_MAX
            )
            block_cached = covering_req is not None

            if is_small_probe and not block_cached:
                assert probe_req_end is not None
                probe_end = min(probe_req_end, cached_total - 1) if isinstance(cached_total, int) else probe_req_end
                raw, meta = _fetch_small_probe(video_id, itag, entry, req_start, probe_end)
                total_size = meta.get("total_size") or len(raw)
                actual_end = req_start + len(raw) - 1
                self.send_response(206)
                self.send_header("Content-Type", meta.get("content_type") or default_ct)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(len(raw)))
                self.send_header("Content-Range", f"bytes {req_start}-{actual_end}/{total_size}")
                self.send_header("Cache-Control", "private, max-age=1800")
                self.end_headers()
                sent_headers = True
                self.wfile.write(raw)
                return

            first_pos = 0 if suffix_len is not None else req_start
            active_blk = _get_or_start_block(
                video_id, itag, first_pos, default_ct, register_reader=True
            )
            with active_blk.cond:
                deadline = time.monotonic() + 25.0
                while active_blk.total_size is None and not active_blk.done:
                    rem = deadline - time.monotonic()
                    if rem <= 0:
                        break
                    active_blk.cond.wait(timeout=rem)
                if active_blk.error is not None and not active_blk.total_size:
                    raise active_blk.error
                total_size = active_blk.total_size
                ct = active_blk.content_type or default_ct

            if not isinstance(total_size, int) or total_size <= 0:
                self.send_error(502, "Unable to determine stream size")
                return

            if suffix_len is not None:
                req_start = max(0, total_size - suffix_len)
                req_end = total_size - 1
                with active_blk.cond:
                    in_first = active_blk.start_byte <= req_start < active_blk.end_limit
                if not in_first:
                    release_active_blk()
                    active_blk = _get_or_start_block(
                        video_id, itag, req_start, ct, register_reader=True
                    )

            if req_start >= total_size:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{total_size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return

            actual_end = min(req_end, total_size - 1) if req_end is not None else (total_size - 1)
            content_len = actual_end - req_start + 1
            is_partial = range_hdr is not None

            self.send_response(206 if is_partial else 200)
            self.send_header("Content-Type", ct)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(content_len))
            if is_partial:
                self.send_header("Content-Range", f"bytes {req_start}-{actual_end}/{total_size}")
            self.send_header("Cache-Control", "private, max-age=1800")
            self.end_headers()
            sent_headers = True
            if head_only:
                return

            pos = req_start
            prefetched_starts: set[int] = set()
            short_retries = 0
            while pos <= actual_end:
                need_new = active_blk is None
                if active_blk is not None:
                    with active_blk.cond:
                        blk_done_pos = active_blk.start_byte + len(active_blk.buf)
                        need_new = (
                            pos < active_blk.start_byte
                            or pos >= active_blk.end_limit
                            or (active_blk.truncated and pos >= blk_done_pos)
                        )
                if need_new:
                    release_active_blk()
                    active_blk = _get_or_start_block(
                        video_id, itag, pos, ct, register_reader=True
                    )
                blk = active_blk
                offset = pos - blk.start_byte
                if offset < 0:
                    release_active_blk()
                    continue

                next_start = blk.start_byte + BLOCK_SIZE
                if (
                    offset >= (BLOCK_SIZE // 4)
                    and next_start not in prefetched_starts
                    and next_start <= actual_end
                ):
                    prefetched_starts.add(next_start)
                    _get_or_start_block(video_id, itag, next_start, ct, is_prefetch=True)

                with blk.cond:
                    blk.last_touch = time.monotonic()
                    deadline = blk.last_touch + 25.0
                    while offset >= len(blk.buf) and not blk.done:
                        rem = deadline - time.monotonic()
                        if rem <= 0:
                            break
                        blk.cond.wait(timeout=rem)
                    if blk.truncated and offset >= len(blk.buf):
                        avail = -1
                    else:
                        avail = len(blk.buf)
                    if offset < avail:
                        take_end = min(avail, offset + (actual_end - pos + 1))
                        piece = bytes(blk.buf[offset:take_end])
                    else:
                        piece = b""
                    can_retry_short = (
                        not piece
                        and avail != -1
                        and blk.done
                        and blk.error is None
                        and not blk.truncated
                        and len(blk.buf) > 0
                        and pos <= actual_end
                    )

                if avail == -1:
                    release_active_blk()
                    continue
                if can_retry_short and short_retries < 2:
                    short_retries += 1
                    release_active_blk()
                    continue
                if not piece:
                    break
                short_retries = 0
                self.wfile.write(piece)
                pos += len(piece)

            if pos <= actual_end:
                self.close_connection = True
        except urllib.error.HTTPError as err:
            if not sent_headers:
                self.send_error(err.code, str(err.reason))
            else:
                self.close_connection = True
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
            return
        except Exception:
            if not sent_headers:
                self.send_error(502, "Media stream interrupted")
            self.close_connection = True
            return
        finally:
            release_active_blk()

    def do_HEAD(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/api/media":
            vid = (params.get("id") or [""])[0].strip()
            itag = (params.get("itag") or [""])[0].strip()
            self._proxy_media(vid, itag, head_only=True)
            return
        for hdr in ("If-Modified-Since", "If-None-Match"):
            if hdr in self.headers:
                del self.headers[hdr]
        if parsed.path not in STATIC_FILES:
            self.send_error(404, "Not found")
            return
        self.path = STATIC_FILES[parsed.path]
        super().do_HEAD()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if parsed.path == "/api/health":
            yt_bin = _resolve_ytdlp_bin()
            payload = {"ok": True, "ytDlp": Path(yt_bin).is_file() and os.access(yt_bin, os.X_OK)}
            if self.client_address and self.client_address[0] in ("127.0.0.1", "::1"):
                payload["ytDlpPath"] = yt_bin
            self._send_json(200, payload)
            return

        def _param_int(name: str, default: int) -> int:
            raw_v = (params.get(name) or [str(default)])[0]
            try:
                return int(raw_v)
            except (TypeError, ValueError):
                return default

        if parsed.path == "/api/trending":
            tab = (params.get("tab") or ["all"])[0].strip().lower()
            refresh = (params.get("refresh") or ["0"])[0] == "1"
            offset = _param_int("offset", 0)
            limit = _param_int("limit", 30)
            try:
                payload = fetch_trending_page(tab, offset=offset, limit=limit, force_refresh=refresh)
                if offset == 0:
                    top_ids = [r["id"] for r in (payload.get("results") or [])[:2] if isinstance(r, dict) and VIDEO_ID_RE.match(str(r.get("id") or ""))]
                    if top_ids:
                        schedule_prefetch(top_ids)
                self._send_json(200, payload)
            except Exception as exc:
                self._send_json(502, {"error": f"Gagal memuat feed beranda: {exc}", "results": []})
            return

        if parsed.path == "/api/search":
            query = (params.get("q") or [""])[0].strip()
            token = (params.get("token") or [""])[0].strip()
            if not query and not token:
                self._send_json(400, {"error": "Kata kunci pencarian tidak boleh kosong.", "results": []})
                return
            try:
                payload = search_youtube_page(query, token=token)
                if not token:
                    top_ids = [r["id"] for r in (payload.get("results") or [])[:2] if isinstance(r, dict) and VIDEO_ID_RE.match(str(r.get("id") or ""))]
                    if top_ids:
                        schedule_prefetch(top_ids)
                self._send_json(200, payload)
            except (urllib.error.URLError, TimeoutError) as exc:
                self._send_json(502, {"error": f"Gagal menghubungi pencarian YouTube: {exc}", "results": []})
            return

        if parsed.path == "/api/subscriptions":
            raw_ch = (params.get("channels") or [""])[0]
            channel_ids = [c for c in raw_ch.split(",") if c.strip()]
            results = fetch_subscriptions(channel_ids)
            self._send_json(200, {"channels": len(channel_ids), "results": results})
            return

        if parsed.path == "/api/suggest":
            q = (params.get("q") or [""])[0]
            try:
                suggestions = fetch_search_suggestions(q)
                self._send_json(200, {"query": q, "suggestions": suggestions})
            except Exception:
                self._send_json(200, {"query": q, "suggestions": []})
            return

        if parsed.path == "/api/comments":
            vid = (params.get("id") or [""])[0].strip()
            token = (params.get("token") or [""])[0].strip()
            if not VIDEO_ID_RE.match(vid):
                self._send_json(400, {"error": "Format ID video tidak valid."})
                return
            try:
                payload = fetch_video_comments_page(vid, token=token)
                self._send_json(200, {"id": vid, **payload})
            except Exception as exc:
                self._send_json(502, {"error": f"Gagal memuat komentar: {exc}"})
            return

        if parsed.path == "/api/channel":
            cid = (params.get("id") or [""])[0].strip()
            if not CHANNEL_ID_RE.match(cid):
                self._send_json(400, {"error": "Format ID channel tidak valid."})
                return
            offset = _param_int("offset", 0)
            limit = _param_int("limit", 30)
            try:
                ch = fetch_channel_page(cid, offset=offset, limit=limit)
                self._send_json(200, ch)
            except Exception as exc:
                self._send_json(502, {"error": f"Gagal memuat halaman channel: {exc}"})
            return

        if parsed.path == "/api/subtitle":
            vid = (params.get("id") or [""])[0].strip()
            lang = (params.get("lang") or [""])[0].strip()
            if not VIDEO_ID_RE.match(vid) or not LANG_CODE_RE.match(lang):
                self._send_json(400, {"error": "Parameter subtitle tidak valid."})
                return
            try:
                vtt = fetch_subtitle_vtt(vid, lang)
                self.send_response(200)
                self.send_header("Content-Type", "text/vtt; charset=utf-8")
                self.send_header("Content-Length", str(len(vtt)))
                self.send_header("Cache-Control", "public, max-age=3600")
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(vtt)
            except Exception as exc:
                self._send_json(404, {"error": f"Subtitle tidak tersedia: {exc}"})
            return

        if parsed.path == "/api/stream":
            vid = (params.get("id") or [""])[0].strip()
            if not VIDEO_ID_RE.match(vid):
                self._send_json(400, {"error": "Format ID video tidak valid."})
                return
            refresh = (params.get("refresh") or ["0"])[0] == "1"
            try:
                data = resolve_stream(vid, force_refresh=refresh)
                _warm_initial_media_blocks(vid, data)
                self._send_json(200, data)
            except Exception as exc:
                self._send_json(502, {"error": f"Gagal mengekstrak stream video: {exc}"})
            return

        if parsed.path == "/api/ytdlp":
            action = (params.get("action") or ["status"])[0].strip().lower()
            status = get_ytdlp_status(run_update=(action == "update"))
            self._send_json(200, status)
            return

        if parsed.path == "/api/notify":
            title = (params.get("title") or ["OnyxTube"])[0].strip()
            body = (params.get("body") or [""])[0].strip()
            sent = send_desktop_notification(title, body)
            self._send_json(200, {"ok": True, "sent": sent})
            return

        if parsed.path == "/api/prefetch":
            raw_ids = (params.get("id") or params.get("ids") or [""])[0]
            candidates = [x.strip() for x in raw_ids.split(",") if VIDEO_ID_RE.match(x.strip())][:4]
            queued = schedule_prefetch(candidates)
            self._send_json(202, {"queued": queued})
            return

        if parsed.path == "/api/media":
            vid = (params.get("id") or [""])[0].strip()
            itag = (params.get("itag") or [""])[0].strip()
            self._proxy_media(vid, itag)
            return

        for hdr in ("If-Modified-Since", "If-None-Match"):
            if hdr in self.headers:
                del self.headers[hdr]
        if parsed.path not in STATIC_FILES:
            self.send_error(404, "Not found")
            return
        self.path = STATIC_FILES[parsed.path]
        super().do_GET()


def _warm_initial_media_blocks(video_id: str, payload: dict) -> None:
    try:
        qualities = payload.get("qualities") or []
        default_itag = str(payload.get("defaultItag") or "")
        chosen = next((q for q in qualities if q.get("itag") == default_itag), qualities[0] if qualities else None)
        if not isinstance(chosen, dict):
            return
        v_itag = str(chosen.get("itag") or "")
        if v_itag:
            with CACHE_LOCK:
                v_entry = MEDIA_REGISTRY.get((video_id, v_itag))
            if v_entry:
                _get_or_start_block(video_id, v_itag, 0, v_entry.get("mime", "video/webm"), is_prefetch=True)
        audio_url = str(chosen.get("audioUrl") or "")
        if audio_url and "itag=" in audio_url:
            a_itag = urllib.parse.unquote(audio_url.split("itag=", 1)[1].split("&", 1)[0])
            if a_itag:
                with CACHE_LOCK:
                    a_entry = MEDIA_REGISTRY.get((video_id, a_itag))
                if a_entry:
                    _get_or_start_block(video_id, a_itag, 0, a_entry.get("mime", "audio/webm"), is_prefetch=True)
    except Exception:
        pass


def _prefetch_one(video_id: str) -> None:
    try:
        # Warm stream resolution + persistent cache; singleflight RLock prevents duplicate yt-dlp runs.
        resolve_stream(video_id)
    except Exception:
        pass
    finally:
        with PREFETCH_LOCK:
            PREFETCH_IN_FLIGHT.discard(video_id)


def schedule_prefetch(video_ids: list[str]) -> list[str]:
    queued: list[str] = []
    now = time.time()
    for vid in video_ids:
        with CACHE_LOCK:
            cached = STREAM_CACHE.get(vid)
            is_warm = cached is not None and (now - cached[0]) < STREAM_TTL_SEC
        if is_warm:
            continue
        with PREFETCH_LOCK:
            if vid in PREFETCH_IN_FLIGHT or len(PREFETCH_IN_FLIGHT) >= 4:
                continue
            PREFETCH_IN_FLIGHT.add(vid)
        PREFETCH_EXECUTOR.submit(_prefetch_one, vid)
        queued.append(vid)
    return queued


class ThreadingHTTPServer(ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def start_background_server(bind: str = "127.0.0.1", port: int = 0) -> tuple[ThreadingHTTPServer, int]:
    _load_persistent_stream_cache()
    maybe_auto_update_ytdlp_async()
    server = ThreadingHTTPServer((bind, port), OnyxHandler)
    actual_port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, actual_port


def main() -> None:
    parser = argparse.ArgumentParser(description="OnyxTube local desktop backend")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    _load_persistent_stream_cache()
    maybe_auto_update_ytdlp_async()
    with ThreadingHTTPServer((args.bind, args.port), OnyxHandler) as server:
        print(f"OnyxTube listening on http://{args.bind}:{args.port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
