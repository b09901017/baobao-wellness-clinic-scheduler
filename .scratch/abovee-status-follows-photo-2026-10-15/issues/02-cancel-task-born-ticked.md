# 照片上已經取消的段：「取消 Abovee」那一張一出生就勾好

Status: done
Blocked by: —
動工前先讀：`spec.md`「『取消 Abovee』一出生就勾好」；ADR-0091（取消待辦逐段）、ADR-0106（勾過的才算做過）、ADR-0126（不用壓的課）、ADR-0119；
`domain/taskRules.js` 的 `cancelTasksFor()`、`seenTasks()`、`cancelSlotsOf()`、`syncTasksForVisit()`；`data/visits.js` 的 `save()`、`taskOps()`；
`domain/consequences.js` 的 `cancelConsequences()`（取消的確認框講「會多一張取消 X」）；CLAUDE.md「取消類的待辦」「被刪掉的任務算不算做過」兩列；`docs/agents/lessons.md` 一、五

## 她要的

> 所以其實像是abovee上拍到已取消，app 裡又沒有的那一列，就預設不勾，就算勾了也是記成已取消並且不用在去abovee上取消了

> 然後就不用產生取消和重排的待辦 ? 對吧我都在abovee改好了，不用再叫我去取消和重排啊?合理吧 ?

## 為什麼會這樣

`cancelTasksFor()` 第 1 條：一段取消了，壓在哪個系統就長一張「取消 <那個系統>」（Abovee 那幾門課就是「取消 Abovee」），叫她回去放掉那一格。
照片上已經是已取消，那一格她放掉了。

**不能只是「這一次不長」**：任務在每一次存那一天時重算（`data/visits.js` 的 `taskOps()` → `syncTasksForVisit()` → `cancelTasksFor()`），
只要沒有一張「看過的」蓋住那一段，下一次存同一天（她改另一段的治療師、簽療程單）就補長一張。`seenTasks()` 只算**勾過的**（ADR-0106）。

## 要做的

1. **在 domain 做**：`cancelTasksFor(visit, existing, coursesById, today, { freed })` —— `freed` 是照片上已經放掉的那幾段（段的位置），
   那幾段長出來的「取消 Abovee」是 `done: true`、`doneAt` 是那一刻。`syncTasksForVisit()` 兩個呼叫 `cancelTasksFor()` 的地方都要傳（`taskRules.js:467` 整天取消那一段、`:555` 逐段那一段）；
   `data/visits.js` 的 `save(visit, customerVisits, { freed })` 只負責傳給 `taskOps()`；確認框那一句 `consequences.js` 的 `cancelTaskLines()`（`:1097`，直接叫 `cancelTasksFor()`）收同一個參數。
   **不要在 `taskOps()` 事後把任務改成已勾**：確認框算不到，會照樣講「會多一張取消 Abovee」（ADR-0070、lessons 五）。
   名字不要叫 `released`（時段上的 `released` 是「已釋出遞補」，`audit.js:71`）
2. **只有 `bookingSystemOf(course) === 'Abovee'` 的那幾段**才算放掉了 —— 照片只證明 Abovee 上那一格。壓在別的系統的課照長、不勾。
   Examine／耀聖的取消照 `cancelTasksFor()` 第 2 條照長（掛過、那張掛號勾掉的才長）—— 照片看不出她在那邊收了沒
3. **拆張**：`cancelTasksFor()` 把同一種的每一段收成一張（`taskRules.js:837-846`）。同一次裡有放掉的段、也有沒被蓋到的別段取消
   （例如那一段的取消 Abovee 被「復原」過，`seenTasks()` 不算它）→ 放掉的那幾段一張、已勾；其餘一張、沒勾。不可以整張一起勾
4. 不用壓的課（`bookingSystemOf()` 回 `null`）本來就不長
5. 「看過」的判斷照舊只走 `seenTasks()`；**不改**勾過才算的規則；不在時段上多存一格當記號（日曆取消、批次取消也要懂它的話就多一個會漏的地方）
6. 一出生就勾好的任務：`changedFields()` 讀到 `done`，稽核那一句是「勾掉 … 取消 Abovee」（`audit.js:546-557`），落在「今天做了什麼」的 ④ 登記掛號（`dayReview.js:112`、`:227-230`）——
   看起來跟她自己勾的一樣。**這一輪接受**（spec「我自己定」），測試釘著它是這一句、不是怪句子
