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
        // Treat seeking as a small state machine. In particular, do not use
        // "canplay" as proof that a new seek completed: it may describe the
        // previously buffered position and can fire too early on HLS players.
        video.pause();

        // TCC's streaming player is much more likely to stall on a backward
        // seek. A real HTMLVideoElement has no stop(), so for backward jumps
        // reload the current media resource to discard stale streaming state
        // before seeking. Forward seeks keep the faster normal path.
        if (isBackwardSeek) {
          const source = video.currentSrc || video.src || video.querySelector("source")?.src;
          if (source) {
            video.src = source;
            video.load();
          }
        }

        let replied = false;
        let seekFinished = false;
        let fallbackTimer;

        const cleanup = () => {
          clearTimeout(fallbackTimer);
          video.removeEventListener("seeked", onSeeked);
        };

        const finish = async () => {
          if (replied) return;
          replied = true;
          cleanup();

          if (shouldPlay) {
            // Give the streaming player one event-loop turn to settle its
            // internal buffer after seeked before asking it to play.
            await new Promise((resolve) => setTimeout(resolve, 100));
            try {
              await video.play();
            } catch {
              sendResponse({ ok: false, error: "已跳到時間點，但播放器無法開始播放。" });
              return;
            }
          }

          sendResponse({
            ok: true,
            time: target,
            formattedTime: formatTime(target),
            playing: shouldPlay
          });
        };

        const onSeeked = () => {
          if (seekFinished) return;
          seekFinished = true;
          finish();
        };

        video.addEventListener("seeked", onSeeked, { once: true });

        const seekToTarget = () => {
          // fastSeek can be less exact, so use currentTime for bookmark accuracy.
          video.currentTime = target;
        };

        if (isBackwardSeek && video.readyState < 1) {
          video.addEventListener("loadedmetadata", seekToTarget, { once: true });
        } else {
          seekToTarget();
        }

        // Defensive fallback for players that occasionally omit seeked.
        fallbackTimer = setTimeout(() => {
          if (!video.seeking && Math.abs(video.currentTime - target) < 1.5) {
            finish();
          }
        }, 3000);
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
