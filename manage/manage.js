// Settings, Marker mode, storage sync, and page start-up. Loaded last.

const DEFAULT_SETTINGS = { recentEpisodes: 10, cueLead: 0, reuseTab: true };
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
  if (!validCueLead(settings.cueLead)) settings.cueLead = DEFAULT_SETTINGS.cueLead;
  $("recentEpisodes").value = settings.recentEpisodes;
  $("cueLead").value = settings.cueLead;
  if (typeof settings.reuseTab !== "boolean") settings.reuseTab = DEFAULT_SETTINGS.reuseTab;
  $("reuseTab").checked = settings.reuseTab;
}

$("recentEpisodes").addEventListener("change", () => run(async () => {
  const count = Number($("recentEpisodes").value);
  if (!Number.isInteger(count) || count < 0) {
    $("recentEpisodes").value = settings.recentEpisodes;
    return;
  }
  await updateSettings({ recentEpisodes: count });
}));

$("cueLead").addEventListener("change", () => run(async () => {
  const lead = Number($("cueLead").value);
  if (!validCueLead(lead)) {
    $("cueLead").value = settings.cueLead;
    return;
  }
  await updateSettings({ cueLead: lead });
}));

$("reuseTab").addEventListener("change", () => run(() => updateSettings({ reuseTab: $("reuseTab").checked })));

// The save shortcut is set in the browser and can change, so read it.
async function loadSaveShortcut() {
  const command = (await chrome.commands.getAll()).find((item) => item.name === "save-marker");
  $("saveShortcut").textContent = command?.shortcut || "未設定";
}

$("editShortcuts").addEventListener("click", () => run(() => chrome.tabs.create({
  url: navigator.userAgent.includes("Edg/") ? "edge://extensions/shortcuts" : "chrome://extensions/shortcuts"
})));

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

// Library totals for edit mode; they do not depend on the search.
function renderStats() {
  const markers = videos.reduce((sum, video) => sum + video.markers.length, 0);
  $("libraryStats").textContent = `(V:${videos.length},M:${markers},E:${Library.episodes(snapshot).length})`;
}

async function refreshList() {
  snapshot = await chrome.storage.local.get(null);
  videos = Library.videos(snapshot);
  renderStats();
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

loadSaveShortcut().catch(() => {});
Promise.all([loadSettings(), loadMarkerMode()]).then(refreshList)
  .catch((error) => showToast(`無法載入：${error.message}`));

// Keep browser scrolling and keyboard focus clear of the sticky controls.
new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty("--toolbar-height", `${entry.target.offsetHeight}px`);
}).observe(document.querySelector(".marker-toolbar"));
