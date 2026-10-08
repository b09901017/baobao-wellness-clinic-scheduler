# 試算表上剩 −1（做的比買的多）不會變紅，剛好 0 才紅

Status: done
來源：`f-sheet-overuse`、`sheet/report.md` 第 7 條 (a)
動工前先讀：`sheets/readonly-report.gs:255-270`（上色那一段）、`tests/sheet-script.test.js`、`tests/sheet-rows-without-entitlement.test.js`、
`CLAUDE.md` 連動表「試算表的註記」（沒有額度的列「應有／剩餘」是一槓）與「試算表的 `SYNC_FORMAT`」
Blocked by: —
重現：`node .local/references/audit-2026-10-08/sheet/r07-gs-notes-and-overuse.mjs`（B 那兩行：−1 沒有底色、0 是 `#FFCDD2`）

## 她要的

> ・「上線前要先修」那 18 件，要怎麼出貨？ → 全部一起修完、一起上 staging，你點一次驗收清單

報告那一張卡：

> 試算表上剩 −1（做的比買的多）不會變紅，剛好 0 才紅
>
> 你最該注意的「超用」，在試算表上反而最不顯眼。

## 為什麼會這樣

上色的條件寫成「等於 0」。

## 要做的

改成「是數字而且小於等於 0」。

**一定要先問是不是數字。** 沒有額度的那幾列（n返、不算次數的課）「剩餘」那一格是一槓（字串）；
`CLAUDE.md` 那一列寫著「一槓是字串，`.gs` 上色問的是 `=== 0` 所以不用升格式 —— 哪天 `.gs` 要拿那兩格做算術就要回來看」。
現在就是那一天：JS 裡 `'' <= 0`、`null <= 0` 都是 true，`'—' <= 0` 是 false。

審查對過：那一行是 `readonly-report.gs:262` 的 `r.remaining === 0`；一槓是字串（`sheetReport.js:230`、`:326`）；合計那一列不在那個迴圈裡。
所以 `typeof r.remaining === 'number' && r.remaining <= 0` 就夠。**還寫著舊條件的兩處註解一起改**：`sheetReport.js:268-269`、`.gs:87` 的「剩餘 0」。

## 判準

- −1 紅嗎？0 還紅嗎？1 不紅嗎？
- 一槓那幾列紅不紅？空白格、合計那一列呢？（一槓與空白不可以紅；合計照現在的規則）
- `SUPPORTED_FORMAT` 有沒有動？（不用 —— app 送的形狀沒變）
- 她要不要重貼 `.gs`？（要，才看得到；上線那天本來就要重貼正式那一份。staging 那一份寫進 23 的驗收清單，請她重貼一次）

## 測試

`tests/sheet-script.test.js`：把 `.gs` 放進假的試算表環境跑（r07 的做法），量「剩餘」那一格的底色：−1、0、1、一槓、空白各一列。

## 文件

`CLAUDE.md`「試算表的註記」那一列裡「上色問的是 `=== 0`」那一句改成現在的條件。

## 做完時留下的（10/9）

- `sheets/readonly-report.gs`：`r.remaining === 0` → `typeof r.remaining === 'number' && r.remaining <= 0`；`COLOR.low` 的註解、
  `sheetReport.js` 的 `extraRows()` 檔頭那一句、`CLAUDE.md`「試算表的註記」那一句跟著改。`SYNC_FORMAT`／`SUPPORTED_FORMAT` 沒動。
- 測試：`tests/sheet-script.test.js` 最後一段（4 條）—— 拿 `syncBundle()` 產 −1、0、1、一槓四列，再塞兩列 `''`、`null`（`.gs` 收的是 JSON），
  真的跑那一份 `.gs` 量「剩餘」那一格的底色；每一列先確認畫出來了（找不到列的話底色是 null，會假綠）。合計那一行是 `C2` 的一句字，不在上色的迴圈裡，照舊。
- 重現腳本 `r07`：import 真的 `.gs`（替身裡跑）—— 修完 B 兩行都是 `#FFCDD2`。A 段（備註只看得到第一行）是報告第 2 條，這一輪沒做。
- 留給 23：驗收清單 —— **她要重貼 staging 那一份 `.gs` 並重新部署**才看得到（上線那天正式那一份本來就要重貼）；
  貼完之後找一位做的比買的多的客人（或在模擬器上造一位），那一列「剩餘」是紅底。
