# 從日曆改一件已經勾掉的待辦，會把它變回沒做

Status: done
來源：全庫掃描，2026-08-25（`../spec.md`）
動工前先讀：`docs/adr/0044`、`CONTEXT.md` 的「隨手記」

## 症狀

日曆上一件**已經勾掉**的待辦（畫成刪除線的那些）→ 點它 → 鉛筆 →
改一個字或換一天 → 存起來：

- 那一件**變回未完成**：刪除線不見了、`#/todo/notes` 從「已完成」跳回
  「未完成」、待辦首頁那個數字多一
- 而 `doneAt` 還留著上次勾掉的時間，於是資料上是 `done: false` 配一個
  `doneAt: '2026-08-21'` —— 兩個欄位從此對不起來

「從日曆拿掉」那顆同一個問題。

## 原因

`ui/views/calendar.js` 的 `mountNoteEditor()` 只送四個欄位（那一頁只問
「記什麼」與「哪一天」，掛客戶是客戶詳情頁的事，這是對的）；
而 `data/notes.js` 的 `update()` 把 `changes` 整份餵進 `domain/notes.js`
的 `normalize()`：

```js
export function update(id, changes) {
  return repo.update(PATH, id, normalize(changes));   // ← 這裡
}
```

`normalize()` 吃的是**一份完整的隨手記**，沒帶到的欄位一律算成空的，
所以 `done` 被算成 `false`。

**成因不是有人忘了帶一個欄位**，是「完整的文件」與「只有變了的那幾欄」
用了同一支函式。`data/events.js` 的 `update()` 有一模一樣的形狀，
今天沒炸只是因為它的唯一呼叫端剛好每次都給完整的 draft（見 issue 08）。

## 做了什麼

`domain/notes.js` 多一支 `normalizePatch(changes)`：**只整理 `changes` 裡
真的出現過的鍵**。`customerId` 與 `customerName` 仍然當一組處理（掛了人就要
有名字，拿掉人兩個一起清）。`data/notes.js` 的 `update()` 改走它，`create()`
照舊走 `normalize()`。

規則放在 domain 而不是在畫面上補那一個欄位 —— 那樣下一個編輯器還是會踩。

## 驗證

- `npm test`（`tests/notes.test.js` 新增四支：沒帶到的欄位一個都不動、
  帶到的照 `normalize` 的規矩整理、客戶那兩欄是一組的、什麼都沒帶就什麼都不寫）
- 瀏覽器：日曆 → 找一天上面有一件**已經勾掉**的待辦 → 點它 → 鉛筆 →
  改字 → 存起來 → 那一件仍然是刪除線，`#/todo/notes` 仍然在「已完成」那一格
