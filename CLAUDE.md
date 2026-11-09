# CLAUDE.md

專案的完整需求背景、資料模型、業務規則與名詞表在 `SPEC.md`。動工前先讀。

## 文件分工

同一件事只寫在一個地方，其他地方用一行連結指過去。

| 檔案 | 只放 |
|---|---|
| `SPEC.md` | 需求、資料模型、業務規則、畫面規劃 |
| `CONTEXT.md` | 詞彙表。定義詞是什麼，不放實作 |
| `docs/adr/` | 為什麼這樣決定。一支一個決定，寫理由不寫作法。慣例見 `docs/agents/domain.md`。**舊的不改，所以讀之前先看 `docs/adr/README.md` 的索引**：哪一支被推翻了哪一點、現在照哪一支 |
| `docs/legacy/` | 舊系統的結構，唯讀參考 |
| `docs/操作手冊.md` | **怎麼操作 app**：核心動線一步一步，給沒看過的人。**一條業務規則都不定義** —— 規則一律用一行連結指回 `SPEC.md` 或 ADR |
| `docs/常見問題.md` | 「我按了 X 為什麼沒有 Y」。每一條三段：看到什麼、為什麼、怎麼辦 |
| `docs/邊界測試清單.md` | 上線前要親手點過的極端情境。**刻意沒有 happy path** —— 那些由 `tests-e2e/` 盯著 |
| `docs/STAGING.md` | **怎麼操作**兩個環境：第一次設定、推 Rules、加白名單、清空 staging、還原演練、上線檢查表。為什麼這樣設計不寫這裡（那在 `.scratch/PRODUCTION_AUDIT.md` 與 ADR-0118） |
| `docs/MacroDroid設定.md` | **她手機上**那個打開 LINE 對話的 MacroDroid 巨集怎麼設（觸發條件、兩個變數、每一步）。app 那一側的規則不寫這裡（在 ADR-0157 與 `.claude/rules/customers.md`「客戶的 LINE 那一格」那一節）；**截圖不放**（畫面上有好友的名字） |
| `.scratch/<feature-slug>/issues/` | 待辦的 issue，不使用 GitHub Issues。動工前先看有沒有相關的，格式見 `docs/agents/issue-tracker.md` |
| `docs/agents/lessons.md` | 之前的 session 一再犯、測試又沒抓到的坑（形狀＋一句自問）。**動工前先掃一遍**；踩到新的就照格式補一條 |
| `.claude/rules/` | **容易漏掉的連動**：一個主題一份，改了 X 要一起檢查哪些。讀到那份開頭 `paths:` 列的檔案時自動載入；索引在本檔「容易漏掉的連動」最後 |
| `docs/agents/worktree.md` | **在 worktree 裡做事，第一件事照它接好** CodeGraph、graphify、`node_modules` —— 少了的時候 CodeGraph 會安靜地查到別條分支的程式碼。**`.local` 不建連結一直放著**（刪 worktree 時可能順著刪進真資料），過濾網寫主資料夾的路徑 |

寫新文件前先確認這件事還沒被寫過。

## 上線

`main` 上正式。**2026-10-20 切換完成，正式站是唯一的一份真資料**（ADR-0165）：她每天記的只存在那裡。所以：

- **永不整份重匯、不清空重來。** 錯的在 app 裡改；app 改不到、或一次很多筆，寫一支只動那幾筆的腳本，一律四步：**備份 → 試跑（只數不動）→ 寫 → 整份讀回來比對**
- **改資料的形狀要帶著既有資料走**：配一列資料健檢（`.claude/rules/master-data.md`「`domain/seed.js`（種子）加一筆、改一格」那一節），種子改了既有資料庫不會跟
- **上 `main` 之前**請她在正式站 設定 → 匯出備份（放 `.local/references/`）

`develop` 上 staging，**那裡是切換那天正式站的複本**（ADR-0118 的預演做完了；之後各走各的，staging 上記的不搬）。所以：

