# HANDOFF：健檢不是我排的（exam-not-mine）

分支 `claude/exam-not-mine`（從 `develop` 093e1d9c 開，**在主資料夾**，不是 worktree）。主控是 2026-11-02 談設計的那個 session。

## 分段

| 段 | issue | effort | 狀態 |
|---|---|---|---|
| 一 | 01 決定紀錄、02 時段形狀與驗證、03 試算表與月底對帳、04 紅字與確認框 | xhigh | todo |
| 二 | 05 那一顆與收合、06 日曆新增／來訪編輯器、07 壓表 | high | todo |
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

## 要使用者決定的

- **收合那一題（擋段二，段二開之前要有答案）**：沒有任何額度的客人，收合本來就會自己打開（`foldOpen()`，他們只能選送的／體驗；既有行為被 E2E `67` 的 G6／G13／G14 釘著）——
  而她要的那種客人正是這一種，所以「收起來點開才看得到」照現在的畫法做不到。
  主控建議：`foldOpen()` 不動；「健檢不是我排的」在收合裡**再收一層「其他 ▸」**（用 `giftFold.js` 既有的分類那一套，`data-giftfold-group`），點了才出現；選著它時那一層打開。
  （另一條路是讓收合永遠不自己打開 —— 會改到每一位沒有額度的客人現在的畫面，不建議）

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

### 段二

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

這一段沒有要先問她的題目（收合那一題是段二的，主控會先問好）。

**主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。**

做完要交：每支一個 commit（commit 訊息不帶任何真名）、`Status: done`、issue 底下「做完時留下的」（實際做成什麼：函式名、欄位、測試檔名；02 要記「她主檔上二返那門課有幾門」）、
`npm run verify` 綠、更新這份 HANDOFF（分段表的狀態、中途發現、要使用者決定的）、**段二的開場**寫進下面（照段一這一份的格式，把 05～07 要知道的 02、04 實際做成的名字寫進去）；
最後回覆簡短說做了什麼、卡在哪。

### 段二（effort high）

（段一做完時寫）

### 段三（effort xhigh）

（段二做完時寫）

### 段四：審查（effort xhigh）

（段三做完時寫；`/matt-code-review` 審 `develop` 到這一輪最後一個 commit 的全部改動，單獨一段）

### 段五：PR（effort medium）

（段四做完時寫）
