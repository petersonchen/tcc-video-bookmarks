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

  // Passive diagnostics also capture seeks initiated by the site's own
  // timeline controls. This lets us compare a successful manual backward
  // seek with an extension-initiated backward seek.
  const observedVideos = new WeakSet();

  function observeVideo(video) {
    if (!video || observedVideos.has(video)) return;
    observedVideos.add(video);

    const write = (event) => {
      const ranges = [];
      for (let i = 0; i < video.buffered.length; i += 1) {
        ranges.push([
          Number(video.buffered.start(i).toFixed(2)),
          Number(video.buffered.end(i).toFixed(2))
        ]);
      }
      const entry = {
        at: new Date().toISOString(),
        event: `native:${event}`,
        currentTime: Number((video.currentTime || 0).toFixed(2)),
        target: null,
        backward: null,
        paused: video.paused,
        seeking: video.seeking,
        readyState: video.readyState,
        networkState: video.networkState,
        buffered: ranges
      };
      console.log("[TCC Bookmarks]", entry.event, entry);
      chrome.storage.local.get("debugLog").then(({ debugLog = [] }) =>
        chrome.storage.local.set({ debugLog: [...debugLog, entry].slice(-80) })
      ).catch(() => {});
    };

    ["play", "pause", "seeking", "seeked", "waiting", "stalled", "canplay", "playing", "loadedmetadata", "error"]
      .forEach((name) => video.addEventListener(name, () => write(name)));
  }

  const initialVideo = findVideo();
  if (initialVideo) observeVideo(initialVideo);
  new MutationObserver(() => {
    const video = findVideo();
    if (video) observeVideo(video);
  }).observe(document.documentElement, { childList: true, subtree: true });

  async function logPlayerInspector() {
    const video = findVideo();
    if (!video) return;

    const selectors = [
      'input[type="range"]',
      '[role="slider"]',
      'progress',
      '.progress',
      '.progress-bar',
      '[class*="seek"]',
      '[class*="timeline"]',
      '[class*="progress"]'
    ];
    const controls = [...new Set(selectors.flatMap((selector) =>
      [...document.querySelectorAll(selector)]
    ))].slice(0, 20).map((el) => ({
      tag: el.tagName,
      id: el.id || "",
      className: typeof el.className === "string" ? el.className : "",
      type: el.getAttribute("type") || "",
      role: el.getAttribute("role") || "",
      min: el.getAttribute("min") || "",
      max: el.getAttribute("max") || "",
      value: el.value ?? el.getAttribute("aria-valuenow") ?? ""
    }));

    const scripts = [...document.scripts]
      .map((s) => s.src)
      .filter(Boolean)
      .map((src) => {
        try { return new URL(src).pathname.split("/").pop(); }
        catch { return src; }
      })
      .filter((name) => /player|video|hls|media|jw|clappr|flow|plyr/i.test(name))
      .slice(0, 30);

    const entry = {
      at: new Date().toISOString(),
      event: "PLAYER_INSPECTOR",
      currentTime: Number((video.currentTime || 0).toFixed(2)),
      target: null,
      backward: null,
      paused: video.paused,
      seeking: video.seeking,
      readyState: video.readyState,
      networkState: video.networkState,
      buffered: [],
      controls,
      scripts,
      videoParent: video.parentElement?.outerHTML?.slice(0, 4000) || ""
    };

    console.log("[TCC Bookmarks] PLAYER_INSPECTOR", entry);
    const { debugLog = [] } = await chrome.storage.local.get("debugLog");
    await chrome.storage.local.set({ debugLog: [...debugLog, entry].slice(-80) });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "TCC_INSPECT_PLAYER") {
      logPlayerInspector().then(() => sendResponse({ ok: true }));
      return true;
    }

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

          // Retry with a tiny nearby seek only after the stepped scrub has
          // completed; diagnostics will show whether the new buffer exists.
          video.currentTime = Math.max(0, target - 0.5);
          setTimeout(() => {
            video.currentTime = target;
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

        if (isBackwardSeek) {
          const from = video.currentTime;
          const distance = from - target;
          const steps = Math.max(8, Math.min(40, Math.ceil(distance / 150)));
          let step = 1;
          debug("backward-scrub-start");

          const scrub = () => {
            if (step > steps) {
              debug("backward-scrub-final");
              video.currentTime = target;
              return;
            }

            // Ease through intermediate positions, similar to dragging the
            // site's timeline rather than making one very large seek.
            const progress = step / steps;
            video.currentTime = from - distance * progress;
            step += 1;
            setTimeout(scrub, 35);
          };

          scrub();
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
