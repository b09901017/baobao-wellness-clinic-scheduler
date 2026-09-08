# 次數逐段算，取消的那一段把次數還回去

Status: todo
PR: 1（地基）
動工前先讀：`docs/adr/0004`（三支要一起改）、`docs/adr/0025`

## 要做的事

`domain/entitlements.js` 的 `slotOutcome()` 改成先問 `slotStatusOf()`：

```
done            → 'done'      扣一次
no_show         → 'no_show'   不扣，另外計數
cancelled       → null        時段還回去，不佔次數
pending_confirm → 'booked'    佔著
confirmed       → 'booked'    佔著
```

**`counts()` / `summarize()` / `reconcile()` 三支要一起改**（ADR-0004）——
但實際上只有 `slotOutcome()` 一支要動，另外兩支走它。這一條寫在這裡是為了
動工的人回去確認一次，不是真的有三處程式碼。

## 為什麼 cancelled 回 `null` 而不是新的一種

`null` 現在的意思就是「這一段不佔次數」（整筆取消時就是回 `null`）。
多開一種回傳值的話，每一個 `switch` 都要多一條，而漏掉的那一條會**無聲地
把取消掉的那一段算進次數**，要等到她對帳才發現。

## 測試要蓋到的

- 一筆來訪三段同一筆額度，中間那一段取消 → `remaining` 回來一次
- 舊資料（沒有 `slot.status`）的次數**一格都不能變** —— 拿既有
  `tests/entitlements.test.js` 的夾具跑一次，數字要跟改之前完全相同
- 整筆 cancelled 的來訪仍然一次都不佔（回歸）
