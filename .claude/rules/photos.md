---
paths:
  - "functions/**"
  - "storage.rules"
  - "scripts/ai-exam.mjs"
  - "public/js/domain/transcripts.js"
  - "public/js/domain/orderForm.js"
  - "public/js/domain/photoPlan.js"
  - "public/js/domain/treatmentSheets.js"
  - "public/js/domain/aiUsage.js"
  - "public/js/data/treatmentSheets.js"
  - "public/js/data/ai.js"
  - "public/js/data/aiUsage.js"
  - "public/js/ui/components/photo.js"
  - "public/js/ui/components/camera.js"
  - "public/js/ui/components/orderConfirm.js"
  - "public/js/ui/components/sheetConfirm.js"
  - "public/js/ui/views/treatmentSheets.js"
  - "public/js/ui/views/aiUsage.js"
  - "tests-e2e/rules/storage-rules.test.js"
---

# 拍訂購單、療程單、AI 抄字與照片

**每一節的標題是「改了這個」，底下每一條是「一定要一起檢查」的**（從根目錄 `CLAUDE.md`「容易漏掉的連動」那張表搬來，標題照舊）。
新長出來的連動補進對應的那一節（沒有就加一節）；不屬於這一份的補進別份或開新的一份，並加進根目錄 `CLAUDE.md` 的索引。

## 拍訂購單翻成客戶

- 翻譯只在 `domain/orderForm.js`，而且**重用舊表那一份**（`rowShape()`／`photoPlan.js` 的 `shapeOf()`、`flagsFromText()`、`partnersFromText()`、`marksFrom()` 的「尾款」紅色）—— 另寫一套的話同一個 `任選(30)` 兩條路讀出兩種額度。
- **方案是名稱比對、客戶是她點過才算數**（`blockersOf()`：沒同名點「名字對」、同名兩顆都不預選，ADR-0100 考試名字只對 9/16）。
- 寫入走既有的：新增一位 `createWithPlan()`、加購到既有的 `addEntitlements(…, { customerChanges })`（尾款備註與警示跟額度同一個 commit）。
- 「表單上的值 → 一份購買」只有 `customerForm.js` 的 `purchaseOf()`，新增頁與確認卡共用。
- 照片與辨識出來的字**不存**（ADR-0101）。
- **同一位底下的幾張會問是不是同一張**（2026-10-08）：`repeatedPhotos()` 拿每一張各自 `orderDraftFrom()` 的結果比（`purchasePrint()`：方案、套數、加購、日期；**比翻譯之後的，不比原字**），`blockersOf()` 擋到她按「拿掉第 N 張」（`removePhoto()`，**跟「拆開」的 `detachPhoto()` 是兩件事**）或「真的買了兩次」（`twiceOk`）

## 療程單：同一張還是新的一張、年份怎麼補、簽了與記了的比對

- 只在 `domain/treatmentSheets.js`（ADR-0105）。
- **比對（`compareSheet()`）的區間只到最後一次簽名那一天** —— 照片兩三個月才拍一次，比到今天就是整頁假警報；「哪幾段算數」走 `isLiveSlot()` ＋ `slotStatus()`（整天取消的舊資料時段上沒有狀態）、不用簽的課程走 `needsForm()`、器材推課程走 `courseForEquipment()`，**先配器材也一樣的再配只有課程一樣的**（反過來兩列兩段會交叉配成兩件「器材不一樣」）。
- 那一頁只列不修（ADR-0007、0056），每一件連到日曆那一天（`showDate()` ＋ 換頁）。
- 同一張：`sameSheet()` 比她確認過的課程（營養點滴連品項）與前 5 列的日期＋器材，**拿不準一律是新的一張**（新版會真的刪舊照片，新的一張什麼都不刪）；`fillYears()` 以表頭為準、沒有表頭從拍照那天往回推。
- **AI 從頭到尾沒有「這是哪一張」那一格**（ADR-0099）。
- 存檔的順序只寫在 `data/treatmentSheets.js` 的 `replace()`：**新照片傳上去 → 文件更新 → 才刪舊的**，刪不掉記在 `stalePhotoPaths` 等下次打開那一頁再刪。
- 確認層（`ui/components/sheetConfirm.js`）只畫與接線

