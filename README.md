# TCC Video Bookmarks

Chrome / Microsoft Edge extension for bookmarking timecodes on Taipei City Council video pages.

## v0.1

- Bookmarks are stored per video/page.
- Save the current video time with an editable note.
- Click **CUE** to jump to the saved time and pause the video.
- Data stays in `chrome.storage.local`.
- Host access is limited to `https://live.tcc.gov.tw/*`.

## Install for testing

1. Clone or download this repository.
2. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this repository folder.
5. Open a video on `live.tcc.gov.tw`, then click the extension icon.

## Notes

v0.1 targets an HTML5 `<video>` element in the page. If the production player is nested in a frame or uses a different structure, the content script can be adapted after live testing.