- **staging 的畫面上有真名**：在上面測試時，截圖、驗收清單、PR 內文一個真名都不帶
- **會寫入的驗收步驟在本機模擬器走**（`npm run emulators` ＋ `seed:staging` 對模擬器）；staging 給她點
- `npm run seed:staging` 只准跑在模擬器上（它會把主檔整份蓋回種子）。`npm run staging:reset` 會把 staging 上那份複本清掉 —— 要讓 staging 跟上正式站，用正式站的備份＋`scripts/restore-backup.mjs`

**PR 的基底是 `develop`，不是 `main`。** 直接 PR 進 `main` 等於這段程式沒有在
staging 上被點過 —— 只有急件這樣做。

**合併**：PR 的 CI 全綠就合進 `develop`，不用再問（她 2026-10-15：「最後要幫我開pr以及合併進develop」）。合完 staging 會自動部署；拍照的 Function 不歸 CI，要部署的照 `docs/STAGING.md`。**進 `main` 要她另外說。**

第一次設定、部署指令、白名單、清空 staging、還原演練都在 `docs/STAGING.md`。

**真實客戶姓名與健康資訊一個字都不能進版控** —— 不只 `docs/`，註解、測試、`.scratch/` 的 issue、`.claude/` 的 skill 全都算。例子一律寫「客戶A」，規則跟名字的字數有關時用假名（王小明）。`tests/no-secrets.test.js` 盯著。

**這個 repo 是 public。** 檔案、commit 訊息、PR 的標題與內文、Actions 的 log，推上去那一刻就公開，而且收不回來。`tests/no-secrets.test.js` 只掃被追蹤的檔案，名單也只在她的機器上 —— commit 訊息與 PR 內文沒有人掃，只寫名、不寫姓的叫法它也掃不到。所以**推之前、開 PR 之前自己看一眼**：有沒有真實客戶的名字、病歷號、健康資訊。

她自己的 `.xlsx`／`.ics`／截圖放 **`.local/references/`**（`xlsx/`、`ics/`、`images/` 三格）。`.gitignore` 的 `/.local/` 那一條擋著，驗證方式是 `git check-ignore -v <路徑>` —— **擋沒擋住從畫面上看不出來**，所以每次新開一個資料夾都要真的跑一次。不要另外開名字：多一個要記得加進 `.gitignore` 的地方，漏掉一次就是真實客戶健康資訊進了版控。
**app 自己產生的檔案也算**：設定頁匯出的 `排課系統備份-*.json`（全部客戶＋健康資訊＋密鑰）與服務帳號金鑰 `*-sa.json` 放在哪一層都擋著（`tests/backup-files-ignored.test.js` 真的跑 `git check-ignore`），但照樣放 `.local/references/`。

## 測試怎麼跑

日常驗收 `npm run verify`（單元測試 ＋ 這次改動相關的那幾支 E2E）。**不要每次全跑 E2E** —— 本機 10/14 量的是 47 支就 34 分鐘，而她在等、電腦會熱。全量交給 CI（`gh workflow run e2e-full.yml --ref <分支>`，六台）與上線前 —— **開進 `main` 的 PR 一開就自己跑那六台**（`e2e-full.yml` 的 `pull_request`），合之前看它綠了沒（它不是必要檢查）。

- 新增一支 spec 要登記進 `tests-e2e/related.js`，**新增一個被追蹤的檔案也要**（`tests/e2e-related.test.js` 盯著）。
- E2E 的 app 是模擬器 hosting（`127.0.0.1:5000`）在服務的，而**它服務的是啟動它的那個目錄的 `public/`**，跑完不會自己關，E2E 也不會幫你開。所以換一個 worktree 跑之前要先依 port 停掉殘留的那一組，再從**這一組自己的目錄**起 —— 不然測到的是別的分支的程式碼，而症狀是「明明改好了卻還是紅」。
- 她的兩台都設 `E2E_WORKERS=2`（`~/.claude/settings.json` 的 `env`）：模擬器與 E2E 要帶同一個值。
- E2E 裡**不要用 `page.waitForTimeout()`**，等 locator 的狀態（`app.layer()`、`app.saved()`、`app.settled()`）。
- 「這次改動」怎麼算、`related.js` 怎麼挑、多組模擬器的 port 與收法、為什麼不用固定等待：`.claude/rules/e2e.md`。

