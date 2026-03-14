/* ===========================================================
   DEMOLITION — background.js
   MV3 Service Worker.
   Handles messages from content scripts (tab close requests).
   =========================================================== */

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.action === "closeTab" && sender.tab && sender.tab.id) {
    chrome.tabs.remove(sender.tab.id).catch(function () {
      // Tab may already be closed — ignore
    });
    sendResponse({ status: "closing" });
  }
  return true; // keep message channel open for async
});
