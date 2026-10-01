let activeTab;
let state;
let markers = [];
let siteAdapter;

const $ = (id) => document.getElementById(id);

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function parseTimecode(value) {
  const parts = value.trim().split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;

  let seconds;
  if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
  else if (parts.length === 1) seconds = parts[0];
  else return null;

  if (parts.length >= 2 && parts[parts.length - 1] >= 60) return null;
  if (parts.length === 3 && parts[1] >= 60) return null;
  return seconds;
}

async function playAtTime(target) {
  return siteAdapter.play(activeTab.id, target);
}

function storageKey(videoKey) {
  return `markers:${videoKey}`;
}

async function loadMarkers() {
  const key = storageKey(state.videoKey);
  const result = await chrome.storage.local.get(key);
  markers = Array.isArray(result[key]) ? result[key] : [];
  markers.sort((a, b) => a.time - b.time);
  render();
}

async function persist() {
  await chrome.storage.local.set({ [storageKey(state.videoKey)]: markers });
}

function render() {
  const list = $("markers");
  list.textContent = "";
  $("count").textContent = markers.length ? `${markers.length} 個` : "";
  $("empty").classList.toggle("hidden", markers.length > 0);

  markers.forEach((marker) => {
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
      marker.time = value;
      await persist();
      markers.sort((a, b) => a.time - b.time);
      render();
    });

    const note = document.createElement("input");
    note.className = "marker-edit marker-note";
    note.value = marker.note || "Marker";
    note.title = "編輯標題";
    note.addEventListener("change", async () => {
      marker.note = note.value.trim() || "Marker";
      await persist();
      note.value = marker.note;
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
      markers = markers.filter((item) => item.id !== marker.id);
      await persist();
      render();
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

  $("version").textContent = `v${chrome.runtime.getManifest().version}`;
  $("videoTitle").textContent = state.pageTitle || siteAdapter.name || "Video";
  $("currentTime").textContent = state.formattedTime;
  $("note").value = `Marker ${state.formattedTime}`;
  $("controls").classList.remove("hidden");
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
    showError("無法控制 Video.js 播放器。");
  }
});

$("goTime").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("goPlay").click();
});

$("save").addEventListener("click", async () => {
  try {
    // Read again at click time so the saved time is current, not popup-open time.
    const latest = await siteAdapter.getState(activeTab.id);
    if (!latest?.ok) throw new Error(latest?.error || "無法取得影片時間");

    const note = $("note").value.trim() || `Marker ${latest.formattedTime}`;
    markers.push({
      id: crypto.randomUUID(),
      time: latest.currentTime,
      note,
      createdAt: new Date().toISOString()
    });
    state = latest;
    await persist();
    $("currentTime").textContent = latest.formattedTime;
    $("note").value = "";
    await loadMarkers();
  } catch (error) {
    showError(error.message);
  }
});

$("note").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("save").click();
});

init();
