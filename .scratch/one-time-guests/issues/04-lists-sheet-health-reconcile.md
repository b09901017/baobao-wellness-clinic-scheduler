# 04：名單排除、試算表、資料健檢、月底對帳

Status: done
Blocked by: 01（資料健檢鏈上那兩項另外要 02、03）

## 先看：試算表那一輪合了沒（她 11/5）

試算表變快那一輪（`claude/sheet-speed`，自己的 worktree）正在改 `sheetReport.js`、`sheetSync.js`、`sheetPushTiming.js`、`readonly-report.gs`、`tests/sheet-fingerprint.test.js`。
這一支要改的 `syncBundle()`／`customerReport()`（`sheetReport.js`）與 `ui/views/report.js` 跟它撞。**動工前 `git fetch`**：

- `claude/sheet-speed` 合進 develop 了 → `git rebase origin/develop` 再做
- 還沒合 → 先做這一支裡不碰試算表的部分（名單排除、資料健檢、月底對帳），**試算表那一塊最後做**，或問她要不要等
- **永遠不改** `sheetSync.js`、`sheetPushTiming.js`、`.gs`

## 動工前先讀

- ADR-0172 決定一最後一點（名單與找人的地方）、Consequences
- spec.md「會動到的地方」
- `CLAUDE.md` 連動表：「任何『先看誰』的排序或推薦名單」「試算表要讀哪些來訪」「試算表的註記」「資料健檢那一頁的版面」「月底對帳 skill 讀的那幾支」那幾列
- `public/js/domain/scheduling.js`：`buildCustomerQueue()`（`:245`）、`customersToAsk()`（`:497`）、`customersToAskForMonth()`（`:568`）、`customersToBook()`（`:638`）、`candidatesFor()`（`:923`）、新人加進開著的那一批（`:848` 附近）
- `public/js/domain/sheetReport.js` 的 `syncBundle()`（`:603-610` 逐位客戶）、`ui/views/report.js`（手動貼上，`:67-68`、`:251`）
- `public/js/domain/health.js` 的 `checkStaleAvailability()`（`:779`）、`checkFollowups()`（`:440`）、`followupLinks`／`followupDouble` 兩項
- `.claude/skills/month-end-reconciliation/scripts/reconcile.mjs`（`kind === 'unknown'` → `strangers`，`:345-355`）、它的 `SKILL.md:157`、`tests/month-end-reconciliation.test.js`

## 她要的

> 不是屬於我的客戶那就只要出現在行事曆上跟代辦上就好了

> 但是客戶以及試算表中不用有他們

第 8 題（月底對帳）她問清楚之後同意：有名字卡、這一段也記了 → 算有記；有名字卡、這一段沒記 → 「app 沒有這一段」；**沒有名字卡**的才在「Abovee 上有、app 裡沒有這個人」。

## 為什麼會這樣

- 一次性客人是一份客戶文件（ADR-0172 決定一），所以**每一個逐位客戶走過去的地方都會看到他**
- 壓表、問時間、壓表登記、時段反查現在因為他**沒有額度**剛好排除了（`totalRemaining <= 0`、沒有 pool）——**不可以靠這個**：明寫 `isOneTime()`，
  哪天有人替他加了一筆、或那幾支的條件改了，他不會漏出來
- 試算表 `syncBundle()` 逐位客戶畫，一次性客人會被畫成一頁；轉成客戶之後，標著一次性的段也會被畫成「沒有額度的段」那幾列（`extraRows()`）

## 要做的

- 名單排除（每一處明寫 `isOneTime()`，各一支測試）：`buildCustomerQueue()`、新人加進開著的那一批、`customersToAsk()`、`customersToAskForMonth()`、
  `customersToBook()`、`candidatesFor()`、看這個月的進度（`ui/views/progress.js` 讀 `customers` 那一行）、長備註「寫給誰？」（`views/longNotes.js`）
