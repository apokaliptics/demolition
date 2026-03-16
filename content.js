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

  var STYLE_ID = "demolition-cosmetic-style";
  var MAX_PENDING_NODES = 1200;
  var MAX_DESCENDANT_SCAN = 300;

  var currentPolicy = {
    level: 2,
    vimEnabled: true,
    isWhitelisted: false,
    enabled: true,
    cosmeticFiltering: {
      hideSelectors: [],
      preserveSelectors: [],
      throttleMs: 500
    }
  };

  // Mark that the extension is present; level gating is applied separately.
  document.documentElement.setAttribute("data-demolition", "loaded");

  function getCosmeticSettings() {
    var policy = currentPolicy.cosmeticFiltering || {};
    return {
      hideSelectors: Array.isArray(policy.hideSelectors) ? policy.hideSelectors : [],
      preserveSelectors: Array.isArray(policy.preserveSelectors) ? policy.preserveSelectors : [],
      throttleMs: Number.isFinite(Number(policy.throttleMs)) ? Number(policy.throttleMs) : 500
    };
  }

  function styleNode() {
    var node = document.getElementById(STYLE_ID);
    if (node) return node;

    node = document.createElement("style");
    node.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(node);
    return node;
  }

  function cssForSelectors(hideSelectors, preserveSelectors) {
    if (!hideSelectors.length) return "";

    var chunks = [];
    chunks.push(
      hideSelectors.join(",\n") +
        " {" +
        "display: none !important;" +
        "visibility: hidden !important;" +
        "height: 0 !important;" +
        "width: 0 !important;" +
        "overflow: hidden !important;" +
        "position: absolute !important;" +
        "pointer-events: none !important;" +
        "}"
    );

    if (preserveSelectors.length) {
      chunks.push(
        preserveSelectors.join(",\n") +
          " {" +
          "display: block !important;" +
          "visibility: visible !important;" +
          "height: auto !important;" +
          "width: auto !important;" +
          "overflow: visible !important;" +
          "opacity: 1 !important;" +
          "pointer-events: auto !important;" +
          "position: static !important;" +
          "}"
      );
    }

    return chunks.join("\n");
  }

  function applyCosmeticStyles() {
    var cosmetic = getCosmeticSettings();
    var css = currentPolicy.level === 0 ? "" : cssForSelectors(cosmetic.hideSelectors, cosmetic.preserveSelectors);
    styleNode().textContent = css;
  }

  function clearCosmeticRuntimeState() {
    pendingNodes.length = 0;
    fullRescanRequested = false;
    pendingNodeSet = new WeakSet();
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
  }

  function isPreserved(node, preserveSelectors) {
    if (!node || !node.matches || !preserveSelectors.length) return false;

    for (var i = 0; i < preserveSelectors.length; i++) {
      var selector = preserveSelectors[i];
      if (node.matches(selector)) return true;
      if (node.closest(selector)) return true;
      if (node.querySelector && node.querySelector(selector)) return true;
    }

    return false;
  }

  function hideNodeFallback(node, hideSelectors, preserveSelectors, combinedHideSelector) {
    if (!node || node.nodeType !== 1 || !node.matches) return;
    if (isPreserved(node, preserveSelectors)) return;

    for (var i = 0; i < hideSelectors.length; i++) {
      if (node.matches(hideSelectors[i])) {
        node.style.setProperty("display", "none", "important");
        node.style.setProperty("visibility", "hidden", "important");
        node.style.setProperty("height", "0", "important");
        node.style.setProperty("width", "0", "important");
        node.style.setProperty("overflow", "hidden", "important");
        node.style.setProperty("position", "absolute", "important");
        node.style.setProperty("pointer-events", "none", "important");
        return;
      }
    }

    if (!hideSelectors.length || !combinedHideSelector) return;
    var descendants = node.querySelectorAll ? node.querySelectorAll(combinedHideSelector) : [];
    var limit = Math.min(descendants.length, MAX_DESCENDANT_SCAN);
    for (var j = 0; j < limit; j++) {
      if (isPreserved(descendants[j], preserveSelectors)) continue;
      descendants[j].style.setProperty("display", "none", "important");
      descendants[j].style.setProperty("visibility", "hidden", "important");
      descendants[j].style.setProperty("height", "0", "important");
      descendants[j].style.setProperty("width", "0", "important");
      descendants[j].style.setProperty("overflow", "hidden", "important");
      descendants[j].style.setProperty("position", "absolute", "important");
      descendants[j].style.setProperty("pointer-events", "none", "important");
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
      applyCosmeticStyles();
      clearCosmeticRuntimeState();
      return;
    }

    document.documentElement.setAttribute("data-demolition", "active");
    applyCosmeticStyles();
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
    var cosmetic = getCosmeticSettings();
    var combined = cosmetic.hideSelectors.length ? cosmetic.hideSelectors.join(", ") : "";
    hideNodeFallback(document.documentElement, cosmetic.hideSelectors, cosmetic.preserveSelectors, combined);
  }

  // ---- MutationObserver: catch dynamically injected bloat ----
  // Throttled to avoid perf issues on heavy SPAs
  var throttleTimer = null;
  var pendingNodes = [];
  var pendingNodeSet = new WeakSet();
  var fullRescanRequested = false;

  var observer = new MutationObserver(function (mutations) {
    if (currentPolicy.level === 0) return;

    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes || [];
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (!node || node.nodeType !== 1) continue;
        if (pendingNodeSet.has(node)) continue;

        pendingNodeSet.add(node);
        pendingNodes.push(node);

        if (pendingNodes.length >= MAX_PENDING_NODES) {
          fullRescanRequested = true;
          pendingNodes.length = 0;
          pendingNodeSet = new WeakSet();
          break;
        }
      }
      if (fullRescanRequested) break;
    }

    if (throttleTimer) return;

    var cosmetic = getCosmeticSettings();
    throttleTimer = setTimeout(function () {
      throttleTimer = null;
      var combined = cosmetic.hideSelectors.length ? cosmetic.hideSelectors.join(", ") : "";

      if (fullRescanRequested) {
        fullRescanRequested = false;
        hideNodeFallback(document.documentElement, cosmetic.hideSelectors, cosmetic.preserveSelectors, combined);
        clearCosmeticRuntimeState();
        return;
      }

      var nodes = pendingNodes.splice(0, pendingNodes.length);
      pendingNodeSet = new WeakSet();
      for (var k = 0; k < nodes.length; k++) {
        hideNodeFallback(nodes[k], cosmetic.hideSelectors, cosmetic.preserveSelectors, combined);
      }
    }, cosmetic.throttleMs);
  });

  function startObserving() {
    clearCosmeticRuntimeState();
    observer.disconnect();
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
      startObserving();
      sendResponse({ ok: true, policy: policy });
    });
    return true;
  });
})();
