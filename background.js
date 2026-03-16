/* ===========================================================
   DEMOLITION — background.js
   MV3 Service Worker.
   Settings store, dynamic network rules, session counters,
   tab lifecycle management, and popup/content APIs.
   =========================================================== */

"use strict";

const SETTINGS_KEY = "demolitionSettings";
const STATS_KEY = "demolitionSessionStats";

const DNR_ID_RANGES = {
  STATIC: { min: 1, max: 30000 },
  DYNAMIC: { min: 30001, max: 34000 },
  SESSION: { min: 34001, max: 36000 }
};

const STATIC_RULESET_IDS = ["core_network", "core_privacy"];

const LEGACY_DYNAMIC_RULE_IDS = [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010];

const DYNAMIC_RULES = {
  IMAGE: 30001,
  FONT: 30002,
  OBJECT: 30003,
  WOFF2: 30004,
  WOFF: 30005,
  YTM_VIDEO: 30006,
  DOUBLECLICK: 30007,
  GOOGLE_ADSERVICES: 30008,
  GOOGLE_SYNDICATION: 30009,
  GOOGLE_ADSERVICE: 30010,
  GOOGLE_ADS_DOUBLECLICK: 30011,
  YOUTUBE_PAGEAD: 30012
};

const COSMETIC_SELECTORS = {
  base: [
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
  ],
  level2Extra: [
    '[class*="modal" i]',
    '[class*="overlay" i]',
    '[class*="toast" i]',
    '[class*="notification" i]'
  ],
  youtube: [
    '.ytp-ad-text',
    '.ytp-ad-player-overlay',
    '.ytp-ad-message-container',
    '.ytd-display-ad-renderer',
    '.ytd-promoted-video-renderer',
    '.ytd-companion-slot-renderer'
  ],
  youtubePreserve: [
    '.video-ads',
    '.ytp-ad-skip-button-container',
    '.ytp-ad-skip-button-slot',
    '.ytp-ad-skip-button'
  ]
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

let runtimeRuleHealth = {
  syncStatus: "pending",
  lastSyncAt: 0,
  lastSyncError: "",
  staticRulesetsEnabled: 0,
  dynamicRuleCount: 0,
  sessionRuleCount: 0,
  excludedDomainCount: 0,
  extensionEnabled: true
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
    },
    {
      id: DYNAMIC_RULES.DOUBLECLICK,
      priority: 2,
      action: { type: "block" },
      condition: {
        urlFilter: "||doubleclick.net^",
        resourceTypes: ["script", "xmlhttprequest", "sub_frame", "image", "media"],
        excludedRequestDomains: excludedDomains
      }
    },
    {
      id: DYNAMIC_RULES.GOOGLE_ADSERVICES,
      priority: 2,
      action: { type: "block" },
      condition: {
        urlFilter: "||googleadservices.com^",
        resourceTypes: ["script", "xmlhttprequest", "sub_frame", "image", "media"],
        excludedRequestDomains: excludedDomains
      }
    },
    {
      id: DYNAMIC_RULES.GOOGLE_SYNDICATION,
      priority: 2,
      action: { type: "block" },
      condition: {
        urlFilter: "||googlesyndication.com^",
        resourceTypes: ["script", "xmlhttprequest", "sub_frame", "image", "media"],
        excludedRequestDomains: excludedDomains
      }
    },
    {
      id: DYNAMIC_RULES.GOOGLE_ADSERVICE,
      priority: 2,
      action: { type: "block" },
      condition: {
        urlFilter: "||adservice.google.com^",
        resourceTypes: ["script", "xmlhttprequest", "sub_frame", "image", "media"],
        excludedRequestDomains: excludedDomains
      }
    },
    {
      id: DYNAMIC_RULES.GOOGLE_ADS_DOUBLECLICK,
      priority: 2,
      action: { type: "block" },
      condition: {
        urlFilter: "||googleads.g.doubleclick.net^",
        resourceTypes: ["script", "xmlhttprequest", "sub_frame", "image", "media"],
        excludedRequestDomains: excludedDomains
      }
    },
    {
      id: DYNAMIC_RULES.YOUTUBE_PAGEAD,
      priority: 3,
      action: { type: "block" },
      condition: {
        urlFilter: "||youtube.com/pagead/",
        resourceTypes: ["script", "xmlhttprequest", "sub_frame", "image", "media"],
        excludedRequestDomains: excludedDomains
      }
    }
  ];
}

function getManagedDynamicRuleIds() {
  return Array.from(new Set(Object.values(DYNAMIC_RULES).concat(LEGACY_DYNAMIC_RULE_IDS)));
}

function getManagedSessionRuleIds() {
  const ids = [];
  for (let id = DNR_ID_RANGES.SESSION.min; id <= DNR_ID_RANGES.SESSION.max; id += 1) {
    ids.push(id);
  }
  return ids;
}

function createSessionAllowRules(excludedDomains) {
  const maxRules = DNR_ID_RANGES.SESSION.max - DNR_ID_RANGES.SESSION.min + 1;
  const domains = (excludedDomains || []).slice(0, maxRules);

  return domains.map(function (domain, index) {
    return {
      id: DNR_ID_RANGES.SESSION.min + index,
      priority: 10000,
      action: { type: "allowAllRequests" },
      condition: {
        requestDomains: [domain]
      }
    };
  });
}

function dedupeRulesById(rules) {
  const byId = new Map();
  (rules || []).forEach(function (rule) {
    if (rule && Number.isInteger(rule.id)) {
      byId.set(rule.id, rule);
    }
  });
  return Array.from(byId.values());
}

