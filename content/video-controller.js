(() => {
  function findVideo() {
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

    // URLSearchParams order can vary; sorting keeps the bookmark key stable.
    url.searchParams.sort();
    return url.href;
  }

  function pageIdentity(video) {
    // Do NOT use currentSrc as the primary key. Streaming URLs can contain
    // temporary tokens and change after every page reload.
    const pageUrl = stablePageUrl();

    // Prefer stable identifiers exposed by the page/player when present.
    const stableId =
      video?.dataset?.videoId ||
      video?.dataset?.id ||
      document.querySelector("[data-video-id]")?.dataset?.videoId ||
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

    if (message?.type === "TCC_CUE" || message?.type === "TCC_PLAY") {
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

      const shouldPlay = message.type === "TCC_PLAY";

      const cue = () => {
        // Pause before seeking, but do not pause again immediately after
        // assigning currentTime. Some streaming players can get stuck in a
        // perpetual loading state if playback state is changed mid-seek.
        video.pause();

        let replied = false;
        const finish = () => {
          if (replied) return;
          replied = true;
          cleanup();
          if (shouldPlay) {
            video.play().catch(() => {});
          }
          sendResponse({ ok: true, time: target, formattedTime: formatTime(target), playing: shouldPlay });
        };
        const cleanup = () => {
          video.removeEventListener("seeked", finish);
          video.removeEventListener("canplay", finish);
        };

        video.addEventListener("seeked", finish, { once: true });
        video.addEventListener("canplay", finish, { once: true });
        video.currentTime = target;

        // Fallback: seeking may complete without either event on some players.
        setTimeout(finish, 2500);
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
