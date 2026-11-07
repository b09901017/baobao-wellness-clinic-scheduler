---
paths:
  - "public/js/domain/mergeImport.js"
  - "public/js/domain/legacyImport.js"
  - "public/js/data/legacyImport.js"
  - "public/js/ui/views/mergeImport.js"
  - ".claude/skills/calendar-sheet-merge/**"
---

# 合併檔與舊資料匯入

**每一節的標題是「改了這個」，底下每一條是「一定要一起檢查」的**（從根目錄 `CLAUDE.md`「容易漏掉的連動」那張表搬來，標題照舊）。
新長出來的連動補進對應的那一節（沒有就加一節）；不屬於這一份的補進別份或開新的一份，並加進根目錄 `CLAUDE.md` 的索引。

## 匯入的來訪要建成什麼狀態

- 只寫在 `domain/mergeImport.js` 的 `statusFor()`（依匯入當下的日期，不是產檔的日期，見 ADR-0029）。
- **合併檔 v9 起段上可以自己寫已取消／未到**（只收那兩種，已完成／已確認照舊照日期判）：`planForCustomer()` 每一段寫實狀態、整筆照段推（`visitStatusFrom()`），取消的段的「取消 X」一出生就勾好（ADR-0164）。
- `domain/legacyImport.js` 寫死的 `done` 是對的：它只餵給 skill，狀態一律在匯入那一刻重判。
- **舊資料只有合併檔一條路進得來**，貼試算表那條 2026-08-23 拿掉了，見 ADR-0047

## 舊表 B2「購買名稱」、合併檔的購買欄位

- 讀那一格只寫在 `domain/legacyImport.js` 的 `parsePurchaseCell()`（skill 那一側跑），兩份 8 萬方案範本是同一支的 `LEGACY_PLANS`（**用舊表自己的列名寫，不讀 app 的主檔** —— skill 看不到她的主檔）。
- 讀出來的每一樣都拿 D 欄驗，對不上的收進 `purchaseProblems`，報告 ⓪c 與 app 的匯入頁都要列。
- **合併檔是契約**：改欄位就升 `baobao-merge/vN`，而且 `domain/mergeImport.js` 的 `FORMATS` 要收舊的那一版 —— 只加欄位不升版的話，舊版 app 會安靜地吃掉那幾格。
- `tests/calendar-merge.test.js` 盯著兩邊的版本字串一樣。
- `baobao-merge/v3`（2026-09-15）再帶額度的時長與客戶的警示、合作機構（ADR-0092）；
  - `baobao-merge/v4`（2026-09-28）候選帶 `decided`（ADR-0117）；
  - `baobao-merge/v6`（2026-10-09）多一段選填的 `staff`（人員全名，ADR-0141）：產檔那側 `merge.mjs --staff-names`、app 的 `validateFile()`（形狀不對整份拒收）、`staffRenames()`（要改哪幾位，摘要卡／確認框／寫入同一份）三個地方一起認得，**一律寫 v6**；
  - `baobao-merge/v7`（2026-10-14，ADR-0148）客戶多 `phone`（產檔那側 `--phones`：`applyPhones()` 先照病歷號、對不到比名字，不只一支不寫、進 ⓪b；名單由 `phones.mjs` 從 Abovee 擷取結果建，只放 `.local/`；**沒帶它時連 `phone` 這個鍵都沒有**）、每一段多 `giftKind`（**一般的段沒有這個鍵**；決定檔「加一段」帶 `free: '體驗'|'送的'`，健檢與二返進 ⓪d）；
  - `baobao-merge/v8`（2026-10-18，ADR-0155）**候選**（`futureVisits`／`missingFromSheet`）送的／體驗的那幾筆也帶 `giftKind`（`addExtraVisits()` 照它不扣任何一筆；沒有那一格的照舊照課程推）—— 行事曆的「EECP體驗」寫成 EECP＋`giftKind: 'trial'`（`TOKENS` 的第四格），**那個 token 不吃舊表 EECP 那一格的勾**（`sameSlot()`：一邊是送的／體驗、另一邊不是的不配），決定檔「加一段」還寫著舊名字的照 `TOKENS` 認（`renamedCourse()`）、指名主檔沒有的課進 ⓪d；
  - `baobao-merge/v9`（2026-10-20，ADR-0164）每一段多三格選填的 `note`（記一句）、`status`（**只收 `cancelled`／`no_show`**，已完成／已確認照舊是整筆照日期判；取消／未到的段照樣要額度 —— 跟一般的段同一套規則，`validateVisit()` 每一段都要）＋`cancelReason`（只寫在已取消的段上，失約的理由寫 `note`），客戶多 `longNotes`（`[{ title, body }]`，形狀照 `validateLongNotes()`、匯入時給 id、不寫 `noteOrder`）—— **`merge.mjs` 自己不產這四格**（切換那天的一次性腳本產）；
  - app 那側 `planForCustomer()` **每一段寫實狀態、整筆照段推**（`visitStatusFrom()`）、`addExtraVisits()` 併進去之後重推（不帶舊的整筆狀態去推 —— `slotStatus()` 看到整筆已取消會把每一段讀成取消），取消的段「取消 X」**一出生就勾好**（`taskRules.js` 的 `importedTasksFor()`，見「取消類的待辦」那一節（`tasks.md`）），摘要卡與確認框那一句只有 `missedSlotsLine()`，**一律寫 v9**；
  - `baobao-merge/v10`（2026-10-20 晚）客戶多選填的 `lineId`（她 LINE 好友清單上看到的名字，ADR-0157 —— 兩個字的叫法照存、不換成全名；`planForCustomer()` 去頭尾空白、空的是 `null`；`merge.mjs` 不產，切換那天的一次性腳本產），**一律寫 v10**；
  - `baobao-merge/v5`（2026-10-05）**不算次數的課那一段沒有 `entitlementKey`**（功醫門診，ADR-0121；v7 起 app 匯入時寫實成 `giftKind: 'trial'`）—— 三個地方要一起認得（v7 的 `giftKind` 也是這三個）：產檔那側決定檔的「加一段」（`applySlotDecisions()`）、app 的 `planForCustomer()`／`addExtraVisits()`、寫入之前那一道 `slotsMissingEntitlement()`（少一個就是整位匯不進去，或反過來一段扣不到額度的課安靜地寫進去）；
  - 行事曆的 `HRV` 是功醫門診、門診比那一句晚 30 分只寫在 `merge.mjs` 的 `startOf()`；
  - 舊表的新列名（`SIS(60min)`、`ILIB 30`、`任選(30min)`）只在同一支的 `rowShape()`。
