# 逾期／今天／明天的「已完成」各算哪幾件（domain＋讀資料）

Status: done
段：二（xhigh）
動工前先讀：`domain/todoFlow.js` 的 `BUCKETS`、`taskBucket()`、`todoBuckets()`（檔頭那張表）、`bucketCount()`、`groupByDoneDay()`；
`domain/visits.js` 的 `visitsToClose()`、`visitsComingTomorrow()`、`stillOpenDays()`、`slotsToClose()`、`isOpenStatus()`、`closeVisit()`（`statusAt` 只在整筆狀態變的時候蓋）；
`domain/notes.js` 的 `isOpen()`（`isOpenNote`）；`domain/dates.js` 的 `dayOf()`（ISO → 台灣的日子）、`todayISO()`；
`data/tasks.js` 的 `listDone(limit = 200)`（`doneAt desc`）；`data/notes.js` 的 `listBetween(from, to)`（照 `date`，含勾掉的）；`data/visits.js` 的 `listByDate()`、`listBetween()`、`listUnclosed()`；
`ui/views/home.js` 的 `renderGroup()`（`done: done.filter(match)` 那一行與上面那段註解）；
ADR-0152（決定 4「『已完成』那一格照舊只有任務」—— 這一支推翻它）、ADR-0162、ADR-0044、ADR-0059；`CLAUDE.md`「待辦首頁的『逾期／今天／明天』」那一列；
`tests/todo-buckets.test.js`；`lessons.md` 一（首頁數字與清單同一支）、二（讀一段期間）、七（`doneAt` 是 UTC 的 ISO 字串）

## 她要的

> 第二 : 我發現待辦首頁，的今天，他的已完成是不是裝飾啊 ? 我勾起來的怎麼沒有跑到已完成，就是已完成只能放今天的，到了明天後，未完成就會到逾期，已完成就會清空，但只是這邊呈現清空，再隨手記那邊或月曆其他地方不會被清掉，你懂嗎，就是我想要今天份的點進去後可以看到已完成和未完成，包含重其他地方點的完成也是放已完成

她同意的表（「可以照表」）：

| 那一頁 | 已完成 |
|---|---|
| 今天 | 死線今天的任務、掛今天的隨手記、今天的療程單 —— 做完了就在這裡，不管在哪一頁勾的 |
| 明天 | 同理（提早做完的） |
| 逾期 | **今天才做完的**逾期（不然會永遠積著） |

## 為什麼會這樣

- `renderGroup()` 的已完成是 `done.filter(match)`：`done` 是 `tasksData.listDone()`（只有任務），`match` 是 `taskBucket(t.dueDate, today) === group`
- 所以隨手記（`notes` 集合）與簽療程單（從來訪推導，ADR-0001）勾掉了哪一頁的已完成都不在 —— ADR-0152 決定 4 寫明的
- 「逾期」的已完成＝所有死線過了、做完的任務：只要是做完的任務，過了死線就永遠落在這一格（`listDone()` 上限 200）

## 做法（方向）

1. **規則只寫在 `todoFlow.js`**，跟 `todoBuckets()` 放一起（例如 `doneBuckets({ doneTasks, notes, visits, today })` 回 `{ overdue, today, tomorrow }`，每一格 `{ tasks, close, notes }`）：
   - **今天**：任務＝做完、`dueDate === today`；隨手記＝勾掉、`date === today`；療程單＝`date === today`、**一段都不開著**（`slotsToClose()` 是空的）、而且至少一段是已完成或未到（整天取消的不算「簽好了」）
   - **明天**：任務＝做完、`dueDate` 是明天；隨手記＝勾掉、`date` 是明天；療程單沒有（明天的還簽不了）
   - **逾期**：任務＝做完、`dueDate < today`、**`dayOf(doneAt) === today`**；療程單＝`date < today`、一段都不開著、至少一段已完成或未到、**那一天是今天才結的**；隨手記沒有（隨手記不會逾期，ADR-0152 決定 2）
   - 未完成那一側（`todoBuckets()`）**一個字都不改**；首頁三顆數字照舊只數未完成
