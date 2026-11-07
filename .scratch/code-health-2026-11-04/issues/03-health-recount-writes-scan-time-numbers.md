# 資料健檢「重算次數」寫的是掃描那一刻的數字

Status: done（2026-11-05 修在 `.scratch/small-fixes-2026-11-05/issues/03-*`，PR #203 合進 develop `f5fb7b0a`；還沒上 main）
來源：`../REPORT.md` #3
動工前先讀：`public/js/data/health.js` 的 `opFor()` `recount` 那一段（`45dd973` 的 `:484`），對照同一支帶 `ifUpdatedAt` 的那幾種；
`public/js/domain/health.js` 的 `checkCounts()`
Blocked by: —

## 問題

`recount` 直接寫 `fix.to`（掃描時算的），沒有 `ifUpdatedAt`。掃描完、別台替那位客戶排了一段之後再按修正，舊數字蓋回去。

## 怎麼重現（本機模擬器）

照 01 做到「次數對帳」出現那一列 → 先不要修正 → 另一個分頁替同一位、同一筆額度再排一段 → 回來按修正 → 重新掃描 → 那一列又出現。

## 修的方向

掃描時把額度的 `updatedAt` 放進 `fix`、op 帶 `ifUpdatedAt`；或修正前重讀那位客戶的全部來訪再算。

## Comments
