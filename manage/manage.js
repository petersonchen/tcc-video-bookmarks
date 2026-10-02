const $ = (id) => document.getElementById(id);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SITE_LABELS = { tcc: "TCC", youtube: "YouTube" };

// Reads the stored array again so changes made in the popup meanwhile are kept.
// A value of undefined removes the field.
async function changeMarker(videoKey, id, changes, expectedDeletedAt) {
  return withStorageLock(async () => {
    const key = markersKey(videoKey);
    const stored = (await chrome.storage.local.get(key))[key] || [];
    const marker = stored.find((item) => item.id === id);
    if (!marker || (expectedDeletedAt && marker.deletedAt !== expectedDeletedAt)) return;
    if (marker.deletedAt && !Object.hasOwn(changes, "deletedAt")) return;
    Object.entries(changes).forEach(([field, value]) => {
      if (value === undefined) delete marker[field];
      else marker[field] = value;
    });
    await chrome.storage.local.set({ [key]: stored });
  });
}

// ---- Settings ----

const DEFAULT_SETTINGS = { recentEpisodes: 10 };
let settings = { ...DEFAULT_SETTINGS };

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
  await withStorageLock(async () => {
    const stored = (await chrome.storage.local.get("settings")).settings || {};
    await chrome.storage.local.set({ settings: { ...stored, recentEpisodes: count } });
  });
}));

// ---- Marker list ----

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

let videos = [];
let snapshot = {};
let dragging = null;
let pendingRefresh = false;
let toastTimer;
let previewPlan = null;
const selectedVideoKeys = new Set();
const selectedRows = new Map();
let visibleRows = new Map();
let removeRows = [];
let removingVideos = false;
const selectionKey = (episodeId, videoKey) => JSON.stringify([episodeId, videoKey]);
let visibleVideoKeys = new Set();
let assignVideoKeys = [];
let assigningVideos = false;


// All UI actions report failures without losing the page.
async function run(action) {
  try { await action(); }
  catch (error) { showToast(error.message); }
}

function actionButton(text, action, className = "small-button") {
  const button = element("button", className, text);
  button.type = "button";
  button.addEventListener("click", () => run(action));
  return button;
}

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

async function refreshList() {
  snapshot = await chrome.storage.local.get(null);
  videos = Library.videos(snapshot);
  renderList();
  refreshTargets();
}

