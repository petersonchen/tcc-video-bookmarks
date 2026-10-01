window.SiteAdapters = window.SiteAdapters || [];

window.SiteAdapters.push({
  id: "tcc",
  name: "臺北市議會雲端議事影音",

  matches(url) {
    return typeof url === "string" && url.startsWith("https://live.tcc.gov.tw/");
  },

  async getState(tabId) {
    return chrome.tabs.sendMessage(tabId, { type: "TCC_GET_VIDEO_STATE" });
  },

  async cue(tabId, target) {
    return chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (time) => {
        const player = window.videojs?.getPlayer?.("vdoVideo") || window.videojs?.("vdoVideo");
        if (!player) throw new Error("Video.js player not found");
        player.pause();
        player.currentTime(time);
      },
      args: [target]
    });
  },

  async play(tabId, target) {
    return chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (time) => {
        const player = window.videojs?.getPlayer?.("vdoVideo") || window.videojs?.("vdoVideo");
        if (!player) throw new Error("Video.js player not found");
        player.pause();
        player.one("seeked", () => {
          Promise.resolve(player.play()).catch(() => {});
        });
        player.currentTime(time);
      },
      args: [target]
    });
  }
});
