# 14 版面第四輪：不凍結欄、號碼跟名字一樣大、四欄全白＋窄空白欄、營養品加日期

Status: done
Blocked by: 08～13（PR #211，develop `7666220b`）

## 動工前先讀

- `.scratch/sheet-push-gaps/HANDOFF.md`「第三輪」「第三輪段二」、`spec.md`「第三輪」、ADR-0175
- `mock-count-columns-2026-11-05.html` 的 **A**（她挑的那一種，假資料）
- `sheets/readonly-report.gs`：`COL`、`FROZEN_COLS`、`STAMP_ROW`、`renderCustomer()`（最上面四列、矩陣表頭、數字四欄的底色）、`noticeRow()`、`noteBlock()`、`renderProducts()`／`productLine()`、`finish()`（粗線、`fitRows()`）、`paint()`（凍結）
- `public/js/domain/sheetReport.js` 的 `syncBundle()`（`products` 那一段）、`purchaseLines()`（「買過什麼」的日期寫法）

## 她要的（11/5 晚，看了 staging 第三輪的樣子；截圖有真名，不收進來）

> 第一 : 我覺得這頁分裂感太重了，我寧願不要中間那個分隔線好了，不要全部都凍結線左邊（A～E）太奇怪了
> 第二 : 我希望名子旁邊直接也是一樣大的病歷號 1234
> 第三 : 如圖我覺得那個灰色巨醜，幫我設計其他的
> 第四 : 營養品那一行，我想加上日期

第三點主控畫了三種（`mock-count-columns-2026-11-05.html`），她：「A 全白＋窄空白欄」。

## 做法

1. **不凍結欄**：`setFrozenColumns` 拿掉（列照舊凍結 5 列）。**合併不用再停在 A～E**：最上面幾列與下面那幾塊（買過什麼、營養品、備註、來訪紀錄）恢復成整頁寬（ADR-0175 推翻自己的「凍結前五欄」那一條 —— 寫一支新的 ADR 或在 0175 的索引那一列註明被哪一支推翻，照 `docs/agents/domain.md` 的慣例：**舊的不改**）
   - 最上面幾列怎麼排由你定，但：第 1 列提醒照舊在 A1（`isOurs()`）、產生時間那一列照舊是 `STAMP_ROW`（`render()` 沒變的頁改的那一格）、矩陣表頭照舊第 5 列、凍結 5 列
   - `fitRows()` 照舊估折行的高度（整頁寬之後會少很多折行）
2. **號碼跟名字一樣大**：名字那一格寫「客戶A　1234」（全形空白隔開、同一個 18 號粗體）；`infoLine()` 不再印號碼（只剩購買名稱、會籍、合計）。沒有號碼的只有名字
3. **應有～剩餘：A 全白＋窄空白欄**：
   - 四欄的格子**不塗底色**（拿掉 `COLOR.count` 那一層；斑馬紋照舊跟整列一樣）、表頭**跟其他表頭同色**（拿掉 `COLOR.countHeader`）
   - 「剩餘」右邊那條粗線拿掉（她說的「分隔線」也包括它；改成空白欄隔開）
   - **「剩餘」與第一個日期中間多一欄窄的空白欄**（約 8 像素寬、沒有字、沒有框線、白底，表頭那一格也白）：日期從 G 欄起 —— `COL.FIRST_DATE` 6 → 7、空白欄是第 6 欄
   - 狀態色（已完成綠、已排未上黃、剩餘 ≤ 0 紅）照舊
   - **日期欄往右一格會牽動的**（一個一個對）：矩陣的值與底色、`cellsByDate()`（器材、附註）、二返註記那一列、矩陣框線（空白欄**不畫**框線：框線分兩塊畫，或畫完再把空白欄的邊拿掉）、欄寬（空白欄 8、日期 78）、FINISHED 的位置（`FINISH_COL` 11 —— 看要不要跟著右移一格、不要壓到日期很少時的矩陣）、測試裡寫死的格子位置
4. **營養品加日期**：`syncBundle()` 的 `products` 每一筆多送購買日（寫法跟「買過什麼」一樣，例如 `0901`；不是今年的照 `purchaseLines()` 那一套）；`.gs` 的 `productLine()` 接在最前面。沒有購買日的不印那一段。**`syncBundle()` 這一次動的就這一格**（一次性客人那一輪 #210 已經在 develop，直接在它上面改）
- `LAYOUT_VERSION` 4 → 5；釘雜湊的兩支測試照它們的註解換（換之前先 `scripts/sheet-gs-compare.mjs` 跟 develop 的 `.gs` 比，確定變的只有這四件）
- 動 `public/`：`sw.js` VERSION 加一（develop 上現在是 v293）＋`npm run shell:snapshot`（新檔案先 `git add`）

## 判準

