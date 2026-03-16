/* ===========================================================
   DEMOLITION — youtube.js
   Lightweight YouTube ad interaction helper.
   Keeps runtime work small and only reacts to ad UI state.
   =========================================================== */

(function () {
  "use strict";

  var SKIP_SELECTORS = [
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-slot button"
  ];

  var AD_STATE_SELECTORS = [
    ".video-ads",
    ".ad-showing"
  ];

  function isElementVisible(el) {
    if (!el) return false;
    if (!(el instanceof HTMLElement)) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function hasAdSurface() {
    for (var i = 0; i < AD_STATE_SELECTORS.length; i++) {
      var node = document.querySelector(AD_STATE_SELECTORS[i]);
      if (node && isElementVisible(node)) return true;
    }
    return false;
  }

  function clickSkipButton() {
    for (var i = 0; i < SKIP_SELECTORS.length; i++) {
      var button = document.querySelector(SKIP_SELECTORS[i]);
      if (button && isElementVisible(button)) {
        button.click();
        return true;
      }
    }
    return false;
  }

  function maybeSkip() {
    if (!hasAdSurface()) return;
    clickSkipButton();
  }

  var observer = new MutationObserver(function () {
    maybeSkip();
  });

  function start() {
    var target = document.body || document.documentElement;
    if (!target) return;
    observer.observe(target, { childList: true, subtree: true, attributes: true });
    maybeSkip();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.addEventListener("yt-navigate-finish", maybeSkip, true);
})();
