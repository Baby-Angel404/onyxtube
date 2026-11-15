/* ============================================================================
 * OnyxTube Desktop Controller
 * FreeTube-style local client with zero-logo HTML5 <video> streaming & Studio UI
 * ============================================================================ */

const STORAGE_KEY = 'onyxtube_desktop_v2';
const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

const THEME_PRESETS = {
  'studio-dark': {
    name: 'Studio Ink (Gelap)',
    isLight: false,
    accent: '#c8371d',
    bg: '#111317',
    surface: '#1b1f27',
  },
  'warm-paper': {
    name: 'Warm Paper (Terang)',
    isLight: true,
    accent: '#b83016',
    bg: '#f5f1e8',
    surface: '#ffffff',
  },
  'cinema-noir': {
    name: 'Cinema Noir',
    isLight: false,
    accent: '#8f5400',
    bg: '#09090b',
    surface: '#17171c',
  },
  'matcha-kyoto': {
    name: 'Matcha Kyoto',
    isLight: false,
    accent: '#176e4b',
    bg: '#0d1411',
    surface: '#16231d',
  },
  'matcha-cream': {
    name: 'Matcha Cream (Terang)',
    isLight: true,
    accent: '#156943',
    bg: '#eff3ec',
    surface: '#fafcf9',
  },
  'nordic-mist': {
    name: 'Nordic Mist',
    isLight: false,
    accent: '#1d6c80',
    bg: '#131820',
    surface: '#1e2633',
  },
  'sunset-sand': {
    name: 'Sunset Sand (Terang)',
    isLight: true,
    accent: '#a83715',
    bg: '#f7efe6',
    surface: '#fffcf8',
  },
  'oled-slate': {
    name: 'OLED Slate',
    isLight: false,
    accent: '#c8371d',
    bg: '#030406',
    surface: '#10131a',
  },
};

const DEFAULT_PREFS = {
  theme: 'studio-dark',
  customColors: null,
  density: 'comfortable',
  radius: 10,
  fontScale: 1,
  sidebarCollapsed: false,
  hideViews: false,
  hideRelated: false,
  autoSponsorSkip: true,
  autoPlayNext: true,
  customCss: '',
  navLayout: 'sidebar',
  searchAlign: 'center',
  brandTitle: 'OnyxTube',
  navOrder: ['home', 'subscriptions', 'playlists', 'history', 'customize'],
  hiddenNavs: [],
  playerBarMode: 'dock',
  seekbarStyle: 'accent',
  seekbarColor: '#ff1e2d',
  seekbarHeight: 5,
  ambientMode: true,
  showSpotlight: true,
  cardStyle: 'editorial',
  fontPreset: 'sans',
  subsNotify: true,
  autoUpdateYtdlp: true,
  defaultQuality: 720,
  defaultSpeed: 1,
  hideComments: false,
  hideShorts: false,
  sbSponsor: true,
  sbSelfpromo: true,
  sbIntro: true,
  sbOutro: true,
};

const state = {
  currentView: 'home',
  previousView: 'home',
  activeTab: 'all',
  activeChannelId: '',
  playlistTab: 'saved',
  searchDurationFilter: 'all',
  rawSearchResults: [],
  lastSearchQuery: '',
  miniPlayerClosed: false,
  loopVideo: false,
  sleepTimerMode: '',
  sleepTimerDeadline: 0,
  sleepTimerInterval: 0,
  currentVideo: null,
  currentQualities: [],
  currentRelated: [],
  currentChapters: [],
  currentCaptions: [],
  activeCaptionLang: '',
  playQueue: [],
  watchHistoryStack: [],
  recentPlayedIds: [],
  upNextTimer: 0,
  upNextCandidate: null,
  activeQualityItag: '',
  sponsorSegments: [],
  skippedSegmentIds: new Set(),
  dualAudioActive: false,
  streamAbort: null,
  commentsAbort: null,
  feedPaging: {
    home: { tab: 'all', items: [], nextOffset: 0, hasMore: false, loading: false, reqSeq: 0 },
    search: { query: '', items: [], nextToken: '', hasMore: false, loading: false, reqSeq: 0 },
    channel: { channelId: '', items: [], nextOffset: 0, total: 0, hasMore: false, loading: false, reqSeq: 0 },
    comments: { videoId: '', items: [], nextToken: '', hasMore: false, loading: false, reqSeq: 0 },
  },
  prefs: {
    ...DEFAULT_PREFS,
    navOrder: [...DEFAULT_PREFS.navOrder],
    hiddenNavs: [],
  },
  subscriptions: [],
  seenSubIds: [],
  unseenSubVideos: [],
  saved: [],
  liked: [],
  dislikedIds: [],
  history: [],
  progress: {},
  lastProgressSaveAt: 0,
};

/* --- Storage Helpers --- */
function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.prefs && typeof parsed.prefs === 'object') {
      const legacyMap = { 'nord-slate': 'nordic-mist', 'terminal-moss': 'matcha-kyoto' };
      const rawTheme = parsed.prefs.theme;
      const mappedTheme = legacyMap[rawTheme] || rawTheme;
      state.prefs = {
        ...DEFAULT_PREFS,
        ...parsed.prefs,
        theme: THEME_PRESETS[mappedTheme] ? mappedTheme : DEFAULT_PREFS.theme,
        navOrder: Array.isArray(parsed.prefs.navOrder) ? [...parsed.prefs.navOrder] : [...DEFAULT_PREFS.navOrder],
        hiddenNavs: Array.isArray(parsed.prefs.hiddenNavs) ? [...parsed.prefs.hiddenNavs] : [],
      };
    }
    if (Array.isArray(parsed.subscriptions)) state.subscriptions = parsed.subscriptions;
    if (Array.isArray(parsed.seenSubIds)) state.seenSubIds = parsed.seenSubIds.slice(0, 400);
    if (Array.isArray(parsed.saved)) state.saved = parsed.saved;
    if (Array.isArray(parsed.liked)) state.liked = parsed.liked;
    if (Array.isArray(parsed.dislikedIds)) state.dislikedIds = parsed.dislikedIds;
    if (Array.isArray(parsed.history)) state.history = parsed.history;
    if (parsed.progress && typeof parsed.progress === 'object') state.progress = parsed.progress;
  } catch {
    // Fallback cleanly to defaults if storage is corrupt
  }
}

function saveStore() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        prefs: state.prefs,
        subscriptions: state.subscriptions,
        seenSubIds: state.seenSubIds.slice(0, 400),
        saved: state.saved,
        liked: state.liked,
        dislikedIds: state.dislikedIds,
        history: state.history,
        progress: state.progress,
      })
    );
  } catch {
    // Ignore storage quota issues safely
  }
}

function saveProgress(videoId, timeSec, durationSec) {
  if (!videoId || !Number.isFinite(timeSec) || timeSec < 5) return;
  state.progress[videoId] = { t: Math.round(timeSec), d: Math.round(durationSec || 0), at: Date.now() };
  const keys = Object.keys(state.progress);
  if (keys.length > 200) {
    delete state.progress[keys[0]];
  }
  state.lastProgressSaveAt = performance.now();
  saveStore();
}

function clearProgress(videoId) {
  if (!videoId || !state.progress[videoId]) return;
  delete state.progress[videoId];
  saveStore();
}

/* --- Contrast Utility for Custom GUI Colors --- */
function hexLuminance(hex) {
  const clean = (hex || '#121316').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return 0.1;
  const nums = [0, 2, 4].map((i) => {
    const c = parseInt(clean.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * nums[0] + 0.7152 * nums[1] + 0.0722 * nums[2];
}

function readableOnColor(bgHex) {
  return hexLuminance(bgHex) > 0.35 ? '#121316' : '#ffffff';
}

function applyNavCustomization() {
  const navList = document.getElementById('sidebarNavList');
  if (!navList) return;
  const baseKeys = ['home', 'subscriptions', 'playlists', 'history', 'customize'];
  const rawOrder = Array.isArray(state.prefs.navOrder) ? state.prefs.navOrder : [];
  const order = [...rawOrder.filter((k) => baseKeys.includes(k))];
  baseKeys.forEach((k) => {
    if (!order.includes(k)) order.push(k);
  });
  const hiddenSet = new Set(Array.isArray(state.prefs.hiddenNavs) ? state.prefs.hiddenNavs : []);

  const byKey = new Map();
  navList.querySelectorAll('.nav-item[data-nav]').forEach((btn) => {
    byKey.set(btn.dataset.nav, btn);
  });

  order.forEach((k) => {
    const btn = byKey.get(k);
    if (!btn) return;
    btn.hidden = hiddenSet.has(k) && k !== 'customize';
    navList.appendChild(btn);
  });
}

/* --- Theme & GUI Customizer Application --- */
function applyPreferencesToDOM() {
  const root = document.documentElement;
  const p = state.prefs;
  const themeKey = THEME_PRESETS[p.theme] ? p.theme : 'studio-dark';
  const preset = THEME_PRESETS[themeKey];

  root.setAttribute('data-theme', themeKey);

  const inlineKeys = [
    '--color-accent',
    '--color-accent-hover',
    '--color-on-accent',
    '--color-bg',
    '--color-surface',
    '--color-accent-text',
    '--seekbar-fill',
    '--seekbar-glow',
  ];
  inlineKeys.forEach((k) => root.style.removeProperty(k));

  if (p.customColors) {
    if (p.customColors.accent) {
      root.style.setProperty('--color-accent', p.customColors.accent);
      root.style.setProperty('--color-accent-hover', p.customColors.accent);
      root.style.setProperty('--color-on-accent', readableOnColor(p.customColors.accent));
      const surfLum = hexLuminance(p.customColors.surface || preset.surface);
      root.style.setProperty('--color-accent-text', surfLum < 0.25 && hexLuminance(p.customColors.accent) < 0.25 ? '#ff8a70' : p.customColors.accent);
    }
    if (p.customColors.bg) root.style.setProperty('--color-bg', p.customColors.bg);
    if (p.customColors.surface) root.style.setProperty('--color-surface', p.customColors.surface);
  }

  root.style.setProperty('--radius-card', `${Number(p.radius) || 0}px`);
  root.style.setProperty('--radius-control', `${Math.min(10, Number(p.radius) || 0)}px`);
  root.style.setProperty('--ui-font-scale', String(p.fontScale || 1));
  root.style.setProperty('--seekbar-height', `${Math.max(3, Math.min(10, Number(p.seekbarHeight) || 5))}px`);

  document.body.dataset.seekbar = p.seekbarStyle || 'accent';
  if (p.seekbarStyle === 'custom' && p.seekbarColor) {
    root.style.setProperty('--seekbar-fill', p.seekbarColor);
    root.style.setProperty('--seekbar-glow', `0 0 10px ${p.seekbarColor}66`);
  }

  document.body.dataset.navLayout = p.navLayout || 'sidebar';
  document.body.dataset.searchAlign = p.searchAlign || 'center';
  document.body.dataset.playerBar = p.playerBarMode || 'dock';

  document.body.classList.toggle('has-ambient', p.ambientMode !== false);
  const ambientImg = document.getElementById('playerAmbientImg');
  if (ambientImg) {
    ambientImg.hidden = p.ambientMode === false || !ambientImg.getAttribute('src');
  }

  document.body.classList.toggle('card-framed', p.cardStyle === 'framed');
  document.body.classList.toggle('card-elevated', p.cardStyle === 'elevated');
  document.body.classList.toggle('font-editorial', p.fontPreset === 'editorial');
  document.body.classList.toggle('font-mono', p.fontPreset === 'mono');

  if (p.density === 'compact') {
    root.style.setProperty('--card-gap', '10px');
    root.style.setProperty('--card-pad', '8px');
    document.body.classList.add('density-compact');
  } else {
    root.style.setProperty('--card-gap', '18px');
    root.style.setProperty('--card-pad', '10px');
    document.body.classList.remove('density-compact');
  }

  document.body.classList.toggle('hide-views', Boolean(p.hideViews));
  document.body.classList.toggle('hide-related', Boolean(p.hideRelated));
  document.body.classList.toggle('hide-comments', Boolean(p.hideComments));
  document.body.classList.toggle('hide-shorts', Boolean(p.hideShorts));

  const shell = document.getElementById('appShell');
  shell.classList.toggle('is-collapsed', Boolean(p.sidebarCollapsed));

  const brandLbl = document.getElementById('brandLabel');
  if (brandLbl) {
    brandLbl.textContent = (p.brandTitle || 'OnyxTube').trim() || 'OnyxTube';
  }
  applyNavCustomization();

  const styleTag = document.getElementById('userInjectedStyles');
  if (styleTag) styleTag.textContent = p.customCss || '';

  const themeBtnLabel = document.getElementById('quickThemeLabel');
  if (themeBtnLabel) {
    themeBtnLabel.textContent = preset.isLight ? 'Tema: Terang' : 'Tema: Gelap';
  }

  syncCustomizeControls();
}

function syncCustomizeControls() {
  const p = state.prefs;
  const preset = THEME_PRESETS[p.theme] || THEME_PRESETS['studio-dark'];
  const colors = p.customColors || preset;

  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.preset === p.theme);
  });

  const accIn = document.getElementById('customAccentInput');
  const bgIn = document.getElementById('customBgInput');
  const sfIn = document.getElementById('customSurfaceInput');
  if (accIn) accIn.value = colors.accent || preset.accent;
  if (bgIn) bgIn.value = colors.bg || preset.bg;
  if (sfIn) sfIn.value = colors.surface || preset.surface;

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = String(val);
  };
  setVal('navLayoutSelect', p.navLayout || 'sidebar');
  setVal('searchAlignSelect', p.searchAlign || 'center');
  setVal('defaultQualitySelect', p.defaultQuality || 720);
  setVal('defaultSpeedSelect', p.defaultSpeed || 1);
  const brandIn = document.getElementById('brandTitleInput');
  if (brandIn && document.activeElement !== brandIn) {
    brandIn.value = p.brandTitle || 'OnyxTube';
  }
  setVal('playerBarModeSelect', p.playerBarMode || 'dock');
  setVal('seekbarStyleSelect', p.seekbarStyle && p.seekbarStyle !== 'custom' ? p.seekbarStyle : 'accent');
  setVal('customSeekbarInput', p.seekbarColor || '#ff1e2d');
  setVal('seekbarHeightRange', p.seekbarHeight || 5);
  const shLbl = document.getElementById('seekbarHeightLabel');
  if (shLbl) shLbl.textContent = `${p.seekbarHeight || 5}px`;

  setVal('cardStyleSelect', p.cardStyle || 'editorial');
  setVal('fontPresetSelect', p.fontPreset || 'sans');
  setVal('densitySelect', p.density || 'comfortable');
  setVal('radiusRange', p.radius ?? 10);
  const radLbl = document.getElementById('radiusValueLabel');
  if (radLbl) radLbl.textContent = `${p.radius ?? 10}px`;
  setVal('fontScaleRange', p.fontScale || 1);
  const fntLbl = document.getElementById('fontScaleLabel');
  if (fntLbl) fntLbl.textContent = `${Math.round((p.fontScale || 1) * 100)}%`;

  const setCheck = (id, checked) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(checked);
  };
  setCheck('optAmbientMode', p.ambientMode !== false);
  setCheck('optShowSpotlight', p.showSpotlight !== false);
  setCheck('optHideViews', p.hideViews);
  setCheck('optHideRelated', p.hideRelated);
  setCheck('optHideComments', p.hideComments);
  setCheck('optHideShorts', p.hideShorts);
  setCheck('optSponsorBlock', p.autoSponsorSkip);
  setCheck('optSbSponsor', p.sbSponsor !== false);
  setCheck('optSbSelfpromo', p.sbSelfpromo !== false);
  setCheck('optSbIntro', p.sbIntro !== false);
  setCheck('optSbOutro', p.sbOutro !== false);
  setCheck('optAutoPlayNext', p.autoPlayNext);
  setCheck('optSubsNotify', p.subsNotify !== false);
  setCheck('optAutoUpdateYtdlp', p.autoUpdateYtdlp !== false);

  const subsNotifBtn = document.getElementById('subsNotifyBtn');
  if (subsNotifBtn) {
    const notifyOn = p.subsNotify !== false;
    subsNotifBtn.classList.toggle('is-toggled', notifyOn);
    subsNotifBtn.setAttribute('aria-pressed', String(notifyOn));
    subsNotifBtn.textContent = notifyOn ? 'Notifikasi: Aktif' : 'Notifikasi: Mati';
  }

  const cssEd = document.getElementById('userCssInput');
  if (cssEd && document.activeElement !== cssEd) {
    cssEd.value = p.customCss || '';
  }

  const sbToggle = document.getElementById('sponsorToggleBtn');
  if (sbToggle) {
    sbToggle.classList.toggle('is-toggled', Boolean(p.autoSponsorSkip));
    sbToggle.setAttribute('aria-pressed', String(Boolean(p.autoSponsorSkip)));
  }

  const ambToggle = document.getElementById('ambientToggleBtn');
  if (ambToggle) {
    const ambOn = p.ambientMode !== false;
    ambToggle.classList.toggle('is-toggled', ambOn);
    ambToggle.setAttribute('aria-pressed', String(ambOn));
  }

  const autoNextBtn = document.getElementById('autoNextToggleBtn');
  if (autoNextBtn) {
    const enabled = Boolean(p.autoPlayNext);
    autoNextBtn.classList.toggle('is-toggled', enabled);
    autoNextBtn.setAttribute('aria-pressed', String(enabled));
    autoNextBtn.textContent = enabled ? 'Putar Otomatis: Aktif' : 'Putar Otomatis: Mati';
  }

  if (typeof renderNavOrderEditor === 'function') {
    renderNavOrderEditor();
  }
}

/* --- Status & Navigation --- */
function setStatus(message, isError = false, onRetry = null) {
  const bar = document.getElementById('statusBar');
  const text = document.getElementById('statusText');
  const retry = document.getElementById('statusRetryBtn');
  if (!message) {
    bar.hidden = true;
    bar.classList.remove('is-error');
    retry.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.classList.toggle('is-error', isError);
  text.textContent = message;
  if (typeof onRetry === 'function') {
    retry.hidden = false;
    retry.onclick = onRetry;
  } else {
    retry.hidden = true;
    retry.onclick = null;
  }
}

function syncNavMenuToggleState() {
  const btn = document.getElementById('mobileMenuBtn');
  const shell = document.getElementById('appShell');
  if (!btn || !shell) return;
  const navLayout = document.body.dataset.navLayout || state.prefs.navLayout || 'sidebar';
  const useDrawer = window.innerWidth <= 780 || navLayout === 'topbar-tabs' || navLayout === 'floating-dock';
  let expanded = false;
  if (useDrawer) {
    expanded = shell.classList.contains('is-drawer-open');
  } else if (navLayout === 'compact-rail') {
    expanded = shell.classList.contains('is-rail-expanded');
  } else {
    expanded = !shell.classList.contains('is-collapsed');
  }
  btn.setAttribute('aria-expanded', String(expanded));
  btn.title = expanded ? 'Ciutkan menu navigasi ([)' : 'Buka menu navigasi ([)';
}

function closeDrawer() {
  document.getElementById('appShell')?.classList.remove('is-drawer-open');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (backdrop) backdrop.hidden = true;
  syncNavMenuToggleState();
}

function isMiniPlayerActive() {
  const watchEl = document.getElementById('viewWatch');
  return Boolean(watchEl && !watchEl.hidden && watchEl.classList.contains('is-miniplayer'));
}

function updateMiniPlayerUI() {
  const vid = state.currentVideo;
  const titleEl = document.getElementById('miniTitle');
  const chEl = document.getElementById('miniChannel');
  if (titleEl) titleEl.textContent = vid ? vid.title || 'Memutar Video' : 'Memutar Video';
  if (chEl) chEl.textContent = vid ? vid.author || 'YouTube' : 'Channel';
}

function closeMiniPlayer() {
  state.miniPlayerClosed = true;
  if (typeof cancelAutoNextCountdown === 'function') cancelAutoNextCountdown();
  const v = typeof videoEl === 'function' ? videoEl() : document.getElementById('videoPlayer');
  const a = typeof audioEl === 'function' ? audioEl() : document.getElementById('audioPlayer');
  if (v) {
    v.pause();
    v.removeAttribute('src');
    v.load();
  }
  if (a) {
    a.pause();
    a.removeAttribute('src');
    a.load();
  }
  state.dualAudioActive = false;
  const watchEl = document.getElementById('viewWatch');
  const miniBar = document.getElementById('miniPlayerBar');
  if (watchEl) {
    watchEl.classList.remove('is-miniplayer');
    watchEl.hidden = state.currentView !== 'watch';
  }
  if (miniBar) miniBar.hidden = true;
  document.body.classList.remove('has-miniplayer');
  if (typeof updatePlayPauseUI === 'function') updatePlayPauseUI();
}

function switchView(viewName) {
  if (viewName === 'watch') {
    state.miniPlayerClosed = false;
  } else if (state.currentView === 'watch' && typeof cancelAutoNextCountdown === 'function' && (!state.currentVideo || state.miniPlayerClosed)) {
    cancelAutoNextCountdown();
  }
  if (state.currentView !== 'watch' && viewName !== state.currentView && viewName !== 'watch') {
    state.previousView = state.currentView;
  } else if (state.currentView !== 'watch' && viewName === 'watch') {
    state.previousView = state.currentView;
  }
  state.currentView = viewName;

  const views = {
    home: 'viewHome',
    search: 'viewSearch',
    channel: 'viewChannel',
    watch: 'viewWatch',
    subscriptions: 'viewSubscriptions',
    playlists: 'viewPlaylists',
    history: 'viewHistory',
    customize: 'viewCustomize',
  };

  const dockMini = viewName !== 'watch' && Boolean(state.currentVideo) && !state.miniPlayerClosed;
  const watchEl = document.getElementById('viewWatch');
  const miniBar = document.getElementById('miniPlayerBar');

  Object.entries(views).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (key === 'watch') {
      el.hidden = !(viewName === 'watch' || dockMini);
    } else {
      el.hidden = key !== viewName;
    }
  });

  if (watchEl) {
    watchEl.classList.toggle('is-miniplayer', dockMini);
    if (dockMini) watchEl.classList.remove('is-theater');
  }
  if (miniBar) miniBar.hidden = !dockMini;
  document.body.classList.toggle('has-miniplayer', dockMini);
  if (dockMini) updateMiniPlayerUI();

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.nav === viewName);
  });

  const backBtn = document.getElementById('backBtn');
  if (backBtn) backBtn.hidden = viewName !== 'watch';

  closeDrawer();
  if (typeof window.scrollTo === 'function') {
    window.scrollTo(0, 0);
  }

  if (viewName === 'subscriptions') loadSubscriptionsFeed();
  if (viewName === 'playlists') renderSavedView();
  if (viewName === 'history') renderHistoryView();
}

