# 併進已確認那一天：原本談定的段不動，只有新的這一段待確認

Status: done
來源：`../spec.md` 第四 1、Q6
PR：3（`claude/asks-0924e-abovee`）
動工前先讀：ADR-0070、ADR-0081、ADR-0097、ADR-0104 第 2 點、`domain/visits.js` 的 `withExtraSlot()`／`pendingSlotsOf()`、
`domain/consequences.js` 的 `bookingConsequences()`、`ui/views/schedule.js` 的 `addNote()`、`ui/components/aboveeConfirm.js` 的 `save()`

## 她要的

> 6. 好（「整天退回待確認」改成「原本談定的段不動，新的這一段待確認」）

## 為什麼會這樣

`withExtraSlot()` 併進一筆已確認的來訪時，**先把既有每一段的狀態落下來**（ADR-0081），新那一段是待確認，
整筆那個 `status` 推出來是待確認。畫面上看到的是每一段自己的狀態（`statusForCard()`，ADR-0085），
確認抽屜也只問還沒問過的段（`pendingSlotsOf()`）。所以她看到的是：原本那幾段還是已確認，只有新的那一段待確認。

但三個地方的字講的是整筆：
- `consequences.js` 的 `bookingConsequences()`：「那一天本來是『已確認』，會退回『待確認』」（壓表、日曆新增共用）
- `schedule.js` 的 `addNote()`：「那一天會退回『等客戶回覆』」
- `aboveeConfirm.js`：「那一天已經確認過，併進去之後整天退回待確認」（07 會搬進 `consequences.js`）

ADR-0104 第 2 點寫的是當時的說法；決定本身（要講出來）不變，只是講法要跟 ADR-0081 之後的事實一致 —— 不另開 ADR。

## 談定的做法

一句話，三個地方共用：「那一天原本談定的段不動，新的這一段是『待確認』—— 還沒問過客人」。
`describeStatus()` 取字，不寫死。

## 判準

- 壓表：在已確認的那一天加一段，確認框與「加這一筆」底下那一句都不講「退回」？
- 日曆新增：同上？
- 拍 Abovee：同上（07 之後）？
- 存完之後日曆那一天：原本那一段還是已確認、新那一段待確認 —— 跟剛剛講的一樣？

## 做完時留下的

- PR 3（`claude/asks-0924e-abovee`）的 `c267ff1`。`consequences.js` 的 `settledDayLine()`；`bookingConsequences()` 與 `schedule.js` 的 `addNote()` 讀它。
- `consequences.js` 不再用 `describeStatus()`，import 拿掉。