function searchTerms() {
  return $("search").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesMarker(video, marker, episodeName, terms) {
  const text = `${episodeName} ${video.title} ${formatTime(marker.time)} ${marker.note || ""}`.toLowerCase();
  return terms.every((term) => Library.matchEpisodeTerm(episodeName, term)
    ?? (siteForTerm(term) === video.site || termMatches(text, term)));
}

function renderList() {
  const terms = searchTerms();
  const allEpisodes = Library.episodes(snapshot);
  const shown = terms.length || !settings.recentEpisodes ? allEpisodes : allEpisodes.slice(0, settings.recentEpisodes);
  const showBacklog = markerMode === "edit" || terms.length > 0;
  const groups = [...shown, ...(showBacklog ? [{ id: "", name: "backlog" }] : [])];
  const canDrag = markerMode === "edit" && !terms.length;
  const list = $("list");
  list.textContent = "";
  visibleVideoKeys = new Set();
  visibleRows = new Map();
  groups.forEach((episode) => {
    const groupVideos = Library.groupVideos(snapshot, episode.id).map((video) => ({
      ...video, markers: video.markers.filter((marker) => matchesMarker(video, marker, episode.name, terms))
    })).filter((video) => video.markers.length);
    // An empty Episode remains visible without a search, or when its name matches.
    if (terms.length && !groupVideos.length && !terms.every((term) => Library.matchEpisodeTerm(episode.name, term) ?? termMatches(episode.name.toLowerCase(), term))) return;
    const group = element("section", "episode-group");
    group.dataset.episodeId = episode.id;
    const heading = element("div", "episode-heading");
    heading.append(element("h3", "episode-name", episode.name), element("span", "group-count", `${groupVideos.length} 支影片`));
    const actions = element("div", "group-actions");
    if (episode.id) {
      if (markerMode === "edit") {
        actions.append(actionButton("匯出", () => generateExport(episode.id)));
        actions.append(actionButton("改名", () => openEpisodeDialog("rename", episode.id)),
          actionButton("刪除", () => openEpisodeDialog("delete", episode.id)));
      }
      if (canDrag) enableGroupDrop(group, episode.id);
    } else {
      if (markerMode === "edit") actions.append(actionButton("匯出", () => generateExport("")));
    }
    heading.append(actions);
    group.append(heading);
    groupVideos.forEach((video) => {
      visibleVideoKeys.add(video.videoKey);
      visibleRows.set(selectionKey(episode.id, video.videoKey), { episodeId: episode.id, videoKey: video.videoKey });
      group.append(renderVideo(video, episode.id, canDrag));
    });
    if (!groupVideos.length) group.append(element("div", "empty", episode.id ? "尚未加入影片" : "沒有尚未加入 Episode 的影片"));
    list.append(group);
  });
  $("listEmpty").textContent = "沒有符合的 Episode 或 Marker";
  $("listEmpty").classList.toggle("hidden", list.children.length > 0);
  const hidden = terms.length ? 0 : allEpisodes.length - shown.length;
  $("listHint").textContent = hidden ? `另有 ${hidden} 個 Episode 未顯示。可用搜尋找到，或在設定增加顯示數量。` : "";
  $("listHint").classList.toggle("hidden", !hidden);
  for (const key of selectedRows.keys()) if (!visibleRows.has(key)) selectedRows.delete(key);
  updateSelection();
}

function renderVideo(video, episodeId, canDrag) {
  const block = element("div", "video");
  block.dataset.videoKey = video.videoKey;
  const heading = element("div", "video-heading");
  const title = element("div", "video-title");
  if (video.pageUrl) {
    const link = element("a", "", video.title);
    link.href = video.pageUrl;
    link.target = "_blank";
    title.append(link);
  } else title.textContent = video.title;
  title.title = video.title;
  heading.append(element("span", `site-badge site-${video.site}`, SITE_LABELS[video.site]), title);
  if (canDrag) {
    const handle = element("span", "drag-handle", "⋮⋮");
    handle.title = episodeId ? "拖拉排序，或拖到其他 Episode 加入影片" : "拖到 Episode 加入影片";
    heading.prepend(handle);
    enableDrag(block, handle, episodeId);
  } else {
    const spacer = element("span", "drag-spacer control-spacer");
    spacer.setAttribute("aria-hidden", "true");
    heading.prepend(spacer);
  }
  if (markerMode === "edit") {
    const select = element("input", "video-select");
    select.type = "checkbox";
    select.value = video.videoKey;
    const rowKey = selectionKey(episodeId, video.videoKey);
    select.dataset.selectionKey = rowKey;
    select.checked = selectedRows.has(rowKey);
    select.setAttribute("aria-label", `選取影片：${video.title}`);
    select.addEventListener("change", () => {
      if (select.checked) selectedRows.set(rowKey, { episodeId, videoKey: video.videoKey });
      else selectedRows.delete(rowKey);
      updateSelection();
    });
    heading.prepend(select);
  } else {
    const spacer = element("span", "select-spacer control-spacer");
    spacer.setAttribute("aria-hidden", "true");
    heading.prepend(spacer);
  }
  block.append(heading);
  video.markers.forEach((marker) => block.append(renderMarker(video, marker)));
  return block;
}

function clearDropMarks() {
  document.querySelectorAll(".drop-before, .drop-after, .drop-group").forEach((node) => node.classList.remove("drop-before", "drop-after", "drop-group"));
}

function enableGroupDrop(group, episodeId) {
  group.addEventListener("dragover", (event) => {
    if (!dragging || dragging.episodeId === episodeId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    group.classList.add("drop-group");
  });
  group.addEventListener("dragleave", (event) => {
    if (!group.contains(event.relatedTarget)) group.classList.remove("drop-group");
  });
  group.addEventListener("drop", (event) => {
    if (!dragging || dragging.episodeId === episodeId) return;
    event.preventDefault();
    const key = dragging.videoKey;
    clearDropMarks();
    run(() => addVideos(episodeId, [key]));
  });
}

function enableDrag(block, handle, episodeId) {
  const videoKey = block.dataset.videoKey;
  handle.draggable = true;
  handle.addEventListener("dragstart", (event) => {
    dragging = { episodeId, videoKey };
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("text/plain", videoKey);
    event.dataTransfer.setDragImage(block, 0, 0);
    block.classList.add("dragging");
  });
  handle.addEventListener("dragend", () => {
    dragging = null;
    block.classList.remove("dragging");
    clearDropMarks();
    if (pendingRefresh) { pendingRefresh = false; run(refreshList); }
  });
  block.addEventListener("dragover", (event) => {
    if (!episodeId || !dragging || dragging.episodeId !== episodeId || dragging.videoKey === videoKey) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const rect = block.getBoundingClientRect();
    clearDropMarks();
    block.classList.add(event.clientY > rect.top + rect.height / 2 ? "drop-after" : "drop-before");
  });
  block.addEventListener("drop", (event) => {
    if (!episodeId || !dragging || dragging.episodeId !== episodeId || dragging.videoKey === videoKey) return;
    event.preventDefault();
    event.stopPropagation();
    const after = block.classList.contains("drop-after");
    const moved = dragging.videoKey;
    clearDropMarks();
    run(() => updateEpisode(episodeId, (episode) => {
      const keys = episode.videoKeys.filter((key) => key !== moved);
      const index = keys.indexOf(videoKey);
      if (!episode.videoKeys.includes(moved) || index < 0) return episode;
      keys.splice(index + (after ? 1 : 0), 0, moved);
      return { ...episode, videoKeys: keys };
    }));
  });
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
  const row = element("div", "marker marker-editable");

  const time = element("input", "marker-edit marker-time");
  time.value = formatTime(marker.time);
  time.title = "編輯 Timecode";
  time.addEventListener("change", () => run(async () => {
    const value = parseTimecode(time.value);
    if (value === null) {
      time.value = formatTime(marker.time);
      return;
    }
    await changeMarker(video.videoKey, marker.id, { time: value, updatedAt: new Date().toISOString() });
  }));

  const note = element("input", "marker-edit marker-note");
  note.value = marker.note || "Marker";
  note.title = "編輯標題";
  note.addEventListener("change", () => run(async () => {
    await changeMarker(video.videoKey, marker.id, {
      note: note.value.trim() || "Marker",
      updatedAt: new Date().toISOString()
    });
  }));

  [time, note].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
    });
  });

  const remove = element("button", "delete", "×");
  remove.title = "刪除";
  remove.addEventListener("click", () => run(async () => {
    const deletedAt = new Date().toISOString();
    await changeMarker(video.videoKey, marker.id, { deletedAt });
    showUndo(video.videoKey, marker, deletedAt);
  }));

  const play = element("button", "marker-preview", "▶");
  play.type = "button";
  play.title = "從此 Marker 播放";
  play.setAttribute("aria-label", "從此 Marker 播放");
  play.addEventListener("click", () => seekMarker(video, {
    ...marker, time: parseTimecode(time.value) ?? marker.time
  }, true));

  row.append(play, time, note, remove);
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
    await run(onAction);
  };
  $("toast").classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 8000);
}