/* --- Reusable Safe DOM Card Builders --- */
function showBoxState(boxId, title, desc, actionLabel = '', actionFn = null) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.replaceChildren();
  const h = document.createElement('h3');
  h.className = 'state-title';
  h.textContent = title;
  const p = document.createElement('p');
  p.className = 'state-desc';
  p.textContent = desc;
  box.append(h, p);
  if (actionLabel && typeof actionFn === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-primary btn-compact';
    btn.textContent = actionLabel;
    btn.onclick = actionFn;
    box.appendChild(btn);
  }
  box.hidden = false;
}

function hideBoxState(boxId) {
  const box = document.getElementById(boxId);
  if (box) box.hidden = true;
}

function isSubscribed(channelId) {
  return Boolean(channelId && state.subscriptions.some((c) => c.id === channelId));
}

function isSaved(videoId) {
  return Boolean(videoId && state.saved.some((v) => v.id === videoId));
}

function isLiked(videoId) {
  return Boolean(videoId && state.liked.some((v) => v.id === videoId));
}

function isDisliked(videoId) {
  return Boolean(videoId && state.dislikedIds.includes(videoId));
}

function toggleSubscribe(channelId, channelName) {
  if (!channelId) return;
  const idx = state.subscriptions.findIndex((c) => c.id === channelId);
  if (idx >= 0) {
    state.subscriptions.splice(idx, 1);
    setStatus(`Berhenti berlangganan dari ${channelName}.`);
  } else {
    state.subscriptions.unshift({ id: channelId, name: channelName || 'Channel' });
    setStatus(`Berlangganan ke ${channelName}.`);
  }
  saveStore();
  updateSidebarBadges();
  updateWatchActionButtons();
  syncChannelHeaderSubscribe();
  if (state.currentView === 'subscriptions') loadSubscriptionsFeed();
}

function toggleSaveVideo(video) {
  if (!video || !video.id) return;
  const idx = state.saved.findIndex((v) => v.id === video.id);
  if (idx >= 0) {
    state.saved.splice(idx, 1);
    setStatus(`Menghapus "${video.title}" dari Putar Nanti.`);
  } else {
    state.saved.unshift({ ...video, savedAt: Date.now() });
    setStatus(`Menyimpan "${video.title}" ke Putar Nanti.`);
  }
  saveStore();
  updateSidebarBadges();
  updateWatchActionButtons();
  if (state.currentView === 'playlists') renderSavedView();
}

function toggleLikeVideo(video) {
  if (!video || !video.id) return;
  const idx = state.liked.findIndex((v) => v.id === video.id);
  if (idx >= 0) {
    state.liked.splice(idx, 1);
    setStatus(`Batal menyukai "${video.title}".`);
  } else {
    state.liked.unshift({ ...video, likedAt: Date.now() });
    state.dislikedIds = state.dislikedIds.filter((id) => id !== video.id);
    setStatus(`Menandai "${video.title}" sebagai disukai.`);
  }
  saveStore();
  updateWatchActionButtons();
  if (state.currentView === 'playlists' && state.playlistTab === 'liked') renderSavedView();
}

function toggleDislikeVideo(video) {
  if (!video || !video.id) return;
  if (state.dislikedIds.includes(video.id)) {
    state.dislikedIds = state.dislikedIds.filter((id) => id !== video.id);
  } else {
    state.dislikedIds.unshift(video.id);
    if (state.dislikedIds.length > 200) state.dislikedIds.length = 200;
    state.liked = state.liked.filter((v) => v.id !== video.id);
    setStatus('Tanggapan tidak suka disimpan secara lokal.');
  }
  saveStore();
  updateWatchActionButtons();
  if (state.currentView === 'playlists' && state.playlistTab === 'liked') renderSavedView();
}

async function shareCurrentVideo() {
  const vid = state.currentVideo;
  if (!vid || !vid.id) return;
  const v = videoEl();
  const sec = v && Number.isFinite(v.currentTime) ? Math.floor(v.currentTime) : 0;
  const shareUrl = sec >= 2 ? `https://youtu.be/${vid.id}?t=${sec}` : `https://youtu.be/${vid.id}`;
  setStatus(`Tautan video disalin: ${shareUrl}`);
  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      copied = true;
    }
  } catch {
    copied = false;
  }
  if (!copied) {
    const tmp = document.createElement('textarea');
    tmp.value = shareUrl;
    tmp.setAttribute('readonly', '');
    tmp.style.position = 'fixed';
    tmp.style.left = '-9999px';
    document.body.appendChild(tmp);
    tmp.select();
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    tmp.remove();
  }
  setStatus(copied ? `Tautan video disalin: ${shareUrl}` : `Tautan siap dibagikan: ${shareUrl}`);
}

function createVideoCardElement(v, queueList, idx = 0) {
  const card = document.createElement('article');
  card.className = 'video-card';
  const dParts = String(v.duration || '').trim().split(':').map(Number);
  const durSecs = dParts.length === 2 ? dParts[0] * 60 + dParts[1] : dParts.length === 3 ? dParts[0] * 3600 + dParts[1] * 60 + dParts[2] : 0;
  if (durSecs > 0 && durSecs <= 60) card.classList.add('is-short-video');
  card.dataset.videoId = v.id;
  card._videoObj = v;
  card.addEventListener('pointerenter', () => scheduleHoverPrefetch(v.id));
  card.addEventListener('pointerleave', () => clearTimeout(hoverPrefetchTimer));

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'card-play-area';
  playBtn.addEventListener('focus', () => scheduleHoverPrefetch(v.id));
  playBtn.addEventListener('click', () => openWatchVideo(v, { queue: queueList }));

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'thumb-wrap';
  const img = document.createElement('img');
  img.src = v.thumbnail || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
  img.alt = v.title;
  if (idx >= 12) img.loading = 'lazy';
  const dur = document.createElement('span');
  dur.className = 'duration-tag';
  dur.textContent = v.duration || 'Video';
  thumbWrap.append(img, dur);

  const body = document.createElement('div');
  body.className = 'card-body';

  const title = document.createElement('h3');
  title.className = 'card-title';
  title.textContent = v.title;
  body.appendChild(title);

  playBtn.append(thumbWrap, body);
  card.appendChild(playBtn);

  if (v.authorId) {
    const authorBtn = document.createElement('button');
    authorBtn.type = 'button';
    authorBtn.className = 'card-author-btn';
    authorBtn.textContent = v.author || 'Creator';
    authorBtn.title = `Buka channel ${v.author || 'Creator'}`;
    authorBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openChannelView(v.authorId, v.author);
    });
    card.appendChild(authorBtn);
  } else {
    const author = document.createElement('p');
    author.className = 'card-author';
    author.textContent = v.author || 'Creator';
    card.appendChild(author);
  }

  const metaParts = [v.views, v.published].filter(Boolean);
  if (metaParts.length > 0) {
    const meta = document.createElement('span');
    meta.className = 'card-meta card-views';
    meta.textContent = metaParts.join(' / ');
    card.appendChild(meta);
  }

  const actions = document.createElement('div');
  actions.className = 'card-footer-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'card-action-link';
  saveBtn.textContent = isSaved(v.id) ? 'Tersimpan' : '+ Putar Nanti';
  saveBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleSaveVideo(v);
    saveBtn.textContent = isSaved(v.id) ? 'Tersimpan' : '+ Putar Nanti';
  });
  actions.appendChild(saveBtn);

  if (v.authorId) {
    const subBtn = document.createElement('button');
    subBtn.type = 'button';
    subBtn.className = 'card-action-link';
    const syncSubLabel = () => {
      const sub = isSubscribed(v.authorId);
      subBtn.textContent = sub ? 'Berlangganan ✓' : '+ Langganan';
      subBtn.classList.toggle('is-subscribed', sub);
    };
    syncSubLabel();
    subBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleSubscribe(v.authorId, v.author);
      syncSubLabel();
    });
    actions.appendChild(subBtn);
  }

  card.appendChild(actions);
  return card;
}

function appendVideoGridItems(gridId, items, queueRef = null) {
  const grid = document.getElementById(gridId);
  if (!grid || !items || items.length === 0) return;
  const existingCount = grid.querySelectorAll('.video-card').length;
  const queueList = queueRef || items;
  const frag = document.createDocumentFragment();
  items.forEach((v, idx) => {
    frag.appendChild(createVideoCardElement(v, queueList, existingCount + idx));
  });
  grid.appendChild(frag);
}

function renderVideoGrid(gridId, stateBoxId, items, emptyTitle, emptyDesc, actionLabel = '', actionFn = null) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.replaceChildren();

  if (!items || items.length === 0) {
    showBoxState(stateBoxId, emptyTitle, emptyDesc, actionLabel, actionFn);
    return;
  }

  hideBoxState(stateBoxId);
  appendVideoGridItems(gridId, items, items);
}

function updateFeedMoreBar(barId, statusId, btnId, opts = {}) {
  const bar = document.getElementById(barId);
  const statusEl = document.getElementById(statusId);
  const btn = document.getElementById(btnId);
  if (!bar) return;

  const loadedCount = Number(opts.loadedCount || 0);
  const hasMore = Boolean(opts.hasMore);
  const loading = Boolean(opts.loading);
  if (loadedCount === 0 && !hasMore && !loading) {
    bar.hidden = true;
    return;
  }

  bar.hidden = false;
  if (statusEl) {
    if (loading) {
      statusEl.textContent = opts.loadingText || 'Memuat video berikutnya...';
    } else if (hasMore) {
      statusEl.textContent = opts.idleText || `${loadedCount} item dimuat. Gulir untuk memuat lagi.`;
    } else {
      statusEl.textContent = `Semua ${loadedCount} item telah ditampilkan.`;
    }
  }
  if (btn) {
    btn.hidden = !hasMore;
    btn.disabled = loading;
    btn.textContent = loading ? 'Memuat...' : 'Muat Lebih Banyak';
  }
}

function renderHomeSpotlight(items) {
  const box = document.getElementById('homeSpotlight');
  if (!box) return;
  const v = Array.isArray(items) && items.length > 0 ? items[0] : null;
  if (!v || state.prefs.showSpotlight === false) {
    box.hidden = true;
    return;
  }

  const thumbImg = document.getElementById('spotlightThumb');
  const durEl = document.getElementById('spotlightDuration');
  const titleEl = document.getElementById('spotlightTitle');
  const metaEl = document.getElementById('spotlightMeta');
  const playArea = document.getElementById('spotlightPlayArea');
  const playBtn = document.getElementById('spotlightPlayBtn');
  const saveBtn = document.getElementById('spotlightSaveBtn');

  if (thumbImg) {
    thumbImg.src = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
    thumbImg.alt = v.title || '';
  }
  if (durEl) durEl.textContent = v.duration || 'Video';
  if (titleEl) titleEl.textContent = v.title || 'Sorotan Pilihan';
  if (metaEl) metaEl.textContent = [v.author, v.views, v.published].filter(Boolean).join(' · ');

  const openHero = () => openWatchVideo(v, { queue: items });
  if (playArea) playArea.onclick = openHero;
  if (playBtn) playBtn.onclick = openHero;
  if (saveBtn) {
    saveBtn.textContent = isSaved(v.id) ? 'Tersimpan' : '+ Putar Nanti';
    saveBtn.onclick = () => {
      toggleSaveVideo(v);
      saveBtn.textContent = isSaved(v.id) ? 'Tersimpan' : '+ Putar Nanti';
    };
  }
  box.hidden = false;
}

function updateSidebarBadges() {
  const subBadge = document.getElementById('subCountBadge');
  const savedBadge = document.getElementById('savedCountBadge');
  if (subBadge) {
    subBadge.textContent = String(state.subscriptions.length);
    subBadge.hidden = state.subscriptions.length === 0;
  }
  if (savedBadge) {
    savedBadge.textContent = String(state.saved.length);
    savedBadge.hidden = state.saved.length === 0;
  }

  const list = document.getElementById('sidebarChannelList');
  if (!list) return;
  list.replaceChildren();

  if (state.subscriptions.length === 0) {
    const p = document.createElement('p');
    p.className = 'sidebar-empty-note';
    p.textContent = 'Belum ada langganan tersimpan.';
    list.appendChild(p);
    return;
  }

  state.subscriptions.forEach((ch) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sidebar-channel-btn';
    btn.textContent = ch.name;
    btn.title = ch.name;
    btn.addEventListener('click', () => {
      openChannelView(ch.id, ch.name);
    });
    list.appendChild(btn);
  });
}

