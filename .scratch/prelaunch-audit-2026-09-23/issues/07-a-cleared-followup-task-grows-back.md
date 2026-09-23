# 清掉已完成的「約二返」後，它會長回來而且逾期

Status: done
來源：`../spec.md`
動工前先讀：01（這一支照用它的規則）、`docs/adr/0042`、`docs/adr/0065`、
`domain/followups.js` 的 `syncFollowupTasks()`／`keepsOpen()`／`stationFor()`、`data/visits.js` 的 `followupOps()`／`chainPlans()`
Blocked by: 01

## 現在壞在哪

1. 健檢做完 → 追蹤健檢報告勾掉 → 約二返、寄報告給醫師也勾掉（二返的時間客人還沒定，還沒壓進 app）
2. 待辦 → 約二返 → 已完成 → 清掉這 1 筆
3. 這位客戶**任何一筆來訪**再存一次（例如長按一段 Inbody 說客戶說可以）
4. **約二返又長回來**，死線是好幾天前（實跑：今天 8/29，死線 8/26）

報告、寄報告、約二返三張都清掉的話，長回來的是「追蹤健檢報告」，死線在一個月前。

## 怎麼重現

- 畫面：`scenarioExamineChain()` ＋ 三張已勾的鏈上任務（`doneAt` 分別給過去的日子）＋ 一筆今天待確認的 Inbody →
  `#/todo/約二返` → `[data-task-tab="done"]` → `[data-clear-done]` → 確認 → 日曆長按那筆 Inbody → 客戶說可以 →
  讀 `tasks`：多一張未勾的約二返
- 單元：`syncFollowupTasks()` 的 `tasks` 只給沒被刪掉的（模擬 `listByCustomer()`）→ `create` 裡有它

## 為什麼

跟 9/16 修掉的 Examine 那條（`prelaunch-fixes-2026-09-16/issues/09`）同一個病，但那一輪只修了**單筆來訪**那條路：

- `data/visits.js:245`（`followupOps()`）與 `:360`（`chainPlans()`）讀的是 `tasksData.listByCustomer()`，不含軟刪除
- `domain/followups.js:492` 的 `mine` 自己又濾一次 `!t.deletedAt`

於是「這一次健檢的約二返已經勾掉了」（`settled`）這件事，清掉之後就沒人記得。

## 做法（方向）

- 照 01 定下的那一句：**軟刪除的，`done` 的才算做過**。已勾又清掉的鏈上任務要算進 `settled`、`doneReport`、`doneSend`
- `data/tasks.js` 多一支「這位客戶的任務，連軟刪除的一起」（照 `listByVisitForSync()` 的樣子，只給比對用）
- 軟刪除的只拿來比對，**不可以被 update 或 remove**（跟 9/16 那一支同一條規矩）
- `previewTaskChange()` 與真的寫入共用 `chainPlans()`，所以確認框會自動跟上 —— 確認一下有沒有

## 判準

- 上面那個情境：清掉之後再存，**不長**約二返、也不長追蹤健檢報告
- 三張都清掉之後再存：一張都不長
- 「拿回來」那一條（K1～K5，`docs/邊界測試清單.md`）行為不變
- 復原掉的（沒勾過的）鏈上任務：照 01 當成不存在，該長的照長
