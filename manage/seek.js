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

// With the reuseTab setting, CUE / PLAY keep one player tab and load each
// video into it. Its ID lives in session storage, so it lasts until the
// browser closes and is shared by every open manage page.
const PLAYER_TAB_KEY = "playerTabId";

async function playerTab() {
  const id = (await chrome.storage.session.get(PLAYER_TAB_KEY))[PLAYER_TAB_KEY];
  if (!Number.isInteger(id)) return null;
  try { return await chrome.tabs.get(id); } catch { return null; }
}

// Waits until the tab has navigated to the video and finished loading, so the
// player checks that follow do not run on the previous page.
async function waitForVideoPage(tabId, videoKey, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete" && videoKeyFromUrl(tab.url) === videoKey) return;
    await sleep(300);
  }
  throw new Error("影片頁面載入逾時");
}

// A tab this extension muted counts as unmuted, so a mute left behind by a
// seek that never finished (the manage page closed meanwhile) is undone next time.
function mutedByUser(tab) {
  const info = tab.mutedInfo;
  return Boolean(info?.muted && !(info.reason === "extension" && info.extensionId === chrome.runtime.id));
}

const leftMuted = (tab) => Boolean(tab.mutedInfo?.muted) && !mutedByUser(tab);

// A page that loads a video starts playing it from the beginning before the
// player is ready to seek, so the tab stays muted until the seek is done.
// muted says whether this code muted it and must unmute it afterwards.
async function loadMuted(tab, url, active) {
  const muted = !mutedByUser(tab);
  if (muted) await chrome.tabs.update(tab.id, { muted: true });
  return { tab: await chrome.tabs.update(tab.id, { url, ...(active && { active }) }), muted };
}

// Returns the tab to seek in, whether it was muted to load the video, and
// whether it was newly opened. active false leaves an existing tab where it is.
// A new tab is always shown: Chrome does not load media in a tab that has
// never been visible, so seekMarker switches back once the page has loaded.
async function tabForVideo(video, url, active) {
  if (settings.reuseTab) {
    const reused = await playerTab();
    if (reused) {
      if (videoKeyFromUrl(reused.url) === video.videoKey) return { tab: await chrome.tabs.update(reused.id, { ...(active && { active }) }), muted: leftMuted(reused) };
      const loaded = await loadMuted(reused, url, active);
      await waitForVideoPage(loaded.tab.id, video.videoKey);
      return loaded;
    }
  }
  let found = await findVideoTab(video.videoKey);
  if (found) found = { tab: await chrome.tabs.update(found.id, { ...(active && { active }) }), muted: leftMuted(found) };
  // Open a blank tab first so it is muted before the video page starts loading.
  else found = { ...await loadMuted(await chrome.tabs.create({ url: "about:blank", active: true }), url, true), created: true };
  if (settings.reuseTab) await chrome.storage.session.set({ [PLAYER_TAB_KEY]: found.tab.id });
  return found;
}

async function returnToManagePage() {
  await chrome.tabs.update((await chrome.tabs.getCurrent()).id, { active: true });
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

// background keeps focus on the manage page: the video tab is not activated.
async function seekMarker(video, marker, play, background = false) {
  const adapter = adapterFor(video.pageUrl);
  if (!adapter) {
    showToast("這支影片沒有網址，無法開啟。請先在影片頁開啟一次 MPY Timecode Marker。");
    return;
  }

  const target = seekTarget(marker.time, settings.cueLead);
  let opened;
  try {
    // Adapters that support a start time in the URL load the video there directly.
    opened = await tabForVideo(video, adapter.startUrl?.(video.pageUrl, target) || video.pageUrl, !background);
    const { tab } = opened;
    if (!background) await chrome.windows.update(tab.windowId, { focused: true });
    else if (opened.created) {
      await waitForVideoPage(tab.id, video.videoKey);
      await returnToManagePage();
    }

    // Chrome does not load media in a tab that has never been shown, such as
    // one opened in the background. If the player is not ready soon, show the
    // tab until it is, then go back to the manage page.
    let ready = await waitForPlayer(adapter, tab.id, background ? 3000 : undefined);
    if (!ready && background) {
      // Showing it starts the page's autoplay from the beginning, so mute first.
      if (!opened.muted && !mutedByUser(await chrome.tabs.get(tab.id))) {
        await chrome.tabs.update(tab.id, { muted: true });
        opened.muted = true;
      }
      await chrome.tabs.update(tab.id, { active: true });
      ready = await waitForPlayer(adapter, tab.id);
      await returnToManagePage();
    }
    if (!ready) throw new Error("影片播放器載入逾時");
    if (play) await adapter.play(tab.id, target);
    else await adapter.cue(tab.id, target);
    // A YouTube ad can bring its tab to the front while it plays.
    if (background && (await chrome.tabs.get(tab.id)).active) await returnToManagePage();
    // Give the player a moment to leave the old position before sound returns.
    if (opened.muted) await sleep(300);
  } catch (error) {
    showToast(`無法${play ? "播放" : "CUE"}「${marker.note || DEFAULT_MARKER_NOTE}」：${error.message}`);
  } finally {
    // The tab may have been closed meanwhile.
    if (opened?.muted) await chrome.tabs.update(opened.tab.id, { muted: false }).catch(() => {});
  }
}
