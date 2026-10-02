// Time and note inputs for editing a stored Marker, shared by the popup and
// the manage page. Each change is written with changeMarker; failures go to onError.
function markerEditFields(videoKey, marker, onError) {
  const save = (changes) => changeMarker(videoKey, marker.id, { ...changes, updatedAt: new Date().toISOString() })
    .catch(onError);

  const time = document.createElement("input");
  time.className = "marker-edit marker-time";
  time.value = formatTime(marker.time);
  time.title = "編輯 Timecode";
  time.addEventListener("change", () => {
    const value = parseTimecode(time.value);
    if (value === null) time.value = formatTime(marker.time);
    else save({ time: value });
  });

  const note = document.createElement("input");
  note.className = "marker-edit marker-note";
  note.value = marker.note || DEFAULT_MARKER_NOTE;
  note.title = "編輯標題";
  note.addEventListener("change", () => save({ note: note.value.trim() || DEFAULT_MARKER_NOTE }));

  [time, note].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
    });
  });
  return { time, note };
}
