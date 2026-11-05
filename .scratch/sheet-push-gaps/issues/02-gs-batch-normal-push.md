# 02 平常推變快：先讀完再寫

Status: todo
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

（做完填：改前改後 `scripts/sheet-gs-calls.mjs` 的數字）
