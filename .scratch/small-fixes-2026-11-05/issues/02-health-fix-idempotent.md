# 資料健檢的修正：連按、重試都只建一筆

Status: todo
Blocked by: —
動工前先讀：`.scratch/code-health-2026-11-04/issues/02-health-fix-double-press-creates-twice.md`（詳細在那一支）；
`public/js/ui/views/health.js` 的 `applyAndReload()`；`public/js/data/health.js` 的 `applyFixes()`、`opFor()`（`addFollowup`、`addAlert`，
對照 `addCourse`／`addEquipment` 用固定 id 的註解）；`public/js/domain/health.js` 產生這兩種 `fix` 的那幾支；`tests/save-guards.test.js`；lessons 第三節

## 她要的

同 01（11/4 健檢的 6 條，11/5 選先修）。

## 為什麼會這樣

`applyAndReload()` 的 `withSaveState(() => healthData.applyFixes(fixes), …)` 沒有 `key`；`addFollowup` 的 id 在 `opFor()` 裡 `repo.newId(path)`（每跑一次一個新的）、
`addAlert` 不給 id（自動）。寫入期間再按一次那一顆、再按確認框的「修正」→ 第二筆；toast 的重試也是重跑同一個閉包。
`save-guards` 只認 `.create/.take/.save(`，`applyFixes(` 不在它的視野。

## 做法（過目 11/5 校正過）

1. id 在**掃描時**鑄好、放進 `fix`。`domain/health.js` 是純函式拿不到 `repo.newId`，所以鑄在 **`data/health.js` 的 `run()` 後處理**
   （掃完替每一個 `addFollowup`／`addAlert` 的 `fix` 補上 `id`），`opFor()` 照用。`addAlert` 也是每次掃描鑄一個，**不要用詞本身算 id**
   （詞可能含「/」；同一個 id 會蓋掉她刪掉的那一筆）
2. 現在確認框（`previewFollowupChains()` → `opsFor()`）與寫入各跑一次 `opFor()`，**兩邊的 id 本來就不一樣**；改完之後兩邊同一個
3. **`repo.commit()` 的 create 是 `batch.set`：id 已經存在就整份覆蓋**（`createdAt` 重設、計數回到 draft、軟刪除的被救活、稽核多一筆 create；Rules 不擋）。
   所以 `applyFixes()` 寫之前先讀那幾個 id，**已經存在就跳過**（連按的第二次、重試都靠這一條，不是只靠 id 相同）
4. 重試時 `chainAfterEntitlements()` 的 `[...list, ...added]` 會讓同一個 id 出現兩次（二返算兩份、可能多長「約二返」）：先照 id 去重
5. `applyAndReload()` 給 `key`，寫入期間第二次按回同一個 Promise
6. `tests/save-guards.test.js` 的 `CREATES` 正規表示式加 `applyFixes`，讓下一個沒帶 `key` 的會紅

## 判準

- 同一顆「補上二返額度」按兩次（第二次在第一次還沒寫完時）→ 客戶身上會不會有兩筆二返額度？（不可以）
- 第一次寫完了、toast 卻顯示失敗、按重試 → 會不會多一筆、或把第一次那一筆整份覆蓋掉？（都不可以）
- 確認框講的「補完之後那條鏈」與真的寫進去的，是不是同一個 id、同一份計畫？重試時鏈會不會把同一筆算兩次？

測試：domain／data 的單元（`fix` 帶 id、已存在就跳過、去重）＋掃 `opFor()` 原始碼沒有 `newId(`。

## 做完時留下的
