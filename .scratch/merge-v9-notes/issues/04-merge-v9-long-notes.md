# 合併檔 v9：客戶的長備註

Status: done
Blocked by: 02（03、04 都改 `planForCustomer()` 與摘要卡，一支一支做）
動工前先讀：`domain/mergeImport.js` 的 `planForCustomer()`（`customer` 那一塊）、`marksOf()`、`chartNoFieldOf()`；`domain/customerNotes.js` 的 `readLongNotes()`、`newLongNoteId()`、`validateLongNotes()`、`MAX_LONG_NOTES`、`MAX_LONG_TITLE`、`MAX_LONG_BODY`；ADR-0156；`firestore.rules` 客戶的 `longNotes`（R14.3）

## 她要的

> 通常我試算表，A B 底下放的都是這個客戶的整體備註 … 如果有你判斷是長備註，也可以幫我變成長備註

## 為什麼會這樣

v8 只有 `marks`（短備註，一則 40 字、一位 12 則）。舊表 A 欄一大段的（家庭、病史、一整串營養諮詢的筆記）現在被 `marksFrom()` 照句子切成好幾則短的，
一位就會超過 12 則，而且切開的句子讀不懂。長備註存在客戶身上（`customer.longNotes`，ADR-0156）。

## 做法

- 客戶多一格選填的 `longNotes: [{ title, body }]`：形狀、上限照 `validateLongNotes()`（標題 40、內文 5000、最多 20 則）；不對整份拒收。
  `validateLongNotes()` 要每一則都有 id（過目），檔案裡沒有 —— 先補暫時的 id 再驗
- `planForCustomer()`：每一則給一個 `newLongNoteId()` 的 id，寫進 `customer.longNotes`；**不寫 `noteOrder`**（照預設排，issue 01）
- 摘要卡：「N 位帶長備註、共 N 則」

## 判準

- v8 的檔案匯出來沒有 `longNotes` 這一格（跟以前一樣），`readLongNotes()` 回 `[]`
- v9 帶兩則 → `customer.longNotes` 兩則、id 不一樣、`noteItems()` 排在短備註前面
- 標題 41 字、或 21 則 → `validateFile()` 拒收

## 做完時留下的（2026-10-20）

- `validateFile()`：形狀（陣列、`title` 是字串、`body` 是字串或沒有）不對講一句；形狀對的補暫時 id 交 `validateLongNotes()`
- `longNotesOf()`：每一則 `newLongNoteId()`（同一位裡重複就再抽）、標題只去頭尾空白（同 `withLongNote()`）；空清單當沒寫、連鍵都沒有
- 摘要卡「N 位帶長備註，一共 N 則」（`longNoteCustomers`、`longNotes`）；確認框沒有加
