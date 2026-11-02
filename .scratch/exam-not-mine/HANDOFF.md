# HANDOFF：健檢不是我排的（exam-not-mine）

分支 `claude/exam-not-mine`（從 `develop` 093e1d9c 開，**在主資料夾**，不是 worktree）。主控是 2026-11-02 談設計的那個 session。

## 分段

| 段 | issue | effort | 狀態 |
|---|---|---|---|
| 一 | 01 決定紀錄、02 時段形狀與驗證、03 試算表與月底對帳、04 紅字與確認框 | xhigh | **done**：01～04（9c4351ca、97f3da7b、4c2f8b99、26c1080）＋ E2E `82`；相關 E2E 跑過（見「中途發現 → 段一」最後一條） |
| 二 | 05 那一顆與收合、06 日曆新增／來訪編輯器、07 壓表 | high | **done**：05～07（2e5c6df、76ea4e2、07 那一個）＋ E2E `83`、`84`；`npm run verify` 見「中途發現 → 段二」最後一條 |
| 三 | 08 拍 Abovee domain、09 拍 Abovee 確認層、10 文件與收尾 | xhigh | todo |
| 四 | `/matt-code-review` 審這一輪全部 | xhigh | todo |
| 五 | 照審查修、手動驗收清單（自己在模擬器走過）、CI 全量、開 PR 進 `develop`、照 CLAUDE.md 合併 | medium | todo |

## 每一段共同的規矩

- 先讀 `CLAUDE.md`、`docs/agents/lessons.md`、`.scratch/exam-not-mine/spec.md`、這份 HANDOFF 的「使用者已經決定的」「過目抓到的」「中途發現」
- **改一個已經存在的函式、型別或畫面上的字之前，照 `ripple-check` skill**：`codegraph sync` → `codegraph callers`／`impact` 列出呼叫端、逐條寫下會怎麼受影響；
  這個專案是純 JS，**再用 grep 函式名對一次**；Firestore 欄位名（`examNotMine`）、畫面上的字另外 grep。修完 bug 照它找同一個形狀的地方
- 一支 issue 一個 commit：先寫一支會紅的測試、跑過確認紅 → 修到綠 → `npm run verify` → commit → issue 的 `Status: done`、底下寫「做完時留下的」
- **動到 `public/` 的每一個 commit**：`public/sw.js` 的 `VERSION` 加一、`npm run shell:snapshot`（`tests/shell-version.test.js` 盯著；同一支 PR 第二次動 `public/` 也要再加一）
- 新增一個被追蹤的檔案（spec、測試）要登記進 `tests-e2e/related.js`（`tests/e2e-related.test.js` 盯著）；新的測試檔先 `git add` 再跑一次 `npm test`（lessons 十三）
- E2E 不用 `page.waitForTimeout()`；**本機不跑全量 E2E**（她的電腦會熱）—— 全量在段五交給 CI
- **一個真名都不准進版控**：客戶寫「客戶A」、人員寫「某醫師」。commit 訊息也算（repo 是 public）
- 中途發現的事不岔出去修：記進下面「中途發現」（哪裡、什麼情境會錯、建議），段末回報；使用者說要修的，修之前再照 `ripple-check` 查一次牽連
- 同時最多兩個 subagent
- **主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON**
- 段末要交：每支一個 commit、`Status: done`、「做完時留下的」、`npm run verify` 綠、更新這份 HANDOFF（分段表的狀態、中途發現、要使用者決定的）、
  **下一段的開場寫進下面「每一段的開場」**；最後回覆簡短說做了什麼、卡在哪

## 使用者已經決定的

- 一顆「健檢不是我排的」管二返與三返～十返；不扣額度、不接健檢（spec「談定的設計」）
- 收合那一顆的字「送的／體驗／其他…」
- 沒有健檢的客人，那一顆收起來點開才看得到
- 拍照不替她按、不替她勾；日曆、壓表的第幾返不預選
- 試算表：二返進「二返（不算次數）」、排在三返那幾列旁邊
- **收合那一題**（2026-11-02 她回「可以」，照主控的建議）：`foldOpen()` 不動（沒有額度的客人收合照舊自己打開，E2E `67` 的 G6／G13／G14 照舊）；
  「健檢不是我排的」在收合裡**再收一層「其他 ▸」**（用 `giftFold.js` 既有的分類那一套，`data-giftfold-group`），點了才出現；這一段選著它時那一層打開

