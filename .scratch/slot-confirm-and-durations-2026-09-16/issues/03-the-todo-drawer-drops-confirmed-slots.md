# 待辦中心的確認抽屜還列著已經確認掉的那幾段

Status: todo
Blocked by: 01
來源：`../spec.md`
動工前先讀：`ui/views/home.js` 的 `paintConfirm()`／`confirmCard()`／`drawerHtml()`、
`domain/visits.js` 的 `applyConfirmation()`／`describeConfirmed()`

## 她要的（原話）

> 然後我這邊確認了某個時段客戶已確認後 待辦那邊的這個時段就可以收掉

issue 01 讓她在日曆上確認得掉單獨一段。那之後那一天還在
`visitsToConfirm()` 裡（另一段還沒問過，**那是對的**），但抽屜裡不該再列已經談定的那一段。

## 為什麼會這樣

`ui/views/home.js:2841`：

```js
const rows = visits.flatMap((v) =>
  (v.slots ?? []).map((s, i) => ({ visit: v, slot: s, key: `${v.id}:${i}` })),
);
```

**每一段都列**，不問狀態。在 issue 01 之前這不會出事（整天要嘛全確認、
要嘛全待確認），之後就會。

`confirmCard()` 的「壓了 N 段」（:2757）數的是同一份，也要跟著。

`applyConfirmation()`（`domain/visits.js:776`）本身**不用改**：它已經跳過
`cancelled`，而把一段已經 `confirmed` 的再寫一次 `confirmed` 是冪等的。

## 要做什麼

抽屜與卡片只列 **`slotStatus(visit, slot) === 'pending_confirm'`** 的那幾段。

⚠️ `applyConfirmation()` 收的 `rejected` 是**索引**（`rejected.has(i)`），而
`home.js:3026` 用 `v.slots.map((_, i) => i).filter(...)` 組它 —— **索引是對原本
那個陣列算的，不是畫出來那幾列**。過濾之後 `key` 仍然要是 `${v.id}:${原本的索引}`，
不可以用列出來的第幾列。這跟 `progressDayHtml()` 的 `data-slot` 是同一個坑
（CLAUDE.md 那一列寫著）。

## 判準

- 一天兩段，日曆上確認掉第 0 段 → 待辦中心那張卡寫「壓了 **1** 段」，
  抽屜裡只有第 1 段那一列
- 在那張抽屜裡把僅剩那一段點成「客人說不行」→ 送出後第 1 段變 `cancelled`、
  **第 0 段照樣是 `confirmed`**（不是整天取消）
- 兩段都還沒確認時：行為跟 2026-09-16 一模一樣
- 這一行會不會讓 `rejected` 那個 Set 裡的數字指到別段？