async function updateEpisode(id, change) {
  return withStorageLock(async () => {
    const key = Library.episodeKey(id);
    const all = await chrome.storage.local.get(null);
    const episode = all[key];
    if (!episode || episode.deletedAt) throw new Error("Episode 已不存在");
    const updated = change(episode, all);
    await chrome.storage.local.set({ [key]: { ...updated, updatedAt: new Date().toISOString() } });
    return episode;
  });
}

async function addVideos(id, keys) {
  const before = await updateEpisode(id, (episode, all) => {
    const liveKeys = new Set(Library.videos(all).map((video) => video.videoKey));
    if (keys.some((key) => !liveKeys.has(key))) throw new Error("部分影片已沒有可用 Marker，請重新選擇");
    return { ...episode, videoKeys: [...new Set([...episode.videoKeys, ...keys])] };
  });
  const added = keys.filter((key) => !before.videoKeys.includes(key));
  showToast(added.length ? `已將 ${added.length} 支影片加入 ${before.name}` : `影片已在 ${before.name} 中`, added.length ? "復原" : "", async () => run(() =>
    updateEpisode(id, (episode) => ({ ...episode, videoKeys: episode.videoKeys.filter((key) => !added.includes(key)) }))));
}

function openEpisodeDialog(mode, id = "") {
  const episode = snapshot[Library.episodeKey(id)];
  $("episodeDialog").dataset.mode = mode;
  $("episodeDialog").dataset.episodeId = id;
  $("episodeDialogTitle").textContent = mode === "new" ? "新增 Episode" : mode === "rename" ? "Episode 改名" : "刪除 Episode";
  $("episodeName").value = episode?.name || "";
  $("episodeNameLabel").classList.toggle("hidden", mode === "delete");
  $("episodeDeleteHint").textContent = `刪除 ${episode?.name || ""}？影片與 Marker 會保留；沒有其他歸屬的影片會回到 backlog。`;
  $("episodeDeleteHint").classList.toggle("hidden", mode !== "delete");
  $("episodeSave").textContent = mode === "delete" ? "刪除" : "儲存";
  $("episodeSave").classList.toggle("danger", mode === "delete");
  $("episodeSave").classList.toggle("primary", mode !== "delete");
  $("episodeDialogError").textContent = "";
  $("episodeDialog").showModal();
  if (mode !== "delete") $("episodeName").focus();
}