## 要使用者決定的

（目前沒有）

## 過目抓到的

2026-11-02 唯讀 subagent 過目，主控自己再對了最重的三條（M1、M3、M7，都屬實）後改進 issue：

- M1 讀標記那一支放 `masterData.js`（放 `nthFollowup.js` 會繞成循環 import）；判斷一律 `=== true`、不從形狀推 → 02
- M2 三返～十返要寫快照 `courseName`（不然日曆印成「二返(30)」）；`nth` 是 null 時 `stop()` 帶著課程回去 → 02
- M3 來訪編輯器自己組那一排、不叫 `slotOptionsFor()` → 那一顆由獨立函式產生、不塞進 `giftOptions()` → 05、06
- M4 `giftFold.html()` 照 `other` 分兩塊，新的一顆會被併進「醫師門診 ▾」；副字會印「剩 —」→ 05
- M5 `foldOpen()` 對她要用的那種客人一定開著 → 「要使用者決定的」
- M6 拍 Abovee 的 `picksOf()` 會丟掉返數、不帶標記 → 08
- M7 既有的一段改成帶標記沒有任何確認框會跳，但會把二返額度還回去、「約二返」重新長出來 → 04、06
- M8 來訪編輯器 `readDraft()` 三個出口都會把標記原封帶過去 → 06（主控沒逐行再對，段二動工時照 ripple-check 確認）
- S1 驗證用 `isFollowupCourse()`（任何一門二返都算）、`abovee.js:317` 不改；S2 沒有標記＝沒有那一格；S3 月底對帳不另開桶；S4 同名兩列併成一列；
  S5 有沒有接得上的健檢問 `examChoicesForNth()`；S6 確認框那一句照 `giftNames(…, added)`、帶標記的三返只講新的那一句；S7、S8 壓表與「第幾返」2～10；
  S9 原本的 08 拆成 08（domain）＋ 09（確認層），文件改成 10，段三改 xhigh；S10～S13 補進 01、02、05、10
- 真名：用她機器上的別名表逐檔比對，0 筆

主控自己定的（不問她）：照片認二返照舊（S1a）、同名兩列併一列（S4）、帶標記的三返確認框只講新的那一句（S6）。

## 中途發現

### 段一

- **一般的三返那一句提醒寫「二返 還沒選醫師」**（`visits.js` 約 2116 行 `${course.name} 還沒選醫師`）：n返 借二返那門課，句子印課程名、不印返數。
  既有行為（不是這一輪弄的），帶標記的三返也一樣。建議：那一句改走 `followupName()`／`slotSay()`。沒修
- **E2E：02、03 的 commit 只跑了全套單元測試（5265 支綠），相關 E2E 還沒跑**。`--related --dry` 挑到 44 支（動到 `visits.js`／`masterData.js`），
  本機一個 worker 要二、三十分鐘，所以留到段一最後一次跑（模擬器要先 `npm run emulators`；01 那一次 smoke 綠了）。
  這幾支 commit 只加了帶 `examNotMine` 才走的分支，畫面還沒有任何一處傳它
  → **段一（續）補了**：新的 E2E `82-exam-not-mine`（帶標記的段存進 Firestore、日曆名字、長按確認存得下去、待辦照二返那門課）；
  `--related` 跑了一次（結果見最後一條）
- **n返 那一句「三返是加約的」看整筆、不看這一次新加的段**（`consequences.js` 的 `nthLabels(visit)`，`bookingConsequences()` 用；
  `aboveeConsequences()` 那一圈有照 `added`）：併進一天原本就有一段三返的來訪、再加一段復能，確認框照樣講「三返是加約的」。
  既有行為（過目 S6 記下的），04 只讓它跳過帶標記的段。建議：`nthLabels(visit, added)` 照 `giftNames()` 的寫法。沒修
