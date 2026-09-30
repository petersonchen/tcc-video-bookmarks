# TCC Video Bookmarks

臺北市議會影音書籤工具。這是一套供臺北市議會影音網站使用的 Chrome / Microsoft Edge 瀏覽器擴充功能，方便影音操作人員在會議影片中建立時間書籤，並快速定位、預備及播放指定片段。

## 功能

- 儲存目前影片位置為 Bookmark
- 自訂 Bookmark 標題
- 直接編輯已建立 Bookmark 的標題與 Timecode
- **CUE**：跳至指定時間並暫停
- **PLAY**：跳至指定時間並開始播放
- 手動輸入 `HH:MM:SS` 或 `MM:SS` 後直接 PLAY
- Bookmark 依不同影片分開保存
- 重新整理網頁後仍保留 Bookmark
- Bookmark 僅儲存在使用者瀏覽器本機

## 使用方式

1. 開啟臺北市議會影音網站並進入影片播放頁。
2. 在影片播放至需要記錄的位置時，開啟 TCC Video Bookmarks。
3. 輸入 Bookmark 說明後，按下「＋ 儲存目前位置」。
4. 需要使用片段時，按 **CUE** 預備，或按 **PLAY** 直接跳至該時間播放。
5. 已建立的 Bookmark 可直接修改 Timecode 與標題。
6. 也可以在「跳到時間」輸入例如 `01:23:45`，再按 **PLAY**。

## 支援網站

臺北市議會影音網站：`https://live.tcc.gov.tw/`

## 支援瀏覽器

- Google Chrome
- Microsoft Edge（Chromium）

## 資料與隱私

本擴充功能不需要使用者帳號，不使用外部資料庫、Analytics、廣告或 AI 服務。Bookmark 使用 Chrome Extension 的 `chrome.storage.local` 儲存在使用者自己的瀏覽器中。

詳細內容請參閱 [PRIVACY.md](PRIVACY.md)。

## 版本

目前版本：**v0.1.1**

## 授權

Copyright © 2026 Peterson Chen.

本專案採用 MIT License。你可以使用、複製、修改及散布本軟體；完整授權條款請參閱 [LICENSE](LICENSE)。

> 本專案為獨立開發工具，並非臺北市議會官方軟體。
