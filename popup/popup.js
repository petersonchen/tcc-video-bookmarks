let activeTab;
let state;
let markers = [];
let siteAdapter;
let cueLead = 0;

const $ = (id) => document.getElementById(id);

async function playAtTime(target) {
  return siteAdapter.play(activeTab.id, target);
}

async function loadMarkers() {
  const key = markersKey(state.videoKey);
  const result = await chrome.storage.local.get(key);
  markers = Array.isArray(result[key]) ? result[key] : [];
  markers.sort((a, b) => a.time - b.time);
  render();
}

// Keep the title and URL while preserving any other metadata fields.
async function saveVideoMeta() {
  await withStorageLock(async () => {
    const key = videoMetaKey(state.videoKey);
    const stored = (await chrome.storage.local.get(key))[key];
    await chrome.storage.local.set({
      [key]: { ...stored, site: state.site, title: state.pageTitle, pageUrl: state.pageUrl }
    });
  });
}

function render() {
  const list = $("markers");
  list.textContent = "";
  const live = markers.filter(isLive);
  $("count").textContent = live.length ? `${live.length} 個` : "";
  $("empty").classList.toggle("hidden", live.length > 0);

  live.forEach((marker) => {
    const row = document.createElement("div");
    row.className = "marker";

    // The storage.onChanged listener reloads the list once focus leaves the inputs.
    const { time, note } = markerEditFields(state.videoKey, marker, (error) => showError(error.message));

    const cue = document.createElement("button");
    cue.className = "cue";
    cue.textContent = "CUE";
    cue.addEventListener("click", () => seek(marker, false));

    const play = document.createElement("button");
    play.className = "play";
    play.textContent = "PLAY";
    play.addEventListener("click", () => seek(marker, true));

    const remove = document.createElement("button");
    remove.className = "delete";
    remove.title = "刪除";
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      try { await changeMarker(state.videoKey, marker.id, { deletedAt: new Date().toISOString() }); }
      catch (error) { showError(error.message); }
    });

    row.append(time, note, cue, play, remove);
    list.append(row);
  });
}

// Closes the popup only after the player accepted the seek, so a failure stays visible.
async function seek(marker, play) {
  try {
    const target = seekTarget(marker.time, cueLead);
    if (play) await siteAdapter.play(activeTab.id, target);
    else await siteAdapter.cue(activeTab.id, target);
    window.close();
  } catch (error) {
    showError(`無法${play ? "PLAY" : "CUE"}「${marker.note || DEFAULT_MARKER_NOTE}」：${error.message}`);
  }
}

// Shows the shortcut the user actually has, since it can be changed or unset.
async function showShortcutHint() {
  const command = (await chrome.commands.getAll()).find((item) => item.name === "save-marker");
  if (!command?.shortcut) return;
  $("shortcutHint").textContent = `快捷鍵 ${command.shortcut}：不開 popup 直接儲存`;
  $("shortcutHint").classList.remove("hidden");
}

function showError(text) {
  $("unsupported").textContent = text;
  $("unsupported").classList.remove("hidden");
}

async function init() {
  $("version").textContent = `v${chrome.runtime.getManifest().version}`;
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  siteAdapter = (window.SiteAdapters || []).find((adapter) => adapter.matches(activeTab?.url));
  if (!siteAdapter) {
    showError("目前網站尚未支援 soonmarker。");
    return;
  }

  try {
    state = await siteAdapter.getState(activeTab.id);
  } catch {
    showError("無法連線到頁面。請重新整理影片頁後再試一次。");
    return;
  }

  if (!state?.ok) {
    showError(state?.error || "目前頁面找不到影片。");
    return;
  }

  $("videoTitle").textContent = state.pageTitle || siteAdapter.name || "Video";
  $("currentTime").textContent = state.formattedTime;
  $("note").value = `Marker ${state.formattedTime}`;
  $("controls").classList.remove("hidden");
  cueLead = await loadCueLead();
  $("leadHint").textContent = `CUE／PLAY 提前 ${cueLead} 秒`;
  $("leadHint").classList.toggle("hidden", !cueLead);
  await showShortcutHint();
  await saveVideoMeta();
  await loadMarkers();
  $("note").focus();
  $("note").select();
}

$("goPlay").addEventListener("click", async () => {
  const target = parseTimecode($("goTime").value);
  if (target === null) {
    showError("時間格式請輸入 HH:MM:SS，例如 01:23:45。");
    return;
  }
  try {
    await playAtTime(target);
    window.close();
  } catch {
    showError("無法控制影片播放器。");
  }
});

$("manage").addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("manage/manage.html") });
  window.close();
});

$("goTime").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("goPlay").click();
});

$("save").addEventListener("click", async () => {
  if ($("save").disabled) return;
  $("save").disabled = true;
  try {
    // Read again at click time so the saved time is current, not popup-open time.
    const latest = await siteAdapter.getState(activeTab.id);
    if (!latest?.ok) throw new Error(latest?.error || "無法取得影片時間");

    state = latest;
    await saveMarker(latest, $("note").value.trim() || `Marker ${latest.formattedTime}`);
    $("currentTime").textContent = latest.formattedTime;
    $("note").value = "";
    await loadMarkers();
  } catch (error) {
    showError(error.message);
  } finally {
    $("save").disabled = false;
  }
});

$("note").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("save").click();
});

let pendingMarkerRefresh = false;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !state || !changes[markersKey(state.videoKey)]) return;
  if (document.activeElement?.matches("#markers input")) pendingMarkerRefresh = true;
  else loadMarkers().catch((error) => showError(error.message));
});
$("markers").addEventListener("focusout", () => {
  setTimeout(() => {
    if (!pendingMarkerRefresh || document.activeElement?.matches("#markers input")) return;
    pendingMarkerRefresh = false;
    loadMarkers().catch((error) => showError(error.message));
  });
});

init().catch((error) => showError(error.message));
