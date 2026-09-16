# 讀取卡片上「跟客人確認時間」與「簽療程單」讀的是整筆

Status: done
來源：`../spec.md`
動工前先讀：`docs/adr/0081`、`.scratch/prelaunch-fixes-2026-09-16/issues/08`
（**它是對的，不要 revert**）、`domain/todoFlow.js` 的 `todosForVisit()`／`derivedRows()`

## 她要的（原話）

> 我發現這一項代辦，的跟客人確認時間沒有寫的符合事實，也就是如果這天A已經有兩個
> 已確認的時段如果我新增一個來訪 那原本已確認的那兩個的那一項的待辦中的
> 跟客人確認時間 就會被取消打勾？不知道這一項待辦的其他是不是也有相同問題
> 幫我一次修復

## 為什麼會這樣

`domain/todoFlow.js` 的 `derivedRows(visit, scoped, …)` 收兩個東西：`scoped`
（要算哪幾段，點了某一段就只有那一段）與 `visit`（**狀態從它讀**）。
所有別的列都已經走 `scoped` 了，就那兩列還在問整筆：

```js
// :308-315
done: visit.status !== 'pending_confirm'
  && (visit.status !== 'cancelled' || Boolean(visit.confirmedAt)),
// :322
const closed = visit.status === 'done' || visit.status === 'no_show';
```

她的情境：兩段已確認 → 加一段新的 → issue 08 讓整筆正確地退回 `pending_confirm`
→ 那兩段各自的讀取卡片上，「跟客人確認時間」跟著退回未打勾。
**壞的不是 issue 08，是這一列讀錯了東西。**

「其他是不是也有相同問題」的答案是**有一列**：`簽療程單`。同一天一段做完、
一段還沒做，做完那一段的卡片上「簽療程單」不會打勾。她還沒遇到，但形狀一樣。

`todoFlow.js` 裡**已經有 `scoped` / `focused` / `voided` 的既有作法**，別的列在用 —— 照抄。

## 要做什麼

`derivedRows()` 多收一個「這一段是誰」，兩列的 `done` 改成：

- `focused` 時走 `slotStatus(visit, slot)`（CLAUDE.md 那一條：逐段的狀態一律走它）
- 沒指定哪一段時**一個字都不變**（另外三頁列的本來就是整筆來訪，ADR-0089
  說那一張只是目錄）

取消掉的那一段走的是 `mineLive`（「它還活著的話」），那一條路上 `slot.status`
是被清成 `null` 的 —— 那時候 `slotStatus()` 會退回整筆，而整筆是 `cancelled`。
**所以 `voided` 那一條要拿原本那一段的狀態，不是 `asLive` 的**。這是這一支最容易寫錯的一格。

## 判準

- 兩段已確認的那一天加一段新的 → 那兩段的卡片上「跟客人確認時間」**照樣打勾**，
  新那一段的**沒打勾**
- 同一天第 0 段 `done`、第 1 段 `confirmed` → 第 0 段的「簽療程單」打勾，第 1 段沒有
- 沒指定哪一段的那一張目錄：行為跟 2026-09-16 一模一樣（有測試釘著就別動它）
- 取消掉的那一段：原本那幾列照樣列、帶 `void` 灰掉不劃線（她 2026-09-13 的要求），
  而「跟客人確認時間」的打勾狀態要照**它被取消之前**那一格算
- 這一行會不會讓一段已經談定的時間，因為同一天別段的狀態而顯示成還沒問過？
