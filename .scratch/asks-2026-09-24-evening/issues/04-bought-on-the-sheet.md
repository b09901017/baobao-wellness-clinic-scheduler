# 試算表：「買過什麼」一天一行

Status: todo
Blocked by: 03（同一次升版）
來源：`../spec.md` 二d、Q4
PR：2（`claude/asks-0924e-sheet`）
動工前先讀：ADR-0090、`domain/purchases.js` 的 `purchaseDays()`／`shortItemName()`／`purchaseDayLabel()`、
`ui/views/bought.js`、`sheets/readonly-report.gs` 的 `renderProducts()`

## 她要的

> d能不能有一行是顯示，app中買過什麼那邊的資訊，我也想在試算表中看到

> 4. 可以（「一天一行、放在營養品上面」）

## 為什麼會這樣

試算表第 2 列有一格「購買名稱」，那是 `customer.source`（舊表 B2，例：`0522 顧客會-8`），不是她買了什麼。
「買過什麼」那一頁是 `purchaseDays()` 算的：一天一張、摘要走 `shortItemName()`、有微調才列「本來 N → 現在 M」。

ADR-0090 說第四種名字（`SIS(60)`）**只住在兩個地方**：客戶抬頭與「買過什麼」。試算表會是第三個 → 新 ADR-0115。

## 談定的做法

```
買過什麼
0723　新8萬方案x2+12萬健檢+EECPx40　（微調：SIS(60) 本來 20 → 23）
0901　ILIBx12
```

- 一天一行，照 `purchaseDays()` 的順序（新的在上）；沒有日期的那一張寫「沒有日期」
- 那一行在 `sheetReport.js` 組好（`.gs` 一個字都不組，同營養品那一區的 `deliveredAt`）
- 放在營養品那一區上面；一筆都沒有就整段不畫（同營養品）
- 營養品不在這一段（`purchaseDays()` 本來就不收，它自己一區）
- 「購買名稱」那一格不動（那是舊表 B2，她認得）
- 手動貼上那條路不加（她不用了，見 05）

## 判準

- 那一頁上看到的每一天，試算表上都有一行、摘要一個字不差？
- 微調過的那一天帶「本來 N → M」，沒微調的沒有括號？
- 客戶只買營養品：這一段不出現？
- CLAUDE.md「客戶抬頭那一行、買過什麼」那一列改成三個地方？