$("newEpisode").addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  openEpisodeDialog("new");
});
$("episodeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const mode = $("episodeDialog").dataset.mode;
  const id = $("episodeDialog").dataset.episodeId;
  $("episodeSave").disabled = true;
  try {
    if (mode === "new") {
      await withStorageLock(async () => {
        const all = await chrome.storage.local.get(null);
        const episode = Library.newEpisode($("episodeName").value, all);
        await chrome.storage.local.set({ [Library.episodeKey(episode.id)]: episode });
        showToast(`已建立 ${episode.name}；可搜尋名稱找到未顯示的 Episode`);
      });
    } else if (mode === "rename") {
      await updateEpisode(id, (episode, all) => ({ ...episode, name: Library.checkName($("episodeName").value, all, id) }));
    } else {
      const deletedAt = new Date().toISOString();
      const before = await updateEpisode(id, (episode) => ({ ...episode, deletedAt }));
      showToast(`已刪除 ${before.name}`, "復原", async () => run(() => withStorageLock(async () => {
        const all = await chrome.storage.local.get(null);
        const key = Library.episodeKey(id);
        if (all[key]?.deletedAt !== deletedAt) return;
        const name = Library.checkName(all[key].name, all, id);
        const { deletedAt: removed, ...restored } = all[key];
        await chrome.storage.local.set({ [key]: { ...restored, name, updatedAt: new Date().toISOString() } });
      })));
    }
    $("episodeDialog").close();
    await refreshList();
  } catch (error) { $("episodeDialogError").textContent = error.message; }
  finally { $("episodeSave").disabled = false; }
});

