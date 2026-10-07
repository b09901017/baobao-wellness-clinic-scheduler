# 簽療程單之後那一句「扣掉 N 次」只數真的扣次數的段

Status: todo
來源：`findings.md` 第 6 條
動工前先讀：`public/js/ui/views/home.js` 的 `applyClose()`（`:3530-3565`，`did` 在 `:3549`）、
`public/js/domain/consequences.js` 的 `closeConsequences()`（`:441-462`，`charged` 在 `:452`）、ADR-0070、0110、0121、
`CLAUDE.md` 連動表「不算次數的課」那一列（「確認框跟次數有關的三句只數扣著額度的段」）
Blocked by: —

## 她要的

`findings.md` 第 6 條（她 10/7：「我想修一二三六的所有內容」）：

> 抽屜寫「做了的 2 段裡 1 段扣掉次數」，toast 寫「記好了，扣掉 2 次」。資料是對的。

## 為什麼會這樣

抽屜那一句在 `closeConsequences()`：`charged` 只數有 `entitlementId` 的段（2026-10-05，ADR-0121）。
toast 在 `applyClose()` 自己數：`did` 是每一段按了 ✓ 的 —— 不算次數的課與 n返 也算進去。同一件事兩個地方各算一次。

## 要做的

「這一次按 ✓ 的段裡幾段真的扣次數」只算一次：從 `consequences.js` 匯出那一個數（`closeConsequences()` 自己也用它），`applyClose()` 的 toast 問同一支。
toast 三種：

- 有扣：「記好了，扣掉 N 次」（N＝真的扣的）
- 做了但都不扣（全是不算次數的課／n返）：「記好了，這幾段不扣次數」
- 一段 ✓ 都沒有：照舊「記好了，沒來的不扣次數」

「還有 N 段留著」那一半不動。

## 判準

- toast 的 N 跟抽屜那一句的 N 是同一支算的嗎？
- 這一行會不會讓一段不算次數的被講成「扣掉」，或反過來？

## 測試

- 單元（`tests/consequences.test.js`）：匯出的那一支 —— 一段有額度＋一段不算次數都 ✓ → 1；n返 ✓ → 0。
- E2E：簽療程單那一支 spec 加一條 —— 「物理治療師諮詢」＋有額度的一段都 ✓ → toast 是「扣掉 1 次」。
