# 改狀態之前先把每一段的狀態補齊

Status: done
來源：`../spec.md` 第 01 條（第二點 b）
動工前先讀：ADR-0081、`domain/visits.js` 的 `withSlotStatuses()`／`applyStatus()`／`applyConfirmation()`／`closeVisit()`、
`data/visits.js` 的 `save()`（第 136 行）

## 她要的

> 我發現未到應該結案但是一旦把這段改成客戶以確認 整天的未到還有其他的都會變成客戶已確認？但好像只有有時候會這樣？幫我詳細的去排查

## 為什麼會這樣（2026-09-24 重現）

時段身上沒有自己 `status` 的來訪（2026-09-08 之前建、之後沒再存過的；staging 的 `seed-staging.mjs` 種的也沒有）：

1. 長按第 0 段 → `applyStatus(v, 'confirmed', { slotIndex: 0 })` 只蓋第 0 段 → `settle()` 把整筆推成 `confirmed`
2. `save()` 在寫入前跑 `withSlotStatuses()` 補空格 —— **補的是「改完之後」的整筆狀態**
3. 其餘每一段被補成 `confirmed`

重現：整天三段未到（舊形狀）→ 改第 0 段 → 三段都變已確認。新形狀的資料不會。

## 談定的做法

三支轉移的入口（`applyStatus()`、`applyConfirmation()`、`closeVisit()`）**動手之前**先 `withSlotStatuses(visit)`。
根在 domain 一處，不在畫面上各補一次。

## 判準

- 舊形狀、整天未到的三段，改第 0 段之後第 1、2 段還是未到嗎？
- 新形狀的資料（每段都有 status）結果一個字都沒變嗎？
- `applyConfirmation()` 帶 `asked` 時，沒問到的那幾段補的是**它們原本的**狀態，不是新的整筆？
