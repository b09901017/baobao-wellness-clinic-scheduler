# 改了「設定 → 課程」要壓哪幾個系統，已經談定的來訪不會跟著補長或收掉

Status: done
來源：`f-course-systems`、`rules/report.md` 第 3 條
動工前先讀：`docs/agents/lessons.md` 第三、五、六節、`public/js/ui/views/masterList.js:1400-1440`（存課程那一段）、
`public/js/domain/taskRules.js`（`systemsOf()` `:175`、`tasksForCourse()` `:209`、`recordSlots()` `:366`、`newRecords()` `:380`、`syncTasksForVisit()` `:430`、
`newRegistrations()` `:655`、`cancelTasksFor()` `:728-751`、`registrationClosed()`、`acceptsNewTasks()`、`seenTasks()`）、
`public/js/data/visits.js`（`save()` 怎麼算待辦、私有的 `taskOps()`、`listByStatus()` `:44`、`listUnclosed()` `:64`）、`public/js/data/tasks.js`、
`public/js/ui/saveEach.js`、`public/js/domain/consequences.js`、
ADR-0027、0097、0106、0107、0113、0119、0126、`CLAUDE.md` 連動表「一門課壓哪幾個系統」「任務什麼時候產生」「任務有兩個時機」「取消類的待辦」
Blocked by: 15（沒有實際依賴；同一批待辦規則，一支一支做）
重現：`node .local/references/audit-2026-10-08/rules/r06-master-change.mjs`

## 她要的

> ・「上線前要先修」那 18 件，要怎麼出貨？ → 全部一起修完、一起上 staging，你點一次驗收清單

報告那一張卡：

> 改了「設定 → 課程」要壓哪幾個系統，已經談定的來訪不會跟著補長或收掉
>
> 有六門課標著「設定暫定」，預期你上線後會調整。改完之後，只有之後才談定的來訪會照新設定長待辦。……例如替羊膜多勾「耀聖」：已經約好的那幾天，耀聖一張都不會長，畫面也沒有提示。反過來取消勾選，已經長出來的會一直留著。

## 為什麼會這樣

存課程只寫課程本身。待辦是存**來訪**時才算的；已經談定的那幾筆要等下次被存 —— 通常就是簽療程單，
而那時那一段已經不是「已確認」，掛號那一族就不長了（`acceptsNewTasks()`）。

## 要做的

存課程時，**「壓哪幾個系統」或「寫紀錄」變了**才做。

### 只寫任務，不存來訪

**不走 `save()`。** `save()` 會換 `updatedAt`（別台開著的抽屜全部變舊）、補段落狀態、重算次數、每筆多跑一次 `followupOps()`、每筆一則稽核 —— 而來訪本身一個字都沒變。
`syncTasksForVisit()` 是純函式：在 `data/visits.js` 開一支**只回／只寫任務 ops** 的入口（`taskOps()` 現在是私有的、課程自己讀；
新的入口要能收「還沒存的那一份課程」來試算）。因為來訪不寫，沒有搶寫（`StaleWriteError`）的問題，重跑幾次結果一樣。

### 哪幾筆

- **用到這門課** ＝ `slot.courseId === 這門課`。`taskRules.js` 從頭到尾讀的就是這一格，**不要**另外走 `courseForEquipment()` 推一次（會跟引擎分岔）。
- **長的那一側**從還開著的來訪出發：`listByStatus('confirmed')` ＋ `listByStatus('pending_confirm')`（沒有日期上界；整筆的狀態是推導的，兩種合起來才涵蓋每一段還開著的）。
  **不要用 `listUnclosed()`** —— 它帶著 `date <= today`，只回今天以前的，正好是 ADR-0113 說不長的那幾天。
- **收的那一側**從還沒勾的任務出發（`data/tasks.js` 列還沒做的那一支 → 它們的來訪）：「寫紀錄」是那一段做完才長的，
  開著的那幾張多半掛在**已經結案**的來訪上，只看還開著的來訪收不到它們。
- **只動掛號與寫紀錄兩族的 create／remove。取消類一張都不長**：「壓在哪」變了時，`cancelTasksFor()` 的去重是照種類比的，
  已經取消、收過「取消 Abovee」的段重算會多長一張「取消 Examine」—— 那是假的。

### 先講再寫

存之前的確認框講「會影響 N 天：多 X 張、收掉 Y 張」，數字是拿同一支試算出來的（ADR-0070）。N 是 0 就不問。
課程本身先存、任務後存；進行中鎖住（lessons 三）。

## 判準

- 替一門課多勾一個系統：已經談定、**還沒到**的那幾天各多一張嗎？那一天**已經過了**的呢？（不長，ADR-0113）
- 還**沒談定**（待確認）的段長不長？（不長，照舊等客人說可以）
- 取消勾選：還沒勾的那一張收掉（**包含掛在已結案來訪上的**）；**勾過的一張都不動**（ADR-0106）
- 三個都不勾（`systems: []`，ADR-0126）：掛號那一族全收、**不長**「取消 X」
- 改了「壓在哪」：已經取消的段會不會因為這次重算多長任何一張「取消 X」？（不可以）
- 「寫紀錄」打開：已經做完的舊來訪會不會回頭長一堆？（不會 —— 長的那一側只看還開著的來訪；那一段做完時才長）
- 確認框的數字跟真的動到的筆數是同一支算的嗎？
- 改的是別的格子（名字、時長、診間）：碰不碰任何東西？（不碰、也不問）
- 按兩次、或寫到一半失敗重按：結果跟按一次一樣嗎？
- **任何一筆來訪的 `updatedAt` 有沒有變？**（不可以 —— 變了就是走到 `save()` 了）
- 重算出來的每一張有沒有帶對 `slotIndexes`？（照 `newRegistrations()`／`newRecords()` 的結果，不自己組）

