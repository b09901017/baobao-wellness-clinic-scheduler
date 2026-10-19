# 合併檔 v9 那一輪：交接

分支：`claude/merge-v9-notes`（從 `origin/develop` 50b5187 開，還沒推）
全貌與她的原話：`spec.md`（含 subagent 過目的結論）。她 10/20 選了「這個 session 一路做完」；10/20 凌晨額度用完停在 02 中間，
同一天下午接手把 02～05 做完、產檔那一側也做完。**剩下的是第四段：審查（xhigh）→ PR 進 develop → 合併。**

## 進度

| issue | 狀態 |
|---|---|
| 01 備註預設順序 | **done**（1b99807，ADR-0163） |
| 02 v9：段的記一句 | **done**（773500f＋1733617） |
| 03 v9：已取消／未到的段＋取消理由 | **done**（8fee78e，ADR-0164） |
| 04 v9：長備註 | **done**（12a1f35） |
| 05 文件 | **done**（37b8206） |

每一支底下有「做完時留下的」。驗證見下面。

## 產檔那一側（`.local/references/cutover-2026-10-14/`，有真名，不進 repo）

順序：`run-merge.mjs --today 2026-10-16 --tag 1020` → `make-overrides-1020.mjs` → `overlay.mjs --tag 1020`
→ **`make-notes-plan-1020.mjs --tag 1020`**（逐條例外寫進 `notes-plan.json`：照病歷號找人、照不含名字的那一段找句子）
→ **`notes-v9.mjs --tag 1020`**（→ `out-1020/import-v9.json`、`notes-report.txt`）
→ `validate.mjs out-1020/import-v9.json --today 2026-10-20`
→ `emu-import.mjs <檔>`（模擬器 w5 整份匯一次）→ **`make-checklist-1020.mjs`**（複製成 `.local/references/import-2026-10-20.json`、
寫 `切換那天-清單-2026-10-20.md`；模擬器那一次的數字抄在 `emu-result-1020.json`）。

10/20 下午做的：

- `notes-v9.mjs`：取消／未到的段配額度（照 overlay 的 `pickEntitlement()`，用掉幾次只數還算數的段；Abovee 預約來源寫體驗、或分鐘＝體驗分鐘的 → 體驗；
  配不到、課是預設體驗的 → 體驗；都不行 → 不建、列出來 —— 這一次 0 段）；一段都建不出來時不留空的來訪、那幾句照舊；
  `keepAsMark` 也認句子本身（舊表格子來的沒有 `from`）；新的 `retarget`（一句講那一天的哪幾段，`targets: [{ start, course }]` ——
  8/27 14:30 有 ILIB 與 SIS 兩段）、`titleFor`（長備註標題照內文的一段字指定）
- `notes-plan.json` 那六條例外都用上了（`planUnused` 0）
- `validate.mjs` 認 v9：多印 `v9.slotStatus`、`settledTasks`，以及 **`saveBack`** —— 每一位過客戶／短備註／長備註的驗證、每一天過 `validateVisit()`
  （照 `importPlan()` 換 id），匯完她一編輯就卡住的那幾種先抓。這一份：errors 0、對不到主檔 0、`saveBack` 全空

這一份的數字（`validate.mjs`，今天＝10/20）：34 位、174 筆額度、227 天來訪（已確認 48、已取消 7、未到 2）、326 段（已取消 12、未到 2）、
記一句 25 段、長備註 10 位 10 則、短備註 197 → 113 則、一出生就勾好的「取消」8 張、新的待辦 0（還沒發生的都是不用掛號的課）、雜事 54 筆勾 51。
跟 10/19 那一份比：多的 9 天、14 段就是那幾天取消／未到的段。

## 驗證

- `npm test`：5122 全綠
- `npm run verify`：26 支 spec、233 passed、1 skipped（`61` 的 H1 快取標頭：Windows 上的模擬器不回 headers，lessons 第九節），20 分鐘。
  沿用 10/19 17:30 從這個目錄起的模擬器（這一輪沒動 Rules／functions／firebase.json）
