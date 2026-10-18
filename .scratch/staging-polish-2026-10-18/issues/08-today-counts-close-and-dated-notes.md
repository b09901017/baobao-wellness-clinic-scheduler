# 待辦首頁：今天／明天算進簽療程單與有日期的隨手記，逾期算進前幾天沒簽完的

Status: done
Blocked by: 07（同一頁、同一段；07 先把「哪幾列」的名單放進 domain）
段：二（high）
動工前先讀：`ui/views/home.js` 的 `paint()`（`overdue`／`dueToday`／`tomorrow` 三個 filter）、`tile()`、`renderGroup()` 的 `filters`（`overdue`／`today`／`tomorrow`）、`paintTasks()`、`renderClose()`／`openCloseDrawer()`（簽療程單那一頁與抽屜）、`notesCard()`、`toggleNote()`；
`domain/visits.js` 的 `visitsToClose()`、`slotsToClose()`；`domain/taskRules.js` 的 `urgency()`；`domain/notes.js`（`date` 欄位、`datedIn()`、`sortNotes()`）；`ui/components/note.js` 的 `row()`／`prepareToggle()`（四個勾隨手記的入口共用）；
ADR-0044（「日期不是死線」那張表：隨手記「不進任何數字」）、ADR-0110（簽療程單三態、沒按＝先不結）、ADR-0001（簽療程單是推導的不是任務）；SPEC 8.1；`CONTEXT.md`「隨手記」那一條（「不進『逾期』那顆數字」）

## 她要的

> 2. 如圖2，待辦首頁那邊"今天，明天"的數字為甚麼沒有包含到簽療程單，這不是今天要做的事嗎，還有像是在日曆綁定當天的todo，好像都沒算進去 ? 希望也可以算進去這樣我點他就知道今天，明天有麼要做，然後如果在日曆綁定當天的todo今天沒勾也沒關係，他不算逾期

她 10/18 回「前幾天沒簽完的療程單算逾期還是今天」：「算逾期」。

## 為什麼會這樣

`paint()` 的三個數字只數 `tasks`（系統長出來的任務，照 `dueDate`）。簽療程單不是任務（`visitsToClose()` 從來訪狀態推出來的，ADR-0001），
日曆上的待辦是有 `date` 的隨手記（ADR-0044）——兩種都不在 `tasks` 裡。ADR-0044 那張表寫「隨手記的日期過了 → 字變色，沒有紅底，不進任何數字」，
擋的是「它變成紅字逾期」；她現在要的是「進今天／明天、不進逾期」，跟那條理由不衝突，但「不進任何數字」那一格要改寫。

## 要做的

- **三個數字的組成只寫在 domain 一支**（例如 `todoFlow.js` 多一支，輸入：任務、還沒結案的來訪、還沒勾的隨手記、今天；輸出：三格各是哪幾件）—— 首頁的數字與點進去那一頁的清單**讀同一支**，不然數字跟清單會差一件（ADR-0070 那種）
  - **逾期** = 逾期的任務（照舊）＋ **日子已經過了、還有段開著的簽療程單**（`visitsToClose()` 裡 `date < today` 的；一位一天算一件）
  - **今天** = 今天到期的任務 ＋ **今天的簽療程單**（`date === today`）＋ **掛今天、還沒勾的隨手記**
  - **明天** = 明天到期的任務 ＋ **掛明天、還沒勾的隨手記**（明天的來訪還簽不了，不算）
  - **有日期的隨手記過了不進任何一格**（她：「今天沒勾也沒關係，他不算逾期」）；勾掉的、軟刪除的都不算
- 點「逾期／今天／明天」那一頁（`renderGroup()` 的那三種）**分塊列**：待辦（照舊）／簽療程單／隨手記（用 `note.row()`、直接勾，走 `prepareToggle()`）。
  空的那一塊不畫。「已完成」分頁照舊只有任務（簽療程單沒有「勾回來」、隨手記的已完成在 `#/todo/notes`）
