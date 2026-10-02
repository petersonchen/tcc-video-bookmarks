// Episode list: search, rendering, drag and drop, and inline Marker edits.

let dragging = null;
let pendingRefresh = false;
const selectedVideoKeys = new Set();
const selectedRows = new Map();
let visibleRows = new Map();
const selectionKey = (episodeId, videoKey) => JSON.stringify([episodeId, videoKey]);
let visibleVideoKeys = new Set();
// The list renders at most this many videos until "顯示更多" raises the limit,
// so a large library or a broad search does not build thousands of rows.
const LIST_PAGE_SIZE = 200;
let listLimit = LIST_PAGE_SIZE;

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

// The site a term names: the start of a site label ("y", "t"),
// or the alias "yt". Site labels are kept out of the fuzzy text, or
// "tcc" would match any text with t, c, c in order.
function siteForTerm(term) {
  if (term === "yt") return "youtube";
  if (!term.length) return null;
  return Object.keys(SITE_LABELS).find((site) => SITE_LABELS[site].toLowerCase().startsWith(term)) || null;
}

function searchTerms() {
  return $("search").value.normalize("NFKC").trim().toLowerCase().match(/"[^"]+":|\S+/g) || [];
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
  // An empty Episode remains visible without a search, or when its name matches.
  const matched = groups.map((episode) => ({
    episode,
    groupVideos: Library.groupVideos(snapshot, episode.id, videos).map((video) => ({
      ...video, markers: video.markers.filter((marker) => matchesMarker(video, marker, episode.name, terms))
    })).filter((video) => video.markers.length)
  })).filter(({ episode, groupVideos }) => !terms.length || groupVideos.length ||
    terms.every((term) => Library.matchEpisodeTerm(episode.name, term) ?? termMatches(episode.name.toLowerCase(), term)));
  let budget = listLimit;
  let hiddenVideos = 0;
  let hiddenGroups = 0;
  matched.forEach(({ episode, groupVideos }) => {
    if (budget <= 0) {
      // backlog is not an Episode, so only its videos are counted.
      if (episode.id) hiddenGroups++;
      hiddenVideos += groupVideos.length;
      return;
    }
    const group = element("section", "episode-group");
    group.dataset.episodeId = episode.id;
    const heading = element("div", "episode-heading");
    heading.append(element("h3", "episode-name", `${episode.name}:`), element("span", "group-count", `${groupVideos.length} 支影片`));
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
    const shownVideos = groupVideos.slice(0, budget);
    budget -= shownVideos.length;
    hiddenVideos += groupVideos.length - shownVideos.length;
    shownVideos.forEach((video) => {
      visibleVideoKeys.add(video.videoKey);
      visibleRows.set(selectionKey(episode.id, video.videoKey), { episodeId: episode.id, videoKey: video.videoKey });
      group.append(renderVideo(video, episode.id, canDrag));
    });
    if (!groupVideos.length) group.append(element("div", "empty", episode.id ? "尚未加入影片" : "沒有尚未加入 Episode 的影片"));
    list.append(group);
  });
  $("listEmpty").classList.toggle("hidden", list.children.length > 0);
  const hidden = terms.length ? 0 : allEpisodes.length - shown.length;
  $("listHint").textContent = hidden ? `另有 ${hidden} 個 Episode 未顯示。可用搜尋找到，或在設定增加顯示數量。` : "";
  $("listHint").classList.toggle("hidden", !hidden);
  $("listMore").textContent = `顯示更多（還有 ${hiddenVideos} 支影片${hiddenGroups ? `、${hiddenGroups} 個 Episode` : ""}）`;
  $("listMore").classList.toggle("hidden", !hiddenVideos && !hiddenGroups);
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
  row.append(element("span", "marker-time", formatTime(marker.time)), element("span", "", marker.note || DEFAULT_MARKER_NOTE));
  row.addEventListener("click", () => seekMarker(video, marker, play));
  return row;
}

function renderEditableMarker(video, marker) {
  const row = element("div", "marker marker-editable");

  const { time, note } = markerEditFields(video.videoKey, marker, (error) => showToast(error.message));

  const remove = element("button", "delete", "×");
  remove.title = "刪除";
  remove.addEventListener("click", () => run(async () => {
    const deletedAt = new Date().toISOString();
    await changeMarker(video.videoKey, marker.id, { deletedAt });
    showUndo(video.videoKey, marker, deletedAt);
  }));

  const play = element("button", "marker-preview", "▶");
  play.type = "button";
  play.title = "從此 Marker 播放（Shift+點選：在背景分頁播放，留在管理頁）";
  play.setAttribute("aria-label", "從此 Marker 播放");
  play.addEventListener("click", (event) => seekMarker(video, {
    ...marker, time: parseTimecode(time.value) ?? marker.time
  }, true, event.shiftKey));

  // Shift+Enter saves the timecode and plays from it in the background, like
  // Shift-clicking ▶. The field keeps the focus for further ↑／↓ steps.
  time.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !event.shiftKey) return;
    seekMarker(video, { ...marker, time: parseTimecode(time.value) ?? marker.time }, true, true);
  });

  row.append(play, time, note, remove);
  return row;
}

// Only the latest deletion can be undone.
function showUndo(videoKey, marker, deletedAt) {
  showToast(`已刪除「${marker.note || DEFAULT_MARKER_NOTE}」`, "復原", () =>
    changeMarker(videoKey, marker.id, { deletedAt: undefined }, deletedAt)
  );
}

$("listMore").addEventListener("click", () => {
  listLimit += LIST_PAGE_SIZE;
  renderList();
});

$("search").addEventListener("input", () => {
  listLimit = LIST_PAGE_SIZE;
  selectedRows.clear();
  selectedVideoKeys.clear();
  renderList();
});

$("list").addEventListener("focusout", () => {
  setTimeout(() => {
    if (!pendingRefresh || document.activeElement?.matches("#list input")) return;
    pendingRefresh = false;
    run(refreshList);
  });
});
