# 存好幾筆存到一半失敗，按重試不會被自己擋

Status: done
Blocked by: 19
來源：`../spec.md`（第二輪）
動工前先讀：`ui/toast.js` 的 `withSaveState()`（失敗時的重試鈕）、`ui/views/home.js` 的 `applyConfirm()`、
`ui/views/bulkCancel.js` 的 `run()`、`ui/components/aboveeConfirm.js` 的 `savedKeys`（已經做對的那一個）

## 她要的

04 的判準：「一般單機的每一條存檔路…照常存得進去」、「擋下來的時候 toast 講人話」。

## 現在壞在哪

確認抽屜（`home.js:3118-3122`）與批次取消（`bulkCancel.js:613-620`）是「一筆一筆存」的迴圈。
第二筆因為別的原因失敗（Rules 拒、網路斷在中間）時，toast 給重試鈕，而重試跑的是**同一個閉包**：

1. 從第一筆重存 —— 第一筆剛剛已經被自己存過，`updatedAt` 變了
2. `ifUpdatedAt` 對不上 → `StaleWriteError` →「儲存失敗：剛剛在別的地方被改過」

那句話是假的（改它的就是她自己），而且再也存不進去。04 之前重試是冪等的，這是 04 帶進來的回歸。

## 做法（方向）

- 照 `aboveeConfirm.js` 的作法：迴圈記住**已經存好的那幾筆**，重試時跳過
- 為了先寫一支會紅的測試，把「逐筆存、跳過已存、記住做到哪」抽成一支小函式（例如 `ui/` 或 `data/` 底下一支 `saveEach()`），
  兩個呼叫端共用，用假的 `save()` 單元測（第二次呼叫丟錯 → 重試 → 第一筆不再被存）
- 19 會把 `writes` 換成從新的那一份組，這一支接在它後面

## 判準

- 單元：兩筆、第二筆第一次丟錯 → 重試 → `save` 被呼叫的順序是「1、2（丟錯）、2」，不是「1、2、1」
- 批次取消：存到一半失敗之後，toast 上的重試與頁面上的「還有 N 筆沒成功，再試一次」兩條路都只存剩下的

## 做了什麼（2026-09-23）

新的一支 `public/js/ui/saveEach.js`：`saveEach(items, save, saved)` 逐筆存、存好的記進 `saved`，重試跳過。
`saved` 在閉包外面建一次，所以 toast 的重試沿用同一個。確認抽屜（`home.js` 的 `applyConfirm()`）與
批次取消（`bulkCancel.js` 的 `run()`）都走它；批次取消那一句「還有 N 筆沒成功」讀 `saved.size`。
頁面上那條「再試一次」本來就只存剩下的（失敗後 `loadVisits()` 重讀，存好的段已經不在可取消的清單上）。
`sw.js` 的 SHELL 補了它、`related.js` 登記在 22、44。測試：`tests/save-each.test.js`。
