# 資料健檢那幾顆整包寫 `slots` 的修正：快照是快取的不寫、別台改過就不蓋

Status: done
段：二（中途發現第 7 條，她 10/19 晚：「修」—— 最要緊）
動工前先讀：`data/health.js` 的 `applyFixes()`、`opFor()` 的 `clearBeds`／`moveBedToRoom`／`trialSlotsToCourse`／`retireTrialCourse`；`domain/health.js` 的 `checkSlotBeds()`、`checkEecpTrialCourse()`；`data/repo.js` 的 `commit()`（`ifUpdatedAt` → `StaleWriteError`）；ADR-0158；`CLAUDE.md`「存一筆來訪時手上那一份是舊的」「算次數、驗證、預選額度要拿哪些來訪」

## 她要的

> 7. 【她：修，最要緊】資料健檢那幾顆整包寫 `slots` 的修正（`clearBeds`、`moveBedToRoom`、`trialSlotsToCourse`）

（HANDOFF「中途發現」第 7 條；她答「照建議」。）

## 為什麼會這樣

時段是內嵌陣列，這三種修正把**快照那一刻的整包 `slots`**（只改了床位／診間／課程那幾格）寫回去，沒帶 `ifUpdatedAt`。
快照是快取來的（網路不穩、ADR-0158），或她按之前別台剛改過那一天（加了一段、取消了一段）→ 按下去把那一天新的段蓋掉。
01 只擋了 `recount`。

## 做法

1. domain 那兩項的 fix 帶著那一筆來訪的 `updatedAt`（`clearBeds`／`moveBedToRoom` 的 `updatedAt`；EECP 那兩種每一筆 `visits[]` 各帶）
2. `opFor()` 那三條 op 帶 `ifUpdatedAt` —— `repo.commit()` 本來就會比，對不上丟 `StaleWriteError`（整批不寫）
3. `applyFixes()`：快照不是全部（`snapshotWhole` 是 false）時，這幾種也擋（同 `recount`，`IncompleteReadError`、講一句）

## 判準

- 這一行會不會讓一筆來訪在她按下去之前被別台加的一段，被資料健檢的整包 `slots` 蓋掉？
- 快照是快取來的時候按這三顆 → 一筆都不寫、講一句

## 做完時留下的（10/19 段二）

- domain：`clearBeds`／`moveBedToRoom` 的 fix 帶 `updatedAt`；EECP 的 `rewrite()` 每一筆 `visits[]` 帶 `updatedAt`
- data：`data/health.js` 的 `SLOT_REWRITES`（四種 kind）—— `applyFixes()` 在 `repo.commit(` 之前擋（`IncompleteReadError`、`SLOTS_PARTIAL_SAY`）；
  三條 op 帶 `ifUpdatedAt`（`repo.commit()` 的 `sameStamp()`：讀不到 `updatedAt` 的舊資料不擋）
- 測試：`tests/health-slot-rewrites.test.js`（domain 帶值＋原始碼掃 op 與擋的位置）。E2E 53、72、03 照跑全綠（按修正那幾條路都還寫得進去）。
  **「別台改過 → 擋下來」沒有 E2E**：那一條是 `repo.commit()` 既有的 `StaleWriteError`（01 量過）
