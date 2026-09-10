# 日曆加一段進「已確認」的來訪，整筆狀態沒有重推

Status: open
來源：2026-09-10，`tests-e2e/specs/25-visit-editor-one-slot.spec.js` 的 V4 第一次跑就紅
動工前先讀：`docs/adr/0081`（時段才是原子單位）、`0083`（一人一天一筆）

## 症狀

同一件事，兩個入口兩種結果：

| 入口 | 走哪一支 | 加一段進「已確認」那一筆之後 |
|---|---|---|
| 壓表 | `withExtraSlot()`（`domain/visits.js:310`） | 整筆**退回「待確認」**，`confirmedAt` 一起清掉 |
| 日曆 | `withNewSlot()`（`ui/views/visitEditor.js`） | 整筆**停在「已確認」** |

時段那一層兩邊都對（新的那一段是 `pending_confirm`，既有那一段留著
`confirmed`）。壞的是整筆那一格。

## 為什麼要緊

`visit.status` 是**推導出來又存起來的**，而且有四個地方讀它：
`firestore.indexes.json` 的複合索引、`firestore.rules`、試算表、備份。
所以一筆「整筆寫著已確認、底下卻有一段還沒問過客人」的來訪：

- `listByStatus('pending_confirm')` 查不到它 → 待辦中心不會叫她去問那一段
- 試算表那一欄印「已確認」
- 資料健檢的「來訪的狀態跟它的時段對不起來」會把它列出來 ——
  **而那一列是拿來抓歷史髒資料的，不該是 app 自己每次併段都生一筆**

## 根因

`visitEditor.js` 的 `withNewSlot()` 只做 `[...slots, blankSlot(...)]`，
一個字都沒碰 `visit.status`。`data/visits.js` 的 `save()` 也不重推 ——
它只跑 `withSlotStatuses()`（補時段的狀態）與 `withSlotNotes()`。

`withExtraSlot()` 那一支從一開始就把這件事寫進去了（它的 `reopened`）。
**壓表是對的，日曆是漏的。**

## 判準

> 這一行會不會讓「同一個動作在兩個入口留下不一樣的資料」？

## 建議做法（還沒定案）

日曆這條路改走 `withExtraSlot()` —— 它已經是那件事唯一的一份規則，而
`sameDayVisitFor()` 已經是兩個入口共用的了（ADR-0083），少的只有這一段。

**但要先想清楚兩件事**：

1. `withExtraSlot()` 的 `reopened` 會清掉 `confirmedAt`，而日曆這條路的
   確認動線跟壓表不是同一段程式 —— 退回「待確認」之後她會不會被要求
   把**已經談定的那兩段**重問一次？（`withExtraSlot()` 有處理：既有那幾段
   先把自己的狀態落下來。要確認日曆這邊也走得到。）
2. 既有那幾筆「已經歪掉的」怎麼辦。資料健檢那一列已經列得出來、也有一鍵
   重推，所以**大概不用遷移**，但要確認數量。

## 現在的狀態

`25-visit-editor-one-slot.spec.js` 的 **V4b 掛著 `test.fail()`** 指著這一支。
修好的那天它會轉紅（`test.fail()` 的測試通過時 Playwright 讓整份紅），
所以不會被忘記 —— 修的人記得把那個標記拿掉。
