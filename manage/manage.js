const EXPORT_HEADER = "MPY Timecode Marker v1";
const VIDEO_PREFIX = "▶";

const $ = (id) => document.getElementById(id);

// YYYY-MM-DD in the local time zone, the same form <input type="date"> uses.
function localDate(value) {
  return new Date(value).toLocaleDateString("sv-SE");
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SITE_LABELS = { tcc: "TCC", youtube: "YouTube" };

// Videos saved before video meta existed have no site; the key prefix tells.
function videoSite(videoKey, meta) {
  return meta.site || (videoKey.startsWith("youtube:") ? "youtube" : "tcc");
}

// Videos with their live markers. A video's date is the latest update among
// those markers, and the list groups videos by that date.
async function loadVideos() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter((key) => key.startsWith("markers:") && Array.isArray(all[key]))
    .map((key) => {
      const videoKey = key.slice("markers:".length);
      const meta = all[videoMetaKey(videoKey)] || {};
      const markers = all[key].filter(isLive).sort((a, b) => a.time - b.time);
      return {
        videoKey,
        site: videoSite(videoKey, meta),
        title: meta.title || videoKey,
        pageUrl: meta.pageUrl || "",
        markers,
        lastUpdated: markers.map(markerUpdatedAt).sort().at(-1)
      };
    })
    .filter((video) => video.markers.length)
    .sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"));
}

// Reads the stored array again so changes made in the popup meanwhile are kept.
// A value of undefined removes the field.
async function changeMarker(videoKey, id, changes) {
  const key = markersKey(videoKey);
  const stored = (await chrome.storage.local.get(key))[key] || [];
  const marker = stored.find((item) => item.id === id);
  if (!marker) return;
  Object.entries(changes).forEach(([field, value]) => {
    if (value === undefined) delete marker[field];
    else marker[field] = value;
  });
  await chrome.storage.local.set({ [key]: stored });
}

// ---- Settings ----

const DEFAULT_SETTINGS = { recentDays: 14 };
let settings = { ...DEFAULT_SETTINGS };

async function loadSettings() {
  const stored = (await chrome.storage.local.get("settings")).settings;
  settings = { ...DEFAULT_SETTINGS, ...stored };
  $("recentDays").value = settings.recentDays;
}

$("recentDays").addEventListener("change", async () => {
  const days = Number($("recentDays").value);
  if (!Number.isInteger(days) || days < 0) {
    $("recentDays").value = settings.recentDays;
    return;
  }
  await chrome.storage.local.set({ settings: { ...settings, recentDays: days } });
});

// Earliest date shown without a search, or "" to show every date.
function recentCutoff() {
  if (!settings.recentDays) return "";
  const date = new Date();
  date.setDate(date.getDate() - (settings.recentDays - 1));
  return localDate(date);
}

// ---- Marker list ----

// What clicking a marker does: "cue", "play", or "edit". Stored apart from the
// settings section since it changes often.
let markerMode = "play";

async function loadMarkerMode() {
  markerMode = (await chrome.storage.local.get("markerMode")).markerMode || "play";
  document.querySelectorAll("#modes button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === markerMode);
  });
}

document.querySelectorAll("#modes button").forEach((button) => {
  button.addEventListener("click", () => chrome.storage.local.set({ markerMode: button.dataset.mode }));
});

let videos = [];
let pendingRefresh = false;
let toastTimer;

// fzf-like: the term's characters appear in order, not necessarily adjacent.
// Terms made only of digits and date or time separators must appear as typed;
// in order they would match almost any date or timecode.
function termMatches(haystack, term) {
  if (/^[\d/:-]+$/.test(term)) return haystack.includes(term);
  let position = 0;
  for (const char of term) {
    position = haystack.indexOf(char, position);
    if (position === -1) return false;
    position += char.length;
  }
  return true;
}

// The site a term names: the start of a site label ("you", "tc"), at least two
// characters, or the alias "yt". Site labels are kept out of the fuzzy text, or
// "tcc" would match any text with t, c, c in order.
function siteForTerm(term) {
  if (term === "yt") return "youtube";
  if (term.length < 2) return null;
  return Object.keys(SITE_LABELS).find((site) => SITE_LABELS[site].toLowerCase().startsWith(term)) || null;
}

function displayDate(date) {
  return date.replaceAll("-", "/");
}

async function refreshList() {
  videos = await loadVideos();
  renderList();
}

