# 刪客戶之前讀全部：讀不完整就不刪

Status: done
段：二（中途發現第 1 條，她 10/19 晚：「修」）
動工前先讀：`ui/views/customerDetail.js` 的 `[data-delete]` 那一段（`deleteBlockers()`）；`domain/customers.js` 的 `deleteBlockers()`；`data/visits.js` 的 `listWhole()`；`data/repo.js` 的 `cacheReads()`；ADR-0109、0158

## 她要的

> 1. 【她：修】刪客戶（`customerDetail.js` 的 `deleteBlockers()`）：網路不穩時快取裡少一筆待確認的來訪 → 「還掛著什麼」沒看到它 → 放行刪除，留下一筆沒有主人的來訪。建議：刪之前用 `listWhole()` 讀，讀不完整就不刪

## 為什麼會這樣

「還刪不掉」那一道（ADR-0109）拿的是打開這一頁那一刻讀的 `ctx.visits`／`ctx.tasks`／`ctx.notes` —— 那一刻是快取的話，少一筆就放行。

## 做法

`data/customers.js` 多一支 `ownWhole(customerId, name, { say })`：來訪走 `listWhole()`、待辦與隨手記照讀，任何一份是快取（`repo.cacheReads()` 前後不一樣）或離線 → `IncompleteReadError`。
刪除那一下先讀它、拿它問 `deleteBlockers()`；讀不完整 `toast.readFailed()`、不刪。

## 判準

- 這一行會不會讓快取裡少一筆待確認來訪的那一位，被當成「沒有掛著東西」刪掉？

## 做完時留下的（10/19 段二）

- `data/customers.js` 的 `ownWhole(customerId, name, { say })` → `{ visits, tasks, notes }`；來訪 `listWhole()`、待辦／隨手記看 `repo.cacheReads()` 前後、離線也擋；
  `say` 給了就換掉預設那一句（`IncompleteReadError` 的第二個參數）。**14 改名也用它**
- 刪除那一下（`customerDetail.js` 的 `[data-delete]`）先讀它 → `deleteBlockers(own)`、`taskLine()` 找來訪也用 `own.visits`；讀不完整 `toast.readFailed()`、不刪、不開確認框
- 測試：`tests/own-whole-reads.test.js`（原始碼掃）；E2E 77 C13（打開詳情之後才寫進一段待確認 → 照樣「還刪不掉」；換回舊的 `customerDetail.js` 跑是紅的）；46 照跑全綠
