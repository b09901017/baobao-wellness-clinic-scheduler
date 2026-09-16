# 清掉已完成的待辦之後，同一筆來訪再存一次，那幾張會重新長出來

Status: todo
來源：`../spec.md`（報告 §2.2）
動工前先讀：`docs/adr/0091`（一張取消待辦知道自己收哪幾段）、`SPEC.md` 第 6.1 節（永不硬刪除）、
`domain/taskRules.js` 的 `syncTasksForVisit()`／`cancelTasksFor()`

## 她要的

> 比對時把軟刪除的也算進去

## 現在壞在哪

| 情境 | 清掉之前再存一次 | 清掉之後再存一次 |
|---|---|---|
| 取消一段 → 「取消 Abovee」勾掉 → 清掉 → 那一天去簽療程單結案 | 不長 | **又一張「取消 Abovee」，死線已經過了** |
| A 類已確認 → Examine、耀聖勾掉 → 清掉 → 在日曆改那一段的時間 | 不長 | **Examine、耀聖又各一張** |

兩層都把它們濾掉了：

- `data/tasks.js:45-47` 的 `listByVisit()` 走 `repo.list()`，而 `repo.list()`
  一律帶 `where('deletedAt','==',null)` —— 所以 `syncTasksForVisit()` 收到的
  `existingTasks` 裡根本沒有那幾張
- 就算有，`syncTasksForVisit()` 的 `auto` 與 `cancelTasksFor()` 的 `alive`
  也各自寫著 `!t.deletedAt`

**後果不是多一列紅字**：假的待辦會叫她**再去 Examine 掛一次號**，
或回 Abovee 放掉一個可能已經被別人排進去的時段。

## 做法

- `data/tasks.js` 多一支「連軟刪除的一起讀」，**只給 `data/visits.js` 的 `taskOps()` 用**。
  待辦中心那幾頁一個字都不改（她清掉的就是要消失）
- `domain/taskRules.js`：**比對用的視野**含軟刪除的，
  `syncTasksForVisit()` 的 `auto` 與 `cancelTasksFor()` 的 `alive` 跟著改
- **軟刪除的任務只拿來比對，不可以被 update 復活**：
  `update` 與 `remove` 那兩串要跳過 `deletedAt` 有值的
- Firestore 那一側：`listWithDeleted()` 已經有了（`repo.js:84`），不用開新索引

**這一支不動「只取消一段時要收哪幾個系統」**（她 2026-09-13 還沒定案）——
改的是 `covered`（那一段有沒有人收過），不是 `wanted`（要收哪幾種）。

## 判準

- **這一行會不會讓她軟刪除掉的任務在待辦中心重新出現？** 不可以
- **這一行會不會讓一張軟刪除的任務被 update 成「沒刪除」？** 不可以
- 清掉「取消 Abovee」→ 同一筆來訪再存一次 → **不長新的**
- 清掉 Examine／耀聖 → 改那一段的時間再存 → **不長新的**
- 「已刪除項目」還原得回來，還原之後行為跟沒刪過一樣
- 重現測試 `tests/prelaunch-repro/2-2-cleared-tasks-regrow.test.js` 轉綠，搬進 `tests/tasks.test.js`
