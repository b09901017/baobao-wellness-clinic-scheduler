# 資料健檢「重算次數」：掃描之後額度被改過就不寫

Status: todo
Blocked by: —
動工前先讀：`.scratch/code-health-2026-11-04/issues/03-health-recount-writes-scan-time-numbers.md`；
`public/js/data/health.js` 的 `opFor()` `recount` 那一段，對照同一支帶 `ifUpdatedAt` 的 `clearBeds`、`moveBedToRoom`、`restatVisit`；
`public/js/domain/health.js` 的 `checkCounts()`（產生 `fix.to` 的地方）；`repo.commit()` 怎麼處理 `ifUpdatedAt`

## 她要的

同 01。

## 為什麼會這樣

`recount` 直接寫 `fix.to`（掃描時算的），沒有 `ifUpdatedAt`。掃描完不按、別台替那位客戶排了一段（額度已經被那一台寫對）、
回來按修正 → 舊數字蓋回去。額度每存一次來訪都會換 `updatedAt`，所以帶上就擋得住。

## 做法

掃描時把額度的 `updatedAt` 放進 `fix`，op 帶 `ifUpdatedAt`（過目確認：`listGroup` 讀回的額度帶 `updatedAt`，`fix` 留在記憶體裡沒序列化，`repo.commit()` 的 `isEqual` 比得了）。
被擋下來時 `failureOf()` 講「剛剛在別的地方被改過，重新整理再改一次」、不給重試 —— 跟 `clearBeds` 同一句，夠用。
可選：`applyAndReload()` catch 到 `StaleWriteError` 時 `render(el)` 重新掃描。

## 判準

- 掃描之後別台改過那一筆額度 → 按修正會不會把舊的數字蓋回去？（不可以）
- 沒人改過 → 照常修好？

## 做完時留下的
