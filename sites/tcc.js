window.SiteAdapters = window.SiteAdapters || [];

// Runs in the page, so it cannot use anything outside its own body.
function tccSeek(time, play) {
  const player = window.videojs?.getPlayer?.("vdoVideo") || window.videojs?.("vdoVideo");
  if (!player) throw new Error("Video.js player not found");
  player.pause();
  if (play) {
    player.one("seeked", () => {
      Promise.resolve(player.play()).catch(() => {});
    });
  }
  player.currentTime(time);
}

window.SiteAdapters.push({
  id: "tcc",
  name: "臺北市議會雲端議事影音",
  // Keep in sync with host_permissions and content_scripts in manifest.json.
  urlPattern: "https://live.tcc.gov.tw/*",

  matches(url) {
    return typeof url === "string" && url.startsWith("https://live.tcc.gov.tw/");
  },

  async getState(tabId) {
    return chrome.tabs.sendMessage(tabId, { type: "GET_VIDEO_STATE" });
  },

  // True once the player can seek; used before CUE / PLAY in a newly opened tab.
  // Uses getPlayer only: calling videojs() here could create a player while polling.
  async isReady(tabId) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const player = window.videojs?.getPlayer?.("vdoVideo");
        return Boolean(player && player.readyState() >= 1);
      }
    });
    return result;
  },

  async cue(tabId, target) {
    return chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: tccSeek, args: [target, false] });
  },

  async play(tabId, target) {
    return chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: tccSeek, args: [target, true] });
  }
});
