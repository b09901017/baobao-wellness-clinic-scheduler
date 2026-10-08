# 試算表上「取消 Abovee」那一行，日期寫成今天、也沒寫是哪一門課

Status: done
來源：`f-sheet-cancel`、`sheet/report.md` 第 1 條（順手：第 3 條 b）
動工前先讀：`docs/agents/lessons.md` 第一節、`public/js/domain/sheetReport.js`（`:64`、`:155`、`:520`、`:615` 傳給 `taskBlocks()` 的來訪、`:921` 找來訪）、
`public/js/domain/todoFlow.js` 的 `taskLine()`／`taskSlots()`、兩條路：`public/js/data/sheetSync.js`（自動）與 `public/js/ui/views/report.js`（手動）、
`tests/sheet-all-history.test.js`、ADR-0091、0107、0132、`CLAUDE.md` 連動表「一列任務要顯示什麼」「試算表的註記」「試算表要讀哪些來訪」「一段來訪在畫面上叫什麼」
Blocked by: —
重現：`node .local/references/audit-2026-10-08/sheet/r03-cancel-task-date.mjs`

## 她要的

> ・「上線前要先修」那 18 件，要怎麼出貨？ → 全部一起修完、一起上 staging，你點一次驗收清單

報告那一張卡：

> 試算表上「取消 Abovee」那一行，日期寫成今天、也沒寫是哪一門課
>
> 用「批次取消」把 10/15 整天取消，app 的待辦寫「10/15(四) SIS」，試算表 TODO 卻寫「10/8　取消 Abovee　2026-10-08」。10/8 是今天，也就是死線。

## 為什麼會這樣

試算表那一側先把整天取消的來訪濾掉（`isActive()`），再把那一份傳給 `taskBlocks()`。
取消類的待辦要找的正是被取消的那一筆 —— 找不到，`taskLine()` 就退回寫死線。只取消其中一段的不會這樣（那一筆還活著）。

## 要做的

- `taskBlocks()` 改收**沒濾過**的來訪（報告說 2 行）。**只有它**：次數矩陣、註記、來訪紀錄照舊只吃濾過的。
- 自動推送與手動貼上兩條路都確認走到同一支（lessons 一）。審查對過：兩個呼叫端（`sheetReport.js:155`、`:615`）都傳濾過的來訪、都沒帶 `ivProducts` —— **兩處都要改**。
- 順手（同一個呼叫）：傳給 `taskBlocks()` 的主檔少了 `ivProducts`，所以營養點滴的待辦試算表寫「營養點滴」、app 寫品項。補上那一份 ——
  `CLAUDE.md` 有一條測試盯著每一個組 `master` 的地方，看它為什麼沒抓到這一個，補進去。

## 判準

- 整天取消的那張「取消 Abovee」：TODO 那一行的日期是取消的那一天嗎、有寫課程嗎？勾掉之後 FINISHED 那一行也是嗎？
- 只取消一段的照舊嗎？
- **次數有沒有因此變**：取消的來訪有沒有混進矩陣、合計、二返註記、來訪紀錄？（不可以。拿 `tests/sheet-rows-without-entitlement.test.js` 的不變量與既有的次數測試確認）
- 兩條路的輸出還一模一樣嗎？
- `SYNC_FORMAT` 有沒有需要動？（不用 —— 送出去的形狀沒變，她不用為這一支重貼 `.gs`）

## 測試

單元：r03 改寫（客戶A、10/15 整天取消）—— TODO 那一行＝待辦中心那一行；營養點滴那一張寫品項。

## 做完時留下的（10/9）

- `sheetReport.js`：`taskBlocks()` 兩個呼叫端都改拿**沒濾過的**來訪（`customerReport()` 的 `visits`、`syncBundle()` 的 `visitsBy[id]`）；
  自動推送那條直接傳整份 `master`（`config.loadAll()`，本來就有 `ivProducts`），手動貼上那條 `customerReport()` 多收 `ivProducts`、
  `report.js` 的 `load()` 多讀一份（含停用的，跟器材同理）。次數矩陣、註記、來訪紀錄照舊吃 `isActive()` 濾過的。`SYNC_FORMAT` 沒動。
- 測試：`tests/sheet-cancel-task-day.test.js`（7 條）—— 整天取消的 TODO／FINISHED、手動貼上、只取消一段照舊、
  **加了取消的那一天之後 `dates`／`rows`／`totals`／`followupNotes`／`equipmentNotes`／`log` 一個位元都不變**、營養點滴兩條路都寫品項。
  每一條都拿 `taskLine(task, visit, master)`（待辦中心那一支）當答案，不是寫死的字。
- 為什麼 `naming.test.js`／`slot-names-everywhere.test.js` 沒抓到：它們只掃 `ui/views/` 底下、只認 `master: {`／`master = {` 兩種寫法；
  這裡是 `domain/` 裡**照位置傳**的 `{ courses, equipment }`。沒有加原始碼掃描 —— 新測試直接量兩條路的輸出，比掃字串準。
- 重現腳本 `r03-cancel-task-date.mjs`：import 真的 `syncBundle()`、輸入自己組但形狀跟真的一樣 —— 修完印 `10/15 10:00 SIS`，跟待辦中心那一行一樣。
- 試算表那一行寫的是 `taskLine()` 的 `what`（`10:00 SIS`，帶時間），待辦中心卡片上那一行小字是 `lines`（`10/15(四) SIS`，不帶時間）—— 本來就是這樣（同一天兩張 Examine 那一條測試釘著），沒動。
- 留給 23：驗收清單一條（本機模擬器：批次取消整天 → 設定 → 試算表報表選那位 → TODO 那一行是取消的那一天＋課程）。`CLAUDE.md` 不用改。
