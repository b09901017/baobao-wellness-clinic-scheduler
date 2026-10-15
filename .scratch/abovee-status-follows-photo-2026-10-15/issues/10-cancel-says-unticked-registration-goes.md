# 取消時講出「還沒勾的 Examine／耀聖會被收掉」，而且只拿那一天自己的任務算

Status: done
Blocked by: —
來自：段一的中途發現 2（她 10/15：「修」）
動工前先讀：`domain/consequences.js` 的 `cancelConsequences()`、`cancelTaskLines()`；`domain/taskRules.js` 的 `syncTasksForVisit()`（`remove`／`update` 那兩圈）、`cancelTasksFor()` 第 2 條；
ADR-0070（後果拿真的那一支算）、ADR-0091、ADR-0106；CLAUDE.md「一句『按下去會發生什麼』」「取消類的待辦」兩列；`docs/agents/lessons.md` 一、五

## 她要的

她 10/15 問：「如果我忘記勾掉 Examine／耀聖的預約待辦呢，會被當成沒做嗎？還是就會一直留著？」—— 段一查了：**當成沒做**。
取消那一段時，那張沒勾的掛號待辦被系統收掉，也不長「取消 Examine」—— 她其實掛了、只是忘了勾的話，沒有人提醒她回 Examine 收。
她回「修」，照建議：確認框講出來，並說「已經掛了的話先去勾掉它，取消時才會提醒你回去收」。

## 為什麼會這樣

- 整天取消的確認框講「還沒做完的「Examine」會被收掉」，**只取消一段那一條（`picked`）一句都沒講** —— 而真的寫下去時
  `syncTasksForVisit()` 照樣收掉（`remove`），或那一張蓋著好幾段時把這一段從 `slotIndexes` 拿掉（`update`，之後她勾掉它也不算這一段掛過）
- 兩種都沒講「她要先去勾掉」這個下一步

## 段一順手查到的同一種形狀（一起修）

**批次取消把好幾天的任務攤成一份**（`bulkCancel.js` 的 `listByVisitForSync()` × N → `.flat()`），再一天一天交給 `cancelConsequences()`。
`cancelTasksFor()` 不看 `visitId`：A 那一天勾掉的 Examine 會被當成 B 那一天也掛過 —— 確認框講「會多一張「取消 Examine」」，真的寫下去不長（實測）。
這一支新加的那一句也會吃到別天的任務，所以在 `cancelConsequences()` 一開頭只留這一筆自己的任務（沒有 `visitId` 的照留 —— 測試的假資料）。

## 要做的

1. `cancelConsequences()` 一開頭：`tasks` 只留這一筆的（`visitId` 對得上，或沒有 `visitId`）
2. 「哪幾張還沒勾的掛號待辦會被收掉／拿掉這一段」**拿 `syncTasksForVisit(after, tasks, …)` 的 `remove` 與 `update.slotIndexes` 算**（ADR-0070），不在畫面或這裡照規則推。只算掛號那一族（`TASK_KINDS`：Examine、耀聖）
3. 只取消幾段：收掉的講「還沒勾的「X」會被收掉」、縮小的講「還沒勾的「X」會拿掉這一段（還在的段照舊）」；再一句下一步
4. 整天取消：原本那一句照留；有掛號那一族時多那一句下一步
5. 下一步那一句：「已經在 X 掛了、只是還沒勾的話，先去待辦勾掉再取消 —— 取消之後才會提醒你回去收」
6. 句子一支（export，拍 Abovee 的確認框 06 要用：照片改成已取消的段同一個情況）

## 判準

- 只取消一段、那一段的 Examine 沒勾：講收掉＋下一步；勾了：不講這兩句（照舊講「會多一張「取消 Examine」」）
- 一張 Examine 蓋兩段、取消其中一段：講「會拿掉這一段」＋下一步
- 沒有 Examine 那一張：不講
- 整天取消：原本那一句照講，多一句下一步；只有「寫紀錄」要收的不講下一步
- 批次取消：別天的任務不影響這一天講的（A 勾掉的 Examine 不會讓 B 講「會多一張取消 Examine」）
- 講的跟真的寫下去的一樣（同一份任務跑 `syncTasksForVisit()`）

## 做完時留下的（10/15 段一之後）

- `consequences.js` 的 `registrationDropLines(after, tasks, coursesById)`（**export**）：拿 `syncTasksForVisit()` 的 `remove` 與 `update.slotIndexes` 算，
  只看掛號那一族（`TASK_KINDS`）。收掉的 →「還沒勾的「Examine」會被收掉」；蓋著好幾段、拿掉這一段的 →「還沒勾的「Examine」會拿掉這一段（還在的段照舊）」；
  再一句下一步：「已經在 Examine 掛了、只是還沒勾的話，先去待辦勾掉它 —— 這樣才會長「取消 Examine」提醒你回去收」（兩種一起時「Examine、耀聖」）。
  下一步那一句不寫「再取消」—— 改期那一道也用它
- 接上的三處：`cancelConsequences()` 只取消幾段那一條、整天那一條（原本那一句照留、多下一步那一句）、`rebookConsequences()`（改這一段改了時間）。
  四個取消入口（日曆長按、批次取消、確認抽屜、編輯器 ×）都經過 `cancelConsequences()`，不用各自改
- `cancelConsequences()` 一開頭只留這一筆自己的任務（`visitId` 對得上或沒有 `visitId`）—— 批次取消攤平的那一份不再讓別天的 Examine 漏進來
- **拍 Abovee 還沒接**：照片改成已取消的段（04）同一個情況，06 的 `aboveeConsequences()` 要叫 `registrationDropLines()`

測試：`tests/cancel-unticked-registration.test.js`（13 條）；`npm test` 4524 全綠；相關 E2E 14 支 123 條全綠。
