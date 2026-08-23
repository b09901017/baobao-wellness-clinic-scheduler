# CLAUDE.md

專案的完整需求背景、資料模型、業務規則與名詞表在 `SPEC.md`。動工前先讀。

## 文件分工

同一件事只寫在一個地方，其他地方用一行連結指過去。

| 檔案 | 只放 |
|---|---|
| `SPEC.md` | 需求、資料模型、業務規則、畫面規劃 |
| `CONTEXT.md` | 詞彙表。定義詞是什麼，不放實作 |
| `docs/adr/` | 為什麼這樣決定。一支一個決定，寫理由不寫作法。慣例見 `docs/agents/domain.md` |
| `docs/legacy/` | 舊系統的結構，唯讀參考 |
| `.scratch/<feature-slug>/issues/` | 待辦的 issue，不使用 GitHub Issues。動工前先看有沒有相關的，格式見 `docs/agents/issue-tracker.md` |

寫新文件前先確認這件事還沒被寫過。

**真實客戶姓名與健康資訊一個字都不能進版控** —— 不只 `docs/`，註解、測試、`.scratch/` 的 issue、`.claude/` 的 skill 全都算。例子一律寫「客戶A」，規則跟名字的字數有關時用假名（王小明）。`tests/no-secrets.test.js` 盯著。

## 容易漏掉的連動

| 改了這個 | 一定要一起檢查 |
|---|---|
| `/domain` 的業務規則 | `SPEC.md` 對應章節。推翻既有決定就補一支 ADR，不要改掉舊的 |
| `public/` 底下任何檔案 | `public/sw.js` 的 `SHELL` 清單與 `VERSION`（測試只盯清單，不盯版號） |
| 做完一個開發步驟 | `README.md` 開發狀態表打勾 |
| 新增集合、欄位、要排序的查詢 | `firestore.rules` 要開洞（預設全拒），`firestore.indexes.json` 要補索引 |
| 次數的算法 | `domain/entitlements.js` 的 `counts()`（現算）、`summarize()`（讀快取）、`reconcile()`（對帳）要一起改，見 ADR-0004。「這一段算不算」只寫在同一支的 `slotOutcome()`，見 ADR-0025 |
| 健檢與二返的關係 | 只寫在 `domain/followups.js`（配對、還欠幾次、「約二返」的待辦）。不要在 `taskRules.js` 或 UI 裡再判斷一次，見 ADR-0022 |
| 任務什麼時候產生 | 只寫在 `domain/taskRules.js` 的 `acceptsNewTasks()`（客人確認之後才長，見 ADR-0027）。UI 上講這件事的四句文案要跟著改：壓表那一頁兩句、確認動線的提示、客戶詳情沒有任務時那一句 —— 畫面在講一件不會發生的事，比沒講還糟 |
| 匯入的來訪要建成什麼狀態 | 只寫在 `domain/mergeImport.js` 的 `statusFor()`（依匯入當下的日期，不是產檔的日期，見 ADR-0029）。`domain/legacyImport.js` 寫死的 `done` 是對的：它只餵給 skill，狀態一律在匯入那一刻重判。**舊資料只有合併檔一條路進得來**，貼試算表那條 2026-08-23 拿掉了，見 ADR-0047 |
| 行事曆匯進來的雜事是哪一類 | 產檔那側的 `classifyEvent()` 出**建議**（休假／待辦／行事備註），app 那側 `domain/mergeImport.js` 的 `eventKind()` 讀它、`ui/views/mergeImport.js` 讓她逐列改，**她改的那一個才算數**。待辦寫進 `notes`（就是掛日期的隨手記，ADR-0044），另外兩種寫進 `events`。判錯休假的代價最不對稱 —— 那幾天會整片排不進去 —— 所以寫了同事名字的一律退回行事備註 |
| 匯入時哪些候選預設勾起來 | 只寫在 `domain/mergeImport.js` 的 `defaultPicks()`（還沒發生的勾、已經發生的不勾，見 ADR-0030）。不要在 UI 或產檔的 skill 那側再決定一次 —— 合併檔裡的 `include` 欄位是描述性的，app 從來沒有讀過它 |
| 客戶自己填的時間 | 表單那一頁在 `public/form.html` 與 `public/js/form/`，**不進 `sw.js` 的 SHELL**（排除清單在 `tests/shell-cache.test.js`）。答案 → 規則 → 原文只寫在 `domain/availabilityForm.js`，而且「產生的原文餵回解析器要得到同一組規則」是有測試的不變量。客戶填的不自動生效，一律先進收件匣，見 ADR-0031、0032、0033 |
| 要拿某位客戶的本輪可用性 | 先問「這是哪一段期間的事」。壓表、時段反查那種**綁月份或綁某一天**的畫面用 `domain/availability.js` 的 `collectionFor()`；待辦中心的「問這輪的時間」、資料健檢那種問「現在」的才用 `currentCollection()`。挑錯的後果是假的「可用 0 天」把人推到排序第一位，見 ADR-0036 |
| 壓表那一頁的任何互動 | 不要接成整頁重畫。事件用委派、選了什麼只改 `aria-pressed`、只換真的變了的那一塊 —— 她一位客戶要點五六下，重畫的代價是閃一下加捲回最上面，見 ADR-0038 |
| 任何「先看誰」的排序或推薦名單 | 用 `domain/scheduling.js` 的同一組計分，不要另寫一套 —— 同一位客戶在兩個畫面排名不同，她不會知道哪個算數。**兩個例外都在待辦中心，而且都是刻意的**：「問這輪的時間」問的是「先**問**誰」、「壓表登記」問的是「還有**誰**」，兩列都不吃計分也不排序（`customersToAsk()` / `customersToBook()`，見 ADR-0028、0041）。它們是提醒，不是佇列 —— 要決定「先壓誰」是壓表那一頁的事 |
| 來訪狀態的顏色、標籤或符號 | 只改 `domain/visits.js` 的 `STATUS_VIEW`，日曆、客戶詳情、試算表全部讀它。`app.css` 的 `.status-*` 只掛 class，色值全部在 `tokens.css`（淺色與深色兩份都要改，見 ADR-0039）。`tests/visits.test.js` 盯著兩邊對得上。**這一組是全站共用的，不可能只改一頁** |
| 日曆上任何一種東西的顏色 | 要分辨的是**七種**：待確認／已確認／已完成／未到／行事備註／休假／待辦。**色相已經用完了** —— 休假走斜線紋、待辦走方框勾勾記號，都是因為數不夠（ADR-0039、0045）。第八種一律先想「有沒有不用顏色的畫法」。行事備註可以自己挑顏色，色票名單與客戶備註共用 `MARK_COLORS`，但值另有一組 `--evcolor-*`（小圓點的顏色當 11px 的字對比度不夠，見 ADR-0040）；待辦不能挑 |
| 日曆上「待辦」那一類 | 它**就是 `notes` 裡有日期的那幾筆**，不是 `events` 的第三種類別，也不是 `tasks`（ADR-0044、0045）。所以「同步回隨手記」沒有東西要做 —— 沒有第二份資料。任務不上日曆 |
| 隨手記的欄位或那一列的樣子 | 四個地方共用 `ui/components/note.js`：待辦首頁那張卡、右下角泡泡、`#/todo/notes`、客戶詳情。**日曆上的待辦編輯器也是同一支的欄位** —— 長得不一樣會讓她以為是兩種東西 |
| UI 文案、新的詞 | 用 `CONTEXT.md` 的詞，不要用它標 _Avoid_ 的同義詞 |