- 替身的快照：凍結 0 欄 5 列嗎？下面那幾塊與最上面幾列又是整頁寬了嗎？（09 那條「不准跨第 5／6 欄」的測試要改成新的規則，不是刪掉不管）
- 名字那一格是「名字＋全形空白＋號碼」、18 號嗎？抬頭那一行沒有號碼了嗎？
- 四欄的格子沒有底色、表頭跟療程項目同色、沒有那條粗線嗎？第 6 欄是空白欄（寬約 8、沒字、沒框線、白底）、日期從第 7 欄起嗎？
- 器材「✓ IN」、附註、二返註記都還落在對的那一天嗎？（往右一格最容易錯的地方）
- 營養品那一行最前面有購買日、沒有購買日的不印嗎？
- `scripts/sheet-xlsx-verify.mjs` 拿替身自己畫的（測試裡那一套）照舊 0 個不一樣嗎？

## 做完時留下的

做法（`sheets/readonly-report.gs`，`LAYOUT_VERSION` 4 → 5；ADR-0176 推翻 ADR-0175 第 1 點與第 5 點的「抬頭只寫號碼」）：

1. **不凍結欄**：`FROZEN_COLS` 整個拿掉、`setFrozenColumns` 不再叫（`resetSheet()` 本來就先歸 0 → 第三輪凍結的五欄重畫時跟著拿掉）。最上面四列、`noteBlock()`（多收回 `width`，第二輪以前的樣子）、來訪紀錄日期那一列的粗體都是整頁寬（`width` ＝ max(矩陣, FINISHED 右邊)）。第 1 列提醒照舊 A1、產生時間照舊第 4 列（`STAMP_ROW`）、矩陣表頭照舊第 5 列、凍結 5 列
2. **號碼跟名字一樣大**：新的 `titleLine()`（「名字＋全形空白＋號碼」；沒號碼只有名字）；`infoLine()` 不再印號碼
3. **全白＋窄空白欄**：`COL.SPACER = 6`、`COL.FIRST_DATE` 6 → 7；`COLOR.count`／`countHeader`／`divider` 拿掉，多 `COLOR.spacer`（白）、`STYLE.spacerWidth`（8）。表頭與每一列第 6 格寫 ''、整條（表頭到最後一列）白底蓋掉表頭色與斑馬紋；`finish()` 的框線分兩塊（A～E、G～最後一個日期），一個日期都沒有時只畫左邊那一塊；粗線拿掉。器材、附註、二返註記、矩陣底色都是 `COL.FIRST_DATE + dateIndex`，跟著右移一格（測試量了）。**FINISHED 照舊 K 欄**：它在矩陣底下另外幾列，不會壓到日期；她舊表上就在 K（ADR-0024）
4. **營養品加日期**：`syncBundle()` 的 `products` 每一筆多 `purchasedAt`（`purchaseDayLabel()`，跟「買過什麼」一樣是 `0901`、不帶年份 —— `purchaseLines()` 那一套本來就不帶；沒有購買日是 null）；`.gs` 的 `productLine()` 接在最前面。不升 `SYNC_FORMAT`。`sw.js` v294 → **v295**（develop 上 #212 先用了 v294，先 `git merge origin/develop` 再加一）

另外改的：
- `scripts/lib/sheetXlsxCompare.mjs`：替身那一側多一步 `spreadMergeEdges()` —— openpyxl 讀匯出檔時把合併區左上角那一格的框線抄到整條邊（`MergedCellRange.format()`），整頁寬的產生時間那一列底下因此在匯出檔裡整條都有線（包括空白欄與矩陣右邊）。不補的話 `sheet-xlsx-verify` 拿替身自己畫的照樣會說有 10 處不一樣。**真的匯出檔驗的時候也是這一條在起作用**，staging 那一次要看它對不對（底下「只在 staging 驗得到」）
- `.scratch/sheet-push-gaps/issues/14` 她的原話裡「病歷號」後面直接接著號碼，中間補一個空白：`tests/no-secrets.test.js` 的「姓名黏著病歷編號」把它當成真名

`scripts/sheet-gs-compare.mjs` 逐格比會整片不一樣（日期往右一格），所以另外寫了一支臨時的比法（scratchpad，沒進 repo）：改後矩陣那幾列拿掉 F 欄、日期往左一格，再跟改前（develop 的 `.gs`）比正式站 11/5 那一包（34 頁）——
**值 0、附註 0、矩陣底色 0 格不一樣**；不一樣的只有名字那一格與抬頭那一行（各 34）、拿掉的淡灰 771 格。營養品的日期這一包驗不到（那一包是舊 app 產的，沒有 `purchasedAt`），測試量了。
`scripts/sheet-gs-calls.mjs`（正式站那一包）：第一次 1,729 → **1,619** 次寫、整份重畫 1,653 → **1,543**、都沒變那一次 37 → 37（不凍結欄、整頁寬之後折行的列少了、少一層淡灰）。