2. **「今天才結的」怎麼判**：`dayOf(statusAt) === today`。過目查過成立：`closeVisit()` 只在整筆狀態變的時候蓋（`visits.js:1104`），單段的 `applyStatus()` → `settle()`（`:1187`）也一樣，
   拍 Abovee 的 `applyPhotoStatus()` 是先退回已確認再 `closeVisit()`（`aboveeImport.js:1682`／`:1691`）；一天最後一段結掉時 `visitStatusFrom()`（`:727`）一定從開著變成結案，所以一定會蓋。
   日曆長按「客人來了」不是另一條路（換到簽單抽屜，最後走 `home.js:3875` 的 `closeVisit()`）。合併檔匯入的來訪沒有 `statusAt`（`mergeImport.js:600`）—— 不會被算進來，對的。
   **會被算成「今天結的」、但它從來不在逾期那一格裡的**（ADR 要決定算不算、怎麼排除）：
   - 拍 Abovee 今天新記一筆**過去的、已完成的**（`newVisitWith()` → `settle()`，`statusAt` 是今天）—— 它從來沒在未完成裡出現過
   - 一出生就勾好的任務（`taskRules.js:699`／`:891` 那幾種：照片放掉的「取消 Abovee」、匯入的取消段；`doneAt` 是存檔那一刻）
   - 取消掉最後一段還開著的段（那一天變成結案）—— 這一種本來就在逾期裡，今天解決了，算進已完成說得通
   建議的排除法：一出生就結案／勾好的不算（例如比 `createdAt` 與 `statusAt`／`doneAt` 是不是同一天、或同一個 commit）—— 段裡量過再定、寫進 ADR
3. **讀資料**（`renderGroup()` 那三頁）：
   - 任務：**不可以靠 `listDone()`**（過目查到：它照 `doneAt` 取最近 200 筆，而今天／明天照 `dueDate` 選 —— 掛號那一類常在來訪前幾週就勾掉了，死線今天的那幾張會漏）。
     今天／明天另外查 `done == true` ＋ `dueDate` 在今天到明天之間（**既有的索引** `deletedAt, done, dueDate` 就夠）；逾期查 `done == true` ＋ `doneAt >= 今天開始的那一刻`（既有的 `deletedAt, done, doneAt desc`）。
     「今天開始的那一刻」是台灣的 00:00 換成 UTC 的 ISO 字串 —— `doneAt` 存的是 UTC
   - 隨手記：`notesData.listBetween(today, 明天)` 就拿得到今天與明天勾掉的
   - 療程單：今天的 `listByDate(today)`；逾期那一格查 `statusAt >= 今天開始的那一刻`。**`repo.list()` 一律自動加 `deletedAt == null`**（`repo.js:95`）→ 要補一個複合索引（`deletedAt, statusAt`）進 `firestore.indexes.json`
   - **索引要先部署好、而且少了它整頁不可以打不開**：`renderGroup()` 的 `Promise.all`（`home.js:1835`）沒有 catch —— 已完成那一側讀失敗（索引還在建、離線）時未完成那一側照樣畫，已完成那一塊講一句
   - **這是畫面用的、不拿去算次數或存檔**（`lessons.md` 二那一種擋的是算次數）
4. 時區：`doneAt`／`statusAt` 是 `new Date().toISOString()`（UTC），**一律過 `dayOf()`** —— 台灣 00:00–08:00 勾的不可以算到昨天

## 判準

- `tests/todo-buckets.test.js`（或新的一支）先紅：
  - 今天：死線今天的任務勾了 → 今天的已完成有它；掛今天的隨手記勾了（不管在哪裡勾，資料上就是 `done: true`）→ 有它；今天兩段都簽了 → 有那一天；一段簽了、一段還開著 → **沒有**（它還在未完成）；整天取消 → 沒有
  - 明天：死線明天的任務提早勾了 → 明天的已完成有它；今天的已完成沒有它
  - 逾期：死線昨天、今天勾的 → 有；死線上週、昨天勾的 → **沒有**；昨天的療程單今天才簽 → 有；昨天就簽好的 → 沒有
  - 隔天（`today` 換成明天跑同一份資料）：昨天那幾件一件都不在今天的已完成
  - 台灣早上 7 點勾的（`doneAt` 是前一天 23:00Z）算今天 —— `dayOf()` 用的是裝置的時區（`dates.js:96`），單元測試照 `tests/download-date.test.js` 在檔頭設 `TZ`，CI 上才會對
  - 死線今天、**三週前就勾掉**、這三週又勾了 200 張以上別的 → 照樣在今天的已完成（`listDone()` 那個洞的紅燈）
  - 拍 Abovee 今天新記一筆上週已完成的 → 照 ADR 決定的那樣（建議：不在逾期的已完成）