/* --- Home Trending Feed --- */
async function loadTrendingFeed(tab = state.activeTab, forceRefresh = false) {
  state.activeTab = tab;
  document.querySelectorAll('#trendingTabs .segment-tab').forEach((t) => {
    const active = t.dataset.tab === tab;
    t.classList.toggle('is-active', active);
    t.setAttribute('aria-selected', String(active));
  });

  const pager = state.feedPaging.home;
  pager.reqSeq += 1;
  const seq = pager.reqSeq;
  pager.tab = tab;
  pager.items = [];
  pager.nextOffset = 0;
  pager.hasMore = false;
  pager.loading = true;

  const grid = document.getElementById('homeGrid');
  grid.replaceChildren();
  renderHomeSpotlight([]);
  updateFeedMoreBar('homeMoreBar', 'homeMoreStatus', 'homeMoreBtn', { hasMore: false, loading: false, loadedCount: 0 });
  showBoxState('homeGridState', 'Memuat video beranda...', `Mengambil feed kategori "${tab}" tanpa iklan.`);

  try {
    const res = await fetch(`/api/trending?tab=${encodeURIComponent(tab)}&offset=0&limit=30&refresh=${forceRefresh ? '1' : '0'}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (seq !== pager.reqSeq) return;

    const results = Array.isArray(data.results) ? data.results : [];
    pager.items = results;
    pager.nextOffset = Number(data.nextOffset ?? results.length);
    pager.hasMore = Boolean(data.hasMore);
    pager.loading = false;

    renderHomeSpotlight(pager.items);
    renderVideoGrid(
      'homeGrid',
      'homeGridState',
      pager.items,
      'Feed kategori ini sedang kosong',
      'Coba pilih kategori lain atau tekan Muat Ulang untuk mengambil daftar terbaru.',
      'Muat Ulang Feed',
      () => loadTrendingFeed(tab, true)
    );
    updateFeedMoreBar('homeMoreBar', 'homeMoreStatus', 'homeMoreBtn', {
      hasMore: pager.hasMore,
      loading: false,
      loadedCount: pager.items.length,
      idleText: `${pager.items.length} video dimuat. Gulir ke bawah untuk memuat video berikutnya.`,
    });
    setStatus('');
  } catch (err) {
    pager.loading = false;
    showBoxState(
      'homeGridState',
      'Gagal memuat beranda video',
      `${err.message}. Pastikan koneksi internet aktif lalu muat ulang.`,
      'Coba Lagi',
      () => loadTrendingFeed(tab, true)
    );
  }
}

async function loadMoreTrending() {
  const pager = state.feedPaging.home;
  if (!pager || pager.loading || !pager.hasMore || pager.tab !== state.activeTab) return;
  const seq = pager.reqSeq;
  pager.loading = true;
  updateFeedMoreBar('homeMoreBar', 'homeMoreStatus', 'homeMoreBtn', {
    hasMore: true,
    loading: true,
    loadedCount: pager.items.length,
    loadingText: 'Memuat video beranda berikutnya...',
  });

  try {
    const res = await fetch(`/api/trending?tab=${encodeURIComponent(pager.tab)}&offset=${pager.nextOffset}&limit=30&refresh=0`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (seq !== pager.reqSeq || pager.tab !== state.activeTab) return;

    const seen = new Set(pager.items.map((v) => v.id));
    const fresh = (Array.isArray(data.results) ? data.results : []).filter((v) => v && v.id && !seen.has(v.id));
    pager.items.push(...fresh);
    pager.nextOffset = Number(data.nextOffset ?? pager.nextOffset + fresh.length);
    pager.hasMore = Boolean(data.hasMore && (fresh.length > 0 || pager.nextOffset > pager.items.length));
    pager.loading = false;

    if (fresh.length > 0) {
      appendVideoGridItems('homeGrid', fresh, pager.items);
    }
    updateFeedMoreBar('homeMoreBar', 'homeMoreStatus', 'homeMoreBtn', {
      hasMore: pager.hasMore,
      loading: false,
      loadedCount: pager.items.length,
      idleText: `${pager.items.length} video dimuat. Gulir ke bawah untuk memuat video berikutnya.`,
    });
  } catch {
    pager.loading = false;
    updateFeedMoreBar('homeMoreBar', 'homeMoreStatus', 'homeMoreBtn', {
      hasMore: pager.hasMore,
      loading: false,
      loadedCount: pager.items.length,
    });
  }
}

/* --- Subscriptions View & Notifications --- */
function sendSubsNotification(title, body) {
  if (state.prefs.subsNotify === false) return;
  try {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/onyxtube.svg' });
      } else if (Notification.permission === 'default') {
        Notification.requestPermission().then((perm) => {
          if (perm === 'granted') new Notification(title, { body, icon: '/onyxtube.svg' });
        }).catch(() => {});
      }
    }
  } catch {
    // Ignore Web Notification errors
  }
  fetch(`/api/notify?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`).catch(() => {});
}

function renderSubsNewBanner() {
  const banner = document.getElementById('subsNewBanner');
  if (!banner) return;
  banner.replaceChildren();
  if (!state.unseenSubVideos || state.unseenSubVideos.length === 0) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  const latest = state.unseenSubVideos[0];
  const msg = document.createElement('span');
  const count = state.unseenSubVideos.length;
  msg.textContent = count === 1
    ? `Rilisan baru dari ${latest.author || 'Channel'}: "${latest.title}"`
    : `${count} video baru dari channel langganan (terbaru: "${latest.title}" oleh ${latest.author || 'Channel'})`;

  const actions = document.createElement('div');
  actions.className = 'subs-new-banner-actions';
  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'btn-primary btn-compact';
  playBtn.textContent = 'Tonton Sekarang';
  playBtn.onclick = () => {
    const queue = [...state.unseenSubVideos];
    state.unseenSubVideos = [];
    renderSubsNewBanner();
    openWatchVideo(latest, { queue });
  };

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'btn-ghost btn-compact';
  dismissBtn.textContent = 'Tandai Dibaca';
  dismissBtn.onclick = () => {
    state.unseenSubVideos = [];
    renderSubsNewBanner();
  };

  actions.append(playBtn, dismissBtn);
  banner.append(msg, actions);
}

async function checkSubscriptionUpdates({ manual = false } = {}) {
  if (state.subscriptions.length === 0) {
    if (manual) setStatus('Belum ada channel langganan untuk diperiksa.');
    return [];
  }
  try {
    const ids = state.subscriptions.map((c) => c.id).join(',');
    const res = await fetch(`/api/subscriptions?channels=${encodeURIComponent(ids)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal memeriksa RSS');
    const items = Array.isArray(data.results) ? data.results : [];
    const seenSet = new Set(state.seenSubIds || []);
    const isFirstBaseline = seenSet.size === 0 && !manual;
    const fresh = items.filter((v) => v && v.id && !seenSet.has(v.id));

    items.forEach((v) => {
      if (v && v.id) seenSet.add(v.id);
    });
    state.seenSubIds = Array.from(seenSet).slice(-400);
    saveStore();

    if (fresh.length > 0 && (!isFirstBaseline || manual)) {
      state.unseenSubVideos = fresh.slice(0, 12);
      renderSubsNewBanner();
      const top = fresh[0];
      const title = fresh.length === 1
        ? `Video Baru: ${top.author || 'Langganan'}`
        : `${fresh.length} Video Baru dari Langganan`;
      const body = top.title || 'Rilisan terbaru tersedia di OnyxTube';
      sendSubsNotification(title, body);
      setStatus(`${title} - ${body}`);
    } else if (manual) {
      if (items.length > 0) {
        const top = items[0];
        state.unseenSubVideos = [top];
        renderSubsNewBanner();
        sendSubsNotification(`Rilisan Terbaru: ${top.author || 'Langganan'}`, top.title || 'Video terbaru');
        setStatus(`Rilisan terbaru dari ${top.author || 'channel'}: ${top.title}`);
      } else {
        setStatus('Tidak ada unggahan baru ditemukan.');
      }
    }
    return items;
  } catch (err) {
    if (manual) setStatus(`Gagal memeriksa rilisan baru: ${err.message}`);
    return [];
  }
}

async function loadSubscriptionsFeed() {
  const pillsBox = document.getElementById('subsChannelPills');
  pillsBox.replaceChildren();

  state.subscriptions.forEach((ch) => {
    const chip = document.createElement('span');
    chip.className = 'channel-chip';
    const lbl = document.createElement('span');
    lbl.textContent = ch.name;
    const rem = document.createElement('button');
    rem.type = 'button';
    rem.className = 'chip-remove';
    rem.textContent = '×';
    rem.ariaLabel = `Hapus ${ch.name}`;
    rem.onclick = () => toggleSubscribe(ch.id, ch.name);
    chip.append(lbl, rem);
    pillsBox.appendChild(chip);
  });

  if (state.subscriptions.length === 0) {
    document.getElementById('subsGrid').replaceChildren();
    state.unseenSubVideos = [];
    renderSubsNewBanner();
    showBoxState(
      'subsGridState',
      'Belum ada channel langganan',
      'Simpan channel favorit dari kartu Beranda, hasil pencarian, atau saat menonton video untuk memantau rilisan terbaru secara privat.',
      'Buka Beranda',
      () => switchView('home')
    );
    return;
  }

  showBoxState('subsGridState', 'Mengambil rilisan channel...', `Menghubungi RSS ${state.subscriptions.length} channel langganan.`);
  try {
    const ids = state.subscriptions.map((c) => c.id).join(',');
    const res = await fetch(`/api/subscriptions?channels=${encodeURIComponent(ids)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal mengambil RSS');
    const results = data.results || [];
    const seenSet = new Set(state.seenSubIds || []);
    const hadBaseline = seenSet.size > 0;
    const fresh = results.filter((v) => v && v.id && !seenSet.has(v.id));
    results.forEach((v) => {
      if (v && v.id) seenSet.add(v.id);
    });
    state.seenSubIds = Array.from(seenSet).slice(-400);
    saveStore();
    if (hadBaseline && fresh.length > 0) {
      state.unseenSubVideos = fresh.slice(0, 12);
    }
    renderSubsNewBanner();
    renderVideoGrid(
      'subsGrid',
      'subsGridState',
      results,
      'Belum ada unggahan terbaru ditemukan',
      'Periksa koneksi internet Anda atau coba perbarui feed sebentar lagi.',
      'Perbarui Feed',
      () => loadSubscriptionsFeed()
    );
  } catch (err) {
    showBoxState('subsGridState', 'Gagal memuat feed langganan', err.message, 'Coba Lagi', () => loadSubscriptionsFeed());
  }
}

function renderSavedView() {
  const isLikedTab = state.playlistTab === 'liked';
  document.querySelectorAll('#playlistTabs .segment-tab').forEach((btn) => {
    const active = btn.dataset.ptab === state.playlistTab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  const clearBtn = document.getElementById('clearSavedBtn');
  if (clearBtn) {
    clearBtn.textContent = isLikedTab ? 'Kosongkan Video Disukai' : 'Kosongkan Daftar';
  }
  if (isLikedTab) {
    renderVideoGrid(
      'savedGrid',
      'savedGridState',
      state.liked,
      'Belum ada video yang disukai',
      'Klik tombol Suka pada video yang sedang ditonton untuk mengumpulkannya di sini.',
      'Jelajahi Beranda',
      () => switchView('home')
    );
    return;
  }
  renderVideoGrid(
    'savedGrid',
    'savedGridState',
    state.saved,
    'Daftar Putar Nanti masih kosong',
    'Klik tombol "+ Putar Nanti" pada video manapun untuk menyimpannya secara lokal.',
    'Jelajahi Beranda',
    () => switchView('home')
  );
}

function renderHistoryView() {
  renderVideoGrid(
    'historyGrid',
    'historyGridState',
    state.history,
    'Belum ada riwayat tontonan',
    'Video yang Anda putar akan tercatat di sini hanya pada perangkat Anda.',
    'Jelajahi Beranda',
    () => switchView('home')
  );
}

function syncChannelHeaderSubscribe() {
  const btn = document.getElementById('channelSubscribeBtn');
  if (!btn || !state.activeChannelId) return;
  const sub = isSubscribed(state.activeChannelId);
  btn.textContent = sub ? 'Berlangganan ✓' : 'Berlangganan';
  btn.className = sub ? 'btn-ghost btn-compact' : 'btn-primary btn-compact';
}

async function openChannelView(channelId, fallbackName = 'Channel') {
  if (!channelId) return;
  state.activeChannelId = channelId;
  switchView('channel');

  const pager = state.feedPaging.channel;
  pager.reqSeq += 1;
  const seq = pager.reqSeq;
  pager.channelId = channelId;
  pager.items = [];
  pager.nextOffset = 0;
  pager.total = 0;
  pager.hasMore = false;
  pager.loading = true;

  const titleEl = document.getElementById('channelTitle');
  const subEl = document.getElementById('channelSubCount');
  const descEl = document.getElementById('channelDescription');
  const avatarEl = document.getElementById('channelAvatar');
  const subBtn = document.getElementById('channelSubscribeBtn');

  if (titleEl) titleEl.textContent = fallbackName || 'Memuat Channel...';
  if (subEl) subEl.textContent = 'Mengambil info channel...';
  if (descEl) descEl.textContent = '';
  if (avatarEl) {
    avatarEl.hidden = true;
    avatarEl.removeAttribute('src');
  }
  syncChannelHeaderSubscribe();
  if (subBtn) {
    subBtn.onclick = () => toggleSubscribe(channelId, titleEl ? titleEl.textContent : fallbackName);
  }

  document.getElementById('channelGrid').replaceChildren();
  updateFeedMoreBar('channelMoreBar', 'channelMoreStatus', 'channelMoreBtn', { hasMore: false, loading: false, loadedCount: 0 });
  showBoxState('channelGridState', 'Memuat unggahan channel...', `Mengambil video terbaru dari "${fallbackName}".`);

  try {
    const res = await fetch(`/api/channel?id=${encodeURIComponent(channelId)}&offset=0&limit=30`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (seq !== pager.reqSeq || state.activeChannelId !== channelId) return;

    const videos = Array.isArray(data.videos) ? data.videos : [];
    pager.items = videos;
    pager.total = Number(data.total || videos.length);
    pager.nextOffset = Number(data.nextOffset ?? videos.length);
    pager.hasMore = Boolean(data.hasMore);
    pager.loading = false;

    if (titleEl) titleEl.textContent = data.title || fallbackName;
    if (subEl) subEl.textContent = data.subscriberText || `${pager.total} video ditemukan`;
    if (descEl) descEl.textContent = data.description || '';
    if (avatarEl && data.avatar) {
      avatarEl.src = data.avatar;
      avatarEl.alt = data.title || '';
      avatarEl.hidden = false;
    }
    if (subBtn) {
      subBtn.onclick = () => toggleSubscribe(channelId, data.title || fallbackName);
      syncChannelHeaderSubscribe();
    }

    renderVideoGrid(
      'channelGrid',
      'channelGridState',
      videos,
      'Channel belum memiliki unggahan publik',
      'Coba periksa kembali atau jelajahi beranda.',
      'Kembali ke Beranda',
      () => switchView('home')
    );

    updateFeedMoreBar('channelMoreBar', 'channelMoreStatus', 'channelMoreBtn', {
      hasMore: pager.hasMore,
      loading: false,
      loadedCount: pager.items.length,
      idleText: `Menampilkan ${pager.items.length} dari ${pager.total || pager.items.length} video channel.`,
    });
  } catch (err) {
    pager.loading = false;
    showBoxState('channelGridState', 'Gagal memuat channel', err.message, 'Coba Lagi', () => openChannelView(channelId, fallbackName));
  }
}

async function loadMoreChannelVideos() {
  const pager = state.feedPaging.channel;
  if (!pager || pager.loading || !pager.hasMore || pager.channelId !== state.activeChannelId) return;
  const seq = pager.reqSeq;
  pager.loading = true;
  updateFeedMoreBar('channelMoreBar', 'channelMoreStatus', 'channelMoreBtn', {
    hasMore: true,
    loading: true,
    loadedCount: pager.items.length,
    loadingText: 'Memuat unggahan channel berikutnya...',
  });

  try {
    const res = await fetch(`/api/channel?id=${encodeURIComponent(pager.channelId)}&offset=${pager.nextOffset}&limit=30`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (seq !== pager.reqSeq || state.activeChannelId !== pager.channelId) return;

    const seen = new Set(pager.items.map((v) => v.id));
    const fresh = (Array.isArray(data.videos) ? data.videos : []).filter((v) => v && v.id && !seen.has(v.id));
    pager.items.push(...fresh);
    pager.total = Number(data.total || pager.items.length);
    pager.nextOffset = Number(data.nextOffset ?? pager.items.length);
    pager.hasMore = Boolean(data.hasMore && fresh.length > 0);
    pager.loading = false;

    if (fresh.length > 0) {
      appendVideoGridItems('channelGrid', fresh, pager.items);
    }
    updateFeedMoreBar('channelMoreBar', 'channelMoreStatus', 'channelMoreBtn', {
      hasMore: pager.hasMore,
      loading: false,
      loadedCount: pager.items.length,
      idleText: `Menampilkan ${pager.items.length} dari ${pager.total || pager.items.length} video channel.`,
    });
  } catch {
    pager.loading = false;
    updateFeedMoreBar('channelMoreBar', 'channelMoreStatus', 'channelMoreBtn', {
      hasMore: pager.hasMore,
      loading: false,
      loadedCount: pager.items.length,
    });
  }
}

/* --- Search & URL Handling --- */
function extractVideoIdFromInput(raw) {
  const input = (raw || '').trim();
  if (!input) return '';
  if (YOUTUBE_ID_PATTERN.test(input)) return input;
  try {
    const url = new URL(input.startsWith('http') ? input : `https://${input}`);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const cand = url.pathname.replace('/', '').split('/')[0];
      return YOUTUBE_ID_PATTERN.test(cand) ? cand : '';
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = url.searchParams.get('v');
      if (v && YOUTUBE_ID_PATTERN.test(v)) return v;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['shorts', 'embed', 'live'].includes(parts[0])) {
        return YOUTUBE_ID_PATTERN.test(parts[1]) ? parts[1] : '';
      }
    }
  } catch {
    return '';
  }
  return '';
}

function parseDurationSeconds(durStr) {
  if (!durStr) return 0;
  const clean = String(durStr).trim();
  if (!/^\d+(?::\d+){1,2}$/.test(clean)) return 0;
  const parts = clean.split(':').map((n) => Number(n));
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function filterSearchItems(items, mode) {
  return (items || []).filter((v) => {
    if (mode === 'all') return true;
    const sec = parseDurationSeconds(v.duration);
    if (sec <= 0) return false;
    if (mode === 'short') return sec < 240;
    if (mode === 'medium') return sec >= 240 && sec <= 1200;
    if (mode === 'long') return sec > 1200;
    return true;
  });
}

function renderSearchFilteredResults() {
  const mode = state.searchDurationFilter || 'all';
  document.querySelectorAll('#searchFilterBar .segment-tab').forEach((btn) => {
    const active = btn.dataset.duration === mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  const filtered = filterSearchItems(state.rawSearchResults || [], mode);

  renderVideoGrid(
    'searchGrid',
    'searchGridState',
    filtered,
    `Tidak ditemukan video pada filter durasi ini untuk "${state.lastSearchQuery}"`,
    'Pilih tab Semua Durasi atau gunakan kata kunci yang lebih umum.',
    'Tampilkan Semua Durasi',
    () => {
      state.searchDurationFilter = 'all';
      renderSearchFilteredResults();
    }
  );

  const pager = state.feedPaging?.search;
  if (pager && pager.query === state.lastSearchQuery) {
    updateFeedMoreBar('searchMoreBar', 'searchMoreStatus', 'searchMoreBtn', {
      hasMore: pager.hasMore,
      loading: pager.loading,
      loadedCount: (state.rawSearchResults || []).length,
      idleText: `Menampilkan ${filtered.length} hasil (${(state.rawSearchResults || []).length} total dimuat). Gulir untuk hasil berikutnya.`,
    });
  }
}

function hideSearchSuggestions() {
  const box = document.getElementById('searchSuggestBox');
  const input = document.getElementById('searchInput');
  if (box) box.hidden = true;
  if (input) input.setAttribute('aria-expanded', 'false');
}

async function runSearch(rawQuery) {
  const query = (rawQuery || '').trim();
  hideSearchSuggestions();
  if (!query) {
    setStatus('Masukkan judul video, kata kunci, atau tautan YouTube terlebih dahulu.', true);
    return;
  }

  const directId = extractVideoIdFromInput(query);
  if (directId) {
    openWatchVideo({ id: directId, title: 'Memuat video...', author: '', thumbnail: `https://i.ytimg.com/vi/${directId}/hqdefault.jpg` });
    return;
  }

  switchView('search');
  state.lastSearchQuery = query;
  state.searchDurationFilter = 'all';
  const pager = state.feedPaging.search;
  pager.reqSeq += 1;
  const seq = pager.reqSeq;
  pager.query = query;
  pager.items = [];
  pager.nextToken = '';
  pager.hasMore = false;
  pager.loading = true;

  document.getElementById('searchTitle').textContent = `Hasil untuk "${query}"`;
  document.getElementById('searchGrid').replaceChildren();
  updateFeedMoreBar('searchMoreBar', 'searchMoreStatus', 'searchMoreBtn', { hasMore: false, loading: false, loadedCount: 0 });
  showBoxState('searchGridState', 'Mencari di YouTube...', `Mengambil hasil pencarian bersih bebas iklan untuk "${query}".`);

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (seq !== pager.reqSeq) return;

    state.rawSearchResults = data.results || [];
    pager.items = state.rawSearchResults;
    pager.nextToken = String(data.nextToken || '');
    pager.hasMore = Boolean(data.hasMore && pager.nextToken);
    pager.loading = false;

    renderSearchFilteredResults();
    setStatus('');
  } catch (err) {
    pager.loading = false;
    showBoxState('searchGridState', 'Pencarian gagal', err.message, 'Coba Lagi', () => runSearch(query));
  }
}

async function loadMoreSearchResults() {
  const pager = state.feedPaging.search;
  if (!pager || pager.loading || !pager.hasMore || !pager.nextToken || pager.query !== state.lastSearchQuery) return;
  const seq = pager.reqSeq;
  pager.loading = true;
  updateFeedMoreBar('searchMoreBar', 'searchMoreStatus', 'searchMoreBtn', {
    hasMore: true,
    loading: true,
    loadedCount: (state.rawSearchResults || []).length,
    loadingText: `Memuat hasil tambahan untuk "${pager.query}"...`,
  });

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(pager.query)}&token=${encodeURIComponent(pager.nextToken)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (seq !== pager.reqSeq) return;

    const seen = new Set((state.rawSearchResults || []).map((v) => v.id));
    const fresh = (Array.isArray(data.results) ? data.results : []).filter((v) => v && v.id && !seen.has(v.id));
    state.rawSearchResults.push(...fresh);
    pager.items = state.rawSearchResults;
    pager.nextToken = String(data.nextToken || '');
    pager.hasMore = Boolean(data.hasMore && pager.nextToken && fresh.length > 0);
    pager.loading = false;

    const filteredFresh = filterSearchItems(fresh, state.searchDurationFilter || 'all');
    if (filteredFresh.length > 0) {
      appendVideoGridItems('searchGrid', filteredFresh, state.rawSearchResults);
    }
    const totalFiltered = filterSearchItems(state.rawSearchResults, state.searchDurationFilter || 'all').length;
    updateFeedMoreBar('searchMoreBar', 'searchMoreStatus', 'searchMoreBtn', {
      hasMore: pager.hasMore,
      loading: false,
      loadedCount: state.rawSearchResults.length,
      idleText: `Menampilkan ${totalFiltered} hasil (${state.rawSearchResults.length} total dimuat). Gulir untuk hasil berikutnya.`,
    });
  } catch {
    pager.loading = false;
    updateFeedMoreBar('searchMoreBar', 'searchMoreStatus', 'searchMoreBtn', {
      hasMore: pager.hasMore,
      loading: false,
      loadedCount: (state.rawSearchResults || []).length,
    });
  }
}

/* --- Native HTML5 Zero-Logo Video Player Engine --- */
const videoEl = () => document.getElementById('videoPlayer');
const audioEl = () => document.getElementById('audioPlayer');

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function updatePlayPauseUI() {
  const v = videoEl();
  const iconPlay = document.getElementById('iconPlay');
  const iconPause = document.getElementById('iconPause');
  const miniPlay = document.getElementById('miniIconPlay');
  const miniPause = document.getElementById('miniIconPause');
  const shellEl = document.getElementById('playerFrameShell');
  const paused = !v || (v.paused && !state.resumeAfterSeek);
  // SVG elements have no `hidden` IDL property: toggle the attribute itself.
  iconPlay?.toggleAttribute('hidden', !paused);
  iconPause?.toggleAttribute('hidden', paused);
  miniPlay?.toggleAttribute('hidden', !paused);
  miniPause?.toggleAttribute('hidden', paused);
  if (shellEl) shellEl.classList.toggle('is-paused', paused);
  const btn = document.getElementById('playPauseBtn');
  if (btn) btn.setAttribute('aria-label', paused ? 'Putar video (Spasi)' : 'Jeda video (Spasi)');
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = !v?.src ? 'none' : paused ? 'paused' : 'playing';
    } catch {
      // Ignore unsupported mediaSession state
    }
  }
}

function updateMediaSessionMetadata() {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined' || !state.currentVideo) return;
  try {
    const cv = state.currentVideo;
    const thumb = cv.thumbnail || `https://i.ytimg.com/vi/${cv.id}/hqdefault.jpg`;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: cv.title || 'OnyxTube',
      artist: cv.author || 'YouTube',
      album: 'OnyxTube Desktop',
      artwork: [{ src: thumb, sizes: '480x360', type: 'image/jpeg' }],
    });
  } catch {
    // Ignore metadata assignment errors
  }
}

function updateMediaSessionPosition() {
  if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
  const v = videoEl();
  if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: v.duration,
      playbackRate: Number.isFinite(v.playbackRate) && v.playbackRate > 0 ? v.playbackRate : 1,
      position: Math.max(0, Math.min(v.duration, v.currentTime || 0)),
    });
  } catch {
    // Ignore position state errors
  }
}

function initMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const bindAction = (action, fn) => {
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch {
      // Some platforms do not support all actions
    }
  };
  bindAction('play', () => {
    const v = videoEl();
    if (v && v.paused) document.getElementById('playPauseBtn')?.click();
  });
  bindAction('pause', () => {
    const v = videoEl();
    if (v && !v.paused) document.getElementById('playPauseBtn')?.click();
  });
  bindAction('previoustrack', () => playPreviousVideo());
  bindAction('nexttrack', () => playNextVideo());
  bindAction('seekbackward', (details) => {
    const skip = details?.seekOffset || 10;
    state.playerActions?.requestSkip?.(-skip);
  });
  bindAction('seekforward', (details) => {
    const skip = details?.seekOffset || 10;
    state.playerActions?.requestSkip?.(skip);
  });
  bindAction('seekto', (details) => {
    if (details && Number.isFinite(details.seekTime)) {
      state.playerActions?.commitSeek?.(details.seekTime, formatTime(details.seekTime));
    }
  });
  bindAction('stop', () => {
    const v = videoEl();
    if (v && !v.paused) document.getElementById('playPauseBtn')?.click();
  });
}

function updateSleepTimerBadge() {
  const badge = document.getElementById('sleepTimerBadge');
  const sel = document.getElementById('sleepTimerSelect');
  if (sel && sel.value !== state.sleepTimerMode) {
    sel.value = state.sleepTimerMode;
  }
  if (!badge) return;
  if (!state.sleepTimerMode) {
    badge.hidden = true;
    badge.textContent = '';
    return;
  }
  if (state.sleepTimerMode === 'end') {
    badge.hidden = false;
    badge.textContent = 'Tidur: Akhir';
    return;
  }
  const remSec = Math.max(0, Math.ceil((state.sleepTimerDeadline - Date.now()) / 1000));
  badge.hidden = false;
  badge.textContent = `Tidur ${formatTime(remSec)}`;
}

function triggerSleepTimerStop(reasonText) {
  if (state.sleepTimerInterval) {
    clearInterval(state.sleepTimerInterval);
    state.sleepTimerInterval = 0;
  }
  state.sleepTimerMode = '';
  state.sleepTimerDeadline = 0;
  updateSleepTimerBadge();
  cancelAutoNextCountdown();
  const v = videoEl();
  const a = audioEl();
  if (v && !v.paused) v.pause();
  if (a && !a.paused) a.pause();
  updatePlayPauseUI();
  const msg = reasonText || 'Sleep Timer selesai: pemutaran dijeda otomatis.';
  state.playerActions?.showSeekOsd?.('Sleep Timer: Dijeda');
  setStatus(msg);
}

