# 「已完成」照勾掉的時間排，不照建立的時間

Status: done
來源：使用者，2026-09-05（spec.md 的第二）
動工前先讀：`SPEC.md` 第 8.1 節（995 行）、`domain/notes.js` 的 `sortNotes()`

## 原話

> 隨手記的看全部那邊的已完成，我希望由上到下的排序是我剛勾掉到我更之前勾掉的
> 排序，就是最上面的應該是我剛勾掉的，而不是這個 todo 日期最近的。

## 現在排的是什麼

`domain/notes.js`：

```js
export function sortNotes(notes) {
  return [...(notes ?? [])].filter(isLive).sort((a, b) => {
    if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
    return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
  });
}
```

兩組都照 `createdAt` 由新到舊。**沒勾的那一組這樣排是對的**（她記的順序就是
她想到的順序），勾掉的那一組不是 —— 一筆三天前記的事，她今天才處理掉，
它會排在一筆今天記、今天勾掉的下面。

她說的「這個 todo 日期最近的」不完全是程式在做的事（實際的鍵是 `createdAt`
不是 `date`），但看到的結果一樣：**跟「我剛做完什麼」無關的順序**。

## 這一筆資料早就在了

`doneAt` 從一開始就有。`data/notes.js`：

```js
export const create = (data) => repo.create(PATH, { ...normalize(data), doneAt: null });

export async function setDone(id, done) {
  const changes = { done, doneAt: done ? new Date().toISOString() : null };
  ...
}
```

`recordDelivery()` 也寫（給完了才寫，沒給完連 `done` 都不動）。
`normalizePatch()` 刻意不碰它 —— 那一支的檔頭寫著 2026-08-25 那次
「改一件已經勾掉的待辦會把它變回沒做，而 `doneAt` 還留著上次的時間」。

所以這一支不新增任何欄位、不動任何寫入，**只換一個排序鍵**。

## 任務那幾頁早就是這樣了

這不是一個新規矩，是隨手記沒跟上。`SPEC.md` 第 995 行講任務那幾頁：

> 「已完成」那一格照**完成那一天**分段（「今天」「8/24(日)」）

而 `data/tasks.js` 的 `listDone()` 就是 `order: ['doneAt', 'desc']`（配一支
`done + doneAt desc` 的複合索引）。**同一個問題在這個 app 裡已經有一個答案了**，
隨手記那一頁只是沒有讀它。

## 要做什麼

`sortNotes()` 的比較函式改成分兩段：

```js
export function sortNotes(notes) {
  return [...(notes ?? [])].filter(isLive).sort((a, b) => {
    if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
    // 勾掉的那一組問的是「我剛做完什麼」，沒勾的那一組問的是「我剛記了什麼」
    const key = (n) => (n.done ? (n.doneAt || n.createdAt) : n.createdAt);
    return String(key(b) ?? '').localeCompare(String(key(a) ?? ''));
  });
}
```

**`doneAt` 讀不出來就退回 `createdAt`，不要退回空字串。**
空字串在 desc 排序裡會沉到最底，於是舊資料（匯入的、手動改過的、
`domain/mergeImport.js` 那一批 `doneAt: null`）會全部黏在最下面**而且彼此之間
沒有順序**。退回 `createdAt` 至少讓它們落在一個看得懂的位置。

## 三個一起變的地方，兩個是對的、一個要看一眼

`sortNotes()` 有五個呼叫端：

| 呼叫端 | 受不受影響 |
|---|---|
| `#/todo/notes` 的「已完成」（`views/home.js` 的 `paintNotes`） | **這一支要修的就是它** |
| `#/todo/notes` 的「未完成」 | 不受影響（那一組的鍵沒變） |
| 首頁那張卡（`notesCard`） | 不受影響 —— 它讀 `listOpen()`，一筆勾掉的都沒有 |
| `groupByCustomer()`（首頁「依客戶」、客戶詳情） | 每一組裡勾掉的那幾筆跟著改，**是對的**（同一個問題同一個答案） |
| `openFor()` | 不受影響（`filter(!n.done)`） |

`customerDetail.js:1035` 的 `sortNotes(notes)` 是那一頁的隨手記清單，含勾掉的
—— 跟著改，也是對的。

## 不做的

- **不分段。** 任務那幾頁的「已完成」照完成那一天分段（「今天」「8/24(日)」），
  隨手記那一頁沒有。她要的是排序不是分段，多一層抬頭是這一輪沒有人要的東西。
- **不動 `listAll()` 的查詢。** 它照 `createdAt desc` 撈回全部，排序在畫面這一側
  做 —— 換成 `doneAt desc` 會要一支新索引，而且未完成那一組的 `doneAt` 全是 null。
- **不動 `datedIn()`。** 日曆上那一類照日期排，跟「什麼時候勾的」無關。

## 驗證

**手動**：
1. `#/todo/notes` →「未完成」勾掉一筆**很久以前記的**
2. 再勾掉一筆**今天剛記的**
3. 切到「已完成」→ **最上面是第 2 筆**（剛剛勾的），第 1 筆在它下面
4. 把第 1 筆「拿回來」再勾一次 → 它跳到最上面
5. 「未完成」那一格的順序一個字都沒變

**自動**：`tests/notes.test.js`（見 `04`）。
