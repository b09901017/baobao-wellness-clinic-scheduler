# 點一顆丸子整頁重畫：閃一下，而且捲回最上面

Status: done
回報者：使用者，2026-08-22

## 症狀

> 每當我點選一個東西，做什麼／器材／治療師等等，他就會像重新整理一樣，
> 閃一下並且回到最上面，這讓我很困擾，一點都不沉浸絲滑

## 根因

`public/js/ui/views/schedule.js` 的每一個事件處理器最後都呼叫 `paint(ctx)`，
而 `paint()` 是 `el.innerHTML = ...` 整頁重寫。一次點擊付三筆代價：

- `.deck` 節點重建 → `app.css` 的 `deck-in` 淡入動畫重播＝那個「閃一下」
- `.deck__card` 是 `overflow-y: auto` → 自己的 `scrollTop` 歸零＝那個「回到最上面」
- `.deck__track` 重建 → `scrollLeft` 歸零，所以 ADR-0017 才需要 `centerDeck()` 復位

她記一位客戶要點五到六下，一批二十幾位。

## 做了什麼

- 事件改成**委派**在 `[data-page]` 與 `[data-deck]` 兩個容器上，
  任何一塊重畫之後都不必重新掛監聽
- `ctx` 從 closure 搬到模組層，處理器永遠讀到當下那一份
- 選時間／器材／治療師／診間 → 只改 `aria-pressed`
- 換課程 → 只換 `[data-entfields]`（備註欄刻意留在外面，打到一半的字不會不見）
- 換日子 → 小日曆只改哪一格被選中，只換 `[data-daypanel]`
- 存好一筆 → 重讀資料，只換那張卡的內容，`scrollTop` 自己接回去
- 換人 → 只換那兩張卡（舊的變 peek、新的展開），軌道不重畫，捲動位置留著

決定與理由：[ADR-0038](../../../docs/adr/0038-picking-an-option-does-not-repaint-the-page.md)

## 驗收

用一次性的瀏覽器煙霧測試（假資料層 + 真的 `schedule.js`）確認：
挑日子與換課程之後 `.deck` 與 `.deck__card` 是**同一個節點**、
`scrollTop`（220 → 222）與 `scrollLeft` 不變、選時間完全不動。
那份測試沒有留在版控裡 —— 它需要瀏覽器，而這個專案刻意沒有相依套件。
