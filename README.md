# Demolition (Filter Gatekeeper)

Hyper-minimalist, text-first "universal client" extension for Chrome (Manifest V3).

## Goals
- **Request Blocking (C-Drive Protection):** Blocks non-essential assets (images, media, fonts, objects) at the network level using `declarativeNetRequest` before they hit the browser cache.
- **Universal UI Nuke:** Overrides all existing CSS with a monospace, high-contrast, text-only "Foobar Look" stylesheet.
- **Roblox Protocol Bypass:** Detects Roblox game pages, extracts `placeId`, launches the `roblox-player://` URI scheme directly, and closes the browser tab.
- **Netflix Scraper:** Replaces high-res poster grids with simple text-link lists using resilient DOM selectors.
- **SPA Compatibility:** Designed to work with modern frameworks (React, Vue, Svelte, etc.) by using CSS `!important` declarations rather than destructive DOM manipulation that crashes hydration.

## Features
- **Pure Vanilla JS:** Zero dependencies. "Arch-Linux-Tier" efficiency.
- **Resilient Selectors:** Uses `data-uia` and ARIA attributes for scraping to ensure longevity against obfuscated CSS classes.
- **Minimal Footprint:** Optimized JSON rulesets and minimal script payload.

## Installation
1. Download or clone this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer Mode** in the top-right corner.
4. Click **Load unpacked** and select the folder containing these files.

## Technical Details
- `manifest.json`: Manifest V3 configuration.
- `rules.json`: declarativeNetRequest rules for blocking bloat.
- `nuke.css`: The "Global Reset" stylesheet.
- `content.js`: Universal DOM janitor and bloat-node remover.
- `netflix.js`: Site-specific scraper for Netflix.
- `roblox.js`: Protocol bypass for Roblox.
- `background.js`: Service worker for tab management.
