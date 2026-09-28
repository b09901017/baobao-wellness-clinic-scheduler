# app 照她在決定頁的選擇勾

Status: todo
來源：`../spec.md` 做法 6
動工前先讀：`docs/adr/0030-future-candidates-are-ticked-by-default.md`、`domain/mergeImport.js` 的 `defaultPicks()`、CLAUDE.md「匯入時哪些候選預設勾起來」「合併檔是契約」兩列

## 她要的

> 我希望我不要到app那邊再決定，而是可以匯入App前就把所有該決定的都決定好

## 為什麼會這樣

`include` 從 v1 起就在合併檔上，但 app 從來沒讀過（ADR-0030 的 Consequences）—— 預設值照日期算：
以後的勾、以前的不勾。她在決定頁說「這一筆過去的待辦要留」，到 app 照樣是不勾的。

## 做法

- 合併檔升 `baobao-merge/v4`（`FORMATS` 照收 v1～v3）。候選帶 `decided: true` 的，勾不勾照它的 `include`；沒帶的照 ADR-0030
- 產檔那側：她決定不匯的直接不寫進去；決定要匯的寫 `decided: true, include: true`
- 新 ADR（她事先決定過的照她的，沒決定的照日期），0030 一個字不改；SPEC 6.10、CLAUDE.md 那兩列跟著改；`sw.js` 版號

## 判準

- v3 的檔案貼進來，勾選跟以前一模一樣？
- v4 的檔案：一筆過去的、`decided: true, include: true` 的待辦預設勾著；一筆未來的、`decided: true, include: false` 的預設不勾？
- 舊版 app（只認到 v3）拿到 v4 整份擋下來？（`validateFile()` 的格式那一條）
