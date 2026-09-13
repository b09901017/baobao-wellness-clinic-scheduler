# 合併檔 v2：購買日、方案、套數、帶顏色的備註，app 與 skill 兩邊一起

Status: done
Blocked by: 07
來源：`../spec.md` 第一 a-1
動工前先讀：`.claude/skills/calendar-sheet-merge/SKILL.md` 的「合併檔」一節、`scripts/merge.mjs`（組 `customers[]` 那一段）、
`domain/mergeImport.js` 的 `validateFile()`、`planForCustomer()`、`data/legacyImport.js` 的 `importPlan()`、
`ui/views/mergeImport.js`

## 她要的

> 然後也希望你幫我調整完後也幫我去修改合併的那個skill，讓他們相容

> 然後合併的時候也可以再問我一次

## 為什麼現在做不到

合併檔是 skill 與 app 之間的契約（`baobao-merge/v1`）。`customers[]` 只有 `source` 與 `notes`（字串），
額度沒有購買日、方案名、套數；`planForCustomer()` 把 `purchasedAt`、`sourcePlanName` 寫死成 null。

## 做法

- 格式升 **`baobao-merge/v2`**。**只加欄位不升版的話，舊版 app 會安靜地吃掉那幾格**，而畫面看起來跟匯好了一樣
- app 收 v1 與 v2（v1 照舊）
- v2 多的欄位：
  - `customers[].purchasedAt`
  - `customers[].marks[]: { text, color }`（有它就不讀 `notes`，寫入走 `toCustomerFields()`，`notes` 是鏡像）
  - `entitlements[].purchasedAt`、`sourcePlanName`、`sourcePlanSets`、`sourcePlanQty`、`purchaseKey`
    （同一次購買共用一個 key，app 寫入時換成真的 `purchaseId`）
  - `customers[].purchaseProblems[]`：B2 驗證對不上的那幾條（issue 07 的 `problems`）
- skill：`merge.mjs` 把 `planForSheet()` 算好的那幾格原樣帶出來；`report.txt` 多一段
  **⓪c 購買名稱對不上的**，每一條一句話，**合併時要逐條問她**（她的原話）
- `SKILL.md` 的契約那一段、「什麼時候要停下來問」補一條；`references/answers.md` 補她 2026-09-13 回答的四題
- app 那一頁（`ui/views/mergeImport.js`）每位客戶那一張摘要卡把 `purchaseProblems` 列出來
- `docs/legacy/README.md` 第 6 節的 B2 那一段補一句指到 `parsePurchaseCell()`

## 判準

- v1 的檔案照樣匯得進去，匯進去的東西跟以前一模一樣
- v2 的檔案匯進去：客戶 `purchasedAt`、`source`（通路）、`marks`（含紅色那一則）都在；
  額度帶 `purchasedAt`、`sourcePlanName`、`sourcePlanSets`、同一次購買同一個 `purchaseId`
- 匯完之後客戶抬頭（issue 05）印得出 `0617 顧客會 8萬方案+5萬健檢`，「買過什麼」一天一張
- 格式寫錯（`baobao-merge/v3`）照舊整份擋掉
- `purchaseProblems` 在 app 那一頁看得到，也在 `report.txt` 裡
- skill 那支腳本在測試裡跑一次（去識別化的 `docs/legacy/samples/`），輸出 `format: 'baobao-merge/v2'`
