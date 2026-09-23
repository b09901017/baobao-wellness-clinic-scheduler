# 日曆編輯器按取消，重開的那一天抽屜是新的資料

Status: done
來源：`../spec.md`（第二輪）、10 的延伸
動工前先讀：`issues/10`、`ui/views/calendar.js` 的 `openDay()`（`refresh()`）與掛編輯器的那一段（`onCancel`）

## 她要的

10 的判準：「按了復原之後，長按同一段選單上**有**『客戶說可以』」、「復原之後她停在同一天」。

## 現在壞在哪

`calendar.js:1726`：編輯器的 `onCancel` 是 `closeSheet(); if (backDate) openDay(el, data, backDate);`，
`data` 是**掛上編輯器那一刻**的那一份。10 讓 `render()` 在抽屜被編輯器接走時只換 `openDay` 閉包裡的 `data`、不重畫 ——
但按取消時重開的抽屜不讀那一份，讀的是編輯器自己手上的舊的。

情境：長按一段 → 客戶說可以 → 點同一天另一段 → 鉛筆（編輯器開著）→ toast 上按「復原」→ 編輯器按取消 →
抽屜上那一段還是「已確認」，長按沒有「客戶說可以」。

## 做法（方向）

`openDay(el, state.data ?? data, backDate)`。同一支檔案裡其他「收掉之後把同一天開回來」的地方一起看一遍（`rg "openDay\(el, data"`）。

## 判準

- 上面那個情境：取消之後長按那一段，選單上有「客戶說可以」
- E2E 44 補一條（S4 的延伸）

## 做了什麼（2026-09-23）

`mountEditor()` 的 `onCancel` 改成 `openDay(el, state.data ?? data, backDate)`。同一支檔案裡其他把同一天開回來的地方
（`refreshAfterAction()`、點一天）本來就讀新的那一份；隨手記編輯器取消時不重開抽屜，沒有這個問題。

測試：E2E `44` 的 S4b。第一版沒等復原之後那一趟重讀就按取消，重讀晚到、剛好替重開的抽屜補上新資料，
測試假綠 —— 所以按取消之前先 `app.settled()`。
