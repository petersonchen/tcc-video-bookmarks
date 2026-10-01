# MPY Timecode Marker

**MPY Timecode Marker** 是一套 Chrome / Microsoft Edge 瀏覽器擴充功能，可以在支援的網站影片中建立 Timecode Marker，並快速定位、預備及播放指定片段。

本專案採「單一 Extension、多網站支援」的方向設計。網站專屬的播放器控制封裝為 Site Adapter；目前有 `sites/tcc.js`（臺北市議會雲端議事影音）與 `sites/youtube.js`（YouTube）。

## 功能

- 儲存目前影片位置為 Marker
- 自訂 Marker 標題
- 直接編輯已建立 Marker 的標題與 Timecode
- **CUE**：跳至指定時間並暫停
- **PLAY**：跳至指定時間並開始播放
- 手動輸入 `HH:MM:SS`、`MM:SS` 或秒數後直接 PLAY
- Marker 依不同影片分開保存
- 重新整理網頁後仍保留 Marker
- Marker 僅儲存在使用者瀏覽器本機
- 管理頁：列出所有影片，並可依最後修改日匯出、匯入 Marker
- 未來可增加其他影音網站支援，不需要另外安裝 Extension

## 使用方式

1. 開啟支援的影音網站並進入影片播放頁。
2. 在影片播放至需要記錄的位置時，開啟 MPY Timecode Marker。
3. 輸入 Marker 說明後，按下「＋ 儲存目前位置」。
4. 需要使用片段時，按 **CUE** 預備，或按 **PLAY** 直接跳至該時間播放。
5. 已建立的 Marker 可直接修改 Timecode 與標題。
6. 也可以在「跳到時間」輸入例如 `01:23:45`，再按 **PLAY**。

## 匯出與匯入

Marker 只存在各自的瀏覽器中。匯出與匯入用文字在不同瀏覽器之間傳遞 Marker。

1. 在 popup 按「管理」開啟管理頁。
2. 在「匯出」選擇日期範圍，按「產生」後按「複製」。日期依 Marker 的最後修改日篩選，前後日期都包含。
3. 在另一個瀏覽器開啟管理頁，將文字貼到「匯入」，按「預覽」確認內容後按「匯入」。

匯出文字格式如下，人可以直接閱讀：

```
MPY Timecode Marker v1
匯出：2026-09-21 ~ 2026-09-22，1 支影片，2 個 Marker

▶ 影片標題
https://www.youtube.com/watch?v=dQw4w9WgXcQ
00:01:08 開場
00:02:20 第二段
```

- 匯入時，同一支影片的 Marker 會與現有 Marker 合併；時間與標題都相同的 Marker 會略過。
- 已刪除的 Marker 不會出現在匯出文字中，也不會從對方電腦刪除。
- 影片依網址辨識，所以匯出的影片需要有網址。在影片頁開啟一次 popup 後，就會記錄該影片的標題與網址。

## 目前支援網站

### 臺北市議會雲端議事影音

- 網域：`https://live.tcc.gov.tw/`
- 播放器：Video.js / VHS
- 支援 Marker、CUE、PLAY 與直接輸入 Timecode 播放
- Marker 依網址的 `vdvno` 參數區分影片

### YouTube

- 網域：`https://www.youtube.com/`
- 支援頁面：`watch` 與 `live` 影片頁；不支援 Shorts 與嵌入其他網站的播放器
- 播放器：YouTube player API（`#movie_player`）
- Marker 依 video ID 區分影片
- 廣告播放期間無法儲存 Marker

未來新增網站時，只需增加對應的 Site Adapter 與該網站必要的權限，不需要修改共用 Marker UI，也不會預先要求存取所有網站。

### Site Adapter 架構

- `popup/popup.js`：共用 Marker UI、儲存與操作流程
- `manage/manage.js`：管理頁，影片清單與匯出、匯入
- `lib/markers.js`：popup 與管理頁共用的 Timecode 格式與 storage 函式
- `lib/video-key.js`：由影片網址決定 Marker 的儲存 key，content script 與管理頁共用
- `sites/tcc.js`：臺北市議會網站判斷，以及 Video.js 的 CUE / PLAY 控制
- `sites/youtube.js`：YouTube 網站判斷，以及 YouTube player API 的 CUE / PLAY 控制
- `content/video-controller.js`：從 TCC 與 YouTube 頁面取得影片狀態與穩定的影片識別資訊

新增其他網站時，可依 `sites/tcc.js` 的介面實作 `matches()`、`getState()`、`cue()` 與 `play()`。

## 支援瀏覽器

- Google Chrome
- Microsoft Edge（Chromium）

## 資料與隱私

本擴充功能不需要使用者帳號，不使用自有後端伺服器、外部資料庫、Analytics、廣告或 AI 服務。

Marker 使用 Chrome Extension 的 `chrome.storage.local` 儲存在使用者自己的瀏覽器中。

詳細內容請參閱 [PRIVACY.md](PRIVACY.md)。

## 版本

目前版本：**v0.3.0**

## 授權

Copyright © 2026 Peterson Chen.

本專案採用 MIT License。你可以使用、複製、修改及散布本軟體；完整授權條款請參閱 [LICENSE](LICENSE)。

## 聲明

MPY Timecode Marker 為獨立開發的瀏覽器輔助工具，並非任何支援網站或機構的官方產品，亦不代表其已對本專案提供背書、認證或合作。
