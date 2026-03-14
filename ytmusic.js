/* ===========================================================
   DEMOLITION — ytmusic.js
   YouTube Music headless text panel for Level 2 mode.
   =========================================================== */

(function () {
  "use strict";

  var panel = null;
  var listNode = null;
  var headerNode = null;
  var observer = null;
  var debounceTimer = null;
  var lastUrl = window.location.href;

  function sendMessage(payload) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(payload, function (response) {
          if (chrome.runtime.lastError || !response || !response.ok) {
            resolve(null);
            return;
          }
          resolve(response);
        });
      } catch (error) {
        resolve(null);
      }
    });
  }

  async function shouldRunHeadlessMode() {
    var response = await sendMessage({
      action: "getPagePolicy",
      url: window.location.href,
      hostname: window.location.hostname
    });

    if (!response || !response.policy) return false;
    return Number(response.policy.level) === 2;
  }

  function getText(node) {
    return node ? node.textContent.trim() : "";
  }

  function clickFirst(selectors) {
    for (var i = 0; i < selectors.length; i += 1) {
      var node = document.querySelector(selectors[i]);
      if (node) {
        node.click();
        return true;
      }
    }
    return false;
  }

  function playPause() {
    clickFirst([
      "ytmusic-player-bar tp-yt-paper-icon-button[title*='Pause' i]",
      "ytmusic-player-bar tp-yt-paper-icon-button[title*='Play' i]",
      "ytmusic-player-bar #play-pause-button"
    ]);
  }

  function nextTrack() {
    clickFirst([
      "ytmusic-player-bar tp-yt-paper-icon-button[title*='Next' i]",
      "ytmusic-player-bar #next-button"
    ]);
  }

  function prevTrack() {
    clickFirst([
      "ytmusic-player-bar tp-yt-paper-icon-button[title*='Previous' i]",
      "ytmusic-player-bar #previous-button"
    ]);
  }

  function scrapeCurrentTrack() {
    var title = getText(
      document.querySelector("ytmusic-player-bar .title, ytmusic-player-bar .ytmusic-player-bar.title")
    );
    var artist = getText(document.querySelector("ytmusic-player-bar .byline"));

    return {
      title: title || "Unknown Track",
      artist: artist || "Unknown Artist"
    };
  }

  function scrapeQueue() {
    var items = [];
    var selectors = [
      "ytmusic-player-queue-item .song-name",
      "ytmusic-player-queue-item .title",
      "ytmusic-responsive-list-item-renderer .title",
      "ytmusic-responsive-list-item-renderer .flex-columns .title"
    ];

    for (var i = 0; i < selectors.length; i += 1) {
      var nodes = document.querySelectorAll(selectors[i]);
      if (!nodes.length) continue;

      nodes.forEach(function (node) {
        var text = getText(node);
        if (text && items.indexOf(text) === -1 && items.length < 30) {
          items.push(text);
        }
      });

      if (items.length) break;
    }

    return items;
  }

  function ensurePanel() {
    if (panel && panel.isConnected) return;

    panel = document.createElement("section");
    panel.setAttribute("data-demolition-ui", "ytmusic");
    panel.style.position = "fixed";
    panel.style.right = "10px";
    panel.style.top = "10px";
    panel.style.zIndex = "2147483646";
    panel.style.width = "360px";
    panel.style.maxHeight = "80vh";
    panel.style.overflow = "auto";
    panel.style.background = "#0a0a0a";
    panel.style.color = "#c0c0c0";
    panel.style.border = "1px solid #333";
    panel.style.padding = "10px";
    panel.style.fontFamily = "Cascadia Mono, Fira Code, Consolas, monospace";
    panel.style.fontSize = "12px";

    headerNode = document.createElement("pre");
    headerNode.textContent =
      "DEMOLITION - YouTube Music Headless\n" +
      "[Space] Play/Pause  [n] Next  [p] Prev\n";
    headerNode.style.margin = "0 0 8px";
    headerNode.style.color = "#67ffa3";

    var controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.gap = "6px";
    controls.style.marginBottom = "8px";

    var playBtn = document.createElement("button");
    playBtn.textContent = "Play/Pause";
    playBtn.addEventListener("click", playPause);

    var prevBtn = document.createElement("button");
    prevBtn.textContent = "Prev";
    prevBtn.addEventListener("click", prevTrack);

    var nextBtn = document.createElement("button");
    nextBtn.textContent = "Next";
    nextBtn.addEventListener("click", nextTrack);

    [playBtn, prevBtn, nextBtn].forEach(function (btn) {
      btn.style.background = "#111";
      btn.style.color = "#67ffa3";
      btn.style.border = "1px solid #333";
      btn.style.padding = "4px 7px";
      btn.style.cursor = "pointer";
      controls.appendChild(btn);
    });

    listNode = document.createElement("ol");
    listNode.style.margin = "0";
    listNode.style.paddingLeft = "20px";

    panel.appendChild(headerNode);
    panel.appendChild(controls);
    panel.appendChild(listNode);
    document.documentElement.appendChild(panel);
  }

  function render() {
    ensurePanel();

    var now = scrapeCurrentTrack();
    var queue = scrapeQueue();

    headerNode.textContent =
      "DEMOLITION - YouTube Music Headless\n" +
      "Now: " + now.title + " - " + now.artist + "\n" +
      "[Space] Play/Pause  [n] Next  [p] Prev\n";

    listNode.innerHTML = "";
    if (!queue.length) {
      var empty = document.createElement("li");
      empty.textContent = "Queue not available yet.";
      listNode.appendChild(empty);
      return;
    }

    queue.forEach(function (title) {
      var li = document.createElement("li");
      li.textContent = title;
      li.style.marginBottom = "4px";
      listNode.appendChild(li);
    });
  }

  function scheduleRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, 600);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(function () {
      scheduleRender();
    });

    var target = document.body || document.documentElement;
    observer.observe(target, { childList: true, subtree: true });
  }

  function bindKeyboard() {
    document.addEventListener(
      "keydown",
      function (event) {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        var tag = (event.target && event.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || event.target.isContentEditable) return;

        if (event.key === " " || event.code === "Space") {
          event.preventDefault();
          playPause();
          return;
        }

        if (event.key.toLowerCase() === "n") {
          event.preventDefault();
          nextTrack();
          return;
        }

        if (event.key.toLowerCase() === "p") {
          event.preventDefault();
          prevTrack();
        }
      },
      true
    );
  }

  function startUrlWatcher() {
    setInterval(function () {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        scheduleRender();
      }
    }, 1000);
  }

  function teardown() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (panel && panel.parentNode) {
      panel.parentNode.removeChild(panel);
    }
    panel = null;
    listNode = null;
    headerNode = null;
  }

  shouldRunHeadlessMode().then(function (enabled) {
    if (!enabled) return;

    ensurePanel();
    render();
    startObserver();
    bindKeyboard();
    startUrlWatcher();
  });

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.action !== "refreshPagePolicy") return;
    shouldRunHeadlessMode().then(function (enabled) {
      if (!enabled) {
        teardown();
        sendResponse({ ok: true, active: false });
        return;
      }

      ensurePanel();
      scheduleRender();
      startObserver();
      sendResponse({ ok: true, active: true });
    });
    return true;
  });
})();
