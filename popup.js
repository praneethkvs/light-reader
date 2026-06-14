const {
  DEFAULTS,
  MESSAGE_TYPES,
  PRESETS,
  SITE_MODE_LABELS,
  normalizeHex,
  presetForColor,
  sanitizeSettings,
  sanitizeSiteModes,
  siteModeForHostname
} = globalThis.LightReaderShared;

const enabled = document.getElementById("enabled");
const backgroundColor = document.getElementById("backgroundColor");
const backgroundText = document.getElementById("backgroundText");
const presetList = document.getElementById("presetList");
const siteMode = document.getElementById("siteMode");
const siteModeButtons = document.getElementById("siteModeButtons");
const siteModeHint = document.getElementById("siteModeHint");
const status = document.getElementById("status");
const reset = document.getElementById("reset");
const setDefaultShade = document.getElementById("setDefaultShade");
const defaultShadeHint = document.getElementById("defaultShadeHint");
const lightenNow = document.getElementById("lightenNow");
const alwaysLighten = document.getElementById("alwaysLighten");
const alwaysLightenList = document.getElementById("alwaysLightenList");
const siteCount = document.getElementById("siteCount");
const moreOptions = document.getElementById("moreOptions");
const optionsMenu = document.getElementById("optionsMenu");
const howItWorks = document.getElementById("howItWorks");
const support = document.getElementById("support");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalViews = Array.from(document.querySelectorAll(".modal-panel"));
const copyDiagnostics = document.getElementById("copyDiagnostics");
const emailSupport = document.getElementById("emailSupport");
const diagnosticsSummary = document.getElementById("diagnosticsSummary");
const extensionVersion = document.getElementById("extensionVersion");
const aboutMode = document.getElementById("aboutMode");
const confirmResetAll = document.getElementById("confirmResetAll");
const tooltip = document.createElement("div");

let currentHostname = "";
let currentTabId = null;
let currentTabTemporary = false;
let pageActionsAvailable = false;
let tooltipTarget = null;
let settings = sanitizeSettings(DEFAULTS);

const SITE_MODE_HINTS = {
  auto: "Auto detect dark pages.",
  on: "Always run on this site.",
  off: "Never run on this site."
};

tooltip.className = "tooltip-bubble";
tooltip.setAttribute("role", "tooltip");
document.body.append(tooltip);

function save(partial, afterSave) {
  settings = sanitizeSettings({ ...settings, ...partial });
  chrome.storage.sync.set(partial, () => {
    if (afterSave) afterSave();
  });
}

function currentSiteMode() {
  return siteModeForHostname(settings, currentHostname);
}

function setPageActionsAvailable(isAvailable) {
  pageActionsAvailable = isAvailable;
  siteMode.disabled = !isAvailable;
  lightenNow.disabled = !isAvailable;

  for (const button of siteModeButtons.querySelectorAll("button")) {
    button.disabled = !isAvailable;
  }

  updateSiteButton();
}

function updatePresetButtons() {
  const activePreset = presetForColor(settings.backgroundColor);

  for (const button of presetList.querySelectorAll("button")) {
    button.dataset.active = String(
      activePreset ? button.dataset.preset === activePreset.id : button.dataset.preset === "custom"
    );
  }
}

function updateSiteButton() {
  const isAlwaysLighten = currentSiteMode() === "on";
  alwaysLighten.dataset.active = String(isAlwaysLighten);
  alwaysLighten.disabled = !pageActionsAvailable || isAlwaysLighten;
  alwaysLighten.textContent = isAlwaysLighten ? "Saved" : "Add current site";
  alwaysLighten.dataset.tooltip = isAlwaysLighten ? "This site is already saved" : "Save this site to always lighten";

  if (alwaysLighten.disabled) hideTooltip(alwaysLighten);
}

function updateSiteModeButtons() {
  const mode = currentSiteMode();

  for (const button of siteModeButtons.querySelectorAll("button")) {
    button.dataset.active = String(button.dataset.mode === mode);
  }

  siteModeHint.textContent = SITE_MODE_HINTS[mode] || SITE_MODE_HINTS.auto;
}

function updateLightenNowButton() {
  lightenNow.dataset.active = String(currentTabTemporary);
  lightenNow.textContent = currentTabTemporary ? "Return to Auto" : "Lighten Now";
  lightenNow.dataset.tooltip = currentTabTemporary ? "Stop temporary lightening" : "Apply temporarily without saving";
}

function shadeLabel(color) {
  const preset = presetForColor(color);
  return preset ? preset.label : color;
}