- 模擬器整份匯一次（w5，這一輪的分支，24 秒）：34 位、227 天（已確認 48／已完成 170／已取消 7／未到 2）、任務 8 張全部是勾好的「取消 Abovee」、隨手記 17、行事備註 21→34、畫面錯誤 0。資料健檢 1 項：**狀態異常 6 筆** = 10/17（六）2 段、10/19（一）4 段，檔案照 10/16 的 Abovee 寫已確認、日子過了還沒簽 —— 她 10/20 說保留簽療程單的待辦、逾期沒關係（spec.md 她的原話第四段）。數字抄在 `.local/…/emu-result-1020.json`
- 要貼的檔案：`.local/references/import-2026-10-20.json`（292 KB）；清單：`.local/references/cutover-2026-10-14/切換那天-清單-2026-10-20.md`

## 中途發現

- Python 在 Windows 寫檔預設 CRLF：改 repo 的檔一律 `open(..., newline='')`（01 那一次轉回 LF 了）。`.local` 裡的切換腳本本來就是 CRLF，
  改它們的 patch 照檔案的換行符換
- `.local/references/redact.mjs` 漏遮行事曆上直接寫的叫法 → 加了 `redact-extra.json`（`.local`，有真名）
- 測試裡「遲到」緊接阿拉伯數字的例子被 `tests/no-secrets.test.js` 當成姓名黏著病歷號 —— 例子改成國字
- **要問她（產檔那一側，不改 app）**：這一次的行事曆多了 23 筆雜事，其中 **8 筆是 10/20 以前的**（檔案是用 `--today 2026-10-16` 產的 ——截圖那一天），預設勾著，匯進來就是過去的行事備註與逾期的待辦（例如 10/16「取消…10／28」）。她 9/28 的規則是「今天以前的雜事不要」。選項：照舊勾著、在匯入頁自己拿掉；或照她切換那一天重跑 `run-merge.mjs --today <那一天>` 起整條（overlay 那一層的今天照舊是 10/16）

## 第四段的開場（審查 → PR → 合併；建議 effort：xhigh）

```
接手合併檔 v9 那一輪的第四段：審查、PR、合併。分支 claude/merge-v9-notes（還沒推），01～05 都做完了。
先讀 .scratch/merge-v9-notes/HANDOFF.md、spec.md、issues/01～05（每一支底下有「做完時留下的」）、docs/agents/lessons.md、
CLAUDE.md「舊表 B2…合併檔」「備註那一段的順序」「取消類的待辦」「一段來訪的狀態」四列、ADR-0163、ADR-0164。
1. /matt-code-review，基準 origin/develop（50b5187）。重點：mergeImport.js 的 validateFile()／planForCustomer()／addExtraVisits()／
   summarize()／skippedSlotsLine()、taskRules.js 的 importedTasksFor()、ui/views/mergeImport.js 的摘要卡與確認框、customerNotes.js 的 noteItems()。
   照建議修（修 bug 先寫失敗測試、一個 commit 一件事、npm test 全綠）；提過沒改的寫理由進 HANDOFF
2. 改了 public/ 就 npm run verify（模擬器要從這個目錄起；E2E 74、77、09、61、64 是匯入與備註那幾支）
3. 改了 mergeImport.js 的話，產檔那一側重跑一次：.local/references/cutover-2026-10-14/ 的
   validate.mjs out-1020/import-v9.json --today <今天> → emu-import.mjs → make-checklist-1020.mjs（讀 .local 一律過 redact.mjs、終端機不印真名）
4. 手動驗收清單（她可以照順序點的路，在本機模擬器走過再寫；staging 上有真名，清單不帶）
5. 推之前看一眼 commit 訊息與 PR 內文沒有真名（repo 是 public）；PR 開向 develop；CI 全綠就合進 develop。進 main 不在這一輪
```
