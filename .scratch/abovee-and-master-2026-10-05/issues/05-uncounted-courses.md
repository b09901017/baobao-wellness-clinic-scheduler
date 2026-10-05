# 不算次數的課（功醫門診）：不用加購就排得進去

Status: todo
來源：`../spec.md` 五、第三題
動工前先讀：ADR-0063 與 `domain/nthFollowup.js` 檔頭（n返 是第一種沒有額度的段，判準怎麼寫的）、`domain/visits.js` 的 `validateVisit()` 第 1505–1530 行、
`domain/slotDraft.js`、`ui/views/schedule.js` 第 1495–1560 行（額度那一排怎麼組、`NTH_PICK`）、`ui/views/visitEditor.js` 的 `blankSlot()`／`readDraft()`／額度那一格（第 498、545、866–921 行）、
`ui/components/buy.js` 的 `courseChips()`、`domain/masterData.js` 的方案驗證、`domain/consequences.js` 第 200–215、370–385 行、
`domain/entitlements.js` 的 `counts()`／`slotOutcome()`、`domain/sheetReport.js` 的 `log`（第 470–500 行）
Blocked by: 02、03、04（課程表單、系統、醫師；功醫門診三樣都要）

## 她要的

> **五、不算次數的課**：功醫門診不扣額度，現在排不進去。

> - 功醫門診：跟二返不同；不算次數、不簽療程單、不寫紀錄；三個系統都要壓；要選醫師

> 3. 這一輪只勾功醫門診。其他的我之後在設定自己勾「不算次數」就好。

## 為什麼會這樣

每一段都要指一筆額度，只有 n返 例外。擋的只有一行：`validateVisit()` 的「要選一個額度」（第 1517 行）。
`nthFollowup.js` 檔頭記著：系統本來就沒有假設每一段都有額度 —— `counts()` 逐段比 `entitlementId`（null 永遠不相等）、
`refState()` 對 null 回 `'none'` 不報孤兒、`recount()` 寫著 `if (slot.entitlementId)`。

但**三個入口組「這一段要做什麼」的那一排都是從額度長出來的**：壓表（`schedule.js` 第 1505 行起，額度＋「＋ n返」）、
來訪編輯器（額度下拉＋`NTH_PICK`）、拍 Abovee（`entitlementChoices()`）。沒有額度就沒有那一顆。

## 談定的做法

1. **課程多一格 `uncounted: true`**（設定頁的字：「不算次數」，提示「不用加購就排得進去；排了也不扣任何次數」）
2. **一支共用的「這一段可以做什麼」**：`domain/slotOptions.js`（新檔）的 `slotOptionsFor({ entitlements, visits, courses, equipment, … }, { includeUsedUp })`，
   回三種：額度（`followupsLast()` 排好；壓表只列還有剩的，拍 Abovee 用 `includeUsedUp` 連用完的也列 —— Abovee 上已經約了）、
   「＋ n返」（現在在 `schedule.js` 裡的那一段搬過來）、**每一門不算次數的課一顆**（「功醫門診 · 不扣次數」，剩餘那一格印「—」，同 n返）。
   **壓表改用它**；來訪編輯器的額度那一格多那幾個選項（值是 `__course__:<id>`，同 `NTH_PICK` 的作法，不會撞到 Firestore 的 id）；拍 Abovee 在 08 接
3. **組時段**：`slotFromPicks()` 多收 `uncountedCourseId` —— 課程就是它、`entitlementId: null`、`followupNth` 不碰；
   指派、醫師、時長、新段的狀態照原本那幾支（`assignsFor()`、`doctorRuleOf()`、`slotMinutes()`、`INITIAL_STATUS`）。
   來訪編輯器的 `readDraft()` 同一條路（g：新規則不在畫面裡重寫一次）
4. **驗證**（`validateVisit()`）：沒有額度的段，n返 或**課程是不算次數的**才放行；不算次數的課**又**指了一筆額度 → error（兩種身分只能挑一種，同 n返）
5. **擋住它出現在不該出現的地方**：
   - 加購那一排（`courseChips()`）不列不算次數的課 —— 買不了一個不扣次數的東西
   - 方案範本的項目不能選它（`validate('plans')` 擋）
6. **確認框只講真的會發生的事**（ADR-0070）：
   - 結案那一句「做了的 N 段扣掉次數」（`closeConsequences()` 第 379 行）只數有額度的段；全是不算次數的那天不講扣次數
   - 新增那一刻多一句，同 n返 第 213 行那一句：「功醫門診不算次數 —— 客戶身上的數字一個都不會變」
   - 逐句掃 `consequences.js` 裡所有「扣」「次數」的句子
7. **ADR-0121**：延伸 ADR-0063 —— 第二種沒有額度的段；判準「這一行會不會讓一段不算次數的被算進某一筆額度，或反過來」
8. **CONTEXT.md** 加一條「不算次數的課」；SPEC 第 4.2 節「次數在已完成才扣」旁邊補一句