function updateDefaultShadeUI() {
  const isCurrentDefault = settings.backgroundColor === settings.defaultBackgroundColor;
  defaultShadeHint.textContent = `Default: ${shadeLabel(settings.defaultBackgroundColor)}`;
  setDefaultShade.textContent = isCurrentDefault ? "Default saved" : "Set default";
  setDefaultShade.dataset.active = String(isCurrentDefault);
  setDefaultShade.dataset.tooltip = isCurrentDefault
    ? "This shade is your default"
    : "Use current shade when resetting";
  reset.dataset.tooltip = `Restore ${shadeLabel(settings.defaultBackgroundColor)}`;
}

function positionTooltip(target) {
  const margin = 12;
  tooltip.style.maxWidth = `${Math.max(120, window.innerWidth - margin * 2)}px`;
  tooltip.style.left = "0";
  tooltip.style.top = "0";

  const targetRect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const centeredLeft = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
  const left = Math.max(margin, Math.min(centeredLeft, window.innerWidth - tooltipRect.width - margin));
  let top = targetRect.top - tooltipRect.height - margin;

  if (top < margin) {
    top = targetRect.bottom + margin;
  }

  top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function showTooltip(target) {
  const message = target.dataset.tooltip;
  if (!message || target.disabled) return;

  tooltipTarget = target;
  tooltip.textContent = message;
  tooltip.dataset.visible = "true";
  positionTooltip(target);
}

function hideTooltip(target) {
  if (target && target !== tooltipTarget) return;

  tooltipTarget = null;
  tooltip.dataset.visible = "false";
}

function alwaysLightenSites() {
  return Object.entries(settings.siteModes)
    .filter(([, mode]) => mode === "on")
    .map(([site]) => site)
    .sort((a, b) => a.localeCompare(b));
}

function renderAlwaysLightenList() {
  const sites = alwaysLightenSites();
  siteCount.textContent = String(sites.length);
  alwaysLightenList.textContent = "";

  if (sites.length === 0) {
    const empty = document.createElement("p");
    empty.className = "site-empty";
    empty.textContent = "No saved sites.";
    alwaysLightenList.append(empty);
    return;
  }

  for (const site of sites) {
    const row = document.createElement("div");
    row.className = "site-item";

    const name = document.createElement("span");
    name.className = "site-name";
    name.dataset.tooltip = site;
    name.textContent = site;

    const remove = document.createElement("button");
    remove.className = "remove-site";
    remove.type = "button";
    remove.dataset.site = site;
    remove.dataset.tooltip = `Remove ${site}`;
    remove.setAttribute("aria-label", `Remove ${site}`);

    const icon = document.createElement("span");
    icon.className = "site-icon";
    icon.textContent = site[0] || "L";

    const state = document.createElement("span");
    state.className = "site-state";
    state.textContent = "On";

    row.append(icon, name, state, remove);
    alwaysLightenList.append(row);
  }
}

function renderPresets() {
  presetList.textContent = "";

  for (const preset of PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset";
    button.dataset.preset = preset.id;
    button.dataset.color = preset.color;
    button.dataset.tooltip = `${preset.label} ${preset.color}`;
    button.innerHTML = `<span style="--swatch:${preset.color}"></span>${preset.label}`;
    presetList.append(button);
  }

}

function render() {
  enabled.checked = settings.enabled;
  backgroundColor.value = settings.backgroundColor;
  backgroundText.value = settings.backgroundColor;
  siteMode.value = currentSiteMode();
  updatePresetButtons();
  updateDefaultShadeUI();
  updateSiteButton();
  updateSiteModeButtons();
  updateLightenNowButton();
  renderAlwaysLightenList();
}

function statusText(response) {
  if (!settings.enabled) return "Extension is off.";
  if (response.temporary) return "Temporarily lightening this page.";
  if (currentSiteMode() === "on") return "Always lightening this site.";
  if (currentSiteMode() === "off") return "Never lightening this site.";
  if (response.active) return "Auto-lightening this page.";
  if (response.detectedDark) return "Dark content detected, but not active.";
  if (response.reason?.includes("does not look like a reading surface")) return "Not a reading surface.";
  return response.reason || "No dark reading content found.";
}

function unavailableStatus() {
  currentHostname = "";
  currentTabTemporary = false;
  status.textContent = "Not available on this page.";
  setPageActionsAvailable(false);
  render();
}

function applyStatusResponse(response) {
  currentHostname = response.hostname;
  currentTabTemporary = response.temporary;
  status.textContent = statusText(response);
  setPageActionsAvailable(true);
  render();
}

function extensionVersionText() {
  return chrome.runtime.getManifest?.().version || "0.3.0";
}

function diagnosticPairs() {
  const mode = currentSiteMode();
  return [
    ["Version", extensionVersionText()],
    ["Status", status.textContent || "Unknown"],
    ["Host", currentHostname || "Unavailable"],
    ["Enabled", settings.enabled ? "Yes" : "No"],
    ["Site mode", SITE_MODE_LABELS[mode] || mode],
    ["Temporary", currentTabTemporary ? "Yes" : "No"],
    ["Shade", settings.backgroundColor],
    ["Default shade", settings.defaultBackgroundColor]
  ];
}

function diagnosticsText() {
  return diagnosticPairs().map(([label, value]) => `${label}: ${value}`).join("\n");
}

function renderDiagnostics() {
  diagnosticsSummary.textContent = "";

  for (const [label, value] of diagnosticPairs()) {
    const row = document.createElement("div");
    const labelNode = document.createElement("span");
    const valueNode = document.createElement("strong");

    labelNode.textContent = label;
    valueNode.textContent = value;
    row.append(labelNode, valueNode);
    diagnosticsSummary.append(row);
  }
}

function setMenuOpen(isOpen) {
  optionsMenu.hidden = !isOpen;
  moreOptions.setAttribute("aria-expanded", String(isOpen));
  moreOptions.dataset.open = String(isOpen);

  if (isOpen) hideTooltip(moreOptions);
}

function closeMenu() {
  setMenuOpen(false);
}

function openModal(name) {
  const selected = document.getElementById(`${name}Modal`);
  if (!selected) return;

  closeMenu();
  hideTooltip();

  if (name === "support") renderDiagnostics();
  if (name === "about") {
    const mode = currentSiteMode();
    extensionVersion.textContent = extensionVersionText();
    aboutMode.textContent = SITE_MODE_LABELS[mode] || mode;
  }

  modalBackdrop.hidden = false;
  for (const view of modalViews) view.hidden = view !== selected;

  selected.querySelector("[data-close-modal]")?.focus();
}

function closeModal() {
  modalBackdrop.hidden = true;
  for (const view of modalViews) view.hidden = true;

  copyDiagnostics.textContent = "Copy diagnostics";
}

function refreshPageDetection() {
  closeMenu();
  if (!currentTabId) {
    updateStatus();
    return;
  }

  chrome.tabs.sendMessage(currentTabId, { type: MESSAGE_TYPES.refresh }, (response) => {
    if (chrome.runtime.lastError || !response) {
      updateStatus();
      return;
    }

    applyStatusResponse(response);
  });
}

function resetAllSettings() {
  settings = sanitizeSettings(DEFAULTS);
  chrome.storage.sync.set({ ...DEFAULTS, siteModes: {} }, () => {
    render();
    closeModal();

    if (currentTabId) {
      sendTemporaryMode("auto", updateStatus);
      return;
    }

    updateStatus();
  });
}

function sendTemporaryMode(mode, afterSend) {
  if (!currentTabId) return;

  chrome.tabs.sendMessage(currentTabId, { type: MESSAGE_TYPES.temporaryMode, mode }, (response) => {
    if (chrome.runtime.lastError || !response) {
      currentTabTemporary = false;
      updateLightenNowButton();
      return;
    }

    currentTabTemporary = response.temporary;
    if (afterSend) afterSend(response);
  });
}

function updateStatus() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    currentTabId = tab?.id || null;
    if (!currentTabId) {
      unavailableStatus();
      return;
    }

    chrome.tabs.sendMessage(currentTabId, { type: MESSAGE_TYPES.status }, (response) => {
      if (chrome.runtime.lastError || !response) {
        unavailableStatus();
        return;
      }

      applyStatusResponse(response);
    });
  });
}

