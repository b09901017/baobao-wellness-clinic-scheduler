# 記一句要推上試算表，畫在那一天那一列的下面

Status: done
來源：`../spec.md`（報告 §4.7）
動工前先讀：`docs/adr/0084`（那一句話屬於時段）、
`domain/sheetReport.js` 的 `SYNC_FORMAT`／`equipmentNotes`／`followupNotes`、
`sheets/readonly-report.gs` 的 `SUPPORTED_FORMAT`、CLAUDE.md 對 `SYNC_FORMAT` 的那一段

## 她要的

（報告 §4.7 問的是「家屬用本人的名額，app 沒有地方記『實際來的是誰』」）

> 這個如果寫在當天那一個時段的記一句可以嗎？⋯⋯希望是可以⋯⋯記在當天那一列的下面，
> 或是你覺得記在試算表的哪比較好都可以

她另外點頭接受兩個代價：**試算表要重貼 `.gs` 並重新部署**，
以及**以後每一句記一句都會上試算表**，不只家屬那一種。

## 做法

- `domain/sheetReport.js` 每張表多一份 `slotNotes`，形狀**照 `equipmentNotes` 抄**
  （`{rowIndex, label, cells}`）—— 那一份 2026-09-06 就是為了「像二返那些註記一樣，
  在當天的那一列下面」做的，同一個模子第二次用
- 讀那一句走 `domain/visits.js` 的 `slotNote(visit, slot)`（**唯一那一支**，
  舊資料退回整筆那一句的規則也在它裡面）
- **不塞進 `followupNotes`。** `.gs` 把那一份全部畫在同一列，同一個 `dateIndex`
  後面的會蓋掉前面的 —— `equipmentNotes` 當初分出來就是為了這個
- **取消掉的那一段不印**（那一場沒發生）
- `SYNC_FORMAT` 4 → **5**，`sheets/readonly-report.gs` 的 `SUPPORTED_FORMAT` 同步，
  `.gs` 那側多畫一列。`tests/sheet-script.test.js` 盯著兩邊
- 交付時**要她回 Google 試算表重新貼一次並重新部署** —— 不貼的話 app 照樣推、
  `.gs` 整包拒收，而畫面上看起來跟推好了一模一樣

## 判準

- **這一行會不會讓兩種註記互相蓋掉？**（一位客戶同一天做了健檢又做了四選一是會發生的）
- 一段有記一句 → 試算表那一列下面多一列，字在那一天的欄位裡
- 同一天兩段各記一句 → 兩列各自畫在自己那一列下面
- 沒有記一句的額度 → 那一列不畫（`equipmentNotes` 同一條）
- 取消掉的那一段不印
- 舊資料（整筆的 `visit.note` 還沒被搬過）也印得出來
- `SYNC_FORMAT` 與 `SUPPORTED_FORMAT` 兩邊都是 5
