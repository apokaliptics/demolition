/* ===========================================================
   DEMOLITION — youtube.js
   YouTube runtime hardening for player interruptions and ad payloads.
   =========================================================== */

(function () {
  "use strict";

  if (window.__demolitionYouTubePatched__) return;
  window.__demolitionYouTubePatched__ = true;

  var INTERRUPTION_TEXT_PATTERNS = [
    "interruption",
    "interruptions",
    "service terms",
    "terms of service",
    "before you continue",
    "review our terms",
    "ad blockers are not allowed",
    "ads allow youtube"
  ];

  var BLOCKING_UI_SELECTORS = [
    "tp-yt-paper-dialog",
    "ytd-enforcement-message-view-model",
    "ytd-popup-container",
    "yt-mealbar-promo-renderer",
    "ytd-consent-bump-v2-lightbox",
    "ytd-banner-promo-renderer",
    "[role='dialog']",
    ".ytd-enforcement-message-view-model",
    ".opened",
    ".yt-confirm-dialog-renderer"
  ];

  var NAVIGATION_EVENTS = [
    "yt-navigate-finish",
    "yt-page-data-updated",
    "spfdone",
    "popstate"
  ];

  var DEV_MODE = detectDevelopmentMode();
  var observer = null;
  var originalFetch = null;

  function detectDevelopmentMode() {
    try {
      if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
        return true;
      }
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest) {
        var manifest = chrome.runtime.getManifest();
        return !manifest.update_url;
      }
    } catch (_) {}
    return false;
  }

  function debugLog() {
    if (!DEV_MODE) return;
    try {
      var args = ["[Demolition:youtube]"];
      for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
      console.log.apply(console, args);
    } catch (_) {}
  }

  function getMainVideoElement() {
    var videos = document.querySelectorAll("video.html5-main-video, #movie_player video, ytd-player video, video");
    if (!videos || !videos.length) return null;

    var best = null;
    var bestArea = 0;
    for (var i = 0; i < videos.length; i++) {
      var video = videos[i];
      if (!(video instanceof HTMLVideoElement)) continue;
      var rect = video.getBoundingClientRect();
      var area = Math.max(0, rect.width) * Math.max(0, rect.height);
      if (area > bestArea) {
        best = video;
        bestArea = area;
      }
    }
    return best;
  }

  function attemptResumePlayback() {
    try {
      var video = getMainVideoElement();
      if (!video || !video.paused) return;

      var playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(function () {
          debugLog("video.play() rejected after interruption removal");
        });
      }
      debugLog("attempted to resume paused video");
    } catch (err) {
      debugLog("resume playback error", err && err.message ? err.message : err);
    }
  }

  function textLooksLikeInterruption(text) {
    if (!text) return false;
    var normalized = String(text).toLowerCase();
    for (var i = 0; i < INTERRUPTION_TEXT_PATTERNS.length; i++) {
      if (normalized.indexOf(INTERRUPTION_TEXT_PATTERNS[i]) !== -1) {
        return true;
      }
    }
    return false;
  }

  function intersects(a, b) {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  }

  function isLikelyBlockingOverPlayer(el) {
    try {
      if (!(el instanceof Element)) return false;
      var style = window.getComputedStyle(el);
      if (!style || style.display === "none" || style.visibility === "hidden") return false;

      var rect = el.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 60) return false;

      var player = document.querySelector("#movie_player, ytd-player, ytm-shorts-player");
      var playerRect = player ? player.getBoundingClientRect() : null;

      if (playerRect && intersects(rect, playerRect)) {
        return true;
      }

      var position = style.position;
      var zIndex = Number(style.zIndex);
      if ((position === "fixed" || position === "absolute" || position === "sticky") && (!Number.isNaN(zIndex) && zIndex >= 100)) {
        return true;
      }

      return false;
    } catch (_) {
      return false;
    }
  }

  function shouldRemoveBlockingNode(el) {
    try {
      if (!(el instanceof Element)) return false;
      var text = (el.innerText || el.textContent || "").trim();
      if (!textLooksLikeInterruption(text)) return false;
      return isLikelyBlockingOverPlayer(el);
    } catch (_) {
      return false;
    }
  }

  function collectCandidateNodes(root, out) {
    if (!root || !(root instanceof Element)) return;

    out.push(root);
    var selector = BLOCKING_UI_SELECTORS.join(",");
    var nested = root.querySelectorAll(selector);
    for (var i = 0; i < nested.length; i++) out.push(nested[i]);
  }

  function removeInterruptionsFromRoot(root) {
    var candidates = [];
    collectCandidateNodes(root, candidates);
    if (!candidates.length) return 0;

    var removed = 0;
    for (var i = 0; i < candidates.length; i++) {
      var node = candidates[i];
      if (!node || !node.isConnected) continue;
      if (!shouldRemoveBlockingNode(node)) continue;

      try {
        node.remove();
        removed++;
      } catch (_) {}
    }

    if (removed > 0) {
      debugLog("removed blocking interruption node count:", removed);
      attemptResumePlayback();
    }

    return removed;
  }

  function stripAdFields(target) {
    if (!target || typeof target !== "object") return false;

    var changed = false;
    if (Object.prototype.hasOwnProperty.call(target, "adPlacements")) {
      delete target.adPlacements;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(target, "adSlots")) {
      delete target.adSlots;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(target, "playerAds")) {
      target.playerAds = false;
      changed = true;
    }

    return changed;
  }

  function sanitizePlayerPayload(payload) {
    if (!payload || typeof payload !== "object") return false;

    var changed = false;

    changed = stripAdFields(payload) || changed;

    if (payload.playerResponse && typeof payload.playerResponse === "object") {
      changed = stripAdFields(payload.playerResponse) || changed;
    }

    return changed;
  }

  function isPlayerEndpoint(url) {
    if (!url) return false;

    try {
      var resolved = new URL(url, location.origin);
      var pathname = String(resolved.pathname || "").toLowerCase();
      return pathname.indexOf("/player") !== -1 || pathname.indexOf("youtubei/v1/player") !== -1;
    } catch (_) {
      var raw = String(url).toLowerCase();
      return raw.indexOf("/player") !== -1 || raw.indexOf("youtubei/v1/player") !== -1;
    }
  }

  function patchFetch() {
    if (window.__demolitionFetchPatched__) return;
    if (typeof window.fetch !== "function") return;

    originalFetch = window.fetch;

    window.fetch = function (input, init) {
      var requestUrl = "";
      try {
        if (typeof input === "string") {
          requestUrl = input;
        } else if (input && typeof input.url === "string") {
          requestUrl = input.url;
        }
      } catch (_) {}

      var fetchPromise;
      try {
        fetchPromise = originalFetch.call(this, input, init);
      } catch (err) {
        return Promise.reject(err);
      }

      if (!isPlayerEndpoint(requestUrl)) {
        return fetchPromise;
      }

      return fetchPromise.then(function (response) {
        if (!response || typeof response.clone !== "function") return response;

        return response
          .clone()
          .json()
          .then(function (data) {
            var changed = sanitizePlayerPayload(data);
            if (!changed) return response;

            var headers = new Headers(response.headers);
            headers.delete("content-length");
            headers.set("content-type", "application/json; charset=utf-8");

            debugLog("sanitized player response payload from", requestUrl);

            return new Response(JSON.stringify(data), {
              status: response.status,
              statusText: response.statusText,
              headers: headers
            });
          })
          .catch(function (err) {
            debugLog("player response parse/sanitize failed", err && err.message ? err.message : err);
            return response;
          });
      });
    };

    window.__demolitionFetchPatched__ = true;
    debugLog("window.fetch patched for /player endpoints");
  }

  function neutralizeAdProps(target) {
    if (!target || typeof target !== "object") return false;

    var changed = false;

    if (Object.prototype.hasOwnProperty.call(target, "adPlacements")) {
      target.adPlacements = [];
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(target, "adSlots")) {
      target.adSlots = [];
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(target, "playerAds")) {
      target.playerAds = [];
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(target, "showAds")) {
      target.showAds = false;
      changed = true;
    }

    return changed;
  }

  function patchRawPlayerResponse(argsObj) {
    if (!argsObj || typeof argsObj !== "object") return false;
    if (!Object.prototype.hasOwnProperty.call(argsObj, "raw_player_response")) return false;

    var raw = argsObj.raw_player_response;
    var changed = false;

    try {
      if (typeof raw === "string") {
        var parsed = JSON.parse(raw);
        changed = neutralizeAdProps(parsed) || changed;
        if (parsed && parsed.playerResponse && typeof parsed.playerResponse === "object") {
          changed = neutralizeAdProps(parsed.playerResponse) || changed;
        }
        if (changed) {
          argsObj.raw_player_response = JSON.stringify(parsed);
        }
        return changed;
      }

      if (raw && typeof raw === "object") {
        changed = neutralizeAdProps(raw) || changed;
        if (raw.playerResponse && typeof raw.playerResponse === "object") {
          changed = neutralizeAdProps(raw.playerResponse) || changed;
        }
      }
    } catch (err) {
      debugLog("raw_player_response patch failed", err && err.message ? err.message : err);
    }

    return changed;
  }

  function patchGlobalYtPlayerConfig() {
    try {
      var ytplayer = window.ytplayer;
      if (!ytplayer || !ytplayer.config || !ytplayer.config.args) return;

      var changed = patchRawPlayerResponse(ytplayer.config.args);
      if (changed) {
        debugLog("patched ytplayer.config.args.raw_player_response");
      }
    } catch (err) {
      debugLog("global ytplayer patch error", err && err.message ? err.message : err);
    }
  }

  function onMutations(mutations) {
    try {
      var totalRemoved = 0;
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        if (!mutation || !mutation.addedNodes) continue;
        for (var j = 0; j < mutation.addedNodes.length; j++) {
          var node = mutation.addedNodes[j];
          if (!(node instanceof Element)) continue;
          totalRemoved += removeInterruptionsFromRoot(node);
        }
      }

      if (totalRemoved > 0) {
        patchGlobalYtPlayerConfig();
      }
    } catch (err) {
      debugLog("mutation processing error", err && err.message ? err.message : err);
    }
  }

  function installObserver() {
    try {
      if (observer) observer.disconnect();
      observer = new MutationObserver(onMutations);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      debugLog("MutationObserver attached on document.documentElement");
    } catch (err) {
      debugLog("observer install failed", err && err.message ? err.message : err);
    }
  }

  function reapplyPatches() {
    patchFetch();
    patchGlobalYtPlayerConfig();
    removeInterruptionsFromRoot(document.documentElement);
  }

  function installNavigationHooks() {
    for (var i = 0; i < NAVIGATION_EVENTS.length; i++) {
      window.addEventListener(
        NAVIGATION_EVENTS[i],
        function () {
          // Defer slightly so new player data/UI is present.
          setTimeout(reapplyPatches, 0);
        },
        true
      );
    }
  }

  function start() {
    reapplyPatches();
    installObserver();
    installNavigationHooks();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