function setSleepTimer(mode) {
  if (state.sleepTimerInterval) {
    clearInterval(state.sleepTimerInterval);
    state.sleepTimerInterval = 0;
  }
  const clean = String(mode || '').trim();
  state.sleepTimerMode = clean;
  state.sleepTimerDeadline = 0;
  if (!clean) {
    updateSleepTimerBadge();
    setStatus('Sleep Timer dimatikan.');
    return;
  }
  if (clean === 'end') {
    updateSleepTimerBadge();
    state.playerActions?.showSeekOsd?.('Sleep Timer: Akhir Video');
    setStatus('Sleep Timer aktif: pemutaran berhenti setelah video ini selesai.');
    return;
  }
  const mins = Number(clean);
  if (Number.isFinite(mins) && mins > 0) {
    state.sleepTimerDeadline = Date.now() + Math.round(mins * 60 * 1000);
    updateSleepTimerBadge();
    state.playerActions?.showSeekOsd?.(`Sleep Timer: ${mins}m`);
    setStatus(`Sleep Timer diatur untuk ${mins} menit.`);
    state.sleepTimerInterval = setInterval(() => {
      if (Date.now() >= state.sleepTimerDeadline) {
        triggerSleepTimerStop('Sleep Timer selesai: pemutaran dijeda otomatis.');
      } else {
        updateSleepTimerBadge();
      }
    }, 500);
  }
}

async function refreshYtdlpStatus(runUpdate = false) {
  const pill = document.getElementById('ytdlpStatusText');
  const btn = document.getElementById('ytdlpUpdateBtn');
  if (runUpdate) {
    if (pill) pill.textContent = 'Memperbarui yt-dlp...';
    if (btn) btn.disabled = true;
  }
  try {
    const q = runUpdate ? '?action=update' : '';
    const res = await fetch(`/api/ytdlp${q}`);
    const data = await res.json();
    const ver = data.version || 'terpasang';
    const note = data.lastResult || 'Siap';
    if (pill) pill.textContent = `v${ver} (${note})`;
    if (runUpdate) setStatus(`Ekstraktor yt-dlp: v${ver} (${note})`);
  } catch (err) {
    if (pill) pill.textContent = `Gagal memeriksa (${err.message})`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

let waitingSyncTimer = 0;
let internalVideoResync = false;
let internalVideoResyncTimer = 0;

function clearInternalVideoResync() {
  if (internalVideoResyncTimer) {
    clearTimeout(internalVideoResyncTimer);
    internalVideoResyncTimer = 0;
  }
  internalVideoResync = false;
}

const PREFETCHED_IDS = new Set();
let hoverPrefetchTimer = 0;

function prefetchVideos(videoIds) {
  const fresh = (videoIds || [])
    .map((x) => String(x || '').trim())
    .filter((id) => /^[a-zA-Z0-9_-]{11}$/.test(id) && !PREFETCHED_IDS.has(id))
    .slice(0, 3);
  if (fresh.length === 0) return;
  fresh.forEach((id) => PREFETCHED_IDS.add(id));
  fetch(`/api/prefetch?id=${encodeURIComponent(fresh.join(','))}`).catch(() => {});
}

function scheduleHoverPrefetch(videoId) {
  clearTimeout(hoverPrefetchTimer);
  if (!videoId || PREFETCHED_IDS.has(videoId)) return;
  hoverPrefetchTimer = setTimeout(() => prefetchVideos([videoId]), 220);
}

function clearPendingSeekState() {
  if (state.seekCommitTimer) {
    clearTimeout(state.seekCommitTimer);
    state.seekCommitTimer = 0;
  }
  if (state.seekResumeTimer) {
    clearTimeout(state.seekResumeTimer);
    state.seekResumeTimer = 0;
  }
  clearInternalVideoResync();
  state.pendingSeekTarget = null;
  state.skipBurstDelta = 0;
  state.isScrubbing = false;
  state.resumeAfterSeek = false;
  state.waitVideoAdvance = false;
  state.waitAdvanceStartTime = 0;
}

function syncAudioAction(action) {
  const v = videoEl();
  const a = audioEl();
  if (!state.dualAudioActive || !a || !a.src) return;
  if (action !== 'waiting_pause' && waitingSyncTimer) {
    clearTimeout(waitingSyncTimer);
    waitingSyncTimer = 0;
  }
  const targetRate = (v && Number.isFinite(v.playbackRate) && v.playbackRate > 0) ? v.playbackRate : 1;
  if (action === 'waiting_pause') {
    clearTimeout(waitingSyncTimer);
    const waitPos = v ? (v.currentTime || 0) : 0;
    waitingSyncTimer = setTimeout(() => {
      waitingSyncTimer = 0;
      if (
        state.dualAudioActive &&
        v &&
        !v.paused &&
        !internalVideoResync &&
        (v.seeking || (v.readyState < 2 && Math.abs((v.currentTime || 0) - waitPos) < 0.05))
      ) {
        a.pause();
      }
    }, 1200);
  } else if (action === 'play') {
    if (!v || v.paused || v.seeking || v.readyState < 2 || a.readyState < 2 || state.pendingSeekTarget !== null || state.isScrubbing) {
      return;
    }
    if (state.waitVideoAdvance) {
      const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
      const hasFrame = Boolean(q && q.totalVideoFrames > 0);
      const hasMoved = Math.abs((v.currentTime || 0) - (state.waitAdvanceStartTime || 0)) > 0.04;
      if (!hasFrame && !hasMoved) return;
      state.waitVideoAdvance = false;
    }
    if (Math.abs((a.playbackRate || 1) - targetRate) > 0.005) {
      a.playbackRate = targetRate;
    }
    if (!a.paused || a.seeking) {
      return;
    }
    if (Math.abs((a.currentTime || 0) - (v.currentTime || 0)) > 1.2) {
      a.currentTime = v.currentTime || 0;
    }
    a.play().catch(() => {});
  } else if (action === 'pause') {
    a.pause();
  } else if (action === 'seek') {
    if (v.seeking) a.pause();
    if (Math.abs((a.currentTime || 0) - (v.currentTime || 0)) > 0.04) {
      a.currentTime = v.currentTime || 0;
    }
    if (Math.abs((a.playbackRate || 1) - targetRate) > 0.005) {
      a.playbackRate = targetRate;
    }
  } else if (action === 'rate') {
    if (Math.abs((a.playbackRate || 1) - targetRate) > 0.005) {
      a.playbackRate = targetRate;
    }
  }
}

function applyQualityStream(qualityObj, resumeTime = 0, autoPlay = true) {
  const v = videoEl();
  const a = audioEl();
  if (!v || !a || !qualityObj) return;

  clearPendingSeekState();
  const loadToken = (state.streamLoadToken || 0) + 1;
  state.streamLoadToken = loadToken;
  state.activeQualityItag = qualityObj.itag;
  state.dualAudioActive = Boolean(!qualityObj.muxed && qualityObj.audioUrl);
  state.waitAdvanceStartTime = resumeTime || 0;
  state.waitVideoAdvance = Boolean(state.dualAudioActive);

  v.pause();
  a.pause();
  v.preload = 'auto';
  a.preload = 'auto';
  if (!v.poster && state.currentVideo?.thumbnail) {
    v.poster = state.currentVideo.thumbnail;
  }

  const retryBtn = document.getElementById('playerRetryBtn');
  if (retryBtn) retryBtn.hidden = true;

  if (state.dualAudioActive) {
    v.muted = true;
    v.src = qualityObj.videoUrl;
    if (a.dataset.activeUrl !== qualityObj.audioUrl || !a.src) {
      a.dataset.activeUrl = qualityObj.audioUrl;
      a.src = qualityObj.audioUrl;
    }
    a.volume = Number(document.getElementById('volumeSlider').value || 1);
    a.muted = false;
  } else {
    v.muted = false;
    v.volume = Number(document.getElementById('volumeSlider').value || 1);
    if (a.src || a.dataset.activeUrl) {
      a.dataset.activeUrl = '';
      a.removeAttribute('src');
      a.load();
    }
    v.src = qualityObj.videoUrl;
  }

  const speed = Number(document.getElementById('speedSelect').value || 1);
  v.playbackRate = speed;
  a.playbackRate = speed;

  let metadataDone = false;
  let pendingSeek = false;
  let startedPlayback = false;
  let fallbackTimer = null;

  const finishStart = () => {
    if (startedPlayback || state.streamLoadToken !== loadToken) return;
    startedPlayback = true;
    cleanup();
    v.style.opacity = '1';
    const stageEl = document.getElementById('playerStage');
    if (stageEl) stageEl.style.backgroundImage = '';
    if (state.dualAudioActive && a.readyState >= 2 && Math.abs((a.currentTime || 0) - (v.currentTime || 0)) > 0.8) {
      a.currentTime = v.currentTime || 0;
    }
    if (autoPlay && v.paused) {
      v.play().catch(() => {});
    }
    document.getElementById('playerBusyOverlay').hidden = true;
    updatePlayPauseUI();
  };

  const maybeStartWhenBuffered = () => {
    if (!metadataDone || pendingSeek || startedPlayback || state.streamLoadToken !== loadToken) return;
    if (v.seeking) return;
    const videoReady = v.readyState >= 2;
    const audioReady = !state.dualAudioActive || a.readyState >= 2;
    if (videoReady && audioReady) {
      finishStart();
    }
  };

  const scheduleFallbackCheck = (delayMs, waitedMs = 0) => {
    if (startedPlayback || state.streamLoadToken !== loadToken) return;
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
    }
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      if (startedPlayback || state.streamLoadToken !== loadToken) return;
      const totalWaited = waitedMs + delayMs;
      const vCanPlay = metadataDone && !pendingSeek && !v.seeking && v.readyState >= 2;
      const aCanPlay = !state.dualAudioActive || a.readyState >= 2;
      if (vCanPlay && aCanPlay) {
        finishStart();
        return;
      }
      if (totalWaited >= 6000 && metadataDone && !pendingSeek) {
        finishStart();
        return;
      }
      scheduleFallbackCheck(75, totalWaited);
    }, delayMs);
  };

  const onSeeked = () => {
    if (state.streamLoadToken !== loadToken) return;
    pendingSeek = false;
    if (state.dualAudioActive && a.readyState >= 1 && Math.abs((a.currentTime || 0) - (v.currentTime || 0)) > 0.8) {
      a.currentTime = v.currentTime || 0;
    }
    maybeStartWhenBuffered();
  };

  const onMetadata = () => {
    if (state.streamLoadToken !== loadToken) return;
    metadataDone = true;
    if (resumeTime > 0 && Number.isFinite(v.duration)) {
      const clamped = Math.min(resumeTime, Math.max(0, v.duration - 0.5));
      if (Math.abs((v.currentTime || 0) - clamped) > 0.05) {
        pendingSeek = true;
        v.currentTime = clamped;
      }
      if (state.dualAudioActive && a.readyState >= 1 && Math.abs((a.currentTime || 0) - clamped) > 0.05) {
        a.currentTime = clamped;
      }
    }
    const td = document.getElementById('timeDisplay');
    if (td) td.textContent = `${formatTime(v.currentTime)} / ${formatTime(v.duration)}`;
    renderSponsorMarkers();
    if (!autoPlay) {
      finishStart();
      return;
    }
    maybeStartWhenBuffered();
    if (!startedPlayback && fallbackTimer === null) {
      scheduleFallbackCheck(resumeTime > 0 ? 120 : 60, 0);
    }
  };

  const onError = () => {
    if (state.streamLoadToken !== loadToken) return;
    cleanup();
    const overlay = document.getElementById('playerBusyOverlay');
    const msg = document.getElementById('playerBusyMsg');
    const retry = document.getElementById('playerRetryBtn');
    if (overlay && msg && retry && state.currentVideo) {
      overlay.hidden = false;
      msg.textContent = 'Stream media gagal dimuat atau kedaluwarsa. Muat ulang stream.';
      retry.hidden = false;
      retry.onclick = () => openWatchVideo(state.currentVideo);
    }
  };

  const cleanup = () => {
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    v.removeEventListener('loadedmetadata', onMetadata);
    v.removeEventListener('seeked', onSeeked);
    v.removeEventListener('loadeddata', maybeStartWhenBuffered);
    v.removeEventListener('canplay', maybeStartWhenBuffered);
    a.removeEventListener('loadeddata', maybeStartWhenBuffered);
    a.removeEventListener('canplay', maybeStartWhenBuffered);
    v.removeEventListener('error', onError);
  };
  v.addEventListener('loadedmetadata', onMetadata);
  v.addEventListener('seeked', onSeeked);
  v.addEventListener('loadeddata', maybeStartWhenBuffered);
  v.addEventListener('canplay', maybeStartWhenBuffered);
  a.addEventListener('loadeddata', maybeStartWhenBuffered);
  a.addEventListener('canplay', maybeStartWhenBuffered);
  v.addEventListener('error', onError);
}

function renderSponsorMarkers() {
  const box = document.getElementById('sponsorMarkers');
  const v = videoEl();
  if (!box) return;
  box.replaceChildren();
  const dur = v ? v.duration : 0;
  if (!Number.isFinite(dur) || dur <= 0 || state.sponsorSegments.length === 0) return;

  state.sponsorSegments.forEach((seg) => {
    const [start, end] = seg.segment || [0, 0];
    if (end <= start) return;
    const band = document.createElement('div');
    band.className = 'sponsor-marker-band';
    band.style.left = `${(start / dur) * 100}%`;
    band.style.width = `${Math.max(0.5, ((end - start) / dur) * 100)}%`;
    band.title = `SponsorBlock: ${seg.category || 'sponsor'}`;
    box.appendChild(band);
  });
}

function setActiveCaption(lang) {
  const v = videoEl();
  const ccBtn = document.getElementById('ccBtn');
  const ccSel = document.getElementById('ccSelect');
  state.activeCaptionLang = lang || '';

  if (v) {
    v.querySelectorAll('track').forEach((el) => el.remove());
    if (state.activeCaptionLang) {
      const cap = state.currentCaptions.find((c) => c.lang === state.activeCaptionLang);
      if (cap) {
        const tr = document.createElement('track');
        tr.kind = 'subtitles';
        tr.srclang = cap.lang;
        tr.label = cap.label || cap.lang;
        tr.src = cap.url;
        tr.default = true;
        v.appendChild(tr);
        if (tr.track) tr.track.mode = 'showing';
      }
    }
  }

  const active = Boolean(state.activeCaptionLang);
  if (ccBtn) {
    ccBtn.classList.toggle('is-toggled', active);
    ccBtn.setAttribute('aria-pressed', String(active));
  }
  if (ccSel) ccSel.value = state.activeCaptionLang;
}

function setupCaptions(videoId, captions) {
  const v = videoEl();
  const ccBtn = document.getElementById('ccBtn');
  const ccSel = document.getElementById('ccSelect');
  if (!v) return;
  v.querySelectorAll('track').forEach((el) => el.remove());
  state.currentCaptions = (Array.isArray(captions) ? captions : []).map((cap) => ({
    ...cap,
    url: cap.url || `/api/subtitle?id=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(cap.lang)}`,
  }));
  state.activeCaptionLang = '';

  if (ccSel) {
    ccSel.replaceChildren();
    const offOpt = document.createElement('option');
    offOpt.value = '';
    offOpt.textContent = 'Teks Mati';
    ccSel.appendChild(offOpt);
  }

  if (state.currentCaptions.length === 0) {
    if (ccBtn) {
      ccBtn.disabled = true;
      ccBtn.classList.remove('is-toggled');
      ccBtn.setAttribute('aria-pressed', 'false');
    }
    if (ccSel) ccSel.hidden = true;
    return;
  }

  state.currentCaptions.forEach((cap) => {
    if (ccSel) {
      const opt = document.createElement('option');
      opt.value = cap.lang;
      opt.textContent = cap.label || cap.lang;
      ccSel.appendChild(opt);
    }
  });

  if (ccBtn) ccBtn.disabled = false;
  if (ccSel) ccSel.hidden = false;
  setActiveCaption('');
}

function updateActiveChapter(sec) {
  if (!state.currentChapters || state.currentChapters.length === 0) return;
  const active = state.currentChapters.find((ch) => sec >= ch.startTime && sec < ch.endTime) || state.currentChapters[state.currentChapters.length - 1];
  const badge = document.getElementById('activeChapterBadge');
  if (badge && active) {
    const label = `Bab: ${active.title}`;
    if (badge.textContent !== label) badge.textContent = label;
    if (badge.hidden) badge.hidden = false;
  }
  const list = document.getElementById('chaptersList');
  if (list) {
    list.querySelectorAll('.chapter-chip').forEach((chip) => {
      const start = Number(chip.dataset.start || 0);
      chip.classList.toggle('is-active', Boolean(active && Math.abs(start - active.startTime) < 0.01));
    });
  }
}

function renderChapters(chapters, durationSec) {
  const secBox = document.getElementById('chaptersSection');
  const listEl = document.getElementById('chaptersList');
  const countEl = document.getElementById('chaptersCount');
  const markersEl = document.getElementById('chapterMarkers');
  const badge = document.getElementById('activeChapterBadge');

  state.currentChapters = Array.isArray(chapters) ? chapters : [];
  if (listEl) listEl.replaceChildren();
  if (markersEl) markersEl.replaceChildren();
  if (badge) badge.hidden = true;

  if (!secBox || !listEl || state.currentChapters.length === 0) {
    if (secBox) secBox.hidden = true;
    return;
  }

  secBox.hidden = false;
  if (countEl) countEl.textContent = `${state.currentChapters.length} bab`;

  const dur = durationSec > 0 ? durationSec : state.currentChapters[state.currentChapters.length - 1].endTime;
  const frag = document.createDocumentFragment();
  state.currentChapters.forEach((ch, idx) => {
    if (markersEl && dur > 0 && idx > 0) {
      const tick = document.createElement('div');
      tick.className = 'chapter-marker-tick';
      tick.style.left = `${Math.min(99.5, (ch.startTime / dur) * 100)}%`;
      tick.title = ch.title;
      markersEl.appendChild(tick);
    }

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chapter-chip';
    chip.dataset.start = String(ch.startTime);

    const ts = document.createElement('span');
    ts.className = 'chapter-time';
    ts.textContent = formatTime(ch.startTime);

    const lbl = document.createElement('span');
    lbl.textContent = ch.title;

    chip.append(ts, lbl);
    chip.addEventListener('click', () => {
      const v = videoEl();
      const a = audioEl();
      if (!v || !v.src) return;
      v.currentTime = ch.startTime;
      if (state.dualAudioActive && a && a.src) a.currentTime = ch.startTime;
      updateActiveChapter(ch.startTime);
    });
    frag.appendChild(chip);
  });
  listEl.appendChild(frag);
  updateActiveChapter(0);
}

function parseTimestampToSec(label) {
  const parts = String(label || '').trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function renderTextWithTimestamps(container, text) {
  if (!container) return;
  container.replaceChildren();
  const str = String(text || '');
  const tsRe = /\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g;
  let lastIdx = 0;
  let match;
  while ((match = tsRe.exec(str)) !== null) {
    if (match.index > lastIdx) {
      container.appendChild(document.createTextNode(str.slice(lastIdx, match.index)));
    }
    const label = match[1];
    const sec = parseTimestampToSec(label);
    if (sec !== null) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'desc-ts-link';
      btn.textContent = label;
      btn.title = `Lompat ke ${label}`;
      btn.addEventListener('click', () => {
        if (state.playerActions && typeof state.playerActions.seekAbsolute === 'function') {
          state.playerActions.seekAbsolute(sec, label);
        }
      });
      container.appendChild(btn);
    } else {
      container.appendChild(document.createTextNode(label));
    }
    lastIdx = match.index + label.length;
  }
  if (lastIdx < str.length) {
    container.appendChild(document.createTextNode(str.slice(lastIdx)));
  }
}

function renderCommentItems(comments, append = false) {
  const listEl = document.getElementById('commentsList');
  if (!listEl) return;
  if (!append) listEl.replaceChildren();
  const frag = document.createDocumentFragment();
  comments.forEach((c) => {
    const card = document.createElement('article');
    card.className = 'comment-card';
    card.dataset.commentId = c.id || '';

    if (c.avatar) {
      const av = document.createElement('img');
      av.className = 'comment-avatar';
      av.src = c.avatar;
      av.alt = c.author || '';
      av.loading = 'lazy';
      card.appendChild(av);
    }

    const body = document.createElement('div');
    body.className = 'comment-body';

    const header = document.createElement('div');
    header.className = 'comment-header';

    const author = document.createElement('span');
    author.className = 'comment-author';
    author.textContent = c.author || 'Pengguna';

    const timeEl = document.createElement('span');
    timeEl.className = 'comment-time';
    timeEl.textContent = c.published || '';

    header.append(author, timeEl);

    const textEl = document.createElement('p');
    textEl.className = 'comment-text';
    renderTextWithTimestamps(textEl, c.text || '');

    body.append(header, textEl);
    if (c.likes || c.replies) {
      const footer = document.createElement('div');
      footer.className = 'comment-footer';
      if (c.likes) {
        const lk = document.createElement('span');
        lk.textContent = `${c.likes} suka`;
        footer.appendChild(lk);
      }
      if (c.replies) {
        const rp = document.createElement('span');
        rp.textContent = `${c.replies} balasan`;
        footer.appendChild(rp);
      }
      body.appendChild(footer);
    }

    card.appendChild(body);
    frag.appendChild(card);
  });
  listEl.appendChild(frag);
}

