// Selection toolbar and the Episode, assign, and remove dialogs.

let removeRows = [];
let removingVideos = false;
let assignVideoKeys = [];
let assigningVideos = false;

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
      showToast(`已刪除 ${before.name}`, "復原", () => withStorageLock(async () => {
        const all = await chrome.storage.local.get(null);
        const key = Library.episodeKey(id);
        if (all[key]?.deletedAt !== deletedAt) return;
        const name = Library.checkName(all[key].name, all, id);
        const { deletedAt: removed, ...restored } = all[key];
        await chrome.storage.local.set({ [key]: { ...restored, name, updatedAt: new Date().toISOString() } });
      }));
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
  settings.lastEpisodeId = id;
  renderAssignVideos();
  await updateSettings({ lastEpisodeId: id });
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
