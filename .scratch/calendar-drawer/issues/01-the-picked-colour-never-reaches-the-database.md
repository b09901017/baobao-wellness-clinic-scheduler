# 挑了顏色，但那個顏色從來沒被存下去

Status: todo
來源：使用者，2026-08-24（spec.md 的 a）
確認過（2026-08-24）：**選得起來，但存完日曆上沒變色**
動工前先讀：`docs/adr/0040-a-personal-event-picks-its-own-colour.md`

## 原話

> 「我發現顏色不能改？就是不論是新增還是編輯都不能改行事備註和休假的顏色？」

## 病灶

不是 UI 的問題 —— 挑顏色那一整條路除了最後一步之外都是好的：

- `ui/views/eventEditor.js` 的 `colourField()` 畫出六顆色票加一顆「跟著類別」，
  `wire()` 把 `draft.color` 設好，重畫時 `aria-pressed` 也對。
- `domain/events.js` 的 `validateEvent()` 認得 `color`，`paintClass()` 讀得出來。
- `firestore.rules` 的 `validEvent()` 早就開好洞了（`color` 可以是 null 或字串）。

斷在 `public/js/data/events.js` 的 `shape()`：

```js
function shape(data) {
  const allDay = Boolean(data.allDay);
  return {
    title: ..., category: ..., startDate: ..., endDate: ...,
    allDay, startTime: ..., endTime: ..., note: ...,
    // ← color 不在這裡
  };
}
```

`create()` 與 `update()` 都走它，所以 `draft.color` 在送進 Firestore 之前
被整個丟掉。**畫面上選得起來、按了儲存也成功、重新打開就回到預設色** ——
這正是她描述的樣子。

## 要做什麼

`shape()` 補一個欄位，而且**在這裡就把不認得的值擋掉**：

```js
import { DEFAULT_CATEGORY, EVENT_COLORS } from '../domain/events.js';

color: EVENT_COLORS.includes(data.color) ? data.color : null,
```

用白名單不是原樣傳過去：`validateEvent()` 已經擋過一次，但 data 層是最後一道，
而「寫得進去卻畫不出來的顏色」在畫面上完全看不出哪裡錯了。沒挑就存 `null`，
不要留 `undefined` —— Firestore 會直接省略那個欄位，而 `update()` 時
「省略」的意思是「不要動它」，那會讓「把顏色改回跟著類別」變成一個做不到的動作。

## 一起要檢查的

- **`tests/events.test.js` 現在只測 domain，沒有測到 data 層的 `shape()`。**
  這個 bug 之所以躲得過測試就是因為那一層沒有人看。補一支
  `tests/events-data.test.js`，或在既有的檔案裡把 `shape()` 匯出來測 ——
  進去什麼、出來什麼，含「不認得的顏色要變成 null」。
  哪一種寫法都可以，但**這一層要有測試**，否則同一種漏會再發生一次
  （`note`、`startTime` 都走同一個函式）。
- 已經存在的行事備註身上沒有 `color`，`colorClass()` 回空字串 → 落回類別預設色。
  **不需要資料搬遷。**
- `public/sw.js` 的 `VERSION` 加一（`SHELL` 清單沒變）。

## 驗證

- `npm test`
- 瀏覽器：從日曆懸浮鈕新增一筆行事備註挑紫、一筆休假挑紅 → 存 → 月／週／日
  三個檢視顏色都對，**重新整理之後還在**（這是這一條的重點：以前重新整理就沒了）
- 瀏覽器：編輯一筆已經有顏色的，改成「跟著類別」→ 存 → 真的回到預設色
- 瀏覽器：休假挑了顏色，斜線紋還在（ADR-0040）
