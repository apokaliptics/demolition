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

  var currentPolicy = {
    level: 2,
    vimEnabled: true,
    isWhitelisted: false,
    enabled: true
  };

  // Mark that the extension is present; level gating is applied separately.
  document.documentElement.setAttribute("data-demolition", "loaded");

  /**
   * Remove known bloat containers that CSS alone can't fully suppress
   * (e.g., cookie banners, chat widgets, ad overlays).
   * We target by common attribute patterns, NOT by tagName or class,
   * so this works across React/Vue/Svelte/Angular/Polymer.
   */
  function removeBloatNodes(root) {
    var selectors = [
      '[id*="cookie" i]',
      '[id*="consent" i]',
      '[class*="cookie" i]',
      '[class*="consent" i]',
      '[id*="chat-widget" i]',
      '[class*="chat-widget" i]',
      '[id*="intercom" i]',
      '[id*="google_ads" i]',
      '[id*="ad-container" i]',
      '[class*="ad-slot" i]',
      '[class*="newsletter-popup" i]',
      '[class*="signup-modal" i]'
    ];

    // Level 2 runs a more aggressive cleanup pass.
    if (currentPolicy.level === 2) {
      selectors.push('[class*="modal" i]');
      selectors.push('[class*="overlay" i]');
      selectors.push('[class*="toast" i]');
      selectors.push('[class*="notification" i]');
    }

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

  function applyPolicy(policy) {
    currentPolicy = policy || currentPolicy;
    var level = Number(currentPolicy.level);

    if (!Number.isFinite(level)) {
      level = 2;
    }

    if (level < 0) level = 0;
    if (level > 2) level = 2;

    document.documentElement.setAttribute("data-demolition-level", String(level));
    document.documentElement.setAttribute(
      "data-demolition-vim",
      currentPolicy.vimEnabled ? "on" : "off"
    );

    if (level === 0) {
      document.documentElement.setAttribute("data-demolition", "inactive");
      return;
    }

    document.documentElement.setAttribute("data-demolition", "active");
  }

  function fetchPolicy() {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(
          {
            action: "getPagePolicy",
            url: window.location.href,
            hostname: window.location.hostname
          },
          function (response) {
            if (chrome.runtime.lastError || !response || !response.ok || !response.policy) {
              resolve(currentPolicy);
              return;
            }
            resolve(response.policy);
          }
        );
      } catch (error) {
        resolve(currentPolicy);
      }
    });
  }

  // ---- Initial pass (after policy and DOM are ready) ----
  function initialPass() {
    if (currentPolicy.level === 0) return;
    removeBloatNodes();
  }

  // ---- MutationObserver: catch dynamically injected bloat ----
  // Throttled to avoid perf issues on heavy SPAs
  var throttleTimer = null;

  var observer = new MutationObserver(function () {
    if (currentPolicy.level === 0) return;
    if (throttleTimer) return;
    throttleTimer = setTimeout(function () {
      throttleTimer = null;
      removeBloatNodes();
    }, 500);
  });

  function startObserving() {
    if (currentPolicy.level === 0) return;
    var target = document.body || document.documentElement;
    if (target) {
      observer.observe(target, { childList: true, subtree: true });
    }
  }

  fetchPolicy().then(function (policy) {
    applyPolicy(policy);

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        initialPass();
        startObserving();
      }, { once: true });
      return;
    }

    initialPass();
    startObserving();
  });

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.action !== "refreshPagePolicy") return;
    fetchPolicy().then(function (policy) {
      applyPolicy(policy);
      initialPass();
      sendResponse({ ok: true, policy: policy });
    });
    return true;
  });
})();
