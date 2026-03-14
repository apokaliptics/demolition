/* ===========================================================
   DEMOLITION — roblox.js
   Roblox Protocol Bypass.
   Runs on *://*.roblox.com/games/*
   Extracts the placeId, fires roblox-player:// URI, closes tab.
   =========================================================== */

(function () {
  "use strict";

  /**
   * Extract the numeric placeId from the URL pathname.
   * Roblox game URLs: /games/{placeId}/Game-Name
   */
  function extractPlaceId() {
    const match = window.location.pathname.match(/\/games\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Build the roblox-player:// launch URI.
   * Reference: https://developer.roblox.com/en-us/articles/Custom-Game-Links
   *
   * Minimal format that triggers the Roblox launcher:
   *   roblox-player:1+launchmode:play+placeId:{id}+launchtime:{timestamp}
   */
  function buildLaunchURI(placeId) {
    const timestamp = Date.now();
    return (
      "roblox-player:1" +
      "+launchmode:play" +
      "+gameinfo:" +
      "+placelauncherurl:" +
      encodeURIComponent(
        "https://assetgame.roblox.com/game/PlaceLauncher.ashx" +
        "?request=RequestGame" +
        "&placeId=" + placeId +
        "&isPlayTogetherGame=false"
      ) +
      "+placeId:" + placeId +
      "+launchtime:" + timestamp
    );
  }

  /**
   * Show a minimal status line while the redirect happens.
   */
  function showStatus(placeId, status) {
    // Nuke the page content
    document.documentElement.innerHTML = "";

    const body = document.createElement("body");
    body.style.cssText =
      "background:#0a0a0a;color:#c0c0c0;font-family:monospace;" +
      "padding:40px;font-size:14px;";

    const header = document.createElement("pre");
    header.textContent =
      "╔══════════════════════════════════════╗\n" +
      "║  DEMOLITION — Roblox Bypass         ║\n" +
      "╚══════════════════════════════════════╝\n\n" +
      "PlaceId:  " + placeId + "\n" +
      "Status:   " + status + "\n" +
      "Action:   Launching roblox-player://\n" +
      "          Tab will close automatically.";
    header.style.cssText = "color:#00ff41;";

    body.appendChild(header);
    document.documentElement.appendChild(body);
  }

  /**
   * Request the background service worker to close this tab.
   */
  function requestTabClose() {
    try {
      chrome.runtime.sendMessage({ action: "closeTab" });
    } catch (e) {
      // Fallback: try window.close (may be blocked by browser)
      window.close();
    }
  }

  // ---- Main ----
  const placeId = extractPlaceId();

  if (!placeId) {
    // Not a valid game page — let the normal nuke handle it
    return;
  }

  showStatus(placeId, "Redirecting…");

  // Fire the protocol handler
  window.location.href = buildLaunchURI(placeId);

  // Close the tab after a short delay to let the protocol fire
  setTimeout(requestTabClose, 2500);
})();
