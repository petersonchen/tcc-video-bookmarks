(() => {
  const site = { "www.youtube.com": "youtube", "ivod.ly.gov.tw": "ivod" }[location.hostname] || "tcc";

  function findVideo() {
    if (site === "youtube") return document.querySelector("#movie_player video");
    if (site === "ivod") return document.querySelector("#fPlayer video");
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

  // The page labels each detail with a <strong> inside a <p>, e.g. "會議名稱：".
  function ivodDetail(label) {
    const strong = [...document.querySelectorAll("p > strong")].find((node) => node.textContent.trim().startsWith(label));
    return strong?.parentElement.textContent.replace(/\s+/g, " ").trim().slice(strong.textContent.trim().length).trim() || "";
  }

  function ivodIdentity() {
    const video = ivodVideo(new URL(location.href));
    // The meeting name continues with the full agenda; keep only the name.
    const meeting = ivodDetail("會議名稱").split("（事由")[0].trim();
    const member = video.kind === "Clip" ? ivodDetail("委員名稱") : "";
    return {
      videoKey: videoKeyFromUrl(location.href),
      pageUrl: `https://ivod.ly.gov.tw/Play/${video.kind}/${video.bandwidth}/${video.id}`,
      mediaUrl: "",
      pageTitle: [meeting, member].filter(Boolean).join(" ") || document.title.trim()
    };
  }

  function identity(video) {
    if (site === "youtube") return youtubeIdentity(youtubeVideoId(new URL(location.href)));
    if (site === "ivod") return ivodIdentity();
    return tccIdentity(video);
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
    if (site === "ivod" && !ivodVideo(new URL(location.href))) {
      return { ok: false, error: "請開啟 IVOD 的影片播放頁面。" };
    }

    const video = findVideo();
    if (!video) return { ok: false, error: "找不到 HTML5 影片播放器。" };

    return {
      ok: true,
      site,
      ...identity(video),
      currentTime: video.currentTime || 0,
      formattedTime: formatTime(video.currentTime)
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "GET_VIDEO_STATE") return;

    sendResponse(videoState());
  });
})();