- 簽療程單那一塊點一列 → **帶她去 `#/todo/close` 並直接開那一天的抽屜**：走 `ui/nav.js` 的 `leaveFor()`／`takeFor()`（CLAUDE.md「從一頁帶人到另一頁」那一列，日曆長按「客人來了，去簽療程單」就是這一條），
  不要在這一頁拿別人的 ctx 叫 `openCloseDrawer()`
- **營養品的提醒也是一筆有日期的隨手記**（ADR-0059、`products.js`），所以它也會進今天／明天 —— 這是對的（那天要交付），寫進 ADR 與「我自己定的」；勾它要走 `noteDeps()` 那一套（四個勾隨手記的入口共用 `prepareToggle()`）
- 「依客戶」那一頁的數字不動（它本來就是任務＋確認＋簽療程單三種相加，2026-09-02 她定的）
- 首頁那一行「今天沒有待辦」（`nothing`，`home.js:315`）：本來就算了簽療程單與確認，**只差隨手記** —— 補上
- 文件：ADR **0152**（三顆數字算進簽療程單與有日期的隨手記；隨手記不進逾期；補 ADR-0044 那一格，不改它）、SPEC 8.1、`CONTEXT.md`「隨手記」（「不進逾期，但進今天／明天」）、`docs/常見問題.md`（有沒有「今天為什麼是 0」那一題）

## 判準

- 今天有一位客戶的來訪還沒簽、昨天有一位還沒簽、掛今天兩則隨手記（一則已勾）、掛明天一則、掛昨天一則沒勾、一張今天到期的 Examine：
  逾期 = 1（昨天的簽療程單）；今天 = 1 + 1 + 1 = 3；明天 = 1。**掛昨天、沒勾的那一則哪一格都不在**
- 點「今天」：三塊各列出上面那幾件；在那一頁勾掉那一則隨手記 → 回首頁今天變 2
- 點「逾期」那一頁的簽療程單那一列 → 換到簽療程單那一頁、開的是昨天那一天的抽屜（E2E 等抽屜時不要只等 `.drawer`，上一頁的面板也是 `.drawer`，CLAUDE.md）
- 一筆掛今天的營養品提醒：算進今天；在今天那一頁勾掉 → 走交付那一條（`deliveries[]` 有一筆），不是只把隨手記勾掉
- 首頁的數字＝點進去那一頁列出來的件數（同一支 domain 算的；單元測試釘住兩邊用同一支）
- 07 把簽療程單那一列設成不顯示：三顆數字照算它（07 她選的）

## 做完時留下的

- domain：`todoFlow.js` 的 `BUCKETS`、`taskBucket()`（任務落哪一格；「已完成」那一格也照它切）、`todoBuckets()`（三格各是哪幾件：tasks／close／notes）、`bucketCount()`。
  簽療程單直接叫 `visitsToClose()`、隨手記問 `notes.js` 的 `isOpen()` —— 沒有循環 import（`notes.js` 只 import `dates.js`）
- 首頁 `paint()`：三顆數字＝`bucketCount()`；「今天沒有待辦」多問掛今天／明天的隨手記
- `renderGroup()` 的逾期／今天／明天：多讀 `listUnclosed(today)` 與 `notesData.listOpen()`（只有這三頁讀）；`ctx.close`、`ctx.notes`；
  「未完成 N」＝三塊加起來；只有任務時長得跟以前一樣（不加小標），有別的塊就每一塊一個小標（`.donegroup`）
- 簽療程單那一列：`data-close-go` → `leaveFor('todo/close', id)` → `whenSettled()` → `go('/todo/close')`（同日曆長按那一條）；列上寫「N 段還沒簽」
- 隨手記那一塊：`note.row()`，點一下走 `note.prepareToggle(row, noteDeps())`、長按走 `wireNoteLongPress()`，勾完重畫那一頁
- 測試：`tests/todo-buckets.test.js`（判準那一組、昨天的隨手記哪一格都不在、明天不算簽療程單、home.js 讀同一支）；E2E `70` B1–B4
- 文件：ADR-0152、SPEC 8.1 那張表、CONTEXT「隨手記」、常見問題兩題（「寫紀錄那一列不見了」也一起寫了，屬 07）
- 「依客戶」那一頁的數字沒動
