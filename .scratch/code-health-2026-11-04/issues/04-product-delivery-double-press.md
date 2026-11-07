# 營養品「記交付」連按，交付紀錄多一筆一樣的

Status: done（2026-11-05 修在 `.scratch/small-fixes-2026-11-05/issues/04-*`，PR #203 合進 develop `f5fb7b0a`；還沒上 main）
來源：`../REPORT.md` #4
動工前先讀：`public/js/ui/views/customerDetail.js:1395`、`public/js/data/notes.js` 的 `recordDelivery()`、
`public/js/domain/products.js` 的 `withDelivery()`
Blocked by: —

## 問題

沒有 `key`；`withDelivery()` 拿呼叫端手上那一份額度判斷給過了沒，兩次手上都是舊的 → `deliveries` 多一筆、進試算表。
「給了沒」的狀態不會錯。

## 修的方向

給 `key`，或寫入前重讀那一筆額度。

## Comments
