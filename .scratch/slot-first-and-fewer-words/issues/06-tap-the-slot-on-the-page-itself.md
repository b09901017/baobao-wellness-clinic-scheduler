# 06 進度追蹤與客戶詳情：畫面上就分得出段來點

Status: todo
動工前先讀：`.scratch/slot-first-and-fewer-words/spec.md`、`docs/adr/0080`、`docs/adr/0056`

## 她要的

> a 盡量能讓使用者一開始分段點就分段點，
> 例如"看這個月進度"那邊，或是客戶詳情那邊，希望不要點進去就是一整天的，而是可以直接從畫面分時段點，額不是點下去就是一整天

## 為什麼會這樣

那兩頁**一列就是一天**。`ui/views/progress.js` 的 `progressDayHtml()`：

```js
<button class="progday" type="button" data-visit="${day.visitId}">
  <span class="progday__head">…日期…</span>
  ${day.slots.map(slotHtml).join('')}     // 每一段是 <span>
</button>
```

整天是一顆大按鈕，每一段只是它裡面的一塊 `<span>` —— 點哪裡都一樣，
而且 button 裡面不能再放 button（內容模型只收 phrasing content，
ADR-0088 的最後一條為同一件事付過帳）。

**這一支同時修好兩頁**：`ui/views/customerDetail.js` import 的就是同一支
`progressDayHtml()`（那是 `customer-detail-rework/issues/02` 刻意共用的 ——
「同一件事畫成兩種樣子會讓她以為是兩份資料」）。

待辦中心不在這一支裡：那一頁點的是**人名**或任務列的「詳情」，而任務綁的是
一整天（掛號是一天去一次），本來就沒有「哪一段」可以帶 —— 它靠 04 那張目錄卡。

## 怎麼做

1. 外層那顆 button 變成 `<div class="progday">`，**每一段自己是一顆
   `<button data-visit="<id>" data-slot="<第幾段>">`**
2. 日期那一列不再點得下去（它是抬頭不是選項）
3. 三個接線的地方（`progress.js` 的 `wire()`、`customerDetail.js` 的委派
   與那張抽屜裡的那一份）改成把 `data-slot` 帶進 `openVisitCard()`
4. `public/css/app.css` 的 `.progday` / `.progslot`：按鈕的那幾條樣式
   （觸控區、按下去的回饋）從外層搬到每一段身上。
   **`.progslot` 要 `position: relative`** —— 撐開觸控區的那一層要貼在自己身上
   （CLAUDE.md 那條；`.slothead__x` 蓋到隔壁那一顆就是這個坑）
5. `public/sw.js` 的 `VERSION` 加一（動到 `app.css`）

那一天只有一段時，「點那一段」與「點那一天」是同一件事 —— 不用特別處理。

## 判準

- 客戶 → 看這個月進度 → **直接點那一天裡的第二段** → 浮出來的卡片只有第二段，
  副標是第二段的狀態
- 客戶詳情的「這個月」那一塊同樣（同一支）
- 兩顆並排的段之間點不到隔壁那一顆（觸控區不重疊）
- 那兩頁**還是沒有鉛筆**（ADR-0056）
- 先寫失敗測試：一筆兩段，斷言那一列的 `data-slot` 帶得出第幾段
