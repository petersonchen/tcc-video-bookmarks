let activeTab;
let state;
let markers = [];
let siteAdapter;

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

async function updateStoredMarker(id, changes) {
  await withStorageLock(async () => {
    const key = markersKey(state.videoKey);
    const stored = (await chrome.storage.local.get(key))[key] || [];
    const marker = stored.find((item) => item.id === id);
    if (!marker || !isLive(marker)) return;
    Object.assign(marker, changes);
    await chrome.storage.local.set({ [key]: stored });
  });
  // The storage.onChanged listener reloads the list once focus leaves the inputs.
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

    const time = document.createElement("input");
    time.className = "marker-edit marker-time";
    time.value = formatTime(marker.time);
    time.title = "編輯 Timecode";
    time.addEventListener("change", async () => {
      const value = parseTimecode(time.value);
      if (value === null) {
        time.value = formatTime(marker.time);
        return;
      }
      try { await updateStoredMarker(marker.id, { time: value, updatedAt: new Date().toISOString() }); }
      catch (error) { showError(error.message); }
    });

    const note = document.createElement("input");
    note.className = "marker-edit marker-note";
    note.value = marker.note || DEFAULT_MARKER_NOTE;
    note.title = "編輯標題";
    note.addEventListener("change", async () => {
      try { await updateStoredMarker(marker.id, { note: note.value.trim() || DEFAULT_MARKER_NOTE, updatedAt: new Date().toISOString() }); }
      catch (error) { showError(error.message); }
    });

    const cue = document.createElement("button");
    cue.className = "cue";
    cue.textContent = "CUE";
    cue.addEventListener("click", async () => {
      try {
        await siteAdapter.cue(activeTab.id, marker.time);
      } catch (error) {
        console.error("[MPY Timecode Marker] CUE failed", error);
      }
      window.close();
    });

    const play = document.createElement("button");
    play.className = "play";
    play.textContent = "PLAY";
    play.addEventListener("click", async () => {
      try {
        await siteAdapter.play(activeTab.id, marker.time);
      } catch (error) {
        console.error("[MPY Timecode Marker] PLAY failed", error);
      }
      window.close();
    });

    const remove = document.createElement("button");
    remove.className = "delete";
    remove.title = "刪除";
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      try { await updateStoredMarker(marker.id, { deletedAt: new Date().toISOString() }); }
      catch (error) { showError(error.message); }
    });

    row.append(time, note, cue, play, remove);
    list.append(row);
  });
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
    showError("目前網站尚未支援 MPY Timecode Marker。");
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

    const note = $("note").value.trim() || `Marker ${latest.formattedTime}`;
    state = latest;
    await withStorageLock(async () => {
      const key = markersKey(state.videoKey);
      const metaKey = videoMetaKey(state.videoKey);
      const stored = await chrome.storage.local.get([key, metaKey]);
      await chrome.storage.local.set({
        [key]: [...(stored[key] || []), newMarker(latest.currentTime, note)],
        [metaKey]: { ...stored[metaKey], site: state.site, title: state.pageTitle, pageUrl: state.pageUrl }
      });
    });
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
