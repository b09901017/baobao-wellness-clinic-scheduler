# 待辦那一列印出它掛的是哪一段

Status: todo
來源：`../spec.md`（第二輪）
動工前先讀：`docs/adr/0107`、`docs/adr/0091`、`domain/taskRules.js` 的 `taskLine()`、`domain/visits.js` 的 `visitCourseLabel()`／`slotName()`、
`domain/visitTime.js` 的 `timeLabel()`、CLAUDE.md「一列任務要顯示什麼」那一列

## 她要的

H（同一天兩段 A 類分兩次確認，長出兩張 Examine）：

> 維持兩張。一次確認就是一趟去 Examine，勾掉的意思很清楚。配合下面的 K

K：照建議 —— 帶 `slotIndexes` 的那幾張，只印那幾段的時間與課程（例如 `Examine・10/5・15:00 門診`）。

## 現在壞在哪

`taskLine()`（`taskRules.js:702`）的 `what` 是整筆來訪的課程（`visitCourseLabel(visit, master)`），不看任務掛的是哪幾段。
02 之後同一天可以有兩張 Examine（早上掛好的、下午補排還沒掛的），而它們在三個地方**長得一模一樣**：

- 待辦中心：`home.js:2058`、`:2126` 的 `[data-taskwhen]` 是**用 visitId 當 key**，`home.js:1849` 呼叫的是 `taskLine({}, visit, …)` —— 連任務都沒傳
- 客戶詳情：`ui/components/tasklist.js:43` 的 `taskRow()`
- 試算表的 TODO／FINISHED 區：`domain/sheetReport.js:704`

2026-09-13 起的逐段「取消 X」（ADR-0091）也是同一個問題：只取消了一段，那一列印的卻是整天的課程。

## 做法（方向）

- `taskLine(task, visit, master)`：`task.slotIndexes` 是陣列時，`what` 只講那幾段 —— 每一段「開始時間 ＋ `short` 名字」，
  幾段用「、」接（`15:00 門診`、`10:00 SIS(30)、15:00 門診`）。**取消類掛的是取消掉的段，不可以濾掉取消的**
  （`visitCourseLabel()` 本來就不濾）。沒有 `slotIndexes`（舊任務、獨立待辦、`home.js:1849` 那種空物件）照舊講整筆
- 待辦中心的 `[data-taskwhen]` 要能拿到那一張任務（改用任務 id 當 key，或多帶一格 `slotIndexes`），不要在畫面上自己拆段
- 時間與名字的寫法照既有的（`timeLabel()` 取開始時間、`slotName(…, 'short')`），不要新寫一種

## 判準

- 同一天兩張 Examine（`[0]`、`[2]`）：待辦中心、客戶詳情、試算表 TODO 區三處各自印出不同的時間與課程
- 一張「取消 Examine」（`slotIndexes: [1]`，那一段已取消）：印的是那一段的時間與課程
- 舊任務（沒有 `slotIndexes`）：一個字都不變
- 試算表只是字變、格式沒變 —— **不升 `SYNC_FORMAT`**（`.gs` 照單全收那一格字串）
- `tests/tasks.test.js`（`taskLine()`）與 `tests/sheet-script.test.js` 各補一條；CLAUDE.md「一列任務要顯示什麼」那一列補「帶段落的只講那幾段」
- 同一支 PR 還沒合：ADR-0107「後果」補一句「兩張各自印出它掛的那幾段」
