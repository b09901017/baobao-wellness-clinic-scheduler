---
paths:
  - "public/js/domain/taskRules.js"
  - "public/js/domain/todoFlow.js"
  - "public/js/data/tasks.js"
  - "public/js/ui/views/home.js"
  - "public/js/ui/views/todoRows.js"
  - "public/js/ui/components/tasklist.js"
  - "docs/課程與待辦對照表.md"
---

# 待辦：什麼時候長、歸誰、待辦首頁

**每一節的標題是「改了這個」，底下每一條是「一定要一起檢查」的**（從根目錄 `CLAUDE.md`「容易漏掉的連動」那張表搬來，標題照舊）。
新長出來的連動補進對應的那一節（沒有就加一節）；不屬於這一份的補進別份或開新的一份，並加進根目錄 `CLAUDE.md` 的索引。

## 取消類的待辦（`取消 X`）

- **逐段不逐天**：每一張帶 `slotIndexes`（它收的是哪幾段），一段還沒被任何一張蓋到才長新的一張 —— 規則只在 `domain/taskRules.js` 的 `cancelTasksFor()`，**整天取消、只取消幾段、確認框那一句三條路都走它**（ADR-0070、0091）。
- 以前「同一個系統含已勾掉的只准一張」，勾掉之後隔天再取消另一段就一張都不長。
- 段落的位置穩得住是因為既有的段不會被移除（× 是取消）、新的一律接在尾巴（`hasNewSlots()` 也靠這個）—— **哪天加了「刪掉某一段」或「照時間重排」，這一格就會指到別段**。
- 沒有 `slotIndexes` 的舊任務：**產生時**當成蓋住整天（`cancelSlotsOf()`，不多長一張）；**畫面上歸屬**退回「那一天取消掉、用得到那個系統的段」（`todoFlow.js` 的 `ownsCancel()`）—— 兩件事問的不一樣，所以是兩支。
- 只取消一段時 Examine／耀聖**也收，而且只收那一段**（她 2026-09-16 定案，暫定值＝定案）。
- **照片上已經放掉的段「取消 Abovee」一出生就勾好**（`cancelTasksFor(…, { freed })`，ADR-0149）：只有拍 Abovee 會傳 `freed`、只勾壓在 Abovee 的那一張（Examine／耀聖照長、沒勾），同一次存檔裡放掉的段與別的取消拆成兩張。
- **不能只是「不長」** —— 下一次存那一天就補長一張。
- 那一條路不給復原：復原把它軟刪除之後 `seenTasks()` 照樣當成做過，**新增一條傳 `freed` 的路要先想這一條**。
- **合併檔 v9 匯進來的取消段也一出生就勾好**（ADR-0164）：走 `importedTasksFor()`，**每一種取消類都勾**（不只 Abovee —— 匯進來的段沒有任何掛號待辦，長得出來的只有「壓在哪」那一種，舊系統上一樣早就放掉了）；匯入頁「會多幾件要做的事」（`countNewTasks()`）只數沒勾的、勾好的另外數（`countTickedTasks()`）

## 被刪掉的任務算不算做過

- **勾過的才算**（ADR-0106）：判準只有 `domain/taskRules.js` 的 `seenTasks()`，`syncTasksForVisit()`、`cancelTasksFor()`、`followups.js` 的 `syncFollowupTasks()` 三條比對都走它。
- 「清掉」只有已完成那一格有，所以沒勾過就被刪掉的只可能是復原或系統收掉的 —— 那件事沒有人做過。
- **軟刪除的只拿來比對，一個字都不改**。
- 取消的確認框讀 `listByVisitForSync()`，跟真的寫入同一份。
- 一出生就勾好的那一種（拍 Abovee 的 `freed`，見「取消類的待辦」）在稽核上是「勾掉 … 取消 Abovee」

## 任務有兩個時機

- `acceptsNewTasks()`（**那一段**的客人確認後，掛號那一族，ADR-0097）與 `acceptsRecordTasks()`（**那一段**做完後，紀錄那一族，ADR-0066、0112）。
- 兩族都逐段長、記著 `slotIndexes`（`newRegistrations()`、`newRecords()`），沒有 `slotIndexes` 的舊任務當成蓋住整天。
- 「寫紀錄」問整筆的話，營養諮詢沒來、SIS 做了時照樣長一張；先結一段、另一段還開著時永遠不長。
- **`tasksForVisit()` 刻意不看狀態、`recordTasksForVisit()` 刻意看** —— 前者同時被拿來比對「哪些還該留著」，跟著狀態變的話來訪一結案她還沒做完的 Examine 就會被靜默收掉；後者相反，那一場沒做完就沒有東西可以寫。
- 「寫紀錄」逐**課程**不逐類別（`course.needsRecord`）