function renderList() {
  const terms = $("search").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // Without a search, only recent videos are shown; a search covers every video.
  const cutoff = terms.length ? "" : recentCutoff();
  let hiddenVideos = 0;
  const groups = new Map();
  videos.forEach((video) => {
    const date = localDate(video.lastUpdated);
    if (date < cutoff) {
      hiddenVideos += 1;
      return;
    }
    // Every term must match, either by naming the video's site or by the text.
    const markers = video.markers.filter((marker) => {
      const text = `${displayDate(date)} ${date} ${video.title} ${formatTime(marker.time)} ${marker.note || ""}`.toLowerCase();
      return terms.every((term) => siteForTerm(term) === video.site || termMatches(text, term));
    });
    if (!markers.length) return;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push({ ...video, markers });
  });

  const list = $("list");
  list.textContent = "";
  [...groups.keys()].sort().reverse().forEach((date) => {
    const group = element("section", "date-group");
    group.append(element("h3", "date", displayDate(date)));
    groups.get(date).forEach((video) => group.append(renderVideo(video)));
    list.append(group);
  });

  $("listEmpty").textContent = videos.length ? "沒有符合的 Marker" : "尚未建立 Marker";
  $("listEmpty").classList.toggle("hidden", groups.size > 0 || hiddenVideos > 0);
  $("listHint").textContent = hiddenVideos
    ? `另有 ${hiddenVideos} 支影片的最後修改日不在最近 ${settings.recentDays} 天內，未顯示。可用搜尋找到。`
    : "";
  $("listHint").classList.toggle("hidden", hiddenVideos === 0);
}

function renderVideo(video) {
  const block = element("div", "video");
  const heading = element("div", "video-heading");
  const title = element("div", "video-title");
  if (video.pageUrl) {
    const link = element("a", "", video.title);
    link.href = video.pageUrl;
    link.target = "_blank";
    title.append(link);
  } else {
    title.textContent = video.title;
  }
  title.title = video.title;
  heading.append(element("span", `site-badge site-${video.site}`, SITE_LABELS[video.site]), title);
  block.append(heading);
  video.markers.forEach((marker) => block.append(renderMarker(video, marker)));
  return block;
}

function renderMarker(video, marker) {
  if (markerMode === "edit") return renderEditableMarker(video, marker);

  const play = markerMode === "play";
  const row = element("button", "marker marker-action");
  row.title = play ? "跳至此時間並播放" : "跳至此時間並暫停";
  row.append(element("span", "marker-time", formatTime(marker.time)), element("span", "", marker.note || "Marker"));
  row.addEventListener("click", () => seekMarker(video, marker, play));
  return row;
}

function renderEditableMarker(video, marker) {
  const row = element("div", "marker");

  const time = element("input", "marker-edit marker-time");
  time.value = formatTime(marker.time);
  time.title = "編輯 Timecode";
  time.addEventListener("change", async () => {
    const value = parseTimecode(time.value);
    if (value === null) {
      time.value = formatTime(marker.time);
      return;
    }
    await changeMarker(video.videoKey, marker.id, { time: value, updatedAt: new Date().toISOString() });
  });

  const note = element("input", "marker-edit marker-note");
  note.value = marker.note || "Marker";
  note.title = "編輯標題";
  note.addEventListener("change", async () => {
    await changeMarker(video.videoKey, marker.id, {
      note: note.value.trim() || "Marker",
      updatedAt: new Date().toISOString()
    });
  });

  [time, note].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
    });
  });

  const remove = element("button", "delete", "×");
  remove.title = "刪除";
  remove.addEventListener("click", async () => {
    await changeMarker(video.videoKey, marker.id, { deletedAt: new Date().toISOString() });
    showUndo(video.videoKey, marker);
  });

  row.append(time, note, remove);
  return row;
}

function hideToast() {
  clearTimeout(toastTimer);
  $("toast").classList.add("hidden");
}

function showToast(text, actionLabel, onAction) {
  $("toastText").textContent = text;
  $("toastAction").textContent = actionLabel || "";
  $("toastAction").classList.toggle("hidden", !actionLabel);
  $("toastAction").onclick = async () => {
    hideToast();
    await onAction();
  };
  $("toast").classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 8000);
}

// Only the latest deletion can be undone.
function showUndo(videoKey, marker) {
  showToast(`已刪除「${marker.note || "Marker"}」`, "復原", () =>
    changeMarker(videoKey, marker.id, { deletedAt: undefined })
  );
}

