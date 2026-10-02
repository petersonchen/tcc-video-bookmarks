# MPY Timecode Marker

**MPY Timecode Marker** 是一套 Chrome / Microsoft Edge 瀏覽器擴充功能，可以在支援的網站影片中建立 Timecode Marker，並快速定位、預備及播放指定片段。

本專案採「單一 Extension、多網站支援」的方向設計。網站專屬的播放器控制封裝為 Site Adapter；目前有 `sites/tcc.js`（臺北市議會雲端議事影音）、`sites/youtube.js`（YouTube）與 `sites/ivod.js`（立法院議事轉播 IVOD）。

## 功能

- 儲存目前影片位置為 Marker
- 自訂 Marker 標題
- 直接編輯已建立 Marker 的標題與 Timecode
- **CUE**：跳至指定時間並暫停
- **PLAY**：跳至指定時間並開始播放
- 手動輸入 `HH:MM:SS`、`MM:SS` 或秒數後直接 PLAY
- 鍵盤快捷鍵：不開 popup，直接將目前位置儲存為 Marker
- CUE／PLAY 可設定提前秒數，從 Marker 時間之前開始
- Marker 依不同影片分開保存
- 重新整理網頁後仍保留 Marker
- Marker 僅儲存在使用者瀏覽器本機
- 管理頁：依 Episode 與影片列出 Marker，同一影片可加入多集，Marker 共用；支援搜尋、編輯、拖曳排序與匯入匯出
- 未來可增加其他影音網站支援，不需要另外安裝 Extension

## 使用方式

1. 開啟支援的影音網站並進入影片播放頁。
2. 在影片播放至需要記錄的位置時，開啟 MPY Timecode Marker。
3. 輸入 Marker 說明後，按下「＋ 儲存目前位置」。
4. 需要使用片段時，按 **CUE** 預備，或按 **PLAY** 直接跳至該時間播放。
5. 已建立的 Marker 可直接修改 Timecode 與標題。標題是「Marker」或「Marker HH:MM:SS」時，點進去會先全選，直接輸入即可取代；管理頁 EDIT 模式也相同。
6. 也可以在「跳到時間」輸入例如 `01:23:45`，再按 **PLAY**。
7. CUE 或 PLAY 失敗時，popup 保持開啟並顯示原因。
8. popup 在儲存按鈕下方顯示目前的快捷鍵；設定了 CUE／PLAY 提前秒數時，Marker 清單標題旁會顯示提前秒數。

### 鍵盤快捷鍵

在影片頁按 `Alt+Shift+M`（macOS 為 `Option+Shift+M`），會將目前位置儲存為 Marker，說明為「Marker HH:MM:SS」，之後可在 popup 或管理頁修改。工具列圖示顯示 ✓ 表示已儲存，顯示 ! 表示失敗，滑鼠移到圖示上可看到原因。快捷鍵可在 `chrome://extensions/shortcuts`（Edge 為 `edge://extensions/shortcuts`）修改。

## 管理頁

在 popup 按「管理」開啟管理頁。「影片庫」依 **Episode → 影片 → Marker** 顯示，每支影片只有一份 Marker；加入多個 Episode 後，各集顯示全部 Marker，編輯或刪除會反映到所有 Episode。

### 模式與編輯

「模式」可選 **CUE**、**PLAY**、**EDIT**，預設 PLAY，會記住選擇。

