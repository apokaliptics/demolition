# Demolition (Filter Gatekeeper)

Hyper-minimalist, text-first Chrome extension (Manifest V3).

## Core Direction
- Keep browsing fast and legible.
- Block cache-heavy bloat early.
- Give per-site control instead of one global nuke.

## Confirmed Features in v0.4
- **Extension UI Dashboard:** Toolbar popup for live status and controls.
- **Domain Whitelist:** Per-domain bypass that fully disables blocking + CSS override (Level 0).
- **Contextual Nuke Levels:**
1. `Level 0` Off / Whitelisted
2. `Level 1` Soft Nuke (block heavy assets, preserve layout)
3. `Level 2` Demolition (full text-mode CSS override)
- **Columnar Content Separation (Level 2):** Grid-based header/main/sidebar lanes with monospace borders to avoid wall-of-links collapse.
- **Vim Navigation (Level 2):** `j/k` scrolling and `f` link hints for mouse-free navigation.
- **YouTube Music Headless Panel (Level 2):** Text queue + current track + local controls (`Space`, `n`, `p`) with video-stream request blocking.
- **Disk Space Saved Counter:** Session estimator based on blocked request classes.
- **Auto Purge on Tab Close (Opt-In, Per Domain):** Clears origin-scoped data (`cookies`, `localStorage`, `indexedDB`, `cacheStorage`, etc.) when enabled.
- **Text-Only Search Integration:** Popup DuckDuckGo HTML search renderer.
- **Roblox Protocol Bypass:** Launches `roblox-player://` directly and closes the tab.
- **Netflix Text List Mode:** Level 2 scraper that renders a links-only catalog view.

## Dashboard Usage
1. Click the Demolition toolbar icon.
2. Choose the active domain's nuke level (`L0/L1/L2`).
3. Toggle whitelist, auto purge, and vim behavior.
4. Watch live blocked-request and MB-saved counters.
5. Use the search panel for text-only result pages.

## Installation
1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer Mode**.
4. Click **Load unpacked** and select this folder.

## Notes and Constraints
- Dynamic request blocking is managed at runtime by `background.js` using `declarativeNetRequest.updateDynamicRules`.
- Session savings are heuristic estimates, not filesystem-level measurements.
- Auto purge is origin-scoped and disabled by default.
- No global HTTP cache wipe is performed.

## Technical Layout
- `manifest.json`: MV3 setup, permissions, popup action, content scripts.
- `background.js`: settings schema, dynamic rules, counters, tab close purge, messaging API.
- `popup.html` / `popup.css` / `popup.js`: central dashboard.
- `content.js`: per-page policy resolution + level application markers.
- `nuke.css`: level-aware CSS model and Level 2 columnar rendering.
- `vim.js`: Level 2 keyboard navigation + link hints.
- `ytmusic.js`: YouTube Music headless overlay and controls.
- `netflix.js`: Netflix text scraper.
- `roblox.js`: Roblox protocol launcher bridge.
