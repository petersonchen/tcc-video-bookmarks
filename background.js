// Keyboard shortcut: saves a marker at the active video's current time
// without opening the popup. The toolbar badge shows the result.
importScripts("lib/timecode.js", "lib/markers.js");

const BADGE_MS = 2500;

async function flashBadge(tabId, text, color, title) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
  if (title) await chrome.action.setTitle({ tabId, title });
  setTimeout(() => {
    // The tab may have closed meanwhile.
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
    if (title) chrome.action.setTitle({ tabId, title: chrome.runtime.getManifest().action.default_title }).catch(() => {});
  }, BADGE_MS);
}

async function saveFromShortcut(tab) {
  let state;
  try {
    // Only supported sites run the content script; elsewhere sendMessage rejects.
    state = await chrome.tabs.sendMessage(tab.id, { type: "GET_VIDEO_STATE" });
  } catch {
    throw new Error("目前頁面不支援，或需要重新整理影片頁");
  }
  if (!state?.ok) throw new Error(state?.error || "目前頁面找不到影片");
  await saveMarker(state, `Marker ${state.formattedTime}`);
  return state;
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "save-marker") return;
  tab ||= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id) return;
  try {
    const state = await saveFromShortcut(tab);
    await flashBadge(tab.id, "✓", "#15803d", `已儲存 Marker ${state.formattedTime}`);
  } catch (error) {
    await flashBadge(tab.id, "!", "#b91c1c", `無法儲存 Marker：${error.message}`);
  }
});
