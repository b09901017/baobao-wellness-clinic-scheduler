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
| `docs/STAGING.md` | **怎麼操作**兩個環境：第一次設定、推 Rules、加白名單、種假資料、還原演練、上線檢查表。為什麼這樣設計不寫這裡（那在 `.scratch/PRODUCTION_AUDIT.md`） |
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
| 營養品的形狀或交付 | 一次購買一筆（金額＋好幾款＋幾個月），規則只在 `domain/products.js`，見 ADR-0059。**提醒是一筆有日期的隨手記**（所以它自動在日曆的「待辦」那一類，不要開第八種顏色），交付記在額度的 `deliveries[]` —— 隨手記會被她清掉，而那份紀錄要進試算表。四個勾隨手記的入口共用 `ui/components/note.js` 的 `prepareToggle()` |
| 試算表的 `SYNC_FORMAT` | `sheets/readonly-report.gs` 的 `SUPPORTED_FORMAT` 要一起改，**而且她要回 Google 試算表重新貼一次並重新部署** —— 對不上的話 app 照樣推、`.gs` 整包拒收，而畫面上看起來跟推好了一模一樣。`tests/sheet-script.test.js` 盯著兩邊 |
| 「她賣了什麼給客戶」的那張表 | 只寫在 `ui/components/buy.js`。**三個入口共用一份**：客戶詳情的「加購」、新增客戶的「加一項」、批次建立「微調」面板裡的「加一項」——欄位與**接線**（`wire()`）都是同一份，呼叫端只回答「哪一塊要重畫」。多接一次的代價已經付過了：「其他…」那一格漏了兩次。**營養品是一筆排不進來訪的額度**（ADR-0057），所以它不可以流進任何「還要排幾次」：閘門在 `domain/entitlements.js` 的 `schedulable()`，用在 `customerPools()`、`summarize()`／`lowRemaining()`、資料健檢的「資料過期」、來訪編輯器的額度丸子。試算表報表刻意**有那一列但不進合計** |
| 一筆來訪改得動的地方 | **只有日曆**（ADR-0056），日曆上的長按選單也算在那一個入口裡。待辦中心、客戶詳情、進度追蹤那三張讀取卡片都沒有鉛筆，來訪紀錄那一列也不是連到編輯器的連結 —— 留一條繞過去的路，等於那個決定只做了一半 |
| 健檢與二返的關係 | 只寫在 `domain/followups.js`（配對、還欠幾次、「約二返」的待辦）。不要在 `taskRules.js` 或 UI 裡再判斷一次，見 ADR-0022 |
| 勾掉一張待辦 | 走 `data/tasks.js` 的 `setDone(tasks, done)`，**收的是任務本身不是 id**。健檢鏈那兩種（追蹤健檢報告、約二返）會連著把下一站算出來，跟勾選寫在同一個 commit 裡 —— 規則仍然只在 `domain/followups.js` |
| 任務什麼時候產生 | 只寫在 `domain/taskRules.js` 的 `acceptsNewTasks()`（客人確認之後才長，見 ADR-0027）。UI 上講這件事的四句文案要跟著改：壓表那一頁兩句、確認動線的提示、客戶詳情沒有任務時那一句 —— 畫面在講一件不會發生的事，比沒講還糟 |
| 匯入的來訪要建成什麼狀態 | 只寫在 `domain/mergeImport.js` 的 `statusFor()`（依匯入當下的日期，不是產檔的日期，見 ADR-0029）。`domain/legacyImport.js` 寫死的 `done` 是對的：它只餵給 skill，狀態一律在匯入那一刻重判。**舊資料只有合併檔一條路進得來**，貼試算表那條 2026-08-23 拿掉了，見 ADR-0047 |
| 行事曆匯進來的雜事是哪一類 | 產檔那側的 `classifyEvent()` 出**建議**（休假／待辦／行事備註），app 那側 `domain/mergeImport.js` 的 `eventKind()` 讀它、`ui/views/mergeImport.js` 讓她逐列改，**她改的那一個才算數**。待辦寫進 `notes`（就是掛日期的隨手記，ADR-0044），另外兩種寫進 `events`。判錯休假的代價最不對稱 —— 那幾天會整片排不進去 —— 所以寫了同事名字的一律退回行事備註 |
| 匯入時哪些候選預設勾起來 | 只寫在 `domain/mergeImport.js` 的 `defaultPicks()`（還沒發生的勾、已經發生的不勾，見 ADR-0030）。不要在 UI 或產檔的 skill 那側再決定一次 —— 合併檔裡的 `include` 欄位是描述性的，app 從來沒有讀過它 |
| 客戶自己填的時間 | 表單那一頁在 `public/form.html` 與 `public/js/form/`，**不進 `sw.js` 的 SHELL**（排除清單在 `tests/shell-cache.test.js`）。答案 → 規則 → 原文只寫在 `domain/availabilityForm.js`，而且「產生的原文餵回解析器要得到同一組規則」是有測試的不變量。客戶填的不自動生效，一律先進收件匣，見 ADR-0031、0032、0033 |
| 要拿某位客戶的本輪可用性 | 先問「這是哪一段期間的事」。壓表、時段反查那種**綁月份或綁某一天**的畫面用 `domain/availability.js` 的 `collectionFor()`；待辦中心的「問這輪的時間」、資料健檢那種問「現在」的才用 `currentCollection()`。挑錯的後果是假的「可用 0 天」把人推到排序第一位，見 ADR-0036 |
| 「不能的時間」的畫法或動線 | **一份就是一個月**（ADR-0053）。`components/ban.js` 的抬頭一定要印出月份；「記一次」先問哪個月，已經有的月份不出現在「新增」那一排；既有的那一份不給換月份；改完存檔前要把差異講出來（`describeRuleChanges()`）。既有的重複資料由資料健檢的 `duplicateAvailability` 列出來，**不自動合併** |
| 壓表那一頁的任何互動 | 不要接成整頁重畫。事件用委派、選了什麼只改 `aria-pressed`、只換真的變了的那一塊 —— 她一位客戶要點五六下，重畫的代價是閃一下加捲回最上面，見 ADR-0038 |
| 任何「先看誰」的排序或推薦名單 | 用 `domain/scheduling.js` 的同一組計分，不要另寫一套 —— 同一位客戶在兩個畫面排名不同，她不會知道哪個算數。**兩個例外都在待辦中心，而且都是刻意的**：「問這輪的時間」問的是「先**問**誰」、「壓表登記」問的是「還有**誰**」，兩列都不吃計分也不排序（`customersToAsk()` / `customersToBook()`，見 ADR-0028、0041）。它們是提醒，不是佇列 —— 要決定「先壓誰」是壓表那一頁的事 |
| 來訪狀態的顏色、標籤或符號 | 只改 `domain/visits.js` 的 `STATUS_VIEW`，日曆、客戶詳情、試算表全部讀它。`app.css` 的 `.status-*` 只掛 class，色值全部在 `tokens.css`（淺色與深色兩份都要改，見 ADR-0039）。`tests/visits.test.js` 盯著兩邊對得上。**這一組是全站共用的，不可能只改一頁** |
| 日曆上任何一種東西的顏色 | 要分辨的是**七種**：待確認／已確認／已完成／未到／行事備註／休假／待辦。**色相已經用完了** —— 休假走斜線紋、待辦走方框勾勾記號，都是因為數不夠（ADR-0039、0045）。第八種一律先想「有沒有不用顏色的畫法」。行事備註可以自己挑顏色，色票名單與客戶備註共用 `MARK_COLORS`，但值另有一組 `--evcolor-*`（小圓點的顏色當 11px 的字對比度不夠，見 ADR-0040）；待辦不能挑 |
| 日曆上「待辦」那一類 | 它**就是 `notes` 裡有日期的那幾筆**，不是 `events` 的第三種類別，也不是 `tasks`（ADR-0044、0045）。所以「同步回隨手記」沒有東西要做 —— 沒有第二份資料。任務不上日曆 |
| 隨手記的欄位或那一列的樣子 | 四個地方共用 `ui/components/note.js`：待辦首頁那張卡、右下角泡泡、`#/todo/notes`、客戶詳情。**日曆上的待辦編輯器也是同一支的欄位** —— 長得不一樣會讓她以為是兩種東西。**包住它們的那一層（`.notemeta`）也算共用的一部分**：2026-09-01 之前只有兩個入口包了它，另外兩個裸放，於是那兩邊的丸子貼著輸入框、三排之間一點間距都沒有 |
| `tokens.css` 加一個顏色 | 淺色與深色**兩份都要有**（深色只有一份，在 `:root[data-theme='dark']`，沒有 `@media` 的複本，見 ADR-0055）。`tests/tokens.test.js` 盯著；改主題的 key 或選項時，`index.html` 與 `form.html` 的行內開機腳本要跟著改 |
| 任何一列的長按選單 | 有哪幾顆**只寫在 domain**（`domain/visits.js` 的 `visitActions()`、`domain/notes.js` 的 `noteActions()`、`domain/products.js` 的 `productActions()`），畫面不自己判斷 —— 兩份清單遲早有一份會准一個狀態機不准的轉移，而 Rules 不擋狀態機。**每一顆都要另外有一條點得到的路**，長按是捷徑不是唯一的路，見 ADR-0060。最多六顆（含「先不要」） |
| 營養品的名字或金額 | `components/buy.js` 的 `commitNewProduct()` 是**存檔前唯一補名字的地方**（三個入口都經過它）；讀的那一側 `itemsOf(e, master)` 要能從主檔認回舊資料的空名字。名字沒了會**同時**弄壞三個東西：顯示名稱、提醒那一句（變成「營養品：營養品」）與交付面板（整片空白）。金額那一格不可以有倍數限制（`step` 要是 1），整數那一條由 `firestore.rules` 定 |
| 稽核或回顧上那一句話 | 只寫在 `domain/audit.js` 的 `describeParts()`（拆成「誰」與「做了什麼」兩半，接起來走 `joinParts()`）。`ui/views/audit.js`、客戶詳情的變更紀錄、`domain/dayReview.js` 都讀它 —— 兩份寫法遲早有一份會漏掉名字或印出疊字（「勾掉某某的某某」就是這樣來的）。**額度與本輪可用性身上沒有名字**，只有路徑上有 id，所以名字由畫面解析後傳 `nameOf` 進來；問不到就不講，不編一個 |
| 一列任務要顯示什麼 | 種類、**來訪那一天**、課程，只寫在 `domain/taskRules.js` 的 `taskLine()`。三個地方讀它：客戶詳情、待辦中心、試算表的 TODO／FINISHED 區。**日期不是死線**（死線是它的前一天，兩個差一天最容易看錯人），也**不要拿死線 + 1 反推**（取消類的任務不是那樣算的）|
| 「今天做了什麼」要多列一種 | 分段只在 `domain/dayReview.js` 的 `STAGES`，**最後一段永遠收得下剩下的**（一則都不可以被丟掉，而且**照人與照流程兩種分組都要成立**）。它是稽核紀錄的白話版，**不可以為了它多寫任何一筆資料**，見 ADR-0062 |
| UI 文案、新的詞 | 用 `CONTEXT.md` 的詞，不要用它標 _Avoid_ 的同義詞 |
| 哪個網址算哪個環境 | 只寫在 `public/js/firebase-config.js` 的 `envOf()`。**模擬器那一份的 `projectId` 要跟三個地方一致**：這裡、`tests-e2e/start-emulators.sh` 的 `--project`、`tests-e2e/fixtures/emulator.js` 的 `PROJECT_ID`。對不上的症狀特別壞 —— fixture 塞進 A 命名空間、app 讀 B，每個 E2E 都是「畫面空的」而且**沒有錯誤訊息**。`tests/env.test.js` 盯著三邊。環境設定與部署指令見 `docs/STAGING.md` |
| `data/backup.js` 的 `exportAll()` 加一個集合 | `scripts/restore-backup.mjs` 的 `SECTIONS` 要跟著加一列，否則還原完會**少一整類資料**，而且要等到她去找那一類東西才會發現（`notes` 與 `events` 已經被漏掉過一次，見那支檔案的檔頭）。`tests/restore-backup.test.js` 盯著兩邊 |
| 寫入的等待與失敗文案 | 只寫在 `ui/toast.js`。**Firestore 的寫入 Promise 離線時既不 resolve 也不 reject**，所以 `catch` 接不到離線 —— 那條路走的是 `PENDING_MS` 的逾時，而它換上的那句話**不可以說「失敗」**（資料已經在本機快取裡，說失敗她會再存一次）。常駐的離線提示是另一件事，在 `ui/net.js` 與殼上的 `.netbar`。`tests-e2e/specs/10-offline.spec.js` 盯著 |
| 一個會建立新資料的按鈕 | `toast.withSaveState()` 要傳 `key`，除非那條路上有二次確認框（`confirmAction()` 與 `openActions()` 都是按下去就把節點移除，連點自然落空）。**同一件事有兩個入口時兩邊都要傳** —— 漏掉的那個一定是比較順手的那個（收件匣「收下」＝同月兩份可用性、待辦中心「產生連結」＝客戶手上兩條連結，兩次都是這樣來的） |
