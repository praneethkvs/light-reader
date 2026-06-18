importScripts("light-reader-shared.js");

const { MESSAGE_TYPES } = globalThis.LightReaderShared;

function sendMessage(tabId, message, callback) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (chrome.runtime.lastError || !response) {
      callback(null);
      return;
    }

    callback(response);
  });
}

function toggleLightenNow() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id) return;

    sendMessage(tab.id, { type: MESSAGE_TYPES.status }, (status) => {
      if (!status) return;

      const mode = status.temporary ? "auto" : "on";
      sendMessage(tab.id, { type: MESSAGE_TYPES.temporaryMode, mode }, () => {});
    });
  });
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-lighten-now") {
    toggleLightenNow();
  }
});
