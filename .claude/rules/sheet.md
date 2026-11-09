---
paths:
  - "public/js/domain/sheetReport.js"
  - "public/js/domain/sheetPushTiming.js"
  - "public/js/data/sheetSync.js"
  - "public/js/ui/views/report.js"
  - "sheets/**"
  - "scripts/sheet-*.mjs"
---

# 試算表

**每一節的標題是「改了這個」，底下每一條是「一定要一起檢查」的**（從根目錄 `CLAUDE.md`「容易漏掉的連動」那張表搬來，標題照舊）。
新長出來的連動補進對應的那一節（沒有就加一節）；不屬於這一份的補進別份或開新的一份，並加進根目錄 `CLAUDE.md` 的索引。

## 試算表的註記

- **有兩種，而且不可以塞進同一個陣列**（2026-11-05 起器材併進那一格的字、記一句是那一格的附註（Google 的 note，不叫備註：備註是客戶身上那幾則），`.gs` 畫的時候併、資料形狀沒變，ADR-0175；2026-11-06 起記一句另外疊在那一個日期那一欄的矩陣底下、塗淡色（二返註記在最上面、器材不疊，`.gs` 的 `belowByDate()`，ADR-0177））：二返走 `followupNotes`、「這一天用了哪一台」走 `equipmentNotes`（只有得選的擇一池才有）。
- `.gs` 以前把 `followupNotes` 全部畫在同一列，同一個 `dateIndex` 後面的會蓋掉前面的（11/6 起一欄往下疊），而一位客戶同一天做了健檢又做了四選一是會發生的。
- **每一種註記與來訪紀錄都只看還算數的段**：二返寫在**健檢那一段做完了**的那一欄（`usedAndDone()`，跟 app 的「約二返」同一個時機，ADR-0112）、照位置猜的二返只猜佔著的（`holdsExam()`）、器材／記一句／來訪紀錄不收取消的段 —— 以前問「那一天有沒有用到那筆額度」，取消的健檢底下照印 `二返()`（2026-09-24 晚她抓到的）。新增一種註記要照這條。
- **記一句有兩個落點、各自只印一次**（格式 7，2026-10-05；11/6 起 `.gs` 另外把每一句疊在它那一天底下一次，ADR-0177 —— 畫的時候多一份，資料照舊只給一次）：有額度的段印在那一筆額度底下那一格（`slotNoteCells()`），**沒有額度的段**（n返、送的／體驗的段）印在來訪紀錄那一段自己那一行（`log[].items[].note`，有額度的那一格是 null）—— 新增一種沒有額度的段不用改，但把「哪一種段沒有額度」的判斷改成別的就要回來看這兩處。
- **沒有額度的段在矩陣裡自己一列**（`extraRows()`，2026-10-06）：**n返 一種返數一列**（`三返（不算次數）`，2026-10-07，ADR-0131）、**送的／體驗照「課程＋種類」一列**（`心臟科評估（體驗）`、`功醫門診（送的）`；**只有要選器材的那門課（復能）照那一天的器材全名分**：`INDIBA（體驗）`；營養點滴不照品項分，ADR-0148，`sheetReport.js` 的 `kindOf()`）、額度被刪的段照課程一列（先後 n返 → 體驗 → 送的 → 額度被刪的）。
- 來訪紀錄那一行讀的是 `courseName` 快照，**送的／體驗另外接 `(體驗)`／`(送的)`**；`.gs` 不比對那幾個字，不升 `SYNC_FORMAT`，「應有」「剩餘」是一槓、**不進合計**（`totals` 只加額度列）、一律接在額度列後面（兩份註記的 `rowIndex` 指的是額度列）；**n返 兩邊都有**：自己那一列的符號、健檢那一欄底下那一行（`followupNotes`，她：「要留」）—— 同一場出現兩次是她要的，不要去重；它那一列認返數（`nthOf()`），**不可以拿 `entitlementId` 或課程去認**（它借二返那門課，照課程分會混進送的／體驗的列、照額度認就算進二返）。
- 所以「每一個日期欄至少有一格有符號」沒有例外，`tests/sheet-rows-without-entitlement.test.js` 的不變量盯著。
- 一槓是字串，`.gs` 上色問的是「**是數字而且 ≤ 0**」（超用的 −1 也紅，2026-10-09，prelaunch-fixes 18）—— **先問 `typeof` 那一半不可以拿掉**：JS 裡 `'' <= 0`、`null <= 0` 都是 true。
- 哪天 `.gs` 要拿那兩格做別的算術也要先問是不是數字
- **家人用這位客戶的額度那一段（`slot.attendee`，ADR-0183）**：照樣打勾在被扣的那一位那一頁；附註那一行前面帶「先生來」（`sheetReport.js` 的 `whoLines()`：有記一句 `先生來：…`、沒記也印 `先生來`、舊資料整筆那一句另外一行讓去重收掉），**兩個落點都走它**（`slotNoteCells()` 與來訪紀錄那一行的 `note`）；來訪紀錄那一行的課程後面接 `(先生來)`（`attendeeTag()`）。字在 app 組好，`.gs` 不用改、不升 `SYNC_FORMAT`。**不要改在 `slotNoteOf()`**（來訪編輯器的記一句也讀它，會被存回去）

