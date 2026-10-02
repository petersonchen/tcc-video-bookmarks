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

// Reads the stored array again so changes made on another page meanwhile are kept.
// A deleted marker only accepts a change to deletedAt.
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

// The popup and manage pages share one lock for read-modify-write operations.
function withStorageLock(action) {
  return navigator.locks.request("mpy-library", action);
}
