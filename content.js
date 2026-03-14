/* ===========================================================
   DEMOLITION — content.js
   Universal DOM janitor. Runs on every page at document_start.

   DESIGN PHILOSOPHY:
   The CSS nuke (nuke.css) handles ALL visual overrides via
   !important. This script does NOT touch stylesheets or inline
   styles — doing so breaks SPA frameworks (React, Vue, Svelte,
   Angular, Polymer/Lit, etc.) that rely on computed styles for
   layout calculations and hydration.

   This script ONLY handles:
   1. Setting a marker attribute so other scripts know we're active
   2. Cleaning up text content (removing empty visual-only nodes)
   =========================================================== */

(function () {
  "use strict";

  // Mark the document so our other scripts can detect Demolition
  document.documentElement.setAttribute("data-demolition", "active");

  /**
   * Remove known bloat containers that CSS alone can't fully suppress
   * (e.g., cookie banners, chat widgets, ad overlays).
   * We target by common attribute patterns, NOT by tagName or class,
   * so this works across React/Vue/Svelte/Angular/Polymer.
   */
  function removeBloatNodes(root) {
    var selectors = [
      // Cookie / consent banners
      '[id*="cookie" i]',
      '[id*="consent" i]',
      '[class*="cookie" i]',
      '[class*="consent" i]',
      // Chat widgets
      '[id*="chat-widget" i]',
      '[class*="chat-widget" i]',
      '[id*="intercom" i]',
      // Ad containers
      '[id*="google_ads" i]',
      '[id*="ad-container" i]',
      '[class*="ad-slot" i]',
      // Newsletter / signup popups
      '[class*="newsletter-popup" i]',
      '[class*="signup-modal" i]'
    ];

    var combined = selectors.join(", ");

    try {
      var nodes = (root || document).querySelectorAll(combined);
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].style.setProperty("display", "none", "important");
        nodes[i].style.setProperty("visibility", "hidden", "important");
        nodes[i].style.setProperty("height", "0", "important");
        nodes[i].style.setProperty("width", "0", "important");
        nodes[i].style.setProperty("overflow", "hidden", "important");
        nodes[i].style.setProperty("position", "absolute", "important");
        nodes[i].style.setProperty("pointer-events", "none", "important");
      }
    } catch (e) {
      // Silently fail — never crash the page
    }
  }

  // ---- Initial pass (after DOM is ready) ----
  function initialPass() {
    removeBloatNodes();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialPass, { once: true });
  } else {
    initialPass();
  }

  // ---- MutationObserver: catch dynamically injected bloat ----
  // Throttled to avoid perf issues on heavy SPAs
  var throttleTimer = null;

  var observer = new MutationObserver(function () {
    if (throttleTimer) return;
    throttleTimer = setTimeout(function () {
      throttleTimer = null;
      removeBloatNodes();
    }, 500);
  });

  function startObserving() {
    var target = document.body || document.documentElement;
    if (target) {
      observer.observe(target, { childList: true, subtree: true });
    }
  }

  if (document.body) {
    startObserving();
  } else {
    document.addEventListener("DOMContentLoaded", startObserving, { once: true });
  }
})();
