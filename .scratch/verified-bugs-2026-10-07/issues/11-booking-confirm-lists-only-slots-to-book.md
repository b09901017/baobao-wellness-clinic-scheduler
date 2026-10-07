# 「已經在 Abovee 壓好表了嗎？」底下不列不用壓的段

Status: todo
來源：`findings.md` 第 11 條
動工前先讀：`public/js/domain/consequences.js` 的 `bookingConsequences()`（整支，含 `confirmLabel` 怎麼來的）、
`public/js/ui/views/visitEditor.js:1284-1306`、`public/js/ui/views/schedule.js:2184-2220`、
`public/js/domain/taskRules.js` 的 `bookingSystemOf()`（回 `null`＝不用壓）、ADR-0126、0119、0086、`tests/book-nowhere.test.js`、
`CLAUDE.md` 連動表「一門課壓哪幾個系統」那一列
Blocked by: —

## 她要的

`findings.md` 第 11 條（她 10/7：「我想修一二三六的所有內容」）：

> 功醫門診＋HRV 一起存，「已經在 Abovee 壓好表了嗎？」底下列出 HRV

## 為什麼會這樣

抬頭由 `bookingConsequences()` 給，它只問要壓的段（ADR-0126）—— 是對的。
但 `visitEditor.js:1297-1300` 把**這一次新加的每一段**都列在底下，HRV（`systems: []`，不用壓）也在裡面，讀起來像在問「HRV 在 Abovee 壓好了嗎」。

## 要做的

「這一次新加的段裡哪幾段要壓、哪幾段不用」由 `bookingConsequences()` 一起回（它本來就算過一次才給得出抬頭），呼叫端不自己再問 `bookingSystemOf()`：

- 列在抬頭底下的只有**要壓的那幾段**
- 不用壓的段另外一句講完：「HRV 不用壓表，會一起記下來」（名字走 `slotName(…, 'short')`）
- 全部都不用壓時照舊（抬頭與確認鈕已經會換，ADR-0126）

壓表（`schedule.js`）一次只加一段，抬頭跟著那一段換 —— **動工時確認它沒有這個問題**，沒有就不改、寫一條測試釘住。
拍 Abovee 走 `aboveeConsequences()`，照片上的每一列都是 Abovee 上的，不在這一條裡。

## 判準

- 列在「在 X 壓好了嗎？」底下的每一段，`bookingSystemOf()` 回的都不是 `null` 嗎？
- 不用壓的那一段有沒有從確認框上**消失**？（不可以 —— 她要知道它也會被記下來）

## 測試

- 單元（`tests/book-nowhere.test.js` 旁邊）：功醫門診＋HRV → 要壓的名單只有功醫門診、另有一句 HRV 不用壓。
- E2E：HRV 那一支 spec 加一條 —— 日曆一次加功醫門診＋HRV → 確認框上 HRV 那一句是「不用壓表」。
