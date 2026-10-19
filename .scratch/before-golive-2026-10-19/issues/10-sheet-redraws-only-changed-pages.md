# 試算表只重畫有變的那幾頁（指紋記在試算表那一側）＋「整份重畫」＋抬頭的病歷號

Status: done
段：三（high）
Blocked by: 04（抬頭的病歷號要 `chartNo`）
動工前先讀：`.scratch/followup-and-products/issues/08`（8/27 的回答 —— **它寫的「手機記指紋」這一支不照做**，理由見下）；`data/sheetSync.js`（`buildBundle()`、`push()`、`run()`、`schedule()`、`QUIET_MS`）；`domain/sheetReport.js` 的 `syncBundle()`（每一頁的資料長什麼樣、bundle 層的 `generatedAt`／`legend`／`notice`）；`sheets/readonly-report.gs` 全部（`doPost()`、`render()`、`stashRawData()`、`renderCustomer()` 第 2–3 列、`resetSheet()`、`removeStaleSheets()`、`protectEverything()`、`onEdit()`）；`ui/views/report.js`（設定 → 試算表報表：手動貼上那一條）、設定頁試算表那張卡；ADR-0010、0013、0024、0115、0132；`CLAUDE.md`「試算表的 `SYNC_FORMAT`」「試算表要讀哪些來訪」「試算表的註記」三列；`tests/sheet-script.test.js`

## 她要的

> 2. 試算表改成只推有改動的分頁，我覺得這可以做，但一樣要確保是正確的喔

> 2. 試算表每一頁第三列的「產生時間」，沒變的那幾頁要怎麼寫？照你的建議，照樣更新成這一次推送的時間（只改那一格，很快），跟現在看起來一樣。另外設定頁加一顆「整份重畫」，有疑慮時可以按。

> 試算表每一頁的抬頭那一行要加「病歷號 1234」。

## 為什麼會這樣、為什麼不照 8/27 那一支

現在每次推送：app 讀全部 → 整包送 → `.gs` 每一頁**清空重畫**、重新上鎖。Apps Script 一次最多跑 6 分鐘，客人越多越久，超過就整包失敗。

8/27 寫的是「手機的 localStorage 記上次推的每一頁指紋，只送變了的」。**她有手機與 iPad 兩台**（SPEC 第 1 節：各約一半）：兩台各記各的，一台記得「這一頁上次是 A 版」，另一台後來推了 B 版、資料又改回 A 版 → 第一台算出 A、跟自己記的一樣、不送 —— 試算表停在 B 版，**安靜地錯**。

所以**指紋記在試算表那一側**（它是唯一知道「這一頁現在長什麼樣」的地方）：app 照舊送整包（每一頁附一個指紋），`.gs` 拿它跟那一頁上次畫的指紋比，一樣就不重畫。省下的是 `.gs` 的重畫與上鎖時間（最慢的那一段）；Firestore 讀取與網路不變（8/27 那一支講過：讀取省不到）。

## 做法（方向）

1. **指紋**：`syncBundle()` 每一頁算一個（那一頁會畫出來的每一樣都要算進去：`rows`、`dates`、`tasks`、兩份註記、備註、買過什麼、抬頭那一行、**`legend`**（每一頁第三列印它）、`format`，以及 `.gs` 的版本 —— `.gs` 自己的排版改了要全部重畫）。**不含 `generatedAt`**（那一格每次都換）。演算法要在 JS 與 Apps Script 兩邊不用算 —— 只有 app 算、`.gs` 只比字串
2. **`.gs` 記在哪**：`PropertiesService.getDocumentProperties()`（以分頁名為鍵）或那一頁藏起來的一格 —— 選「她改名、刪分頁、手動清掉都會讓指紋對不上 → 重畫」的那一個。**分頁不存在、或第一列那句提醒不在（`resetSheet()` 認不出來）→ 一律重畫**
3. **沒變的那幾頁**：只改第三列那一格的產生時間（她選的）；不清、不重新上鎖
4. **刪掉的客戶**：`removeStaleSheets()` 照舊拿完整的名單（整包裡有誰）刪 —— 不可以因為「沒變」就漏掉
5. **整份重畫**：設定頁試算表那張卡一顆「整份重畫」→ 送 `force: true`，`.gs` 忽略指紋、全部清掉重畫（等於現在的行為）。走 `withSaveState()`、同時只一份在路上（`push()` 那一套）
6. **抬頭那一行加「病歷號 1234」**（`infoLine()`；沒有病歷號就不寫那一段）
7. `SYNC_FORMAT` → 8、`.gs` 的 `SUPPORTED_FORMAT` → 8。**她要重貼 `.gs` 並重新部署（staging 與正式各一次）** —— 寫進手動驗收清單與 `docs/STAGING.md`
8. 回報：`.gs` 回 `{ sheets: 畫了幾頁, kept: 沒變的幾頁, skipped }`，設定頁那一行講得出「這一次重畫了 N 頁、M 頁沒變」

