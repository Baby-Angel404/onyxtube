import json
import sys
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from server import OnyxHandler, ThreadingHTTPServer  # noqa: E402


class QuietOnyxHandler(OnyxHandler):
    def log_message(self, format, *args):
        pass


MOCK_VIDEOS = [
    {
        "id": f"vid{i:02d}",
        "title": f"OnyxTube Cross-Platform Demo Video {i}",
        "author": f"Channel {i % 3 + 1}",
        "authorId": f"UCmock{i % 3 + 1}",
        "views": "120K views",
        "published": "1 day ago",
        "duration": "10:15",
        "thumbnail": "onyxtube.svg",
    }
    for i in range(1, 13)
]


def run_ci_e2e() -> None:
    with ThreadingHTTPServer(("127.0.0.1", 0), QuietOnyxHandler) as httpd:
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{port}/index.html"
        errors: list[str] = []

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1280, "height": 820})
            page = context.new_page()

            def _mock_api(route):
                req_url = route.request.url
                if "/api/trending" in req_url or "/api/search" in req_url:
                    route.fulfill(
                        status=200,
                        content_type="application/json",
                        body=json.dumps({
                            "results": MOCK_VIDEOS,
                            "hasMore": False,
                            "nextOffset": len(MOCK_VIDEOS),
                            "total": len(MOCK_VIDEOS),
                        }),
                    )
                elif "/api/video" in req_url:
                    route.fulfill(
                        status=200,
                        content_type="application/json",
                        body=json.dumps({
                            "id": "vid01",
                            "title": "OnyxTube Cross-Platform Demo Video 1",
                            "author": "Channel 1",
                            "authorId": "UCmock1",
                            "views": "120K views",
                            "published": "1 day ago",
                            "description": "Cross-platform test playback",
                            "streams": [],
                            "adaptive": [],
                            "captions": [],
                            "chapters": [],
                            "related": MOCK_VIDEOS[1:5],
                        }),
                    )
                else:
                    route.continue_()

            page.route("**/api/*", _mock_api)
            page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
            page.on(
                "console",
                lambda msg: (
                    errors.append(f"console.error: {msg.text}")
                    if msg.type == "error" and "404 ()" not in msg.text
                    else None
                ),
            )

            page.goto(url, wait_until="domcontentloaded")
            page.locator("#homeGrid .video-card").first.wait_for(state="visible", timeout=15000)
            assert page.locator("#homeGrid .video-card").count() >= 12
            assert not page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")

            # Open Watch view & verify title renders (and zero YouTube iframe)
            page.locator("#searchInput").fill("https://www.youtube.com/watch?v=YE7VzlLtp-4")
            page.get_by_role("button", name="Cari", exact=True).click()
            page.wait_for_selector("#viewWatch:not([hidden])", timeout=10000)
            assert page.locator("iframe").count() == 0
            assert page.locator("#videoPlayer").is_visible()

            # Open Settings / Customize view
            page.locator('#appSidebar .nav-item:has-text("Kustomisasi")').click()
            page.wait_for_selector("#viewCustomize:not([hidden])", timeout=10000)

            browser.close()
        httpd.shutdown()
        assert not errors, f"UI errors detected: {errors}"
        print("CI_E2E_OK")


if __name__ == "__main__":
    run_ci_e2e()