// ---- CUE / PLAY ----

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function adapterFor(url) {
  return (window.SiteAdapters || []).find((adapter) => adapter.matches(url));
}

// The most recently used tab showing this video, if any.
async function findVideoTab(videoKey) {
  const tabs = await chrome.tabs.query({ url: ["https://live.tcc.gov.tw/*", "https://www.youtube.com/*"] });
  return tabs
    .filter((tab) => videoKeyFromUrl(tab.url) === videoKey)
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
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

async function seekMarker(video, marker, play) {
  const adapter = adapterFor(video.pageUrl);
  if (!adapter) {
    showToast("這支影片沒有網址，無法開啟。請先在影片頁開啟一次 MPY Timecode Marker。");
    return;
  }

  try {
    let tab = await findVideoTab(video.videoKey);
    if (tab) await chrome.tabs.update(tab.id, { active: true });
    else tab = await chrome.tabs.create({ url: video.pageUrl, active: true });
    await chrome.windows.update(tab.windowId, { focused: true });

    if (!(await waitForPlayer(adapter, tab.id))) throw new Error("影片播放器載入逾時");
    if (play) await adapter.play(tab.id, marker.time);
    else await adapter.cue(tab.id, marker.time);
  } catch (error) {
    showToast(`無法${play ? "播放" : "CUE"}「${marker.note || "Marker"}」：${error.message}`);
  }
}

$("search").addEventListener("input", renderList);

// Re-rendering would drop an edit in progress, so wait until focus leaves the
// list's inputs.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes.settings) await loadSettings();
  if (changes.markerMode) await loadMarkerMode();
  if (document.activeElement?.matches("#list input")) pendingRefresh = true;
  else refreshList();
});

$("list").addEventListener("focusout", () => {
  setTimeout(() => {
    if (!pendingRefresh || document.activeElement?.matches("#list input")) return;
    pendingRefresh = false;
    refreshList();
  });
});

// ---- Export ----

function buildExport(videos, from, to) {
  const skipped = [];
  const picked = [];
  videos.forEach((video) => {
    const markers = video.markers.filter((marker) => {
      const date = localDate(markerUpdatedAt(marker));
      return date >= from && date <= to;
    });
    if (!markers.length) return;
    // Without the page URL the importer cannot tell which video these belong to.
    if (!video.pageUrl) skipped.push(video.title);
    else picked.push({ ...video, markers });
  });

  const count = picked.reduce((sum, video) => sum + video.markers.length, 0);
  const lines = [EXPORT_HEADER, `匯出：${from} ~ ${to}，${picked.length} 支影片，${count} 個 Marker`];
  picked.forEach((video) => {
    lines.push("", `${VIDEO_PREFIX} ${video.title}`, video.pageUrl);
    video.markers.forEach((marker) => lines.push(`${formatTime(marker.time)} ${marker.note || "Marker"}`));
  });

  return { text: lines.join("\n"), videoCount: picked.length, markerCount: count, skipped };
}

$("exportBuild").addEventListener("click", async () => {
  const from = $("exportFrom").value;
  const to = $("exportTo").value;
  const summary = $("exportSummary");
  summary.textContent = "";
  $("exportResult").classList.remove("hidden");
  $("exportCopied").classList.add("hidden");

  if (!from || !to || from > to) {
    summary.append(element("div", "error", "請選擇正確的日期範圍。"));
    $("exportText").value = "";
    $("exportCopy").disabled = true;
    return;
  }

  const result = buildExport(await loadVideos(), from, to);
  summary.append(element("div", "", `${result.videoCount} 支影片，${result.markerCount} 個 Marker。`));
  if (result.skipped.length) {
    summary.append(element("div", "error", "以下影片缺少網址，未匯出。請先在該影片頁開啟一次 MPY Timecode Marker："));
    const list = element("ul");
    result.skipped.forEach((title) => list.append(element("li", "", title)));
    summary.append(list);
  }
  $("exportText").value = result.markerCount ? result.text : "";
  $("exportCopy").disabled = result.markerCount === 0;
});

$("exportCopy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("exportText").value);
  $("exportCopied").classList.remove("hidden");
});

// ---- Import ----

