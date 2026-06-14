const {
  MESSAGE_TYPES,
  ROOT_ATTR,
  STYLE_ID,
  hostnameFromLocation,
  sanitizeSettings,
  siteModeForHostname
} = globalThis.LightReaderShared;

const TARGET_ATTR = "data-light-reader-target";
const SHELL_ATTR = "data-light-reader-shell";
const MODE_ATTR = "data-light-reader-mode";
const MIN_READING_SCORE = 7;
const RECHECK_DELAY_MS = 650;

const MAIN_SELECTORS = [
  "main",
  "article",
  "[role='main']",
  ".content",
  "#content",
  ".entry-content",
  ".post-content",
  ".page-content",
  ".article-content",
  ".article-body",
  ".story-body",
  ".markdown-body",
  ".prose"
];

const EXCLUDED_SELECTORS = [
  "nav",
  "header",
  "footer",
  "aside",
  "dialog",
  "form",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[role='dialog']",
  "[role='menu']",
  "[aria-modal='true']"
].join(",");

const TEXT_BLOCK_SELECTORS = [
  "p",
  "li",
  "dd",
  "dt",
  "blockquote",
  "figcaption",
  "summary",
  "pre"
].join(",");

let currentSettings = sanitizeSettings();
let temporaryMode = "auto";
let detection = {
  status: "unknown",
  detectedDark: false,
  reason: "Page has not been checked yet.",
  score: 0
};
let bestReadingElement = null;
let recheckTimer = 0;
let lastHref = location.href;

