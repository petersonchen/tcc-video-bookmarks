(() => {
  function findVideo() {
    const videos = [...document.querySelectorAll("video")];
    return videos.find((video) => Number.isFinite(video.duration) && video.duration > 0) || videos[0] || null;
  }

  function pageIdentity(video) {
    const source =
      video?.currentSrc ||
      video?.src ||
      video?.querySelector("source")?.src ||
      "";

    // Prefer a media URL when available; otherwise use the page URL.
    // Hash is intentionally excluded so navigation fragments do not create duplicates.
    const pageUrl = new URL(location.href);
    pageUrl.hash = "";

    return {
      videoKey: source ? `media:${source}` : `page:${pageUrl.href}`,
      pageUrl: pageUrl.href,
      mediaUrl: source,
      pageTitle: document.title.trim()
    };
  }

  function formatTime(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "TCC_GET_VIDEO_STATE") {
      const video = findVideo();
      if (!video) {
        sendResponse({ ok: false, error: "找不到 HTML5 影片播放器。" });
        return;
      }

      const identity = pageIdentity(video);
      sendResponse({
        ok: true,
        ...identity,
        currentTime: video.currentTime || 0,
        formattedTime: formatTime(video.currentTime)
      });
      return;
    }

    if (message?.type === "TCC_CUE") {
      const video = findVideo();
      if (!video) {
        sendResponse({ ok: false, error: "找不到 HTML5 影片播放器。" });
        return;
      }

      const target = Number(message.time);
      if (!Number.isFinite(target) || target < 0) {
        sendResponse({ ok: false, error: "Bookmark 時間無效。" });
        return;
      }

      const cue = () => {
        video.pause();
        video.currentTime = target;
        video.pause();
        sendResponse({ ok: true, time: target, formattedTime: formatTime(target) });
      };

      if (video.readyState >= 1) {
        cue();
      } else {
        video.addEventListener("loadedmetadata", cue, { once: true });
      }
      return true;
    }
  });
})();
