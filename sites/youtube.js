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
      // Pausing once is not enough: a newly loaded page autoplays after the
      // player reports ready, seekTo starts an unstarted player, and the video
      // resumes on its own after an ad, including a second ad in a row.
      // Keep pausing until the player has stayed in the paused state for a second;
      // unstarted, buffering, and cued do not count, since autoplay may still follow.
      func: async (time) => {
        const player = document.getElementById("movie_player");
        if (!player?.seekTo) throw new Error("YouTube player not found");
        const PLAYING = 1, PAUSED = 2, STEP_MS = 200, SETTLE_STEPS = 5, WATCH_MS = 5000, MAX_MS = 90000;
        player.pauseVideo();
        player.seekTo(time, true);
        const start = Date.now();
        let deadline = start + WATCH_MS, settled = 0;
        while (settled < SETTLE_STEPS && Date.now() < Math.min(deadline, start + MAX_MS)) {
          await new Promise((resolve) => setTimeout(resolve, STEP_MS));
          if (player.classList.contains("ad-showing")) {
            settled = 0;
            deadline = Date.now() + WATCH_MS;
            continue;
          }
          const state = player.getPlayerState();
          if (state === PLAYING) {
            player.pauseVideo();
            if (Math.abs(player.getCurrentTime() - time) > 2) player.seekTo(time, true);
          }
          settled = state === PAUSED ? settled + 1 : 0;
        }
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