- **`chargeSwitchConsequences()` 多收 `customer`、`chain`**（04）：`visitEditor.js:1394` 現在沒傳 → 改成帶標記時「約二返」那幾句不講（不會講錯，只是少講）。06 接
- **這台雲端 VM 沒有 `codegraph`**（`which codegraph` 空的、`npx` 也沒有）：04 的 ripple-check 用 grep 做。在她家裡那台跑的段照舊用它
- **本機的 `develop` 停在 f36c654**（舊的），`--related` 會拿整條舊差異挑（lessons 十二）。04 時已 `git branch -f develop origin/develop`（093e1d9）
- **相關 E2E 結果（11/2，雲端 VM、CI=1、一個 worker）**：`--related` 挑 48 支（對 develop 動了 27 個檔案），**全綠**。
  中途模擬器被背景 30 分鐘上限砍掉（停在 `67` 前兩條），重起之後補跑 `67`～`82` 那 8 支：56 passed。前面 00～65 那段 301 passed，
  其中 `29-slot-first` S2 第一次逾時、retry 綠（那一頁這一輪沒動）—— 記著，段五 CI 全量再看一次。**在雲端 VM 起模擬器要給長的 timeout**（`run_in_background` 預設 30 分鐘會砍）

### 段二

- **拍 Abovee 的確認層暫時濾掉那一顆**（05）：`aboveeConfirm.js` 的 `optionsFor()` 最後 `.filter((o) => !o.isNotMine)` ——
  `pickOption()` 還認不得 `NOT_MINE_PICK`，按了會把那一列清空。**09 接上時拿掉那個 filter**
- **來訪編輯器「還沒選第幾返」是草稿上的 `pendingNth: true`**（06）：只在畫面上、`submit()` 最前面擋、從來不存（`plainSlot()` 拿掉）。
  理由：「帶標記、沒有返數」就是二返 —— 交給 `validateVisit()` 的話她沒按也存得下去。壓表不需要（`view.nth` 是 null → `slotFromPicks()` 擋「先選第幾返」）；
  **拍 Abovee（08）要想同一件事**：照片不是回訪、或讀不出返數時不預選，那一列的 `nth` 是 null → `picksOf()` 交給 `slotFromPicks()` 會擋，但確認層畫列時要講出來（不是安安靜靜地組不出來）
- **`notMineOption()` 多了 `{ keep }`**（06）：這一段就是它、二返那門課後來停用了（或多設了一門），那一顆照樣列 —— 不然那一排一顆都沒按著。拍 Abovee 不需要（新的列）
- **讀取卡片、日曆、日／週那一列看不出一段二返是「健檢不是我排的」**：照 spec 它照二返那門課的名字（`二返(30)`、`三返(30)`），跟一般的二返長得一樣。
  不是 bug（spec 沒要求標），記著給段四／她看：要不要在讀取卡片上多一個小字「健檢不是我排的」。沒做
- **二返指定的那一科剛好一位醫師時會先選好**（`doctorChoicesFor()` 的 `preselect`，新的一段的規則）：壓表與編輯器都照走。E2E `84` 的 `ensureDoctor()` 因此先看按著沒
- **相關 E2E**：05 跑了 `49`、`56`、`67`、`72`（27 passed）；06 跑了 `13`、`25`、`29`、`49`、`67`、`72`、`82`（65 passed）＋ `83`（4 passed）；07 跑了 `84`（3 passed）。
  段末 `npm run verify`（`--related` 對 develop，雲端 VM、CI=1、一個 worker）：單元 5310 綠；對 develop 動了 41 個檔案 → **58 支、424 passed（38.1 分），一支 flaky 都沒有**

### 段三

## 每一段的開場

### 段一（effort xhigh）

這一輪在做「健檢不是我排的」：時段上多一格 `examNotMine: true`，讓健檢不是她排的客人可以排二返、三返～十返，不扣額度、不接健檢，其餘（日曆、醫師、待辦、試算表）照二返那門課。
分支 `claude/exam-not-mine`，在主資料夾 `C:\Users\DELL\Desktop\baobao-wellness-clinic-scheduler`（不是 worktree）；目前只有主控寫的 `.scratch/exam-not-mine/` 那一個 commit。