## 牽連（一個一個查過再說不受影響）

- **次數**：`counts()`／`summarize()`／`reconcile()`（ADR-0004）、`slotOutcome()` —— 比的是 `entitlementId`，null 不進任何一筆。要有測試釘
- **試算表**：額度那幾列不會有它（對）；「來訪紀錄」照樣印（`log` 只看 `isLiveSlot()`）；記一句照樣印（`slotNoteCells()` 是逐額度的 —— **沒有額度的段的記一句印在哪？** 查清楚，印不到要講）
- **待辦**：系統照 03 的 `systemsOf()`；寫紀錄照 `needsRecord`；簽療程單照 `needsTreatmentForm`（`needsForm()`）
- **健檢鏈**（`followups.js`）：沒有額度 → 不配對、不佔健檢（`holdsExam()` 看 `entitlementId`）—— 要確認它不會被當成二返
- **壓表卡片牆／待辦中心「壓表登記」**（`customerPools()`）：只看額度，不會多出「還有 N 次沒壓」
- **資料健檢**：`refState()` 對 null 回 `'none'`；「資料過期」「次數對不上」不會報它
- **療程單比對**（`compareSheet()`）：不用簽的課不比（`needsForm()`）
- **名字**：`slotName()` 讀主檔課程名（不是 n返 那條讀快照的路）
- **合併檔**：現在每一段都要額度（`mergeImport.js` 第 258 行）—— 那一條歸 13
- **長按選單、改這一段、取消這一段、批次取消**：只看狀態與 `canCancelSlot()`，不看額度 —— 確認一次

## 判準

- 一位**沒有任何額度**的客戶：壓表上那一排有「功醫門診 · 不扣次數」，選了、存了、日曆上看得到？
- 那一段做完（簽療程單那一下）：客戶身上**每一筆額度的數字都沒變**；確認框沒講「扣掉次數」？
- 功醫門診三個系統都勾：客人確認之後長 Examine、耀聖；不長寫紀錄；不在「簽療程單」清單裡要拿單子（`needsTreatmentForm: false`）？
- 加購那一排、方案範本的課程下拉都**沒有**功醫門診？
- 來訪編輯器把一段功醫門診換成一筆額度、再換回來：存下去的 `entitlementId` 對（換回來是 null）？
- 試算表：次數那幾格一格都沒動；來訪紀錄那一天有功醫門診？

## 審查之後補的（2026-10-05，subagent 對著程式碼查過；跟上面衝突的地方以這一節為準）

**「不算次數」改成「可以不用額度就排」，不是「不准有額度」**（她 第三題：之後要自己勾別的課，例如營養諮詢）：

- 原本第 4 點「不算次數的課又指了一筆額度 → error」**拿掉**。`validateVisit()` 每一段都驗（呼叫端 `visitEditor.js` 第 288 行、`schedule.js` 第 2147 行、`aboveeConfirm.js` 第 143 行），
  她一勾營養諮詢，既有的營養諮詢那幾段（都帶著額度）就一律存不下去。新的規則：**沒有額度的段，n返 或課程是不算次數的才放行；有額度的照舊扣、照舊驗**
- 原本第 5 點擋方案範本**拿掉**：種子的方案裡就有營養師諮詢（`seed.js` 的 plans），勾了之後方案範本存不下去。**加購那一排只是不列它**（`courseChips()`），
  `validateEntitlement()` 不擋 —— 拍訂購單（`orderForm.js` 第 209、228 行）、批次建立（`bulkCustomers.js` 第 246 行）建出來的照樣合法
- `slotOptionsFor()`：不算次數的課**一定**有那一顆；這位客戶身上如果還有那門課的額度，額度那幾顆照樣在（她選哪一顆就扣不扣）

其他：
- **判準改走日曆新增與拍 Abovee**：一位完全沒有額度的客戶進不了壓表的佇列（`scheduling.js` 第 250 行 `totalRemaining <= 0`、`schedule.js` 第 424 行）。
  壓表那一排的判準改成「佇列裡的客戶」；沒有額度的那一條走日曆 → 新增 → 來訪編輯器，與 08 的拍 Abovee。佇列的門檻這一支不改（那是「還有誰要壓」的定義，ADR-0041）
- **確認框現在就對 n返 講錯**：取消時「次數也會還回來」（`consequences.js` 第 554、586 行）、結案時「做了的 N 段扣掉次數」（第 379 行）都不看那一段有沒有額度。
  這一支一起修，判準包含 n返（她沒發現的；修的時候順手，PR 裡講）
- **試算表印不出這種段的記一句**：記一句是逐額度印的（`sheetReport.js` 第 579 行 `slotNoteCells(entitlement, …)`），來訪紀錄（第 473 行）不帶記一句 ——
  功醫門診與現有的 n返 都印不出來。要印得升 `SYNC_FORMAT`、她重貼 `.gs` → 開成 **15**，等她決定；這一支的判準只驗「來訪紀錄那一天有功醫門診」