測試：`tests/sheet-layout.test.js` 的 08／09 兩塊換成新的規則（09「不准跨第 5／6 欄」→「每一個合併不是整頁寬就是 TODO／FINISHED 那兩塊」、凍結 0 欄 5 列、第三輪凍結過的那一頁重畫後歸 0、空白欄寬 8／沒字／白底／框線不碰它、沒有日期時只畫一塊、名字＋號碼、抬頭沒號碼、營養品購買日）；
`sheet-script`、`sheet-fingerprint`、`sheet-gs-fonts-timing`、`sheet-rows-without-entitlement`、`sheet-xlsx-verify` 裡寫死的欄位往右一格；`sheet-gs-batch` 與 `sheet-fingerprint` 的雜湊照它們的註解換。`npm test` 5,780 全過、0 跳過。

### 自己對一次（Standards／Spec）

Standards（CLAUDE.md「試算表的 SYNC_FORMAT」「試算表的註記」兩列、`docs/agents/lessons.md`）：
- 一頁上多畫一樣東西 → 在 `syncBundle()` 那一頁的資料裡：購買日是 `products[].purchasedAt`，指紋拿整頁算（`sheetFingerprint()`），購買日變了那一頁會重畫 ✓
- 改了畫法 → `LAYOUT_VERSION` 加一（5）、釘程式碼雜湊的那一條換了 ✓；草稿紙（`Canvas`）沒有多叫它沒有的方法 ✓
- 合併與凍結：沒有凍結欄、整頁寬的合併都是單列的（不跨第 5／6 列的凍結線）✓；CLAUDE.md 那一列改成「哪天要凍結欄，那些合併要先收回來」
- 註記：`followupNotes`／`equipmentNotes`／`slotNotes` 的資料一個字沒動，落點都照 `COL.FIRST_DATE + dateIndex` ✓；「是數字而且 ≤ 0」那一道沒動 ✓；`MARK_TINT` 沒動 ✓
- 動了 `public/` → `sw.js` v295 ＋ `npm run shell:snapshot` ✓；公開 repo：commit、測試、文件都是假名 ✓
- lessons 一「同一件事有好幾個入口」：手動貼上那條路（`customerReport()`、`ui/views/report.js`）的營養品**沒有加日期** —— issue 寫明這一次只動 `syncBundle()` 那一格（一次性客人那一輪也動那一支）。要不要也加，記在 HANDOFF「中途發現」
- lessons 十「文件跟著畫面走」：SPEC（試算表那一節）、CLAUDE.md、ADR 索引都改了；`docs/常見問題.md` 那一條講的是附註，沒變

Spec（上面的「判準」一條一條）：
- 凍結 0 欄 5 列 ✓（`sheet-layout` 14 的兩條）；下面那幾塊與最上面四列整頁寬 ✓（09 那條改成新的規則，不是刪掉）
- 名字那一格「客戶A　1234」、18 號粗體 ✓；抬頭那一行沒號碼 ✓
- 四欄沒底色、表頭跟療程項目同色（`#37474F`）、沒有粗線 ✓；第 6 欄寬 8、沒字、沒框線、白底（表頭也白）、日期從第 7 欄起 ✓
- 「✓ IN」、附註、二返註記落在對的那一天 ✓（`sheet-layout` 11、`sheet-script`、`sheet-rows-without-entitlement`、`sheet-gs-fonts-timing`；正式站那一包往左一格比 0 格不一樣）
- 營養品最前面有購買日、沒有的不印 ✓
- `sheet-xlsx-verify` 拿替身自己畫的照舊 0 個不一樣 ✓（補了 `spreadMergeEdges()` 之後）

### 只在 staging 驗得到

- 空白欄 8 像素在 Google 上看起來夠不夠「分開」、會不會太窄看不出來（示意圖是 8）
- 產生時間那一列（整頁寬）底下那條線：Google 畫合併儲存格的底邊時，空白欄與矩陣右邊（K～M）上面會不會也出現一條細線 —— 不影響資料，只是好不好看。匯出 `.xlsx` 跑 `scripts/sheet-xlsx-verify.mjs` 時，如果框線這一類有不一樣、位置是第 5 列的上緣，就是 `spreadMergeEdges()` 對 Google 的匯出檔猜錯了（改那一支，不是 `.gs`）
- 名字＋號碼一行在手機上會不會被切掉（那一列固定 40 高、不折行；名字很長的人才可能）
- 列高：整頁寬之後幾乎不折行，`fitRows()` 估的高度大多是 26

## staging 驗過之後（11/5 深夜，主控）

- 上面第 89 行猜的那一種真的發生了：第 5 列上緣 120 條。**是 `spreadMergeEdges()` 猜錯、不是 `.gs`**：Google 只把線寫在畫框線的那一塊裡的格子上（A5 上面有、整頁寬的合併 A4 底下沒有），openpyxl 只抄左上角那一格自己的線 —— 真的試算表上空白欄與矩陣右邊上面**沒有**細線。
  `spreadMergeEdges()` 拿掉，測試的 `dumpLike()` 改成照 Google 那樣寫（合併區裡的格子不寫框線、只照 `setBorder()` 畫的）；分支 `claude/sheet-xlsx-verify-merge-edges`。其餘逐格驗的結果在 HANDOFF「第四輪 staging 逐格驗」