- 這一行會不會讓一件**還沒做完**的出現在已完成、或讓未完成那一側的數字變了？（未完成三格跑改之前與改之後同一份資料，一模一樣）
- 這一行會不會讓一筆來訪同時出現在未完成與已完成？

## 連動

- 新的 ADR（推翻 ADR-0152 決定 4；0152 一個字都不改，`docs/adr/README.md` 索引那一列補上「部分被推翻 → 新的那一支」）
- `CLAUDE.md`「待辦首頁的『逾期／今天／明天』」那一列（已完成那一側只在哪一支算）
- `SPEC.md` 8.1 首頁那一節的那張表
- `firestore.indexes.json`（`visits` 的 `deletedAt, statusAt`）：部署順序是 CI 先推索引再推 Hosting，但索引建好要幾分鐘 —— 上面那一條「讀失敗照樣畫未完成」就是為了這幾分鐘

## 做完時留下的

- 規則只在 `domain/todoFlow.js` 的 **`doneBuckets({ tasks, visits, notes, today })`**，回 `{ overdue, today, tomorrow }`、每一格 `{ tasks, close, notes }`、每一塊新做完的在前；
  「已完成 N」照樣問 `bucketCount()`（那一格沒有 `coming`）。「這一天簽完了」是 `visits.js` 的 **`daySignedOff()`**（`visitsToClose()` 的另一半：一段都不開著、至少一段已完成或未到）
- **一出生就做完的照 ADR-0166 決定 3 排除**：`createdAt` 與 `updatedAt` 是同一刻（`bornDone()`）。**量過**（本機 Firestore 模擬器，scratchpad 腳本）：
  同一個 batch 裡兩格 `serverTimestamp()` 讀回來 20/20 一模一樣（跨文件也一樣），之後再寫一次就不一樣。
  所以她勾的、簽的（另一次寫入）一定算；不用「隔幾秒」—— 她確認完一分鐘內就去掛號、勾掉是會發生的。三種今天會被算成「今天結的」的情形：
  拍 Abovee 新記過去的已完成、一出生就勾好的任務 → 排除；取消掉最後一段開著的段 → 那一天本來在逾期裡、今天解決了 → 算（整天取消的除外）
- 讀的那一側（`home.js` 的 `loadBucketDone()`，只撈那一頁用得到的）：`tasksData.listDoneDue(day, day)`（死線那一天，吃既有的 (deletedAt, done, dueDate) 索引）、
  `listDoneSince(startOfDayISO(today))`（既有的 (deletedAt, done, doneAt desc)）、`visitsData.listStatusChangedSince()`（**新的 (deletedAt, statusAt) 索引**）、
  `listByDate()`、`notesData.listBetween()`。讀不到回 `null`，`renderGroup()` 照畫未完成（那一塊的那一句在 04）
- `dates.js` 多兩支：`startOfDayISO()`（裝置那一天 00:00 的 UTC ISO —— 刻意用本地時區，同 `dayOf()`）、`msOf()`（Timestamp／ISO／Date → 毫秒）
- 這一支只接了讀的那一側：`ctx.done` 在三頁先換成 `finished.tasks`（舊的 `doneList()` 照畫任務），三塊與拿掉垃圾桶在 04
- `tests/todo-bucket-done.test.js`（檔頭釘 `TZ=Asia/Taipei`）：issue 的判準每一條一個 test，加上「兩個查詢撈到同一張只算一次」「未完成那一側同一份資料一模一樣」
- 文件：ADR-0166、`docs/adr/README.md`（0152 那一列「部分被推翻 → ADR-0162、ADR-0166」）、`CLAUDE.md`「待辦首頁的『逾期／今天／明天』」、SPEC 8.1 那張表與索引那一段
