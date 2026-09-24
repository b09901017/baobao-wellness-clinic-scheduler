# 客戶詳情「來訪紀錄」那一列逐段

Status: done
來源：`../spec.md` 第 13 條（R9）
動工前先讀：ADR-0081、ADR-0039（狀態符號）、`ui/views/customerDetail.js` 的 `visitRow()`、`ui/views/progress.js` 的逐段符號

## 她要的

> 7 全都修（R9：一段已確認、一段未到時，那一列印整筆推出來的「已確認」，看起來整天都已確認）

## 談定的做法

那一列右邊的狀態改成**每一段一個符號**（○△✓✗，跟進度追蹤同一組 `markFor()`／`statusClass()`）；只有一段時照舊印字。

## 判準

- 一段已確認、一段未到：那一列看得出兩種？
- 單段那一天照舊印「已確認」這種字？

## 對照 develop（`d00b644`）

- `visitRow()` 在 `customerDetail.js:1025`，印 `describeStatus(v.status)`（整筆）。對得上。
- **取消的那一段沒有符號**（`STATUS_VIEW.cancelled.mark` 是空的）：那一段印短字「已取消」，不要整段不印 ——
  那一列的課程名是整天的（`visitCourseLabel()` 連取消的也列），少一顆會對不上。

## 動工時決定的

- 判斷寫在 domain：`visits.js` 的 `dayStatusBadges()`（`customerDetail.js` 會連到資料層，node 測不到）。
- **每一段都一樣時印一個字**（不只單段那一天）：整天都做完的兩段那一天，整筆那一個「已完成」就是事實，
  印兩顆 ✓ 只是多一顆。判準那兩條照樣成立。
