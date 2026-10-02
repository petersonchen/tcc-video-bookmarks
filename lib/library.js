// Episode membership is separate from shared video metadata and markers.
// episode:<id> { id, name, videoKeys, createdAt, updatedAt, deletedAt? }
const Library = (() => {
  const FORMAT = "MPY Timecode Marker";
  const collator = new Intl.Collator("zh-Hant", { numeric: true, sensitivity: "base" });
  const episodeKey = (id) => `episode:${id}`;
  const nameKey = (name) => name.trim().normalize("NFKC").toLocaleLowerCase();
  const episodes = (all) => Object.entries(all)
    .filter(([key, value]) => key.startsWith("episode:") && value && !value.deletedAt)
    .map(([, value]) => value)
    .sort((a, b) => collator.compare(b.name, a.name) || a.id.localeCompare(b.id));
  // Numbered Episode queries target the Episode name, using numeric prefixes, never fuzzy marker text.
  function matchEpisodeTerm(name, term) {
    const normalized = term.normalize("NFKC");
    if (normalized.endsWith(":") && !/^[\d:]+$/.test(normalized)) {
      const exactName = normalized.slice(0, -1).replace(/^"(.*)"$/, "$1");
      return nameKey(name) === nameKey(exactName);
    }
    const query = normalized.match(/^ep[_-]?(\d+)$/i);
    if (!query) return null;
    const number = query[1].replace(/^0+(?=\d)/, "");
    return [...name.normalize("NFKC").matchAll(/\bep[\s_-]*(\d+)\b/gi)]
      .some((match) => match[1].replace(/^0+(?=\d)/, "").startsWith(number));
  }
  function checkName(name, all, exceptId) {
    name = name.trim();
    if (!name || name.length > 120) throw new Error("Episode 名稱需為 1–120 個字元");
    if (nameKey(name) === "backlog") throw new Error("backlog 是保留名稱");
    if (episodes(all).some((episode) => episode.id !== exceptId && nameKey(episode.name) === nameKey(name))) {
      throw new Error("已有同名 Episode");
    }
    return name;
  }
  function newEpisode(name, all, videoKeys = []) {
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), name: checkName(name, all), videoKeys: [...new Set(videoKeys)], createdAt: now, updatedAt: now };
  }
  function videos(all) {
    return Object.entries(all).filter(([key, value]) => key.startsWith("markers:") && Array.isArray(value))
      .map(([key, stored]) => {
        const videoKey = key.slice(8);
        const meta = all[videoMetaKey(videoKey)] || {};
        const markers = stored.filter(isLive).sort((a, b) => a.time - b.time);
        return { videoKey, site: meta.site || (videoKey.startsWith("youtube:") ? "youtube" : "tcc"),
          title: meta.title || videoKey, pageUrl: meta.pageUrl || "", markers,
          lastUpdated: markers.map(markerUpdatedAt).filter(Boolean).sort().at(-1) || "" };
      }).filter((video) => video.markers.length);
  }
  function groupVideos(all, id) {
    const list = videos(all);
    if (!id) {
      const assigned = new Set(episodes(all).flatMap((episode) => episode.videoKeys));
      return list.filter((video) => !assigned.has(video.videoKey))
        .sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated) || a.title.localeCompare(b.title, "zh-Hant"));
    }
    const episode = all[episodeKey(id)];
    if (!episode || episode.deletedAt) return [];
    const byKey = new Map(list.map((video) => [video.videoKey, video]));
    return episode.videoKeys.map((key) => byKey.get(key)).filter(Boolean);
  }
  function planRemovals(all, selections) {
    return episodes(all).map((episode) => {
      const selected = new Set(selections.filter((row) => row.episodeId === episode.id).map((row) => row.videoKey));
      return { episodeId: episode.id, name: episode.name, beforeKeys: [...episode.videoKeys],
        videoKeys: episode.videoKeys.filter((key) => selected.has(key)) };
    }).filter((group) => group.videoKeys.length);
  }
  // Restore removed members around surviving neighbors without undoing later ordering.
  function restoreEpisodeVideos(current, previous, removed) {
    const keys = [...current];
    const removedSet = new Set(removed);
    previous.forEach((key, index) => {
      if (!removedSet.has(key) || keys.includes(key)) return;
      const next = previous.slice(index + 1).find((candidate) => keys.includes(candidate));
      if (next) keys.splice(keys.indexOf(next), 0, key);
      else {
        const prior = previous.slice(0, index).reverse().find((candidate) => keys.includes(candidate));
        keys.splice(prior ? keys.indexOf(prior) + 1 : keys.length, 0, key);
      }
    });
    return keys;
  }
  function exportData(all, id, backup = false) {
    const selected = id ? all[episodeKey(id)] : null;
    if (!backup && id && (!selected || selected.deletedAt)) throw new Error("Episode 已不存在");
    const selectedVideos = backup
      ? Object.keys(all).filter((key) => key.startsWith("markers:") && Array.isArray(all[key])).map((key) => key.slice(8))
      : groupVideos(all, id).map((video) => video.videoKey);
    // Metadata-only videos and empty Episode members also belong in a backup.
    if (backup) selectedVideos.push(...Object.keys(all).filter((key) => key.startsWith("videos:")).map((key) => key.slice(7)),
      ...episodes(all).flatMap((episode) => episode.videoKeys));
    const exportedVideos = [...new Set(selectedVideos)].map((videoKey) => ({
      videoKey, ...(all[videoMetaKey(videoKey)] || {}),
      markers: (all[markersKey(videoKey)] || []).filter((marker) => backup || isLive(marker))
        .map((marker) => ({ ...marker, updatedAt: markerUpdatedAt(marker) }))
    }));
    return { format: FORMAT, version: 2, kind: backup ? "backup" : id ? "episode" : "backlog",
      episodes: backup ? episodes(all) : selected ? [{ ...selected, videoKeys: selectedVideos }] : [],
      videos: exportedVideos,
      ...(backup ? { settings: all.settings || {}, markerMode: all.markerMode || "play" } : {}) };
  }
  function validateJson(data) {
    const fail = (message) => { throw new Error(message); };
    if (!data || data.format !== FORMAT || data.version !== 2 || !["episode", "backlog", "backup"].includes(data.kind)) fail("不支援的匯入格式或版本");
    if (!Array.isArray(data.videos) || !Array.isArray(data.episodes)) fail("缺少影片或 Episode 資料");
    if ((data.kind === "episode" && data.episodes.length !== 1) || (data.kind === "backlog" && data.episodes.length)) fail("Episode 資料數量不正確");
    const validDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
    const ids = new Set();
    const normalizedVideos = data.videos.map((video) => {
      if (!video || typeof video.videoKey !== "string" || !/^(youtube:|tcc:|page:).+/.test(video.videoKey) || ids.has(video.videoKey)) fail("影片識別重複或不正確");
      ids.add(video.videoKey);
      if (video.pageUrl && (typeof video.pageUrl !== "string" || videoKeyFromUrl(video.pageUrl) !== video.videoKey)) fail("影片網址與識別不一致");
      if (!Array.isArray(video.markers)) fail("Marker 資料不正確");
      const markerIds = new Set();
      const markers = video.markers.map((marker) => {
        if (!marker || typeof marker.id !== "string" || !marker.id || markerIds.has(marker.id) ||
          !Number.isFinite(marker.time) || marker.time < 0 || typeof marker.note !== "string" ||
          !validDate(marker.createdAt) || !validDate(marker.updatedAt) || (marker.deletedAt !== undefined && !validDate(marker.deletedAt))) fail("Marker 識別、時間或日期不正確");
        markerIds.add(marker.id);
        return { id: marker.id, time: marker.time, note: marker.note, createdAt: new Date(marker.createdAt).toISOString(),
          updatedAt: new Date(marker.updatedAt).toISOString(), ...(marker.deletedAt ? { deletedAt: new Date(marker.deletedAt).toISOString() } : {}) };
      });
      return { videoKey: video.videoKey, title: typeof video.title === "string" ? video.title : video.videoKey,
        pageUrl: video.pageUrl || "", site: video.videoKey.startsWith("youtube:") ? "youtube" : "tcc", markers };
    });
    const episodeIds = new Set();
    const normalizedEpisodes = data.episodes.map((episode) => {
      if (!episode || typeof episode.id !== "string" || !episode.id || ["new", "backup"].includes(episode.id) || episodeIds.has(episode.id) ||
        typeof episode.name !== "string" || !episode.name.trim() || episode.name.trim().length > 120 || nameKey(episode.name) === "backlog" ||
        !Array.isArray(episode.videoKeys) || episode.videoKeys.some((key) => !ids.has(key)) || !validDate(episode.createdAt) || !validDate(episode.updatedAt)) fail("Episode 識別、名稱、成員或日期不正確");
      episodeIds.add(episode.id);
      return { id: episode.id, name: episode.name.trim(), videoKeys: [...new Set(episode.videoKeys)],
        createdAt: new Date(episode.createdAt).toISOString(), updatedAt: new Date(episode.updatedAt).toISOString() };
    });
    if (data.kind === "episode" && normalizedEpisodes[0].videoKeys.length !== ids.size) fail("Episode 的影片資料與成員不一致");
    const settings = {};
    if (Number.isInteger(data.settings?.recentEpisodes) && data.settings.recentEpisodes >= 0) settings.recentEpisodes = data.settings.recentEpisodes;
    for (const key of ["lastEpisodeId"]) {
      if (typeof data.settings?.[key] === "string") settings[key] = data.settings[key];
    }
    return { format: FORMAT, version: 2, kind: data.kind, videos: normalizedVideos, episodes: normalizedEpisodes,
      settings, markerMode: ["cue", "play", "edit"].includes(data.markerMode) ? data.markerMode : "play", errors: [] };
  }
  function parse(text) { return ImportFormats.parse(text, validateJson); }
  const sameContent = (a, b) => a.time === b.time && a.note === b.note;
  const sameState = (a, b) => sameContent(a, b) && Boolean(a.deletedAt) === Boolean(b.deletedAt);
  function uniqueName(name, all) {
    let candidate = name;
    let number = 2;
    while (episodes(all).some((episode) => nameKey(episode.name) === nameKey(candidate))) {
      candidate = `${name.slice(0, 108)} (${number++})`;
    }
    return candidate;
  }
  // Pure preview: no writes and no random IDs until apply.
  function planImport(parsed, all, target, name, conflictPolicy = "local") {
    if (parsed.errors.length) throw new Error(parsed.errors.join("；"));
    if (parsed.kind === "table" && !parsed.videos.length) throw new Error("沒有可匯入的影片或 Marker");
    const plan = { videos: [], episodes: [], target, name: "", kind: parsed.kind, conflictPolicy };
    for (const video of parsed.videos) {
      const existing = all[markersKey(video.videoKey)] || [];
      const merged = existing.map((marker) => ({ ...marker }));
      const added = [], conflicts = [];
      let duplicates = 0;
      for (const incoming of video.markers) {
        const byId = incoming.id ? merged.findIndex((marker) => marker.id === incoming.id) : -1;
        if (byId >= 0) {
          if (!sameState(merged[byId], incoming)) {
            conflicts.push({ local: merged[byId], incoming });
            if (conflictPolicy === "incoming") merged[byId] = { ...incoming };
          } else duplicates++;
          continue;
        }
        if (parsed.kind !== "backup" && merged.some((marker) => sameContent(marker, incoming))) { duplicates++; continue; }
        added.push(incoming);
        merged.push({ ...incoming });
      }
      plan.videos.push({ ...video, existing, merged, added, conflicts, duplicates, meta: all[videoMetaKey(video.videoKey)] || null });
    }
    if (parsed.kind === "backup") {
      const reserved = { ...all };
      for (const episode of parsed.episodes) {
        const existing = all[episodeKey(episode.id)];
        const name = uniqueName(existing && !existing.deletedAt ? existing.name : episode.name, reserved);
        const finalName = existing && !existing.deletedAt ? existing.name : name;
        const videoKeys = existing && !existing.deletedAt ? [...new Set([...existing.videoKeys, ...episode.videoKeys])] : episode.videoKeys;
        const planned = { ...episode, name: finalName, videoKeys, existing: existing || null };
        plan.episodes.push(planned);
        reserved[episodeKey(episode.id)] = { ...episode, name: finalName, videoKeys };
      }
      plan.settings = parsed.settings;
      plan.markerMode = parsed.markerMode;
    } else if (target === "new") {
      plan.name = checkName(name, all);
    } else if (target) {
      const episode = all[episodeKey(target)];
      if (!episode || episode.deletedAt) throw new Error("目標 Episode 已不存在");
      plan.episodes.push({ ...episode, videoKeys: [...new Set([...episode.videoKeys, ...parsed.videos.map((video) => video.videoKey)])], existing: episode });
    }
    return plan;
  }
  function importUpdates(plan, all) {
    const updates = {};
    for (const video of plan.videos) {
      updates[markersKey(video.videoKey)] = video.merged.map((marker) => marker.id ? marker : newMarker(marker.time, marker.note));
      const meta = video.meta || {};
      updates[videoMetaKey(video.videoKey)] = { ...meta, site: meta.site || video.site || (video.videoKey.startsWith("youtube:") ? "youtube" : "tcc"),
        title: meta.title || video.title, pageUrl: meta.pageUrl || video.pageUrl };
    }
    const now = new Date().toISOString();
    for (const episode of plan.episodes) {
      const { existing, ...value } = episode;
      updates[episodeKey(episode.id)] = { ...value, createdAt: existing?.createdAt || value.createdAt,
        updatedAt: plan.kind === "backup" && !existing ? value.updatedAt : now };
    }
    if (plan.target === "new" && plan.kind !== "backup") {
      const episode = newEpisode(plan.name, all, plan.videos.map((video) => video.videoKey));
      updates[episodeKey(episode.id)] = episode;
    }
    if (plan.kind === "backup") {
      updates.settings = { ...all.settings, ...plan.settings };
      updates.markerMode = plan.markerMode;
    }
    return updates;
  }
  return { FORMAT, episodeKey, episodes, videos, groupVideos, planRemovals, restoreEpisodeVideos, matchEpisodeTerm, checkName, newEpisode, exportData, parse, planImport, importUpdates };
})();
