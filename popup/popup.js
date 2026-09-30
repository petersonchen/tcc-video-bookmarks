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
        const response = await message({ type: "TCC_CUE", time: bookmark.time });
        if (!response?.ok) throw new Error(response?.error || "CUE 失敗");
        window.close();
      } catch (error) {
        showError(error.message);
      }
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

    row.append(time, note, cue, remove);
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

$("note").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("save").click();
});

init();