chrome.storage.sync.get(DEFAULTS, (stored) => {
  settings = sanitizeSettings(stored);
  renderPresets();
  render();
  updateStatus();
});

enabled.addEventListener("change", () => {
  save({ enabled: enabled.checked }, updateStatus);
});

backgroundColor.addEventListener("input", () => {
  backgroundText.value = backgroundColor.value;
  save({ backgroundColor: backgroundColor.value }, render);
});

backgroundText.addEventListener("change", () => {
  const color = normalizeHex(backgroundText.value);
  if (!color) {
    backgroundText.value = settings.backgroundColor;
    return;
  }

  backgroundColor.value = color;
  save({ backgroundColor: color }, render);
});

presetList.addEventListener("click", (event) => {
  const button = event.target.closest(".preset");
  if (!button || button.dataset.preset === "custom") return;

  backgroundColor.value = button.dataset.color;
  backgroundText.value = button.dataset.color;
  save({ backgroundColor: button.dataset.color }, render);
});

siteMode.addEventListener("change", () => {
  if (!currentHostname) return;

  const siteModes = { ...settings.siteModes };
  if (siteMode.value === "auto") {
    delete siteModes[currentHostname];
  } else {
    siteModes[currentHostname] = siteMode.value;
  }

  save({ siteModes: sanitizeSiteModes(siteModes) }, () => {
    sendTemporaryMode("auto", () => {
      render();
      updateStatus();
    });
  });
});

