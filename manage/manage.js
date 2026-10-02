// Settings, Marker mode, storage sync, and page start-up. Loaded last.

const DEFAULT_SETTINGS = { recentEpisodes: 10 };
let settings = { ...DEFAULT_SETTINGS };

async function updateSettings(changes) {
  await withStorageLock(async () => {
    const stored = (await chrome.storage.local.get("settings")).settings || {};
    await chrome.storage.local.set({ settings: { ...stored, ...changes } });
  });
}

async function loadSettings() {
  const stored = (await chrome.storage.local.get("settings")).settings;
  settings = { ...DEFAULT_SETTINGS, ...stored };
  $("recentEpisodes").value = settings.recentEpisodes;
}

$("recentEpisodes").addEventListener("change", () => run(async () => {
  const count = Number($("recentEpisodes").value);
  if (!Number.isInteger(count) || count < 0) {
    $("recentEpisodes").value = settings.recentEpisodes;
    return;
  }
  await updateSettings({ recentEpisodes: count });
}));

// What clicking a marker does: "cue", "play", or "edit". Stored apart from the
// settings section since it changes often.
let markerMode = "play";

async function loadMarkerMode() {
  const nextMode = (await chrome.storage.local.get("markerMode")).markerMode || "play";
  if (nextMode !== markerMode) { selectedRows.clear(); selectedVideoKeys.clear(); }
  markerMode = nextMode;
  document.querySelectorAll("#modes button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === markerMode);
  });
}

document.querySelectorAll("#modes button").forEach((button) => {
  button.addEventListener("click", () => chrome.storage.local.set({ markerMode: button.dataset.mode }));
});

async function refreshList() {
  snapshot = await chrome.storage.local.get(null);
  videos = Library.videos(snapshot);
  renderList();
  refreshTargets();
}

// Re-rendering would drop an edit in progress, so wait until focus leaves the
// list's inputs.
chrome.storage.onChanged.addListener((changes, area) => run(async () => {
  if (area !== "local") return;
  if (changes.settings) await loadSettings();
  if (changes.markerMode) await loadMarkerMode();
  if (dragging || document.activeElement?.matches("#list input")) pendingRefresh = true;
  else await refreshList();
}));

$("version").textContent = `v${chrome.runtime.getManifest().version}`;

Promise.all([loadSettings(), loadMarkerMode()]).then(refreshList)
  .catch((error) => showToast(`無法載入：${error.message}`));

// Keep browser scrolling and keyboard focus clear of the sticky controls.
new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty("--toolbar-height", `${entry.target.offsetHeight}px`);
}).observe(document.querySelector(".marker-toolbar"));
