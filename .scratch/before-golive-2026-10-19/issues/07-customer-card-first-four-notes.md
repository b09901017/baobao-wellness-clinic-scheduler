# 客戶清單的卡片：備註那一段照她排的順序，前四個

Status: done
段：二（high）
Blocked by: 04、05（病歷號那一種要畫得出來、icon 要在）
動工前先讀：`ui/views/customers.js` 的 `card()`（現在是 `marksUi.row(marks, { max: 3, clip: true })`，只有短備註、最多 3 則）；`domain/customerNotes.js` 的 `noteItems()`；`ui/components/marks.js` 的 `row()`、`notesRow()`、`noteChip()`；`docs/adr/0156`（第 37 行：「它們照舊只看到短備註」—— 列了試算表、壓表卡片牆、讀取卡片）；`CLAUDE.md`「備註那一段的順序、長備註」那一列（`marks` 二十幾處讀它的名單，客戶清單卡片是其中一個）、「一顆小圖示按鈕的觸控區」

## 她要的

> 7. 補充 : 我希望客戶那頁客戶呈現的備註就是前四個就好，包含line 電話 病歷號，長備註等等，不一定只能用短備註，就是我調好順序後的前四個可以呈現在客戶那面

## 為什麼會這樣

`card()` 讀 `readMarks(c)`（只有短備註）畫最多 3 則。長備註、電話、LINE 是段七（ADR-0156）才有的，那時刻意讓 `marks` 的每一個讀者照舊只看短備註。

## 做法（方向）

1. 卡片改讀 `noteItems(c)`（她排的順序），取**前四個**，一個一行或照現在 `row()` 的排法，**截成一行加「…」**（`clip`，同現在）
2. **卡片本身是一個 `<a>`**：裡面不可以有 `<a>`／`<button>`（巢狀互動元素）—— 電話、LINE、長備註在卡片上是**只看的**（`<span>`），點卡片照舊進客戶詳情。所以要一支「只看」的畫法（例如 `noteChip(it, { static: true })`），不要拿詳情那一份接線過的
3. 長備註印標題＋那一顆 `note` icon（不印 `›`，因為點不開）；LINE 印「LINE」；電話印號碼；病歷號印 icon C＋號碼
4. 超過四個：要不要「還有 N 則」—— 照現在 `row({ max })` 有沒有那一句決定，一樣就好
5. **壓表卡片牆、試算表、讀取卡片不動**（她只講「客戶那頁」）

## 判準

- 這一行會不會讓卡片上的順序跟她在詳情頁排的不一樣？（同一支 `noteItems()`）
- 排過順序之後前四個是：病歷號、長備註、電話、短備註 → 卡片上就是這四個、這個順序
- 卡片裡 `querySelectorAll('a a, a button')` 是 0
- 一則很長的長備註標題／短備註：卡片截成一行、不撐寬（E2E `59` W8／W9 的量法：捲的是 `.app__main`）
- 壓表卡片牆照舊只畫短備註（E2E 量一次）

## 連動

- ADR：補一支（或寫進這一輪那一支）—— 推翻 ADR-0156「客戶清單卡片也只看短備註」那一半（舊的那一支不改）
- `CLAUDE.md`「備註那一段的順序、長備註」那一列：讀 `marks` 的名單拿掉客戶清單卡片、補「客戶清單卡片讀 `noteItems()` 前四個」

## 做完時留下的（10/19 段二）

- `customers.js` 的 `card()` 讀 `noteItems(c)`（`readMarks` 那一個 import 拿掉了），畫 `marksUi.notesPreview(notes, { max: 4 })`
- `marks.js` 的 `notesPreview()`／`previewChip()`：全部 `<span>`（短備註走原本的 `chip(…, { clip: true })`；電話、LINE、病歷號、長備註是 `.mark--clip.mark--static`＋小一號的 icon；
  長備註帶 `.mark--long` 的茶色、不畫 `›`）。超過四個照 `row()` 的「還有 N 則」。外層 `data-notes-preview`
- CSS：`.mark--static`（cursor 跟著卡片、可以選字）＋小一號 glyph（18px 框、13px 圖）
- E2E：77 C10（順序、`還有 2 則`、卡片裡 `a, button` 是 0、長的高度 < 34px、`.app__main` 不撐寬、點了進詳情）；74 N12 翻過來（長備註排最前面 → 卡片上看得到）
- 截圖看過（390px）
- 文件：ADR-0160 第五節（推翻 ADR-0156 那一半）、CLAUDE.md「備註那一段」那一列、SPEC 總覽那一行
