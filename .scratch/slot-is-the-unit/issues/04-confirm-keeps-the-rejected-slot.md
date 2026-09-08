# 客人說不行的那一段標成取消，不要從陣列裡刪掉

Status: done
PR: 1（地基）
動工前先讀：`ui/views/home.js` 的確認動線（`const keep = (v.slots ?? []).filter(...)`）

## 現在的問題

確認動線裡她逐段點掉「客人說這段不行」，存檔時那一段是**從 `slots` 陣列裡
被刪掉**的。三個後果：

1. 沒有紀錄它曾經被壓過 —— 而她真的在 Abovee 上壓過那一格
2. **不會長出「取消 Abovee」** —— 那一格會一直被佔著，同事看得到、她忘記收
3. 稽核紀錄上看不出那一段去哪了（before 有、after 沒有，但沒有話講）

## 要做的事

那一段改成 `status: 'cancelled'`，留在陣列裡。整筆的狀態由
`visitStatusFrom()` 推 —— 剩下的段全部確認掉就是 `confirmed`，
全部被退掉就是 `cancelled`。

「退掉 N 段」那一句話（`describeConfirmed()` 的 `rejected`）**一個字都不用改**，
它本來就只是在數。

## 連帶：`syncTasksForVisit()` 要認得逐段取消

一段轉成 cancelled 時要長「取消 <那一段的掛號系統>」。
**同一種只長一張**（既有的 `already` 那道擋著），所以同一天退掉兩段復能
仍然只有一張「取消 Abovee」—— 那是對的，她回去 Abovee 一次收兩格。

## 測試要蓋到的

- 退掉一段之後 `slots.length` 不變，那一段的 `status` 是 `cancelled`
- 退掉一段 → 長出一張「取消 Abovee」
- 退掉同一個系統的兩段 → 仍然只有一張
- 全部退掉 → 整筆推導成 `cancelled`
- 次數：退掉的那一段不佔（走 `issues/02`）