修 bug 先寫一支重現得出來的失敗測試。**改 domain 規則、狀態機推導、跨模組資料結構的那幾次，動工前先在 `.scratch/<feature-slug>/issues/` 開一支 issue**；純文案與 CSS 不用。

交付時條列一份**她可以照順序點的手動驗收清單** —— 是「你可以怎麼點」（`日曆 → 點那一格 → 點那一列 → 按鉛筆`），不是「我修好了什麼」。**寫的人要真的走過那條路**：同一件事在兩個入口的選擇器常常不一樣（壓表的品項丸子是 `[data-ivproduct]`、來訪編輯器是 `[data-chip="s0-iv"]`），沒走過的清單會叫她去點一個不存在的東西。

## 容易漏掉的連動

動到已經存在、別處在用的程式碼之前，以及修完 bug 之後，照 `ripple-check` skill 查牽連、找同一個形狀的缺陷（CodeGraph、ast-grep；文件與決定查 graphify 的圖）。查完之後要回來對的是下面這張表與 `.claude/rules/` 對應主題的那一份：

- `.claude/rules/` 的每一份**讀到它開頭 `paths:` 列的檔案時會自動載入**；新寫一個檔、或要動的東西不在任何一份的 `paths:` 裡，照最後的索引自己讀。
- **新長出來的連動補進對應主題的那一份**（沒有合適的就開一份、加進索引），不加回這裡 —— 這一份每次對話都會載入。
- 舊的註解、ADR、測試寫「CLAUDE.md 連動表『X』那一列」的，那一列現在是 `.claude/rules/` 裡標題同名的那一節（grep 那個標題）。

**`.local/` 的資料不進任何一張圖**（裡面有真名，工具讀檔不經過 `redact.mjs`）：CodeGraph 整個不讀（`codegraph.json`）；graphify 只讀 `.local/.graphifyignore`（在私人 repo 裡）放回的那幾份 —— 目錄、知識庫、`references/` 的目錄、挑過的記憶，一個真實值都沒有的（2026-11-04 她要的：讓查圖的時候知道手上有哪些真資料）。放回一份、更新圖之前跑 `private-graph-check.mjs`（印出被過濾網遮掉的那幾行，遮過才印）。skill 的 `private-index-check.mjs` 會印 `.local` 的檔名，這個專案要跑一律接 `| node .local/references/redact.mjs`。

| 改了這個 | 一定要一起檢查 |
|---|---|
| `/domain` 的業務規則 | `SPEC.md` 對應章節。推翻既有決定就補一支 ADR，不要改掉舊的。**新長出來的連動關係要補進 `.claude/rules/` 對應的那一份** —— 不補的話它的價值會隨每一輪重構衰減，而下一輪又得從頭清查一次 |
| `public/` 底下任何檔案 | `public/sw.js` 的 `SHELL` 清單與 `VERSION`，**再跑 `npm run shell:snapshot`**。程式檔是先用手機裡的（ADR-0167）：**忘了升 `VERSION` 的代價是她的手機永遠停在舊版**（以前只是慢一輪）—— `tests/shell-version.test.js` 拿提交著的快照（`tests/shell-version.snapshot.json`：VERSION ＋ `public/` 內容雜湊）擋著，**同一個 VERSION 只能對一份內容**，所以同一支 PR 裡第二次動 `public/` 也要再加一（不再是「後面的不用再升」）。**同時開好幾支 PR 時每一支挑不同的號**；合併時解那一行的辦法是**留數字大的那一個再加一**、重跑快照（合起來的內容哪一個號都沒對過）。新的一版是在背景裝好、等她點畫面最上面「有新版本・點一下更新」才換（`ui/swUpdate.js`）；打開 app 的導覽只有 `/`、`/index.html` 回手機裡的，`/form.html` 與 `/__/auth/…` 照舊走網路（`sw.js` 的 `APP_PAGES`）。SDK 與字體在自己那一格（`EXTERNAL`），不跟著版號清 |
| 做完一個開發步驟 | `README.md` 開發狀態表打勾 |
| 新增集合、欄位、要排序的查詢 | `firestore.rules` 要開洞（預設全拒），`firestore.indexes.json` 要補索引 |
| UI 文案、新的詞 | 用 `CONTEXT.md` 的詞，不要用它標 _Avoid_ 的同義詞 |

