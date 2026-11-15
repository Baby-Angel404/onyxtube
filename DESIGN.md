# OnyxTube Desktop: Direction & Design Spec

antislop active: during (global preference).

## 1. Design Read & Identity

`Design Read`: Focused charcoal studio desktop shell built around a quiet matte grid, rectilinear surfaces separated by hairline contrast, and a single crisp vermilion action accent so the video frame stays undisturbed.

OnyxTube is a native Linux desktop video client built on GTK3 + WebKit2GTK (`2.54.2`). It avoids SaaS landing-page templates, floating glass overlays, glowing neon borders, and YouTube iframe branding. Launch opens directly into a FreeTube-style media workspace: a fixed left navigation rail (`Beranda`, `Langganan`, `Playlist`, `Riwayat`, `Kustomisasi`) and an immediate real video feed grid.

## 2. Liveliness Dials (antislop Part 3)

- `ENERGY: 2` (Measured): Calm studio workstation rhythm with clear visual hierarchy and generous negative space.
- `RHYTHM: 2` (Steady): Consistent 220px left rail (collapsible to 64px), 52px top command bar, clean 16:9 media grid on discovery views, and asymmetric two-column Watch workspace (primary stage + Up Next rail).
- `MOTION: 1` (Restrained): 120ms ease-out state transitions strictly for hover, active selection, and focus feedback (R-19). Zero continuous pulse, bounce, or floating loops. Respects `prefers-reduced-motion: reduce`.

## 3. Color System (Verified WCAG AA)

### Default Dark Mode: `Studio Ink` (`studio-dark`)
- `--color-bg`: `#121316` (16.58:1 against primary text)
- `--color-sidebar`: `#16181c` (7.80:1 against muted text)
- `--color-surface`: `#1b1d23` (15.04:1 against primary text, 7.39:1 against muted text)
- `--color-surface-elevated`: `#22252d` (13.68:1 against primary text)
- `--color-border`: `#2e323c`
- `--color-border-input`: `#6e7584` (3.64:1 against surface, WCAG 1.4.11 UI border compliant)
- `--color-text`: `#f1f2f4`
- `--color-text-muted`: `#a6acb8`
- `--color-accent`: `#c0321b` (Matte Vermilion, `#ffffff` on accent = 5.66:1)
- `--color-accent-text`: `#ff7b61` (6.62:1 against surface)
- `--color-sponsor`: `#34d399` (8.76:1 against surface)
- `--color-danger`: `#f87171` (6.09:1 against surface)

### Light Mode: `Warm Paper` (`warm-paper`)
- `--color-bg`: `#f5f4f0` (15.97:1 against primary text)
- `--color-sidebar`: `#eceae4` (6.39:1 against muted text)
- `--color-surface`: `#ffffff` (17.58:1 against primary text, 7.68:1 against muted text)
- `--color-surface-elevated`: `#e5e2db`
- `--color-border`: `#d1cdc4`
- `--color-border-input`: `#76736a` (4.74:1 against surface)
- `--color-text`: `#18191c`
- `--color-text-muted`: `#50535c`
- `--color-accent`: `#b82812` (`#ffffff` on accent = 6.27:1)
- `--color-accent-text`: `#b82812` (5.70:1 against bg, 6.27:1 against surface)
- `--color-sponsor`: `#157f4b` (5.04:1 against surface)
- `--color-danger`: `#b91c1c` (6.47:1 against surface)

## 4. Layout & Antislop Architectural Locks

- **R-01 / R-09**: Zero purple-black gradients (`#7c3aed` removed), zero glowing cards, zero decorative badge pills above headings.
- **R-10**: Zero `backdrop-filter` glassmorphism slabs; surfaces separate cleanly through tonal step and 1px hairline borders.
- **R-11 / R-12 / R-13**: Rectangular radii (`6px` cards, `6px` controls, `4px` segmented filter tabs). Card elevation stays flat (`box-shadow: none`) until hover focus (`1px` border highlight).
- **R-04**: One cohesive geometric SVG stroke icon set (`stroke-width="1.75"`), zero emoji in buttons or nav labels.
- **R-24 / R-26 / R-27**: Every sidebar item, feed tab, subscribe button, playlist queue action, and player control performs its real local action; loading, empty, and error states describe cause and next action.
- **Native Playback Purity**: Zero `youtube.com` or `youtube-nocookie.com` iframe embeds. Streams resolve locally via `/api/stream` (`yt-dlp`) and stream cleanly through `/api/media` range proxy into a native HTML5 `<video>` element with custom desktop controls and SponsorBlock timeline markers.
