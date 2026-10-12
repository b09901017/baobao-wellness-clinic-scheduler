# 試算表：二返註記只在健檢 ✓ 那一欄、器材那一列不印取消的段

Status: done
來源：`../spec.md` 二c、二e、Q3
PR：2（`claude/asks-0924e-sheet`）
動工前先讀：ADR-0112、ADR-0026、`domain/sheetReport.js` 的 `followupNotes()`／`usedOn()`／`examOn()`／`bookingsOf()`／`equipmentCells()`、
`domain/followups.js` 的 `usedAndDone()`／`holdsExam()`

## 她要的

> c我發現有時候會沒有打勾二返的地方，下面註記二返()，我在猜是不是二返取消了但是這個沒消到?以及是不是其他的像是sis in il等等的也會有這個問題? 取消了但沒更新到?我猜的，請幫我排查

> e可以幫我檢查一下經過pr129-131 有沒有甚麼是那邊動到的會牽連試算表這邊的，需要更新，如果沒有就說沒有不用硬找

> 3. 好，照你的建議 : 跟舊表和 app 的「約二返」同一個時機

## 為什麼會這樣（重現過）

不是「沒更新到」—— 試算表每次推都是整張重畫。是挑欄位的規則：

- `followupNotes()` 挑「哪一欄是健檢」走 `usedOn()`：那一天有沒有**任何一段**用到健檢額度，不看那一段的狀態。
  健檢那一段取消了、同一天 SIS 做了 → 那一欄存在、健檢那一格空的、底下照印 `二返()`。
  ○／△（還沒做的健檢）底下也印。PR #130 的 06（ADR-0112）只改了另一半（`bookingsByExam()` 走 `holdsExam()`）。
- 照位置猜的退路 `bookingsOf()` 只看「沒連結」，不看那一場二返取消了沒 —— 舊資料上一場取消的二返會被猜成約好了。
- `equipmentCells()` 不濾取消的段：9/12 SIS 取消、INDIBA 做了，印「SIS、IND」。
- `slotNoteCells()` 本來就濾（`isLiveSlot()`），不用動。

重現：`syncBundle()` 餵一天「健檢 cancelled ＋ SIS done」、另一天「SIS cancelled ＋ INDIBA done」 →
`followupNotes = [{dateIndex:0, text:'二返()'}]`、`equipmentNotes` 第二天是 `SIS、IND`。

## 談定的做法

- 健檢那一欄＝**那一天用這筆健檢額度的那一段做完了**（`usedAndDone()`，跟 app 的「約二返」同一個時機）。
  取消、未到、還沒做的那一天底下什麼都不印。`examOn()` 同樣只認做完的那一筆。
- `bookingsOf()` 的退路也只猜佔著的那幾場（`holdsExam()`）。
- `equipmentCells()` 不收取消的段（`slotStatus()` 是 cancelled 的）。未到的照印 —— 那一格是 ✗，印哪一台是有用的。
- 規則一條都不在 `sheetReport.js` 另寫：借 `usedAndDone()`、`holdsExam()`、`slotStatus()`。
- 手動貼上那條路（`customerReport()`）共用同一組函式，自動跟著對。

## 判準

- 健檢那一段取消、同一天別段做了：那一欄底下**沒有** `二返()`？
- 健檢 ✓、二返取消了：照樣印 `二返()`（還沒約，ADR-0112）？
- 健檢還是 △（下週才做）：底下沒有 `二返()`？
- 未到的健檢（✗）：底下沒有 `二返()`？
- SIS 取消、INDIBA 做了：器材那一列只印 `IND`？
- 未到的那一段：器材照印？

## e 的答案

#129–#131 牽連到試算表的**只有這一條**。待辦區（`taskLine()` 的 `what`）、同名分頁（#129 06）、推送補推（#129 05）、
改名都已經跟上了。

## 做完時留下的

- PR 2（`claude/asks-0924e-sheet`）的 `4b799a3`。`usedOn()` 拿掉，`examOn()` 改問 `usedAndDone()`；`bookingsOf()` 的 `mine()` 多一條 `holdsExam()`
  （醫師那一格也只從佔著的那幾場找）；`equipmentCells()` 跳過 `slotStatus()` 是 cancelled 的。
- 「連結指到一次取消的健檢」那一場二返：現在哪一欄底下都不印。那是資料有問題（#131 起新的連結存不進去），不在報表上展開。