## 試算表要讀哪些來訪

- 只有 `data/visits.js` 的 `listForSheet(today)`：**過去的全部**、往後 400 天（ADR-0132，2026-10-07）。
- 自動推送（`sheetSync.js`）與手動貼上（`report.js`）都走它。
- **試算表上的次數是拿讀到的來訪現算的** —— 框一段期間就是少算（以前往回只讀 400 天：超過的那一次不算，試算表比 app 少）。
- 新增一條會算次數的報表路照做，不要自己框。
- `tests/sheet-all-history.test.js` 盯著。
- **自動推送讀到快取（或離線）這一趟不推**（`buildBundle()` 看 `repo.cacheReads()` 前後，丟 `IncompleteReadError`；`run()` 留待推標記、`noteFailure(…, { partial })`，設定頁講「上次沒推」不講「被拒絕」，ADR-0161）—— 推上去的話次數少算、畫面上看起來推好了。
- **一次性客人與一次性的段不進試算表**（`sheetVisits()`，見「一次性客人」那一節（`one-time-guests.md`））

## 試算表的 `SYNC_FORMAT`

- `sheets/readonly-report.gs` 的 `SUPPORTED_FORMAT` 要一起改，**而且她要回 Google 試算表重新貼一次並重新部署** —— 對不上的話 app 照樣推、`.gs` 整包拒收，而畫面上看起來跟推好了一模一樣。
- `tests/sheet-script.test.js` 盯著兩邊。
- **格式 8 起沒變的那幾頁不重畫**（ADR-0161）：每一頁的指紋只在 `sheetReport.js` 的 `sheetFingerprint()` 算、`.gs` 只比字串（記在文件屬性 `fp:分頁名`，接著 `LAYOUT_VERSION`）—— **一頁上多畫一樣東西，那樣東西要在 `syncBundle()` 那一頁的資料裡**（不然它變了、指紋沒變，那一頁停在舊的）；**改了 `.gs` 的畫法要把 `LAYOUT_VERSION` 加一**（`tests/sheet-fingerprint.test.js` 最後一條釘著程式碼的雜湊，一改就紅）。
- 拿不準一律重畫只問 `.gs` 的 `sheetPlan()`；**有人手改一頁時 `onEdit` 拿掉那一頁的指紋**（還原只救得回單格 —— 多格編輯沒有 `oldValue`、刪列不叫 `onEdit`；不拿掉的話那一頁一直停在改壞的樣子，段四審查）；設定頁「整份重畫」送 `force`（`sheetSync.push({ force })`，不被一般推送的去重併掉）。
- **兩台同時推，比較舊的那一包不畫**（ADR-0174）：`buildBundle()` **先**讀稽核最新那一則（`dataAtOf()`）**再**讀資料，時間放請求最外層（`pushBody()`，不進 `syncBundle()`）；`.gs` 拿到鎖之後比文件屬性 `lastDataAt`、畫完才記 —— **新舊不可以拿資料的 `updatedAt`**（刪掉的那一筆讀不進來）。
- **`.gs` 先讀完再寫、一頁先畫在草稿紙上**（`readBook()`、`Canvas`／`paint()`，`.scratch/sheet-push-gaps` 02、03）：畫法照舊寫 `sheet.getRange(…)`，草稿紙沒有的那一支要補進 `Canvas` 與 `paint()`；畫出來跟改前一樣由 `tests/sheet-gs-batch.test.js` 的雜湊釘著（改畫法就換雜湊，先用 `scripts/sheet-gs-compare.mjs` 看哪幾格變了）。
- **版面（ADR-0175、0176、0178）**：**列與欄都不凍結**（ADR-0178，她：「太割裂了」），上下那幾塊與最上面四列是整頁寬的合併 —— **哪天要凍結欄，那些合併要先收回來**（凍結線穿過合併 Google 會丟例外，替身照樣擋）；折行的合併照字數估高（`fitRows()`）；**剩餘與日期中間第 6 欄是空白欄**（`COL.SPACER`，沒有字、沒有框線、白底），日期從 `COL.FIRST_DATE`（7）起 —— 新增一樣落在日期欄的東西照 `COL.FIRST_DATE ＋ dateIndex` 算，不寫死欄號；療程項目的順序在 `.gs` 排（`rowOrder()`），`syncBundle()` 的列順序不動（月底對帳照它）；備註的底色是 `.gs` 的 `MARK_TINT`，**`MARK_COLORS`／`--mark-*` 改了要回來改那一份**（`.gs` 讀不到 `tokens.css`）