7. 這一支只做機制與測試；03（記成已取消的新段）、04（從照片改成已取消）、05（改期的舊時間）、06（一位一天的計畫，把 `freed` 帶進 `save()`）是呼叫端

## 判準

- 一段 Abovee 的課、`freed` 有它、存下去：那一天的任務裡有一張**已勾**的「取消 Abovee」蓋住那一段；**再存一次那一天**（不帶 `freed`，改另一段的治療師）不多長一張
- 同一段如果在 Examine 掛過（那張掛號勾掉了）：照樣長一張**沒勾**的「取消 Examine」
- 那門課壓在 Examine（不是 Abovee）、`freed` 有它：照長**沒勾**的那一張
- 同一次存檔：A 段在 `freed`、B 段是之前取消、它的「取消 Abovee」被復原過 → 兩張，A 的已勾、B 的沒勾
- 同一天另一段之後在日曆上取消：照常長一張沒勾的「取消 Abovee」（只蓋那一段，`slotIndexes`）
- 不用壓的課（HRV 那種 `systems: []`）：一張都不長
- `cancelTaskLines()` 帶同一個 `freed`：不講「會多一張取消 Abovee」
- 不帶 `freed` 的每一條路（日曆長按、批次取消、來訪編輯器的 ×）行為一個字都不變（既有測試全綠）

## 做完時留下的（10/15 段一）

**做成的樣子**：

- `taskRules.js` 的 `cancelTasksFor(visit, existing, coursesById, today, { freed = [], at = 現在 })`：
  `freed` 是照片上已經放掉的段（`visit.slots` 裡的位置）；只留**壓在 Abovee** 的那幾段（`bookingSystemOf()`）。
  每一種照舊算出「還沒被蓋到的段」（`left`），**「取消 Abovee」那一種**再拆成兩張：`freed` 的那幾段一張 `done: true`、`doneAt: at`，其餘一張沒勾。
  Examine／耀聖一律沒勾（照第 2 條長）。`freed` 指到還活著的段：不長（它不在 `dead` 裡）
- 已勾那一張的說明：`9/10 有一段取消了 —— 拍 Abovee 時那個時段已經是已取消，不用再去放`（整天取消是「的來訪取消了」）
- `syncTasksForVisit(visit, existing, { coursesById, today, freed, at })`：兩個呼叫 `cancelTasksFor()` 的地方都傳
- `data/visits.js` 的 `save(visit, customerVisits, { freed })` → `taskOps(…, { freed })` → `syncTasksForVisit(…, { freed })`。**只傳、不判**
- `consequences.js` 的 `cancelTaskLines(after, tasks, coursesById, { freed })`：**export 了**（06 的 `aboveeConsequences()` 要用），濾掉 `done` 的那幾張 ——
  「已經勾好了」那一句由拍 Abovee 的確認框自己整批講一次（06／07）。既有的三個呼叫端（`cancelConsequences()` 兩處、`rebookConsequences()`）不傳，一個字都沒變
- 稽核：一出生就勾好的那一張是 `tasks.create`、`done: true` → 「勾掉 … 取消 Abovee」，「今天做了什麼」落在 ④ 登記掛號 —— 跟 spec「我自己定」講的一樣，測試釘著

**呼叫端還沒有**：03（記成已取消的新段）、04（從照片改成已取消）、05（改期的舊時間）回 `freed`，06 帶進 `save()`。

**一個要記得的**（寫在 `cancelTasksFor()` 的註解裡）：只有拍 Abovee 那一條路會傳 `freed`，而那一條路不給復原（`undoable: false`）。
給了復原的話，復原把這一張軟刪除之後它還是 `done: true`，`seenTasks()` 當成做過 —— 那一段之後在日曆上再取消一次，一張都不長。

測試：`tests/cancel-task-freed.test.js`（18 條：機制、存兩次不多長、日曆之後再取消另一段照長、Examine 照長、壓在 Examine 的不勾、拆張、HRV 不長、確認框那一句、稽核那一句、`data/visits.js` 只傳不改）。
`npm test` 4511 全綠；相關 E2E 28 支 218 條全綠，2 條 flaky（`11-todo-drawer` 的 D3、D4，10 秒逾時 —— 那一支還有 `waitForTimeout(1500)`，單獨重跑 5/5 過；那條路不傳 `freed`）。
