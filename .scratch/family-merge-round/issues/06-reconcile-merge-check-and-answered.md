# 月底對帳：固定多一塊「合併扣課可能忘了勾／多勾」，並讀「她答過的」

Status: done
Blocked by: 05（判斷要跟拍照同一套）
動工前先讀：`.claude/skills/month-end-reconciliation/SKILL.md`、`scripts/reconcile.mjs`、`scripts/report.mjs`、`tests/month-end-reconciliation.test.js`、
記憶 `reconciliation-report-format`（六張小表、不寫推論段落）、`.local/references/月底對帳/她答過的.md`（**讀一律接 `| node .local/references/redact.mjs`**）

## 她要的

（11/9 她答「照建議」）月底對帳以後固定查合併扣課，跟拍照提醒一起做；9/24、10/29 兩個多按的勾不用動。
10/30 她：「反正過去了，幫我記得就好」—— 她不會去 Abovee 補勾，以後 10 月 Abovee 比 app 多那一次是答過的。

## 為什麼會這樣

- 對帳現在不會主動列合併扣課的勾跟額度對不起來的；5～10 月是另外開 session 重對才找到。
- `她答過的.md` 只有人在讀，程式沒讀 → 每個月會把答過的再列成要處理、再問她一次。

## 要做的

1. 結果頁固定多一塊（小表「日期｜誰｜Abovee｜app」那種）：**可能忘了勾**（兩列沒勾、`looksMerged()` 成立、額度分鐘＝兩列加起來）、**可能多勾**（勾了找不到另一半，或兩列都勾但額度分鐘對不上）。判斷**呼叫 app 同一支**（05 改完的 `aboveeImport.js`），不在 skill 裡另寫一套。只列出來，不改 app。
2. 讀 `她答過的.md`：對到的那幾件（日期＋誰＋哪一種）標「答過了」、不算在「要處理」的數字裡、結果頁看得出是答過的。檔案格式以現在那一份為準；格式不夠程式讀，就在 skill 裡定一個簡單的格式、把現有的幾件照格式改寫（**改 `.local` 的檔要在 `.local` 的私人 repo commit、不 push**）。
3. `SKILL.md` 寫進流程；`tests/month-end-reconciliation.test.js` 用假資料加案例（不帶真名）。

## 判準

- 重跑 10 月：10/30 那一件在「合併扣課」那一塊、標「答過了」，不算進要處理；9/24、10/29 的多按也列著、標答過了。
- 重跑 5～9 月：合併扣課那一塊列出的，跟 `全部重對-2026-11-09/合併扣課.json` 的勾了 10 組／沒勾同類 12 對裡「額度對不上的」一致（11 對額度 30 分的不列）。
- 答過的檔案裡沒有的、新的一件 → 照舊列成要處理。

## 過目補充（2026-11-09）

- 可以直接 import：`reconcile.mjs` 已經從 `aboveeImport.js` import `readAbovee`、`mergedMark`。
- `她答過的.md` 是表格（日期、誰、Abovee、app、她怎麼說、什麼時候答的）；「誰」是自由文字、沒有「哪一種」→ 程式讀不準。建議加「種類」（對齊對帳的分類）與「病歷號」兩欄，現有幾件照格式補上（在 `.local` 私人 repo commit、不 push）。

## 做完時留下的

- **合併扣課那一塊**：`reconcile.mjs` 的 `mergeChecks` —— 同一份抄字、這個月的來訪拿掉再叫一次 `readAbovee()`，讀 `mergeGuess`（→ `mergeForgot` 可能忘了勾）、`mergeSplit`／`mergeOrphan`（→ `mergeExtra` 可能多勾）。結果頁第 2½ 塊「合併扣課可能忘了勾／多勾」（`report.mjs`），沒有的話「不影響次數」那一塊寫一行 ✓。
- **她答過的**：`run.mjs` 有那個檔就給 `--answered`；對法日期＋種類＋病歷號（空著看「誰」裡的名字），沒有「種類」那一欄的列對不到。答過的照樣列、寫「答過了：…」，不算進要看的 N 件、月曆數字、每一位的 ✗；`summary.answered` 數幾件。那一份加了「種類」「病歷號」兩欄（`.local` 私人 repo `1148e2c`，沒 push；病歷號 4 列由程式從重對的 JSON 填，其餘 4 列靠名字）。
- **次數**：沒勾的後一半（`halfGuess`）算進前一列那一段的額度（以前後一半沒有自己的段、掉進「沒有扣額度」）；`mergeGuess` 算兩次、`mergeSplit` 後一列不算（Abovee 照勾扣）。
- **重跑 5～10 月**（全部重對留下的抄本＋11/9 快照，只跑比對）：10 月 10/30 `mergeForgot`、10/29 `mergeExtra` 都答過；9 月 9/24 `mergeExtra` 答過；5～8 月合併扣課那一塊沒有東西（11 對額度不是兩列加起來的都不列）。
- 測試：`tests/month-end-reconciliation.test.js` 多 11 支（那一塊 6 支、答過的 3 支、改寫 2 支），結果頁有一支真的跑 `report.mjs`。
- **沒做**：結果頁沒有用真資料重產一次給她看（`run.mjs` 整條要逐像素驗證，額度不夠；判斷已用真資料跑過比對那一步）。
