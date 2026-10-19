# 合併檔 v9：每一段可以帶「記一句」

Status: done
動工前先讀：`domain/mergeImport.js` 的 `FORMAT`／`FORMATS`、`validateFile()`、`planForCustomer()`；`domain/visits.js` 的 `NOTE_MAX`；ADR-0084（記一句在段上）、SPEC 6.4（匯進來的已完成鎖著）；`.claude/skills/calendar-sheet-merge/scripts/merge.mjs` 的 `importJson()`（版本是一行字面值 `format: 'baobao-merge/v8'`，沒有常數）、`SKILL.md`「合併檔」那一節；`tests/calendar-merge.test.js`（兩邊版本字串）；CLAUDE.md「舊表 B2…合併檔」那一列

## 她要的

> F 之後的療程內容最底下的在往下一排都是當天的那個時段的備註 … 請不要全部都放入這個客戶的備註之中

## 為什麼會這樣

v8 的段沒有 `note`，舊表日期欄底下那一格只能寫成客戶短備註（`legacyImport.js` 的 `leftoverCells()` 帶日期進備註，「9/7 欠30」）。
匯進來的已完成段是鎖著的（SPEC 6.4），匯完再補一句要一段一段走更正 —— 所以要在建立的同一次寫入就帶進去（同 ADR-0011 時間那一條的理由）。

## 做法

- `FORMAT` 升 `baobao-merge/v9`，`FORMATS` 收 v1～v8；檔頭的版本說明多一段 v9（四格一起：`note`、`status`、`cancelReason`、`longNotes` —— 02～04 同一版）
- `validateFile()`：`note` 不是 `null` 就要是字串、去空白之後不超過 `NOTE_MAX`（200）；不對整份拒收
- `planForCustomer()`：有字的寫進 `slot.note`（去頭尾空白），空的寫 `null`
- skill 那側 `merge.mjs` 的 `importJson()` 那一行一起升（內容不變：`merge.mjs` 自己不產 `note`，產的是切換腳本）
- 匯入頁摘要：「其中 N 段帶記一句」（`summarize()` 多一個數）

## 判準

- v8 的檔案（沒有 `note`）匯出來的每一段 `note` 都是 `null`（讀起來跟沒有那一格一樣：`slot.note` 的讀者都先 `?? ''`）
- v9 一段帶 `note: '遲到十五分鐘'` → 那一段 `slot.note === '遲到十五分鐘'`，其他段 `null`
- `note` 201 個字、或是數字 → `validateFile()` 拒收
- `tests/calendar-merge.test.js` 兩邊的版本字串一樣；寫死 v8 的那幾支（過目列的 merge-import／merge-functional-clinic／merge-v8-gift-candidates／merge-staff-roster／merge-chart-numbers）跟著升

## 做完時留下的（2026-10-20）

- 跟 issue 寫的一樣：`validateFile()` 驗 `note`（字串、去空白後 ≤ `NOTE_MAX`）、`planForCustomer()` 寫 `slot.note`（`textOf()`：去頭尾空白、空的是 `null`）
- 摘要卡多一行「N 個時段帶著記一句（舊表那一天底下那一格）」—— `counts.slotNotes` → `summarize().slotNotes`；**確認框沒有加**（那一份已經很長，記一句不改變寫入的次數）
- 寫死 v8 的五支舊測試升 v9；「認不得的版本」改拿 v10 試。`tests/e2e-related.test.js` 不用登記 `tests/merge-v9.test.js`（單元測試不在它的名單裡）
- 測試的例子寫「遲到十五分鐘」：「遲到」緊接阿拉伯數字會被 `tests/no-secrets.test.js` 當成姓名黏著病歷號
- `sw.js` v199（這一輪只升這一次）
