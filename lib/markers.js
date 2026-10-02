// Storage layout and helpers shared by the popup and the manage page.
//
//   markers:<videoKey>  array of { id, time, note, createdAt, updatedAt, deletedAt? }
//   videos:<videoKey>   { site, title, pageUrl } for listing and export
//   episode:<id>        { id, name, videoKeys, createdAt, updatedAt, deletedAt? }

const MARKERS_PREFIX = "markers:";
const VIDEO_META_PREFIX = "videos:";
const DEFAULT_MARKER_NOTE = "Marker";

function markersKey(videoKey) {
  return `${MARKERS_PREFIX}${videoKey}`;
}

function videoMetaKey(videoKey) {
  return `${VIDEO_META_PREFIX}${videoKey}`;
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
