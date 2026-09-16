# 匯入的營養點滴額度沒有記是哪一款

Status: todo
來源：`../spec.md`（報告 §3.1）
動工前先讀：`domain/masterData.js` 的 `ivChoicesFor()`、`docs/adr/0002`（只提示不擋）

## 現在壞在哪

合併檔帶著 `productName`，`domain/mergeImport.js:181` 把它放在**計畫物件**上
（`productName: e.productName ?? null`），但 `doc` 裡沒有 `ivProductId` ——
而寫入端 `data/legacyImport.js` 只寫 `e.doc`。那一格整個掉了。

她那份 import 裡四筆營養點滴額度：

| label | productName |
|---|---|
| `營養點滴 - 護肝排毒` | 護肝排毒 |
| `營養點滴 - 雪顏亮彩` | 雪顏亮彩 |
| `營養點滴（腸道）` | （沒有）|
| `營養針` | （沒有）|

名字（`label`）照樣寫得出品項，所以**畫面上看不出差別**。差在：

- 排班時「買的那一款排第一顆、預設選好」不會發生（`ivChoicesFor()` 看的是 `ivProductId`）
- 「這一段的品項跟買的不一樣」那句提醒（`assignmentWarnings()`）與資料健檢的 `ivMismatch`
  都看不到這幾筆 —— 兩個都讀 `entsById[slot.entitlementId]?.ivProductId`

## 做法

- `planForCustomer()` 的額度 `doc` 補 `ivProductId`：`productName` 對得到主檔就填 id，
  對不到就進 `problems` 並留 `null`（同 `resolveAssignments()` 的判準：**不要猜**）
- 沒有 `productName` 的那兩筆照舊 `null` —— 那不是漏填，是舊表真的沒寫

## 判準

- **這一行會不會替一筆額度猜一個它沒有買的品項？**
- 帶 `productName` 且對得到主檔 → `doc.ivProductId` 有值，`ivChoicesFor()` 的 `primary` 只有那一款
- 帶 `productName` 但對不到主檔 → `null` ＋ `problems` 多一條
- 沒帶 `productName` → `null`，`ivChoicesFor()` 退回「全部列出來」
- 重現測試 `tests/prelaunch-repro/3-1-iv-product-id.test.js` 轉綠
