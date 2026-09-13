# 一行「買了什麼」，由額度算出來

Status: done
來源：`../spec.md` 第一 a、b，她的第 6、8 題
動工前先讀：ADR-0003（範本沒有版本、展開後脫鉤）、ADR-0004（次數現算）、ADR-0078（只有三種名字）、
`domain/purchases.js`、`domain/entitlements.js` 的 `expandPlan()`、`poolName()`、`timedLabel()`、
`data/customers.js` 的 `createWithPlan()`、`domain/bulkCustomers.js`、`ui/components/planTweak.js`

## 她要的

> 我希望可以呈現像是"0723 顧客會 新8萬方案x2+12萬健檢+EECPx40+sis(60)x5+ILIB(60)x5等等
> 就是那個小標題只要呈現日期，顧客會/H2U導客(等等) 方案(沒有的話就不用)，加購的，懂嗎?

> 6. ……就寫sis(60)x5這個簡寫就好，我看得懂就不要寫太複雜，營養品不用進抬頭，但是可以寫在備註

> 8. 在抬頭那邊不用這樣寫（分日期），但是在買了甚麼那邊可以照你建議的這樣分

## 為什麼現在做不到

- **套數沒有存在任何地方。** `expandPlan()` 只存 `sourcePlanQty`（範本次數 × 套數，乘完的）。
  要反推套數就得回頭問範本 —— 舊試算表當年就是用 `Math.round(D2 / 模板D2)` 反推數量出事的
  （`docs/legacy/README.md` 第 1 節）。
- 名字：額度名是 `復能-SIS(60)`（ADR-0078），她要的抬頭是 `SIS(60)`。

## 做法

### 資料

- `expandPlan(plan, quantity)` 多寫一格 **`sourcePlanSets: quantity`**（快照，跟 `sourcePlanName` 同一種）。
  三條路（建新客戶、批次建立、加購方案）都經過 `expandPlan()`，所以只要改那一支。
- `firestore.rules` 的 entitlements：`sourcePlanSets` 有就是正整數（照 `sourcePlanQty` 那一條）。
- 沒有 `sourcePlanSets` 的舊資料：`setsOf(rows, plans)` —— 找得到同名範本、而且每一項都除得整、
  商都一樣才回那個數；否則回 null（**只寫方案名，不猜**）。

### 算法（純函式，住 `domain/purchases.js`）

- `purchaseHeadline(customer, entitlements, { plans, equipment, courses, ivProducts })` → 字串或空字串
- 組成：`日期 通路 項目+項目+…`，三段各自可以缺，缺了不留空格
  - **日期** = 方案那幾筆的購買日；沒有方案就是最早那一筆的購買日；格式 `MMDD`（`0723`）
  - **通路** = `customer.source`
  - **方案**：同一個方案同一個購買 id 一組，`方案名x套數`（套數 1 或不知道就不寫 x）。
    同一個方案買了兩次（兩個購買 id）→ 套數加起來
  - **加購**：非方案的每一筆額度，`簡寫x次數`（1 次不寫 x1）。同名的加起來
  - **不列**：已刪除、營養品（`isProduct`）、系統配出來的二返（`followupForEntitlementId`）
  - **不分日期**（她的第 8 題）
- **簡寫**（`shortItemName(e, master)`，全站第四種名字，只給抬頭與「買過什麼」用）：
  - 擇一池：`poolName()` 的後半（器材全名或「N選一」）＋時長 → `SIS(60)`、`三選一(60)`
  - 營養點滴：品項名 → `雪顏亮彩`
  - 其他：額度名本身（`ILIB(60)`、`EECP`、`12萬健檢`）
  - 她自己改過名字、認不出結構的：額度名本身

### ADR

補一支：**抬頭與「買過什麼」用簡寫**。它推翻 ADR-0078「全站只有三種名字」的一部分，
理由是那兩處是「她自己一眼掃過去」的地方，而她指名要簡寫。0078 一個字都不動。
`CLAUDE.md` 連動表「一段來訪在畫面上叫什麼」那一列補一句指過去。

## 判準

- 新 8 萬方案 ×2 ＋ 12 萬健檢 ＋ EECP 40 ＋ 復能-SIS(60) 5 ＋ ILIB(60) 5，購買日 2026-07-23，通路「顧客會」→
  `0723 顧客會 新8萬方案x2+12萬健檢+EECPx40+SIS(60)x5+ILIB(60)x5`
- 方案那幾筆被微調過（次數改了）→ 抬頭一個字都不變（微調在「買過什麼」講）
- 配出來的二返、營養品不出現
- 沒有方案、只有加購 → 日期是最早那一筆的
- 什麼都沒有 → 空字串（畫面不畫那一行）
- 沒有 `sourcePlanSets`、範本除得整 → 寫 x套數；除不整或範本不見了 → 只寫方案名
- 營養點滴兩款 → `雪顏亮彩x22+護肝排毒x11`
- 同一個加購買兩次 → 次數加起來
