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

      const debug = (event) => {
        const ranges = [];
        for (let i = 0; i < video.buffered.length; i += 1) {
          ranges.push([
            Number(video.buffered.start(i).toFixed(2)),
            Number(video.buffered.end(i).toFixed(2))
          ]);
        }
        const entry = {
          at: new Date().toISOString(),
          event,
          currentTime: Number(video.currentTime.toFixed(2)),
          target,
          backward: isBackwardSeek,
          paused: video.paused,
          seeking: video.seeking,
          readyState: video.readyState,
          networkState: video.networkState,
          buffered: ranges
        };
        console.log("[TCC Bookmarks]", event, entry);
        chrome.storage.local.get("debugLog").then(({ debugLog = [] }) => {
          const next = [...debugLog, entry].slice(-50);
          return chrome.storage.local.set({ debugLog: next });
        }).catch(() => {});
      };

      ["seeking", "seeked", "waiting", "stalled", "canplay", "playing", "pause", "error"]
        .forEach((eventName) => {
          video.addEventListener(eventName, () => debug(eventName), { once: true });
        });
      debug("command");

      const cue = () => {
        video.pause();

        let replied = false;
        let recoveryUsed = false;
        let timeout;

        const cleanup = () => {
          clearTimeout(timeout);
          video.removeEventListener("waiting", recover);
          video.removeEventListener("stalled", recover);
          video.removeEventListener("playing", onPlaying);
        };

        const respond = (ok, error) => {
          if (replied) return;
          replied = true;
          cleanup();
          sendResponse(ok
            ? { ok: true, time: target, formattedTime: formatTime(target), playing: shouldPlay }
            : { ok: false, error });
        };

        const recover = () => {
          if (!shouldPlay || !isBackwardSeek || recoveryUsed) return;
          recoveryUsed = true;
          debug("backward-recovery");

          // If fastSeek is available, ask the browser media pipeline to perform
          // another keyframe-aware seek instead of assigning currentTime again.
          if (typeof video.fastSeek === "function") {
            video.fastSeek(target);
          } else {
            video.currentTime = target;
          }

          setTimeout(() => {
            video.play().catch(() => {});
          }, 250);
        };

        const onPlaying = () => respond(true);

        const startPlayback = async () => {
          if (!shouldPlay) {
            respond(true);
            return;
          }

          video.addEventListener("waiting", recover);
          video.addEventListener("stalled", recover);
          video.addEventListener("playing", onPlaying, { once: true });

          try {
            await video.play();
          } catch {
            respond(false, "已跳到時間點，但播放器無法開始播放。");
          }
        };

        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          setTimeout(startPlayback, 100);
        };

        video.addEventListener("seeked", onSeeked, { once: true });

        if (isBackwardSeek && typeof video.fastSeek === "function") {
          debug("fastSeek");
          video.fastSeek(target);
        } else {
          video.currentTime = target;
        }

        timeout = setTimeout(() => {
          if (shouldPlay && isBackwardSeek && !recoveryUsed) {
            recover();
            timeout = setTimeout(() => {
              if (!replied) respond(false, "往回跳轉後播放器仍未恢復。");
            }, 4000);
          } else if (!replied) {
            respond(false, "播放器在跳轉時間點時逾時。");
          }
        }, 3500);
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