## 一門課壓哪幾個系統

- **課程自己勾**（`course.systems`，ADR-0119），推導只在 `domain/taskRules.js`：`systemsOf()`（勾過照勾的、沒勾過照 `category` 推、**找不到這門課回 `null`**）、`bookingSystemOf()`（壓表在哪）、`tasksForCourse()`（確認後長哪幾種）。
- **沒有任何一處可以自己比 `course.category`** —— 它只剩退路，`tests/course-systems.test.js` 掃原始碼盯著（名單上每一條附理由）。
- 「找不到這門課」幾個呼叫端刻意往不同的方向倒：取消時猜 Abovee、拍 Abovee 的「app 有、這次照片上沒有」也照 Abovee 算（`absentFromPhoto()`；`null`＝不用壓的不算）、待辦中心「壓表登記」不算數（`customersToBook()`；擇一池問 `coursesForEntitlement()` 推出的課程，所以它要收 `equipment`）。
- **三個都不勾（`systems: []`，明確的空陣列）＝不用壓**（ADR-0126，HRV）：`systemsOf()` 回 `[]`、`bookingSystemOf()` 回 **`null`** —— 那是第三種，跟「找不到」不一樣（不猜 Abovee、取消不長、壓表登記不算）；**新增一個呼叫端要接得住 `null`**，那一句「在 X 壓好了嗎」、那一張「取消 X」都不可以印出它。
- 存檔前那一道的抬頭與確認鈕由 `consequences.js` 的 `bookingConsequences()` 一起回（**只看這一次新加的段**），壓表與來訪編輯器不自己寫死；**抬頭底下列哪幾段也由它回**（`toBook`／`free`，2026-10-07）—— 問「在 X 壓好了嗎」時底下只能列要壓的，不用壓的另外講一句；沒有那一格（沒勾過）照舊從類別推，`tests/book-nowhere.test.js` 盯著兩個方向。
- 三個系統的名單（`SYSTEMS`）住在 `masterData.js`：`taskRules.js` 經 `visits.js` 讀那一支，反過來 import 會繞成一圈。
- 種子每一門的 `systems` 要跟它的 `category` 推出來的一樣（有測試），新增一組分類預設（`GROUP_DEFAULTS`）也要帶。
- **改了這一格（或 `needsRecord`）要回頭重算**（ADR-0140，2026-10-08）：待辦是存來訪時才算的，已經談定的那幾筆下一次被存通常是簽療程單，那時掛號那一族已經不長了。
- 設定 → 課程 存檔走 `data/visits.js` 的 `courseTaskPlan()`（試算，給確認框）→ `saveCourseWithTasks()`（寫），規則在 `taskRules.js` 的 `changedTaskKinds()`／`tasksAfterCourseChange()`：**只寫任務、不存來訪**（`save()` 會換 `updatedAt`、重算次數）；長的那一側從還開著的來訪出發（兩種整筆狀態，**不是 `listUnclosed()`** —— 它只回今天以前的）、收的那一側從還沒勾的任務出發；只留這次變了的那幾種，所以**取消類一張都不長**（「壓在哪」一改，`cancelTasksFor()` 照種類比會多長一張假的）、已經結案的來訪不回頭長「寫紀錄」；課程本身放在最後一個 commit（先寫課程、待辦寫到一半失敗，再存一次就看不出變了）。
- **新增一條會改這兩格的路（資料健檢的一顆、匯入）要走同一支**，或在那一支寫清楚為什麼不用。
- **「壓在哪」跟著勾法換了的時候照改之前的那一個扣**（`changedTaskKinds()`，2026-10-09 審查）：談定的那幾天是在舊的系統壓的 —— 拿新的去扣會替它們長一張當初壓表的那個系統，或把還沒掛的收掉。
- **離線不存**要自己問 `isOffline()`（`masterList.js` 的 `saveCourse()`）：開著本機快取時離線的讀取不會失敗

## 一種課程會長出哪些待辦

- 對照表在 `docs/課程與待辦對照表.md`。
- 改了 `taskRules.js` 或 `followups.js` 的規則要回去改它 —— 確認框上的每一句話都是照那張表寫的，表沒列全警示就會漏

