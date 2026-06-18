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
const BACKDROP_ATTR = "data-light-reader-backdrop";
const MODE_ATTR = "data-light-reader-mode";
const MIN_READING_SCORE = 7;
const MIN_UNCERTAIN_SCORE = 4.5;
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
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre"
].join(",");

const BACKDROP_CANDIDATE_SELECTOR = [
  "main",
  "article",
  "header",
  "nav",
  "section",
  "div",
  "blockquote",
  "li",
  "dd",
  "td",
  "th",
  "[role='banner']",
  "[role='navigation']"
].join(",");

const BACKDROP_CHROME_SELECTOR = [
  "header",
  "nav",
  "[role='banner']",
  "[role='navigation']"
].join(",");

const READABLE_INLINE_SELECTOR = [
  "a",
  "button",
  "span",
  "strong",
  "em",
  "b",
  "i",
  "small",
  "summary",
  "label",
  "svg"
].join(",");

const BACKDROP_EXCLUDED_SELECTOR = [
  "button",
  "input",
  "select",
  "textarea",
  "iframe",
  "picture",
  "img",
  "video",
  "canvas",
  "svg",
  "pre",
  "code",
  "table"
].join(",");

let currentSettings = sanitizeSettings();
let temporaryMode = "auto";
let detection = {
  status: "unknown",
  detectedDark: false,
  uncertain: false,
  reason: "Page has not been checked yet.",
  score: 0,
  signals: {}
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

function hasBackgroundImage(style) {
  return Boolean(style.backgroundImage && style.backgroundImage !== "none");
}

function effectiveBackgroundProfile(element) {
  let node = element;
  let hasImageBackdrop = false;

  while (node && node.nodeType === Node.ELEMENT_NODE) {
    const style = getComputedStyle(node);
    if (hasBackgroundImage(style)) {
      hasImageBackdrop = true;
    }

    const color = parseRgb(style.backgroundColor);
    if (color) {
      return { color, hasImageBackdrop };
    }

    node = node.parentElement;
  }

  const rootStyle = getComputedStyle(document.documentElement);
  if (hasBackgroundImage(rootStyle)) {
    hasImageBackdrop = true;
  }

  return {
    color: parseRgb(rootStyle.backgroundColor) || [255, 255, 255],
    hasImageBackdrop
  };
}

function backgroundAttachmentIsFixed(style) {
  return typeof style.backgroundAttachment === "string" && style.backgroundAttachment.includes("fixed");
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
  const background = effectiveBackgroundProfile(element);
  const colorLum = luminance(background.color);
  const ownTextLum = luminance(parseRgb(style.color));
  const descendantTextLum = Math.max(
    0,
    ...visibleTextBlocks(element)
      .slice(0, 10)
      .map((block) => luminance(parseRgb(getComputedStyle(block).color)))
  );
  const textLum = Math.max(ownTextLum, descendantTextLum);
  const imageBackedDarkSurface = background.hasImageBackdrop && textLum > 0.62 && colorLum > 0.28;
  const bgLum = imageBackedDarkSurface ? 0.12 : colorLum;

  return {
    bgLum,
    textLum,
    colorLum,
    hasImageBackdrop: background.hasImageBackdrop,
    isDarkWithLightText: (bgLum < 0.28 || imageBackedDarkSurface) && textLum > 0.62
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
    semantic: semanticScore(element),
    centrality: centralityScore(element),
    controls,
    links,
    controlPenalty,
    linkPenalty,
    bgLum: Math.round(contrast.bgLum * 100) / 100,
    textLum: Math.round(contrast.textLum * 100) / 100,
    imageBackdrop: contrast.hasImageBackdrop,
    textLength: totalTextLength,
    blocks: blocks.length,
    area
  };
}

function elementLabel(element) {
  if (!element) return "none";
  const name = element.tagName.toLowerCase();
  if (element.id) return `${name}#${element.id}`;
  const className = Array.from(element.classList || []).slice(0, 2).join(".");
  return className ? `${name}.${className}` : name;
}

function detectionSignals(candidate, cleanupCount = 0) {
  if (!candidate) return {};

  return {
    target: elementLabel(candidate.element),
    score: Math.round(candidate.score * 10) / 10,
    textBlocks: candidate.blocks,
    textLength: candidate.textLength,
    controls: candidate.controls,
    links: candidate.links,
    controlHeavy: isControlHeavy(candidate),
    controlPenalty: Math.round(candidate.controlPenalty * 10) / 10,
    linkPenalty: Math.round(candidate.linkPenalty * 10) / 10,
    backgroundLuminance: candidate.bgLum,
    textLuminance: candidate.textLum,
    imageBackdrop: candidate.imageBackdrop,
    cleanupTargets: cleanupCount
  };
}

function isControlHeavy(candidate) {
  return candidate.controls >= 6 && candidate.controls >= Math.max(candidate.blocks * 2, 4);
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
    for (let depth = 0; node && depth < 5; depth += 1) {
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

  for (const element of document.querySelectorAll(`[${BACKDROP_ATTR}]`)) {
    element.removeAttribute(BACKDROP_ATTR);
  }
}

function hasDarkBackdrop(style) {
  const backgroundImage = hasBackgroundImage(style);
  const backgroundColor = parseRgb(style.backgroundColor);
  const fixedBackground = backgroundImage && backgroundAttachmentIsFixed(style);
  const shadow = style.boxShadow && style.boxShadow !== "none";
  return backgroundImage || fixedBackground || shadow || (backgroundColor && luminance(backgroundColor) < 0.42);
}

function pseudoHasBackdrop(element, pseudoElement) {
  const style = getComputedStyle(element, pseudoElement);
  const hasContent = style.content && style.content !== "none" && style.content !== "normal";
  return hasContent && hasDarkBackdrop(style);
}

function shouldNeutralizeBackdrop(element) {
  const isNestedChrome = element.matches(BACKDROP_CHROME_SELECTOR);
  if (!isVisibleElement(element) || (!isNestedChrome && isExcludedChrome(element))) return false;
  if (element.matches(BACKDROP_EXCLUDED_SELECTOR) || element.closest(BACKDROP_EXCLUDED_SELECTOR)) return false;
  if (visibleArea(element) < 900 || textLength(element) < 35) return false;

  const style = getComputedStyle(element);
  return hasDarkBackdrop(style) || pseudoHasBackdrop(element, "::before") || pseudoHasBackdrop(element, "::after");
}

function markNestedBackdrops(target) {
  if (!target) return;

  let marked = 0;
  const candidates = [target, ...target.querySelectorAll(BACKDROP_CANDIDATE_SELECTOR)];
  for (const element of candidates) {
    if (element !== target && shouldNeutralizeBackdrop(element)) {
      element.setAttribute(BACKDROP_ATTR, "true");
      marked += 1;
    }
  }

  detection.signals = {
    ...detection.signals,
    cleanupTargets: marked
  };
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

    if (best && best.score >= MIN_READING_SCORE && !isControlHeavy(best)) {
      detection = {
        status: "active",
        detectedDark: true,
        uncertain: false,
        reason: "Dark reading content detected.",
        score: Math.round(best.score * 10) / 10,
        signals: detectionSignals(best)
      };
      return;
    }

    if (best && best.score >= MIN_UNCERTAIN_SCORE && best.blocks >= 2 && best.textLength >= 250) {
      detection = {
        status: "uncertain",
        detectedDark: false,
        uncertain: true,
        reason: "Looks dark. Lighten this page?",
        score: Math.round(best.score * 10) / 10,
        signals: detectionSignals(best)
      };
      return;
    }

    detection = {
      status: "inactive",
      detectedDark: false,
      uncertain: false,
      reason: best ? "Page is dark, but does not look like a reading surface." : "No dark reading content detected.",
      score: best ? Math.round(best.score * 10) / 10 : 0,
      signals: best ? detectionSignals(best) : {}
    };
  });
}

