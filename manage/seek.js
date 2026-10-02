// CUE / PLAY from the manage page: find or open the video tab, then seek.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function adapterFor(url) {
  return (window.SiteAdapters || []).find((adapter) => adapter.matches(url));
}

// The most recently used tab showing this video, if any.
async function findVideoTab(videoKey) {
  const tabs = await chrome.tabs.query({ url: (window.SiteAdapters || []).map((adapter) => adapter.urlPattern) });
  return tabs
    .filter((tab) => videoKeyFromUrl(tab.url) === videoKey)
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
}

// A new tab starts loading before its player exists, so poll until it can seek.
// The timeout leaves room for a YouTube ad to finish first.
async function waitForPlayer(adapter, tabId, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await adapter.isReady(tabId)) return true;
    } catch {
      // The page is still loading and cannot be scripted yet.
    }
    await sleep(500);
  }
  return false;
}

async function seekMarker(video, marker, play) {
  const adapter = adapterFor(video.pageUrl);
  if (!adapter) {
    showToast("這支影片沒有網址，無法開啟。請先在影片頁開啟一次 MPY Timecode Marker。");
    return;
  }

  try {
    let tab = await findVideoTab(video.videoKey);
    if (tab) await chrome.tabs.update(tab.id, { active: true });
    else tab = await chrome.tabs.create({ url: video.pageUrl, active: true });
    await chrome.windows.update(tab.windowId, { focused: true });

    if (!(await waitForPlayer(adapter, tab.id))) throw new Error("影片播放器載入逾時");
    const target = seekTarget(marker.time, settings.cueLead);
    if (play) await adapter.play(tab.id, target);
    else await adapter.cue(tab.id, target);
  } catch (error) {
    showToast(`無法${play ? "播放" : "CUE"}「${marker.note || DEFAULT_MARKER_NOTE}」：${error.message}`);
  }
}