## AI 的抄字格式（`functions/transcripts/`）

- **兩份檔案**：Function 部署時只帶 `functions/`，所以 domain 那一份在 `public/js/domain/transcripts.js`，`tests/ai-transcripts.test.js` 盯著兩邊一模一樣。
- **不可以長出任何 id、狀態、課程、器材、客戶的欄位**（ADR-0099）—— 那是翻譯的人的事；數字一律照寫成字串。
- 改了提示詞或格式要用 `scripts/ai-exam.mjs` 重考一次（答案與結果只在 `.local/`，終端機只印數字），分數寫回 ADR-0100「考試結果」。
- Abovee 的「預約來源」與六種預約狀態（待確認、聯繫中、確認前往、已取消、客戶失約、課程完成）**照抄原字**：是不是體驗是 domain 的 `isTrialRow()`、對到 app 的狀態是 domain 的 `statusFromAbovee()`。
- **提示詞只在 `functions/` 那一份**（`public/` 那一份只有欄位形狀），所以釘提示詞的測試不比兩份。
- 改了 `functions/` 要**兩邊各從本機部署一次**（`docs/STAGING.md`「部署那一支 Function」，`--project staging`／`--project prod`）—— CI 不部署它，新提示詞要部署之後才吃得到

## 拍照那一支 Function 的防護、上限或單價

- 五道防護寫在 ADR-0100：**上限在叫模型之前擋**（`functions/lib/guard.js` 先預留、回來換成實際值），天花板 `CEILING_USD` 她在設定頁填再大也蓋不過。
- 單價在 `functions/lib/pricing.js`，**一律照漲價後的算**（2027 起翻倍）—— 改了要回去看 ADR-0100 的價格日期與 設定 → AI 用量那一顆 `?`。
- log、錯誤訊息、`aiUsage` **一個字的照片內容都不記**（ADR-0101）。
- 模擬器與 CI 走 `functions/lib/fakeModel.js`，永遠不送真照片

## `aiUsage` 集合

- **瀏覽器寫不進去**（`firestore.rules` 寫 false，Rules 測試 R13 盯著）—— 改小那個數字就等於繞過每月上限。
- **不進備份**：它不是她的資料，是 Function 的帳本。
- `config/ai`（上限與暫停）是她的設定，走 `repo` 有稽核

## 一種單子的照片要不要存

- 先回答 ADR-0101 那張表的那一列才寫格式。
- 現在**只有療程單存**（Storage，`storage.rules`）；訂購單、Abovee、文宣**不存**，辨識出來的字也**不存草稿** —— 確認層的狀態只在那一支元件的閉包裡，收起來就 `release()`。
- 照片送出去之前一律過 `ui/components/photo.js` 重新編碼（EXIF、GPS 一起丟掉）

## `storage.rules`

- 白名單跟 `firestore.rules` **同一份** `allowedUsers`（跨服務讀）。
- 只開 `treatmentSheets/{客戶}/{療程單}/{檔名}`，其餘路徑一律拒 —— 訂購單、Abovee、文宣的照片不存（ADR-0101）。
- **擋覆蓋靠 `resource == null`**，`allow update: if false` 擋不住（Storage 把同名再傳一次算 create）。
- 大小上限跟 `MAX_PHOTO_BYTES` 講同一個數字（`tests/treatment-sheets.test.js` 盯著）。
- Rules 測試在 `tests-e2e/rules/storage-rules.test.js`，`npm run test:rules` 一支一支跑（兩支共用白名單）。
- 部署走 `deploy.yml` 另外一步，**CI 那把服務帳號要有 serviceusage 的權限**（firebase-tools 13 推 Storage 時會問），見 `docs/STAGING.md`「三之三」6b