- **CUE／PLAY**：點選整筆 Marker，切換到影片分頁並跳至該時間；CUE 暫停，PLAY 播放。未開啟的影片會開新分頁，等播放器載入後跳轉；YouTube 會等廣告結束。載入新頁面時分頁先靜音，跳轉完成後才恢復聲音，避免播出影片開頭；分頁原本已靜音時維持靜音。YouTube 會在網址加上開始時間，直接從該時間載入。
- 設定中的「CUE／PLAY 固定使用同一個分頁」預設開啟：管理頁的 CUE／PLAY 都在同一個播放分頁進行，點選其他影片時在該分頁載入新影片。播放分頁關閉後，下一次 CUE／PLAY 會改用已開啟該影片的分頁或開新分頁，並以它作為新的播放分頁。關閉此設定時，影片已開啟就切換到該分頁，否則開新分頁。
- 設定中的「CUE／PLAY 提前秒數」可設 0 到 60 秒，預設 0。popup 與管理頁的 CUE、PLAY 及 EDIT 的 ▶ 都會從 Marker 時間往前提早開始；「跳到時間」不受影響。完整備份會保存此設定。
- **EDIT**：直接修改 Timecode 或標題，更新 Marker 的最後修改時間，保留建立時間。Timecode 前的 ▶ 可從該時間播放，方便確認內容。
- EDIT 模式滑鼠移到 Marker，或以鍵盤編輯時，整列會凸顯，該列的 × 變紅，方便辨識刪除目標。按 × 刪除 Marker，可在 8 秒內復原最近一次刪除。
- 搜尋與模式控制列固定在畫面上方，影片庫標題列固定在搜尋列下方。桌面切換模式時標題列等高；影片與 Marker 預留控制項欄位並保持列高，讓影片標題、Timecode 與 Marker 標題的位置一致。窄視窗的操作列會換行。
- 在新開分頁 PLAY 時，瀏覽器可能阻擋自動播放，此時影片停在指定時間，需在影片上按播放。

### 選取與 Episode 歸屬

- EDIT 模式可按影片庫標題列右側的「＋ 新增 Episode」建立空的 Episode，例如 `ep1`、`ep2`；各 Episode 標題旁提供匯出、改名與刪除。CUE／PLAY 隱藏這些按鈕。
- Episode 名稱去除前後空白，不區分大小寫，不能重名；`backlog` 是保留名稱。Episode 使用固定 ID，改名不影響影片歸屬。
- 影片庫標題列左側顯示選取數量、「全選」與「取消選取」，右側提供「加入 Episode」與「從 Episode 移除」。可勾選單支或多支影片；「全選」涵蓋目前顯示的影片，包含搜尋結果。變更搜尋條件或離開 EDIT 會取消選取。
- 「加入 Episode」先預覽選取影片，再確認目標。勾選依各 Episode 中的位置分開記錄，加入時同一影片只處理一次，不會重複加入同一 Episode。backlog 也使用相同選取操作。
- 「加入 Episode」會記住上次選擇的目標，重新開啟管理頁也會保留；目標已刪除時需重新選擇。
- 「從 Episode 移除」依勾選位置列出各 Episode 要移除的影片，不需要再選 Episode；同一影片在未勾選的 Episode 中會保留。backlog 不列入移除，沒有其他歸屬的影片回到 backlog。跨集移除可一次復原，保留後續排序與 Marker 編輯。
- EDIT 未搜尋時，可拖影片標題左側的 ⋮⋮ 調整同一 Episode 的影片順序；從 backlog 或其他 Episode 拖到目標 Episode，表示「加入」，保留其他 Episode 的歸屬。各 Episode 的影片順序互相獨立。
- 加入、移除或刪除 Episode 後可在 8 秒內復原最近一次操作，影片與 Marker 會保留。

### 搜尋與顯示

- Episode 依名稱自然排序，由大到小，例如 `ep12`、`ep11`、`ep2`、`ep1`；「最近」表示名稱排序，不是建立或修改日期。
- 未搜尋時預設顯示最近 10 個 Episode，可在設定調整數量，0 表示全部。搜尋涵蓋全部 Episode 與 backlog，不受設定限制。
- **backlog** 在 EDIT 顯示；CUE／PLAY 未搜尋時隱藏，搜尋時仍涵蓋 backlog。顯示時固定在最下面，不計入 Episode 顯示數量，僅顯示未加入任何 Episode 的影片，依 Marker 的最後修改時間由新到舊排列。尚未歸屬的新影片自動進入 backlog；未顯示的舊 Episode 仍算歸屬。
- Episode 與 backlog 標題顯示結尾冒號，名稱本身不變。搜尋 `ep1:` 只符合 ep1；`ep1: 預算` 只在 ep1 搜尋「預算」，`backlog:` 只搜尋 backlog。名稱含空白時使用引號，例如 `"EP 102":`。
- 搜尋帶編號的 Episode 名稱時採前綴比對：`ep10` 會符合 `ep101`、`ep102`、`ep103`，`ep102` 會符合 `ep102`、`ep1020`，不會符合 `ep101` 或 `ep103`；大小寫不影響比對，也支援 `EP 102` 名稱。
- 搜尋可輸入 Episode 名稱、網站、影片標題、Marker 標題或 Timecode。以空白分隔多個詞時，每個詞都要符合。文字依字元順序比對，字元不必相連；只含數字與 `/`、`-`、`:` 的詞需完全相連。網站名稱的開頭（例如 `y`、`yout`、`t`、`tcc`、`i`、`ivod`）或 `yt` 會符合該網站。搜尋時不提供拖曳。
- 影片庫、匯出、匯入、設定區塊可按標題收合；匯出、匯入、設定預設收合。Episode 本身不收合。

