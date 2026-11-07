# 資料健檢的修正沒有防連按，「補上二返額度」「補警示詞」會多建一筆

Status: done（2026-11-05 修在 `.scratch/small-fixes-2026-11-05/issues/02-*`，PR #203 合進 develop `f5fb7b0a`；還沒上 main）
來源：`../REPORT.md` #2
動工前先讀：`public/js/ui/views/health.js` 的 `applyAndReload()`、`fixOne()`、`fixAll()`；`public/js/data/health.js` 的 `applyFixes()`、
`opFor()`（`addFollowup`、`addAlert`，對照 `addCourse`／`addEquipment` 用固定 id 的理由）；`tests/save-guards.test.js`；lessons 第三節
Blocked by: —

## 問題

`withSaveState(() => healthData.applyFixes(fixes), …)` 沒有 `key`，寫入期間按鈕照樣按得到。`addFollowup` 的 id 每次 `repo.newId()`、
`addAlert` 沒給 id，所以連按（或 toast 重試）會建兩筆：兩筆一樣的二返額度、兩個一樣的警示詞。
`save-guards` 只認 `.create/.take/.save(`，看不到 `applyFixes(`。

## 怎麼重現（本機模擬器）

1. 客戶 → 找一位額度裡有健檢的假客戶 → 那一筆二返額度 → 刪除這筆額度
2. 開發者工具 → Network → Slow 3G
3. 設定 → 資料健檢 →「二返額度」→ 補上二返額度 → 修正
4. 還在「修正中…」時再按一次補上二返額度 → 修正
5. 客戶詳情：兩筆二返

（沒在畫面上點過）

## 修的方向

給 `key`、寫入期間鎖按鈕；`addFollowup`／`addAlert` 的 id 在掃描時鑄好放進 `fix`；`save-guards` 多認 `applyFixes`。

## Comments