**這一段做 01 → 02 → 03 → 04，照這個順序**（03、04 都吃 02）。**不做** 05～10（畫面在段二、段三）。這一段只動 domain、文件與測試，不碰 `public/js/ui/`。

先讀：
- `CLAUDE.md`、`docs/agents/lessons.md`
- `.scratch/exam-not-mine/spec.md`（全部）
- 這份 HANDOFF 的「每一段共同的規矩」「使用者已經決定的」「過目抓到的」
- issue 01～04（每一支的「動工前先讀」照著讀）

照「每一段共同的規矩」做，尤其：改既有的函式之前照 `ripple-check`（`codegraph sync` → `callers`／`impact`，再 grep 一次函式名與 `examNotMine`）；
修完找同一個形狀的地方；中途發現記進「中途發現 → 段一」、不岔出去修；同時最多兩個 subagent。動到 `public/` 的每一個 commit 都升 `sw.js` 的 `VERSION`、跑 `npm run shell:snapshot`。

這一段沒有要先問她的題目（收合那一題是段二的，主控會先問好 —— 11/2 她已經回了，見「使用者已經決定的」）。

**主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。**

做完要交：每支一個 commit（commit 訊息不帶任何真名）、`Status: done`、issue 底下「做完時留下的」（實際做成什麼：函式名、欄位、測試檔名；02 要記「她主檔上二返那門課有幾門」）、
`npm run verify` 綠、更新這份 HANDOFF（分段表的狀態、中途發現、要使用者決定的）、**段二的開場**寫進下面（照段一這一份的格式，把 05～07 要知道的 02、04 實際做成的名字寫進去）；
最後回覆簡短說做了什麼、卡在哪。

### 段一（續）：只剩 04（effort xhigh）

段一做到 03 時 5 小時額度到頂停下來。接手的人：
- 先讀 `CLAUDE.md`、`docs/agents/lessons.md`、`spec.md`、這份 HANDOFF 的「每一段共同的規矩」「過目抓到的」「中途發現 → 段一」、issue 02、03 的「做完時留下的」（02、04 要用的名字都在 02 那一份）
- 做 **issue 04**（紅字＋確認框）：照 issue 04 的「要做的」。要用的：`masterData.js` 的 `isExamNotMine()`、`EXAM_NOT_MINE_LABEL`；有沒有接得上的健檢問
  `nthFollowup.js` 的 `examChoicesForNth()` 的 `pickable`（不要用 `examChoicesFor()`）；新的 `source` 要進 `visits.js` 的 `MUST_SEE`；
  確認框句子照 `consequences.js` 的 `giftNames(…, added)` 寫法；`chargeSwitchConsequences()` 要擴到「改成帶標記／拿掉標記」（M7）
- `public/sw.js` 現在是 **v211**，04 動 `public/` 就升 v212、跑 `npm run shell:snapshot`
- 04 做完：`npm run emulators`（背景）→ `node scripts/e2e.mjs --related` 跑一次（會挑到四十幾支，一個 worker），補上 02～04 欠的 E2E
- 段二的開場要帶到收合那一題的答案（「使用者已經決定的」最後一條）：05 照它畫第三塊、08 那一句照它寫
- 然後照原本段一的交付：issue 04 `Status: done`＋「做完時留下的」、更新這份 HANDOFF、寫下面段二的開場（05～07 要知道 02 的 `slotFromPicks()` 收 `picks.examNotMine: true` ＋ `nth` 2～10、標記贏、
  `examNotMineCourse()` 剛好一門才回；04 做成的名字）
- **主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON**

### 段二（effort high）

