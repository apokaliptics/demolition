(function () {
  "use strict";

  var state = {
    hostname: "",
    origin: "",
    settings: null,
    policy: null,
    stats: null
  };

  var elements = {
    domainLabel: document.getElementById("domainLabel"),
    enabledToggle: document.getElementById("enabledToggle"),
    whitelistToggle: document.getElementById("whitelistToggle"),
    autoPurgeToggle: document.getElementById("autoPurgeToggle"),
    vimToggle: document.getElementById("vimToggle"),
    savedCounter: document.getElementById("savedCounter"),
    blockedCounter: document.getElementById("blockedCounter"),
    searchForm: document.getElementById("searchForm"),
    searchInput: document.getElementById("searchInput"),
    searchResults: document.getElementById("searchResults"),
    statusLine: document.getElementById("statusLine"),
    resetStatsBtn: document.getElementById("resetStatsBtn"),
    levelRadios: Array.prototype.slice.call(document.querySelectorAll('input[name="level"]'))
  };

  function setStatus(text) {
    elements.statusLine.textContent = text;
  }

  function safeGetHostname(url) {
    try {
      return new URL(url).hostname;
    } catch (error) {
      return "";
    }
  }

  function safeGetOrigin(url) {
    try {
      return new URL(url).origin;
    } catch (error) {
      return "";
    }
  }

  function sendMessage(payload) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(payload, function (response) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || response.ok === false) {
          reject(new Error((response && response.error) || "Unknown error"));
          return;
        }
        resolve(response);
      });
    });
  }

  async function getCurrentTabContext() {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab = tabs && tabs[0] ? tabs[0] : null;
    if (!tab || !tab.url) {
      state.hostname = "";
      state.origin = "";
      return;
    }
    state.hostname = safeGetHostname(tab.url);
    state.origin = safeGetOrigin(tab.url);
  }

  function formatMB(bytes) {
    var mb = (bytes || 0) / (1024 * 1024);
    return mb.toFixed(2) + " MB";
  }

  function renderStats() {
    var stats = state.stats || { blockedRequests: 0, estimatedBytes: 0 };
    elements.savedCounter.textContent = formatMB(stats.estimatedBytes || 0);
    elements.blockedCounter.textContent = (stats.blockedRequests || 0) + " requests blocked";
  }

  function renderPolicy() {
    var policy = state.policy || { level: 2, isWhitelisted: false, autoPurgeEnabled: false };

    elements.domainLabel.textContent = state.hostname || "No active web page";
    elements.enabledToggle.checked = !!(state.settings && state.settings.enabled);
    elements.vimToggle.checked = !!(state.settings && state.settings.vimEnabled);
    elements.whitelistToggle.checked = !!policy.isWhitelisted;
    elements.autoPurgeToggle.checked = !!policy.autoPurgeEnabled;

    elements.levelRadios.forEach(function (radio) {
      radio.checked = Number(radio.value) === Number(policy.level);
      radio.disabled = !state.hostname;
    });

    var disabled = !state.hostname;
    elements.whitelistToggle.disabled = disabled;
    elements.autoPurgeToggle.disabled = disabled;
  }

  async function refresh() {
    await getCurrentTabContext();
    var response = await sendMessage({
      action: "getDashboardState",
      hostname: state.hostname
    });

    state.settings = response.settings;
    state.policy = response.policy;
    state.stats = response.stats;

    renderPolicy();
    renderStats();
  }

  async function setLevel(level) {
    if (!state.hostname) return;
    var response = await sendMessage({
      action: "setNukeLevel",
      hostname: state.hostname,
      level: Number(level)
    });
    state.settings = response.settings;
    state.policy = response.policy;
    renderPolicy();
  }

  async function setWhitelist(enabled) {
    if (!state.hostname) return;
    var response = await sendMessage({
      action: "setWhitelist",
      hostname: state.hostname,
      enabled: !!enabled
    });
    state.settings = response.settings;
    state.policy = response.policy;
    renderPolicy();
  }

  async function setAutoPurge(enabled) {
    if (!state.hostname) return;
    var response = await sendMessage({
      action: "setAutoPurge",
      hostname: state.hostname,
      enabled: !!enabled
    });
    state.settings = response.settings;
    state.policy = response.policy;
    renderPolicy();
  }

  async function setEnabled(enabled) {
    var response = await sendMessage({
      action: "setEnabled",
      enabled: !!enabled
    });
    state.settings = response.settings;
    await refresh();
  }

  async function setVimEnabled(enabled) {
    var response = await sendMessage({
      action: "setVimEnabled",
      enabled: !!enabled
    });
    state.settings = response.settings;
    await refresh();
  }

  function extractText(element) {
    return element ? element.textContent.trim() : "";
  }

  function parseDDGHtml(html) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, "text/html");
    var nodes = doc.querySelectorAll(".result, .results_links, .web-result");
    var rows = [];

    nodes.forEach(function (node) {
      if (rows.length >= 10) return;

      var titleAnchor =
        node.querySelector("a.result__a") ||
        node.querySelector("h2 a") ||
        node.querySelector("a[href]");

      if (!titleAnchor) return;

      var title = extractText(titleAnchor);
      var href = titleAnchor.getAttribute("href") || "";
      var snippet = extractText(node.querySelector(".result__snippet, .result-snippet, .snippet"));
      var shownUrl = extractText(node.querySelector(".result__url, .result__extras__url, cite"));

      if (!title || !href) return;

      rows.push({
        title: title,
        href: href,
        urlText: shownUrl || href,
        snippet: snippet
      });
    });

    return rows;
  }

  function renderSearchResults(items) {
    elements.searchResults.innerHTML = "";

    if (!items.length) {
      var empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No results found.";
      elements.searchResults.appendChild(empty);
      return;
    }

    items.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "result-item";

      var link = document.createElement("a");
      link.href = item.href;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = item.title;

      var url = document.createElement("div");
      url.className = "result-url";
      url.textContent = item.urlText;

      var snippet = document.createElement("div");
      snippet.className = "result-snippet";
      snippet.textContent = item.snippet;

      row.appendChild(link);
      row.appendChild(url);
      if (item.snippet) row.appendChild(snippet);
      elements.searchResults.appendChild(row);
    });
  }

  async function runSearch(query) {
    var endpoint = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
    var response = await fetch(endpoint, {
      method: "GET",
      credentials: "omit",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Search failed with status " + response.status);
    }

    var html = await response.text();
    var parsed = parseDDGHtml(html);
    renderSearchResults(parsed);
    setStatus("Search complete: " + parsed.length + " results.");
  }

  function wireEvents() {
    elements.enabledToggle.addEventListener("change", function () {
      setStatus("Updating extension state...");
      setEnabled(elements.enabledToggle.checked)
        .then(function () {
          setStatus("Extension state updated.");
        })
        .catch(function (error) {
          setStatus("Error: " + error.message);
        });
    });

    elements.vimToggle.addEventListener("change", function () {
      setStatus("Updating vim mode...");
      setVimEnabled(elements.vimToggle.checked)
        .then(function () {
          setStatus("Vim mode updated.");
        })
        .catch(function (error) {
          setStatus("Error: " + error.message);
        });
    });

    elements.whitelistToggle.addEventListener("change", function () {
      setStatus("Updating whitelist...");
      setWhitelist(elements.whitelistToggle.checked)
        .then(function () {
          setStatus("Whitelist updated.");
        })
        .catch(function (error) {
          setStatus("Error: " + error.message);
        });
    });

    elements.autoPurgeToggle.addEventListener("change", function () {
      setStatus("Updating auto purge...");
      setAutoPurge(elements.autoPurgeToggle.checked)
        .then(function () {
          setStatus("Auto purge updated.");
        })
        .catch(function (error) {
          setStatus("Error: " + error.message);
        });
    });

    elements.levelRadios.forEach(function (radio) {
      radio.addEventListener("change", function () {
        if (!radio.checked) return;
        setStatus("Applying level " + radio.value + "...");
        setLevel(radio.value)
          .then(function () {
            setStatus("Nuke level updated.");
          })
          .catch(function (error) {
            setStatus("Error: " + error.message);
          });
      });
    });

    elements.resetStatsBtn.addEventListener("click", function () {
      setStatus("Resetting counter...");
      sendMessage({ action: "resetSessionStats" })
        .then(function (response) {
          state.stats = response.stats;
          renderStats();
          setStatus("Counter reset.");
        })
        .catch(function (error) {
          setStatus("Error: " + error.message);
        });
    });

    elements.searchForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var query = (elements.searchInput.value || "").trim();
      if (!query) {
        setStatus("Enter a search query.");
        return;
      }
      setStatus("Searching text-only results...");
      runSearch(query).catch(function (error) {
        setStatus("Error: " + error.message);
      });
    });
  }

  wireEvents();

  refresh()
    .then(function () {
      setStatus("Ready.");
    })
    .catch(function (error) {
      setStatus("Initialization error: " + error.message);
    });
})();
