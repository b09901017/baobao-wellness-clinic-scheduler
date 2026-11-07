# 新增行事備註那張表：三句小字全刪

Status: done
Blocked by: —
動工前先讀：`public/js/ui/views/eventEditor.js`（`:109-110` 休假／行事備註各一句、`:128`「跟開始不同就是跨天的…」）；
`tests/fewer-words.test.js` 的 `FIELD_HINT_KEEP`（`ui/views/eventEditor.js: 3`）

## 她要的

「新增行事備註那個表單，上面寫到"休假那幾天壓表的小日曆....你人不在，"排了也是白排。....." 寫錯了，就直接刪掉這行字，然後點行事備註也呈現的那行字"行事備註只是那時候有事...."也不要了，不要有任何小字」
第三句要不要一起刪：「要」

## 為什麼會這樣

三句 `<p|span class="field__hint">`。`fewer-words` 准它留 3 句，理由是「兩句都會改變她挑哪一個」—— 她說不要，照她的。

## 做法

三句刪掉；`FIELD_HINT_KEEP` 那一列拿掉（那支測試只准往下）。**三顆 `?`（標題、顏色、刪掉）留著**（spec 談定的：點了才出來，不是畫面上的小字）。
她說第一句「寫錯了」：過目 11/5 查過，壓表小日曆在休假那幾天**真的會劃掉**（`schedule.js` 約 `:1199-1206`、`app.css` `.minical__cell--away`：斜線＋刪除線），
但照樣點得下去 —— 所以「排了也是白排」那半句不準，不是 bug。刪掉就好，不用另外修。
`fewer-words.test.js` 約 `:125` 檢查的是標題那顆 `?` 的字，留著。

## 判準

- 新增行事備註、切到休假、切回行事備註、勾整天、改結束日 → 畫面上還有沒有任何一句 `field__hint`？（不可以）
- `grep` 那三句的字，`public/` 底下還有沒有？（不可以；`domain/events.js:202` 的註解不算）

## 做完時留下的

- `eventEditor.js` 三句 `field__hint` 全刪（「休假那幾天壓表的小日曆…」「行事備註只是那個時段有事…」「跟開始不同就是跨天的…」）；
  標題、顏色、刪掉那三顆 `?` 留著。`grep` 那三句的字：`public/` 底下只剩 `domain/events.js` 與 `schedule.js` 的註解；`docs/` 沒有
- `tests/fewer-words.test.js` 的 `FIELD_HINT_KEEP` 拿掉 `eventEditor.js` 那一列（改成一行註解講為什麼是 0）—— 先拿掉、跑過紅（「這幾支自己手寫了欄位說明」），刪完綠
- verify：`npm test` 只有 07 還沒 commit 的 ADR 與測試紅（索引、`event-colour-swatches`，屬於 07）；E2E 照 `pick()`（`eventEditor.js`、`sw.js`）挑 `00 08 10 18 81` 直接跑，42 個全過
- `sw.js` v237