siteModeButtons.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-mode]");
  if (!button || button.disabled) return;

  siteMode.value = button.dataset.mode;
  siteMode.dispatchEvent(new Event("change", { bubbles: true }));
});

lightenNow.addEventListener("click", () => {
  sendTemporaryMode(currentTabTemporary ? "auto" : "on", (response) => {
    currentTabTemporary = response.temporary;
    status.textContent = statusText(response);
    render();
  });
});

reset.addEventListener("click", () => {
  backgroundColor.value = settings.defaultBackgroundColor;
  backgroundText.value = settings.defaultBackgroundColor;
  save({ backgroundColor: settings.defaultBackgroundColor }, render);
});

setDefaultShade.addEventListener("click", () => {
  save({ defaultBackgroundColor: settings.backgroundColor }, render);
});

alwaysLighten.addEventListener("click", () => {
  if (!currentHostname || alwaysLighten.disabled) return;

  const siteModes = sanitizeSiteModes({ ...settings.siteModes, [currentHostname]: "on" });
  save({ siteModes }, () => {
    sendTemporaryMode("auto", () => {
      render();
      updateStatus();
    });
  });
});

alwaysLightenList.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-site");
  if (!button) return;

  const siteModes = { ...settings.siteModes };
  delete siteModes[button.dataset.site];

  save({ siteModes: sanitizeSiteModes(siteModes) }, () => {
    render();
    updateStatus();
  });
});

moreOptions.addEventListener("click", (event) => {
  event.stopPropagation();
  setMenuOpen(optionsMenu.hidden);
});

optionsMenu.addEventListener("click", (event) => {
  const action = event.target.closest("button")?.dataset.menuAction;
  if (!action) return;

  if (action === "refresh") refreshPageDetection();
  if (action === "reset") openModal("reset");
  if (action === "fixtures") {
    closeMenu();
    chrome.tabs.create({ url: chrome.runtime.getURL("fixtures/index.html") });
  }
  if (action === "about") openModal("about");
});

howItWorks.addEventListener("click", () => openModal("how"));
support.addEventListener("click", () => openModal("support"));

modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop || event.target.closest("[data-close-modal]")) {
    closeModal();
  }
});

copyDiagnostics.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(diagnosticsText());
    copyDiagnostics.textContent = "Copied";
  } catch (_error) {
    copyDiagnostics.textContent = "Copy failed";
  }
});

emailSupport.addEventListener("click", () => {
  const subject = encodeURIComponent("Light Reader support");
  const body = encodeURIComponent(`Describe the issue:\n\n\nDiagnostics:\n${diagnosticsText()}`);
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
});

confirmResetAll.addEventListener("click", resetAllSettings);

document.addEventListener("pointerover", (event) => {
  const target = event.target.closest("[data-tooltip]");
  if (target) showTooltip(target);
});

document.addEventListener("pointerout", (event) => {
  const target = event.target.closest("[data-tooltip]");
  if (target && !target.contains(event.relatedTarget)) hideTooltip(target);
});

document.addEventListener("focusin", (event) => {
  const target = event.target.closest("[data-tooltip]");
  if (target) showTooltip(target);
});

document.addEventListener("focusout", (event) => {
  const target = event.target.closest("[data-tooltip]");
  if (target) hideTooltip(target);
});

document.addEventListener("click", (event) => {
  if (!optionsMenu.hidden && !event.target.closest("#optionsMenu") && event.target !== moreOptions) {
    closeMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  if (!modalBackdrop.hidden) {
    closeModal();
    return;
  }

  closeMenu();
});

document.addEventListener("scroll", () => hideTooltip(), true);
window.addEventListener("resize", () => hideTooltip());
