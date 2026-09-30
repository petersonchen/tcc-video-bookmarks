let activeTab;
let state;
let bookmarks = [];

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
  await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    world: "MAIN",
    func: (time) => {
      const player = window.videojs?.getPlayer?.("vdoVideo") || window.videojs?.("vdoVideo");
      if (!player) throw new Error("Video.js player not found");
      player.pause();
      player.one("seeked", () => {
        Promise.resolve(player.play()).catch(() => {});
      });
      player.currentTime(time);
    },
    args: [target]
  });
}

function storageKey(videoKey) {
  return `bookmarks:${videoKey}`;
}

async function message(payload) {
  return chrome.tabs.sendMessage(activeTab.id, payload);
}

async function loadBookmarks() {
  const key = storageKey(state.videoKey);
  const result = await chrome.storage.local.get(key);
  bookmarks = Array.isArray(result[key]) ? result[key] : [];
  bookmarks.sort((a, b) => a.time - b.time);
  render();
}

async function persist() {
  await chrome.storage.local.set({ [storageKey(state.videoKey)]: bookmarks });
}

function render() {
  const list = $("bookmarks");
  list.textContent = "";
  $("count").textContent = bookmarks.length ? `${bookmarks.length} 個` : "";
  $("empty").classList.toggle("hidden", bookmarks.length > 0);

  bookmarks.forEach((bookmark) => {
    const row = document.createElement("div");
    row.className = "bookmark";

    const time = document.createElement("input");
    time.className = "bookmark-edit bookmark-time";
    time.value = formatTime(bookmark.time);
    time.title = "編輯 Timecode";
    time.addEventListener("change", async () => {
      const value = parseTimecode(time.value);
      if (value === null) {
        time.value = formatTime(bookmark.time);
        return;
      }
      bookmark.time = value;
      await persist();
      bookmarks.sort((a, b) => a.time - b.time);
      render();
    });

    const note = document.createElement("input");
    note.className = "bookmark-edit bookmark-note";
    note.value = bookmark.note || "Bookmark";
    note.title = "編輯標題";
    note.addEventListener("change", async () => {
      bookmark.note = note.value.trim() || "Bookmark";
      await persist();
      note.value = bookmark.note;
    });

    const cue = document.createElement("button");
    cue.className = "cue";
    cue.textContent = "CUE";
    cue.addEventListener("click", async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          world: "MAIN",
          func: (target) => {
            const player = window.videojs?.getPlayer?.("vdoVideo") || window.videojs?.("vdoVideo");
            if (!player) throw new Error("Video.js player not found");
            player.pause();
            player.currentTime(target);
          },
          args: [bookmark.time]
        });
      } catch (error) {
        console.error("[TCC Bookmarks] Video.js CUE failed", error);
      }
      window.close();
    });

    const play = document.createElement("button");
    play.className = "play";
    play.textContent = "PLAY";
    play.addEventListener("click", async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          world: "MAIN",
          func: (target) => {
            const player = window.videojs?.getPlayer?.("vdoVideo") || window.videojs?.("vdoVideo");
            if (!player) throw new Error("Video.js player not found");
            player.pause();
            player.one("seeked", () => {
              Promise.resolve(player.play()).catch(() => {});
            });
            player.currentTime(target);
          },
          args: [bookmark.time]
        });
      } catch (error) {
        console.error("[TCC Bookmarks] Video.js PLAY failed", error);
      }
      window.close();
    });

    const remove = document.createElement("button");
    remove.className = "delete";
    remove.title = "刪除";
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      bookmarks = bookmarks.filter((item) => item.id !== bookmark.id);
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

  if (!activeTab?.url?.startsWith("https://live.tcc.gov.tw/")) {
    showError("請先開啟 live.tcc.gov.tw 的影片頁面。");
    return;
  }

  try {
    state = await message({ type: "TCC_GET_VIDEO_STATE" });
  } catch {
    showError("無法連線到頁面。請重新整理影片頁後再試一次。");
    return;
  }

  if (!state?.ok) {
    showError(state?.error || "目前頁面找不到影片。");
    return;
  }

  $("version").textContent = `v${chrome.runtime.getManifest().version}`;
  $("videoTitle").textContent = state.pageTitle || "TCC Video";
  $("currentTime").textContent = state.formattedTime;
  $("note").value = `Bookmark ${state.formattedTime}`;
  $("controls").classList.remove("hidden");
  await loadBookmarks();
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
    const latest = await message({ type: "TCC_GET_VIDEO_STATE" });
    if (!latest?.ok) throw new Error(latest?.error || "無法取得影片時間");

    const note = $("note").value.trim() || `Bookmark ${latest.formattedTime}`;
    bookmarks.push({
      id: crypto.randomUUID(),
      time: latest.currentTime,
      note,
      createdAt: new Date().toISOString()
    });
    state = latest;
    await persist();
    $("currentTime").textContent = latest.formattedTime;
    $("note").value = "";
    await loadBookmarks();
  } catch (error) {
    showError(error.message);
  }
});

$("note").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("save").click();
});

init();
