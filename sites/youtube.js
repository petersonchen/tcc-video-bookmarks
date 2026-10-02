window.SiteAdapters = window.SiteAdapters || [];

window.SiteAdapters.push({
  id: "youtube",
  name: "YouTube",
  // Keep in sync with host_permissions and content_scripts in manifest.json.
  urlPattern: "https://www.youtube.com/*",

  matches(url) {
    return typeof url === "string" && url.startsWith("https://www.youtube.com/");
  },

  // YouTube starts a watch page at its t parameter, so a new page skips the opening.
  startUrl(pageUrl, time) {
    const url = new URL(pageUrl);
    url.searchParams.set("t", `${Math.floor(time)}s`);
    return url.href;
  },

  async getState(tabId) {
    return chrome.tabs.sendMessage(tabId, { type: "GET_VIDEO_STATE" });
  },

  // True once the player can seek and no ad is playing.
  async isReady(tabId) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const player = document.getElementById("movie_player");
        return Boolean(player?.seekTo && player.getDuration?.() > 0 && !player.classList.contains("ad-showing"));
      }
    });
    return result;
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
