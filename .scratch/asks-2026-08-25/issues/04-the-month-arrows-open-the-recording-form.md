# 客戶詳情的換月份箭頭會跳到「記一次」

Status: todo
來源：她的十二件事，2026-08-25（`../spec.md`）
動工前先讀：`docs/adr/0038`、`docs/adr/0048`

## 症狀

她的原話：「客戶詳情 8月 → 沒有排 `<>` 的那個切換月份的按鈕不是連到錯的地方，
理論上它應該要在同一個頁面同一個區塊，顯示不同月份的預約情況？怎麼變成了
『記一次』？？？」

**要先做過一件事才重現得出來**：客戶詳情 → 不能的時間 → 記一次 → 返回 →
再按「8月」旁邊的 `<` 或 `>`。整頁會變成「記一次」那張表。

第一次進客戶詳情按箭頭是好的，所以看起來像隨機發生。

## 原因

`ui/views/availability.js` 的 `wireForm()` 把一個**委派的 click 監聽掛在
`ctx.el` 上**（整頁的 root），而那個 root 在離開「記一次」之後不會被換掉：

```js
formEvents?.abort();
formEvents = new AbortController();
el.addEventListener('click', (e) => {
  const next = steppedMonth(e.target, state.month, addMonths);
  if (next) { paintForm(ctx, record, {…}); return; }   // ← 這裡
  …
}, { signal: formEvents.signal });
```

`formEvents` **只有 `paintForm()` 自己再跑一次時才會被 abort**。
`customerDetail.js` 的 `render()` 抓的是另外兩支：

```js
detailEvents?.abort();
entEvents?.abort();
// formEvents 沒有人叫得動它
```

所以離開「記一次」之後那顆監聽還活著，而客戶詳情的「這個月」那一塊也用
`monthNav()`（同一個 `data-month-step`，`components/monthnav.js` 刻意共用長相
不共用行為）。按下去兩個處理器都跑：`customerDetail` 先把那一塊換成新的月份，
`availability` 接著把整頁換成「記一次」——後者贏，因為它換的是整頁。

`entEvents` 是同一種形狀，今天沒炸只是因為它找的 `[data-chip="buy"]` 與
`[data-qty]` 在客戶詳情上不存在。

## 為什麼不是「客戶詳情也 abort 一下就好」

那是把「誰要記得清誰」再多寫一次，而這個 repo 已經修過三次「監聽越掛越多」。
真正的修法是**讓那顆監聽掛在會被換掉的東西上**：`paintForm()` 換的是
`el.innerHTML`，所以掛在 `el` 的第一個子節點（那一頁自己的容器）上，
innerHTML 一換它就跟著死了，不需要任何人記得。

## 做了什麼

- `ui/views/availability.js`：`paintForm()` 把整頁包進一個 `<div data-availform>`，
  `wireForm()` 改成把委派監聽掛在那一個容器上。`formEvents` 整個拿掉 ——
  它現在沒有東西要中止。
- `ui/views/customerDetail.js`：`paintEntitlement()` 同一招（包一層
  `<div data-entform>`），`entEvents` 拿掉。`paint()` 自己那一顆留著用
  `detailEvents`：它掛的容器就是 `el`，而 `paint()` 每次都會 abort 它。
- `tests/module-names.test.js` 抓不到這一種（它不執行程式碼），所以多一支
  `tests/layering.test.js` 的守衛：**`/ui/views` 底下不可以把 `addEventListener`
  掛在 `el` 或 `ctx.el` 上**，除非同一支檔案裡有一個 AbortController 在
  `render()` 開頭被中止。

## 驗證

- `npm test`
- 瀏覽器：客戶詳情 → 不能的時間 → 記一次 → 返回 → 按「8月」旁邊的 `>` →
  那一塊變成 9 月的預約情況，**其餘的頁面一個字都沒有動**
- 同樣的路走一次加購：客戶詳情 → 額度 → 加購 → 取消 → 按月份箭頭 → 一樣正常