## 過目改的（10/19，主控對過；跟上面衝突時以這裡為準）

- 指紋也要算進 **`notice`**（第 1 列）。
- **app 算不出 `.gs` 的版本** → `.gs` 自己存一個排版版號常數，跟指紋一起比（`.gs` 一改排版就升那個數字 → 全部重畫）；`tests/sheet-script.test.js` 盯著改了 `.gs` 的畫法要升那個數字（做得到的話）。
- **沒變的那幾頁要放進 `keep`**：`render()` 現在只把有畫的放進 `keep`，不放會被 `removeStaleSheets()` 當成過期刪掉。
- **每畫好一頁就存一次那一頁的指紋**：超過 6 分鐘逾時時，下一次推送能接著做（已經畫好的那幾頁不重畫）。
- `protectEverything()` 只鎖重畫的那幾頁（沒變的那幾頁本來就鎖著）；`stashRawData()` 照舊整包存。
- **`force` 會被 `push()` 的去重吃掉**（`sheetSync.js:139`：同一個 `version` 回路上那一份）→ 「整份重畫」那一條路要自己的參數、不被併掉。
- `report.js:225`、`:228` 那兩句讀的是回傳的 `sheets` → 回傳多了 `kept` 之後那兩句跟著講清楚。
- **判準「換一天指紋會變」前提錯**：`.gs` 那一頁沒有逾期；`today` 只影響跨年時日期的年份前綴 —— 改成「跨年那一天，年份前綴變了的那幾頁重畫」，其餘照指紋。
- 04 會讓 `customer.notes` 鏡像少「病歷號 1234」那一行 → 抬頭那一行的病歷號把它補回來（手動貼上那條路也看得到）。

## 判準

- 這一行會不會讓試算表某一頁跟 app 不一樣、而畫面上看起來推好了？
  - 兩台裝置交替推、資料改回原樣 → 每一頁照舊對（單元測試模擬兩台：指紋只在 `.gs` 那一側，app 沒有狀態）
  - 刪掉一位 → 那一頁照舊被刪
  - 改了 `legend`／`.gs` 的排版 → 全部重畫
  - 她手動刪了一頁、或清空一頁 → 下一次推送那一頁重畫
  - 今天換了一天（`today` 影響那一頁的東西，例如待辦的逾期）→ 那幾頁的指紋會變（因為 `syncBundle()` 輸出會變）
- 沒有任何資料變動時推一次：每一頁只改第三列的產生時間；`.gs` 的執行時間比整份重畫短（在 staging 的 Apps Script 執行紀錄看一次，數字寫進 HANDOFF）
- 「整份重畫」那一顆 = 現在的行為
- `tests/sheet-script.test.js` 盯著 `SYNC_FORMAT` 與 `SUPPORTED_FORMAT` 一樣；`.gs` 的邏輯能抽成純函式的（比指紋、決定哪幾頁要畫）就在 node 裡測

## 連動

- ADR（推翻 8/27 那一支的作法、延伸 ADR-0013「整包是冪等的」：還是整包送、冪等照舊成立）
- `SPEC.md` 試算表那一節、`docs/STAGING.md`（重貼 `.gs`）、`docs/操作手冊.md`（整份重畫那一顆）、`CLAUDE.md`「試算表的 `SYNC_FORMAT`」那一列

