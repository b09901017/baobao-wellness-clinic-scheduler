# 03 SOP 只出現她點的那一段的

Status: todo
動工前先讀：`.scratch/slot-first-and-fewer-words/spec.md`、`docs/adr/0080`、`docs/adr/0076`

## 她要的

> d 我發現SOP來是呈現一整天的，就是我點這一項，應該只需要出現這一項的SOP，不需要出現一整天的所有有關連到的SOP

談定的（2026-09-12）：掛**合作機構**的那幾份（例：自然美）**也一起收掉**。

## 為什麼會這樣

`domain/playbook.js` 的 `playbooksFor()` 從頭到尾沒有收過「哪一段」：

```js
const courseIds = new Set((visit?.slots ?? []).map((s) => s?.courseId).filter(Boolean));
```

它吃的是**整筆來訪的每一段**。所以一天有復能＋營養點滴兩段時，兩份 SOP 都會浮出來，
不管她點的是哪一段。

呼叫端在 `ui/views/calendar.js` 的 `openDetail()`：

```js
+ hintHtml({ playbooks: data.playbooks ?? [], visit, customer })
```

`visit` 是整筆，`focus`（她點的那一段）就在同一支函式裡，只是沒有傳下去。

ADR-0080 那條線（「讀取卡片畫她點的那一段」）2026-09-08 拉過一次，
但只拉到 `visitReadHtml()` 裡面 —— SOP 那一塊接在**外面**（ADR-0088），漏掉了。

## 怎麼做

`playbooksFor()` 多收一個選填的 `focusSlot`：

- 帶了 → 只比**那一段**的 `courseId`，而且**不比合作機構**
- 沒帶 → 照舊（整筆的每一段 ＋ 合作機構）

沒帶那條退路要留著：`hintForVisits()`（待辦的「跟客人確認時間」）走的是一位客戶
好幾天，那一頁不動（見 spec 的「這一輪不做的事」）。

**指到一個不存在的段落退回整筆** —— 同 `slotsToShow()` 的兩條退路。

## 判準

- 一筆兩段（復能 ＋ 營養點滴）、兩份 SOP 各掛一個課程：
  在日曆點復能那一段，**只看得到復能那一份**
- 掛「自然美」的那一份在單段卡片上**不出現**
- 「跟客人確認時間」那一頁一個 px 都沒變
- 沒有東西可以畫的時候整塊不畫（不要留一個空殼）
- 先寫失敗測試：`tests/playbook.test.js`