function populateEpisodes(select, firstOptions, preferred, filter = () => true) {
  const value = preferred === undefined ? select.value : preferred;
  select.replaceChildren();
  firstOptions.forEach(([id, name]) => {
    const option = element("option", "", name); option.value = id; select.append(option);
  });
  Library.episodes(snapshot).filter(filter).forEach((episode) => {
    const option = element("option", "", episode.name); option.value = episode.id; select.append(option);
  });
  if ([...select.options].some((option) => option.value === value)) select.value = value;
}

function refreshTargets() {
  populateEpisodes($("exportEpisode"), [["", "backlog"], ["backup", "完整備份（所有資料）"]]);
  populateEpisodes($("importTarget"), [["", "不指定 Episode"], ["new", "建立新 Episode"]]);
  if ($("assignDialog").open) {
    populateAssignEpisodes();
    renderAssignVideos();
  }
  if ($("removeDialog").open) renderRemoveGroups();
}

function updateSelection() {
  selectedVideoKeys.clear();
  for (const row of selectedRows.values()) selectedVideoKeys.add(row.videoKey);
  $("editSelection").classList.toggle("hidden", markerMode !== "edit");
  $("newEpisode").classList.toggle("hidden", markerMode !== "edit");
  $("selectionCount").textContent = `已選 ${selectedVideoKeys.size} 支影片${selectedRows.size > selectedVideoKeys.size ? `（${selectedRows.size} 個位置）` : ""}`;
  $("assignSelected").disabled = selectedVideoKeys.size === 0;
  $("removeSelected").disabled = !Library.planRemovals(snapshot, [...selectedRows.values()]).length;
  $("clearSelection").disabled = selectedVideoKeys.size === 0;
  $("selectAllVideos").disabled = visibleVideoKeys.size === 0;
  document.querySelectorAll(".video-select").forEach((checkbox) => {
    checkbox.checked = selectedRows.has(checkbox.dataset.selectionKey);
  });
}

// Buttons inside the summary should operate without toggling the library.
$("editSelection").addEventListener("click", (event) => {
  if (event.target.closest("button")) event.preventDefault();
});

$("selectAllVideos").addEventListener("click", () => {
  for (const [key, row] of visibleRows) selectedRows.set(key, row);
  updateSelection();
});
$("clearSelection").addEventListener("click", () => {
  selectedRows.clear();
  selectedVideoKeys.clear();
  updateSelection();
});
$("assignSelected").addEventListener("click", () => run(() => openAssign([...selectedVideoKeys])));

$("removeSelected").addEventListener("click", () => {
  removeRows = [...selectedRows.values()].filter((row) => row.episodeId);
  $("removeError").textContent = "";
  renderRemoveGroups();
  $("removeDialog").showModal();
});

function populateAssignEpisodes(preferred) {
  populateEpisodes($("assignEpisode"), [["", "選擇 Episode"]], preferred);
}

function openAssign(keys) {
  assignVideoKeys = [...new Set(keys)];
  $("assignError").textContent = "";
  populateAssignEpisodes(settings.lastEpisodeId || "");
  renderAssignVideos();
  $("assignDialog").showModal();
}

function renderAssignVideos() {
  const list = $("assignVideos");
  const target = snapshot[Library.episodeKey($("assignEpisode").value)];
  const byKey = new Map(videos.map((video) => [video.videoKey, video]));
  let available = 0;
  list.replaceChildren();
  assignVideoKeys.forEach((key) => {
    const video = byKey.get(key);
    const belongs = target?.videoKeys.includes(key);
    if (video && !belongs) available++;
    const status = !video ? "（沒有可用 Marker）" : belongs ? "（已加入）" : "";
    list.append(element("div", "assign-video", `${video?.title || key}${status}`));
  });
  $("assignSummary").textContent = target
    ? `選取 ${assignVideoKeys.length} 支影片，將加入 ${available} 支；已加入的影片會略過。`
    : `選取 ${assignVideoKeys.length} 支影片，請選擇目標 Episode。`;
  $("assignSave").disabled = assigningVideos || !target || !available;
}