function resetDetection(reason) {
  detection = {
    status: "unknown",
    detectedDark: false,
    uncertain: false,
    reason,
    score: 0,
    signals: {}
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

    html[${ROOT_ATTR}="on"] [${SHELL_ATTR}="true"] {
      color: var(--light-reader-text) !important;
    }

    html[${ROOT_ATTR}="on"] [${SHELL_ATTR}="true"],
    html[${ROOT_ATTR}="on"] [${TARGET_ATTR}="true"],
    html[${ROOT_ATTR}="on"] [${BACKDROP_ATTR}="true"],
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="forced"] body,
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="temporary"] body,
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="forced"] :is(main, article, [role="main"], .content, #content, .entry-content, .post-content, .page-content, .article-content, .article-body, .story-body, .markdown-body, .prose),
    html[${ROOT_ATTR}="on"][${MODE_ATTR}="temporary"] :is(main, article, [role="main"], .content, #content, .entry-content, .post-content, .page-content, .article-content, .article-body, .story-body, .markdown-body, .prose) {
      background-color: var(--light-reader-bg) !important;
      background-image: none !important;
    }

    html[${ROOT_ATTR}="on"] [${BACKDROP_ATTR}="true"],
    html[${ROOT_ATTR}="on"] [${TARGET_ATTR}="true"]::before,
    html[${ROOT_ATTR}="on"] [${TARGET_ATTR}="true"]::after,
    html[${ROOT_ATTR}="on"] [${BACKDROP_ATTR}="true"]::before,
    html[${ROOT_ATTR}="on"] [${BACKDROP_ATTR}="true"]::after {
      background-color: transparent !important;
      background-image: none !important;
      box-shadow: none !important;
      text-shadow: none !important;
    }

    html[${ROOT_ATTR}="on"] [${SHELL_ATTR}="true"] :is(header, nav, [role="banner"], [role="navigation"]) :is(${READABLE_INLINE_SELECTOR}),
    html[${ROOT_ATTR}="on"] [${BACKDROP_ATTR}="true"] :is(${READABLE_INLINE_SELECTOR}) {
      color: var(--light-reader-text) !important;
      fill: currentColor !important;
      stroke: currentColor !important;
      text-shadow: none !important;
    }

    html[${ROOT_ATTR}="on"] [${TARGET_ATTR}="true"],
    html[${ROOT_ATTR}="on"] [${BACKDROP_ATTR}="true"],
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
    withLightReaderDisabled(() => {
      markTarget(target);
      markNestedBackdrops(target);
    });
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
    detectionStatus: detection.status,
    detectedDark: detection.detectedDark,
    uncertain: detection.uncertain,
    reason: statusReason(active, siteMode),
    score: detection.score,
    temporary: temporaryMode === "on",
    signals: detection.signals || {}
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