async function loadVideoComments(videoId) {
  const listEl = document.getElementById('commentsList');
  const stateEl = document.getElementById('commentsState');
  const countEl = document.getElementById('commentsCount');
  if (!listEl || !stateEl) return;

  if (state.commentsAbort) state.commentsAbort.abort();
  state.commentsAbort = new AbortController();

  const pager = state.feedPaging.comments;
  pager.reqSeq += 1;
  const seq = pager.reqSeq;
  pager.videoId = videoId;
  pager.items = [];
  pager.nextToken = '';
  pager.hasMore = false;
  pager.loading = true;

  listEl.replaceChildren();
  if (countEl) countEl.textContent = '';
  updateFeedMoreBar('commentsMoreBar', 'commentsMoreStatus', 'commentsMoreBtn', { hasMore: false, loading: false, loadedCount: 0 });
  stateEl.textContent = 'Memuat komentar teratas...';
  stateEl.hidden = false;

  try {
    const res = await fetch(`/api/comments?id=${encodeURIComponent(videoId)}`, {
      signal: state.commentsAbort.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (seq !== pager.reqSeq || !state.currentVideo || state.currentVideo.id !== videoId) return;

    const comments = Array.isArray(data.comments) ? data.comments : [];
    pager.items = comments;
    pager.nextToken = String(data.nextToken || '');
    pager.hasMore = Boolean(data.hasMore && pager.nextToken);
    pager.loading = false;

    if (comments.length === 0) {
      stateEl.textContent = 'Tidak ada komentar publik atau komentar dinonaktifkan pada video ini.';
      stateEl.hidden = false;
      updateFeedMoreBar('commentsMoreBar', 'commentsMoreStatus', 'commentsMoreBtn', { hasMore: false, loading: false, loadedCount: 0 });
      return;
    }

    stateEl.hidden = true;
    if (countEl) countEl.textContent = `${comments.length} komentar dimuat`;
    renderCommentItems(comments, false);
    updateFeedMoreBar('commentsMoreBar', 'commentsMoreStatus', 'commentsMoreBtn', {
      hasMore: pager.hasMore,
      loading: false,
      loadedCount: pager.items.length,
      idleText: `Menampilkan ${pager.items.length} komentar. Gulir ke bawah untuk komentar berikutnya.`,
    });
  } catch (err) {
    pager.loading = false;
    if (err.name === 'AbortError') return;
    if (!state.currentVideo || state.currentVideo.id !== videoId) return;
    stateEl.textContent = 'Komentar tidak tersedia saat ini.';
    stateEl.hidden = false;
    updateFeedMoreBar('commentsMoreBar', 'commentsMoreStatus', 'commentsMoreBtn', { hasMore: false, loading: false, loadedCount: 0 });
  }
}

async function loadMoreComments() {
  const pager = state.feedPaging.comments;
  if (!pager || pager.loading || !pager.hasMore || !pager.nextToken || !state.currentVideo) return;
  const videoId = pager.videoId;
  if (state.currentVideo.id !== videoId) return;

  const seq = pager.reqSeq;
  pager.loading = true;
  updateFeedMoreBar('commentsMoreBar', 'commentsMoreStatus', 'commentsMoreBtn', {
    hasMore: true,
    loading: true,
    loadedCount: pager.items.length,
    loadingText: 'Memuat komentar berikutnya...',
  });

  try {
    const res = await fetch(`/api/comments?id=${encodeURIComponent(videoId)}&token=${encodeURIComponent(pager.nextToken)}`, {
      signal: state.commentsAbort ? state.commentsAbort.signal : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (seq !== pager.reqSeq || !state.currentVideo || state.currentVideo.id !== videoId) return;

    const seen = new Set(pager.items.map((c) => c.id));
    const fresh = (Array.isArray(data.comments) ? data.comments : []).filter((c) => c && c.id && !seen.has(c.id));
    pager.items.push(...fresh);
    pager.nextToken = String(data.nextToken || '');
    pager.hasMore = Boolean(data.hasMore && pager.nextToken && fresh.length > 0);
    pager.loading = false;

    if (fresh.length > 0) {
      renderCommentItems(fresh, true);
    }
    const countEl = document.getElementById('commentsCount');
    if (countEl) countEl.textContent = `${pager.items.length} komentar dimuat`;
    updateFeedMoreBar('commentsMoreBar', 'commentsMoreStatus', 'commentsMoreBtn', {
      hasMore: pager.hasMore,
      loading: false,
      loadedCount: pager.items.length,
      idleText: `Menampilkan ${pager.items.length} komentar. Gulir ke bawah untuk komentar berikutnya.`,
    });
  } catch (err) {
    pager.loading = false;
    if (err.name === 'AbortError') return;
    updateFeedMoreBar('commentsMoreBar', 'commentsMoreStatus', 'commentsMoreBtn', {
      hasMore: pager.hasMore,
      loading: false,
      loadedCount: pager.items.length,
    });
  }
}

function updateWatchActionButtons() {
  const vid = state.currentVideo;
  const subBtn = document.getElementById('subscribeBtn');
  const saveBtn = document.getElementById('saveVideoBtn');
  const likeBtn = document.getElementById('likeBtn');
  const likeTxt = document.getElementById('likeCountText');
  const dislikeBtn = document.getElementById('dislikeBtn');
  const subCountEl = document.getElementById('watchSubCount');
  const loopBtn = document.getElementById('loopBtn');
  if (!vid) return;

  if (subBtn) {
    if (!vid.authorId) {
      subBtn.hidden = true;
    } else {
      subBtn.hidden = false;
      const sub = isSubscribed(vid.authorId);
      subBtn.textContent = sub ? 'Berlangganan ✓' : 'Berlangganan';
      subBtn.className = sub ? 'btn-ghost btn-compact' : 'btn-primary btn-compact';
    }
  }
  if (subCountEl) {
    subCountEl.textContent = vid.followerCountText ? `${vid.followerCountText} subscriber` : '';
  }
  if (saveBtn) {
    saveBtn.textContent = isSaved(vid.id) ? 'Tersimpan di Putar Nanti' : 'Simpan ke Putar Nanti';
  }
  if (likeBtn) {
    const liked = isLiked(vid.id);
    likeBtn.classList.toggle('is-active', liked);
    likeBtn.setAttribute('aria-pressed', String(liked));
    if (likeTxt) {
      likeTxt.textContent = vid.likeCountText || (liked ? 'Disukai' : 'Suka');
    }
  }
  if (dislikeBtn) {
    const disliked = isDisliked(vid.id);
    dislikeBtn.classList.toggle('is-active', disliked);
    dislikeBtn.setAttribute('aria-pressed', String(disliked));
  }
  if (loopBtn) {
    loopBtn.classList.toggle('is-toggled', Boolean(state.loopVideo));
    loopBtn.setAttribute('aria-pressed', String(Boolean(state.loopVideo)));
  }
}

function recordHistory(video) {
  if (!video || !video.id) return;
  state.history = state.history.filter((h) => h.id !== video.id);
  state.history.unshift({
    id: video.id,
    title: video.title,
    author: video.author,
    authorId: video.authorId || '',
    duration: video.duration || '',
    views: video.views || '',
    thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`,
    watchedAt: Date.now(),
  });
  if (state.history.length > 60) state.history.length = 60;
  saveStore();
}

function cancelAutoNextCountdown() {
  if (state.upNextTimer) {
    clearInterval(state.upNextTimer);
    state.upNextTimer = null;
  }
  state.upNextCandidate = null;
  const overlay = document.getElementById('upNextOverlay');
  if (overlay) {
    overlay.hidden = true;
  }
}

function mergeVideosIntoQueue(items, opts = {}) {
  if (!Array.isArray(state.playQueue) || opts.replace === true) {
    state.playQueue = [];
  }
  const seen = new Set(state.playQueue.map((item) => item && item.id).filter(Boolean));
  if (
    opts.includeCurrent !== false &&
    state.currentVideo &&
    state.currentVideo.id &&
    YOUTUBE_ID_PATTERN.test(state.currentVideo.id) &&
    !seen.has(state.currentVideo.id)
  ) {
    seen.add(state.currentVideo.id);
    state.playQueue.push({ ...state.currentVideo });
  }
  const list = Array.isArray(items) ? items : [];
  let added = 0;
  list.forEach((item) => {
    if (!item || !item.id || !YOUTUBE_ID_PATTERN.test(item.id) || seen.has(item.id)) return;
    seen.add(item.id);
    state.playQueue.push({ ...item });
    added += 1;
  });
  return added;
}

async function extendUnlimitedQueue(forceFetch = false) {
  let added = mergeVideosIntoQueue(
    [
      ...(Array.isArray(state.currentRelated) ? state.currentRelated : []),
      ...(Array.isArray(state.feedPaging?.home?.items) ? state.feedPaging.home.items : []),
      ...(Array.isArray(state.rawSearchResults) ? state.rawSearchResults : []),
    ],
    { includeCurrent: true }
  );
  const currentId = state.currentVideo && state.currentVideo.id;
  const curIdx = currentId ? state.playQueue.findIndex((item) => item && item.id === currentId) : -1;
  const remaining = curIdx >= 0 ? state.playQueue.length - 1 - curIdx : state.playQueue.length;
  const curTitle = String(state.currentVideo?.title || '');
  const isPlaceholder = !curTitle || /^Memuat\b/i.test(curTitle);
  if ((!forceFetch && remaining >= 8) || (isPlaceholder && !forceFetch)) {
    if (added > 0 && typeof renderQueueDrawer === 'function') renderQueueDrawer();
    return added;
  }
  if (state.queueExtending) return added;
  state.queueExtending = true;
  try {
    if (typeof state.queueTrendingOffset !== 'number') {
      state.queueTrendingOffset = Array.isArray(state.feedPaging?.home?.items)
        ? state.feedPaging.home.items.length
        : 0;
    }
    let fetchedAdded = 0;
    if (!state.queueTrendingExhausted) {
      const resp = await fetch(
        `/api/trending?tab=all&offset=${state.queueTrendingOffset}&limit=30&refresh=0`
      );
      if (resp.ok) {
        const data = await resp.json();
        const batch = Array.isArray(data.results) ? data.results : [];
        state.queueTrendingOffset += batch.length;
        fetchedAdded = mergeVideosIntoQueue(batch, { includeCurrent: true });
        added += fetchedAdded;
        if (data.hasMore === false || batch.length === 0) {
          state.queueTrendingExhausted = true;
        }
      }
    }
    if (fetchedAdded === 0) {
      const fallbacks = ['official audio', 'live session', 'documentary film', 'acoustic cover', 'soundtrack'];
      const topicWords = String(state.currentVideo?.author || (!isPlaceholder ? curTitle : '') || '')
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 2)
        .slice(0, 3)
        .join(' ');
      const seedIdx = Number(state.queueSearchSeedIdx || 0);
      const query = state.queueSearchQuery || (topicWords.length >= 2 ? topicWords : fallbacks[seedIdx % fallbacks.length]);
      state.queueSearchQuery = query;
      const url = state.queueSearchToken
        ? `/api/search?q=${encodeURIComponent(query)}&token=${encodeURIComponent(state.queueSearchToken)}`
        : `/api/search?q=${encodeURIComponent(query)}`;
      const sResp = await fetch(url);
      if (sResp.ok) {
        const sData = await sResp.json();
        const sBatch = Array.isArray(sData.results) ? sData.results : [];
        const sAdded = mergeVideosIntoQueue(sBatch, { includeCurrent: true });
        added += sAdded;
        if (sData.nextToken && sAdded > 0) {
          state.queueSearchToken = sData.nextToken;
        } else {
          state.queueSearchToken = null;
          state.queueSearchSeedIdx = seedIdx + 1;
          state.queueSearchQuery = fallbacks[(seedIdx + 1) % fallbacks.length];
        }
      }
    }
  } catch {
    // Abaikan kegagalan jaringan latar belakang saat memperpanjang antrean
  } finally {
    state.queueExtending = false;
  }
  if (added > 0) {
    if (typeof renderQueueDrawer === 'function') renderQueueDrawer();
    if (typeof updateNextVideoUI === 'function') updateNextVideoUI();
  }
  return added;
}

function getNextUpVideo() {
  const currentId = state.currentVideo && state.currentVideo.id;
  const recentSet = new Set((state.recentPlayedIds || []).slice(-8));
  const pool = [];
  const seen = new Set();

  const pushCandidate = (item) => {
    if (!item || !item.id || !YOUTUBE_ID_PATTERN.test(item.id)) return;
    if (currentId && item.id === currentId) return;
    if (seen.has(item.id)) return;
    seen.add(item.id);
    pool.push(item);
  };

  let remainingAfterCurrent = 0;
  if (Array.isArray(state.playQueue) && state.playQueue.length > 0) {
    const curIdx = currentId ? state.playQueue.findIndex((item) => item && item.id === currentId) : -1;
    const upcoming = curIdx >= 0 ? state.playQueue.slice(curIdx + 1) : state.playQueue;
    remainingAfterCurrent = upcoming.length;
    upcoming.forEach(pushCandidate);
  }
  if (Array.isArray(state.currentRelated)) {
    state.currentRelated.forEach(pushCandidate);
  }
  if (Array.isArray(state.playQueue) && state.playQueue.length > 0 && currentId) {
    const curIdx = state.playQueue.findIndex((item) => item && item.id === currentId);
    if (curIdx > 0) {
      state.playQueue.slice(0, curIdx).forEach(pushCandidate);
    }
  }

  if (
    remainingAfterCurrent < 6 &&
    state.loadingStreamVideoId !== currentId &&
    typeof extendUnlimitedQueue === 'function'
  ) {
    extendUnlimitedQueue(false);
  }

  if (pool.length === 0) return null;
  const fresh = pool.find((item) => !recentSet.has(item.id));
  return fresh || pool[0];
}

function updateNextVideoUI() {
  const nextVid = getNextUpVideo();
  const nextBtn = document.getElementById('nextVideoBtn');
  if (nextBtn) {
    nextBtn.disabled = !nextVid;
    nextBtn.title = nextVid
      ? `Berikutnya: ${nextVid.title || 'Video Berikutnya'} (Shift+N)`
      : 'Tidak ada video berikutnya (Shift+N)';
    nextBtn.setAttribute(
      'aria-label',
      nextVid
        ? `Putar video berikutnya: ${nextVid.title || 'Video Berikutnya'}`
        : 'Video berikutnya tidak tersedia'
    );
  }
  const miniNextBtn = document.getElementById('miniNextBtn');
  if (miniNextBtn) {
    miniNextBtn.disabled = !nextVid;
    miniNextBtn.title = nextVid
      ? `Berikutnya: ${nextVid.title || 'Video Berikutnya'} (Shift+N)`
      : 'Video berikutnya tidak tersedia';
  }

  const list = document.getElementById('relatedList');
  if (list) {
    list.querySelectorAll('.related-item').forEach((itemEl) => {
      const isUpNext = Boolean(nextVid && itemEl.dataset.videoId === nextVid.id);
      itemEl.classList.toggle('is-up-next', isUpNext);
    });
  }

  if (nextVid && typeof prefetchVideos === 'function') {
    prefetchVideos([nextVid.id]);
  }
}

function updatePrevVideoUI() {
  const prevBtn = document.getElementById('prevVideoBtn');
  if (!prevBtn) return;
  const stack = state.watchHistoryStack || [];
  const prevVid = stack.length > 0 ? stack[stack.length - 1] : null;
  prevBtn.disabled = !prevVid;
  prevBtn.title = prevVid
    ? `Sebelumnya: ${prevVid.title || 'Video Sebelumnya'} (Shift+P)`
    : 'Tidak ada video sebelumnya (Shift+P)';
}

function playPrevVideo() {
  const stack = state.watchHistoryStack || [];
  if (stack.length === 0) {
    setStatus('Tidak ada video sebelumnya untuk diputar.');
    return false;
  }
  const prevVid = stack.pop();
  cancelAutoNextCountdown();
  updatePrevVideoUI();
  openWatchVideo(prevVid, { preserveView: isMiniPlayerActive(), isBackNav: true });
  return true;
}

function playNextVideo() {
  const nextVid = state.upNextCandidate || getNextUpVideo();
  cancelAutoNextCountdown();
  if (!nextVid) {
    setStatus('Tidak ada antrean video berikutnya untuk diputar.');
    return false;
  }
  openWatchVideo(nextVid, { preserveView: isMiniPlayerActive() });
  return true;
}

function startAutoNextCountdown() {
  cancelAutoNextCountdown();
  if (!state.prefs.autoPlayNext || (state.currentView !== 'watch' && !isMiniPlayerActive())) return;
  const nextVid = getNextUpVideo();
  if (!nextVid) return;

  const overlay = document.getElementById('upNextOverlay');
  const countdownEl = document.getElementById('upNextCountdownText');
  const thumbEl = document.getElementById('upNextThumb');
  const titleEl = document.getElementById('upNextTitle');
  const channelEl = document.getElementById('upNextChannel');
  if (!overlay || !countdownEl || !thumbEl || !titleEl || !channelEl) {
    playNextVideo();
    return;
  }

  state.upNextCandidate = nextVid;
  let remaining = 3;
  countdownEl.textContent = String(remaining);
  thumbEl.src = nextVid.thumbnail || `https://i.ytimg.com/vi/${nextVid.id}/mqdefault.jpg`;
  thumbEl.alt = nextVid.title || '';
  titleEl.textContent = nextVid.title || 'Video Berikutnya';
  channelEl.textContent = nextVid.author || nextVid.channel || 'YouTube';
  overlay.hidden = false;

  state.upNextTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      playNextVideo();
      return;
    }
    countdownEl.textContent = String(remaining);
  }, 1000);
}

function renderRelatedList(items) {
  const list = document.getElementById('relatedList');
  if (!list) return;
  list.replaceChildren();

  if (!items || items.length === 0) {
    const note = document.createElement('p');
    note.className = 'sidebar-empty-note';
    note.textContent = 'Tidak ada saran video terkait pada video ini.';
    list.appendChild(note);
    updateNextVideoUI();
    return;
  }

  const frag = document.createDocumentFragment();
  items.forEach((v) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'related-item';
    btn.dataset.videoId = v.id;
    btn.addEventListener('pointerenter', () => scheduleHoverPrefetch(v.id));
    btn.addEventListener('pointerleave', () => clearTimeout(hoverPrefetchTimer));
    btn.addEventListener('focus', () => scheduleHoverPrefetch(v.id));
    btn.addEventListener('click', () => openWatchVideo(v, { appendQueue: items }));

    const thumb = document.createElement('div');
    thumb.className = 'related-thumb';
    const img = document.createElement('img');
    img.src = v.thumbnail || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
    img.alt = v.title;
    img.loading = 'lazy';
    const dur = document.createElement('span');
    dur.className = 'duration-tag';
    dur.textContent = v.duration || 'Video';
    thumb.append(img, dur);

    const info = document.createElement('div');
    info.className = 'related-info';
    const title = document.createElement('h3');
    title.className = 'related-title';
    title.textContent = v.title;
    const ch = document.createElement('span');
    ch.className = 'related-channel';
    ch.textContent = v.author || 'Creator';
    info.append(title, ch);

    btn.append(thumb, info);
    frag.appendChild(btn);
  });
  list.appendChild(frag);
  updateNextVideoUI();
}

async function openWatchVideo(cardVideo, options = {}) {
  if (!cardVideo || !YOUTUBE_ID_PATTERN.test(cardVideo.id)) {
    setStatus('ID video YouTube tidak valid.', true);
    return;
  }

  cancelAutoNextCountdown();
  if (typeof clearPendingSeekState === 'function') {
    clearPendingSeekState();
  }
  if (state.streamAbort) state.streamAbort.abort();
  state.streamAbort = new AbortController();

  if (!options?.isBackNav && state.currentVideo && state.currentVideo.id && state.currentVideo.id !== cardVideo.id) {
    state.watchHistoryStack = (state.watchHistoryStack || []).filter((item) => item && item.id !== state.currentVideo.id);
    state.watchHistoryStack.push({ ...state.currentVideo });
    if (state.watchHistoryStack.length > 25) {
      state.watchHistoryStack = state.watchHistoryStack.slice(-25);
    }
  }
  state.miniPlayerClosed = false;
  if (!options || !options.preserveView) {
    switchView('watch');
  }
  state.currentVideo = { ...cardVideo };
  state.loadingStreamVideoId = cardVideo.id;
  updatePrevVideoUI();
  state.currentRelated = [];
  if (options && Array.isArray(options.queue) && options.queue.length > 0) {
    if (options.queue === state.playQueue && !options.replaceQueue) {
      mergeVideosIntoQueue([], { includeCurrent: true });
    } else {
      mergeVideosIntoQueue([cardVideo, ...options.queue], { replace: true, includeCurrent: true });
    }
  } else if (options && Array.isArray(options.appendQueue) && options.appendQueue.length > 0) {
    mergeVideosIntoQueue([cardVideo, ...options.appendQueue], { includeCurrent: true });
  } else {
    mergeVideosIntoQueue([], { includeCurrent: true });
  }
  state.recentPlayedIds = (state.recentPlayedIds || []).filter((id) => id !== cardVideo.id);
  state.recentPlayedIds.push(cardVideo.id);
  if (state.recentPlayedIds.length > 20) {
    state.recentPlayedIds = state.recentPlayedIds.slice(-20);
  }
  state.sponsorSegments = [];
  state.skippedSegmentIds = new Set();

  const v = videoEl();
  const a = audioEl();
  const thumbUrl = cardVideo.thumbnail || `https://i.ytimg.com/vi/${cardVideo.id}/hqdefault.jpg`;
  const stageEl = document.getElementById('playerStage');
  if (stageEl && thumbUrl) {
    stageEl.style.backgroundImage = `url("${thumbUrl}")`;
    stageEl.style.backgroundSize = 'contain';
    stageEl.style.backgroundPosition = 'center';
    stageEl.style.backgroundRepeat = 'no-repeat';
  }
  v.style.opacity = '0';
  v.poster = thumbUrl;
  v.pause();
  a.pause();
  v.removeAttribute('src');
  a.removeAttribute('src');
  a.dataset.activeUrl = '';
  v.load();
  a.load();
  const ambientImg = document.getElementById('playerAmbientImg');
  if (ambientImg) {
    if (ambientImg.src !== thumbUrl) ambientImg.src = thumbUrl;
    ambientImg.hidden = state.prefs.ambientMode === false;
  }

  document.getElementById('watchTitle').textContent = cardVideo.title || 'Memuat judul...';
  document.getElementById('watchChannel').textContent = cardVideo.author || 'Memuat channel...';
  document.getElementById('watchStats').textContent = [cardVideo.views, cardVideo.published].filter(Boolean).join(' / ');
  document.getElementById('watchDescription').textContent = 'Memuat detail video...';
  document.getElementById('sponsorStatusText').textContent = 'SponsorBlock: memeriksa segmen...';
  document.getElementById('seekFill').style.width = '0%';
  document.getElementById('seekBuffer').style.width = '0%';
  const thumbResetEl = document.getElementById('seekThumb');
  if (thumbResetEl) thumbResetEl.style.left = '0%';
  const miniFill = document.getElementById('miniProgressFill');
  if (miniFill) miniFill.style.width = '0%';
  document.getElementById('timeDisplay').textContent = '00:00 / 00:00';
  document.getElementById('sponsorMarkers').replaceChildren();

  updateMiniPlayerUI();
  if (typeof renderQueueDrawer === 'function') renderQueueDrawer();
  renderChapters([], 0);
  setupCaptions(cardVideo.id, []);
  const cList = document.getElementById('commentsList');
  const cState = document.getElementById('commentsState');
  const cCount = document.getElementById('commentsCount');
  const cMoreBar = document.getElementById('commentsMoreBar');
  if (cList) cList.replaceChildren();
  if (cCount) cCount.textContent = '';
  if (cMoreBar) cMoreBar.hidden = true;
  if (cState) {
    cState.textContent = 'Memuat komentar teratas...';
    cState.hidden = false;
  }

  const overlay = document.getElementById('playerBusyOverlay');
  const busyMsg = document.getElementById('playerBusyMsg');
  const retryBtn = document.getElementById('playerRetryBtn');
  overlay.hidden = true;
  retryBtn.hidden = true;
  busyMsg.textContent = '';

  updateWatchActionButtons();
  updateNextVideoUI();

  try {
    const res = await fetch(`/api/stream?id=${encodeURIComponent(cardVideo.id)}`, {
      signal: state.streamAbort.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    state.currentVideo = {
      id: data.id,
      title: data.title,
      author: data.author,
      authorId: data.authorId || cardVideo.authorId || '',
      duration: data.duration,
      views: data.views,
      likeCount: data.likeCount || 0,
      likeCountText: data.likeCountText || '',
      followerCountText: data.followerCountText || '',
      thumbnail: thumbUrl || data.thumbnail,
    };
    if (state.queueIndex >= 0 && state.queue[state.queueIndex] && state.queue[state.queueIndex].id === data.id) {
      state.queue[state.queueIndex].title = data.title;
    }
    state.currentQualities = data.qualities || [];
    state.sponsorSegments = Array.isArray(data.sponsorSegments) ? data.sponsorSegments : [];

    if (ambientImg && !ambientImg.src && data.thumbnail) {
      ambientImg.src = data.thumbnail;
    }
    document.getElementById('watchTitle').textContent = data.title;
    document.getElementById('watchChannel').textContent = data.author;
    document.getElementById('watchStats').textContent = [data.views, data.published].filter(Boolean).join(' / ');
    renderTextWithTimestamps(document.getElementById('watchDescription'), data.description || 'Tidak ada deskripsi.');
    updateMiniPlayerUI();
    updateMediaSessionMetadata();
    if (typeof renderQueueDrawer === 'function') renderQueueDrawer();

    if (state.sponsorSegments.length > 0) {
      document.getElementById('sponsorStatusText').textContent = `SponsorBlock: ${state.sponsorSegments.length} segmen terdeteksi siap dilewati.`;
    } else {
      document.getElementById('sponsorStatusText').textContent = 'SponsorBlock: bersih, tidak ada segmen sponsor.';
    }

    renderChapters(data.chapters || [], data.durationSec || 0);
    setupCaptions(data.id, data.captions || []);
    loadVideoComments(data.id);

    const qSel = document.getElementById('qualitySelect');
    qSel.replaceChildren();
    state.currentQualities.forEach((q) => {
      const opt = document.createElement('option');
      opt.value = q.itag;
      opt.textContent = q.muxed ? `${q.label} (MP4)` : `${q.label} HD`;
      qSel.appendChild(opt);
    });

    const prefHeight = Number(state.prefs.defaultQuality) || 720;
    const chosen =
      state.currentQualities.find((q) => q.height && q.height <= prefHeight) ||
      state.currentQualities.find((q) => q.itag === data.defaultItag) ||
      state.currentQualities[0];
    if (chosen) {
      qSel.value = chosen.itag;
      const prefSpeed = Number(state.prefs.defaultSpeed) || 1;
      const spSel = document.getElementById('speedSelect');
      if (spSel) spSel.value = String(prefSpeed);
      const vEl = videoEl();
      if (vEl) vEl.playbackRate = prefSpeed;
      const savedPos = state.progress[data.id];
      const durSec = Number(data.durationSec) || 0;
      let resumeTime = 0;
      if (savedPos && savedPos.t > 10 && (!savedPos.d || !durSec || Math.abs(savedPos.d - durSec) < 30)) {
        resumeTime = durSec ? Math.min(savedPos.t, Math.max(0, durSec - 5)) : savedPos.t;
      }
      applyQualityStream(chosen, resumeTime, true);
      if (resumeTime > 0) setStatus(`Melanjutkan dari ${formatTime(resumeTime)}.`);
    } else {
      throw new Error('Tidak ada format pemutaran yang tersedia.');
    }

    recordHistory(state.currentVideo);
    updateWatchActionButtons();
    if (state.loadingStreamVideoId === cardVideo.id) state.loadingStreamVideoId = null;
    state.currentRelated = Array.isArray(data.related) ? data.related : [];
    mergeVideosIntoQueue(state.currentRelated, { includeCurrent: true });
    if (state.playQueue.length < 25 && Array.isArray(state.feedPaging?.home?.items)) {
      mergeVideosIntoQueue(state.feedPaging.home.items, { includeCurrent: true });
    }
    renderRelatedList(state.currentRelated);
    if (typeof renderQueueDrawer === 'function') renderQueueDrawer();
    setStatus('');
  } catch (err) {
    if (state.loadingStreamVideoId === cardVideo.id) state.loadingStreamVideoId = null;
    if (err.name === 'AbortError') return;
    overlay.hidden = false;
    busyMsg.textContent = `Stream gagal dimuat: ${err.message}`;
    retryBtn.hidden = false;
    retryBtn.onclick = () => openWatchVideo(cardVideo, options);
  }
}

/* --- Player Event Bindings --- */
function initPlayerControls() {
  const v = videoEl();
  const a = audioEl();
  const stage = document.getElementById('playerStage');
  const primaryCol = document.querySelector('.watch-primary');
  let lastAudioSampleTime = -1;
  let lastVideoResyncAt = 0;

  const cancelSeekResume = () => {
    if (state.seekResumeTimer) {
      clearTimeout(state.seekResumeTimer);
      state.seekResumeTimer = 0;
    }
    state.resumeAfterSeek = false;
  };

  const maybeFinishSeekResume = (force = false) => {
    if (!state.resumeAfterSeek || state.pendingSeekTarget !== null || state.isScrubbing) return;
    if (!force && (v.seeking || v.readyState < 2 || (state.dualAudioActive && a.src && (a.seeking || a.readyState < 2)))) return;
    cancelSeekResume();
    if (state.dualAudioActive && a.src && !a.seeking && Math.abs((a.currentTime || 0) - (v.currentTime || 0)) > 1.2) {
      a.currentTime = v.currentTime || 0;
    }
    v.play().catch(() => {});
    syncAudioAction('play');
    updatePlayPauseUI();
  };

  let stagePulseTimer = 0;
  const stagePulseEl = document.getElementById('stagePulseHud');
  const showStagePulse = (label) => {
    if (!stagePulseEl) return;
    stagePulseEl.textContent = label;
    stagePulseEl.hidden = false;
    clearTimeout(stagePulseTimer);
    stagePulseTimer = setTimeout(() => {
      stagePulseEl.hidden = true;
    }, 520);
  };

  const togglePlay = (withHud = false) => {
    if (!v.src) return;
    clearInternalVideoResync();
    if (state.resumeAfterSeek) {
      cancelSeekResume();
      v.pause();
      syncAudioAction('pause');
      if (withHud) showStagePulse('Jeda');
    } else if (v.paused) {
      v.play().catch(() => {});
      if (!v.seeking && v.readyState >= 2) syncAudioAction('play');
      if (withHud) showStagePulse('Putar');
    } else {
      v.pause();
      syncAudioAction('pause');
      if (withHud) showStagePulse('Jeda');
    }
    updatePlayPauseUI();
  };

  document.getElementById('playPauseBtn').addEventListener('click', () => togglePlay(false));
  v.addEventListener('click', () => {
    if (isMiniPlayerActive()) {
      switchView('watch');
      return;
    }
    togglePlay(true);
  });
  stage?.addEventListener('click', (ev) => {
    if (!isMiniPlayerActive() || ev.target === v || ev.target.closest('button')) return;
    switchView('watch');
  });
  stage.addEventListener('dblclick', () => {
    if (isMiniPlayerActive()) {
      switchView('watch');
      return;
    }
    document.getElementById('fullscreenBtn').click();
  });

  let seekOsdTimer = 0;
  let burstResetTimer = 0;

  let osdBadge = document.getElementById('seekOsdBadge');
  if (!osdBadge && stage) {
    osdBadge = document.createElement('div');
    osdBadge.id = 'seekOsdBadge';
    osdBadge.className = 'seek-osd-badge';
    osdBadge.hidden = true;
    osdBadge.setAttribute('aria-hidden', 'true');
    stage.appendChild(osdBadge);
  }

  const seekTrackEl = document.getElementById('seekTrack');
  let hoverTip = document.getElementById('seekHoverBubble') || document.getElementById('seekHoverTip');
  if (!hoverTip && seekTrackEl) {
    hoverTip = document.createElement('div');
    hoverTip.id = 'seekHoverBubble';
    hoverTip.className = 'seek-hover-bubble';
    hoverTip.hidden = true;
    seekTrackEl.appendChild(hoverTip);
  }

  const showSeekOsd = (label) => {
    if (!osdBadge) return;
    osdBadge.textContent = label;
    osdBadge.hidden = false;
    clearTimeout(seekOsdTimer);
    seekOsdTimer = setTimeout(() => {
      osdBadge.hidden = true;
    }, 680);
  };

  const updateSeekVisual = (sec, dur) => {
    const td = document.getElementById('timeDisplay');
    if (td) td.textContent = `${formatTime(sec)} / ${formatTime(dur)}`;
    if (dur > 0) {
      const pct = Math.max(0, Math.min(100, (sec / dur) * 100));
      if (seekTrackEl) {
        document.getElementById('seekFill').style.width = `${pct}%`;
        const thumbEl = document.getElementById('seekThumb');
        if (thumbEl) thumbEl.style.left = `${pct}%`;
        seekTrackEl.setAttribute('aria-valuenow', String(Math.round(pct)));
      }
      const miniFill = document.getElementById('miniProgressFill');
      if (miniFill) miniFill.style.width = `${pct}%`;
    }
  };

  const commitQueuedSeek = () => {
    clearInternalVideoResync();
    if (state.seekCommitTimer) {
      clearTimeout(state.seekCommitTimer);
      state.seekCommitTimer = 0;
    }
    const target = state.pendingSeekTarget;
    state.pendingSeekTarget = null;
    if (target === null || !v.src || !Number.isFinite(v.duration) || v.duration <= 0) {
      cancelSeekResume();
      return;
    }
    const clamped = Math.max(0, Math.min(v.duration - 0.1, target));
    if (state.dualAudioActive && a.src) {
      a.pause();
    }
    lastAudioSampleTime = -1;
    v.currentTime = clamped;
    if (state.dualAudioActive && a.src) {
      a.currentTime = clamped;
    }
    if (state.resumeAfterSeek) {
      if (v.paused) {
        v.play().catch(() => {});
        updatePlayPauseUI();
      }
      if (state.seekResumeTimer) clearTimeout(state.seekResumeTimer);
      state.seekResumeTimer = setTimeout(() => maybeFinishSeekResume(true), 450);
    }
  };

  const requestSkip = (deltaSec) => {
    if (!v.src || !Number.isFinite(v.duration) || v.duration <= 0) return;
    clearInternalVideoResync();
    const base = state.pendingSeekTarget !== null ? state.pendingSeekTarget : (v.currentTime || 0);
    const next = Math.max(0, Math.min(v.duration - 0.1, base + deltaSec));
    state.pendingSeekTarget = next;
    state.skipBurstDelta = (state.skipBurstDelta || 0) + deltaSec;
    clearTimeout(burstResetTimer);
    burstResetTimer = setTimeout(() => {
      state.skipBurstDelta = 0;
    }, 650);

    if (!v.paused) {
      state.resumeAfterSeek = true;
    }
    if (state.dualAudioActive && a.src && !a.paused) {
      a.pause();
    }
    updateSeekVisual(next, v.duration);
    const bDelta = state.skipBurstDelta;
    const sign = bDelta >= 0 ? '+' : '';
    showSeekOsd(`${sign}${bDelta}d · ${formatTime(next)}`);

    if (state.seekCommitTimer) clearTimeout(state.seekCommitTimer);
    state.seekCommitTimer = setTimeout(commitQueuedSeek, 35);
  };

  const seekAbsolute = (sec, label = '') => {
    if (!v.src || !Number.isFinite(v.duration) || v.duration <= 0) return;
    clearInternalVideoResync();
    const clamped = Math.max(0, Math.min(v.duration - 0.1, Number(sec) || 0));
    state.pendingSeekTarget = clamped;
    updateSeekVisual(clamped, v.duration);
    showSeekOsd(label || formatTime(clamped));
    if (state.seekCommitTimer) clearTimeout(state.seekCommitTimer);
    state.seekCommitTimer = setTimeout(commitQueuedSeek, 30);
  };

  state.playerActions = { requestSkip, seekAbsolute, showSeekOsd };

  const ratioFromClientX = (clientX) => {
    if (!seekTrackEl) return 0;
    const rect = seekTrackEl.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  v.addEventListener('play', () => {
    syncAudioAction('play');
    updatePlayPauseUI();
  });
  v.addEventListener('pause', () => {
    syncAudioAction('pause');
    updatePlayPauseUI();
  });
  const shellBuf = document.getElementById('playerFrameShell');
  const setBuffering = () => shellBuf?.classList.remove('is-buffering');
  v.addEventListener('waiting', () => {
    setBuffering(false);
    syncAudioAction('waiting_pause');
  });
  v.addEventListener('pause', () => setBuffering(false));
  v.addEventListener('emptied', () => setBuffering(false));
  v.addEventListener('canplaythrough', () => setBuffering(false));
  v.addEventListener('ended', () => setBuffering(false));
  v.addEventListener('seeked', () => setBuffering(false));
  v.addEventListener('canplay', () => setBuffering(false));
  v.addEventListener('playing', () => {
    setBuffering(false);
    const busy = document.getElementById('playerBusyOverlay');
    if (busy) busy.hidden = true;
    if (state.pendingSeekTarget === null && !state.isScrubbing) updateSeekVisual(v.currentTime || 0, v.duration || 0);
    syncAudioAction('play');
    updatePlayPauseUI();
  });
  v.addEventListener('loadeddata', () => {
    maybeFinishSeekResume(false);
    if (!v.paused && !v.seeking && v.readyState >= 2) {
      syncAudioAction('play');
    }
  });
  v.addEventListener('canplay', () => {
    maybeFinishSeekResume(false);
    if (!v.paused && !v.seeking && v.readyState >= 2) {
      syncAudioAction('play');
    }
  });
  v.addEventListener('ratechange', () => {
    syncAudioAction('rate');
    updateMediaSessionPosition();
  });
  document.getElementById('sleepTimerSelect')?.addEventListener('change', (ev) => {
    setSleepTimer(ev.target.value);
  });
  v.addEventListener('seeking', () => {
    if (internalVideoResync) return;
    cancelAutoNextCountdown();
    syncAudioAction('pause');
    if (state.dualAudioActive && a.src && Math.abs((a.currentTime || 0) - (v.currentTime || 0)) > 0.5) {
      a.currentTime = v.currentTime || 0;
    }
  });
  v.addEventListener('seeked', () => {
    if (internalVideoResync) {
      clearInternalVideoResync();
      return;
    }
    if (state.resumeAfterSeek) {
      maybeFinishSeekResume(false);
      return;
    }
    if (state.dualAudioActive && a.src && !a.seeking && Math.abs((a.currentTime || 0) - (v.currentTime || 0)) > 0.8) {
      a.currentTime = v.currentTime || 0;
    }
    if (!v.paused && v.readyState >= 2) {
      syncAudioAction('play');
    }
  });
  a.addEventListener('seeked', () => {
    maybeFinishSeekResume(false);
  });
  a.addEventListener('loadeddata', () => {
    maybeFinishSeekResume(false);
    if (state.dualAudioActive && !v.paused && !v.seeking && v.readyState >= 2 && a.paused) {
      syncAudioAction('play');
    }
  });
  a.addEventListener('canplay', () => {
    maybeFinishSeekResume(false);
    if (state.dualAudioActive && !v.paused && !v.seeking && v.readyState >= 2 && a.paused) {
      syncAudioAction('play');
    }
  });
  v.addEventListener('play', cancelAutoNextCountdown);
  v.addEventListener('ended', () => {
    clearInternalVideoResync();
    if (state.sleepTimerMode === 'end') {
      clearProgress(state.currentVideo?.id);
      triggerSleepTimerStop('Sleep Timer selesai di akhir video.');
      return;
    }
    if (state.loopVideo) {
      v.currentTime = 0;
      if (state.dualAudioActive && a.src) a.currentTime = 0;
      v.play().catch(() => {});
      syncAudioAction('play');
      updatePlayPauseUI();
      return;
    }
    clearProgress(state.currentVideo?.id);
    syncAudioAction('pause');
    updatePlayPauseUI();
    startAutoNextCountdown();
  });

  v.addEventListener('timeupdate', () => {
    const dur = v.duration || 0;
    const cur = v.currentTime || 0;
    if (performance.now() - state.lastProgressSaveAt > 5000 && dur > 0 && !v.paused && !v.seeking) {
      saveProgress(state.currentVideo?.id, cur, dur);
    }
    if (state.pendingSeekTarget === null && !state.isScrubbing) {
      updateSeekVisual(cur, dur);
      updateMediaSessionPosition();
    }
    updateActiveChapter(cur);
    if (dur > 0 && v.buffered.length > 0) {
      const bufEnd = v.buffered.end(v.buffered.length - 1);
      document.getElementById('seekBuffer').style.width = `${Math.min(100, (bufEnd / dur) * 100)}%`;
    }

    if (
      state.dualAudioActive &&
      a.src &&
      !v.paused &&
      !v.seeking &&
      !a.seeking &&
      v.readyState >= 2 &&
      a.readyState >= 2 &&
      state.pendingSeekTarget === null &&
      !state.isScrubbing
    ) {
      if (a.paused) {
        syncAudioAction('play');
      } else {
        const targetRate = (Number.isFinite(v.playbackRate) && v.playbackRate > 0) ? v.playbackRate : 1;
        if (Math.abs((a.playbackRate || 1) - targetRate) > 0.005) {
          a.playbackRate = targetRate;
        }
        const aCur = a.currentTime || 0;
        const absDiff = Math.abs(aCur - cur);
        const now = performance.now();
        if (absDiff > 0.65 && (now - lastVideoResyncAt) > 2500) {
          lastVideoResyncAt = now;
          a.currentTime = cur;
        }
      }
    }

    if (state.prefs.autoSponsorSkip && state.sponsorSegments.length > 0) {
      for (const seg of state.sponsorSegments) {
        const [start, end] = seg.segment || [];
        if (cur >= start && cur < end - 0.5 && !state.skippedSegmentIds.has(seg.UUID)) {
          state.skippedSegmentIds.add(seg.UUID);
          v.currentTime = end;
          if (state.dualAudioActive && a.src) a.currentTime = end;
          document.getElementById('sponsorStatusText').textContent = `Melewati ${seg.category || 'sponsor'} (${formatTime(start)} ke ${formatTime(end)}).`;
          break;
        }
      }
    }
  });

  if (seekTrackEl) {
    seekTrackEl.addEventListener('pointermove', (ev) => {
      if (!Number.isFinite(v.duration) || v.duration <= 0) return;
      const ratio = ratioFromClientX(ev.clientX);
      const target = ratio * v.duration;
      if (hoverTip) {
        hoverTip.textContent = formatTime(target);
        hoverTip.style.left = `${ratio * 100}%`;
        hoverTip.hidden = false;
      }
      if (state.isScrubbing) {
        state.pendingSeekTarget = target;
        updateSeekVisual(target, v.duration);
      }
    });

    seekTrackEl.addEventListener('pointerleave', () => {
      if (hoverTip && !state.isScrubbing) hoverTip.hidden = true;
    });

    seekTrackEl.addEventListener('pointerdown', (ev) => {
      if (!v.src || !Number.isFinite(v.duration) || v.duration <= 0) return;
      ev.preventDefault();
      state.isScrubbing = true;
      seekTrackEl.classList.add('is-scrubbing');
      if (seekTrackEl.setPointerCapture) {
        try {
          seekTrackEl.setPointerCapture(ev.pointerId);
        } catch {
          // Ignore environments without pointer capture
        }
      }
      if (!v.paused) {
        state.resumeAfterSeek = true;
        v.pause();
        updatePlayPauseUI();
      }
      if (state.dualAudioActive && a.src) a.pause();
      const target = ratioFromClientX(ev.clientX) * v.duration;
      state.pendingSeekTarget = target;
      updateSeekVisual(target, v.duration);
    });

    const finishScrub = (ev) => {
      if (!state.isScrubbing) return;
      state.isScrubbing = false;
      seekTrackEl.classList.remove('is-scrubbing');
      if (hoverTip) hoverTip.hidden = true;
      if (Number.isFinite(v.duration) && v.duration > 0) {
        state.pendingSeekTarget = ratioFromClientX(ev.clientX) * v.duration;
        commitQueuedSeek();
      }
    };
    seekTrackEl.addEventListener('pointerup', finishScrub);
    seekTrackEl.addEventListener('pointercancel', finishScrub);
    seekTrackEl.addEventListener('click', (ev) => {
      if (ev.detail === 0 || (!state.isScrubbing && ev.pointerType === '')) {
        if (Number.isFinite(v.duration) && v.duration > 0) {
          state.pendingSeekTarget = ratioFromClientX(ev.clientX) * v.duration;
          commitQueuedSeek();
        }
      }
    });
  }

  document.getElementById('seekBackBtn').addEventListener('click', () => requestSkip(-10));
  document.getElementById('seekFwdBtn').addEventListener('click', () => requestSkip(10));

  const volSlider = document.getElementById('volumeSlider');
  const muteBtn = document.getElementById('muteBtn');
  const applyVolume = (val, muted) => {
    if (state.dualAudioActive) {
      a.volume = val;
      a.muted = muted;
    } else {
      v.volume = val;
      v.muted = muted;
    }
    const isMuted = Boolean(muted || val === 0);
    muteBtn.classList.toggle('is-toggled', isMuted);
    muteBtn.setAttribute('aria-pressed', String(isMuted));
    muteBtn.title = isMuted ? 'Hidupkan suara (M)' : 'Bisukan (M)';
    muteBtn.setAttribute('aria-label', muteBtn.title);
  };
  volSlider.addEventListener('input', () => applyVolume(Number(volSlider.value), false));
  muteBtn.addEventListener('click', () => {
    const currentlyMuted = state.dualAudioActive ? a.muted : v.muted;
    const nextMuted = !currentlyMuted;
    applyVolume(Number(volSlider.value), nextMuted);
    showSeekOsd(nextMuted ? 'Suara: Bisu' : `Volume: ${Math.round(Number(volSlider.value) * 100)}%`);
  });

  document.getElementById('speedSelect').addEventListener('change', (ev) => {
    const rate = Number(ev.target.value || 1);
    v.playbackRate = rate;
    syncAudioAction('rate');
  });

  document.getElementById('qualitySelect').addEventListener('change', (ev) => {
    const itag = ev.target.value;
    const chosen = state.currentQualities.find((q) => q.itag === itag);
    if (chosen) {
      const overlay = document.getElementById('playerBusyOverlay');
      if (overlay) overlay.hidden = true;
      showSeekOsd(`Resolusi: ${chosen.label}`);
      applyQualityStream(chosen, v.currentTime || 0, !v.paused);
    }
  });

  document.getElementById('sponsorToggleBtn').addEventListener('click', () => {
    state.prefs.autoSponsorSkip = !state.prefs.autoSponsorSkip;
    saveStore();
    syncCustomizeControls();
  });

  document.getElementById('ambientToggleBtn')?.addEventListener('click', () => {
    state.prefs.ambientMode = state.prefs.ambientMode === false;
    saveStore();
    applyPreferencesToDOM();
    showSeekOsd(state.prefs.ambientMode ? 'Ambient Mode: Aktif' : 'Ambient Mode: Mati');
  });

  document.getElementById('prevVideoBtn')?.addEventListener('click', () => {
    playPrevVideo();
  });
  document.getElementById('nextVideoBtn')?.addEventListener('click', () => {
    playNextVideo();
  });
  document.getElementById('autoNextToggleBtn')?.addEventListener('click', () => {
    state.prefs.autoPlayNext = !state.prefs.autoPlayNext;
    saveStore();
    syncCustomizeControls();
    if (!state.prefs.autoPlayNext) {
      cancelAutoNextCountdown();
    }
  });
  document.getElementById('upNextPlayNowBtn')?.addEventListener('click', () => {
    playNextVideo();
  });
  document.getElementById('upNextCancelBtn')?.addEventListener('click', () => {
    cancelAutoNextCountdown();
  });

  document.getElementById('pipBtn').addEventListener('click', async () => {
    if (!document.pictureInPictureEnabled) {
      setStatus('Picture-in-Picture tidak didukung oleh WebView ini.', true);
      return;
    }
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch (err) {
      setStatus(`Gagal mengaktifkan PiP: ${err.message}`, true);
    }
  });

  document.getElementById('theaterBtn').addEventListener('click', () => {
    document.getElementById('viewWatch').classList.toggle('is-theater');
  });

  document.getElementById('fullscreenBtn').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await primaryCol.requestFullscreen();
      }
    } catch {
      // Ignored cleanly
    }
  });

  document.getElementById('subscribeBtn').addEventListener('click', () => {
    if (state.currentVideo && state.currentVideo.authorId) {
      toggleSubscribe(state.currentVideo.authorId, state.currentVideo.author);
    }
  });
  document.getElementById('saveVideoBtn').addEventListener('click', () => {
    if (state.currentVideo) toggleSaveVideo(state.currentVideo);
  });
  document.getElementById('likeBtn')?.addEventListener('click', () => {
    if (state.currentVideo) toggleLikeVideo(state.currentVideo);
  });
  document.getElementById('dislikeBtn')?.addEventListener('click', () => {
    if (state.currentVideo) toggleDislikeVideo(state.currentVideo);
  });
  document.getElementById('shareBtn')?.addEventListener('click', () => {
    shareCurrentVideo();
  });
  document.getElementById('watchChannelBtn')?.addEventListener('click', () => {
    if (state.currentVideo && state.currentVideo.authorId) {
      openChannelView(state.currentVideo.authorId, state.currentVideo.author);
    }
  });

  document.getElementById('loopBtn')?.addEventListener('click', () => {
    state.loopVideo = !state.loopVideo;
    updateWatchActionButtons();
    showSeekOsd(state.loopVideo ? 'Ulangi: Aktif' : 'Ulangi: Mati');
  });

  document.getElementById('ccBtn')?.addEventListener('click', () => {
    if (!state.currentCaptions || state.currentCaptions.length === 0) {
      setStatus('Subtitle tidak tersedia untuk video ini.');
      return;
    }
    const nextLang = state.activeCaptionLang ? '' : state.currentCaptions[0].lang;
    setActiveCaption(nextLang);
    showSeekOsd(nextLang ? `Subtitle: ${nextLang}` : 'Subtitle: Mati');
  });

  document.getElementById('ccSelect')?.addEventListener('change', (ev) => {
    setActiveCaption(ev.target.value || '');
  });

  document.getElementById('miniPlayerBtn')?.addEventListener('click', () => {
    if (!state.currentVideo) return;
    state.miniPlayerClosed = false;
    const dest = state.previousView && state.previousView !== 'watch' ? state.previousView : 'home';
    switchView(dest);
  });

  document.getElementById('miniPlayPauseBtn')?.addEventListener('click', () => togglePlay(false));
  document.getElementById('miniNextBtn')?.addEventListener('click', () => playNextVideo());
  document.getElementById('miniExpandBtn')?.addEventListener('click', () => switchView('watch'));
  document.querySelector('#miniPlayerBar .mini-meta')?.addEventListener('click', () => switchView('watch'));
  document.getElementById('miniCloseBtn')?.addEventListener('click', () => closeMiniPlayer());
}

const NAV_ITEM_LABELS = {
  home: 'Beranda',
  subscriptions: 'Langganan',
  playlists: 'Putar Nanti & Disukai',
  history: 'Riwayat Tontonan',
  customize: 'Kustomisasi UI',
};

function renderNavOrderEditor() {
  const host = document.getElementById('navOrderEditor');
  if (!host) return;
  const baseKeys = ['home', 'subscriptions', 'playlists', 'history', 'customize'];
  const rawOrder = Array.isArray(state.prefs.navOrder) ? state.prefs.navOrder : [];
  const order = [...rawOrder.filter((k) => baseKeys.includes(k))];
  baseKeys.forEach((k) => {
    if (!order.includes(k)) order.push(k);
  });
  const hiddenSet = new Set(Array.isArray(state.prefs.hiddenNavs) ? state.prefs.hiddenNavs : []);

  host.replaceChildren();
  const frag = document.createDocumentFragment();
  order.forEach((key, idx) => {
    const row = document.createElement('div');
    row.className = 'nav-order-row';
    const isHidden = hiddenSet.has(key) && key !== 'customize';
    if (isHidden) row.classList.add('is-hidden-nav');

    const lbl = document.createElement('span');
    lbl.className = 'nav-order-label';
    lbl.textContent = NAV_ITEM_LABELS[key] || key;

    const actions = document.createElement('div');
    actions.className = 'nav-order-actions';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'nav-mini-btn';
    upBtn.textContent = '↑';
    upBtn.disabled = idx === 0;
    upBtn.setAttribute('aria-label', `Geser ${lbl.textContent} ke atas`);
    upBtn.addEventListener('click', () => {
      const next = [...order];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      state.prefs.navOrder = next;
      saveStore();
      applyPreferencesToDOM();
    });

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'nav-mini-btn';
    downBtn.textContent = '↓';
    downBtn.disabled = idx === order.length - 1;
    downBtn.setAttribute('aria-label', `Geser ${lbl.textContent} ke bawah`);
    downBtn.addEventListener('click', () => {
      const next = [...order];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      state.prefs.navOrder = next;
      saveStore();
      applyPreferencesToDOM();
    });

    const visBtn = document.createElement('button');
    visBtn.type = 'button';
    visBtn.className = 'nav-mini-btn';
    visBtn.disabled = key === 'customize';
    visBtn.textContent = key === 'customize' ? 'Tetap' : isHidden ? 'Tampil' : 'Sembunyi';
    visBtn.addEventListener('click', () => {
      if (key === 'customize') return;
      const nextHidden = new Set(Array.isArray(state.prefs.hiddenNavs) ? state.prefs.hiddenNavs : []);
      if (nextHidden.has(key)) nextHidden.delete(key);
      else nextHidden.add(key);
      state.prefs.hiddenNavs = Array.from(nextHidden);
      saveStore();
      applyPreferencesToDOM();
    });

    actions.append(upBtn, downBtn, visBtn);
    row.append(lbl, actions);
    frag.appendChild(row);
  });
  host.appendChild(frag);
}

/* --- GUI Customizer Studio Wiring --- */
function initCustomizeStudio() {
  const presetList = document.getElementById('presetList');
  if (presetList) {
    presetList.replaceChildren();
    Object.entries(THEME_PRESETS).forEach(([id, preset]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-btn';
      btn.dataset.preset = id;

      const swatch = document.createElement('span');
      swatch.className = 'preset-swatch';
      swatch.style.background = `linear-gradient(135deg, ${preset.bg} 55%, ${preset.accent} 55%)`;

      const lbl = document.createElement('span');
      lbl.textContent = preset.name;

      btn.append(swatch, lbl);
      btn.addEventListener('click', () => {
        state.prefs.theme = id;
        state.prefs.customColors = null;
        saveStore();
        applyPreferencesToDOM();
      });
      presetList.appendChild(btn);
    });
  }

  const updateCustomColor = (key, val) => {
    const preset = THEME_PRESETS[state.prefs.theme] || THEME_PRESETS['studio-dark'];
    state.prefs.customColors = {
      accent: state.prefs.customColors?.accent || preset.accent,
      bg: state.prefs.customColors?.bg || preset.bg,
      surface: state.prefs.customColors?.surface || preset.surface,
      [key]: val,
    };
    saveStore();
    applyPreferencesToDOM();
  };

  const bindPref = (id, eventName, handler) => {
    document.getElementById(id)?.addEventListener(eventName, handler);
  };

  bindPref('customAccentInput', 'input', (e) => updateCustomColor('accent', e.target.value));
  bindPref('customBgInput', 'input', (e) => updateCustomColor('bg', e.target.value));
  bindPref('customSurfaceInput', 'input', (e) => updateCustomColor('surface', e.target.value));

  bindPref('navLayoutSelect', 'change', (e) => {
    state.prefs.navLayout = e.target.value;
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('searchAlignSelect', 'change', (e) => {
    state.prefs.searchAlign = e.target.value;
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('brandTitleInput', 'input', (e) => {
    state.prefs.brandTitle = e.target.value;
    saveStore();
    applyPreferencesToDOM();
  });

  bindPref('playerBarModeSelect', 'change', (e) => {
    state.prefs.playerBarMode = e.target.value;
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('seekbarStyleSelect', 'change', (e) => {
    state.prefs.seekbarStyle = e.target.value;
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('customSeekbarInput', 'input', (e) => {
    state.prefs.seekbarColor = e.target.value;
    state.prefs.seekbarStyle = 'custom';
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('seekbarHeightRange', 'input', (e) => {
    state.prefs.seekbarHeight = Number(e.target.value);
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('optAmbientMode', 'change', (e) => {
    state.prefs.ambientMode = e.target.checked;
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('optShowSpotlight', 'change', (e) => {
    state.prefs.showSpotlight = e.target.checked;
    saveStore();
    applyPreferencesToDOM();
    renderHomeSpotlight(state.feedPaging?.home?.items || []);
  });

  bindPref('cardStyleSelect', 'change', (e) => {
    state.prefs.cardStyle = e.target.value;
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('fontPresetSelect', 'change', (e) => {
    state.prefs.fontPreset = e.target.value;
    saveStore();
    applyPreferencesToDOM();
  });

  bindPref('densitySelect', 'change', (e) => {
    state.prefs.density = e.target.value;
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('radiusRange', 'input', (e) => {
    state.prefs.radius = Number(e.target.value);
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('fontScaleRange', 'input', (e) => {
    state.prefs.fontScale = Number(e.target.value);
    saveStore();
    applyPreferencesToDOM();
  });

  bindPref('optHideViews', 'change', (e) => {
    state.prefs.hideViews = e.target.checked;
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('optHideRelated', 'change', (e) => {
    state.prefs.hideRelated = e.target.checked;
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('optSponsorBlock', 'change', (e) => {
    state.prefs.autoSponsorSkip = e.target.checked;
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('optAutoPlayNext', 'change', (e) => {
    state.prefs.autoPlayNext = e.target.checked;
    saveStore();
    applyPreferencesToDOM();
    syncCustomizeControls();
    if (!state.prefs.autoPlayNext) {
      cancelAutoNextCountdown();
    }
  });

  bindPref('applyCssBtn', 'click', () => {
    state.prefs.customCss = document.getElementById('userCssInput').value || '';
    saveStore();
    applyPreferencesToDOM();
    setStatus('CSS kustom berhasil diterapkan ke tampilan.');
  });

  bindPref('exportThemeBtn', 'click', () => {
    const blob = new Blob([JSON.stringify(state.prefs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'onyxtube-theme.json';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Konfigurasi tampilan diekspor ke onyxtube-theme.json.');
  });

  bindPref('importThemeInput', 'change', (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result));
        if (typeof imported !== 'object' || !imported) throw new Error('JSON tidak valid');
        state.prefs = {
          ...DEFAULT_PREFS,
          ...imported,
          navOrder: Array.isArray(imported.navOrder) ? [...imported.navOrder] : [...DEFAULT_PREFS.navOrder],
          hiddenNavs: Array.isArray(imported.hiddenNavs) ? [...imported.hiddenNavs] : [],
        };
        saveStore();
        applyPreferencesToDOM();
        renderHomeSpotlight(state.feedPaging?.home?.items || []);
        setStatus('Konfigurasi tema berhasil diimpor.');
      } catch (err) {
        setStatus(`Gagal mengimpor tema: ${err.message}`, true);
      }
    };
    reader.readAsText(file);
    ev.target.value = '';
  });

  bindPref('defaultQualitySelect', 'change', (e) => {
    state.prefs.defaultQuality = Number(e.target.value) || 720;
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('defaultSpeedSelect', 'change', (e) => {
    state.prefs.defaultSpeed = Number(e.target.value) || 1;
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('optHideComments', 'change', (e) => {
    state.prefs.hideComments = e.target.checked;
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('optHideShorts', 'change', (e) => {
    state.prefs.hideShorts = e.target.checked;
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('optSbSponsor', 'change', (e) => {
    state.prefs.sbSponsor = e.target.checked;
    saveStore();
  });
  bindPref('optSbSelfpromo', 'change', (e) => {
    state.prefs.sbSelfpromo = e.target.checked;
    saveStore();
  });
  bindPref('optSbIntro', 'change', (e) => {
    state.prefs.sbIntro = e.target.checked;
    saveStore();
  });
  bindPref('optSbOutro', 'change', (e) => {
    state.prefs.sbOutro = e.target.checked;
    saveStore();
  });
  bindPref('optSubsNotify', 'change', (e) => {
    state.prefs.subsNotify = e.target.checked;
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('optAutoUpdateYtdlp', 'change', (e) => {
    state.prefs.autoUpdateYtdlp = e.target.checked;
    saveStore();
    applyPreferencesToDOM();
  });
  bindPref('ytdlpUpdateBtn', 'click', () => {
    refreshYtdlpStatus(true);
  });

  bindPref('exportFullDataBtn', 'click', () => {
    const payload = {
      format: 'onyxtube-freetube-backup-v1',
      exportedAt: new Date().toISOString(),
      prefs: state.prefs,
      subscriptions: state.subscriptions,
      saved: state.saved,
      liked: state.liked,
      history: state.history,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'onyxtube-data-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Semua data, langganan, dan pengaturan diekspor.');
  });

  bindPref('importFullDataInput', 'change', (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result));
        if (Array.isArray(raw.subscriptions)) {
          raw.subscriptions.forEach((sub) => {
            const id = sub.id || sub.channelId;
            const name = sub.name || sub.channelName || 'Channel';
            if (id && !state.subscriptions.some((s) => s.id === id)) {
              state.subscriptions.push({ id, name });
            }
          });
        }
        if (raw.prefs && typeof raw.prefs === 'object') {
          state.prefs = { ...DEFAULT_PREFS, ...raw.prefs };
        }
        if (Array.isArray(raw.saved)) state.saved = raw.saved;
        if (Array.isArray(raw.liked)) state.liked = raw.liked;
        if (Array.isArray(raw.history)) state.history = raw.history;
        saveStore();
        applyPreferencesToDOM();
        updateSidebarBadges();
        setStatus('Data & langganan berhasil diimpor.');
      } catch (err) {
        setStatus(`Gagal mengimpor data: ${err.message}`, true);
      }
    };
    reader.readAsText(file);
    ev.target.value = '';
  });

  bindPref('clearStreamCacheBtn', 'click', () => {
    PREFETCHED_IDS.clear();
    setStatus('Cache stream lokal disegarkan.');
  });

  // FreeTube Settings Category Sidebar & Live Search Filter
  let activeFtCat = 'all';
  const applyFtSettingsFilter = () => {
    const q = (document.getElementById('ftSettingsSearchInput')?.value || '').trim().toLowerCase();
    document.querySelectorAll('#viewCustomize .customize-panel').forEach((panel) => {
      const sec = panel.dataset.ftSection || 'general';
      const catMatch = activeFtCat === 'all' || sec === activeFtCat;
      if (!q) {
        panel.hidden = !catMatch;
        panel.querySelectorAll('.check-row, .control-group').forEach((row) => {
          row.hidden = false;
        });
        return;
      }
      const panelText = (panel.textContent || '').toLowerCase();
      panel.hidden = !panelText.includes(q);
    });
  };

  document.querySelectorAll('#ftSettingsNav .ft-settings-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFtCat = btn.dataset.ftCat || 'all';
      document.querySelectorAll('#ftSettingsNav .ft-settings-nav-btn').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
      });
      applyFtSettingsFilter();
    });
  });

  document.getElementById('ftSettingsSearchInput')?.addEventListener('input', applyFtSettingsFilter);

  bindPref('resetThemeBtn', 'click', () => {
    state.prefs = {
      ...DEFAULT_PREFS,
      navOrder: [...DEFAULT_PREFS.navOrder],
      hiddenNavs: [],
    };
    saveStore();
    applyPreferencesToDOM();
    renderHomeSpotlight(state.feedPaging?.home?.items || []);
    setStatus('Tampilan dikembalikan ke Studio Ink bawaan.');
  });
}

/* --- Keyboard Shortcuts & App Initialization --- */
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'MediaPlayPause' || ev.key === 'AudioPlay' || ev.key === 'AudioPause') {
      if (state.currentVideo) {
        ev.preventDefault();
        document.getElementById('playPauseBtn')?.click();
      }
      return;
    }
    if (ev.key === 'MediaTrackNext') {
      if (state.currentVideo) {
        ev.preventDefault();
        playNextVideo();
      }
      return;
    }
    if (ev.key === 'MediaTrackPrevious') {
      if (state.currentVideo) {
        ev.preventDefault();
        playPreviousVideo();
      }
      return;
    }
    if (ev.key === 'MediaStop') {
      const v = videoEl();
      if (v && !v.paused) {
        ev.preventDefault();
        document.getElementById('playPauseBtn')?.click();
      }
      return;
    }

    const tag = (document.activeElement?.tagName || '').toLowerCase();
    const editing = ['input', 'textarea', 'select'].includes(tag);
    const modal = document.getElementById('shortcutHelpModal');

    if (ev.key === 'Escape') {
      if (modal && !modal.hidden) modal.hidden = true;
      hideSearchSuggestions();
      closeDrawer();
      if (editing) document.activeElement.blur();
      return;
    }

    if (editing) return;

    if (ev.key === '?') {
      ev.preventDefault();
      if (modal) modal.hidden = !modal.hidden;
      return;
    }

    if (ev.key === '/') {
      ev.preventDefault();
      document.getElementById('searchInput').focus();
    } else if (ev.key === '[') {
      ev.preventDefault();
      document.getElementById('sidebarCollapseBtn').click();
    } else if (state.currentView === 'watch' || isMiniPlayerActive()) {
      const k = ev.key.toLowerCase();
      const v = videoEl();
      const a = audioEl();
      if (ev.key === ' ' || k === 'k') {
        ev.preventDefault();
        document.getElementById('playPauseBtn').click();
      } else if (k === 'j') {
        ev.preventDefault();
        document.getElementById('seekBackBtn').click();
      } else if (k === 'l') {
        ev.preventDefault();
        document.getElementById('seekFwdBtn').click();
      } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        ev.preventDefault();
        const delta = ev.key === 'ArrowLeft' ? -5 : 5;
        if (state.playerActions?.requestSkip) {
          state.playerActions.requestSkip(delta);
        }
      } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        const slider = document.getElementById('volumeSlider');
        if (slider) {
          const step = ev.key === 'ArrowUp' ? 0.05 : -0.05;
          const nextVal = Math.max(0, Math.min(1, Number(slider.value) + step));
          slider.value = String(nextVal);
          slider.dispatchEvent(new Event('input'));
          state.playerActions?.showSeekOsd?.(`Volume ${Math.round(nextVal * 100)}%`);
        }
      } else if (/^[0-9]$/.test(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        ev.preventDefault();
        if (v && Number.isFinite(v.duration) && v.duration > 0) {
          const target = (Number(ev.key) / 10) * v.duration;
          if (state.playerActions?.seekAbsolute) {
            state.playerActions.seekAbsolute(target);
          }
        }
      } else if (ev.key === '<' || ev.key === '>') {
        ev.preventDefault();
        const speedSel = document.getElementById('speedSelect');
        if (speedSel && speedSel.options.length > 0) {
          const idx = speedSel.selectedIndex >= 0 ? speedSel.selectedIndex : 2;
          const nextIdx = Math.max(0, Math.min(speedSel.options.length - 1, idx + (ev.key === '>' ? 1 : -1)));
          speedSel.selectedIndex = nextIdx;
          speedSel.dispatchEvent(new Event('change'));
          state.playerActions?.showSeekOsd?.(`Kecepatan ${speedSel.value}x`);
        }
      } else if (k === 'm') {
        ev.preventDefault();
        document.getElementById('muteBtn').click();
      } else if (k === 'i') {
        ev.preventDefault();
        if (isMiniPlayerActive()) {
          switchView('watch');
        } else {
          document.getElementById('miniPlayerBtn')?.click();
        }
      } else if (k === 'c') {
        ev.preventDefault();
        document.getElementById('ccBtn')?.click();
      } else if (k === 't' && state.currentView === 'watch') {
        ev.preventDefault();
        document.getElementById('theaterBtn').click();
      } else if (k === 'p' && ev.shiftKey) {
        ev.preventDefault();
        playPrevVideo();
      } else if (k === 'p') {
        ev.preventDefault();
        document.getElementById('pipBtn').click();
      } else if (k === 'f' && state.currentView === 'watch') {
        ev.preventDefault();
        document.getElementById('fullscreenBtn').click();
      } else if (k === 'n') {
        ev.preventDefault();
        document.getElementById('nextVideoBtn')?.click();
      }
    }
  });
}

function stopAndMuteAllMedia() {
  try {
    const v = typeof videoEl === 'function' ? videoEl() : document.getElementById('videoPlayer');
    const a = typeof audioEl === 'function' ? audioEl() : document.getElementById('audioPlayer');
    [v, a].forEach((m) => {
      if (!m) return;
      m.muted = true;
      m.volume = 0;
      m.pause();
      m.removeAttribute('src');
      m.load();
    });
  } catch {
    // Ignore shutdown cleanup errors cleanly
  }
}

function renderQueueDrawer() {
  const countEl = document.getElementById('queueDrawerCount');
  const listEl = document.getElementById('queueDrawerList');
  const navBtn = document.getElementById('queueDrawerBtn');
  const navLbl = document.getElementById('queueDrawerBtnLabel');
  if (
    (!Array.isArray(state.playQueue) || state.playQueue.length === 0) &&
    state.currentVideo &&
    Array.isArray(state.currentRelated) &&
    state.currentRelated.length > 0
  ) {
    mergeVideosIntoQueue(state.currentRelated, { includeCurrent: true });
  }
  const queue = Array.isArray(state.playQueue) ? state.playQueue : [];

  if (navBtn) navBtn.hidden = queue.length === 0;
  if (navLbl) navLbl.textContent = `Antrean (${queue.length})`;
  if (countEl) countEl.textContent = `${queue.length} video dalam antrean · Tanpa batas`;
  if (!listEl) return;

  listEl.replaceChildren();
  if (queue.length === 0) {
    const p = document.createElement('p');
    p.className = 'sidebar-empty-note';
    p.textContent = 'Belum ada video di antrean putar.';
    listEl.appendChild(p);
    return;
  }

  const frag = document.createDocumentFragment();
  queue.forEach((v, idx) => {
    const row = document.createElement('div');
    row.className = 'queue-item-row';
    if (state.currentVideo && state.currentVideo.id === v.id) {
      row.classList.add('is-current');
    }

    const playArea = document.createElement('div');
    playArea.className = 'queue-item-play';
    const openItem = () => openWatchVideo(v, { queue: state.playQueue });

    const img = document.createElement('img');
    img.className = 'queue-item-thumb';
    img.src = v.thumbnail || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('click', openItem);

    const meta = document.createElement('div');
    meta.className = 'queue-item-meta';
    meta.addEventListener('click', openItem);

    const t = document.createElement('div');
    t.className = 'queue-item-title';
    t.textContent = v.title || 'Video YouTube';
    const ch = document.createElement('div');
    ch.className = 'queue-item-author';
    ch.textContent = v.author || 'Creator';
    meta.append(t, ch);
    playArea.append(img, meta);

    const remBtn = document.createElement('button');
    remBtn.type = 'button';
    remBtn.className = 'queue-item-remove';
    remBtn.textContent = '×';
    remBtn.setAttribute('aria-label', `Hapus ${v.title || 'video'} dari antrean`);
    remBtn.addEventListener('click', () => {
      state.playQueue.splice(idx, 1);
      renderQueueDrawer();
      updateNextVideoUI();
    });

    row.append(playArea, remBtn);
    frag.appendChild(row);
  });
  listEl.appendChild(frag);
}

function initQueueDrawer() {
  const drawer = document.getElementById('queueDrawer');
  const toggleBtn = document.getElementById('queueDrawerBtn');
  const closeBtn = document.getElementById('queueDrawerClose');
  const shuffleBtn = document.getElementById('queueShuffleBtn');
  const clearBtn = document.getElementById('queueClearBtn');

  toggleBtn?.addEventListener('click', () => {
    if (!drawer) return;
    drawer.hidden = !drawer.hidden;
    if (!drawer.hidden) renderQueueDrawer();
  });

  closeBtn?.addEventListener('click', () => {
    if (drawer) drawer.hidden = true;
  });

  shuffleBtn?.addEventListener('click', () => {
    if (!Array.isArray(state.playQueue) || state.playQueue.length < 2) return;
    const curId = state.currentVideo?.id;
    const rest = state.playQueue.filter((item) => item && item.id !== curId);
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    state.playQueue = state.currentVideo ? [state.currentVideo, ...rest] : rest;
    renderQueueDrawer();
    updateNextVideoUI();
  });

  clearBtn?.addEventListener('click', () => {
    state.playQueue = state.currentVideo ? [state.currentVideo] : [];
    renderQueueDrawer();
    updateNextVideoUI();
  });

  const qList = document.getElementById('queueDrawerList');
  const qScrollHost = qList?.closest('.queue-drawer-body') || qList;
  if (qScrollHost) {
    qScrollHost.addEventListener(
      'scroll',
      () => {
        if (qScrollHost.scrollTop + qScrollHost.clientHeight >= qScrollHost.scrollHeight - 180) {
          extendUnlimitedQueue(true);
        }
      },
      { passive: true }
    );
  }

  renderQueueDrawer();
}

function initInfiniteScroll() {
  const targets = [
    { barId: 'homeMoreBar', btnId: 'homeMoreBtn', view: 'home', load: () => loadMoreTrending() },
    { barId: 'searchMoreBar', btnId: 'searchMoreBtn', view: 'search', load: () => loadMoreSearchResults() },
    { barId: 'channelMoreBar', btnId: 'channelMoreBtn', view: 'channel', load: () => loadMoreChannelVideos() },
    { barId: 'commentsMoreBar', btnId: 'commentsMoreBtn', view: 'watch', load: () => loadMoreComments() },
  ];

  targets.forEach((entry) => {
    const btn = document.getElementById(entry.btnId);
    btn?.addEventListener('click', entry.load);
  });

  if (typeof IntersectionObserver !== 'undefined') {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((ioEntry) => {
          if (!ioEntry.isIntersecting) return;
          const match = targets.find((t) => t.barId === ioEntry.target.id);
          if (match && state.currentView === match.view) {
            match.load();
          }
        });
      },
      { root: null, rootMargin: '520px 0px', threshold: 0.01 }
    );
    targets.forEach((entry) => {
      const el = document.getElementById(entry.barId);
      if (el) obs.observe(el);
    });
  }

  let scrollCheckTick = 0;
  window.addEventListener(
    'scroll',
    () => {
      if (scrollCheckTick) return;
      scrollCheckTick = window.setTimeout(() => {
        scrollCheckTick = 0;
        const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 640;
        if (!nearBottom) return;
        const activeTarget = targets.find((t) => {
          if (t.view !== state.currentView) return false;
          const bar = document.getElementById(t.barId);
          return bar && !bar.hidden;
        });
        if (activeTarget) activeTarget.load();
      }, 120);
    },
    { passive: true }
  );
}

function syncNativeThemeBridge() {
  const activeTheme = document.documentElement.getAttribute('data-theme') || 'studio-dark';
  const isLight = activeTheme === 'warm-paper' || activeTheme === 'matcha-cream' || activeTheme === 'sunset-sand';
  try {
    window.webkit?.messageHandlers?.onyxTheme?.postMessage(isLight ? 'light' : 'dark');
  } catch {
    // Berjalan di browser web standar
  }
}

function initApp() {
  loadStore();
  initCustomizeStudio();
  applyPreferencesToDOM();
  syncNativeThemeBridge();
  updateSidebarBadges();
  initPlayerControls();
  initKeyboardShortcuts();
  initQueueDrawer();
  initInfiniteScroll();

  window.addEventListener('pagehide', stopAndMuteAllMedia);
  window.addEventListener('beforeunload', stopAndMuteAllMedia);

  const shellObserver = new MutationObserver(() => {
    syncNavMenuToggleState();
    syncNativeThemeBridge();
  });
  const appShellEl = document.getElementById('appShell');
  if (appShellEl) {
    shellObserver.observe(appShellEl, { attributes: true, attributeFilter: ['class'] });
  }
  shellObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  shellObserver.observe(document.body, { attributes: true, attributeFilter: ['data-nav-layout'] });
  window.addEventListener('resize', syncNavMenuToggleState, { passive: true });
  syncNavMenuToggleState();

  // Left navigation items
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.nav || 'home');
      if (document.getElementById('appShell')?.classList.contains('is-drawer-open')) {
        closeDrawer();
      }
    });
  });

  document.getElementById('brandHomeBtn').addEventListener('click', () => switchView('home'));
  document.getElementById('backBtn').addEventListener('click', () => switchView(state.previousView || 'home'));

  document.getElementById('sidebarCollapseBtn').addEventListener('click', () => {
    state.prefs.sidebarCollapsed = !state.prefs.sidebarCollapsed;
    saveStore();
    applyPreferencesToDOM();
    syncNavMenuToggleState();
  });

  document.getElementById('mobileMenuBtn').addEventListener('click', () => {
    const shell = document.getElementById('appShell');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!shell) return;
    const navLayout = document.body.dataset.navLayout || state.prefs.navLayout || 'sidebar';
    const useDrawerOverlay =
      window.innerWidth <= 780 || navLayout === 'topbar-tabs' || navLayout === 'floating-dock';
    if (useDrawerOverlay) {
      const willOpen = !shell.classList.contains('is-drawer-open');
      shell.classList.toggle('is-drawer-open', willOpen);
      if (backdrop) backdrop.hidden = !willOpen;
    } else if (navLayout === 'compact-rail') {
      shell.classList.toggle('is-rail-expanded');
    } else {
      state.prefs.sidebarCollapsed = !state.prefs.sidebarCollapsed;
      saveStore();
      applyPreferencesToDOM();
    }
    syncNavMenuToggleState();
  });
  document.getElementById('sidebarBackdrop').addEventListener('click', closeDrawer);

  // Shortcut help modal wiring
  const shortcutModal = document.getElementById('shortcutHelpModal');
  document.getElementById('shortcutHelpBtn')?.addEventListener('click', () => {
    if (shortcutModal) shortcutModal.hidden = !shortcutModal.hidden;
  });
  document.getElementById('closeShortcutModalBtn')?.addEventListener('click', () => {
    if (shortcutModal) shortcutModal.hidden = true;
  });
  shortcutModal?.addEventListener('click', (ev) => {
    if (ev.target === shortcutModal) shortcutModal.hidden = true;
  });

  // Search form + live autocomplete wiring
  const searchForm = document.getElementById('searchForm');
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const suggestBox = document.getElementById('searchSuggestBox');
  const suggestList = document.getElementById('searchSuggestList');
  let suggestTimer = 0;
  let suggestAbort = null;
  let suggestIdx = -1;

  const renderSuggestions = (items) => {
    if (!suggestBox || !suggestList) return;
    suggestList.replaceChildren();
    suggestIdx = -1;
    if (!items || items.length === 0) {
      hideSearchSuggestions();
      return;
    }
    const frag = document.createDocumentFragment();
    items.slice(0, 8).forEach((text) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-suggest-item';
      btn.setAttribute('role', 'option');
      btn.textContent = text;
      btn.addEventListener('mousedown', (ev) => ev.preventDefault());
      btn.addEventListener('click', () => {
        searchInput.value = text;
        clearSearchBtn.hidden = false;
        hideSearchSuggestions();
        runSearch(text);
      });
      li.appendChild(btn);
      frag.appendChild(li);
    });
    suggestList.appendChild(frag);
    suggestBox.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
  };

  searchInput.addEventListener('input', () => {
    const val = searchInput.value;
    clearSearchBtn.hidden = val.length === 0;
    clearTimeout(suggestTimer);
    if (suggestAbort) suggestAbort.abort();
    const trimmed = val.trim();
    if (trimmed.length < 2 || /^https?:\/\//i.test(trimmed) || trimmed.includes('youtube.com') || trimmed.includes('youtu.be')) {
      hideSearchSuggestions();
      return;
    }
    suggestTimer = setTimeout(async () => {
      suggestAbort = new AbortController();
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(trimmed)}`, {
          signal: suggestAbort.signal,
        });
        const data = await res.json();
        if (searchInput.value.trim() === trimmed && document.activeElement === searchInput) {
          renderSuggestions(data.suggestions || []);
        }
      } catch {
        // Ignore aborted or transient suggest errors silently
      }
    }, 180);
  });

  searchInput.addEventListener('keydown', (ev) => {
    if (!suggestBox || suggestBox.hidden || !suggestList) return;
    const items = Array.from(suggestList.querySelectorAll('.search-suggest-item'));
    if (items.length === 0) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      suggestIdx = ev.key === 'ArrowDown' ? (suggestIdx + 1) % items.length : (suggestIdx - 1 + items.length) % items.length;
      items.forEach((el, i) => el.classList.toggle('is-active', i === suggestIdx));
      searchInput.value = items[suggestIdx].textContent || '';
    } else if (ev.key === 'Enter' && suggestIdx >= 0) {
      ev.preventDefault();
      const chosen = items[suggestIdx].textContent || searchInput.value;
      hideSearchSuggestions();
      runSearch(chosen);
    }
  });

  document.addEventListener('pointerdown', (ev) => {
    if (searchForm && !searchForm.contains(ev.target)) {
      hideSearchSuggestions();
    }
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearSearchBtn.hidden = true;
    hideSearchSuggestions();
    searchInput.focus();
  });
  searchForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    runSearch(searchInput.value);
  });

  // Search duration filters & Saved/Liked collection tabs
  document.querySelectorAll('#searchFilterBar .segment-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.searchDurationFilter = btn.dataset.duration || 'all';
      renderSearchFilteredResults();
    });
  });

  document.querySelectorAll('#playlistTabs .segment-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.playlistTab = btn.dataset.ptab || 'saved';
      renderSavedView();
    });
  });

  // Topbar quick Light / Dark toggle
  document.getElementById('quickThemeBtn').addEventListener('click', () => {
    const cur = THEME_PRESETS[state.prefs.theme] || THEME_PRESETS['studio-dark'];
    state.prefs.theme = cur.isLight ? 'studio-dark' : 'warm-paper';
    state.prefs.customColors = null;
    saveStore();
    applyPreferencesToDOM();
  });

  // Home category tabs
  document.querySelectorAll('#trendingTabs .segment-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      loadTrendingFeed(tabBtn.dataset.tab || 'all', false);
    });
  });
  document.getElementById('refreshHomeBtn').addEventListener('click', () => loadTrendingFeed(state.activeTab, true));
  document.getElementById('refreshSubsBtn').addEventListener('click', () => loadSubscriptionsFeed());

  document.getElementById('clearSavedBtn').addEventListener('click', () => {
    if (state.playlistTab === 'liked') {
      state.liked = [];
      saveStore();
      renderSavedView();
      setStatus('Daftar Video Disukai dikosongkan.');
    } else {
      state.saved = [];
      saveStore();
      updateSidebarBadges();
      renderSavedView();
      setStatus('Daftar Putar Nanti dikosongkan.');
    }
  });
  document.getElementById('clearHistoryBtn').addEventListener('click', () => {
    state.history = [];
    saveStore();
    renderHistoryView();
    setStatus('Riwayat tontonan dihapus.');
  });

  document.getElementById('subsNotifyBtn')?.addEventListener('click', () => {
    state.prefs.subsNotify = state.prefs.subsNotify === false;
    saveStore();
    applyPreferencesToDOM();
    setStatus(state.prefs.subsNotify ? 'Notifikasi rilisan channel diaktifkan.' : 'Notifikasi rilisan channel dimatikan.');
  });
  document.getElementById('checkSubsUpdatesBtn')?.addEventListener('click', () => {
    checkSubscriptionUpdates({ manual: true });
  });

  const initInstantPlayEnhancements = () => {
    const mountQuickPlay = (containerId, gridId, btnId, label) => {
      const header = document.querySelector(`#${containerId} .view-header`);
      const grid = document.getElementById(gridId);
      if (!header || !grid) return;
      let actions = header.querySelector('.view-header-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'view-header-actions';
        header.appendChild(actions);
      }
      let btn = document.getElementById(btnId);
      if (!btn) {
        btn = document.createElement('button');
        btn.id = btnId;
        btn.type = 'button';
        btn.className = 'btn-primary btn-compact quick-play-cta';
        btn.textContent = label;
        btn.hidden = true;
        btn.addEventListener('click', () => {
          const cards = Array.from(grid.querySelectorAll('.video-card'));
          const queue = cards.map((el) => el._videoObj).filter(Boolean);
          if (queue.length > 0) {
            openWatchVideo(queue[0], { queue });
          }
        });
        actions.prepend(btn);
      }

      const syncGrid = () => {
        const cards = Array.from(grid.querySelectorAll('.video-card')).slice(0, 2);
        const ids = cards.map((c) => c.dataset.videoId || '').filter(Boolean);
        btn.hidden = ids.length === 0;
        if (ids.length > 0) prefetchVideos(ids);
      };
      const obs = new MutationObserver(syncGrid);
      obs.observe(grid, { childList: true });
      syncGrid();
    };

    mountQuickPlay('viewHome', 'homeGrid', 'playFeaturedHomeBtn', 'Putar Langsung');
    mountQuickPlay('viewSearch', 'searchGrid', 'playFirstResultBtn', 'Putar Teratas');

    const relatedList = document.getElementById('relatedList');
    if (relatedList) {
      const relObs = new MutationObserver(() => {
        const relIds = Array.from(relatedList.querySelectorAll('.related-item'))
          .slice(0, 2)
          .map((el) => el.dataset.videoId)
          .filter(Boolean);
        if (relIds.length > 0) prefetchVideos(relIds);
      });
      relObs.observe(relatedList, { childList: true });
    }
  };

  initMediaSession();
  initInstantPlayEnhancements();
  refreshYtdlpStatus(false);
  if (state.subscriptions.length > 0 && state.prefs.subsNotify !== false) {
    setTimeout(() => checkSubscriptionUpdates({ manual: false }), 3500);
  }
  setInterval(() => {
    if (state.subscriptions.length > 0 && state.prefs.subsNotify !== false) {
      checkSubscriptionUpdates({ manual: false });
    }
  }, 600000);
  switchView('home');
  loadTrendingFeed('all', false);
}

window.addEventListener('DOMContentLoaded', initApp);
