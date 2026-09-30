# Video Cue Bookmarks

**Video Cue Bookmarks** 是一套 Chrome / Microsoft Edge 瀏覽器擴充功能，讓影音操作人員可以在支援的網站影片中建立時間書籤，並快速定位、預備及播放指定片段。

本專案採「單一 Extension、多網站支援」的方向設計。網站專屬的播放器控制封裝為 Site Adapter；目前第一個 Adapter 為 `sites/tcc.js`，支援臺北市議會雲端議事影音。

## 功能

- 儲存目前影片位置為 Bookmark
- 自訂 Bookmark 標題
- 直接編輯已建立 Bookmark 的標題與 Timecode
- **CUE**：跳至指定時間並暫停
- **PLAY**：跳至指定時間並開始播放
- 手動輸入 `HH:MM:SS`、`MM:SS` 或秒數後直接 PLAY
- Bookmark 依不同影片分開保存
- 重新整理網頁後仍保留 Bookmark
- Bookmark 僅儲存在使用者瀏覽器本機
- 未來可增加其他影音網站支援，不需要另外安裝 Extension

## 使用方式

1. 開啟支援的影音網站並進入影片播放頁。
2. 在影片播放至需要記錄的位置時，開啟 Video Cue Bookmarks。
3. 輸入 Bookmark 說明後，按下「＋ 儲存目前位置」。
4. 需要使用片段時，按 **CUE** 預備，或按 **PLAY** 直接跳至該時間播放。
5. 已建立的 Bookmark 可直接修改 Timecode 與標題。
6. 也可以在「跳到時間」輸入例如 `01:23:45`，再按 **PLAY**。

## 目前支援網站

### 臺北市議會雲端議事影音

- 網域：`https://live.tcc.gov.tw/`
- 播放器：Video.js / VHS
- 支援 Bookmark、CUE、PLAY 與直接輸入 Timecode 播放

未來新增網站時，只需增加對應的 Site Adapter 與該網站必要的權限，不需要修改共用 Bookmark UI，也不會預先要求存取所有網站。

### Site Adapter 架構

- `popup/popup.js`：共用 Bookmark UI、儲存與操作流程
- `sites/tcc.js`：臺北市議會網站判斷，以及 Video.js 的 CUE / PLAY 控制
- `content/video-controller.js`：目前負責從 TCC 頁面取得影片狀態與穩定的影片識別資訊

新增其他網站時，可依 `sites/tcc.js` 的介面實作 `matches()`、`getState()`、`cue()` 與 `play()`。

## 支援瀏覽器

- Google Chrome
- Microsoft Edge（Chromium）

## 資料與隱私

本擴充功能不需要使用者帳號，不使用自有後端伺服器、外部資料庫、Analytics、廣告或 AI 服務。

Bookmark 使用 Chrome Extension 的 `chrome.storage.local` 儲存在使用者自己的瀏覽器中。

詳細內容請參閱 [PRIVACY.md](PRIVACY.md)。

## 版本

目前版本：**v0.2.0**

## 授權

Copyright © 2026 Peterson Chen.

本專案採用 MIT License。你可以使用、複製、修改及散布本軟體；完整授權條款請參閱 [LICENSE](LICENSE)。

## 聲明

Video Cue Bookmarks 為獨立開發的瀏覽器輔助工具，並非任何支援網站或機構的官方產品，亦不代表其已對本專案提供背書、認證或合作。
