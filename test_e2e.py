import json
import os
import sys
import threading
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
_DEFAULT_ARTIFACT_DIR = Path("/home/qwerty/.gemini/antigravity/brain/5215d074-2e70-48d5-8f7f-cf9ccb251bd7")
ARTIFACT_DIR = Path(
    os.environ.get(
        "ONYXTUBE_ARTIFACT_DIR",
        str(_DEFAULT_ARTIFACT_DIR if _DEFAULT_ARTIFACT_DIR.parent.exists() else ROOT / "dist" / "test-screens"),
    )
)
SCREENS_DIR = ROOT.parent / "replica" / "clone-screens"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
SCREENS_DIR.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT))

from server import OnyxHandler, ThreadingHTTPServer  # noqa: E402


class QuietOnyxHandler(OnyxHandler):
    def log_message(self, format, *args):
        pass


def check_no_overflow(page, label: str) -> None:
    overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
    assert not overflow, f"Horizontal overflow detected at {label}"


def run_tests() -> None:
    with ThreadingHTTPServer(("127.0.0.1", 0), QuietOnyxHandler) as httpd:
        port = httpd.server_address[1]
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{port}/index.html"

        errors: list[str] = []
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1280, "height": 820})
            page = context.new_page()

            page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
            page.on(
                "response",
                lambda res: (
                    errors.append(f"HTTP {res.status} on {res.url}")
                    if (res.status >= 500 or (res.status >= 400 and "127.0.0.1" in res.url))
                    else None
                ),
            )
            page.on(
                "console",
                lambda msg: (
                    errors.append(f"console.error: {msg.text}")
                    if msg.type == "error" and "404 ()" not in msg.text
                    else None
                ),
            )

            page.goto(url, wait_until="domcontentloaded")

            # 1. FreeTube-style Home Trending opens immediately on real videos + spotlight
            page.locator("#homeGrid .video-card").first.wait_for(state="visible", timeout=20000)
            assert page.locator("#homeSpotlight").is_visible(), "Home spotlight hero should render on Beranda"
            page.wait_for_function(
                "Array.from(document.querySelectorAll('#homeGrid img')).slice(0, 6).every(i => i.complete && i.naturalWidth > 0)",
                timeout=15000,
            )
            initial_home_count = page.locator("#homeGrid .video-card").count()
            assert initial_home_count >= 12, f"Home grid should render abundant initial videos, got {initial_home_count}"
            assert page.locator("#appSidebar .nav-item").count() == 5
            check_no_overflow(page, "Desktop Home Dark 1280px")
            page.screenshot(path=str(ARTIFACT_DIR / "screen_home_dark.png"))
            page.screenshot(path=str(SCREENS_DIR / "S01.png"))

            # Scroll Home to verify page is scrollable and triggers infinite scroll auto-append
            page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
            page.wait_for_function("window.scrollY > 100", timeout=5000)
            if page.locator("#homeMoreBar").is_visible():
                page.wait_for_function(
                    "(prev) => document.querySelectorAll('#homeGrid .video-card').length > prev",
                    arg=initial_home_count,
                    timeout=20000,
                )
            page.evaluate("window.scrollTo(0, 0)")

            # 2. Switch Trending Category Tab (Teknologi)
            page.get_by_role("tab", name="Teknologi").click()
            page.locator("#homeGrid .video-card").first.wait_for(state="visible", timeout=15000)
            assert page.get_by_role("tab", name="Teknologi").get_attribute("aria-selected") == "true"

            # 3. Search Validation (empty), Autocomplete Suggest, Live Search & Infinite Scroll
            page.get_by_role("button", name="Cari", exact=True).click()
            assert page.locator("#statusBar").is_visible(), "Empty search must show clear notice"
            page.locator("#searchInput").focus()
            page.locator("#searchInput").fill("big buck")
            page.locator("#searchSuggestBox").wait_for(state="visible", timeout=8000)
            assert page.locator("#searchSuggestList .search-suggest-item").count() >= 1, "Search autocomplete must populate suggestions"
            page.locator("#searchInput").fill("big buck bunny")
            page.get_by_role("button", name="Cari", exact=True).click()
            try:
                page.locator("#searchGrid .video-card").first.wait_for(state="visible", timeout=20000)
            except Exception as exc:
                diag = page.evaluate("""() => ({
                    viewSearchHidden: document.getElementById('viewSearch')?.hidden,
                    searchCards: document.querySelectorAll('#searchGrid .video-card').length,
                    suggestHidden: document.getElementById('searchSuggestBox')?.hidden,
                    searchState: document.getElementById('searchState')?.textContent || '',
                    status: document.getElementById('statusText')?.textContent || '',
                    inputVal: document.getElementById('searchInput')?.value || ''
                })""")
                raise AssertionError(f"Search grid wait failed: diag={diag}, errs={errors}") from exc
            initial_search_count = page.locator("#searchGrid .video-card").count()
            assert initial_search_count >= 1
            if page.locator("#searchMoreBar").is_visible():
                page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
                page.wait_for_function("window.scrollY > 100", timeout=5000)
                page.wait_for_function(
                    "(prev) => document.querySelectorAll('#searchGrid .video-card').length > prev",
                    arg=initial_search_count,
                    timeout=20000,
                )
                page.evaluate("window.scrollTo(0, 0)")
            page.locator("#searchFilterBar [data-duration='long']").click()
            page.locator("#searchFilterBar [data-duration='all']").click()
            assert page.locator("#searchGrid .video-card").count() >= 1

            # 4. Zero-Logo Native Watch Player via direct YouTube URL + SponsorBlock mock
            page.route(
                "**/sponsor.ajay.app/**",
                lambda route: route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps([{"UUID": "sb-test-1", "segment": [5, 25], "category": "sponsor"}]),
                ),
            )
            page.locator("#searchInput").fill("https://www.youtube.com/watch?v=YE7VzlLtp-4")
            page.get_by_role("button", name="Cari", exact=True).click()
            page.wait_for_selector("#viewWatch:not([hidden])", timeout=5000)

            # Verify ZERO YouTube iframe anywhere in Watch View
            assert page.locator("iframe").count() == 0, "Must NOT mount YouTube branded iframe!"
            assert page.locator("#videoPlayer").is_visible(), "Native HTML5 <video> must be present"
            try:
                page.wait_for_function(
                    "document.querySelector('#playerBusyOverlay').hidden === true && document.querySelector('#videoPlayer').readyState >= 2 && document.querySelector('#videoPlayer').videoWidth >= 640",
                    timeout=45000,
                )
            except Exception as exc:
                diag = page.evaluate("""() => ({
                    busyH: document.querySelector('#playerBusyOverlay')?.hidden,
                    busyM: document.querySelector('#playerBusyMsg')?.textContent || '',
                    rs: document.querySelector('#videoPlayer')?.readyState,
                    vw: document.querySelector('#videoPlayer')?.videoWidth,
                    src: document.querySelector('#videoPlayer')?.currentSrc || ''
                })""")
                raise AssertionError(f"Watch player readiness failed: {diag}") from exc
            page.wait_for_function(
                "document.querySelector('#watchTitle').textContent.includes('Big Buck Bunny')",
                timeout=10000,
            )
            document_dur = page.locator("#timeDisplay").inner_text()
            assert document_dur and not document_dur.endswith("/ 00:00"), f"Duration missing in timeDisplay: {document_dur}"
            page.evaluate("document.querySelector('#videoPlayer').currentTime = 2")
            page.wait_for_function("document.querySelector('#videoPlayer').currentTime >= 1.5 && document.querySelector('#videoPlayer').readyState >= 2", timeout=10000)
            # Test +10s forward skip (#seekFwdBtn): must seek rapidly without showing any center spinner
            page.locator("#seekFwdBtn").click()
            page.wait_for_function("document.querySelector('#videoPlayer').currentTime >= 11.0 && document.querySelector('#videoPlayer').readyState >= 2", timeout=5000)
            assert page.evaluate("!document.getElementById('playerFrameShell').classList.contains('is-buffering') && getComputedStyle(document.getElementById('playerFrameShell'), '::after').display === 'none'"), "Center buffering spinner must not appear on +10s skip"
            assert page.locator("#sponsorMarkers .sponsor-marker-band").count() >= 1
            assert page.locator("#qualitySelect option").count() >= 2
            page.wait_for_function(
                "document.querySelectorAll('#relatedList .related-item').length >= 1",
                timeout=30000,
            )
            assert page.locator("#relatedList .related-item").count() >= 1
            assert page.locator("#relatedList .related-item.is-up-next").count() == 1
            assert not page.locator("#nextVideoBtn").is_disabled()
            assert page.locator("#autoNextToggleBtn").get_attribute("aria-pressed") == "true"
            assert page.locator("#sponsorToggleBtn").get_attribute("aria-pressed") == "true"

            # Verify YouTube-parity controls: Subtitles (CC), Like, Share, Loop, and Comments
            assert page.locator("#ccSelect option").count() >= 2, "Captions select must expose available subtitle tracks"
            page.locator("#ccBtn").click()
            assert page.locator("#ccBtn").get_attribute("aria-pressed") == "true"
            assert page.evaluate("Array.from(document.querySelector('#videoPlayer').textTracks).some(t => t.mode === 'showing')")
            page.locator("#likeBtn").click()
            assert page.locator("#likeBtn").get_attribute("aria-pressed") == "true"
            page.locator("#shareBtn").click()
            assert "Tautan" in page.locator("#statusText").inner_text()
            assert page.evaluate("""() => {
                const seekRow = document.querySelector('.seek-row');
                const stage = document.getElementById('playerStage');
                const video = document.getElementById('videoPlayer');
                return seekRow && getComputedStyle(seekRow).height === '18px' &&
                       stage && getComputedStyle(stage).backfaceVisibility === 'hidden' &&
                       video && getComputedStyle(video).backfaceVisibility === 'hidden';
            }"""), "Player stage and seek-row anti-flicker styles must be active"
            page.locator("#commentsList .comment-card").first.wait_for(state="visible", timeout=25000)
            initial_comments = page.locator("#commentsList .comment-card").count()
            assert initial_comments >= 1, "Top comments must load cleanly"
            if page.locator("#commentsMoreBar").is_visible():
                page.locator("#commentsMoreBtn").click()
                page.wait_for_function(
                    "(prev) => document.querySelectorAll('#commentsList .comment-card').length > prev",
                    arg=initial_comments,
                    timeout=25000,
                )

            assert page.locator("#ambientToggleBtn").get_attribute("aria-pressed") == "true"
            player_select_ok = page.evaluate("""() => ['speedSelect', 'qualitySelect', 'ccSelect'].every((id) => {
                const el = document.getElementById(id);
                const cs = el ? getComputedStyle(el) : null;
                return cs && cs.appearance === 'none' && cs.backgroundColor !== 'rgb(255, 255, 255)' && cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
            })""")
            assert player_select_ok, "Player <select> controls must use opaque dark styling with appearance: none"
            page.locator("#queueDrawerBtn").wait_for(state="visible", timeout=5000)
            page.locator("#queueDrawerBtn").click()
            page.wait_for_selector("#queueDrawer:not([hidden])", timeout=3000)
            q_count = page.locator("#queueDrawerList .queue-item-row").count()
            assert q_count > 15, f"Unlimited queue must exceed previous 15-item limit, got {q_count}"
            assert "Tanpa batas" in page.locator("#queueDrawerCount").inner_text()
            page.evaluate("typeof extendUnlimitedQueue === 'function' && extendUnlimitedQueue(true)")
            page.wait_for_function("(prev) => document.querySelectorAll('#queueDrawerList .queue-item-row').length > prev", arg=q_count, timeout=15000)
            page.locator("#queueDrawerClose").click()
            assert page.locator("#queueDrawer").is_hidden()

            page.evaluate("window.scrollTo(0, 0)")
            time.sleep(0.1)
            check_no_overflow(page, "Desktop Watch 1280px")
            page.screenshot(path=str(ARTIFACT_DIR / "screen_watch_player.png"))
            page.screenshot(path=str(SCREENS_DIR / "S02.png"))

            # Test Loop toggle keeps playback at 0 instead of triggering Up Next
            page.locator("#loopBtn").click()
            assert page.locator("#loopBtn").get_attribute("aria-pressed") == "true"
            page.evaluate("document.querySelector('#videoPlayer').dispatchEvent(new Event('ended'))")
            time.sleep(0.25)
            assert page.locator("#upNextOverlay").is_hidden(), "Loop mode must replay without showing Up Next"
            page.locator("#loopBtn").click()
            assert page.locator("#loopBtn").get_attribute("aria-pressed") == "false"

            # 4B. Test Persistent Miniplayer when navigating to Beranda!
            page.evaluate("document.querySelector('#videoPlayer').play().catch(() => {})")
            page.locator(".nav-item[data-nav='home']").click()
            page.wait_for_selector("#viewHome:not([hidden])", timeout=3000)
            page.wait_for_selector("#viewWatch.is-miniplayer:not([hidden])", timeout=3000)
            assert page.locator("#miniPlayerBar").is_visible(), "Miniplayer control bar must be visible on Beranda"
            assert "Big Buck Bunny" in page.locator("#miniTitle").inner_text()
            assert page.evaluate("document.querySelector('#videoPlayer').paused === false"), "Miniplayer must keep playing seamlessly when switching to Beranda"
            check_no_overflow(page, "Desktop Beranda + Miniplayer 1280px")
            page.screenshot(path=str(ARTIFACT_DIR / "screen_miniplayer_home.png"))

            # Test Miniplayer Play/Pause toggle, Expand click, #backBtn & #brandHomeBtn triggers
            page.locator("#miniPlayPauseBtn").click()
            assert page.evaluate("document.querySelector('#videoPlayer').paused === true")
            page.locator("#miniPlayPauseBtn").click()
            page.locator("#miniExpandBtn").click()
            page.wait_for_selector("#viewWatch:not(.is-miniplayer):not([hidden])", timeout=3000)

            page.locator("#backBtn").click()
            page.wait_for_selector("#viewHome:not([hidden])", timeout=3000)
            page.wait_for_selector("#viewWatch.is-miniplayer:not([hidden])", timeout=3000)
            mini_box = page.locator("#viewWatch.is-miniplayer").bounding_box()
            assert mini_box and mini_box["width"] >= 300 and mini_box["height"] >= 180, f"Invalid miniplayer box after #backBtn: {mini_box}"
            page.locator("#playerStage").click()
            page.wait_for_selector("#viewWatch:not(.is-miniplayer):not([hidden])", timeout=3000)

            page.locator("#brandHomeBtn").click()
            page.wait_for_selector("#viewHome:not([hidden])", timeout=3000)
            page.wait_for_selector("#viewWatch.is-miniplayer:not([hidden])", timeout=3000)
            page.locator("#miniExpandBtn").click()
            page.wait_for_selector("#viewWatch:not(.is-miniplayer):not([hidden])", timeout=3000)

            # Test speed, > shortcut, theater, shortcuts & ? help modal
            page.keyboard.press("Shift+?")
            page.wait_for_selector("#shortcutHelpModal:not([hidden])", timeout=3000)
            page.keyboard.press("Escape")
            assert page.locator("#shortcutHelpModal").is_hidden()

            page.locator("#speedSelect").select_option("1.5")
            page.evaluate("document.activeElement?.blur?.()")
            assert page.evaluate("document.querySelector('#videoPlayer').playbackRate") == 1.5
            page.keyboard.press(">")
            assert page.evaluate("document.querySelector('#videoPlayer').playbackRate") == 2.0
            page.keyboard.press("<")
            assert page.evaluate("document.querySelector('#videoPlayer').playbackRate") == 1.5
            page.keyboard.press("t")
            assert "is-theater" in (page.locator("#viewWatch").get_attribute("class") or "")
            page.keyboard.press("t")
            page.unroute("**/sponsor.ajay.app/**")

            # Test Up Next overlay cancel, Autoplay toggle, and countdown auto-advance
            initial_title = page.locator("#watchTitle").inner_text()
            expected_next_id = page.locator("#relatedList .related-item.is-up-next").get_attribute("data-video-id")
            assert expected_next_id

            page.evaluate("document.querySelector('#videoPlayer').dispatchEvent(new Event('ended'))")
            page.locator("#upNextOverlay").wait_for(state="visible", timeout=2000)
            check_no_overflow(page, "Desktop Watch Up Next Overlay 1280px")
            page.locator("#upNextCancelBtn").click()
            assert page.locator("#upNextOverlay").is_hidden(), "Cancel button must hide Up Next overlay"
            assert page.locator("#watchTitle").inner_text() == initial_title

            page.locator("#autoNextToggleBtn").click()
            assert page.locator("#autoNextToggleBtn").get_attribute("aria-pressed") == "false"
            page.evaluate("document.querySelector('#videoPlayer').dispatchEvent(new Event('ended'))")
            time.sleep(0.35)
            assert page.locator("#upNextOverlay").is_hidden(), "Autoplay OFF must not show Up Next overlay"
            page.locator("#autoNextToggleBtn").click()
            assert page.locator("#autoNextToggleBtn").get_attribute("aria-pressed") == "true"

            page.evaluate("document.querySelector('#videoPlayer').dispatchEvent(new Event('ended'))")
            page.locator("#upNextOverlay").wait_for(state="visible", timeout=2000)
            try:
                page.wait_for_function(
                    """(prevTitle) => {
                        const ov = document.querySelector('#upNextOverlay');
                        const busy = document.querySelector('#playerBusyOverlay');
                        const v = document.querySelector('#videoPlayer');
                        const t = document.querySelector('#watchTitle')?.textContent || '';
                        return ov?.hidden === true && t !== prevTitle && busy?.hidden === true && v.readyState >= 2;
                    }""",
                    arg=initial_title,
                    timeout=45000,
                )
            except Exception as exc:
                diag = page.evaluate("""() => ({
                    title: document.querySelector('#watchTitle')?.textContent || '',
                    busyHidden: document.querySelector('#playerBusyOverlay')?.hidden,
                    busyMsg: document.querySelector('#playerBusyMsg')?.textContent || '',
                    rs: document.querySelector('#videoPlayer')?.readyState
                })""")
                raise AssertionError(f"Auto-next wait failed from={initial_title!r}, diag={diag}") from exc

            # Test Shift+N advances again and #prevVideoBtn returns cleanly
            second_title = " ".join(page.locator("#watchTitle").inner_text().split())
            page.keyboard.press("Shift+N")
            try:
                page.wait_for_function(
                    """(prevTitle) => {
                        const busy = document.querySelector('#playerBusyOverlay');
                        const v = document.querySelector('#videoPlayer');
                        const t = (document.querySelector('#watchTitle')?.textContent || '').replace(/\\s+/g, ' ').trim();
                        return t && t !== prevTitle && busy?.hidden === true && v.readyState >= 2;
                    }""",
                    arg=second_title,
                    timeout=45000,
                )
            except Exception as exc:
                diag = page.evaluate("""() => ({
                    title: document.querySelector('#watchTitle')?.textContent || '',
                    busyHidden: document.querySelector('#playerBusyOverlay')?.hidden,
                    busyMsg: document.querySelector('#playerBusyMsg')?.textContent || '',
                    rs: document.querySelector('#videoPlayer')?.readyState
                })""")
                raise AssertionError(f"Shift+N wait failed from={second_title!r}, diag={diag}") from exc
            assert not page.locator("#prevVideoBtn").is_disabled(), "#prevVideoBtn must enable after advancing"
            page.locator("#prevVideoBtn").click()
            try:
                page.wait_for_function(
                    """(expectedTitle) => {
                        const busy = document.querySelector('#playerBusyOverlay');
                        const v = document.querySelector('#videoPlayer');
                        const t = (document.querySelector('#watchTitle')?.textContent || '').replace(/\\s+/g, ' ').trim();
                        return t === expectedTitle && busy?.hidden === true && v.readyState >= 2;
                    }""",
                    arg=second_title,
                    timeout=45000,
                )
            except Exception as exc:
                diag = page.evaluate("""() => ({
                    title: document.querySelector('#watchTitle')?.textContent || '',
                    busyHidden: document.querySelector('#playerBusyOverlay')?.hidden,
                    busyMsg: document.querySelector('#playerBusyMsg')?.textContent || '',
                    readyState: document.querySelector('#videoPlayer')?.readyState,
                    netState: document.querySelector('#videoPlayer')?.networkState,
                    paused: document.querySelector('#videoPlayer')?.paused
                })""")
                raise AssertionError(f"Prev video wait failed: expected={second_title!r}, diag={diag}") from exc

            # 5. Clickable Channel Page, Subscribe, Save Putar Nanti, Liked Tab, History & RSS Langganan
            page.locator("#saveVideoBtn").click()
            sub_btn = page.locator("#subscribeBtn")
            if sub_btn.is_visible():
                sub_btn.click()

            if page.locator("#watchChannelBtn").is_visible():
                page.locator("#watchChannelBtn").click()
                page.wait_for_selector("#viewChannel:not([hidden])", timeout=3000)
                page.locator("#channelGrid .video-card").first.wait_for(state="visible", timeout=15000)
                assert page.locator("#channelTitle").inner_text().strip() != ""
                assert "is-miniplayer" in (page.locator("#viewWatch").get_attribute("class") or "")

            page.locator(".nav-item[data-nav='playlists']").click()
            page.locator("#savedGrid .video-card").first.wait_for(state="visible", timeout=5000)
            page.locator("#playlistTabs [data-ptab='liked']").click()
            page.locator("#savedGrid .video-card").first.wait_for(state="visible", timeout=5000)

            page.locator(".nav-item[data-nav='history']").click()
            page.locator("#historyGrid .video-card").first.wait_for(state="visible", timeout=5000)

            if page.locator("#subCountBadge").is_visible():
                page.locator(".nav-item[data-nav='subscriptions']").click()
                page.locator("#subsGrid .video-card").first.wait_for(state="visible", timeout=15000)

            # Verify Mobile 375px + Compact 840px with Miniplayer active, then close Miniplayer cleanly
            page.set_viewport_size({"width": 840, "height": 720})
            time.sleep(0.2)
            check_no_overflow(page, "Compact Window 840px with Miniplayer")

            page.set_viewport_size({"width": 375, "height": 812})
            time.sleep(0.2)
            check_no_overflow(page, "Mobile 375px with Miniplayer")

            # Close Miniplayer cleanly before final desktop & mobile screenshots
            page.locator("#miniCloseBtn").click()
            assert page.locator("#miniPlayerBar").is_hidden()
            assert page.locator("#viewWatch").is_hidden()
            page.set_viewport_size({"width": 1280, "height": 820})

            # 6. Light Mode (Warm Paper) + YouTube Bar & Studio Customization Verification
            page.locator(".nav-item[data-nav='customize']").click()
            page.wait_for_selector("#viewCustomize:not([hidden])", timeout=3000)
            assert page.locator("#optAutoPlayNext").is_checked()
            page.locator("#optAutoPlayNext").uncheck()
            assert page.locator("#autoNextToggleBtn").get_attribute("aria-pressed") == "false"
            page.locator("#optAutoPlayNext").check()
            assert page.locator("#autoNextToggleBtn").get_attribute("aria-pressed") == "true"

            page.locator("#navLayoutSelect").select_option("topbar-tabs")
            assert page.evaluate("document.body.dataset.navLayout") == "topbar-tabs"
            check_no_overflow(page, "Desktop Topbar Tabs 1280px")
            page.locator("#navLayoutSelect").select_option("floating-dock")
            assert page.evaluate("document.body.dataset.navLayout") == "floating-dock"
            check_no_overflow(page, "Desktop Floating Dock 1280px")
            page.locator("#navLayoutSelect").select_option("sidebar")

            page.locator("#seekbarStyleSelect").select_option("cinema-gold")
            assert page.evaluate("document.body.dataset.seekbar") == "cinema-gold"
            page.locator("#playerBarModeSelect").select_option("overlay")
            assert page.evaluate("document.body.dataset.playerBar") == "overlay"
            page.locator("#playerBarModeSelect").select_option("dock")

            page.locator("#cardStyleSelect").select_option("framed")
            assert "card-framed" in (page.locator("body").get_attribute("class") or "")
            page.locator("#cardStyleSelect").select_option("editorial")
            page.locator("#fontPresetSelect").select_option("editorial")
            assert "font-editorial" in (page.locator("body").get_attribute("class") or "")
            page.locator("#fontPresetSelect").select_option("sans")

            page.locator("#brandTitleInput").fill("StudioKu")
            assert page.locator("#brandLabel").inner_text().strip() == "StudioKu"
            page.locator("#brandTitleInput").fill("OnyxTube")
            assert page.locator("#brandLabel").inner_text().strip() == "OnyxTube"

            page.locator(".preset-btn[data-preset='matcha-kyoto']").click()
            assert page.evaluate("document.documentElement.getAttribute('data-theme')") == "matcha-kyoto"
            page.locator(".preset-btn[data-preset='warm-paper']").click()
            assert page.evaluate("document.documentElement.getAttribute('data-theme')") == "warm-paper"
            cust_select_ok = page.evaluate("""() => ['navLayoutSelect', 'searchAlignSelect', 'playerBarModeSelect', 'seekbarStyleSelect', 'cardStyleSelect', 'fontPresetSelect', 'densitySelect'].every((id) => {
                const el = document.getElementById(id);
                const cs = el ? getComputedStyle(el) : null;
                return cs && cs.appearance === 'none' && cs.backgroundColor !== cs.color;
            })""")
            assert cust_select_ok, "Customize <select> controls must have appearance: none and valid contrast in light mode"
            page.locator("#densitySelect").select_option("compact")
            assert "density-compact" in (page.locator("body").get_attribute("class") or "")
            assert page.locator("#ftSettingsNav .ft-settings-nav-btn").count() == 7
            page.locator("#ftSettingsNav .ft-settings-nav-btn[data-ft-cat='distraction']").click()
            assert not page.locator(".customize-panel[data-ft-section='distraction']").is_hidden()
            assert page.locator(".customize-panel[data-ft-section='theme']").is_hidden()
            page.locator("#optHideComments").check()
            assert "hide-comments" in (page.locator("body").get_attribute("class") or "")
            page.locator("#optHideComments").uncheck()
            page.locator("#ftSettingsSearchInput").fill("sponsorblock")
            assert not page.locator(".customize-panel[data-ft-section='sponsorblock']").is_hidden()
            page.locator("#ftSettingsSearchInput").fill("")
            page.locator("#ftSettingsNav .ft-settings-nav-btn[data-ft-cat='all']").click()
            page.locator("#userCssInput").fill(".view-title { letter-spacing: 0em; }")
            page.locator("#applyCssBtn").click()
            assert ".view-title" in page.locator("#userInjectedStyles").inner_text()
            page.evaluate("window.scrollTo(0, 0)")
            time.sleep(0.1)
            page.screenshot(path=str(ARTIFACT_DIR / "screen_customize_light.png"))
            page.screenshot(path=str(SCREENS_DIR / "S03.png"))

            # Verify Quick Light Theme Home screenshot
            page.locator(".nav-item[data-nav='home']").click()
            page.locator("#homeGrid .video-card").first.wait_for(state="visible", timeout=5000)
            page.screenshot(path=str(ARTIFACT_DIR / "screen_home_light.png"))

            # Reset back to Studio Dark and verify desktop #mobileMenuBtn responds across sidebar & topbar-tabs
            page.locator("#quickThemeBtn").click()
            assert page.evaluate("document.documentElement.getAttribute('data-theme')") == "studio-dark"
            page.locator("#mobileMenuBtn").click()
            assert "is-collapsed" in (page.locator("#appShell").get_attribute("class") or "")
            assert page.locator("#mobileMenuBtn").get_attribute("aria-expanded") == "false"
            page.locator("#mobileMenuBtn").click()
            assert "is-collapsed" not in (page.locator("#appShell").get_attribute("class") or "")
            assert page.locator("#mobileMenuBtn").get_attribute("aria-expanded") == "true"

            page.set_viewport_size({"width": 840, "height": 720})
            time.sleep(0.2)
            check_no_overflow(page, "Compact Window 840px")

            page.set_viewport_size({"width": 375, "height": 812})
            time.sleep(0.2)
            check_no_overflow(page, "Mobile Drawer 375px")
            page.locator("#mobileMenuBtn").click()
            time.sleep(0.25)
            assert "is-drawer-open" in (page.locator("#appShell").get_attribute("class") or "")
            assert page.locator("#appSidebar").bounding_box()["width"] >= 200
            page.screenshot(path=str(ARTIFACT_DIR / "screen_mobile_drawer.png"))
            page.keyboard.press("Escape")

            browser.close()

        assert not errors, f"Runtime errors detected: {errors}"
        print("E2E_ALL_PASS: 0 errors, Miniplayer + FreeTube shell + YouTube features + light/dark + customizer verified.")


if __name__ == "__main__":
    run_tests()
