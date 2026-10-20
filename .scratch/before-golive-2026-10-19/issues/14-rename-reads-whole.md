# 改名順手換快照之前讀全部：讀不完整就先不改名

Status: done
段：二（中途發現第 6 條，她 10/19 晚：「修」）
動工前先讀：`ui/views/customerDetail.js` 的 `paintEdit()` 存檔那一段（`renameTargets()`）；`domain/customers.js` 的 `renameTargets()`；13 的 `ownWhole()`；ADR-0158；`CLAUDE.md`「客戶改名」

## 她要的

> 6. 【她：修】客戶改名順手換快照（`customerDetail.js` 的 `ownSnapshots()`）：讀到快取時漏換幾筆，那幾筆待辦／來訪留著舊名字。建議：同 1，讀不完整就先不改名、講一句

## 為什麼會這樣

`ownSnapshots()` 用 `listByCustomer()` 讀三份，不問是不是快取 —— 少讀到的那幾筆不在 `renameTargets()` 的名單上。

## 判準

- 這一行會不會讓改名之後，快取裡漏掉的那幾筆待辦／來訪留著舊名字？

## 做完時留下的（10/19 段二）

- 改名時在 `withSaveState()` **之前**讀 `data.ownWhole()`（13 那一支，`say`：「先不改名，連上之後再存一次」）；讀不完整 `toast.readFailed()`、整張表不存（電話、病歷號那幾格也不存 —— 跟名字同一筆寫）
- `ownSnapshots()` 刪了（只有這一個呼叫端）；沒改名的存檔不多讀
- 測試：`tests/own-whole-reads.test.js` 第三條；E2E 46 照跑