這一輪在做「健檢不是我排的」：時段上多一格 `examNotMine: true`，讓健檢不是她排的客人可以排二返、三返～十返，不扣額度、不接健檢，其餘（日曆、醫師、待辦、試算表）照二返那門課。
分支 `claude/exam-not-mine`，在主資料夾（她家裡那台 `C:\Users\DELL\Desktop\baobao-wellness-clinic-scheduler`；雲端 VM 上是 `/home/baobao/acct1/baobao-wellness-clinic-scheduler`），不是 worktree。
開工前 `git pull`、`git status` 乾淨、跟 origin 一致；本機 `develop` 對齊 `origin/develop`（lessons 十二）。

**段一做完了**（01～04 ＋ E2E `82`）：domain 那一側全部在，畫面一處都還沒傳標記。**這一段做 05 → 06 → 07，照這個順序**（06、07 都吃 05）。不做 08～10（拍 Abovee 與文件在段三）。

先讀：
- `CLAUDE.md`、`docs/agents/lessons.md`（尤其一：三個入口只改到一個；五：確認框講真的會發生的事）
- `.scratch/exam-not-mine/spec.md`（全部）
- 這份 HANDOFF 的「每一段共同的規矩」「使用者已經決定的」「過目抓到的」（M3、M4、M5、M7、M8、S7、S8、S13）「中途發現 → 段一」
- issue 02、04 的「做完時留下的」（名字都在那裡），再讀 05～07

段一做成、這一段要用的名字：
- `masterData.js`：`isExamNotMine(slot)`（**全站只准問它**，`tests/exam-not-mine.test.js` 掃 `public/js`：除了 `masterData.js` 不准寫 `.examNotMine`，畫面自己的草稿也問它）、
  `EXAM_NOT_MINE_LABEL`（'健檢不是我排的'，05 那一顆的字用它）、`examNotMineCourse(courses)`（二返那門課，**剛好一門才回**、刪掉停用的不算 —— 「畫不畫那一顆」問它；她主檔上現在一門）
- `slotDraft.js` 的 `slotFromPicks()`：收 **`picks.examNotMine: true` ＋ `picks.nth`（2～10）**。**標記贏**（`entitlementId`／`isNth`／`giftCourseId`／`giftKind`／`followupForVisitId` 一律不看）；
  `nth` 不是 2～10（含 null：不預選）→ `stop('先選第幾返')`，`course`／`assigns` 照樣交回去（醫師那一排靠它畫）；二返沒有 `followupNth` 這個鍵、3～10 寫快照 `courseName`
- `validateVisit()`：帶標記的段只放過那一種形狀（`examNotMineErrors()`），哪一格不對講一句
- 04：紅字是 `warningDetails()` 的 source **`examNotMine`**（進 `mustSee()`；二返而身上還有二返額度、或任何一段而有接得上的健檢）—— 壓表與編輯器存檔前那一道 `confirmReview(warnings)` 本來就列 warnings，不用另接；
  確認框那一句在 `bookingConsequences()`（新加的帶標記段，帶標記的三返不再講「加約的」）；
  **`chargeSwitchConsequences()` 已經認得「改成帶標記／拿掉標記」**，06 要在 `visitEditor.js:1394` 多傳 `customer: ctx.customer`、`chain: await chainInputs(customerId, coursesById)`（`data/visits.js:471`）——
  不傳的話「約二返」重新長出來那一句不講

**收合那一題她回了**（「使用者已經決定的」最後一條）：`foldOpen()` 既有的判斷不動（沒有額度的客人收合照舊自己打開，E2E `67` 的 G6／G13／G14 照舊）；
「健檢不是我排的」在收合裡**再收一層「其他 ▸」**（`giftFold.js` 既有的分類那一套，`data-giftfold-group`），點了才出現；這一段選著它時那一層打開。05 照這個畫第三塊；收合那一顆的字改「送的／體驗／其他…」（三種形狀都改）

照「每一段共同的規矩」做：改既有的函式之前照 `ripple-check`（有 `codegraph` 就 sync → callers／impact；雲端 VM 上沒有，用 grep）；先寫會紅的測試；
動到 `public/` 的每一個 commit 升 `sw.js` 的 `VERSION`（**現在 v212**）、跑 `npm run shell:snapshot`；06、07 各一支新的 E2E（登記進 `tests-e2e/related.js`），04 的紅字與確認框也在那兩支量（`82` 沒量，因為段一還沒有畫面傳標記）；
本機不跑全量 E2E；中途發現記進「中途發現 → 段二」、不岔出去修；同時最多兩個 subagent；一個真名都不准進版控（commit 訊息也算）。

