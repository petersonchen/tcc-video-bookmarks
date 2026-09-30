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

function debugText(entries) {
  return entries.map((e) => {
    const time = new Date(e.at).toLocaleTimeString("zh-TW", { hour12: false });
    const buffered = (e.buffered || []).map((r) => `${r[0]}-${r[1]}`).join(",");
    const base = `${time} ${e.event} current=${e.currentTime} target=${e.target} ${e.backward ? "BACKWARD" : "FORWARD"} paused=${e.paused} seeking=${e.seeking} ready=${e.readyState} network=${e.networkState} buffer=[${buffered}]`;
    if (e.event !== "PLAYER_INSPECTOR") return base;
    return `${base}\ncontrols=${JSON.stringify(e.controls, null, 2)}\nscripts=${JSON.stringify(e.scripts)}\nvideoParent=${e.videoParent}`;

  }).join("\n");
}

async function loadDebug() {
  const { debugLog = [] } = await chrome.storage.local.get("debugLog");
  $("debugLog").textContent = debugLog.length ? debugText(debugLog) : "尚無紀錄";
}

function render() {
  const list = $("bookmarks");
  list.textContent = "";
  $("count").textContent = bookmarks.length ? `${bookmarks.length} 個` : "";
  $("empty").classList.toggle("hidden", bookmarks.length > 0);

  bookmarks.forEach((bookmark) => {
    const row = document.createElement("div");
    row.className = "bookmark";

    const time = document.createElement("span");
    time.className = "bookmark-time";
    time.textContent = formatTime(bookmark.time);

    const note = document.createElement("span");
    note.className = "bookmark-note";
    note.title = bookmark.note;
    note.textContent = bookmark.note || "Bookmark";

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

  $("videoTitle").textContent = state.pageTitle || "TCC Video";
  $("currentTime").textContent = state.formattedTime;
  $("note").value = `Bookmark ${state.formattedTime}`;
  $("controls").classList.remove("hidden");
  await loadBookmarks();
  await loadDebug();
  $("note").focus();
  $("note").select();
}

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

$("inspectPlayer").addEventListener("click", async () => {
  await message({ type: "TCC_INSPECT_PLAYER" });
  await loadDebug();
});

$("copyDebug").addEventListener("click", async () => {
  const { debugLog = [] } = await chrome.storage.local.get("debugLog");
  await navigator.clipboard.writeText(debugText(debugLog));
  $("copyDebug").textContent = "Copied";
  setTimeout(() => { $("copyDebug").textContent = "Copy Log"; }, 1000);
});

$("clearDebug").addEventListener("click", async () => {
  await chrome.storage.local.remove("debugLog");
  await loadDebug();
});

$("note").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("save").click();
});

init();
