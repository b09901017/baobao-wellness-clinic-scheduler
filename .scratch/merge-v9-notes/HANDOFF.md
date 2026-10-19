# 合併檔 v9 那一輪：交接

分支：`claude/merge-v9-notes`（從 `origin/develop` 50b5187 開，還沒推）
全貌與她的原話：`spec.md`（含 subagent 過目的結論）。她 10/20 選了「這個 session 一路做完」；10/20 凌晨額度用完停在 02 中間，
同一天下午接手把 02～05 做完、產檔那一側也做完。10/20 晚第四段審查做完（見底下「第四段：審查」），**PR 進 develop**。

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

## 第四段：審查（10/20 晚，/matt-code-review 兩軸，基準 50b5187）

改了的（一個 commit 一件事）：

| commit | 哪一軸 | 什麼 |
|---|---|---|
| f850f79 | Standards（命名） | `skippedSlotsLine` → `missedSlotsLine`、`countSettledTasks` → `countTickedTasks`、`s.settled` → `s.ticked`：這一支裡 skip 本來是「同名跳過」「沒有匯入的時段」，settled 在 consequences.js 是結案／談定 |
| 17157c7 | 兩軸都抓到（bug） | 確認框上一句講「記成 N 張勾好的取消」，最後一句還寫「不會產生任何待辦任務」／「已經發生的一筆都不會長」；開始匯入那張卡兩句一樣。另外「各記一張」是錯的（同一天幾段一起取消收成一張）。新的 `newTasksLine()`（有勾好的那幾張時講「要做的」＋張數，沒有時一個字都不變），先寫了失敗的測試 |
| 190d5b2 | Standards（文件） | ADR-0164 寫「推翻：ADR-0093 的那一點」（`docs/agents/domain.md` 的慣例）；CLAUDE.md「匯入的來訪要建成什麼狀態」「一段來訪的狀態」兩列補 v9（後者 Spec 軸抓到：還寫著「只有拍 Abovee 一條路」） |

提過沒改的（理由）：

- **CONTEXT.md「指這一種寫任務」**：這一次新寫、改到的字都寫「任務」；那一頁原本的「登記待辦」沒動 —— v8 的檔案那幾句要一個字都不變
- **`importedTasksFor()` 自己寫一句說明、自己判 `whole`**（跟 `cancelNote()` 的 `freed` 那一句像）：`cancelNote()` 是私有的，要共用就得把「匯入」這個選項從 `syncTasksForVisit()` 一路穿進 `cancelTasksFor()` —— 為了一句話多兩層參數。留在一處、有註解
- **`longNotesOf()` 跟 `withLongNote()` 組同一個形狀**：`withLongNote()` 是對既有客戶加一則、會補 `noteOrder`；匯入是從零建、刻意不寫順序。共同的只有一行 `{ id, title: trim, body }`
- **測試的 `asImported` 照抄 `importPlan()` 的轉換**（lessons「查的方法」那一條）：`importPlan()` 要 Firestore；真的那條路由模擬器整份匯一次（任務 8 張全部勾好）與 E2E `61`／`64` 走過
- **`countNewTasks()`／`countTickedTasks()` 各跑一次**、`s.cancelled || s.noShow` 寫三次、區域變數 `own`／`longs`：都在一頁裡、成本是零、改了不會更清楚
- **摘要卡新加的幾行收進 `tip()`**：那幾行是數字（資料），`tests/fewer-words.test.js` 的三種可以留的之一
- **`validateFile()` 擋「理由寫在沒取消的段上」比 spec 嚴**：刻意的（issue 03「做完時留下的」）

**Spec 軸順帶查到、這一輪之前就有的（要問她，沒改）**：匯進來、已經做完的那一天，**之後再存一次會補長一張逾期的「寫紀錄」**
（`newRecords()` 只問那一段做完了沒、課要不要寫紀錄；匯入時 ADR-0093 不長，存的時候沒人擋）。拿這一份真檔量：185 天過去的，
**19 天**一存就各長一張（二返、復健科門診那幾種）。會觸發的：那一天裡未到的段長按「退回簽療程單」、任何一條會存那一天的路。
跟 ADR-0164 是同一個形狀；她 9/16 講過「過去的如果不會有問題的話就不長，或是當已完成，都可以」—— 照那一句的後半，可以照 ADR-0164
在匯入時長一張勾好的（多 19 張已完成）。這是改規則，要她點頭再 kickoff。量的腳本在 scratchpad（不進 repo），只印數字

審查之後的驗證（10/20 晚）：

- `npm test` 5124 全綠；`npm run verify` 6 支 spec（00、08、09、61、64、67）51 passed、1 skipped（同上，Windows 的快取標頭）
- 產檔那一側重跑：`validate.mjs`、`make-checklist-1020.mjs` 跟著改名（`countTickedTasks`、`missedSlotsLine`，確認框那一句改叫 `newTasksLine()`）。
  數字跟審查前一模一樣（34 位、227 天、326 段、取消 12／未到 2、勾好的 8 張、`saveBack` 全空）；`emu-import.mjs` 也一樣（任務 8 張全部勾好、畫面錯誤 0、資料健檢只有狀態異常 6 筆）；
  清單重產（215 行，確認框那一句換成新的字）
- 手動驗收清單在本機模擬器（w6，假名檔案）走過：匯入頁摘要卡與確認框、客戶詳情備註那一排與額度卡、日曆三天的讀取卡片、待辦首頁 —— 清單在 PR 內文

## 第四段的開場（審查 → PR → 合併；建議 effort：xhigh）

```
接手合併檔 v9 那一輪的第四段：審查、PR、合併。分支 claude/merge-v9-notes（還沒推），01～05 都做完了。
先讀 .scratch/merge-v9-notes/HANDOFF.md、spec.md、issues/01～05（每一支底下有「做完時留下的」）、docs/agents/lessons.md、
CLAUDE.md「舊表 B2…合併檔」「備註那一段的順序」「取消類的待辦」「一段來訪的狀態」四列、ADR-0163、ADR-0164。
1. /matt-code-review，基準 origin/develop（50b5187）。重點：mergeImport.js 的 validateFile()／planForCustomer()／addExtraVisits()／
   summarize()／missedSlotsLine()、taskRules.js 的 importedTasksFor()、ui/views/mergeImport.js 的摘要卡與確認框、customerNotes.js 的 noteItems()。
   照建議修（修 bug 先寫失敗測試、一個 commit 一件事、npm test 全綠）；提過沒改的寫理由進 HANDOFF
2. 改了 public/ 就 npm run verify（模擬器要從這個目錄起；E2E 74、77、09、61、64 是匯入與備註那幾支）
3. 改了 mergeImport.js 的話，產檔那一側重跑一次：.local/references/cutover-2026-10-14/ 的
   validate.mjs out-1020/import-v9.json --today <今天> → emu-import.mjs → make-checklist-1020.mjs（讀 .local 一律過 redact.mjs、終端機不印真名）
4. 手動驗收清單（她可以照順序點的路，在本機模擬器走過再寫；staging 上有真名，清單不帶）
5. 推之前看一眼 commit 訊息與 PR 內文沒有真名（repo 是 public）；PR 開向 develop；CI 全綠就合進 develop。進 main 不在這一輪
```
