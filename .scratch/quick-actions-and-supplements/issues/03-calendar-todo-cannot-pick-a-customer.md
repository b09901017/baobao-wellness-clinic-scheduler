# 日曆上新增待辦掛不了客戶

Status: todo
來源：使用者，2026-09-01（需求 A.3）
動工前先讀：`public/js/ui/components/note.js`、
`public/js/ui/views/calendar.js` 的 `mountNoteEditor()`、ADR-0044

## 原話

> 目前從日曆上新增 Todo（隨手記）時，沒辦法掛載（選擇）客戶，請加上選人的功能。

## 根因

`ui/components/note.js` 已經有三塊給四個入口共用：一列（`row`）、日期（`field`）、
**掛給誰（`who` / `readWho` / `wireWho`）**。

日曆的 `mountNoteEditor()` 只用了前兩塊。它甚至在程式碼裡把這件事寫成一個決定：

```js
// 掛的客戶不在這一頁改 —— 那是客戶詳情頁的事，而這裡改的是「哪一天」。
customerId: existing?.customerId ?? null,
```

那個決定站不住腳，理由有兩層：

1. **從客戶詳情根本掛不上去。** 隨手記除了勾掉之外沒有編輯入口，
   而日曆上這一張是**唯一**的編輯器（ADR-0044 的 Consequences 自己寫著這件事）。
   所以「那是客戶詳情頁的事」指向一個不存在的地方。
2. 日曆上新增一件待辦時她心裡想的常常就是「幫某某問一下」——
   跟右下角泡泡那一格一模一樣，而泡泡有這個欄位。

同一支元件在四個入口長得不一樣，正是 `CLAUDE.md` 連動表那一列在防的事。

## 要做什麼

`views/calendar.js` 的 `mountNoteEditor()`：

```js
      <span class="field__label">哪一天</span>
      ${note.field({ value: existing?.date ?? spec.date })}
      <span class="field__label">掛給誰</span>
      ${note.who({
        customerId: existing?.customerId ?? null,
        customerName: existing?.customerName ?? null,
      })}
```

接線：

```js
  note.wire(sheet.el);
  // 點開才讀客戶名單 —— 日曆是每天開十幾次的一頁，不要為了一個選填欄位
  // 多一次往返（`components/note.js` 的 `wireWho()` 檔頭）。
  note.wireWho(sheet.el, { load: () => customersData.list() });
```

送出時：

```js
    write({
      text,
      date: note.read(sheet.el),
      ...note.readWho(sheet.el),
    }, isNew ? '記下來了' : '改好了');
```

`[data-undate]`（「從日曆拿掉」）那一條也要跟著讀 `readWho()`，
不然清掉日期會順便把她剛掛的人清掉。

## 兩個坑

1. **`data/notes.js` 的 `update()` 走 `normalizePatch()`**，它對
   `customerId` / `customerName` 是**一組一起處理**的：帶了其中一個，
   另一個就會被算出來。`readWho()` 兩個都回，所以是對的 —— 但不要只帶一個。
2. **`wireWho()` 的清單是在抽屜的 `sheet.el` 底下委派的**，而
   `mountNoteEditor()` 用 `sheet.update()` 換內容。`update()` 換的是
   `[data-sheet-body]` 的 innerHTML，`sheet.el` 本身不會被換掉 ——
   所以**同一張抽屜上如果 mount 兩次編輯器就會掛兩組監聽**。
   現在的動線每次都開新抽屜或只 mount 一次，但要在
   `mountNoteEditor()` 上加一道跟 `openQuick()` 一樣的旗標：

```js
  if (!sheet.el.dataset.noteWired) {
    sheet.el.dataset.noteWired = '1';
    note.wireWho(sheet.el, { load: () => customersData.list() });
  }
```

（`note.wire()` 是 `wire(root)` 每次抓 `[data-notedate]` 重綁的，
它自己就防重複；`wireWho()` 不是。）

## 連動

- 這一件跟 issue 12（「給營養品」快捷鍵）在同一支 `mountNoteEditor()` 上，
  **07 與 12 動的是同一段程式碼**，做的時候要一起看。
- `SPEC.md` 第 8.6 節「日曆上新增待辦」那一段要補上「可以掛人」。

## 不做

- 不做「掛給誰」的搜尋框。`wireWho()` 現在就是一排丸子，她二十幾位客戶，
  跟其他三個入口保持一模一樣。要改就四個地方一起改。

## 驗證

- 瀏覽器：日曆 → 點一天 → ＋ → 新增待辦 → 打字 → 「掛給誰」→ 選一位 → 記下來
  → 那一天的抽屜列出那一筆，右邊有客戶名字的小丸
- 瀏覽器：那一筆在 `#/todo/notes` 與客戶詳情的隨手記那一段也看得到
- 瀏覽器：改一筆已經掛人的待辦，只改日期 → 掛的人不會被清掉
- 瀏覽器：按「從日曆拿掉」→ 日期沒了，掛的人還在
- `npm test` 全綠
