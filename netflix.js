/* ===========================================================
   DEMOLITION — netflix.js
   Netflix DOM Scraper / Text-List Replacer.
   Runs on *://*.netflix.com/*
   Replaces poster grids with flat monospace text-link lists.
   =========================================================== */

(function () {
  "use strict";

  // Netflix text replacement is reserved for full demolition mode.
  if (document.documentElement.getAttribute("data-demolition-level") !== "2") return;

  // Don't run on the player page — let the user watch
  if (/\/watch\//.test(window.location.pathname)) return;

  const SCRAPE_DEBOUNCE_MS = 800;
  let debounceTimer = null;
  let lastTitleCount = 0;

  /**
   * Multi-strategy title extraction.
   * Netflix obfuscates CSS classes, so we use stable attributes:
   *   1. data-uia attributes (Netflix internal QA hooks — most stable)
   *   2. <a href="/watch/..."> links (functional, always present)
   *   3. <a href="/title/..."> links (browse pages)
   *   4. ARIA roles and labels
   *   5. Structural: divs inside lolomos / slider rows
   */
  function scrapeTitles() {
    const titles = new Map(); // href -> { title, href, watchUrl }

    // ---- Strategy 1: data-uia based selectors ----
    // Netflix uses data-uia="title-card" or similar on browse page items
    const uiaCards = document.querySelectorAll(
      '[data-uia*="title-card"], [data-uia*="slider-item"], [data-uia*="hero"]'
    );
    uiaCards.forEach(function (card) {
      extractFromContainer(card, titles);
    });

    // ---- Strategy 2: Direct /watch/ links ----
    const watchLinks = document.querySelectorAll('a[href*="/watch/"]');
    watchLinks.forEach(function (link) {
      const href = link.getAttribute("href");
      const id = href.match(/\/watch\/(\d+)/);
      if (!id) return;

      const label =
        link.getAttribute("aria-label") ||
        link.textContent.trim() ||
        link.closest("[aria-label]")?.getAttribute("aria-label") ||
        "Untitled (" + id[1] + ")";

      const key = id[1];
      if (!titles.has(key)) {
        titles.set(key, {
          title: cleanTitle(label),
          watchUrl: "https://www.netflix.com/watch/" + id[1],
          id: id[1]
        });
      }
    });

    // ---- Strategy 3: /title/ links (browse pages) ----
    const titleLinks = document.querySelectorAll('a[href*="/title/"]');
    titleLinks.forEach(function (link) {
      const href = link.getAttribute("href");
      const id = href.match(/\/title\/(\d+)/);
      if (!id) return;

      const label =
        link.getAttribute("aria-label") ||
        link.textContent.trim() ||
        link.closest("[aria-label]")?.getAttribute("aria-label") ||
        "Untitled (" + id[1] + ")";

      const key = "t" + id[1];
      if (!titles.has(key)) {
        titles.set(key, {
          title: cleanTitle(label),
          watchUrl: "https://www.netflix.com/title/" + id[1],
          id: id[1]
        });
      }
    });

    // ---- Strategy 4: ARIA-labeled list items ----
    const ariaItems = document.querySelectorAll(
      '[role="listitem"][aria-label], [role="link"][aria-label]'
    );
    ariaItems.forEach(function (item) {
      extractFromContainer(item, titles);
    });

    // ---- Strategy 5: Row-based fallback ----
    // Netflix "lolomo" rows contain slider items
    const rows = document.querySelectorAll(
      '.lolomoRow, [class*="row"], [class*="Row"], [data-list-context]'
    );
    rows.forEach(function (row) {
      const links = row.querySelectorAll("a[href]");
      links.forEach(function (link) {
        extractFromContainer(link, titles);
      });
    });

    return Array.from(titles.values());
  }

  /**
   * Extract title info from a container element.
   */
  function extractFromContainer(container, titlesMap) {
    // Find any link with a watchable URL
    const links = container.querySelectorAll
      ? container.querySelectorAll('a[href*="/watch/"], a[href*="/title/"]')
      : [];

    const fallbackLink = container.tagName === "A" ? container : null;
    const allLinks = links.length ? links : fallbackLink ? [fallbackLink] : [];

    allLinks.forEach(function (link) {
      const href = link.getAttribute("href") || "";
      const watchMatch = href.match(/\/watch\/(\d+)/);
      const titleMatch = href.match(/\/title\/(\d+)/);

      if (!watchMatch && !titleMatch) return;

      const id = (watchMatch || titleMatch)[1];
      const isWatch = !!watchMatch;

      // Gather the best title text available
      const label =
        container.getAttribute("aria-label") ||
        link.getAttribute("aria-label") ||
        container.querySelector("p, span, h3, h2, [class*='title'], [class*='Title']")?.textContent?.trim() ||
        link.textContent.trim() ||
        "Untitled (" + id + ")";

      const key = (isWatch ? "w" : "t") + id;
      if (!titlesMap.has(key)) {
        titlesMap.set(key, {
          title: cleanTitle(label),
          watchUrl: isWatch
            ? "https://www.netflix.com/watch/" + id
            : "https://www.netflix.com/title/" + id,
          id: id
        });
      }
    });
  }

  /**
   * Clean up title text (remove duplication, noise, etc.)
   */
  function cleanTitle(raw) {
    if (!raw) return "Untitled";
    // Remove "Play", leading/trailing whitespace, repeated words
    return raw
      .replace(/^Play\s+/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 120); // cap length
  }

  /**
   * Render the scraped titles as a flat text-link list.
   */
  function renderTextList(titles) {
    // Build the replacement DOM
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-demolition", "netflix");
    wrapper.style.cssText =
      "background:#0a0a0a;color:#c0c0c0;font-family:monospace;" +
      "padding:40px 20px;max-width:960px;margin:0 auto;" +
      "font-size:13px;line-height:1.6;";

    // Header
    const header = document.createElement("pre");
    header.style.cssText = "color:#00ff41;margin-bottom:20px;";
    header.textContent =
      "╔══════════════════════════════════════╗\n" +
      "║  DEMOLITION — Netflix Text Mode      ║\n" +
      "╚══════════════════════════════════════╝\n\n" +
      "  " + titles.length + " titles found.\n" +
      "  Click any title to play.\n";
    wrapper.appendChild(header);

    // Separator
    const sep = document.createElement("hr");
    sep.style.cssText = "border:none;border-top:1px solid #333;margin:16px 0;";
    wrapper.appendChild(sep);

    if (titles.length === 0) {
      const empty = document.createElement("p");
      empty.style.color = "#666";
      empty.textContent =
        "No titles scraped. This page may require scrolling, or Netflix may have updated their DOM structure.";
      wrapper.appendChild(empty);
    } else {
      // Title list
      const list = document.createElement("ol");
      list.style.cssText =
        "list-style:decimal;padding-left:32px;margin:0;";

      titles.forEach(function (item, idx) {
        const li = document.createElement("li");
        li.style.cssText = "margin-bottom:6px;";

        const link = document.createElement("a");
        link.href = item.watchUrl;
        link.textContent = item.title;
        link.style.cssText =
          "color:#00ff41;text-decoration:underline;cursor:pointer;";
        link.title = "ID: " + item.id;

        const idSpan = document.createElement("span");
        idSpan.textContent = "  [" + item.id + "]";
        idSpan.style.cssText = "color:#555;font-size:11px;";

        li.appendChild(link);
        li.appendChild(idSpan);
        list.appendChild(li);
      });

      wrapper.appendChild(list);
    }

    // Footer
    const footer = document.createElement("pre");
    footer.style.cssText =
      "color:#333;margin-top:24px;font-size:11px;";
    footer.textContent =
      "── Demolition v0.1.0 ──";
    wrapper.appendChild(footer);

    return wrapper;
  }

  /**
   * Replace the page body with our text list.
   */
  function replacePage(titles) {
    // Don't replace if we already rendered and count is the same
    if (titles.length === lastTitleCount && document.querySelector("[data-demolition='netflix']")) {
      return;
    }
    lastTitleCount = titles.length;

    const list = renderTextList(titles);

    // Nuke body content
    document.body.innerHTML = "";
    document.body.style.cssText =
      "background:#0a0a0a !important;margin:0;padding:0;";
    document.body.appendChild(list);

    // Update page title
    document.title = "DEMOLITION — Netflix (" + titles.length + " titles)";
  }

  /**
   * Main scrape-and-replace pass, debounced.
   */
  function run() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      const titles = scrapeTitles();
      replacePage(titles);
    }, SCRAPE_DEBOUNCE_MS);
  }

  // ---- Initial pass ----
  // Netflix loads content dynamically, so we wait a moment for initial data
  setTimeout(run, 1500);

  // ---- Watch for infinite scroll / dynamic content ----
  const observer = new MutationObserver(function () {
    run();
  });

  // Observe the body for new child nodes (Netflix lazy-loads rows)
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
      run();
    }, { once: true });
  }

  // Also re-scrape on navigation (Netflix SPA uses History API)
  let lastUrl = window.location.href;
  setInterval(function () {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      // Don't run on player pages
      if (!/\/watch\//.test(window.location.pathname)) {
        lastTitleCount = 0; // force re-render
        run();
      }
    }
  }, 1000);
})();
