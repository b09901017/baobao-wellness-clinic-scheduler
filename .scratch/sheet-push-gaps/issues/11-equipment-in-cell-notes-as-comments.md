# 11 器材併進那一格、記一句改成那一格的備註

Status: done
Blocked by: 10（同一圈矩陣）

## 動工前先讀

- `sheets/readonly-report.gs`：`renderCustomer()` 的矩陣那一圈（`equipmentNoteAt()`、`noteRowAt()`、`noteLine()` 夾在額度列底下的那兩種註記列）、`Canvas`／`paint()`（草稿紙要多一種「備註」）
- `public/js/domain/sheetReport.js` 的 `equipmentCells()`（只有得選的擇一池才有、寫的是器材別稱）、`slotNoteCells()`（記一句）—— **不改**
- `tests/helpers/appsScriptStub.js`（替身要記得住每一格的備註，`setNote`／`setNotes`）

## 她要的

> 第六 : 如圖5 我會覺得有點資訊疲勞，認知過載，但也說不上來哪裡可以改，看你除了以上幾點，還有什麼建議，希望可以簡單，易懂，好看

主控建議（示意圖 6a、6b），她：「照示意圖做」。

## 做法

- **器材**：那一格的字從「✓」變成「✓ IN」（狀態符號＋空一格＋器材別稱；`✓2` 那種照樣接：「✓2 SIS」），不再多一列。那一格的底色照符號（`colourForMark()` 看開頭，照舊）
- **記一句**：寫進那一格的**備註**（Google 試算表的 note：右上角小黑三角，點一下／滑過看得到；一次 `setNotes()`），不再多一列。那一格同時有器材也一樣（字是「✓ SIS」、備註是記一句）
- 器材與記一句都在 `.gs` 併：資料（`equipmentNotes`／`slotNotes` 的 `rowIndex`＋`dateIndex`）不變、`syncBundle()` 不改
- 器材或記一句落在表外（`dateIndex` 超過日期欄，`noteLine()` 現在會丟掉）照舊丟掉
- 沒有額度的段（n返、送的／體驗）的記一句照舊在「來訪紀錄」那一行（格式 7，那一條路不動）

## 判準

- 擇一池那一列的每一格是「✓ IN」這種、底色照符號嗎？器材那一列、記一句那一列不見了嗎？
- 記一句在那一格的備註裡、全文、換行照留嗎？同一格又有器材又有記一句時兩樣都在嗎？
- 月底對帳讀的是 `syncBundle()` 的 `marks`（資料），不是試算表的字 —— 照舊綠嗎？

## 做完時留下的

- `renderCustomer()` 的矩陣一筆額度只畫一列：器材走 `cellsByDate()` ＋ `markWithEquipment()`（「✓ IN」「✓2 SIS」；沒有器材照舊只有符號、只有器材沒有符號就只寫器材 —— 照 `equipmentCells()` 的算法不會發生）；
  **底色看原本的符號**（`r.marks`），不是併過的字。記一句走 `cellsByDate()` → 那一格 `setNote()`。落在表外的照舊丟掉（`cellsByDate()` 只收日期欄以內的）。`noteLine()` 拿掉了
- 草稿紙多記 `notes`（`setNote`），`paint()` 寫完值之後一次 `setNotes()`（框住有備註的那一塊，其餘 ''）
- **`resetSheet()` 多一次 `sheet.clearNotes()`**：`clear()` 清的是內容與格式，備註不在裡面（替身照這樣做）—— 不清的話，記一句搬了位置（她改了那一段的日子、或排序換了列），舊的那一格會留著那一句
- 替身：`setNote`／`setNotes`／`clearNotes`、`noteAt()`、快照多 `notes`；`clear()` 不清備註
- 測試：`tests/sheet-layout.test.js` 的「11」那一組；`sheet-script` 格式 7 那幾條的 `everything()` 連備註一起看（「只印一次」照舊成立：在額度那一格的備註裡）；
  `sheet-gs-fonts-timing` 器材那一列 9 號那一條換成「併進那一格」；`sheet-gs-batch` 整份重畫的上限一頁 50 → 60（第三輪一頁多幾次固定的寫：凍結欄、粗線、格線、清備註、寫備註、文字格式、折行的列加高）
- 正式站那一包（只印數字）：19 筆額度有器材（98 格）、21 筆有記一句（23 格）；`scripts/sheet-gs-compare.mjs` 跟 10 的 `.gs` 比：備註 23（＝那 23 格）、
  其餘是矩陣少了約 40 列註記列之後下面整塊往上搬（值、格式、合併、框線、列高的格數）；`scripts/sheet-gs-calls.mjs` 整份重畫 寫 1,363（develop）→ 1,611
- 月底對帳讀 `syncBundle()` 的 `marks`，不經過 `.gs`（`tests/month-end-reconciliation.test.js` 照舊綠）
- **只在 staging 驗得到**：Google 的 `clearNotes()` 真的清掉整頁的備註、`setNotes()` 寫 '' 不會留空的備註；備註裡的換行照顯示；手機的 Google 試算表 app 點一下看得到備註（桌機是滑過）
