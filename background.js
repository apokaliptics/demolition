/* ===========================================================
   DEMOLITION — background.js
   MV3 Service Worker.
   Settings store, dynamic network rules, session counters,
   tab lifecycle management, and popup/content APIs.
   =========================================================== */

"use strict";

const SETTINGS_KEY = "demolitionSettings";
const STATS_KEY = "demolitionSessionStats";

const DYNAMIC_RULES = {
  IMAGE: 1001,
  FONT: 1002,
  OBJECT: 1003,
  WOFF2: 1004,
  WOFF: 1005,
  YTM_VIDEO: 1006
};

const ESTIMATED_BYTES = {
  image: 250000,
  font: 90000,
  object: 120000,
  stylesheet: 40000,
  other: 50000
};

const DEFAULT_SETTINGS = {
  enabled: true,
  defaultLevel: 2,
  vimEnabled: true,
  domainLevels: {},
  whitelistDomains: {},
  autoPurgeDomains: {}
};

let settingsCache = null;
let sessionStats = {
  blockedRequests: 0,
  estimatedBytes: 0,
  byType: {}
};

const tabOrigins = new Map();

function safeHostname(value) {
  if (!value) return "";
  try {
    if (/^https?:\/\//i.test(value)) {
      return new URL(value).hostname.toLowerCase();
    }
    return String(value).toLowerCase().trim();
  } catch (error) {
    return "";
  }
}

function getOriginFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch (error) {
    return "";
  }
}

function cloneSettings(settings) {
  return {
    enabled: !!settings.enabled,
    defaultLevel: clampLevel(settings.defaultLevel),
    vimEnabled: settings.vimEnabled !== false,
    domainLevels: Object.assign({}, settings.domainLevels || {}),
    whitelistDomains: Object.assign({}, settings.whitelistDomains || {}),
    autoPurgeDomains: Object.assign({}, settings.autoPurgeDomains || {})
  };
}

function clampLevel(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 2;
  if (num < 0) return 0;
  if (num > 2) return 2;
  return Math.round(num);
}

async function loadSettings() {
  if (settingsCache) return settingsCache;
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  settingsCache = cloneSettings(Object.assign({}, DEFAULT_SETTINGS, stored[SETTINGS_KEY] || {}));
  await chrome.storage.local.set({ [SETTINGS_KEY]: settingsCache });
  return settingsCache;
}

async function saveSettings(nextSettings) {
  settingsCache = cloneSettings(nextSettings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settingsCache });
  await syncDynamicRules();
  broadcastPolicyRefresh();
  return settingsCache;
}

function broadcastPolicyRefresh() {
  chrome.tabs.query({}, function (tabs) {
    if (!tabs || !tabs.length) return;
    tabs.forEach(function (tab) {
      if (!tab.id) return;
      chrome.tabs.sendMessage(tab.id, { action: "refreshPagePolicy" }).catch(function () {
        // Ignore tabs without matching content scripts.
      });
    });
  });
}

async function loadSessionStats() {
  const storage = chrome.storage.session || chrome.storage.local;
  const stored = await storage.get(STATS_KEY);
  sessionStats = Object.assign(
    {
      blockedRequests: 0,
      estimatedBytes: 0,
      byType: {}
    },
    stored[STATS_KEY] || {}
  );
}

async function saveSessionStats() {
  const storage = chrome.storage.session || chrome.storage.local;
  await storage.set({ [STATS_KEY]: sessionStats });
}

function getLevelForDomain(settings, hostname) {
  if (!settings.enabled) return 0;
  if (!hostname) return settings.defaultLevel;
  if (settings.whitelistDomains[hostname]) return 0;
  if (Object.prototype.hasOwnProperty.call(settings.domainLevels, hostname)) {
    return clampLevel(settings.domainLevels[hostname]);
  }
  return settings.defaultLevel;
}

function getExcludedDomains(settings) {
  const excluded = [];
  const domains = new Set();

  Object.keys(settings.whitelistDomains || {}).forEach(function (hostname) {
    if (settings.whitelistDomains[hostname]) {
      domains.add(hostname);
    }
  });

  Object.keys(settings.domainLevels || {}).forEach(function (hostname) {
    if (clampLevel(settings.domainLevels[hostname]) === 0) {
      domains.add(hostname);
    }
  });

  domains.forEach(function (hostname) {
    const safe = safeHostname(hostname);
    if (safe) excluded.push(safe);
  });

  return excluded;
}