**主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。**

做完要交：每支一個 commit、`Status: done`、issue 底下「做完時留下的」（05 那一顆的常數名、旗標名、`giftFold` 第三塊的屬性；06 的 `readNotMineSlot()`；07 的 view 怎麼表示）、
`npm run verify` 綠、更新這份 HANDOFF（分段表、中途發現、要使用者決定的）、**段三的開場**寫進下面（08 要知道 05 的常數與 `slotFromPicks()` 的 picks、09 要知道 `giftFold` 第三塊怎麼開）；
做完 commit 並 push；最後回覆簡短說做了什麼、卡在哪。

### 段三（effort xhigh）

這一輪在做「健檢不是我排的」：時段上多一格 `examNotMine: true`，讓健檢不是她排的客人可以排二返、三返～十返，不扣額度、不接健檢，其餘（日曆、醫師、待辦、試算表）照二返那門課。
分支 `claude/exam-not-mine`，在主資料夾（她家裡那台 `C:\Users\DELL\Desktop\baobao-wellness-clinic-scheduler`；雲端 VM 上是 `/home/baobao/acct1/baobao-wellness-clinic-scheduler`），不是 worktree。
開工前 `git pull`、`git status` 乾淨、跟 origin 一致；本機 `develop` 對齊 `origin/develop`（lessons 十二）。

**段一、段二做完了**：domain（01～04）、那一顆與收合（05）、日曆新增／來訪編輯器（06）、壓表（07）。**這一段做 08 → 09 → 10，照這個順序**（09 吃 08；10 是文件與收尾）。

先讀：
- `CLAUDE.md`（連動表「拍 Abovee 記很多段」那一列**全部讀**）、`docs/agents/lessons.md`（尤其一：同一個入口的兩個時機也算兩個入口；二：列出來的每一顆按下去存得下去嗎）
- `.scratch/exam-not-mine/spec.md`（全部）
- 這份 HANDOFF 的「每一段共同的規矩」「使用者已經決定的」「過目抓到的」（M6、S1、S4、S6、S9）「中途發現 → 段一、段二」
- issue 02、04、05、06、07 的「做完時留下的」（名字都在那裡），再讀 08～10

段一、段二做成、這一段要用的名字：
- `masterData.js`：`isExamNotMine(slot)`（**全站只准問它**，`tests/exam-not-mine.test.js` 掃 `public/js`：除了 `masterData.js` 不准寫 `.examNotMine`；解構與物件字面量的鍵不算）、
  `EXAM_NOT_MINE_LABEL`（'健檢不是我排的'）、`examNotMineCourse(courses)`（二返那門課，剛好一門才回）
- `slotOptions.js`（05）：**`NOT_MINE_PICK = '__notmine__'`**（那一排上的值）、**`notMineOption(courses, { keep })`**（那一顆：`isNotMine: true`、`folded`、`extra`，
  不帶 `isNth`／`isGift`、`entitlement: null`、`course` 是二返那門課）。`slotOptionsFor()` 已經在最後接它；`foldOpen()` 收到 `NOT_MINE_PICK` 回 true；`trialFromMinutes()` 不換它
- `giftFold.js`（05）：第三塊「其他 ▸」＝分類那一套 —— 鈕 `data-giftfold-group="extra"`、那一層 `<div data-giftfold-in="extra">`；
  **`value` 是 `NOT_MINE_PICK` 時那一層一打開就是開的**（重畫時照常傳 `value` 就對，09 不用另外開）；收著時開關寫「健檢不是我排的　送的／體驗／其他 ▸」
- `slotDraft.js` 的 `slotFromPicks()`（02）：收 **`picks.examNotMine: true` ＋ `picks.nth`（2～10）**；標記贏（`entitlementId`／`isNth`／`giftCourseId`／`giftKind`／`followupForVisitId` 一律不看）；
  `nth` 不是 2～10（含 null）→ `stop('先選第幾返')`，`course`／`assigns` 照樣交回去（確認層靠它畫醫師那一排）；二返沒有 `followupNth` 這個鍵、3～10 寫快照
