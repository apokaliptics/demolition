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

## Credit
- Made by Kiet Minh (Apocalypse).

## Notes and Constraints
- Dynamic request blocking is managed at runtime by `background.js` using `declarativeNetRequest.updateDynamicRules`.
- Static DNR ruleset files in `rules/` are runtime-enabled by `background.js` when Demolition is enabled.
- Whitelist/Level-0 domains are protected with high-priority session `allowAllRequests` overrides so static + dynamic blocking both bypass those hosts.
- Session savings are heuristic estimates, not filesystem-level measurements.
- Auto purge is origin-scoped and disabled by default.
- No global HTTP cache wipe is performed.

## Filter Compiler (Rust)
- A Rust scaffold is available at `tools/filter-compiler-rs` for compiling ABP-style lists into MV3 DNR JSON.
- Current stage supports:
1. Basic URL blocking patterns (including `||example.com^`)
2. Resource type mapping (`script`, `image`, `xmlhttprequest`, etc.)
3. Deterministic unique ID assignment (`--start-id`)
4. Static rule cap enforcement (`--max-static-rules`, default 30000)

Example usage:
```bash
cd tools/filter-compiler-rs
cargo run -- --input ../../rules.txt --output ../../rules/core-network.json --max-static-rules 30000 --start-id 1
```

Parser mode options:
```bash
# Native parser path (default)
cargo run -- --input ../../rules.txt --output ../../rules/core-network.json --parser-mode native

# adblock-rust parser bridge (build-time feature)
cargo run --features adblock-bridge -- --input ../../rules.txt --output ../../rules/core-network.json --parser-mode adblock
```

Optional overflow outputs (for rules that exceed --max-static-rules):
```bash
cargo run -- --input ../../rules.txt --output ../../rules/core-network.json \
	--max-static-rules 30000 \
	--overflow-output ../../rules/core-network.overflow.json \
	--overflow-chunk-size 5000
```

This writes:
1. A metadata file at `--overflow-output`
2. Chunk files next to it (for example `core-network.overflow.chunk1.json`) with deterministic continuation IDs

Build large out-of-the-box rules from major public lists:
```powershell
./tools/build-rules.ps1
```

This script downloads EasyList and EasyPrivacy into `rules/lists/`, then compiles:
1. `rules/core-network.json`
2. `rules/core-privacy.json`

Optional flags:
```powershell
# Raise/lower static cap
./tools/build-rules.ps1 -MaxStaticRules 30000

# Use adblock-rust parser bridge
./tools/build-rules.ps1 -UseAdblockBridge
```

After building, reload the extension in `chrome://extensions` to apply updated static rules.

Run compiler tests:
```bash
cd tools/filter-compiler-rs

# Unit + golden fixture tests (native mode)
cargo test

# Unit + golden fixture tests with adblock bridge parity checks
cargo test --features adblock-bridge
```

## Technical Layout
- `manifest.json`: MV3 setup, permissions, popup action, content scripts.
- `background.js`: settings schema, dynamic rules, counters, tab close purge, messaging API.
- `popup.html` / `popup.css` / `popup.js`: central dashboard.
- `content.js`: per-page policy resolution + level application markers.
- `nuke.css`: level-aware CSS model and Level 2 columnar rendering.
- `vim.js`: Level 2 keyboard navigation + link hints.
- `youtube.js`: lightweight YouTube ad skip helper for dynamic ad UI surfaces.
- `ytmusic.js`: YouTube Music headless overlay and controls.
- `netflix.js`: Netflix text scraper.
- `rules/`: static ruleset JSON files for MV3 DNR `rule_resources`.
- `tools/filter-compiler-rs`: ABP-to-DNR compiler scaffold.

## Manual Verification Matrix
Use the popup Runtime Rules line (`Rules: ...`) to confirm layer state while testing.

1. Extension Disabled
1. Toggle Extension Enabled off in popup.
2. Expected Runtime Rules line: `ext=off`, `static=0`, `dyn=0`, `sess=0`, `status=ok`.
3. Expected behavior: No Demolition network blocking/cosmetic filtering on reload.

2. Extension Enabled, Normal Domain
1. Toggle Extension Enabled on.
2. Visit a non-whitelisted domain at Level 1 or 2.
3. Expected Runtime Rules line: `ext=on`, `static>=1`, `dyn>0`, `status=ok`.
4. Expected behavior: Blocking and cosmetic filtering active.

3. Whitelisted or Explicit Level-0 Domain
1. On a test domain, enable Whitelist or set level to L0.
2. Expected Runtime Rules line: `sess>=1`, `excl>=1`, `status=ok`.
3. Expected behavior: Domain bypasses static + dynamic blocking via session `allowAllRequests` rule.
