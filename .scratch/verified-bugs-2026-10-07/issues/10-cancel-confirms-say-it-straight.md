# 取消那幾道確認框：第二筆不說整天取消、沒有「——」、兩顆按鈕分得出來

Status: done
來源：`findings.md` 第 9、10 條、六的「取消的確認框兩顆按鈕都有『取消』」
動工前先讀：`public/js/domain/consequences.js` 的 `cancelConsequences()`（`:603-660`，那一句在 `:633-634`）、
四個呼叫端 `calendar.js:1193`、`bulkCancel.js:611-625`、`home.js:3084`、`visitEditor.js:1369`、
`public/js/ui/components/dialog.js`（`confirmAction()`、`confirmWithReason()` 的 `cancelLabel` 預設、`confirmReview()`）、
`public/js/domain/visits.js` 的 `sameDayVisitFor()`、ADR-0070、0082、0083、0087、0089、
`CLAUDE.md` 連動表「一句『按下去會發生什麼』」「一個要分得出『不要了』與『手滑關掉』的確認框」兩列
Blocked by: —

## 她要的

> 我想修一二三六的所有內容

（她 2026-10-07 的原話只有上面這一句。底下是我方 10/7 驗證時寫的描述，出自 `findings.md`，**不是她的話**：）

- 9. 第二筆來訪取消唯一一段時說「那一天就整個取消了」
- 10. 批次取消確認框一行只有「——」
- 取消的確認框兩顆按鈕都有「取消」：「取消」（不要了）與「取消這一段」（真的取消）並排。

## 為什麼會這樣

- **9**：`cancelConsequences()` 的 `left` 只數**這一筆**還活著的段。那一天已完成之後再加的段在另一筆來訪裡（ADR-0083 唯一會有第二筆的情況），
  取消它時這一筆的 `left` 是 0 →「那一天就整個取消了 —— 沒有剩下的段」。但那一天已完成的那一段還在。
- **10**：`bulkCancel.js:621` 把 `'——'` 當分隔線塞進 `consequences`，`confirmAction()` 把每一項畫成一個 `<li>`。
- **兩顆取消**：`confirmAction()`／`confirmWithReason()` 的 `cancelLabel` 預設是 `'取消'`，只有 `customerDetail.js:733` 自己給了「先不要」。

## 要做的

1. **9**：`cancelConsequences()` 多收一個選填的「這位客戶同一天的其他來訪」。這一筆沒有剩下的段、但那一天別筆還有活著的段時，
   不講「那一天就整個取消了」，改講那一天還有什麼：「那一天另外的 N 段不受影響」。
   沒帶就照舊（既有測試不動）。四個呼叫端都把它傳進去 —— **四邊手上都有這位客戶的來訪**（套狀態之前先讀回來那一份，`CLAUDE.md`「存一筆來訪時手上那一份是舊的」）；
   動工時逐一確認，哪一邊沒有就讀。批次取消一次可能挑走同一天兩筆裡的段 —— 「剩下的」要把同一批挑走的都扣掉。
   **下面那幾句任務（`cancelTaskLines()`）不動**：這一筆確實整筆取消，會長的待辦照舊。
2. **10**：拿掉那一行 `'——'`。別的確認框（`visitEditor.js:1297`）也是「哪幾段」接著「會發生什麼」不分隔，一致就好。
3. **兩顆取消**：`dialog.js` 兩處預設改成「先不要，回去」。E2E 點的是 `[data-cancel]` 屬性（查過：沒有一支用字找這顆），不受影響。
   動工時 `grep "cancelLabel\|'取消'" tests` 看單元測試有沒有比字。

## 判準

- 這一句說「整個取消了」的時候，日曆上那一天真的一段活著的都沒有嗎？
- 批次取消同一天挑走兩段（跨兩筆）時，「另外的 N 段」數對了嗎？
- 任何一道確認框上，還有沒有兩顆按鈕都叫「取消」開頭而意思相反？

## 測試

- 單元（`tests/consequences.test.js`）：帶了同一天另一筆（一段已完成）→ 沒有「整個取消了」、有「另外的 1 段不受影響」；沒帶 → 照舊。
- E2E：`22-bulk-cancel` 加一條斷言確認框裡沒有只有破折號的一列；長按取消的那一支斷言不要那一顆的字是「先不要，回去」。

## 審查之後（2026-10-07，subagent 讀過程式）

- **確認抽屜那一個呼叫端手上沒有這位客戶的全部來訪**：`home.js` 的 `applyConfirm()` 手上是 `byCustomer(ctx.pending)`（只有待確認的那幾筆），
  `listByCustomer()` 排在確認框**之後**。要把那一次讀搬到確認框之前（`CLAUDE.md`「存一筆來訪時手上那一份是舊的」本來就這樣要求：有確認框的在框之前讀）。
  另外三邊查過都有：`calendar.js` 長按、`bulkCancel.js`、`visitEditor.js` 的 `ctx.customerVisits`。
- **「——」不只一處**：`customerDetail.js` 刪客戶被擋下來的那一道也塞了一行。`grep "'——'" public/js`，兩處一起拿掉。
- 改 `dialog.js` 兩處預設會動到**全站每一道沒給 `cancelLabel` 的確認框**，不只取消類。那正是要的（別的確認框也是「取消」配一顆意思相反的鈕）；
  沒有測試比那個字。
- 跟 12 都動 `home.js` 的 `applyConfirm()` —— 先後做。

## 做完時留下的

- `cancelConsequences()` 多收 `sameDay`（這位客戶的來訪整份丟進來，它自己挑同一天的別筆）。只取消幾段那一條：
  「那一天剩下的 N 段」的 N＝這一筆還活著的＋同一天別筆還活著的；兩邊都沒有才說「那一天就整個取消了」。任務那幾句照舊只看這一筆。
- 四個呼叫端都傳了。確認抽屜的 `listByCustomer()` 搬到確認框之前。
- 「——」兩處拿掉（批次取消、刪客戶被擋下來那一道）。
- `dialog.js` 的預設改成「先不要，回去」（`BACK_LABEL`，`confirmAction()` 與 `confirmWithReason()`）—— 全站每一道沒自己給字的確認框。
- 單元 4 條（`tests/consequences.test.js`）、E2E `59-verified-words` 的 W2、`22-bulk-cancel` 多兩條斷言。
- 批次裡同一天跨兩筆各挑一段的情況沒有另外處理：那一天的另一筆只在它已經結案時才存在（ADR-0083），結案的段挑不起來。