function validateRuntimeRules(rules) {
  (rules || []).forEach(function (rule) {
    if (!rule || !rule.condition) {
      throw new Error("Invalid runtime rule payload");
    }
    if (rule.id < DNR_ID_RANGES.DYNAMIC.min || rule.id > DNR_ID_RANGES.DYNAMIC.max) {
      throw new Error("Rule ID outside dynamic range: " + rule.id);
    }
    if (!Array.isArray(rule.condition.excludedRequestDomains)) {
      throw new Error("Rule missing excludedRequestDomains: " + rule.id);
    }
  });
}

function validateSessionRules(rules) {
  (rules || []).forEach(function (rule) {
    if (!rule || !rule.condition) {
      throw new Error("Invalid session rule payload");
    }
    if (rule.id < DNR_ID_RANGES.SESSION.min || rule.id > DNR_ID_RANGES.SESSION.max) {
      throw new Error("Rule ID outside session range: " + rule.id);
    }
    if (!rule.action || rule.action.type !== "allowAllRequests") {
      throw new Error("Session rule must use allowAllRequests: " + rule.id);
    }
    if (!Array.isArray(rule.condition.requestDomains) || !rule.condition.requestDomains.length) {
      throw new Error("Session rule missing requestDomains: " + rule.id);
    }
  });
}

async function syncStaticRulesets(enabled) {
  const currentlyEnabled = await chrome.declarativeNetRequest.getEnabledRulesets();
  const enabledSet = new Set(currentlyEnabled || []);
  const targetSet = new Set(enabled ? STATIC_RULESET_IDS : []);

  const enableRulesetIds = [];
  const disableRulesetIds = [];

  STATIC_RULESET_IDS.forEach(function (id) {
    if (targetSet.has(id) && !enabledSet.has(id)) {
      enableRulesetIds.push(id);
    }
    if (!targetSet.has(id) && enabledSet.has(id)) {
      disableRulesetIds.push(id);
    }
  });

  if (!enableRulesetIds.length && !disableRulesetIds.length) {
    return targetSet.size;
  }

  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enableRulesetIds,
    disableRulesetIds: disableRulesetIds
  });

  const updated = await chrome.declarativeNetRequest.getEnabledRulesets();
  return (updated || []).filter(function (id) {
    return STATIC_RULESET_IDS.indexOf(id) >= 0;
  }).length;
}

function updateRuntimeRuleHealth(partial) {
  runtimeRuleHealth = Object.assign({}, runtimeRuleHealth, partial);
}

function getRuntimeRuleHealth() {
  return Object.assign({}, runtimeRuleHealth);
}

async function syncDynamicRules() {
  const settings = await loadSettings();
  const dynamicRuleIds = getManagedDynamicRuleIds();
  const sessionRuleIds = getManagedSessionRuleIds();

  try {
    if (!settings.enabled) {
      const staticEnabled = await syncStaticRulesets(false);
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: dynamicRuleIds,
        addRules: []
      });
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: sessionRuleIds,
        addRules: []
      });

      updateRuntimeRuleHealth({
        syncStatus: "ok",
        lastSyncAt: Date.now(),
        lastSyncError: "",
        staticRulesetsEnabled: staticEnabled,
        dynamicRuleCount: 0,
        sessionRuleCount: 0,
        excludedDomainCount: 0,
        extensionEnabled: false
      });
      return;
    }

    const excludedDomains = getExcludedDomains(settings);
    const staticEnabled = await syncStaticRulesets(true);

    const addRules = dedupeRulesById(createDynamicRules(excludedDomains));
    validateRuntimeRules(addRules);

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: dynamicRuleIds,
      addRules: addRules
    });

    const sessionRules = dedupeRulesById(createSessionAllowRules(excludedDomains));
    validateSessionRules(sessionRules);

    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: sessionRuleIds,
      addRules: sessionRules
    });

    updateRuntimeRuleHealth({
      syncStatus: "ok",
      lastSyncAt: Date.now(),
      lastSyncError: "",
      staticRulesetsEnabled: staticEnabled,
      dynamicRuleCount: addRules.length,
      sessionRuleCount: sessionRules.length,
      excludedDomainCount: excludedDomains.length,
      extensionEnabled: true
    });
  } catch (error) {
    updateRuntimeRuleHealth({
      syncStatus: "error",
      lastSyncAt: Date.now(),
      lastSyncError: String(error),
      extensionEnabled: !!settings.enabled
    });
    throw error;
  }
}

function makePagePolicy(hostname) {
  const settings = settingsCache || DEFAULT_SETTINGS;
  const level = getLevelForDomain(settings, hostname);
  const safeHost = safeHostname(hostname);
  const isYoutube = /(^|\.)youtube\.com$/i.test(safeHost);

  const hideSelectors = COSMETIC_SELECTORS.base.slice();
  if (level === 2) {
    hideSelectors.push.apply(hideSelectors, COSMETIC_SELECTORS.level2Extra);
  }
  if (isYoutube) {
    hideSelectors.push.apply(hideSelectors, COSMETIC_SELECTORS.youtube);
  }

  const preserveSelectors = isYoutube ? COSMETIC_SELECTORS.youtubePreserve.slice() : [];

  return {
    enabled: settings.enabled,
    hostname: hostname,
    level: level,
    isWhitelisted: !!(hostname && settings.whitelistDomains[hostname]),
    vimEnabled: settings.vimEnabled && level === 2,
    autoPurgeEnabled: !!(hostname && settings.autoPurgeDomains[hostname]),
    cosmeticFiltering: {
      hideSelectors: hideSelectors,
      preserveSelectors: preserveSelectors,
      throttleMs: isYoutube ? 180 : 500
    }
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
          stats: sessionStats,
          runtime: getRuntimeRuleHealth()
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