function parseExport(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  if (!lines.includes(EXPORT_HEADER)) {
    return { videos: [], errors: [`找不到「${EXPORT_HEADER}」開頭，請貼上完整的匯出文字。`] };
  }

  const videos = [];
  const errors = [];
  let current = null;

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (!line || line === EXPORT_HEADER) return;

    if (line.startsWith(VIDEO_PREFIX)) {
      current = { title: line.slice(VIDEO_PREFIX.length).trim(), pageUrl: "", videoKey: null, markers: [] };
      videos.push(current);
      return;
    }
    // Lines before the first video, such as the summary line, carry no data.
    if (!current) return;

    if (!current.pageUrl) {
      current.pageUrl = line;
      current.videoKey = videoKeyFromUrl(line);
      if (!current.videoKey) errors.push(`第 ${lineNo} 行：不支援的影片網址「${line}」`);
      return;
    }

    const match = line.match(/^(\d+:\d{2}:\d{2})(?:\s+(.*))?$/);
    const time = match && parseTimecode(match[1]);
    if (time === null || time === undefined) {
      errors.push(`第 ${lineNo} 行：無法辨識「${line}」`);
      return;
    }
    current.markers.push({ time, note: match[2]?.trim() || "Marker" });
  });

  return { videos: videos.filter((video) => video.videoKey), errors };
}

function sameMarker(a, b) {
  return Math.floor(a.time) === Math.floor(b.time) && (a.note || "Marker") === (b.note || "Marker");
}

// Works out what an import would add, against what is stored right now.
async function planImport(parsed) {
  const keys = parsed.videos.flatMap((video) => [markersKey(video.videoKey), videoMetaKey(video.videoKey)]);
  const stored = await chrome.storage.local.get(keys);

  return parsed.videos.map((video) => {
    const existing = stored[markersKey(video.videoKey)] || [];
    const added = [];
    video.markers.forEach((marker) => {
      if ([...existing, ...added].some((other) => sameMarker(other, marker))) return;
      added.push(marker);
    });
    return {
      ...video,
      existing,
      added,
      duplicates: video.markers.length - added.length,
      hasMeta: Boolean(stored[videoMetaKey(video.videoKey)])
    };
  });
}

function renderImportSummary(plan, errors) {
  const summary = $("importSummary");
  summary.textContent = "";

  if (errors.length) {
    const list = element("ul", "error");
    errors.forEach((error) => list.append(element("li", "", error)));
    summary.append(element("div", "error", "以下內容無法匯入："), list);
  }

  if (plan.length) {
    const list = element("ul");
    plan.forEach((video) => {
      const state = video.existing.length ? `現有 ${video.existing.length} 個` : "新影片";
      list.append(element("li", "", `${video.title}（${state}）：新增 ${video.added.length} 個，重複略過 ${video.duplicates} 個`));
    });
    summary.append(list);
  }

  const total = plan.reduce((sum, video) => sum + video.added.length, 0);
  if (!plan.length && !errors.length) summary.append(element("div", "", "沒有可匯入的 Marker。"));
  $("importApply").disabled = total === 0;
  $("importApply").textContent = total ? `匯入 ${total} 個 Marker` : "沒有新的 Marker";
}

$("importPreview").addEventListener("click", async () => {
  const parsed = parseExport($("importText").value);
  renderImportSummary(await planImport(parsed), parsed.errors);
  $("importResult").classList.remove("hidden");
});

$("importApply").addEventListener("click", async () => {
  // Re-plan so the merge uses the latest stored markers.
  const parsed = parseExport($("importText").value);
  const plan = await planImport(parsed);
  const updates = {};
  plan.forEach((video) => {
    if (!video.added.length) return;
    updates[markersKey(video.videoKey)] = [
      ...video.existing,
      ...video.added.map((marker) => newMarker(marker.time, marker.note))
    ];
    if (!video.hasMeta) {
      updates[videoMetaKey(video.videoKey)] = { site: video.videoKey.startsWith("youtube:") ? "youtube" : "tcc", title: video.title, pageUrl: video.pageUrl };
    }
  });
  await chrome.storage.local.set(updates);

  const total = plan.reduce((sum, video) => sum + video.added.length, 0);
  $("importSummary").textContent = `已匯入 ${total} 個 Marker。`;
  $("importApply").disabled = true;
  $("importText").value = "";
});

// ---- Init ----

$("version").textContent = `v${chrome.runtime.getManifest().version}`;
const today = localDate(Date.now());
$("exportFrom").value = today;
$("exportTo").value = today;
Promise.all([loadSettings(), loadMarkerMode()]).then(refreshList);
