// Export and import.

let previewPlan = null;

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
  link.download = `soonmarker-${(data.episodes[0]?.name || data.kind).replace(/[^\p{L}\p{N}_-]/gu, "_")}.json`;
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
