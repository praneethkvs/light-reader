(function initLightReaderShared(global) {
  const DEFAULTS = Object.freeze({
    enabled: true,
    backgroundColor: "#f8f6ef",
    textColor: "#111111",
    linkColor: "#0645ad",
    siteModes: {}
  });

  const PRESETS = Object.freeze([
    { id: "paper", label: "Paper", color: "#f8f6ef" },
    { id: "warm", label: "Warm", color: "#fff3df" },
    { id: "soft-white", label: "Soft", color: "#fbfaf6" },
    { id: "white", label: "White", color: "#ffffff" }
  ]);

  const MESSAGE_TYPES = Object.freeze({
    status: "light-reader-status",
    refresh: "light-reader-refresh",
    temporaryMode: "light-reader-temporary-mode"
  });

  const SITE_MODE_LABELS = Object.freeze({
    auto: "Auto detect",
    on: "Always lighten",
    off: "Never lighten"
  });

  const STYLE_ID = "light-reader-style";
  const ROOT_ATTR = "data-light-reader";
  const VALID_SITE_MODES = new Set(["auto", "on", "off"]);

  function normalizeHex(value) {
    if (typeof value !== "string") return null;

    const trimmed = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
      return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`.toLowerCase();
    }

    return null;
  }

  function normalizeHostname(value) {
    if (typeof value !== "string") return "";

    return value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .split(":")[0];
  }

  function sanitizeSiteModes(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};

    return Object.entries(value).reduce((siteModes, [site, mode]) => {
      const hostname = normalizeHostname(site);
      if (!hostname || !VALID_SITE_MODES.has(mode) || mode === "auto") return siteModes;

      siteModes[hostname] = mode;
      return siteModes;
    }, {});
  }

  function sanitizeSettings(value) {
    const stored = value && typeof value === "object" ? value : {};

    return {
      enabled: stored.enabled !== false,
      backgroundColor: normalizeHex(stored.backgroundColor) || DEFAULTS.backgroundColor,
      textColor: normalizeHex(stored.textColor) || DEFAULTS.textColor,
      linkColor: normalizeHex(stored.linkColor) || DEFAULTS.linkColor,
      siteModes: sanitizeSiteModes(stored.siteModes)
    };
  }

  function siteModeForHostname(settings, hostname) {
    const normalized = normalizeHostname(hostname);
    return settings.siteModes?.[normalized] || "auto";
  }

  function hostnameFromLocation(locationObject) {
    return normalizeHostname(locationObject?.hostname || "");
  }

  function presetForColor(color) {
    const normalized = normalizeHex(color);
    return PRESETS.find((preset) => preset.color === normalized) || null;
  }

  global.LightReaderShared = Object.freeze({
    DEFAULTS,
    MESSAGE_TYPES,
    PRESETS,
    ROOT_ATTR,
    SITE_MODE_LABELS,
    STYLE_ID,
    hostnameFromLocation,
    normalizeHex,
    normalizeHostname,
    presetForColor,
    sanitizeSettings,
    sanitizeSiteModes,
    siteModeForHostname
  });
})(globalThis);