function createDynamicRules(excludedDomains) {
  return [
    {
      id: DYNAMIC_RULES.IMAGE,
      priority: 1,
      action: { type: "block" },
      condition: {
        resourceTypes: ["image"],
        excludedRequestDomains: excludedDomains
      }
    },
    {
      id: DYNAMIC_RULES.FONT,
      priority: 1,
      action: { type: "block" },
      condition: {
        resourceTypes: ["font"],
        excludedRequestDomains: excludedDomains
      }
    },
    {
      id: DYNAMIC_RULES.OBJECT,
      priority: 1,
      action: { type: "block" },
      condition: {
        resourceTypes: ["object"],
        excludedRequestDomains: excludedDomains
      }
    },
    {
      id: DYNAMIC_RULES.WOFF2,
      priority: 1,
      action: { type: "block" },
      condition: {
        urlFilter: "*.woff2",
        resourceTypes: ["font", "stylesheet"],
        excludedRequestDomains: excludedDomains
      }
    },
    {
      id: DYNAMIC_RULES.WOFF,
      priority: 1,
      action: { type: "block" },
      condition: {
        urlFilter: "*.woff",
        resourceTypes: ["font", "stylesheet"],
        excludedRequestDomains: excludedDomains
      }
    },
    {
      id: DYNAMIC_RULES.YTM_VIDEO,
      priority: 2,
      action: { type: "block" },
      condition: {
        regexFilter: "[?&]mime=video",
        requestDomains: ["music.youtube.com"],
        resourceTypes: ["media"],
        excludedRequestDomains: excludedDomains
      }
    }
  ];
}

async function syncDynamicRules() {
  const settings = await loadSettings();
  const ruleIds = Object.values(DYNAMIC_RULES);

  if (!settings.enabled) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ruleIds,
      addRules: []
    });
    return;
  }

  const excludedDomains = getExcludedDomains(settings);
  const addRules = createDynamicRules(excludedDomains);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: ruleIds,
    addRules: addRules
  });
}

function makePagePolicy(hostname) {
  const settings = settingsCache || DEFAULT_SETTINGS;
  const level = getLevelForDomain(settings, hostname);
  return {
    enabled: settings.enabled,
    hostname: hostname,
    level: level,
    isWhitelisted: !!(hostname && settings.whitelistDomains[hostname]),
    vimEnabled: settings.vimEnabled && level === 2,
    autoPurgeEnabled: !!(hostname && settings.autoPurgeDomains[hostname])
  };
}

function estimateForType(type) {
  if (!type) return ESTIMATED_BYTES.other;
  if (ESTIMATED_BYTES[type]) return ESTIMATED_BYTES[type];
  return ESTIMATED_BYTES.other;
}

function registerRuleDebugListener() {
  if (!chrome.declarativeNetRequest.onRuleMatchedDebug) return;

  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(function (info) {
    const type = info && info.request ? info.request.type : "other";
    const estimate = estimateForType(type);

    sessionStats.blockedRequests += 1;
    sessionStats.estimatedBytes += estimate;
    sessionStats.byType[type] = (sessionStats.byType[type] || 0) + 1;

    saveSessionStats().catch(function () {
      // Ignore persistence failures.
    });
  });
}

async function purgeOriginData(origin) {
  if (!origin) return;
  await chrome.browsingData.remove(
    { origins: [origin] },
    {
      appcache: true,
      cacheStorage: true,
      cookies: true,
      fileSystems: true,
      indexedDB: true,
      localStorage: true,
      serviceWorkers: true,
      webSQL: true
    }
  );
}

async function bootstrap() {
  await loadSettings();
  await loadSessionStats();
  await syncDynamicRules();
}

chrome.runtime.onInstalled.addListener(function () {
  bootstrap().catch(function () {
    // Ignore setup failures; runtime handlers still work lazily.
  });
});

chrome.runtime.onStartup.addListener(function () {
  bootstrap().catch(function () {
    // Ignore startup failures.
  });
});

