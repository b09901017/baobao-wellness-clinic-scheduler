# 改二返的次數：存完的 toast 講待辦多一張／少一張

Status: done
段：二（中途發現第 8 條，她 10/19 晚：「修」）
動工前先讀：`ui/views/customerDetail.js` 改額度那一張表的存檔；`data/customers.js` 的 `updateEntitlement()`；`data/visits.js` 的 `chainAfterEntitlements()`；`domain/consequences.js` 的 `chainCountLines()`；`ui/toast.js` 的 `withSaveState()`；ADR-0159、0070

## 她要的

> 8. 【她：修】改二返的次數，待辦安靜地多一張／少一張（02 的重算，`customerDetail.js` 改額度那一張表）：那一張表沒有確認框，存完 toast 只講「已儲存」—— 她把二返從 1 改成 2，待辦上多了一張「約二返」，改回去又收起來，畫面上一個字都沒講。建議：存完的 toast 多半句（「已儲存 —— 待辦多一張約二返」），拿 `chainAfterEntitlements()` 回的 `plan` 數；不加確認框

## 判準

- 這一行會不會讓她改了二返的次數之後，待辦上安靜地多一張「約二返」、而畫面一個字都沒講？

## 做完時留下的（10/19 段二）

- `data/customers.js` 的 `updateEntitlement()` 直接叫 `chainAfterEntitlements()`（不經 `chainOps()`），寫完回 `{ plan, tasks }` 或 `null`
- `domain/consequences.js` 的 `chainSavedSay(chain)` → ` —— 待辦多 1 張「約二返」`／` —— 1 張「約二返」收起來了`（三種鏈上的待辦照順序、照種類數），沒動就是空字串
- `ui/toast.js` 的 `withSaveState()`：`success` 可以是函式（拿寫入的回傳值組那一句）；重試那一條照樣傳同一個 `success`
- 改額度那一張表：`success: (chain) => \`已儲存${chainSavedSay(chain)}\``。`fixCounts()`（重算次數）那一條不動（照舊「已儲存」）
- 測試：`tests/chain-saved-say.test.js`；`tests/extra-exam-report.test.js` 那一條掃描放寬成 `chainOps(` 或 `chainAfterEntitlements(`；E2E 76 I3 ③④ 各多一行看 toast（連跑兩次 3/3；第一次跑碰到一次 30 秒 `waitForSelector` 逾時，重跑沒再出現）
