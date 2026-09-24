# 客戶詳情的 LINE 訊息只講還算數的段

Status: done
來源：`../spec.md` 第 12 條（R5）
動工前先讀：ADR-0077、`domain/messages.js` 的 `messagesFor()`／`slotLines()`／`reminderMessage()`、
`ui/views/home.js` 的 `asPending()`（待辦中心那一張早就只講還沒問的段）

## 她要的

> 7 全都修（R5：排查找到的，她沒報過）

## 為什麼會這樣

`messagesFor()` 用整筆的狀態挑來訪、`slotLines()` 把那一筆的**每一段**都寫進去：
「問壓好的時間可不可以」會把已經談定、已經取消的段也問一次；「提醒 X 的來訪」的時間與課程可能是取消掉那一段的。

## 談定的做法

- 確認那一則：只寫**還在待確認**的段（同待辦中心 `asPending()` 那一份）
- 提醒那一則：只算**還算數**的段（`isLiveSlot()`）；那一天全部取消就不給這一則

## 判準

- 一天兩段、一段已確認一段待確認：確認那一則只問待確認那一段？
- 最早那一段取消了：提醒那一則的時間是第二段的？

## 對照 develop（`d00b644`）

- `messagesFor()`（`messages.js:239`）：確認那一則挑 `v.status === 'pending_confirm'`（253），提醒那一則照整筆（262）。對得上。
- `asPending()`／`pendingSlotsOf()` 還在 `home.js:3830` 附近。搬到 `domain/visits.js` 讓兩邊共用，不在 `messages.js` 另寫一份。
