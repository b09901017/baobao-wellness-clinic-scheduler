# 10 每一位的療程項目照「做最多的在上面」排

Status: done
Blocked by: 08（同一支 `.gs`）

## 動工前先讀

- `sheets/readonly-report.gs` 的 `renderCustomer()`（矩陣那一圈：`data.rows`、`equipmentNoteAt()`、`noteRowAt()` 靠 `rowIndex` 對到額度列）
- `public/js/domain/sheetReport.js` 的 `syncBundle()`（`rows: [...rows, ...extras]`、兩份註記的 `rowIndex` 只指額度列）—— **這一支不改**（理由在下面）
- `.claude/skills/month-end-reconciliation/scripts/reconcile.mjs` 的 `sheetOf()`（它照 `syncBundle()` 的列順序對額度）

## 她要的

> 第三 : 如圖3 療程項目的排列能不能有照順序 ? 就是最長排的再越上面像是復能和ILIB，其他門診類的就可以在比較下面，但我不知道應該要每個人不同，就是每個人長排的課程也不同，還是要固定 ?就是每個人由上到下都是做最多的到下面都沒做的
> 但我知道送的體驗的可以在最下面

主控建議「每個人各自照做最多的在上面」，她：「照示意圖做」。

## 做法

- **在 `.gs` 排，不在 `syncBundle()` 排**：只是畫的順序；`syncBundle()` 一次性客人那一輪 issue 04 會改，月底對帳的 `reconcile.mjs` 也照它的列順序對額度 —— 在 `.gs` 排兩邊都不用動、不用升 `SYNC_FORMAT`
- 額度列（`data.rows` 前面那幾列，也就是 `equipmentNotes`／`slotNotes` 的 `rowIndex` 指得到的那幾列）照 **已完成＋已排未上** 由多到少；一樣多的照原本的先後（穩定排序，不用 `localeCompare` —— 不靠 Apps Script 的語系）
- 沒有額度的那幾列（送的／體驗／n返／額度被刪的，`syncBundle()` 接在後面的 `extras`）照舊在最下面、照原本的先後
- 註記跟著它那一筆額度走（`rowIndex` 是排之前的位置）
- 怎麼分出「額度列」與「extras」：`data.rows` 裡 `total` 是數字的是額度列、`'—'` 的是 extras（`extraRows()` 的 `total: '—'`）—— 動手前對一次 `sheetReport.js`，要是有更穩的分法（例如 `equipmentNotes` 的 `label`）就用穩的，寫進「做完時留下的」

## 判準

- 已完成＋已排未上多的在上面、沒做過的在下面嗎？送的／體驗／三返永遠在最下面嗎？
- 器材、記一句跟著它那一筆額度走嗎？（排完之後還在對的那一列）
- 合計（抬頭那一行）沒變嗎？（它是 `totals`，跟順序無關）
- `syncBundle()` 一個字都沒改、月底對帳的測試照舊綠嗎？

## 做完時留下的

- `.gs` 多一支 `rowOrder(rows)`（純函式）：回 `data.rows` 的位置。`renderCustomer()` 照它的順序走，但 `n` 照舊是原本的位置 —— `equipmentNoteAt(data, n)`、`noteRowAt(data.slotNotes, n)` 一行沒改，註記跟著它那一筆額度走
- **分「額度列」與「extras」用 `extra: true`**（`extraRows()` 每一列都帶，比「應有是不是數字」穩：那是 `extraRows()` 自己留給「之後要把這幾列畫得不一樣的那一天」的旗子）；
  沒帶 `extra`、應有不是數字的也算 extras（手造的包、萬一哪天少帶）。一樣多的照原本的先後：比較函式自己比位置，不靠排序穩不穩
- `syncBundle()` 一個字都沒改；月底對帳讀的是 `syncBundle()`，不經過 `.gs`
- 正式站那一包（只印數字）：34 位裡 22 位的順序變了；`scripts/sheet-gs-compare.mjs` 跟 09 的 `.gs` 比，只有矩陣裡的值與底色、註記列的字級字色跟著搬（值 1,292、底色 652、字級 586、字色 586），合併、列高、欄寬一個都沒變
- 測試：`tests/sheet-layout.test.js` 的「10」那一組（順序、合計沒變、`rowOrder()`）。註記跟著走在 11 一起驗（11 把註記列拿掉、併進那一格）
- 替身驗得完（只是順序），沒有只在 staging 才知道的
