// Time and note inputs for editing a stored Marker, shared by the popup and
// the manage page. Each change is written with changeMarker; failures go to onError.
function markerEditFields(videoKey, marker, onError) {
  const save = (changes) => changeMarker(videoKey, marker.id, { ...changes, updatedAt: new Date().toISOString() })
    .catch(onError);

  const time = document.createElement("input");
  time.className = "marker-edit marker-time";
  time.value = formatTime(marker.time);
  time.title = "編輯 Timecode（↑／↓ 加減 1 秒）";
  // shown is the unrounded time behind the field, so stepping keeps the
  // fraction a saved marker usually has. Typing a different time replaces it.
  let saved = marker.time;
  let shown = marker.time;
  const syncTyped = () => {
    const typed = parseTimecode(time.value);
    if (typed !== null && typed !== Math.floor(shown)) shown = typed;
    return typed;
  };
  // Stepping only changes the field; it is saved on Enter, Shift+Enter, or blur, once.
  const commit = () => {
    if (syncTyped() === null) {
      shown = saved;
      time.value = formatTime(saved);
      return;
    }
    if (shown === saved) return;
    saved = shown;
    save({ time: shown });
  };
  time.addEventListener("change", commit);
  time.addEventListener("blur", commit);
  time.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    if (syncTyped() === null) shown = saved;
    shown = Math.max(0, shown + (event.key === "ArrowUp" ? 1 : -1));
    time.value = formatTime(shown);
  });

  const note = document.createElement("input");
  note.className = "marker-edit marker-note";
  note.value = marker.note || DEFAULT_MARKER_NOTE;
  note.title = "編輯標題";
  note.addEventListener("change", () => save({ note: note.value.trim() || DEFAULT_MARKER_NOTE }));

  // A default note is selected on focus so typing replaces it. A mouse click
  // would move the caret on mouseup and drop the selection, so skip that once.
  let keepSelection = false;
  note.addEventListener("focus", () => {
    if (!isDefaultNote(note.value.trim())) return;
    note.select();
    keepSelection = true;
  });
  note.addEventListener("mouseup", (event) => {
    if (keepSelection) event.preventDefault();
    keepSelection = false;
  });
  note.addEventListener("blur", () => { keepSelection = false; });

  // Enter saves by leaving the field. Shift+Enter on the timecode saves but
  // keeps the focus, so the time can be stepped again right away.
  [time, note].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      if (input === time && event.shiftKey) commit();
      else input.blur();
    });
  });
  return { time, note };
}