- **試算表**：`syncBundle()` 跳過 `isOneTime()` 的客戶；**一次性的段不進任何一列**（轉成客戶之後的那幾天）—— 一天全部是一次性的段，那一天的日期欄整個不畫
  （`tests/sheet-rows-without-entitlement.test.js` 的「每一個日期欄至少有一格有符號」照樣成立）。**手動貼上（`report.js`）是另一條路**：挑人那一排（`report.js:98-104`）列每一位客戶、畫的是 `customerReport()`（`sheetReport.js:61`）不是 `syncBundle()` —— 兩處都要濾（過目 13）。
  列的形狀沒變：**不升 `SYNC_FORMAT`**；指紋（ADR-0161）照 `syncBundle()` 的資料算，跟著對
- **資料健檢**：`checkStaleAvailability()` 跳過一次性客人；`followupLinks`／`followupDouble` 吃 02 的投影（`health.js:2206`、`:2233`）（一次性的二返接一次性的健檢不被當成接不上）；
  孤兒資料、撞期、同一天兩筆等照查（他是一份客戶文件，不是孤兒）
- **月底對帳 skill**：一次性客人照 `readAbovee()` 認得 → 那一列是 `recorded` 或 `new`，跟一般客戶一樣分類；**不拿一次性的段去比次數**（它沒有額度）；
  `strangers` 只剩 `identifyCustomer()` 認不出來的人。報告上那幾句講次數的字（`reconcile.mjs` ~`:366-375`「次數還沒扣」「佔著一次」）一次性的段要換一句（它不扣）；`SKILL.md` 那一節的說明改成「沒建名字卡的人（體驗、別人的客人、還沒記成一次性客人的）」。
  `tests/month-end-reconciliation.test.js` 加一位一次性客人的假資料整支跑一次
- 備份、還原：不用改（客戶集合本來就在 `exportAll()` 與 `SECTIONS` 裡）—— 寫一行進「做完時留下的」

## 判準（每一條一支測試）

- 一次性客人會不會出現在壓表名單、問這輪的時間、壓表登記、時段反查、看這個月的進度、長備註「寫給誰」？（不會 —— **就算替他手動加了一筆額度也不會**）
- 一般客戶在這些名單上的結果，跟改之前一模一樣嗎？
- 試算表上找得到一次性客人的名字嗎？轉成客戶之後，他以前那幾段在試算表上有沒有一欄、一個符號？（都不可以）轉了之後新排、扣額度的段照常畫？
- 資料健檢會不會叫她去問一次性客人這輪的時間？一次性的二返接一次性的健檢，會不會被列成「接不上」？
- 月底對帳：一次性客人記了的那一段算「有記」？沒記的那一段列成「app 沒有這一段」？有名字卡的人會不會出現在「Abovee 上有、app 裡沒有這個人」？（不會）

## 做完時留下的

段二（2026-11-05）。開工前 `git fetch`：develop 沒動（`926e5712`，PR #204 已在裡面）、**沒有開著的 PR**，所以試算表那一塊照做、沒等。
測試在 `tests/one-time-lists.test.js`（23 條；名單每一條都**替他手動加一筆額度**再問）與 `tests/month-end-reconciliation.test.js` 最後一塊（4 條，整支跑 `reconcile.mjs`）。

**名單**（每一處明寫 `isOneTime()`，跟「停用」「刪掉」同一行）：
- `scheduling.js` 五支：`buildCustomerQueue()`、`customersToAsk()`、`customersToAskForMonth()`、`customersToBook()`、`candidatesFor()`（時段反查：不在名單上、也不在「為什麼不在」裡）。
  `scheduling.js` 從 `masterData.js` import（domain 裡已經 import 它的照樣從那裡拿，01 的約定）
- 開著的那一批：`batchRows()` 接新的人之前濾掉（`buildCustomerQueue()` 已經不算他，這裡照樣明寫）
- 看這個月的進度：`ui/views/progress.js` 讀 `customers` 那一行。**刻意不放進 `domain/progress.js` 的 `buildProgress()`** —— 客戶詳情一位一位問它（`customerDetail.js:481`），
  05 的名字卡那一頁要畫他的來訪紀錄的話會被濾成空的
- 長備註「寫給誰？」：`views/longNotes.js` 的挑人那一排（長備註清單本身不濾 —— 名字卡不給長備註，他身上不會有）
- 手動貼上「要哪一份」：`ui/views/report.js` 的 `load()` 回的 `customers` 濾掉

