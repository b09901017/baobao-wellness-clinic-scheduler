# 復原過的、系統收掉的任務被當成「做過了」

Status: todo
來源：`../spec.md`
動工前先讀：`.scratch/prelaunch-fixes-2026-09-16/issues/09-cleared-tasks-must-still-count.md`（這一條的起點）、
`docs/adr/0091`、`docs/adr/0070`、`domain/undo.js`、`domain/taskRules.js` 的 `syncTasksForVisit()`／`cancelTasksFor()`

## 現在壞在哪

同一筆來訪**按過一次「復原」**之後，再做一次同樣的事，待辦就不會再長：

| 做了什麼 | 第一次長出 | 復原後再做一次長出 |
|---|---|---|
| 長按 A 類那一段 → 客戶說可以 | Examine、耀聖 | **什麼都沒有** |
| 簽療程單結案（二返、營養師諮詢這種要寫紀錄的） | 寫紀錄 | **什麼都沒有** |
| 長按 → 取消這一段 | 取消 Abovee | **什麼都沒有**，而確認框照樣寫「待辦會多一張『取消 Abovee』」 |

系統自己收掉的也一樣：確認過的 A 類那一段換成 C 類課程（Examine／耀聖被收掉）→ 再換回 A 類 → 不長。

## 怎麼重現

畫面上（模擬器，種子用 `tests-e2e/fixtures/data.js`）：

1. 一位客戶、今天一段**待確認**的復健科醫師門診（`course-rehab`）
2. 日曆 → 點今天 → 長按那一列 → 客戶說可以 → 等存完
3. 按 toast 上的「復原」→ 等「已復原」→ 重新整理
4. 再長按 → 客戶說可以
5. 讀 `tasks`：還活著、沒勾的一張都沒有（實跑：第一次 `['Examine','耀聖']`，第二次 `[]`）

單元測試的形狀：拿 `syncTasksForVisit()` 跑一次確認 → 把長出來的那幾張標上 `deletedAt`
（模擬 `inverseOps()` 的 softDelete）→ 用原本那一份來訪再跑一次 → 再確認一次 → `create` 是空的。

## 為什麼

9/16 為了「清掉的待辦不要再長回來」，`data/tasks.js` 的 `listByVisitForSync()` 把**全部**軟刪除的任務
交給比對，而 `syncTasksForVisit()` 把它們一律當成「這件事有人做過了」（`taskRules.js` 的 `wanted.delete(t.kind)`）。

但軟刪除有三種來源，只有一種是「做過了」：

| 誰刪的 | `done` | 真的做過嗎 |
|---|---|---|
| 她在待辦按「清掉」／垃圾桶（只有已完成那一格有） | `true` | 是 |
| 「復原」（`domain/undo.js`：新增的那幾筆 → `softDelete`，reason `復原`） | `false` | **不是** |
| 系統收掉（`syncTasksForVisit()` 的 `remove`：「來訪裡已經沒有需要這個任務的課程」等） | `false` | **不是** |

`cancelTasksFor()` 的 `covered` 也是同一個洞：復原掉的那張「取消 Abovee」還是被算成「那一段已經有人收了」。

確認框會說謊，是因為兩邊讀的不是同一份：確認框走 `tasksData.listByVisit()`（`calendar.js:1140`、
`visitEditor.js:1165`，不含軟刪除），真的寫入走 `listByVisitForSync()`（含）。

## 做法（方向）

- **判準只有一句：軟刪除的任務，`done` 的才算做過；沒勾過的當成不存在。**
  寫成一支（例如 `taskRules.js` 裡的 `countsAsDone(t)` 或 `seenTasks(tasks)`），`syncTasksForVisit()` 的
  `auto` 與 `cancelTasksFor()` 的 `seen` 都走它 —— 各寫一次遲早有一邊忘了
- 9/16 那一條的行為不能退：清掉（已勾）之後再存，**照樣不長**（`tests-e2e/specs/33-*` 盯著）
- 確認框與真的寫入讀**同一份**：確認框那兩處也改讀 `listByVisitForSync()`，
  或者把「哪幾張算數」那一支同時給兩邊用。ADR-0070：一句警告只能講真的會發生的事
- 要不要補一支 ADR 或在 ADR-0091 的 Consequences 補一段：「被刪掉的任務算不算做過」這條規則之前沒寫下來

## 判準

- 確認 → 復原 → 再確認：Examine、耀聖**各長一張**
- 結案 → 復原 → 再結案：寫紀錄**長一張**
- 取消這一段 → 復原 → 再取消：**長一張**「取消 Abovee」，確認框講的跟實際一樣
- A 類 → 換成 C 類 → 換回 A 類（都已確認）：Examine、耀聖**重新長**
- 清掉（已勾）之後再存：**照舊不長**（spec 33 的 T1、T2 照樣綠）
- 同一套規則要讓 07 直接用得上