- 04 的紅字（`warningDetails()` 的 source `examNotMine`，進 `mustSee()`）與確認框那一句（`aboveeConsequences()` 已經接了 `notMineNames()`）—— 09 確認收著的列也看得到
- 05 已經改了：拍 Abovee 那一顆的副字認 `o.isNotMine`（「不扣次數」）。**`aboveeConfirm.js` 的 `optionsFor()` 最後有一個 `.filter((o) => !o.isNotMine)` 暫時把它濾掉 —— 09 接上時拿掉**
- 06、07 的寫法可以照抄的：編輯器 `readNotMineSlot()`（第幾返沒畫出來時的退路、醫師 `preselect` 只在剛換過來時）、`plainSlot()`（換成別的一顆時拿掉標記）；
  壓表用 `view.entitlementId === NOT_MINE_PICK` ＋ 既有的 `view.nth`。「第幾返」那一排：編輯器 `s${i}-nmnth`、壓表 `data-nmnth`（**都不是** n返 那一排的名字）、二返～十返、不預選

08 的重點（issue 有全文）：那一列 `isNth: false` ＋ 自己的旗標（例如 `notMine: true`）＋ `nth`；`optionValueOf()` 回 `NOT_MINE_PICK`、`picksOf()` 交 `examNotMine` 與 `nth`；
`pickOption()` 認 `NOT_MINE_PICK`（返數照照片；照片不是回訪就不預選 —— **還沒選返數的那一列 `picksOf()` → `slotFromPicks()` 會擋，確認層要講出來**，06 用的是草稿旗標，這裡想清楚用哪一種）；
讀照片那一下**不替她按、不替她勾**（`resolveItem()`）、講那一句（指「送的／體驗／其他…」裡的「其他」）；新旗標在 `resolveItem()` 的 `next`、`asRecorded()`、`pickOption()` 的 `base` 三處清掉。
09：那一列按著它時的那幾排、`aboveeConfirm.js:588-590` 那一句換成 08 的、E2E 一支新的；10：文件（ADR-0169 已經在、SPEC、CLAUDE.md 連動表、操作手冊、常見問題、課程與待辦對照表）與收尾。

照「每一段共同的規矩」做：改既有的函式之前照 `ripple-check`（雲端 VM 上 `codegraph` 1.6.2 已經裝好、索引建了：`codegraph sync` → `callers`／`impact`，再 grep 對一次；ast-grep 指令叫 `ast-grep`，不要用 `sg`）；
先寫會紅的測試；動到 `public/` 的每一個 commit 升 `sw.js` 的 `VERSION`（**現在 v215**）、跑 `npm run shell:snapshot`（還沒 commit 又改了 `public/` 的話，先 `git show HEAD:tests/shell-version.snapshot.json > tests/shell-version.snapshot.json` 再重跑，不用多升一號）；
09 一支新的 E2E（登記進 `tests-e2e/related.js`）；本機不跑全量 E2E（雲端 VM 起模擬器 `run_in_background` 要給 `timeout: 7200000`，跑完依 port 停掉）；
中途發現記進「中途發現 → 段三」、不岔出去修；同時最多兩個 subagent；一個真名都不准進版控（commit 訊息也算）。

**主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。**

做完要交：每支一個 commit、`Status: done`、issue 底下「做完時留下的」、`npm run verify` 綠、更新這份 HANDOFF（分段表、中途發現、要使用者決定的）、
**段四的開場**寫進下面（`/matt-code-review` 審 `develop` 到這一輪最後一個 commit 的全部改動）；做完 commit 並 push；最後回覆簡短說做了什麼、卡在哪。

### 段四：審查（effort xhigh）

（段三做完時寫；`/matt-code-review` 審 `develop` 到這一輪最後一個 commit 的全部改動，單獨一段）

### 段五：PR（effort medium）

（段四做完時寫）
