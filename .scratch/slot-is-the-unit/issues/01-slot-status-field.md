# 時段帶狀態，來訪的狀態改成推導

Status: done
PR: 1（地基）
動工前先讀：`docs/adr/0025`、`domain/visits.js` 的 `applyStatus()` 與 `closeVisit()`

## 要做的事

1. `slot.status` 這一格，值域就是 `VISIT_STATUSES`（不另外開一組）
2. `visitStatusFrom(slots)` —— 由「還沒定案」往「定案」比，第一個對上的算數
3. `slotStatusOf(visit, slot)` —— **舊資料的唯一退路**，`slot.status` 沒有就從
   `visit.status` + `slot.attended` 推
4. `applyStatus(visit, to, { slotIndex })` —— 沒帶 `slotIndex` 就是整天一起改
5. `closeVisit()` 逐段寫 `status`，`attended` **照樣寫**（既有資料與 ADR-0025）
6. `withExtraSlot()` 的 `reopened` 改成推導出來的結果，不再自己設 `status`

## 判準

**這一行會不會讓一段已取消的時段被算成還佔著、或反過來？**

## 測試要蓋到的

- `visitStatusFrom()` 五條規則各一，含 `[done, cancelled]` → `done`、
  `[no_show, cancelled]` → `no_show`、`[cancelled, cancelled]` → `cancelled`
- `slotStatusOf()` 的退路：**沒有 `slot.status` 的舊來訪，答案要跟 2026-09-08
  的 `slotStatus()` 一模一樣**（拿現有測試的夾具直接比）
- `applyStatus(v, 'cancelled', { slotIndex: 1 })` 只動第 1 段，其餘一個字不動
- `applyStatus(v, 'cancelled')` 整天一起取消
- `closeVisit()` 之後 `attended` 與 `status` 兩邊講同一句話
