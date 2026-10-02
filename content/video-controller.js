(() => {
  const site = location.hostname === "www.youtube.com" ? "youtube" : "tcc";

  function findVideo() {
    if (site === "youtube") return document.querySelector("#movie_player video");
    const videos = [...document.querySelectorAll("video")];
    return videos.find((video) => Number.isFinite(video.duration) && video.duration > 0) || videos[0] || null;
  }

  function tccIdentity(video) {
    // Do NOT use currentSrc as the primary key. Streaming URLs can contain
    // temporary tokens and change after every page reload.
    const pageUrl = stableTccUrl(new URL(location.href));
    return {
      videoKey: videoKeyFromUrl(pageUrl),
      pageUrl,
      mediaUrl: video?.currentSrc || video?.src || video?.querySelector("source")?.src || "",
      // document.title is the same site name on every TCC video page, so use
      // the meeting name shown above the player.
      pageTitle: document.getElementById("aTitle")?.textContent.replace(/\s+/g, " ").trim() || document.title.trim()
    };
  }

  function youtubeIdentity(videoId) {
    return {
      videoKey: videoKeyFromUrl(location.href),
      pageUrl: `https://www.youtube.com/watch?v=${videoId}`,
      mediaUrl: "",
      // Strip the unread-notification count and the " - YouTube" suffix.
      pageTitle: document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*-\s*YouTube$/, "").trim()
    };
  }

  function formatTime(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  }

  function videoState() {
    if (site === "youtube") {
      const videoId = youtubeVideoId(new URL(location.href));
      if (!videoId) return { ok: false, error: "請開啟 YouTube 影片頁面（watch 或 live）。" };
      // During an ad the <video> element plays the ad, so its time is not the video's time.
      if (document.getElementById("movie_player")?.classList.contains("ad-showing")) {
        return { ok: false, error: "廣告播放中，請等廣告結束後再試。" };
      }
    }

    const video = findVideo();
    if (!video) return { ok: false, error: "找不到 HTML5 影片播放器。" };

    return {
      ok: true,
      site,
      ...(site === "youtube" ? youtubeIdentity(youtubeVideoId(new URL(location.href))) : tccIdentity(video)),
      currentTime: video.currentTime || 0,
      formattedTime: formatTime(video.currentTime)
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "GET_VIDEO_STATE") return;

    const state = videoState();
    // The script runs in every frame. Frames without a video stay silent so
    // they do not answer before the frame that has the player.
    if (!state.ok && window !== window.top) return;
    sendResponse(state);
  });
})();