function parseRgb(color) {
  if (!color || color === "transparent") return null;

  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;

  const parts = match[1]
    .replace(/\//g, " ")
    .split(/[\s,]+/)
    .filter(Boolean);
  const alpha = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
  if (alpha === 0) return null;

  const channels = parts.slice(0, 3).map((part) => Number.parseFloat(part));
  if (channels.some((channel) => Number.isNaN(channel))) return null;

  return channels;
}

function channelToLinear(value) {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function luminance(rgb) {
  if (!rgb) return 1;
  const [r, g, b] = rgb.map(channelToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function effectiveBackground(element) {
  let node = element;

  while (node && node.nodeType === Node.ELEMENT_NODE) {
    const color = parseRgb(getComputedStyle(node).backgroundColor);
    if (color) return color;
    node = node.parentElement;
  }

  return parseRgb(getComputedStyle(document.documentElement).backgroundColor) || [255, 255, 255];
}

function visibleArea(element) {
  const rect = element.getBoundingClientRect();
  const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
  const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
  return width * height;
}

function isVisibleElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
}

function isExcludedChrome(element) {
  if (!element || element === document.body) return false;
  return Boolean(element.closest(EXCLUDED_SELECTORS));
}

function textLength(element) {
  return (element.innerText || "").replace(/\s+/g, " ").trim().length;
}

function visibleTextBlocks(element) {
  return Array.from(element.querySelectorAll(TEXT_BLOCK_SELECTORS)).filter((block) => {
    if (!isVisibleElement(block) || isExcludedChrome(block)) return false;
    return textLength(block) >= 40 && visibleArea(block) > 800;
  });
}

function semanticScore(element) {
  if (element.matches("article")) return 3.5;
  if (element.matches("main, [role='main']")) return 3;
  if (element.matches(".entry-content, .post-content, .article-content, .article-body, .story-body, .markdown-body, .prose")) {
    return 2.5;
  }
  if (element.matches(".content, #content, .page-content")) return 1.5;
  if (element === document.body) return -2;
  return 0;
}

function centralityScore(element) {
  const rect = element.getBoundingClientRect();
  const viewportCenter = window.innerWidth / 2;
  const elementCenter = rect.left + rect.width / 2;
  const distance = Math.abs(viewportCenter - elementCenter) / Math.max(window.innerWidth, 1);

  return Math.max(0, 1.5 - distance * 3);
}

function contrastState(element) {
  const style = getComputedStyle(element);
  const bgLum = luminance(effectiveBackground(element));
  const textLum = luminance(parseRgb(style.color));

  return {
    bgLum,
    textLum,
    isDarkWithLightText: bgLum < 0.28 && textLum > 0.62
  };
}

function scoreCandidate(element) {
  if (!isVisibleElement(element) || isExcludedChrome(element)) return null;

  const area = visibleArea(element);
  const totalTextLength = textLength(element);
  if (area < 30000 || totalTextLength < 180) return null;

  const contrast = contrastState(element);
  if (!contrast.isDarkWithLightText) return null;

  const blocks = visibleTextBlocks(element);
  const controls = element.querySelectorAll("button, input, select, textarea, [role='button'], [role='tab']").length;
  const links = element.querySelectorAll("a").length;
  const proseScore = Math.min(blocks.length, 6);
  const textScore = Math.min(totalTextLength / 800, 5);
  const areaScore = Math.min(area / 120000, 2);
  const controlPenalty = Math.min(controls / 5, 4);
  const linkPenalty = blocks.length < 3 ? Math.min(links / 20, 2) : 0;
  const score =
    semanticScore(element) +
    centralityScore(element) +
    proseScore +
    textScore +
    areaScore +
    2 -
    controlPenalty -
    linkPenalty;

  return {
    element,
    score,
    textLength: totalTextLength,
    blocks: blocks.length,
    area
  };
}

function candidateElements() {
  const candidates = new Set();

  for (const selector of MAIN_SELECTORS) {
    for (const element of document.querySelectorAll(selector)) {
      candidates.add(element);
    }
  }

  for (const block of Array.from(document.querySelectorAll(TEXT_BLOCK_SELECTORS)).slice(0, 140)) {
    let node = block.parentElement;
    for (let depth = 0; node && depth < 3; depth += 1) {
      candidates.add(node);
      node = node.parentElement;
    }
  }

  if (document.body) candidates.add(document.body);
  return Array.from(candidates);
}

function clearTargets() {
  for (const element of document.querySelectorAll(`[${TARGET_ATTR}]`)) {
    element.removeAttribute(TARGET_ATTR);
  }

  for (const element of document.querySelectorAll(`[${SHELL_ATTR}]`)) {
    element.removeAttribute(SHELL_ATTR);
  }
}

function markTarget(element) {
  clearTargets();
  if (!element) return;

  element.setAttribute(TARGET_ATTR, "true");

  let node = element.parentElement;
  while (node && node !== document.documentElement) {
    node.setAttribute(SHELL_ATTR, "true");
    node = node.parentElement;
  }
}

function withLightReaderDisabled(callback) {
  const previousState = document.documentElement.getAttribute(ROOT_ATTR);
  const previousMode = document.documentElement.getAttribute(MODE_ATTR);

  document.documentElement.setAttribute(ROOT_ATTR, "off");
  document.documentElement.removeAttribute(MODE_ATTR);

  try {
    return callback();
  } finally {
    if (previousState === null) {
      document.documentElement.removeAttribute(ROOT_ATTR);
    } else {
      document.documentElement.setAttribute(ROOT_ATTR, previousState);
    }

    if (previousMode === null) {
      document.documentElement.removeAttribute(MODE_ATTR);
    } else {
      document.documentElement.setAttribute(MODE_ATTR, previousMode);
    }
  }
}

function evaluatePage() {
  return withLightReaderDisabled(() => {
    const best = candidateElements()
      .map(scoreCandidate)
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)[0];

    bestReadingElement = best?.element || null;

    if (best && best.score >= MIN_READING_SCORE) {
      detection = {
        status: "active",
        detectedDark: true,
        reason: "Dark reading content detected.",
        score: Math.round(best.score * 10) / 10
      };
      return;
    }

    detection = {
      status: "inactive",
      detectedDark: false,
      reason: best ? "Page is dark, but does not look like a reading surface." : "No dark reading content detected.",
      score: best ? Math.round(best.score * 10) / 10 : 0
    };
  });
}

function resetDetection(reason) {
  detection = {
    status: "unknown",
    detectedDark: false,
    reason,
    score: 0
  };
  bestReadingElement = null;
}

function shouldApply() {
  if (!currentSettings.enabled) return false;
  if (temporaryMode === "on") return true;

  const siteMode = siteModeForHostname(currentSettings, hostnameFromLocation(location));
  if (siteMode === "off") return false;
  if (siteMode === "on") return true;

  if (detection.status === "unknown") {
    evaluatePage();
  }

  return detection.detectedDark;
}

function activeMode() {
  if (temporaryMode === "on") return "temporary";

  const siteMode = siteModeForHostname(currentSettings, hostnameFromLocation(location));
  if (siteMode === "on") return "forced";
  if (detection.detectedDark) return "auto";
  return "auto";
}

function css(settings) {
  return `
    html[${ROOT_ATTR}="on"] {
      --light-reader-bg: ${settings.backgroundColor};
      --light-reader-text: ${settings.textColor};
      --light-reader-link: ${settings.linkColor};
      color-scheme: light !important;
      background: var(--light-reader-bg) !important;
    }

    html[${ROOT_ATTR}="on"],
    html[${ROOT_ATTR}="on"] body {
      background: var(--light-reader-bg) !important;
    }

    html[${ROOT_ATTR}="on"] [${SHELL_ATTR}="true"],
    html[${ROOT_ATTR}="on"] [${TARGET_ATTR}="true"],
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="forced"] body,
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="temporary"] body,
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="forced"] :is(main, article, [role="main"], .content, #content, .entry-content, .post-content, .page-content, .article-content, .article-body, .story-body, .markdown-body, .prose),
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="temporary"] :is(main, article, [role="main"], .content, #content, .entry-content, .post-content, .page-content, .article-content, .article-body, .story-body, .markdown-body, .prose) {
      background-color: var(--light-reader-bg) !important;
      background-image: none !important;
    }

    html[${ROOT_ATTR}="on"] [${TARGET_ATTR}="true"],
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="forced"] body,
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="temporary"] body,
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="forced"] :is(main, article, [role="main"], .content, #content, .entry-content, .post-content, .page-content, .article-content, .article-body, .story-body, .markdown-body, .prose),
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="temporary"] :is(main, article, [role="main"], .content, #content, .entry-content, .post-content, .page-content, .article-content, .article-body, .story-body, .markdown-body, .prose) {
      color: var(--light-reader-text) !important;
    }

    html[${ROOT_ATTR}="on"] [${TARGET_ATTR}="true"]
      :is(p, li, dd, dt, blockquote, figcaption, summary, details, h1, h2, h3, h4, h5, h6, span, strong, em, b, i, small, code, pre, table, th, td),
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="forced"] :is(main, article, [role="main"], .content, #content, .entry-content, .post-content, .page-content, .article-content, .article-body, .story-body, .markdown-body, .prose)
      :is(p, li, dd, dt, blockquote, figcaption, summary, details, h1, h2, h3, h4, h5, h6, span, strong, em, b, i, small, code, pre, table, th, td),
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="temporary"] :is(main, article, [role="main"], .content, #content, .entry-content, .post-content, .page-content, .article-content, .article-body, .story-body, .markdown-body, .prose)
      :is(p, li, dd, dt, blockquote, figcaption, summary, details, h1, h2, h3, h4, h5, h6, span, strong, em, b, i, small, code, pre, table, th, td) {
      color: var(--light-reader-text) !important;
      text-shadow: none !important;
    }

    html[${ROOT_ATTR}="on"] [${TARGET_ATTR}="true"] :is(pre, code, blockquote, table, thead, tbody, tr, th, td),
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="forced"] :is(pre, code, blockquote, table, thead, tbody, tr, th, td),
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="temporary"] :is(pre, code, blockquote, table, thead, tbody, tr, th, td) {
      background-color: color-mix(in srgb, var(--light-reader-bg) 92%, black) !important;
      border-color: color-mix(in srgb, var(--light-reader-bg) 78%, black) !important;
    }

    html[${ROOT_ATTR}="on"] [${TARGET_ATTR}="true"] a,
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="forced"] a,
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="temporary"] a {
      color: var(--light-reader-link) !important;
    }

    html[${ROOT_ATTR}="on"] img,
    html[${ROOT_ATTR}="on"] video,
    html[${ROOT_ATTR}="on"] canvas,
    html[${ROOT_ATTR}="on"] svg {
      filter: none !important;
    }
  `;
}

function ensureStyle() {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.documentElement.append(style);
  }

  const nextCss = css(currentSettings);
  if (style.textContent !== nextCss) {
    style.textContent = nextCss;
  }
}

function applyState() {
  ensureStyle();

  const isActive = shouldApply();
  const mode = activeMode();

  if (isActive && mode !== "auto" && !bestReadingElement) {
    evaluatePage();
  }

  const target = mode === "auto" ? bestReadingElement : bestReadingElement || document.body;

  if (isActive) {
    markTarget(target);
    document.documentElement.setAttribute(MODE_ATTR, mode);
    document.documentElement.setAttribute(ROOT_ATTR, "on");
  } else {
    clearTargets();
    document.documentElement.removeAttribute(MODE_ATTR);
    document.documentElement.setAttribute(ROOT_ATTR, "off");
  }
}

function scheduleRecheck(reason, delay = RECHECK_DELAY_MS) {
  if (recheckTimer) window.clearTimeout(recheckTimer);

  recheckTimer = window.setTimeout(() => {
    recheckTimer = 0;
    resetDetection(reason);
    applyState();
  }, delay);
}

function delayedRecheck(reason, delay) {
  window.setTimeout(() => {
    resetDetection(reason);
    applyState();
  }, delay);
}

function loadSettings() {
  chrome.storage.sync.get(globalThis.LightReaderShared.DEFAULTS, (settings) => {
    currentSettings = sanitizeSettings(settings);
    applyState();
    delayedRecheck("Page content settled after load.", 1200);
    delayedRecheck("Late-loading content settled.", 3000);
  });
}

function statusReason(isActive, siteMode) {
  if (!currentSettings.enabled) return "Extension is off.";
  if (temporaryMode === "on") return "Temporarily lightened for this tab.";
  if (siteMode === "on") return "Always lighten is enabled for this site.";
  if (siteMode === "off") return "Never lighten is enabled for this site.";
  if (isActive) return "Auto-detected dark reading content.";
  return detection.reason;
}

function sendStatus(sendResponse) {
  const siteMode = siteModeForHostname(currentSettings, hostnameFromLocation(location));
  const active = document.documentElement.getAttribute(ROOT_ATTR) === "on";

  sendResponse({
    active,
    hostname: hostnameFromLocation(location),
    siteMode,
    detectedDark: detection.detectedDark,
    reason: statusReason(active, siteMode),
    temporary: temporaryMode === "on"
  });
}

function installRouteWatcher() {
  const notifyRouteChange = () => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    temporaryMode = "auto";
    scheduleRecheck("Page route changed.", 120);
  };

  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      window.setTimeout(notifyRouteChange, 0);
      return result;
    };
  }

  window.addEventListener("popstate", notifyRouteChange);
  window.addEventListener("hashchange", notifyRouteChange);
  window.setInterval(notifyRouteChange, 500);
}

function installMutationWatcher() {
  const observer = new MutationObserver((mutations) => {
    const hasContentChange = mutations.some((mutation) => mutation.addedNodes.length || mutation.removedNodes.length);
    if (hasContentChange) {
      scheduleRecheck("Page content changed.");
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;

  currentSettings = sanitizeSettings({
    ...currentSettings,
    ...Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, change.newValue]))
  });

  applyState();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MESSAGE_TYPES.status) {
    if (detection.status === "unknown") applyState();
    sendStatus(sendResponse);
    return;
  }

  if (message?.type === MESSAGE_TYPES.refresh) {
    resetDetection("Detection refreshed.");
    applyState();
    sendStatus(sendResponse);
    return;
  }

  if (message?.type === MESSAGE_TYPES.temporaryMode) {
    temporaryMode = message.mode === "on" ? "on" : "auto";
    applyState();
    sendStatus(sendResponse);
  }
});

installRouteWatcher();
installMutationWatcher();
loadSettings();
