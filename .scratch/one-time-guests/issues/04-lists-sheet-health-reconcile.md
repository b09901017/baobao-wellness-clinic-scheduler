# 04：名單排除、試算表、資料健檢、月底對帳

Status: todo
Blocked by: 01（資料健檢鏈上那兩項另外要 02、03）

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

（做完的那一段寫）