bootstrap().catch(function () {
  // Ignore startup failures.
});

registerRuleDebugListener();

chrome.tabs.onUpdated.addListener(async function (tabId, changeInfo, tab) {
  const url = changeInfo.url || (tab && tab.url) || "";
  const origin = getOriginFromUrl(url);
  const hostname = safeHostname(url);
  if (!origin || !hostname) return;
  tabOrigins.set(tabId, { origin: origin, hostname: hostname });
});

chrome.tabs.onRemoved.addListener(async function (tabId) {
  const record = tabOrigins.get(tabId);
  tabOrigins.delete(tabId);
  if (!record) return;

  const settings = await loadSettings();
  if (!settings.autoPurgeDomains[record.hostname]) return;

  await purgeOriginData(record.origin).catch(function () {
    // Ignore purge failures.
  });
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  const action = message && message.action;

  if (action === "closeTab" && sender.tab && sender.tab.id) {
    chrome.tabs.remove(sender.tab.id).catch(function () {
      // Tab may already be closed.
    });
    sendResponse({ ok: true, status: "closing" });
    return true;
  }

  if (action === "getPagePolicy") {
    loadSettings()
      .then(function () {
        const hostname = safeHostname(message.hostname || message.url || "");
        sendResponse({ ok: true, policy: makePagePolicy(hostname) });
      })
      .catch(function (error) {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (action === "getDashboardState") {
    loadSettings()
      .then(function (settings) {
        const hostname = safeHostname(message.hostname || "");
        sendResponse({
          ok: true,
          settings: settings,
          policy: makePagePolicy(hostname),
          stats: sessionStats
        });
      })
      .catch(function (error) {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (action === "setEnabled") {
    loadSettings()
      .then(function (settings) {
        settings.enabled = !!message.enabled;
        return saveSettings(settings);
      })
      .then(function (settings) {
        sendResponse({ ok: true, settings: settings });
      })
      .catch(function (error) {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (action === "setVimEnabled") {
    loadSettings()
      .then(function (settings) {
        settings.vimEnabled = !!message.enabled;
        return saveSettings(settings);
      })
      .then(function (settings) {
        sendResponse({ ok: true, settings: settings });
      })
      .catch(function (error) {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (action === "setNukeLevel") {
    const hostname = safeHostname(message.hostname || "");
    const level = clampLevel(message.level);

    loadSettings()
      .then(function (settings) {
        if (!hostname) throw new Error("Missing hostname");
        settings.domainLevels[hostname] = level;
        if (level > 0) {
          settings.whitelistDomains[hostname] = false;
        }
        return saveSettings(settings);
      })
      .then(function (settings) {
        sendResponse({ ok: true, settings: settings, policy: makePagePolicy(hostname) });
      })
      .catch(function (error) {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (action === "setWhitelist") {
    const hostname = safeHostname(message.hostname || "");
    const enabled = !!message.enabled;

    loadSettings()
      .then(function (settings) {
        if (!hostname) throw new Error("Missing hostname");
        settings.whitelistDomains[hostname] = enabled;
        return saveSettings(settings);
      })
      .then(function (settings) {
        sendResponse({ ok: true, settings: settings, policy: makePagePolicy(hostname) });
      })
      .catch(function (error) {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (action === "setAutoPurge") {
    const hostname = safeHostname(message.hostname || "");
    const enabled = !!message.enabled;

    loadSettings()
      .then(function (settings) {
        if (!hostname) throw new Error("Missing hostname");
        settings.autoPurgeDomains[hostname] = enabled;
        return saveSettings(settings);
      })
      .then(function (settings) {
        sendResponse({ ok: true, settings: settings, policy: makePagePolicy(hostname) });
      })
      .catch(function (error) {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (action === "resetSessionStats") {
    sessionStats = {
      blockedRequests: 0,
      estimatedBytes: 0,
      byType: {}
    };
    saveSessionStats()
      .then(function () {
        sendResponse({ ok: true, stats: sessionStats });
      })
      .catch(function (error) {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (action === "purgeOriginNow") {
    const origin = message.origin || "";
    purgeOriginData(origin)
      .then(function () {
        sendResponse({ ok: true });
      })
      .catch(function (error) {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  return false;
});