## 勾掉一張待辦

- 走 `data/tasks.js` 的 `setDone(tasks, done)`，**收的是任務本身不是 id**。
- 健檢鏈那兩種（追蹤健檢報告、約二返）會連著把下一站算出來，跟勾選寫在同一個 commit 裡 —— 規則仍然只在 `domain/followups.js`

## 待辦中心的兩張抽屜（確認、簽療程單）

- **每一段三態：✓、✗、還沒決定（預設）**（ADR-0110）。
- 沒按的那一段一個字都不動：確認走 `applyConfirmation()` 的 `asked`，簽單走 `closeVisit()` 的 `null`。
- **簽療程單只列還開著的段**（`slotsToClose()`）—— 以前列全部而且預設「做了」，未到那一段會被蓋成已完成、扣次數；`closeVisit()` 也永遠不動已結案或取消的段。
- 兩張共用 `home.js` 的 `pickRow()`／`togglePick()`／`pickAllButton()`；E2E 先 `app.tickAll()` 再按送出。
- **簽療程單那一句「會扣 N 次」與存完的 toast 共用 `consequences.js` 的 `chargedOnClose()`**（只數真的扣的段，issue 06）—— 各數一次的話抽屜講 2、toast 講 3。
- **改狀態的三支入口動手前先補齊每一段的狀態**（`materialize()`）—— 沒有 `slot.status` 的舊資料改一段時，`save()` 補空格用的是改完之後的整筆，整天會跟著變。
- **二返／n返接的那一次健檢還沒做完，那一段的 ✓ 按不下去**（ADR-0145，判斷只有 `followups.js` 的 `cannotClose()`／`closeBlocks()`）：抽屜那一列、「全部 ✓」（跳過它、講跳過了幾段）、`closeConsequences()`、`closeVisit(…, guard)` 問同一支；抽屜存的那一下拿剛讀回來的全部來訪再問一次（補讀之前不知道就不擋）。
- **那一句只有一支**（`consequences.js` 的 `closeBlockSay()`，`cannotClose()` 回那一次現在的狀態）：還排著的講「還沒做完」，**取消、未到的講「去日曆換這一段接哪一次」**—— 那一次不會再做了，講「健檢簽好再回來簽」是一件不會發生的事。
- **新增一條會把段簽成做了的路要傳 guard**

## 任務什麼時候產生

- 只寫在 `domain/taskRules.js` 的 `acceptsNewTasks()`（客人確認之後才長，見 ADR-0027），而**問的是那一段**（`newRegistrations()`，ADR-0097）。
- **那一天過了才談定的段不長**（`registrationClosed()`，ADR-0113，當天照長）—— 擋的是退回簽療程單、長按「客戶說可以」長出一張一出生就逾期的；長的那一側、讀取卡片的「到時候才會長出來」（`pendingRows()`）、確認框的「會多一張」（`registrationsWhenSettled()` 帶 `today`）三處問同一支—— 整筆那個 `status` 是推導的，兩段裡確認了一段時它停在「待確認」。
- **掛號那一張也逐段**（ADR-0107）：每一張帶 `slotIndexes`（它掛的是哪幾段），一段談定了、還沒被任何一張蓋到才長新的，同一次談定的幾段收成一張；讀取卡片的歸屬（`todoFlow.js`）、取消時「那一段掛過了沒」（`cancelTasksFor()`）都照它；三道確認框的「等客人說可以之後會再多一張 X」（確認抽屜、改期、壓表與來訪編輯器新增）共用 `consequences.js` 的 `registrationsWhenSettled()`（把那幾段假設成已確認去問它），**staging 種子**（`seed-staging.mjs` 的 `registrationTasks()`）也走它 —— 照課程類別自己推一次、或用 `tasksForVisit()` 自己種的沒有 `slotIndexes`，會被當成蓋住整天。
- **`tasksForVisit()` 不看狀態這件事不能動**：它同時被拿來比對「哪些還該留著」，閘門只擋 `create` 那一圈。
- UI 上講這件事的文案要跟著改：壓表「加這一筆」底下那一句，與存檔前那幾道確認（`consequences.js`）—— 畫面在講一件不會發生的事，比沒講還糟。
- 另外三句（壓表那張卡、確認抽屜、客戶詳情沒有任務時的 `?`）2026-09-24 晚拿掉了（ADR-0114），**不要加回來**