$("assignEpisode").addEventListener("change", () => run(async () => {
  const id = $("assignEpisode").value;
  const preference = "lastEpisodeId";
  settings[preference] = id;
  renderAssignVideos();
  await withStorageLock(async () => {
    const stored = (await chrome.storage.local.get("settings")).settings || {};
    await chrome.storage.local.set({ settings: { ...stored, [preference]: id } });
  });
}));
$("assignForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (assigningVideos) return;
  assigningVideos = true;
  $("assignSave").disabled = true;
  try {
    const liveKeys = new Set(videos.map((video) => video.videoKey));
    const keys = assignVideoKeys.filter((key) => liveKeys.has(key));
    const id = $("assignEpisode").value;
    if (!keys.length || !id) throw new Error("請選擇 Episode 與影片");
    await addVideos(id, keys);
    for (const [key, row] of selectedRows) if (keys.includes(row.videoKey)) selectedRows.delete(key);
    updateSelection();
    $("assignDialog").close();
  } catch (error) { $("assignError").textContent = error.message; }
  finally { assigningVideos = false; if ($("assignDialog").open) renderAssignVideos(); }
});

function renderRemoveGroups() {
  const groups = Library.planRemovals(snapshot, removeRows);
  const byKey = new Map(videos.map((video) => [video.videoKey, video]));
  $("removeGroups").replaceChildren();
  groups.forEach((group) => {
    const section = element("section", "remove-group");
    section.append(element("h3", "episode-name", `${group.name}（${group.videoKeys.length} 支影片）`));
    group.videoKeys.forEach((key) => section.append(element("div", "assign-video", byKey.get(key)?.title || key)));
    $("removeGroups").append(section);
  });
  $("removeSummary").textContent = `將從 ${groups.length} 個 Episode 移除 ${groups.reduce((sum, group) => sum + group.videoKeys.length, 0)} 筆影片歸屬。`;
  $("removeSave").disabled = removingVideos || !groups.length;
}

async function removeMemberships(rows) {
  const groups = await withStorageLock(async () => {
    const all = await chrome.storage.local.get(null);
    const groups = Library.planRemovals(all, rows);
    const updates = {};
    for (const group of groups) {
      const key = Library.episodeKey(group.episodeId);
      updates[key] = { ...all[key], videoKeys: all[key].videoKeys.filter((videoKey) => !group.videoKeys.includes(videoKey)), updatedAt: new Date().toISOString() };
    }
    if (groups.length) await chrome.storage.local.set(updates);
    return groups;
  });
  if (!groups.length) { showToast("所選歸屬已移除"); return; }
  const count = groups.reduce((sum, group) => sum + group.videoKeys.length, 0);
  showToast(`已從 ${groups.length} 個 Episode 移除 ${count} 筆影片歸屬`, "復原", () => withStorageLock(async () => {
    const all = await chrome.storage.local.get(null);
    const updates = {};
    groups.forEach((group) => {
      const key = Library.episodeKey(group.episodeId);
      const episode = all[key];
      if (!episode || episode.deletedAt) return;
      updates[key] = { ...episode, videoKeys: Library.restoreEpisodeVideos(episode.videoKeys, group.beforeKeys, group.videoKeys), updatedAt: new Date().toISOString() };
    });
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  }));
}

$("removeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (removingVideos) return;
  removingVideos = true;
  $("removeSave").disabled = true;
  try {
    await removeMemberships(removeRows);
    for (const row of removeRows) selectedRows.delete(selectionKey(row.episodeId, row.videoKey));
    updateSelection();
    $("removeDialog").close();
  } catch (error) { $("removeError").textContent = error.message; }
  finally { removingVideos = false; if ($("removeDialog").open) renderRemoveGroups(); }
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => $(button.dataset.closeDialog).close());
});

