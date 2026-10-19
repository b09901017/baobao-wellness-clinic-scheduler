# 療程單比對：讀不完整就「先不比」

Status: done
段：二（中途發現第 5 條，她 10/19 晚：「修」）
動工前先讀：`ui/views/treatmentSheets.js` 的 `renderPerson()`、`compareHtml()`、`compareEveryone()`；`domain/treatmentSheets.js` 的 `compareSheet()`／`compareAll()`；ADR-0105、0158

## 她要的

> 5. 【她：修】療程單比對（`treatmentSheets.js` 的 `renderPerson()`）：讀到快取時「簽了沒記」整排假警報。建議：讀到快取就講「讀不到全部，先不比」

## 判準

- 這一行會不會讓快取裡少了幾段時，那幾段被列成「簽了沒記」？

## 做完時留下的（10/19 段二）

- 一位的那一頁：`listByCustomer()` → `listWhole()`；讀不完整那一行講「網路不穩，讀不到全部的來訪 —— 先不比，連上之後重新整理這一頁」（`compareHtml(…, partial)`），讀不到照舊「讀不到來訪」
- **同一個形狀的另一處**：療程單總覽的「全部比對一次」（`compareEveryone()`）讀 `listBetween()` —— `data/visits.js` 多一支 `listBetweenWhole()`（看 `repo.cacheReads()` 前後、離線），讀不完整那一塊講那一句
- 只畫、不寫
- 測試：`tests/own-whole-reads.test.js` 第五條；E2E 42、43 照跑全綠
