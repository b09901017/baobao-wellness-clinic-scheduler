# 02 平常推變快：先讀完再寫

Status: done
Blocked by: —

## 動工前先讀

- `.scratch/sheet-push-gaps/spec.md`「第二輪」、`HANDOFF.md`
- ADR-0161（指紋、沒變的頁只改第 3 列時間 —— 這一條她選的，不改）
- `sheets/readonly-report.gs` 的 `doPost()`、`render()`、`sheetPlan()`、`isOurs()`、`removeStaleSheets()`、`forgetStale()`、`stashRawData()`、`protectSheet()`
- `tests/helpers/appsScriptStub.js`、`tests/sheet-script.test.js`、`tests/sheet-fingerprint.test.js`（最後一條釘著 `.gs` 程式碼的雜湊 → 改了要加 `LAYOUT_VERSION`）
- `scripts/sheet-gs-calls.mjs`（數一次推送叫 Google 幾次）

## 她要的

> 其實現在我就覺得等太久，不一定要走平行那條，我只想要重畫可能快好幾倍或是推的時候更快

## 為什麼會這樣

34 頁都沒變的一次推送（替身數的，正式站 11/5 那一包）：讀 143、寫 46、寫完又馬上讀 38 次；實際 25–48 秒。
`render()` 每一頁依序 `getSheetByName` → `isOurs()`（`getLastRow` ＋ `getRange(1,1).getValue`）→ `getProperty` → 沒變就 `setValue` 第 3 列，
下一頁又讀 —— 讀寫交錯，Google 每遇到一次「寫完又讀」就得先把前面的寫入做完。

## 做法

- 一開始一次讀完：`ss.getSheets()` 建名字 → 分頁的對照（不要每頁 `getSheetByName`）、`props.getProperties()` 一次拿全部指紋、每一頁第一列那一格
- 「是不是我們畫的」只讀 A1 那一格就夠（空的分頁 A1 是空字串，一樣認不出）—— 不要再 `getLastRow`
- 全部判完（`sheetPlan()` 不變）才開始寫：沒變的頁改第 3 列時間、要重畫的頁照 03 畫
- `removeStaleSheets()` 用一開始讀到的那一份，不再逐頁讀
- `stashRawData()`、`protectSheet(_data)`：`_data` 的鎖已經在就不要每次拆了重上（讀一次 `getProtections()` 看描述對不對）
- 指紋寫入：`props.setProperties(map)` 一次（**但「畫一頁就記一頁」的順序要留著**：畫到一半逾時，畫好的那幾頁要已經記下來 ——
  所以要嘛每頁畫完 `setProperty`，要嘛分批；不可以全部畫完才一次記）

## 判準

- 都沒變的那一次，讀的次數會不會還跟頁數成正比、而且跟寫交錯？（`scripts/sheet-gs-calls.mjs`：寫完又馬上讀接近 0）
- 她清掉一頁的第一列、刪掉一頁、手改一格（`onEdit` 拿掉指紋）之後，那一頁下一次會不會照樣重畫？（`sheetPlan()` 的五個條件一個都不能少）
- 畫到一半逾時，下一次推送會不會把沒畫完的那一頁當成畫好了？（開始畫之前先拿掉舊指紋、畫完才記，順序不變）
- 新的寫法在測試的替身裡結果跟舊的一模一樣嗎？（同一包、同一份起始狀態，兩份 `.gs` 畫出來的每一格、每一個合併、鎖、指紋一樣）
- 一次推送叫 Google 的次數有沒有寫成測試釘住，下一次有人加回逐頁讀會紅？

## 做完時留下的

**數字**（`scripts/sheet-gs-calls.mjs`，正式站 11/5 那一包 34 頁；這一版多數文件屬性 `props`）：

| | 讀 | 寫 | 寫完又馬上讀 | 文件屬性 |
|---|---|---|---|---|
| 都沒變 改前（`3dd2ee12`） | 143 | 46 | 38 | 35 |
| 都沒變 改後 | 76 | 36 | **0** | 1 |
| 整份重畫 改前 | 619 | 6,506 | 276 | 103 |
| 整份重畫 改後（02 只動了讀，畫法是 03） | 314 | 6,496 | 102 | 69 |

讀還是一頁兩次（`getName`、第一列那一格），但全部在第一次寫之前讀完 —— 寫完又讀是 0。
要再少只能走 Sheets API 進階服務（這一輪不做）。

**怎麼證明畫出來一樣**：
- 替身（`tests/helpers/appsScriptStub.js`）現在記每一格的格式（字級、粗體、字色、字型、左右／上下對齊、換行、底色）、
  欄寬、列高、框線的每一次呼叫、鎖的說明與拿掉了誰；`getLastRow()` 改成跟 Google 一樣不算 `''`；
  多 `getRangeList()`、`mergeAcross()`、`setColumnWidths()`、`isSheetHidden()`、`getDescription()`、`removeEditors()` 真的拿掉人。
  `snapshotOf(ss)` 把整份收成一份可以比的東西
- `tests/sheet-gs-batch.test.js`：手造的四頁（什麼都有／什麼都沒有／日期 40 個／她自己的同名分頁）＋上一次留下來的一頁，
  四步推送（第一次、都沒變、一頁變了一位刪了、整份重畫），每一步整份試算表的雜湊釘的是**改前的 `.gs` 跑出來的**
- `scripts/sheet-gs-compare.mjs old.gs <bundle>`：兩份 `.gs` 同一串推送、逐格比、只印數字 —— 正式站那一包四步都 0 個不一樣
- 叫幾次也釘了（同一支測試第二段：10 頁都沒變 → 寫完又讀 0、文件屬性 1、不問 `getLastRow`）

**做法與跟 issue 寫的不一樣的地方**：
- `readBook()` 一開始讀每一張分頁的名字與 A1；要重畫的那幾頁在開始寫之前先問好大小與鎖（`sizeOf()`、`protectionsOf()`）、
  第一列空著的才問 `getLastRow()`（`emptyOf()`：**整頁空著的分頁照舊算我們的** —— 改前 `resetSheet()` 是 `getLastRow() > 0 && 不是提醒` 才跳過，
  只看 A1 的話她清空的那一頁會被當成她自己的而跳過）
- 寫完又讀剩兩種：每畫好一頁上鎖時問一次「誰能改」（`getEditors` 與 `canDomainEdit` 擺在一起，一次）、新建的分頁問一次大小
- `_data` 的鎖：剛好一道、說明一樣、只有我、網域不能改 → 不拆了重上；藏起來了就不再藏一次；原始資料一次 `setValues`
- 指紋：一開始 `getProperties()` 一次，之後只寫（畫之前 `deleteProperty`、畫完 `setProperty`，順序跟改前一樣）；
  `forgetStale()` 用手上那一份（**不用 `setProperties(…, true)`**：她手改一格時 `onEdit` 同時在拿掉指紋，整份蓋回去會把它救回來）
- `LAYOUT_VERSION` 沒加（畫法沒變），只換 `tests/sheet-fingerprint.test.js` 釘的雜湊（`85634bb4cd65`）；03 會加到 2

**只在 staging 驗得到**：真的快多少（執行紀錄的秒數）；`getEditors()` 在 `addEditor()` 之前或之後問，`canDomainEdit()` 擺到 `removeEditors()` 前面，真的 Google 會不會不一樣（照文件不會：新的鎖在改名單之前跟整份試算表的權限一樣）。