## 匯出與匯入

資料只存在各自的瀏覽器中。新版使用 **v2 JSON** 在瀏覽器間傳遞資料，可複製或下載檔案。

- **Episode 匯出**：選擇 Episode，或在 EDIT 模式按清單標題旁的「匯出」。包含名稱、影片順序、全部未刪除 Marker，以及 Marker ID、建立與修改時間。即使 Episode 是空的，也可以匯出。
- **backlog 匯出**：包含所有未歸屬影片與未刪除 Marker。
- **完整備份**：包含所有有效 Episode、影片、Marker（含已刪除項目）、共用關係、影片順序與設定。Episode 沒有未刪除 Marker 的成員以及只有影片資訊的資料也會保存。

匯入時貼上內容或選擇檔案，再按「預覽」：

1. Episode 匯出預設建立新 Episode，名稱可修改，也可改為加入既有 Episode。名稱重複時需改名或選擇既有 Episode，不會只憑名稱自動合併。
2. backlog 或表格資料可指定 Episode，或選擇「不指定 Episode」。未指定不會移除既有歸屬，因此只有未歸屬影片出現在 backlog。
3. 相同影片依 videoKey／網址合併；相同 Marker ID 不重複新增。ID 相同但內容不同時，預覽列出衝突，預設保留本機內容，也可選擇採用匯入內容，變更會影響所有 Episode。
4. 一般匯入的時間與標題完全相同的 Marker 會略過；與本機已刪除項目重複的內容不會自動復活。完整備份保留不同 ID 的 Marker，包括內容相同的個別項目。
5. 即使沒有新 Marker，也可透過匯入建立 Episode 或加入影片關係。
6. 完整備份依 Episode ID 合併，相同 ID 保留本機名稱及原有影片順序，再接上新的影片；不同 ID 的同名 Episode 加上編號。備份會恢復顯示數量與 CUE／PLAY／EDIT 設定，保留本機其他資料。要完整重建備份的原始狀態，可匯入至空白的擴充功能資料庫。
7. 若預覽後資料有變更，會更新預覽並要求再次確認，不會直接套用過時資料。

### 從試算表匯入

支援 CSV、TSV 檔案，也可直接貼上從 Google Sheets 複製的儲存格。第一列必須是欄位名稱，每列代表一筆 Marker；欄位順序不限。

| 欄位 | 必填 | 內容 |
| --- | --- | --- |
| `url` | 是 | 支援網站的影片網址 |
| `timecode` | 是 | `HH:MM:SS`、`MM:SS` 或秒數 |
| `note` | 是 | Marker 說明，空白時使用「Marker」 |
| `title` | 否 | 影片標題；未提供時使用影片識別，本機已有標題則保留 |

欄位名稱也接受「網址」「時間」「說明」「影片標題」；`description` 可代替 `note`。CSV 欄位含逗號、換行或雙引號時，使用標準 CSV 引號格式。

```csv
url,timecode,note,title
https://www.youtube.com/watch?v=abcdefghijk,01:08,開場,影片 A
https://www.youtube.com/watch?v=abcdefghijk,320,交通政策,影片 A
```

同一影片的列會合併；時間與說明完全相同的 Marker 不重複新增，也不會恢復本機已刪除的相同內容。新 Marker 的 ID、建立與修改時間在確認匯入時產生。匯入前可選擇建立 Episode、加入既有 Episode，或不指定 Episode。任何一列格式錯誤都會阻止整批匯入，預覽會顯示錯誤位置。

不支援直接讀取 Google Sheets 連結或 `.xlsx` 檔案，請複製表格或匯出 CSV／TSV。

## 開發驗證

核心資料模型與匯入匯出測試不需要額外套件：

```sh
node --test tests/library.test.cjs
```

已安裝 Playwright 與 Chrome 的環境，也可執行介面測試（使用獨立瀏覽器設定檔與模擬 storage）：

```sh
node tests/manage.browser.cjs
```