**試算表**（`sheetReport.js`；沒動 `sheetSync.js`、`sheetPushTiming.js`、`.gs`；**不升 `SYNC_FORMAT`**，指紋照 `syncBundle()` 的資料算、跟著對）：
- `syncBundle()` 的客戶跳過 `isOneTime()`（排在 `sheetNames()` 之前 —— 一次性客人跟一般客戶同名時不替一般客戶加尾巴）
- 新的 `sheetVisits(visits)`：一次性的段拿掉；整天都是 → 整筆拿掉（日期欄不畫）；混著一般的段 → 只留一般的、整筆狀態照留下來的段重推（`withSlotStatuses()` → `visitStatusFrom()`）——
  不重推的話「一次性那一段做完、一般那一段取消」那一天照樣被 `isActive()` 當成有來。沒有一次性的段的來訪原封不動（同一個物件）。**兩條路都先過它**（`syncBundle()`、`customerReport()`）
- 待辦（`taskBlocks()`，兩條路共用）：新的 `guestTask()` —— 帶 `slotIndexes` 的看那幾段、沒有的（健檢鏈那幾種、舊任務）看那一天每一段，全是一次性才不印。
  **混著一般的段的那一天，沒有 `slotIndexes` 的鏈上待辦照印**（拿不準就印；只有「轉成客戶那一天同一天又記了一般的段」才會發生）
- 中途發現段一第 3 條的保險：`followupNotes()` 的 `add()` 本來就跳過 `dateIndex < 0`，而日期欄從濾過的來訪算 —— 接在一次性健檢上的那幾場不會印（測試釘住）；
  03 之後接一次性健檢的 n返 也標一次性，整段被 `sheetVisits()` 拿掉

**資料健檢**：`checkStaleAvailability()` 跳過一次性客人；`followupLinks`／`followupDouble` 不用改 —— `strandedFollowups()`／`doneAheadOfExam()`／`doubleClaimedExams()` 02 就在裡面套投影了（測試釘住：一次性的二返接還排著的一次性健檢不列、健檢取消了照列）。
其餘照查（孤兒資料：他是一份客戶文件，他的來訪不是孤兒 —— 測試釘住）。查過沒有別的一項會把一次性的段當成問題（沒有額度的段只有 EECP 體驗那一項看，只認那一門課）

**月底對帳**（`reconcile.mjs`、`SKILL.md`）：
- 認人本來就是 `readAbovee()` 對 `ctx.customers`（含一次性客人）→ 認得就是 `recorded`／`new`，`strangers` 只剩 `identifyCustomer()` 認不出的（這一條不用改，測試釘住）
- 新的 `guestSlot()`／`guestItem()`：app 那一段標一次性、或這一列的人是一次性客人而 app 上還沒有那一段。次數表兩側（Abovee 課程完成、app 做完的段）都不數它
- 講次數的那幾句換成「一次性的段，不扣次數」：`unsigned`（次數還沒扣）、`stillBooked`（佔著一次）、`appDoneStays`（扣了一次）、`extra`（扣了一次）；`missing`（app 少算一次）換成「一次性客人，不扣次數」
- `SKILL.md`「那一頁每一塊是什麼」那一列改成「沒建名字卡的人（體驗、別人的客人、還沒記成一次性客人的）」，並補一句一次性的段不進次數表。
  `report.mjs` 那一塊的小字（「不是妳的客人就不用管」）沒改 —— 要不要多一句「要記進 app 就建一次性客人」等名字卡做好（05／07）再說，記在 HANDOFF 中途發現
- 「一天一格」那一排（`days`：Abovee 幾列、app 幾段）**照數一次性的段** —— 那是來訪，不是次數

**備份、還原**：不用改（客戶集合本來就在 `exportAll()` 與 `restore-backup.mjs` 的 `SECTIONS` 裡；`oneTime` 是客戶與時段身上的一格，跟著整份走）。

`sw.js` v287。E2E 沒在本機跑，推上去用 CI 全量跑（見 HANDOFF）。
