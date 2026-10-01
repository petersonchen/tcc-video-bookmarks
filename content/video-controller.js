(() => {
  const site = location.hostname === "www.youtube.com" ? "youtube" : "tcc";

  function findVideo() {
    if (site === "youtube") return document.querySelector("#movie_player video");
    const videos = [...document.querySelectorAll("video")];
    return videos.find((video) => Number.isFinite(video.duration) && video.duration > 0) || videos[0] || null;
  }

  function stablePageUrl() {
    const url = new URL(location.href);
    url.hash = "";

    // Remove common volatile playback/session parameters while retaining
    // parameters that identify the actual TCC video page.
    const volatile = /^(token|auth|signature|sig|expires?|timestamp|ts|session|cache|_)/i;
    [...url.searchParams.keys()].forEach((key) => {
      if (volatile.test(key)) url.searchParams.delete(key);
    });

    // URLSearchParams order can vary; sorting keeps the marker key stable.
    url.searchParams.sort();
    return url.href;
  }

  function youtubeVideoId() {
    const url = new URL(location.href);
    if (url.pathname === "/watch") return url.searchParams.get("v");
    return url.pathname.match(/^\/live\/([\w-]{11})/)?.[1] || null;
  }

  function tccIdentity(video) {
    // Do NOT use currentSrc as the primary key. Streaming URLs can contain
    // temporary tokens and change after every page reload.
    const pageUrl = stablePageUrl();

    // Prefer stable identifiers exposed by the page/player when present.
    const stableId =
      video?.dataset?.videoId ||
      video?.dataset?.id ||
      document.querySelector("[data-video-id]")?.dataset?.videoId ||
      new URL(pageUrl).searchParams.get("vdvno") ||
      new URL(pageUrl).searchParams.get("id") ||
      new URL(pageUrl).searchParams.get("videoId") ||
      new URL(pageUrl).searchParams.get("VideoId") ||
      "";

    return {
      videoKey: stableId ? `tcc:${stableId}` : `page:${pageUrl}`,
      pageUrl,
      mediaUrl: video?.currentSrc || video?.src || video?.querySelector("source")?.src || "",
      pageTitle: document.title.trim()
    };
  }

  function youtubeIdentity(videoId) {
    return {
      videoKey: `youtube:${videoId}`,
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
      const videoId = youtubeVideoId();
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
      ...(site === "youtube" ? youtubeIdentity(youtubeVideoId()) : tccIdentity(video)),
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
