window.SiteAdapters = window.SiteAdapters || [];

// Runs in the page, so it cannot use anything outside its own body.
// play.js on the page keeps its Clappr player in the global _player.
function ivodSeek(time, play) {
  const player = window._player;
  if (!player?.seek) throw new Error("IVOD player not found");
  player.pause();
  player.seek(time);
  if (play) player.play();
}

window.SiteAdapters.push({
  id: "ivod",
  name: "立法院議事轉播 IVOD",
  // Keep in sync with host_permissions and content_scripts in manifest.json.
  urlPattern: "https://ivod.ly.gov.tw/*",

  matches(url) {
    return typeof url === "string" && url.startsWith("https://ivod.ly.gov.tw/");
  },

  async getState(tabId) {
    return chrome.tabs.sendMessage(tabId, { type: "GET_VIDEO_STATE" });
  },

  // True once play.js has created the player. The stream itself loads only
  // after playback starts, so the duration is not available yet.
  async isReady(tabId) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => typeof window._player?.seek === "function"
    });
    return result;
  },

  async cue(tabId, target) {
    return chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: ivodSeek, args: [target, false] });
  },

  async play(tabId, target) {
    return chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: ivodSeek, args: [target, true] });
  }
});