## 一列任務要顯示什麼

- 種類、**來訪那一天**、課程，只寫在 `domain/todoFlow.js` 的 `taskLine()`（2026-09-24 從 `taskRules.js` 搬來 —— **反過來讓 `taskRules.js` import `todoFlow.js` 會在載入時撞到頂層的 `FLOW`**）。
- **只講這一張的那幾段**：`taskSlots()` 答，「詳情」打開哪幾段、「N 項」、那一行小字都問它（issues/08）；它是讀取卡片歸屬（`ownsTask()`）的反面，同一支 —— 各寫一份就會詳情開第 1 段、第 1 段的卡片上卻沒有那一張。
- **帶 `slotIndexes` 的只講那幾段**（開始時間＋名字，取消類不濾取消的段；ADR-0107），所以待辦中心那一行的 key 是**任務 id** 不是來訪 id。
- 三個地方讀它：客戶詳情、待辦中心、試算表的 TODO／FINISHED 區。
- **日期不是死線**（死線是它的前一天，兩個差一天最容易看錯人），也**不要拿死線 + 1 反推**（取消類的任務不是那樣算的）

## 待辦首頁畫哪幾列、叫什麼

- **每一列三選一**（一直顯示／有才顯示／不顯示，ADR-0151）：名單是 `domain/todoFlow.js` 的 `HOME_ROWS`（從 `FLOW` 推，順序一樣）、每一列怎麼畫只問 `rowView()`、預設只寫在 `DEFAULT_ROW_SHOWS`；**那幾列的名字只有 `rowLabel()`**（首頁、點進去那一頁的抬頭、設定 → 待辦首頁 讀同一份；不是任務種類的那幾列在 `NON_TASK_ROWS`，段八）。
- `home.js` 不自己比 `rowShowOf()`（`tests/todo-home-rows.test.js`）。
- **`todoRows` 不放進 `seed.js` 的 `DEFAULT_SETTINGS`**（`rowShowOf()` 認得沒有那一格）。
- 新增一種任務要想它在 `FLOW` 的哪一段 —— 不在名單上的照舊有才顯示

## 待辦首頁的「逾期／今天／明天」

- **三格的組成只寫在 `domain/todoFlow.js`**（ADR-0152）：任務落哪一格 `taskBucket()`、三格各是哪幾件 `todoBuckets()`（任務＋還沒簽療程單的那幾天 `visitsToClose()`＋掛那一天、還沒勾的隨手記 `isOpen()`）、數字 `bucketCount()`。
- 首頁那三顆數字、點進去那三頁的「未完成 N」與每一塊**讀同一支** —— 各數一次的話首頁寫 3、點進去兩件。
- **明天算明天還開著的那幾天，但放在 `coming` 不放 `close`**（`visitsComingTomorrow()`，ADR-0162 推翻 0152 那一格）：點下去開讀取卡片、不開簽單抽屜；`listUnclosed(today, { tomorrow: true })` 只給三顆數字那兩處，簽療程單那一頁與抽屜照舊只讀 `visitsToClose()`（`date <= today`）。
- 昨天的隨手記哪一格都不在。
- 簽療程單那一列走 `leaveFor('todo/close', id)`（同日曆長按那一條）。
- `tests/todo-buckets.test.js` 盯著。
- **點進去那三頁的「已完成」是同一張表的另一半**（ADR-0166，推翻 0152 的「已完成只有任務」）：只在 `doneBuckets()` 算，**照日子不照清單** —— 今天＝死線今天的任務（哪天勾的都算）＋今天簽完的那一天（`daySignedOff()`）＋掛今天勾掉的隨手記，明天同理（沒有簽療程單），逾期**只收今天才做完的**（`dayOf(doneAt／statusAt) === today`，查詢起點是 `startOfDayISO()` —— 那兩格是 UTC）；**逾期那一格不收一出生就做完的**（`createdAt` ＝ `updatedAt`：同一次寫入的伺服器時間一樣，她勾的那一下是另一次寫入 —— **不要改成比秒數**；今天、明天照收，她 10/21）。
- 讀不靠 `listDone()` 的最近 200 筆（`listDoneDue()`／`listDoneSince()`／`listStatusChangedSince()`，最後那一支吃 (deletedAt, statusAt) 索引，讀不到時未完成照畫）。
- 「已完成 N」問 `bucketCount()`；首頁三顆數字照舊只數未完成。
- `tests/todo-bucket-done.test.js` 盯著
