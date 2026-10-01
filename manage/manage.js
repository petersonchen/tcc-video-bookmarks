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

async function loadVideos() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter((key) => key.startsWith("markers:") && Array.isArray(all[key]) && all[key].length)
    .map((key) => {
      const videoKey = key.slice("markers:".length);
      const meta = all[videoMetaKey(videoKey)] || {};
      return {
        videoKey,
        title: meta.title || videoKey,
        pageUrl: meta.pageUrl || "",
        markers: [...all[key]].sort((a, b) => a.time - b.time)
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"));
}

async function renderVideos() {
  const videos = await loadVideos();
  const list = $("videos");
  list.textContent = "";
  $("videosEmpty").classList.toggle("hidden", videos.length > 0);

  videos.forEach((video) => {
    const row = element("div", "video");
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

    const lastUpdated = video.markers.map(markerUpdatedAt).sort().at(-1);
    row.append(
      title,
      element("span", "muted", `${video.markers.length} 個 Marker`),
      element("span", "muted", `最後修改 ${localDate(lastUpdated)}`)
    );
    list.append(row);
  });
}

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
  await renderVideos();
});

// ---- Init ----

$("version").textContent = `v${chrome.runtime.getManifest().version}`;
const today = localDate(Date.now());
$("exportFrom").value = today;
$("exportTo").value = today;
renderVideos();
