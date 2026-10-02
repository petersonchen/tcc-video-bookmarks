// Storage layout and helpers shared by the popup and the manage page.
//
//   markers:<videoKey>  array of { id, time, note, createdAt, updatedAt, deletedAt? }
//   videos:<videoKey>   { site, title, pageUrl } for listing and export
//   episode:<id>        { id, name, videoKeys, createdAt, updatedAt, deletedAt? }

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function parseTimecode(value) {
  const fields = value.trim().split(":");
  // Number("") is 0, so an empty field would otherwise read as zero.
  if (fields.some((field) => !field.trim())) return null;
  const parts = fields.map((field) => Number(field));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;

  let seconds;
  if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
  else if (parts.length === 1) seconds = parts[0];
  else return null;

  if (parts.length >= 2 && parts[parts.length - 1] >= 60) return null;
  if (parts.length === 3 && parts[1] >= 60) return null;
  return seconds;
}

function markersKey(videoKey) {
  return `markers:${videoKey}`;
}

function videoMetaKey(videoKey) {
  return `videos:${videoKey}`;
}

// Markers saved before updatedAt existed fall back to createdAt.
function markerUpdatedAt(marker) {
  return marker.updatedAt || marker.createdAt;
}

function newMarker(time, note) {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), time, note, createdAt: now, updatedAt: now };
}

// Deleting only sets deletedAt; the marker stays in storage until it is purged.
function isLive(marker) {
  return !marker.deletedAt;
}

// The popup and manage pages share one lock for read-modify-write operations.
function withStorageLock(action) {
  return navigator.locks.request("mpy-library", action);
}
