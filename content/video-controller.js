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
      const isBackwardSeek = target < video.currentTime - 1;

      const cue = () => {
        video.pause();

        let replied = false;
        let fallbackTimer;

        const respond = (ok, error) => {
          if (replied) return;
          replied = true;
          clearTimeout(fallbackTimer);
          if (ok) {
            sendResponse({
              ok: true,
              time: target,
              formattedTime: formatTime(target),
              playing: shouldPlay
            });
          } else {
            sendResponse({ ok: false, error });
          }
        };

        const playIfNeeded = async () => {
          if (!shouldPlay) {
            respond(true);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 120));
          try {
            await video.play();
            respond(true);
          } catch {
            respond(false, "已跳到時間點，但播放器無法開始播放。");
          }
        };

        const finalSeek = () => {
          const done = () => {
            video.removeEventListener("seeked", done);
            playIfNeeded();
          };
          video.addEventListener("seeked", done, { once: true });
          video.currentTime = target;
        };

        if (isBackwardSeek) {
          // Backward HLS seeks on this site can stall when jumping directly to
          // the target. Prime the stream from a few seconds before the bookmark,
          // briefly let it fetch/decode data, then perform the exact seek.
          const warmupTime = Math.max(0, target - 4);
          const warmed = async () => {
            video.removeEventListener("seeked", warmed);
            try {
              await video.play();
              await new Promise((resolve) => setTimeout(resolve, 450));
              video.pause();
            } catch {
              // Even if autoplay is rejected, still try the exact seek.
            }
            finalSeek();
          };
          video.addEventListener("seeked", warmed, { once: true });
          video.currentTime = warmupTime;
        } else {
          finalSeek();
        }

        fallbackTimer = setTimeout(() => {
          if (!video.seeking && Math.abs(video.currentTime - target) < 1.5) {
            playIfNeeded();
          } else {
            respond(false, "播放器在跳轉時間點時逾時。");
          }
        }, 6000);
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
