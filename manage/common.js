// Helpers and state shared by the manage page scripts. Loaded first.

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

let videos = [];
let snapshot = {};
let toastTimer;

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
  showToast(added.length ? `已將 ${added.length} 支影片加入 ${before.name}` : `影片已在 ${before.name} 中`, added.length ? "復原" : "", () =>
    updateEpisode(id, (episode) => ({ ...episode, videoKeys: episode.videoKeys.filter((key) => !added.includes(key)) })));
}
