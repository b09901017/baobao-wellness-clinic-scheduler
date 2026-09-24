# 寫紀錄一段一段長

Status: done
Blocked by: 04
來源：`../spec.md` 第 05 條（第五點的規則那一半）
動工前先讀：ADR-0066、ADR-0107（掛號逐段，同一個形狀）、`domain/taskRules.js` 的 `recordTasksForVisit()`／`needsRecord()`／
`newRegistrations()`／`syncTasksForVisit()`、`domain/todoFlow.js` 的 `pendingRecordTasks()`

## 她要的

> 就是為什麼寫記錄待辦那邊會有可能是當天同筆的？
> 例如我當天寫了A的營養諮詢（要記錄）和sis(不用) 但是我在寫記錄那邊卻看到
> 9/24 營養諮詢.sis  寫記錄？

## 為什麼會這樣

兩層（第二層是顯示，在 08）：

1. **規則**（重現）：閘門是整筆 `status === 'done'`（`taskRules.js:246`），再加「有沒有任何一段要寫紀錄」。
   所以營養諮詢未到、SIS 做了 → 整筆已完成 → 照樣長一張寫紀錄。04 之後還多一個洞：營養諮詢結了、SIS 還沒結，
   整筆停在已確認 → 寫紀錄永遠不長。
2. 那一張身上沒有 `slotIndexes`，`taskLine()` 退回整天的課程（08 處理顯示）。

## 談定的做法

- 一段**自己是已完成**、而且那個課程要寫紀錄，才需要寫紀錄（ADR-0066 的閘門從整筆換成那一段）
- 跟掛號同一個形狀（`newRegistrations()`）：一段還沒被任何一張蓋到才長；**同一次存檔的幾段收成一張**、記著 `slotIndexes`
- 沒有 `slotIndexes` 的舊任務當成蓋住整天（`cancelSlotsOf()`）—— 舊資料存一次一張都不多長
- 還沒勾的那一張，它蓋的段都不再需要（課程主檔把勾拿掉）→ 照舊收掉
- `todoFlow.js` 的 `pendingRecordTasks()`（「等一下會有這一張」）要跟著：假裝**那幾段**做完了，而不是只蓋整筆

## 判準

- 營養諮詢未到、SIS 做了：**不長**寫紀錄？
- 營養諮詢先結（做了）、SIS 還開著：寫紀錄**現在就長**，`slotIndexes` 只有營養諮詢那一段？
- 同一天兩段二返分兩次結：長兩張，各自蓋自己那一段？
- 舊資料（沒有 `slotIndexes` 的寫紀錄）再存一次：一張都不多長？
- 結案不會把還沒做完的 Examine／耀聖洗掉（ADR-0027 的後果那一節，E2E 16-R2）？
