# 改額度的其他幾條路：存完的 toast 也講待辦多一張／少一張

Status: done
段：五（段四審查提過、中途發現 15，她 10/19 深夜：「講，在 toast 後面接，不加確認框，同意」）
動工前先讀：issue 17；`data/customers.js` 的 `createEntitlement()`／`addEntitlements()`／`updateEntitlements()`／`restoreEntitlement()`；`data/visits.js` 的 `chainAfterEntitlements()`；`domain/consequences.js` 的 `chainSavedSay()`；ADR-0159、0070

## 她要的

> 15. 【她 10/19 深夜：講，在 toast 後面接，不加確認框，同意】改額度的其他幾條路，待辦多一張／少一張也講一句嗎？（加購一筆、加購一整個方案、拍訂購單加購、改購買日、從已刪除項目還原）
> 跟 17 同一個形狀：她替一位健檢做多了的客人加購一筆二返 → 待辦上多了「約二返」，畫面上只講「已儲存」。

## 為什麼會這樣

ADR-0159 讓每一條改額度的路都在同一個 commit 裡重算健檢那條鏈，但只有 issue 17 那一張表把 `plan` 回給畫面；
其餘幾支 data 函式只拿 `ops`（`chainOps()`），toast 寫死「已加購」「已還原」。那幾條路的確認框（有的話）也沒講到鏈。

## 判準

- 這一行會不會讓她加購一筆二返（或還原、改購買日）之後，待辦上安靜地多一張「約二返」、而 toast 只講「已加購」？
- 有講到鏈的確認框的那幾條（補一筆二返額度、刪除額度、資料健檢補上）不重複講

## 做完時留下的（10/20 段五）

- `data/customers.js`：`chainOps()` 換成 `chainOf()`（回整條鏈）＋ `chainSaid(chain)`（`{ plan, tasks }` 或 `null`）。
  `createEntitlement()`、`addEntitlements()`、`updateEntitlement()`、`updateEntitlements()`、`restoreEntitlement()` 都回 `chainSaid(chain)`
  （`createEntitlement()` 以前回新的 id、`addEntitlements()` 回 commit 的結果 —— grep 過沒有呼叫端讀它們）。`removeEntitlement()` 不回（確認框已經講了）
- 接 `chainSavedSay()` 的 toast：客戶詳情的加購一筆（`已加購…`）、加購一整個方案（`已加購 N 筆…`）、「把計數欄位改成重算值」（`已修正…`）；
  `bought.js` 改購買日、`trash.js` 還原（別種還原回的不是那一份，那半句是空的）、`orderConfirm.js` 拍訂購單加購到既有的那一位（`chain` 存在 `write` 外面，重試那一趟沿用）
- 沒動：補一筆二返額度（確認框有 `chainPlanLines()`）、刪除額度（確認框有）、資料健檢、新增客戶 `createWithPlan()`（新客戶沒有來訪，鏈不會動）
- 測試：`tests/chain-saved-say.test.js` 兩條接線掃描（先紅）；`tests/extra-exam-report.test.js` 的掃描改認 `chainOf(`；
  `tests/day-slot-words.test.js` 的例外放寬成 `${rows.length} 筆${chainSavedSay(…)}`；
  E2E 76 加 I4（從已刪除項目還原一筆次數 2 的二返額度 → toast「已還原 —— 待辦多 1 張「約二返」」、約二返當場出現；換回舊的 `public/js` 跑過是紅的），
  ①② 抽成 `closeExtraExamAndTickReport()` 跟 I3 共用。本機跑過 01、30、40、55、76（29 條全過）