可用 `PLAYWRIGHT_MODULE` 指定 Playwright 模組路徑，或用 `CHROME_EXECUTABLE` 指定瀏覽器執行檔。測試涵蓋管理頁操作，以及兩個管理頁和 popup 同時寫入。

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

### 立法院議事轉播 IVOD

- 網域：`https://ivod.ly.gov.tw/`
- 支援頁面：`/Play/Clip/` 委員發言片段與 `/Play/Full/` 完整會議影片；不支援直播頁
- 播放器：Clappr（頁面的 `_player`）
- 支援 Marker、CUE、PLAY 與直接輸入 Timecode 播放
- Marker 依影片類型（Clip 或 Full）與影片編號區分；同一影片的寬頻（1M）與窄頻（300K）網址共用 Marker
- 影片標題使用會議名稱，委員發言片段另加委員名稱

未來新增網站時，只需增加對應的 Site Adapter 與該網站必要的權限，不需要修改共用 Marker UI，也不會預先要求存取所有網站。

### Site Adapter 架構

- `popup/popup.js`：共用 Marker UI、儲存與操作流程
- `background.js`：鍵盤快捷鍵，不開 popup 直接儲存 Marker
- `icons/`：工具列與擴充功能頁圖示。`icon.svg` 是 32px 以上的原始檔，`icon-16.svg` 是 16px 的簡化版；修改後需重新輸出對應尺寸的 PNG
- `manage/common.js`：管理頁共用的 helper、toast 與 storage 寫入
- `manage/list.js`：管理頁的 Episode 清單、搜尋、拖拉與 Marker 編輯
- `manage/dialogs.js`：選取工具列，以及 Episode、加入、移除對話框
- `manage/seek.js`：從管理頁開啟或切換影片分頁，再執行 CUE / PLAY
- `manage/transfer.js`：匯出與匯入
- `manage/manage.js`：設定、Marker 模式、storage 同步與頁面初始化
- `lib/buttons.css`：管理頁與 popup 共用的按鈕尺寸、配色及互動狀態
- `lib/timecode.js`：Timecode 格式與解析，content script、popup 與管理頁共用
- `lib/markers.js`：popup、管理頁與 `background.js` 共用的 storage key、寫入鎖、Marker 儲存與修改，以及 CUE 提前秒數
- `lib/marker-fields.js`：popup 與管理頁共用的 Marker 時間、說明編輯欄位
- `lib/import-formats.js`：格式解析入口，將 v2 JSON、CSV／TSV 轉為共用匯入資料；新增格式時擴充 reader
- `lib/library.js`：Episode 歸屬、自然排序、backlog 與共用匯入合併、v2 匯出
- `lib/video-key.js`：由影片網址決定 Marker 的儲存 key，content script 與管理頁共用
- `sites/tcc.js`：臺北市議會網站判斷，以及 Video.js 的 CUE / PLAY 控制
- `sites/youtube.js`：YouTube 網站判斷，以及 YouTube player API 的 CUE / PLAY 控制
- `sites/ivod.js`：IVOD 網站判斷，以及 Clappr 的 CUE / PLAY 控制
- `content/video-controller.js`：從 TCC、YouTube 與 IVOD 頁面取得影片狀態與穩定的影片識別資訊

新增其他網站時，可依 `sites/tcc.js` 的介面設定 `urlPattern`，實作 `matches()`、`getState()`、`isReady()`、`cue()` 與 `play()`。

## 支援瀏覽器

- Google Chrome
- Microsoft Edge（Chromium）

## 資料與隱私

本擴充功能不需要使用者帳號，不使用自有後端伺服器、外部資料庫、Analytics、廣告或 AI 服務。

Marker 使用 Chrome Extension 的 `chrome.storage.local` 儲存在使用者自己的瀏覽器中，並以 `unlimitedStorage` 權限解除 10 MB 上限。

詳細內容請參閱 [PRIVACY.md](PRIVACY.md)。

## 版本

目前版本：**v0.3.0**

## 授權

Copyright © 2026 Peterson Chen.

本專案採用 MIT License。你可以使用、複製、修改及散布本軟體；完整授權條款請參閱 [LICENSE](LICENSE)。

## 聲明

MPY Timecode Marker 為獨立開發的瀏覽器輔助工具，並非任何支援網站或機構的官方產品，亦不代表其已對本專案提供背書、認證或合作。
