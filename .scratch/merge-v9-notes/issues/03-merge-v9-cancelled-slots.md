# 合併檔 v9：已取消／未到的段＋取消理由

Status: done
Blocked by: 02
動工前先讀：`domain/taskRules.js` 的 `cancelTasksFor()`（`freed`）、ADR-0149、0106；`domain/mergeImport.js` 的 `planForCustomer()`、`visitDoc()`、`statusFor()`、`slotsMissingEntitlement()`、`summarize()`／`countNewTasks()`；`data/legacyImport.js` 的 `importPlan()`（`withSlotStatuses()`、`recount()`、`importedTasksFor()`）；`domain/visits.js` 的 `visitStatusFrom()`、`slotCancelReasonOf()`；`domain/entitlements.js` 的 `slotOutcome()`；`domain/taskRules.js` 的 `importedTasksFor()`、`cancelTasksFor()`；ADR-0081、0093（匯進來的來訪不長任務）、0029；CLAUDE.md「一段來訪的狀態、或它算不算數」「一段來訪身上那一句話」兩列

## 她要的

> 如果那一整排有日期單是沒勾最下面寫得像是她忘記，就是她取消的理由，請不要全部都放入這個客戶的備註之中

10/20 選的：**建成那一天已取消的段＋取消理由**（課程與時間從 Abovee 那天取消的那一列拿）；客戶失約的建成**未到**、理由記在記一句。

## 為什麼會這樣

v8 的來訪只有兩種：舊表勾了的（`done`）與還沒發生的（`confirmed`），段上沒有狀態 —— `importPlan()` 的 `withSlotStatuses()`
照整筆補。取消的那一天根本沒有東西可以掛理由。理由的家在 `slot.cancelReason`（2026-10-15，讀只走 `slotCancelReasonOf()`）。

## 做法

- 段多兩格選填的：`status`（只收 `'cancelled'`／`'no_show'`；其餘值整份拒收）、`cancelReason`（字串，只在 `cancelled` 的段上有意義；跟 `note` 同一個上限）
- `planForCustomer()`：有 `status` 的那一段寫實 `status`、`attended: false`、`cancelReason`；**其餘段也寫實整筆的狀態**（`statusFor()` 的結果），
  整筆的 `status` 改成 `visitStatusFrom()` 推出來的 —— 全部取消 → `cancelled`、只剩未到 → `no_show`
- 取消／未到的段**跟一般的段同一套額度規則**（要嘛 `entitlementKey`、要嘛送的／體驗、要嘛預設體驗的課）：
  過目查到 `validateVisit()` 每一段都要額度（visits.js 的 `visitErrors()`「要選一個額度」）—— 沒有額度的取消段，之後她編輯那一天就存不下去；
  未到的段「退回簽療程單」之後也會變成沒有額度的已排。所以額度在產檔那側照課程配，app 這側**不放寬**
- **取消類的待辦長一張已經勾好的**（新 ADR，比照 ADR-0149 的 `freed`）：過目查到只有取消段的那一筆整筆是 `cancelled`，
  `importedTasksFor()` → `syncTasksForVisit()` 的 gone 分支 → `cancelTasksFor()` 會長「取消 Abovee」；一段做完一段取消的那一筆匯入時不長，
  但之後任何一次存那一天，`cancelTasksFor()` 找不到看過的那一張蓋住那一段就**補長**（`seenTasks()`，ADR-0106）。
  舊系統上早就放掉了 → 長一張勾好的，之後就不會再長。`countNewTasks()` 只數沒勾的（匯入頁講的是「會多幾件要做的事」）
- `addExtraVisits()`（候選併進同一天）：併進去之後整筆照段重推，新的那一段的狀態寫實（過目：那一天整筆是 `cancelled` 時，`slotStatus()` 會把併進去的段讀成已取消）
- 摘要卡與確認框：「其中 N 段已取消、N 段未到（不扣次數）」

## 判準

- 一筆來訪兩段：一段 `done`、一段 `status: 'cancelled', cancelReason: '她忘記'` → 整筆 `done`、第二段 `slotCancelReasonOf()` 是「她忘記」、`recount()` 只算第一段
- 一筆來訪只有一段 `cancelled` → 整筆 `cancelled`；`importedTasksFor()` 回一張**勾好的**「取消 Abovee」（`slotIndexes: [0]`）、沒有沒勾的
- 一段 `done`＋一段 `cancelled`、一段 `cancelled`＋一段 `no_show`、一段 `cancelled`＋一段還沒來的 → 取消類全部是勾好的；還沒來的那一段照常長掛號
- 拿匯入時長的那幾張餵回 `syncTasksForVisit()`（之後再存一次那一天）→ `create` 裡沒有取消類
- 一段取消、帶著額度 → 過得了 `validateVisit()`；`countNewTasks()` 不數勾好的那幾張
- 一段 `no_show` → `counts()` 的 `noShow` 是 1、`remaining` 不少
- `status: 'done'`、`'confirmed'` 或亂寫 → `validateFile()` 拒收（那兩種是整筆的事，不在段上寫）
- v8 的檔案匯出來每一段的 `status` 跟以前一樣（整筆的）

## 做完時留下的（2026-10-20）

- `SLOT_STATUSES = ['cancelled', 'no_show']`；`validateFile()` 另外擋「取消理由寫在沒取消的段上」（含未到 —— 失約的理由是記一句）
- `planForCustomer()` **每一段都寫實 `status`**（檔案沒寫的段寫整筆的 `statusFor()`），整筆是 `visitStatusFrom({ status, slots })`。取消／未到的段 `attended: false`，取消的段才有 `cancelReason` 那個鍵
- `addExtraVisits()`：新的那一段寫實 `status`；併進同一天之後 `visitStatusFrom({ ...same, status: null })` —— **不帶舊的整筆狀態去推**，`slotStatus()` 看到整筆已取消會把每一段讀成取消
- `importedTasksFor()`：先跑 `syncTasksForVisit()`，取消類的全部改成勾好的（`done: true`、`doneAt: at`、說明換成「匯進來的舊資料…不用再去放」）；已經發生的那一筆只回那幾張。**每一種取消類都勾**（不只 Abovee，跟 `freed` 不一樣 —— 理由在 ADR-0164）
- `countNewTasks()` 只數沒勾的；新的 `countSettledTasks()` 數勾好的。匯入頁那一句是 `skippedSlotsLine(s, settled)`（摘要卡與確認框共用），`settled` 掛在 `paint()` 的 `s` 上
- 「全部標成已完成」「其餘的標成已完成」「已經發生的來訪標成已完成」三處有取消／未到時改字
- ADR-0164
