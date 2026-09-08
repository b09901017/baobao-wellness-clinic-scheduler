# 試算表逐段印符號（順手修既有 bug）、稽核講得出是哪一段

Status: todo
PR: 1（地基）
動工前先讀：`domain/sheetReport.js` 的 `mark()` 註解、`docs/adr/0062`

## 一、試算表：既有的 bug

`mark()` 現在讀 `markFor(v.status)` —— **整筆的狀態**。所以一筆標「已完成」、
其中一段 `attended: false` 的來訪，兩段都印 ✓。那一支自己的註解寫著這件事
還沒做：

> 之後時段各自帶結果時，要改的只有下面那一行 `markFor(v.status)`
> —— 換成看那一段自己的結果。

改成 `markFor(slotStatusOf(v, slot))`，逐段 tally。取消掉的那一段**不印符號**
（`markFor()` 對 `cancelled` 本來就沒有符號）。

**`SYNC_FORMAT` 不用動**：符號那一格的格式沒變，只是算得對了。
所以 `sheets/readonly-report.gs` 一個字都不用改，她也不用回 Google 重貼。

## 二、稽核紀錄

`domain/audit.js` 的 `describeParts()` 要講得出「取消了 8/11 的第 2 段
（SIS(30)）」，不是只講「改了一筆來訪」。

**稽核仍然不帶主檔**（ADR-0078 的後果那一節）—— 那一份記的是當時寫下去的字。
所以這裡印的是快照上的名字，不是現在的顯示名稱。

## 三、今天做了什麼

`domain/dayReview.js` 的 `STAGES` **最後一段永遠收得下剩下的**，所以逐段取消
不會有東西被丟掉。但要**確認**照人與照流程兩種分組都還成立
（有一支測試盯著，跑一次就知道）。

## 測試要蓋到的

- 一筆 done、其中一段 `attended: false` → 試算表印 `✓✗` 不是 `✓2`
- 逐段取消的那一段不印符號
- `tests/sheet-script.test.js` 的兩邊仍然對得上
- `dayReview` 一則都沒被丟掉（既有測試）