## 做完時留下的（10/19，段三；連中途發現 2 一起）

- **app**：`sheetReport.js` 的 `sheetFingerprint(sheet, { format, notice, legend })`（兩個種子的 cyrb53 接起來，base36）；`syncBundle()` 每一頁多 `chartNo`
  （`chartNosOf(c)[0]`）與 `fingerprint`（算的是那一頁不含指紋的整份資料＋提醒＋符號說明＋格式，**不含產生時間**）；`SYNC_FORMAT` 8。
  手動貼上（`customerReport()`）在「客戶」底下多一列「病歷號」
- **`.gs`**：`SUPPORTED_FORMAT` 8、`LAYOUT_VERSION = 1`、指紋記在 `PropertiesService.getDocumentProperties()`（鍵 `fp:分頁名`，值「指紋｜排版版號」）。
  `render(ss, bundle, force)`：每一頁問純函式 `sheetPlan({ force, exists, ours, stored, mark })`（拿不準一律 `draw`）；`keep` → 只 `setValue` 第三列（`stampLine()`，
  跟重畫時同一支）、放進 `keep`；`draw` → 先刪舊指紋 → `renderCustomer()` → **`protectSheet()` 那一頁** → 記指紋。`protectEverything()` 換成 `protectSheet()`（`_data` 每次鎖、
  沒變的那幾頁不重鎖 —— **她自己開的分頁不再被順手鎖起來**，以前每一次推都會鎖全部分頁；onEdit 照舊還原任何人的手改）。
  `forgetStale()` 拿掉不在這一包的指紋。回報多 `kept`；`infoLine()` 第一段「病歷號 1234」
- **推送**：`sheetSync.push({ force })`（整份重畫不被去重併掉：路上那一份不是 force 就等它回來再推一份 force；一般推送可以搭 force 的便車）；
  body 多 `force: true`；回傳多 `kept`。**中途發現 2**：`buildBundle()` 看 `repo.cacheReads()` 前後與 `navigator.onLine`，讀不完整丟 `IncompleteReadError`（`PARTIAL_READ_SAY`）；
  `run()` 接住 → `noteFailure(…, { partial: true })`（留待推標記）、回 `partial: true`
- **設定頁**（`report.js`）：「整份重畫」一顆（`[data-sync-redraw]`，旁邊一顆 `?`）；推好了那一句走 `pushedSay()`（重畫幾張／沒變幾張）；`describeSync({ partial })` 講「上次沒推」、
  不講「被拒絕」；partial 的 toast 是 info 不是 failed。**沒有走 `withSaveState()`**：跟旁邊「立刻推一次」同一個樣子（`toast.saving` → 讀回傳值），同時只一份在路上靠 `push()` 的 `inFlight`
- **文件**：ADR-0161；SPEC 4.8；CLAUDE.md「SYNC_FORMAT」「試算表要讀哪些來訪」兩列；`docs/STAGING.md`（10/19 那一輪要重貼）、`sheets/README.md`（格式 8、`LAYOUT_VERSION`）、操作手冊（整份重畫）
- **測試**：`tests/sheet-fingerprint.test.js`（30 條：指紋、病歷號、兩台交替推、刪一位、她刪／清一頁、force、排版版號、逾時接著畫、她自己的同名分頁、抬頭、`sheetPlan()`、`.gs` 程式碼雜湊、
  `pushedSay()`、partial 的字、手動貼上的病歷號、`sheetSync.js` 原始碼）；`appsScriptStub.js` 多文件屬性與 `clears`；`sheet-script.test.js`「自己產生過的分頁照樣清空重畫」改成 force；
  格式 7 的幾條釘值改 8。E2E `78` S1（兩顆按鈕的 body 與字）、S2（離線這一趟不推、一個請求都沒有）；09、45 照跑全綠
- **沒做到、要她做的**：判準「沒有資料變動時推一次，`.gs` 執行時間比整份重畫短」要在 staging 重貼 `.gs` 之後看 Apps Script 執行紀錄 → 寫進手動驗收清單