// Dates stay intact. Existing videos naturally become backlog members.
async function migrateLibrary() {
  await withStorageLock(async () => {
    const all = await chrome.storage.local.get(null);
    if (all.libraryVersion === 2) return;
    const updates = { libraryVersion: 2 };
    const { recentDays, ...storedSettings } = all.settings || {};
    updates.settings = { ...DEFAULT_SETTINGS, ...storedSettings };
    Object.entries(all).forEach(([key, meta]) => {
      if (key.startsWith("videos:") && meta && Object.hasOwn(meta, "pickedAt")) {
        const { pickedAt, ...remaining } = meta;
        updates[key] = remaining;
      }
    });
    const oldOrders = Object.keys(all).filter((key) => /^order:\d{4}-\d{2}-\d{2}$/.test(key));
    if (oldOrders.length) await chrome.storage.local.remove(oldOrders);
    await chrome.storage.local.set(updates);
  });
}

// Only the latest deletion can be undone.
function showUndo(videoKey, marker, deletedAt) {
  showToast(`已刪除「${marker.note || "Marker"}」`, "復原", () =>
    changeMarker(videoKey, marker.id, { deletedAt: undefined }, deletedAt)
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

$("search").addEventListener("input", () => {
  selectedRows.clear();
  selectedVideoKeys.clear();
  renderList();
});

// Re-rendering would drop an edit in progress, so wait until focus leaves the
// list's inputs.
chrome.storage.onChanged.addListener((changes, area) => run(async () => {
  if (area !== "local") return;
  if (changes.settings) await loadSettings();
  if (changes.markerMode) await loadMarkerMode();
  if (dragging || document.activeElement?.matches("#list input")) pendingRefresh = true;
  else await refreshList();
}));

$("list").addEventListener("focusout", () => {
  setTimeout(() => {
    if (!pendingRefresh || document.activeElement?.matches("#list input")) return;
    pendingRefresh = false;
    run(refreshList);
  });
});

// ---- Export / Import ----

async function generateExport(id, backup = false) {
  const all = await chrome.storage.local.get(null);
  const data = Library.exportData(all, id, backup);
  $("exportEpisode").value = backup ? "backup" : id;
  $("exportPanel").open = true;
  $("exportResult").classList.remove("hidden");
  $("exportCopied").classList.add("hidden");
  $("exportText").value = JSON.stringify(data, null, 2);
  $("exportSummary").textContent = `${data.kind === "backup" ? "完整備份" : data.episodes[0]?.name || "backlog"}：${data.videos.length} 支影片，${data.videos.reduce((sum, video) => sum + video.markers.length, 0)} 個 Marker。`;
  $("exportCopy").disabled = false;
  $("exportDownload").disabled = false;
}

$("exportBuild").addEventListener("click", () => run(() => {
  const id = $("exportEpisode").value;
  return generateExport(id === "backup" ? "" : id, id === "backup");
}));
$("exportCopy").addEventListener("click", () => run(async () => {
  await navigator.clipboard.writeText($("exportText").value);
  $("exportCopied").classList.remove("hidden");
}));
$("exportDownload").addEventListener("click", () => {
  const data = JSON.parse($("exportText").value);
  const url = URL.createObjectURL(new Blob([$("exportText").value], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `mpy-${(data.episodes[0]?.name || data.kind).replace(/[^\p{L}\p{N}_-]/gu, "_")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function invalidatePreview() {
  previewPlan = null;
  $("importApply").disabled = true;
  $("importResult").classList.add("hidden");
}

function updateImportControls() {
  const parsed = Library.parse($("importText").value);
  const backup = parsed.kind === "backup";
  $("importTargetRow").classList.toggle("hidden", backup);
  $("importNameLabel").classList.toggle("hidden", backup || $("importTarget").value !== "new");
  invalidatePreview();
}

$("importText").addEventListener("input", () => {
  const parsed = Library.parse($("importText").value);
  if (parsed.kind === "episode") {
    $("importTarget").value = "new";
    $("importName").value = parsed.episodes[0].name;
  }
  updateImportControls();
});
$("importTarget").addEventListener("change", updateImportControls);
$("importName").addEventListener("input", invalidatePreview);
$("importConflict").addEventListener("change", invalidatePreview);
$("importFile").addEventListener("change", () => run(async () => {
  const file = $("importFile").files[0];
  if (!file) return;
  $("importText").value = await file.text();
  $("importText").dispatchEvent(new Event("input"));
}));

function makeImportPlan(all) {
  return Library.planImport(Library.parse($("importText").value), all, $("importTarget").value,
    $("importName").value, $("importConflict").value);
}

function renderImportSummary(plan) {
  const summary = $("importSummary");
  summary.replaceChildren();
  if (plan.kind === "backup") summary.append(element("div", "", "完整備份會合併影片與 Episode，恢復設定；保留本機其他資料。同名但不同 ID 的 Episode 會加上編號。"));
  else summary.append(element("div", "", plan.target === "new" ? `建立 Episode：${plan.name}` : plan.episodes[0] ? `加入 ${plan.episodes[0].name}` : "不指定 Episode；已歸屬的影片保留原有歸屬，其餘進入 backlog。"));
  plan.episodes.forEach((episode) => summary.append(element("div", "", `${episode.existing ? "合併" : "建立"} ${episode.name}：${episode.videoKeys.length} 支影片`)));
  const list = element("ul");
  plan.videos.forEach((video) => {
    list.append(element("li", "", `${video.title}：新增 ${video.added.length} 個，重複略過 ${video.duplicates} 個，衝突 ${video.conflicts.length} 個`));
    video.conflicts.forEach(({ local, incoming }) => {
      list.append(element("li", "error", `衝突：本機 ${formatTime(local.time)} ${local.note}${local.deletedAt ? "（已刪除）" : ""} → 匯入 ${formatTime(incoming.time)} ${incoming.note}${incoming.deletedAt ? "（已刪除）" : ""}；${plan.conflictPolicy === "incoming" ? "採用匯入內容（影響所有 Episode）" : "保留本機內容"}`));
    });
  });
  summary.append(list);
  $("importApply").disabled = false;
  $("importApply").textContent = "確認匯入";
  $("importResult").classList.remove("hidden");
}

$("importPreview").addEventListener("click", () => run(async () => {
  invalidatePreview();
  try {
    previewPlan = makeImportPlan(await chrome.storage.local.get(null));
    renderImportSummary(previewPlan);
  } catch (error) {
    $("importSummary").textContent = error.message;
    $("importResult").classList.remove("hidden");
  }
}));
$("importApply").addEventListener("click", () => run(async () => {
  if (!previewPlan) return;
  $("importApply").disabled = true;
  try {
    await withStorageLock(async () => {
      const all = await chrome.storage.local.get(null);
      const latest = makeImportPlan(all);
      if (JSON.stringify(latest) !== JSON.stringify(previewPlan)) {
        previewPlan = latest;
        renderImportSummary(latest);
        showToast("資料已變更，請確認更新後的預覽再匯入");
        return;
      }
      await chrome.storage.local.set(Library.importUpdates(latest, all));
      previewPlan = null;
      $("importSummary").textContent = "已匯入。影片與 Marker 在所有 Episode 共用。";
      $("importApply").disabled = true;
      $("importText").value = "";
      $("importFile").value = "";
    });
  } catch (error) { invalidatePreview(); throw error; }
}));

// ---- Init ----

$("version").textContent = `v${chrome.runtime.getManifest().version}`;
migrateLibrary().then(() => Promise.all([loadSettings(), loadMarkerMode()])).then(refreshList)
  .catch((error) => showToast(`無法載入：${error.message}`));

// Keep browser scrolling and keyboard focus clear of the sticky controls.
new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty("--toolbar-height", `${entry.target.offsetHeight}px`);
}).observe(document.querySelector(".marker-toolbar"));