### 索引：`.claude/rules/`

| 檔案 | 什麼時候讀 |
|---|---|
| `abovee.md` | 拍 Abovee 的任何一步（讀照片、對既有的段、確認層、照片為準改狀態／時間／扣法）、照片上的人是 app 裡的哪一位、主檔的 `aboveeNames`、月底對帳 skill 讀的那幾支 |
| `photos.md` | 拍訂購單、療程單、AI 的抄字格式（`functions/transcripts/`）、拍照 Function 的防護與單價、`aiUsage`、哪一種照片要存、`storage.rules` |
| `visits.md` | 一段來訪的狀態與算不算數、同一天第二筆、畫面上講「哪一段／哪一天」、記一句與取消理由、「第 N 個時段」、新增一個會建立時段的入口、一段叫什麼、指派誰、診間、復能器材、排多久、點滴品項、器材的特別提醒 |
| `visit-editing.md` | 一筆來訪改得動的地方、長按選單、讀取卡片（畫哪幾段、上面那一排警示）、算次數與驗證要拿哪些來訪（讀不完整不存）、存的時候手上那一份是舊的、進度追蹤「這個月」那一列 |
| `followups.md` | 健檢與二返（配對、還欠幾次、那條鏈上的待辦）、報告到手之後那一站、n返、健檢不是我排的（`examNotMine`） |
| `one-time-guests.md` | 一次性客人（`oneTime`）；**新增一份會列客戶的名單時也要讀** |
| `entitlements.md` | 額度那一排的順序、一筆額度叫什麼、次數的算法、方案的微調、「她賣了什麼」那張表、客戶抬頭與「買過什麼」、送的／體驗（`giftKind`）、營養品 |
| `tasks.md` | 取消類的待辦、任務什麼時候長（兩個時機）、被刪掉的任務算不算做過、一門課壓哪幾個系統、勾掉一張待辦、待辦中心的兩張抽屜、一列任務顯示什麼、待辦首頁的列與逾期／今天／明天 |
| `sheet.md` | 試算表的註記、試算表要讀哪些來訪、`SYNC_FORMAT` 與 `.gs`（指紋、版面） |
| `notes.md` | 隨手記（`linkId`、欄位、日曆上的待辦）、Android 小工具與共用情境檔 |
| `customers.md` | 客戶身上的標記、備註與長備註、LINE 那一格、要貼給客戶的話、打字找客戶的框、客戶改名、刪掉一位客戶 |
| `master-data.md` | 種子加一筆或改一格、人員的全名與簡寫、課程的分類／設定暫定／醫師、設定頁收起來的欄位、排序權重的回復預設值 |
| `import.md` | 合併檔（`baobao-merge/vN`）與舊表的欄位、匯入的來訪建成什麼狀態、預設勾哪些、行事曆的雜事、跑很久的匯入按鈕 |
| `scheduling.md` | 壓表那一頁、「先看誰」的排序、本輪可用性、不能的時間、客戶自己填的時間 |
| `consequences.md` | 一句「按下去會發生什麼」、分得出「不要了」與「手滑關掉」的確認框、寫入的等待與失敗文案、建立新資料的按鈕、稽核的句子與欄位、今天做了什麼、資料健檢的版面 |
| `ui-layout.md` | 蓋住整頁的一層與全螢幕、貼在畫面底部的東西、小圖示的觸控區、綠色的字、`tokens.css`、日曆與來訪狀態的顏色 |
| `ui-patterns.md` | 存起來的 `pushLayer()` handle、換頁帶一句話（`leaveFor`）、常駐說明與 `tip()`、`number`／`time` 欄位、共用元件的屬性名、日曆的標題、備忘錄 |
| `app-env.md` | 打開 app 那一段、哪個網址算哪個環境、備份加一個集合、`firebase-tools` 的版本 |
| `e2e.md` | E2E 挑哪幾支、多組模擬器、等待的寫法 |
