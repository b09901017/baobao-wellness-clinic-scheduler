# 二返排在最後面

Status: todo
來源：`../spec.md` 第 10 條（第三點 a）
動工前先讀：`domain/scheduling.js` 的 `customerPools()`（173 行的排序）、`ui/views/visitEditor.js` 的額度丸子（542 行）

## 她要的

> a我希望二返(...健檢) 健檢應該放一起 然後二返要放比較後面，不然很容易想約健檢卻約到二返(...健檢)會看錯

## 為什麼會這樣

壓表那一排照「剩下次數少的在前、再照名字」排 —— 健檢與二返剩一樣多時就並排。來訪編輯器那一排沒排序，
照讀進來的順序。兩個入口順序不一樣。

## 談定的做法

一條規則寫在 domain：**二返（`followupForEntitlementId` 有值）一律排在最後面**，其餘照舊。兩個入口共用。

## 判準

- 「8萬健檢」剩 1、「二返（8萬健檢）」剩 1：壓表與來訪編輯器上都是健檢在前、二返在最後？
- 沒有二返的客戶，順序一個字都沒變？

## 對照 develop（`d00b644`）

- 行號對得上：`scheduling.js:173` 的排序、`visitEditor.js:544` 那一排（`ctx.entitlements` 照讀進來的順序）。
- 池子那個物件身上沒有 `followupForEntitlementId`，排序要用得到就得帶上去。
- 連動：`customerPools()` 也是客戶清單那幾顆丸子的來源（`customers.js`），二返在那裡也跟著排到最後 —— 同一條規則，順序一致。
  客戶詳情的額度卡走的是另一支 `sortPools()`（健檢與二返相鄰，ADR-0022），**不動**。
- 來訪編輯器新增時預設選的是 `entitlements[0]`（`blankVisit()`）：排序之後預設不會再是一筆二返。
