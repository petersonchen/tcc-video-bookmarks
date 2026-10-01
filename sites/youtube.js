window.SiteAdapters = window.SiteAdapters || [];

window.SiteAdapters.push({
  id: "youtube",
  name: "YouTube",

  matches(url) {
    return typeof url === "string" && url.startsWith("https://www.youtube.com/");
  },

  async getState(tabId) {
    return chrome.tabs.sendMessage(tabId, { type: "GET_VIDEO_STATE" });
  },

  async cue(tabId, target) {
    return chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (time) => {
        const player = document.getElementById("movie_player");
        if (!player?.seekTo) throw new Error("YouTube player not found");
        // seekTo keeps a paused player paused, so pause first.
        player.pauseVideo();
        player.seekTo(time, true);
      },
      args: [target]
    });
  },

  async play(tabId, target) {
    return chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (time) => {
        const player = document.getElementById("movie_player");
        if (!player?.seekTo) throw new Error("YouTube player not found");
        player.seekTo(time, true);
        player.playVideo();
      },
      args: [target]
    });
  }
});