- **她逐位回答過的決定**在 skill 的決定檔（`merge.mjs --decisions`，格式寫在 SKILL.md，她那份在 `.local/references/merge-decisions.json`、有真名）：改格式要同時改她那一份，**對不到對象的決定一定要進報告 ⓪d** —— 安靜失效的決定跟沒有決定長得一模一樣。
- **報告多一段，`board.mjs` 就要多一種**（`tests/merge-board.test.js` 盯著項數＝報告上印的數字）；「今天以前不匯」與「這一句提到她」各只有一支（`isPastEvent()`、`mentionsCustomer()`），決定頁與合併檔共用 —— 各判一次的話決定頁印「不匯」、合併檔卻匯進去。
- 決定頁與 `record.mjs` 的流程見 SKILL.md 第 4b、5 步。
- **病歷號名單**（`--chart-numbers`，2026-10-06）只補舊表沒寫的、不一樣的進 ⓪b 不改（`applyChartNumbers()`，在決定檔之後跑）；**沒帶它時合併檔一個位元都不變**，有測試釘著。
- `roomOf()` 讀得懂房號後面的床位（`.8A` → 點滴8A，**只在種子有那一間時**），只寫 `.8` 不給診間（ADR-0155：沒選床位的那一間刪了，報告數一行 `bedlessSlots()`）

## 行事曆匯進來的雜事是哪一類

- 產檔那側的 `classifyEvent()` 出**建議**（休假／待辦／行事備註），app 那側 `domain/mergeImport.js` 的 `eventKind()` 讀它、`ui/views/mergeImport.js` 讓她逐列改，**她改的那一個才算數**。
- 待辦寫進 `notes`（就是掛日期的隨手記，ADR-0044），另外兩種寫進 `events`。
- 判錯休假的代價最不對稱 —— 那幾天會整片排不進去 —— 所以寫了同事名字的一律退回行事備註

## 匯入時哪些候選預設勾起來

- 只寫在 `domain/mergeImport.js` 的 `defaultPicks()`：**她在決定頁決定過的（`decided: true`）照 `include` 勾**（ADR-0117），其餘照日期 —— 還沒發生的勾、已經發生的不勾（ADR-0030）。
- `include` **只有帶著 `decided` 的才算數**，v3 以前的檔案勾法一模一樣。
- 產檔那側她說不要的直接不寫進檔案、今天以前的雜事也不寫（她 2026-09-28）。
- 不要在 UI 裡再決定一次

## 一次寫很多筆、跑很久的按鈕（舊資料匯入）

- `withSaveState()` 8 秒就換成「已經存在這台裝置上了」，一位一個 commit 的匯入一定超過，所以**這種按鈕自己鎖**（2026-10-08，prelaunch-fixes 01、02）：進來先問 `running`（確認框開著也算進行中）、`finally` 是唯一放開的地方、**放開前重讀資料庫再重算**（已經建好的那幾位同名跳過）；按不按得下去只問 `domain/mergeImport.js` 的 `canRun()`。
- **不問資料庫的那幾筆要自己清勾**（雜事寫進去一批就把那幾筆的勾拿掉，`looseLeft()`）—— 重讀擋不住它們。
- `tests/save-guards.test.js` 掃這三個記號（`if (running) return;`、`finally` 裡的 `running = false;` 與 `loadContext(`）。
- 設定 → 課程 的存檔（會順手重算待辦）是同一種：`withSaveState()` 的 `key` 擋不到它前面的讀與確認框，所以 `masterList.js` 另有一個 `saving`。
- 判準：**按兩次、或失敗後重按，結果跟按一次一樣嗎？** 已知的洞：有人失敗之後**重新整理再貼一次**，雜事的預設勾選又回來。
- **放寬「按得下去」之前先看那道閘門還擋著什麼**（2026-10-09 審查）：`canRun()` 多收「只剩人員要改」之後，重新貼一次那一趟按得下去了，而那份檔案的雜事預設又全勾 —— 所以「這一趟寫不寫雜事」另外問 `writesLoose()`（客戶 0 位又不是重試就不寫），確認框與按鈕上面那一句跟著講。
- **每一段是誰照「人員改完之後」的主檔算**（`staffAfterRenames()`，人員是先寫的）；「對不到主檔」只數主檔的事，要補的來訪補不進去的別種原因另外講（`importCaveats()` 的 `unplaced`）
