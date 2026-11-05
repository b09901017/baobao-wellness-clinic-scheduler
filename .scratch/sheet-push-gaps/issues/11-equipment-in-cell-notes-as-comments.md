# 11 器材併進那一格、記一句改成那一格的備註

Status: todo
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

（做完填）