## 順手看一眼（不做，寫下來）

同一個形狀的主檔欄位還有哪幾格（lessons 六）：`needsForm`、`doctorPick`、`assigns`、時長。
各自「改了之後誰手上拿的是舊的」列一張小表放進「做完時留下的」，給之後的人；這一支只做待辦那兩格。

## 測試

- 單元：r06 改寫（一筆假課程的來訪：談定 → 改設定 → 重算）；每一條判準。
- E2E `63`：設定 → 課程 → 一門暫定的課多勾一個系統 → 確認框有「會影響 1 天」→ 待辦中心多一張。

## 文件

新的一支 ADR（為什麼只有這兩格回頭重算、為什麼只寫任務不存來訪、為什麼取消類不長）。`CLAUDE.md`「一門課壓哪幾個系統」那一列補「改了要回頭重算」。
`docs/操作手冊.md` 設定課程那一節補一句她看得懂的話。

## 審查之後（10/8，subagent 過目，主控對過程式碼）

這一份已經照審查改寫過。原本寫錯的：指定用 `listUnclosed()`（撈不到還沒到的那幾天）、走 `save()`（會動到來訪）、
用 `courseForEquipment()` 認課程（引擎讀的是 `slot.courseId`）；漏掉的：取消類會多長假的一張、「寫紀錄」的殘留掛在已結案的來訪上。

## 做完時留下的（10/8）

ADR-0140。E2E `63` 的 M1–M3。`npm test` 全綠；E2E 跑了 `63`（4 條）與課程表單的 `54`、`52`（12 條），都過，跑完模擬器關了。

- **規則在 `domain/taskRules.js`**（兩支新的，沒有多一條規則）：
  - `changedTaskKinds(before, after)` → `{ grown, dropped }`：確認之後掛的系統（`tasksForCourse()`）多了／少了哪幾個、「寫紀錄」開或關。
    **只改「壓在哪」不算**、名字時長診間不算、新增的課程（沒有 `before`）不算。
  - `tasksAfterCourseChange(visit, existingTasks, { before, after, coursesById, today })`：叫 `syncTasksForVisit()`（`coursesById` 裡那一門已經換成 `after`），
    只留 `grown` 的 create（**而且只給還開著的來訪**）、`dropped` 的 remove、`dropped` 的「縮段落」update。整天取消／刪掉的來訪、沒用到這門課的來訪回空的。
    收掉的理由改寫成「『某某』的設定改了，這一張不用做了」。
- **資料層在 `data/visits.js`**（照 issue 寫的放這裡）：`courseTaskPlan(before, changes)`（只算）與 `saveCourseWithTasks(before, changes)`（寫）。
  `config.js` 多一支 `updateOp()`（回還沒寫的操作）。**偏離 issue 的一處：課程本身放最後、不是先存** ——
  先寫課程、待辦寫到一半失敗的話，再存一次時課程已經是新的、`changedTaskKinds()` 是空的，剩下的那幾天沒有人補。
  平常放得下時整件事是同一個 commit（一起成功、復原退得回整組）；超過 200 個操作才分批，課程在最後一批。
- **畫面**：`masterList.js` 的 `saveCourse()`（只有既有的課程走；新增照舊）。先 `courseTaskPlan()` → `consequences.js` 的 `courseChangeConsequences()` 回 `null` 就不問 →
  `confirmAction()` → `saveCourseWithTasks()`。送出那一段多一個 `saving` 記號（確認框開著也算）。讀不到就不存、講一句。
- 判準逐條：每一條都有單元測試（`tests/course-change-tasks.test.js`，39 條，r06 的那一筆是第一條）；「來訪的 `updatedAt` 沒變」「一張取消類都不長」「勾過的不動」
  「再存一次不問也不多長」「改名字不問」在 E2E M1–M3 從資料庫讀回來量。`data/visits.js` 那一段有一組掃原始碼的（不叫 `save(`、不寫 visits、不用 `listUnclosed()`、任務連清掉的讀）。
- `r06-master-change.mjs` import 真的那一支，但它**示範的是「存來訪時不會長」那條路**（自己叫 `syncTasksForVisit()`），修的是「存課程時回頭算」——
  修完它照樣印「耀聖從頭到尾沒有長出來」。不要拿它驗；單元測試的第一組就是它的改寫。

順手看的那一張表（同一個形狀的主檔欄位，改了之後誰拿著舊的）寫在 ADR-0140「只有這兩格」。另外查過的入口：

- 資料健檢「課程做完要不要寫紀錄」（`setNeedsRecord`）：只會把沒設過的打開，不回頭算（`data/health.js` 那一段寫了理由）。資料健檢沒有任何一顆會改 `systems`。
- 停用、刪除、還原一門課：不重算（照舊；存來訪時課程連已刪除的一起讀）。

沒做、留著：

- 確認框只講幾天、幾張，沒有列出是哪幾天（她要看得去待辦中心）。
- 分批寫（超過 200 個操作）那條路只有程式、沒有測試走到（要造 200 張待辦）。

留給 23：

- `CLAUDE.md`「一門課壓哪幾個系統」那一列**已經補了**（這一支直接改的）。
- `docs/常見問題.md` 可以補一題「改了課程的系統，為什麼有幾張待辦不見了／多出來了」。
- 驗收清單（本機模擬器走過，E2E `63` 的 M1–M3）：`設定 → 課程 → 某一門的「編輯」→「壓哪幾個系統」多勾一個 → 儲存`：跳「儲存『某某』？」，
  底下有「會影響 N 天的待辦」「多 N 張『耀聖』」→ `儲存` → `待辦 → 耀聖`：談定了、還沒到的那幾天各一張。再打開同一門、什麼都不改按儲存：不問。
