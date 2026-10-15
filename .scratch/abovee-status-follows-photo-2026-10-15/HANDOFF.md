# 交接：拍 Abovee 照片上的預約狀態為準

分支：`claude/abovee-status-follows-photo`（10/15 從 origin/develop `8ead80d` 開）。**10/16 推了，PR #157 → develop（還沒合）**。
全貌與她的原話在 `spec.md`；每一支的細節在 `issues/`。流程照 `/kickoff`（`.claude/skills/kickoff/SKILL.md`）的第三、四段。

## 進度

| 段 | issue | effort | 狀態 |
|---|---|---|---|
| 零 | 談、開 issue、subagent 過目、照過目改 issue | — | ✅ 10/15 |
| 一 | 01 六種狀態、02「取消 Abovee」一出生就勾好；她回了中途發現之後加做 10、11 | high | ✅ 10/15（01 `8295384`、02 `f06854e`、10 `1ef4906`、11 `d35c407`） |
| 二 | 03 新的一列照狀態記（含整筆狀態推導）、04 既有的段照照片改狀態 | xhigh | ✅ 10/15（03 `56264c0`、04 `ab65ff9`） |
| 三 | 05 改期、06 一位一天一份計畫（驗證／確認框／寫入只算一次、存檔迴圈、確認框的句子） | xhigh | ✅ 10/15（05 `56988e1`、06 `e078695`＋修正 `e9bf82f`） |
| 四 | 07 確認層「要改的」那一塊、E2E 68、改 41／51 與單元測試的預期 | high | ✅ 10/15（07 `9c9c451`、她回中途發現之後 5／12／14／15 見下一個 commit） |
| 五 | 08 提示詞重考與部署 staging、09 文件與 ADR-0149、全量 E2E、開 PR | medium | ✅ 10/16（08 `fde4291`、09 `3e68de1`；**PR #157**；CI 全量 run 38768289145 三片全綠） |
| 六 | `/matt-code-review`、照建議修、CI 綠了合進 develop | xhigh | 🟡 10/16 審查做完、修了 13 條（見「段六：審查」）；**等她回「審查要她決定的」那幾題才合** |

編號：ADR-0149、E2E spec 68、`sw.js` v193（**11 已經升到 v193 了** —— 同一支 PR，段四不用再升）。

## 過目（10/15，唯讀 subagent）抓到、已經改進 issue 的

主控自己對過程式的七條（全部屬實）：`withExtraSlot()` 不管新段狀態一律退回待確認、`visitWithSlot()` 新開那一筆寫死待確認、
`planAbovee()` 同一組會掉段、`settle()` 只在整天取消時寫取消理由、`cancelTaskLines()` 直接叫 `cancelTasksFor()`（所以「一出生就勾好」要在 domain 做）、
提示詞只在 `functions/` 一份、`claimHalves()` 只認兩種對不上理由、`rebookedHere()` 的豁免靠 `aboveeCancelled` 認。
它最擔心的「驗證、確認框、寫入三邊各算一份」→ 拆出 06（一位一天一份計畫，三邊只讀它）。其餘每一條都已經寫進對應的 issue。

## 段一做成什麼樣子（細節在 issues/01、02 的「做完時留下的」）

- 01：`statusFromAbovee()` 一支（`aboveeState()` 拿掉）；每一列 `photoStatus`（**沒拍到那一欄是 `null`**，不是待確認）、`statusUnread`；
  `readAbovee()` 多回 `noStatusColumn`（`null`／`'some'`／`'all'`）；句子 `photoTimeSays()`／`photoStatusSay()`／`statusColumnSay()` 在 domain、畫面還沒畫。
  `crossCheck()` 照舊只比取消與完成 —— 失約、待確認、`null` 當成還掛著（04 改）
- 02：`cancelTasksFor(…, today, { freed, at })`、`syncTasksForVisit(…, { freed, at })`、`save(visit, customerVisits, { freed })`、
  `cancelTaskLines(after, tasks, coursesById, { freed })`（**export 了**，06 的 `aboveeConsequences()` 用）。還沒有任何呼叫端傳 `freed`（03～06 接）
- 10（她說修的中途發現 2）：`consequences.js` 的 `registrationDropLines(after, tasks, coursesById)`（**export**）—— 取消掉的段身上還沒勾的 Examine／耀聖會被收掉／拿掉這一段，
  講出來＋下一步。只取消幾段、整天、改期（`rebookConsequences()`）三道都接了；`cancelConsequences()` 只拿這一筆的任務（批次取消攤平的那一份以前會漏進別天的）。
  **06 的 `aboveeConsequences()` 也要叫它**（照片改成已取消的段同一個情況）
- 11（第零段那一條，她說了要在哪看到）：只取消一段時 `applyStatus(…, { slotIndex, reason })` 把理由寫在 `slot.cancelReason`；讀只走 `slotCancelReasonOf()`（不退回整筆）；
  讀取卡片照「記的話」的畫法畫。**04 的照片「取消原因」就交給 `applyStatus()` 的 `reason`，自然記在那一段上**（issue 04 第 6 點改過了）。`sw.js` 升到 v193

## 段二做成什麼樣子（細節在 issues/03、04 的「做完時留下的」）

- 03：`slotFromPicks()` 收 `status`／`cancelReason`（沒給照舊待確認）；`visitWithSlot()`／`withExtraSlot()` 整筆照推導（`settle()` export，只有新加的是待確認才退回）；
  `withPlannedSlot()` 讓同一組的段接進同一筆（不再掉段）；`photoSlotStatus()`／`photoWantsChecked()` 照 spec 那張表；二返照片寫完成、健檢還沒做完 → 記成待確認、不預設勾（`closeBlock`）；
  `planAbovee()` 每一組多 `blocked`、`freed`；`photoRowSays()` 勾不勾都講（勾著的進 `mustSee`、沒勾的進「要你看」—— 畫面還沒畫，07）
- 04：`crossCheck()` 照 5×5 表 → 要改的是「已經記了」＋`statusChange`＋`adoptStatus`（預設勾）、只提醒的是對不上（理由全在 `mismatchSay()`）；
  `applyPhotoStatus(visit, items, { at, guard })` 套到重讀的那一份（核對她看到的、閘門、未到 → 已完成一格都不停在半路、回 `freed`）；
  `countDeltas()`／`photoChangeDelta()` 拿 `counts()` 試算；`joinPages()` 記兩張照片不一樣（`statusConflict`）；`claimHalves()`／`claimTimeless()`／重約豁免都接上新的種類
- **還沒接到畫面與寫入**：確認層現在看到要改的那幾列是「已經記了／已取消」，按記錄什麼都不改；新段的狀態已經照照片寫（`record()` 重組時就是照片的狀態）——
  06 接寫入與確認框、07 接畫面。E2E `41` 的 A6 改成新的樣子（`a7` 不再是要你看）

## 段三做成什麼樣子（細節在 issues/05、06 的「做完時留下的」）

- 05：`flagMoved()` 拿得準的那一對（剛好一對、舊時間在照片範圍裡 —— 範圍跟「app 有、這次照片上沒有」同一支 `photoBounds()`、舊的還開著、新的不是已取消、這一列有時間）
  → **「已經記了」＋`move`**（不再是新的一段，`planAbovee()`／二返那幾支都不會多記一段）、`adoptMove` 預設勾（照片狀態那一張表、讀得到全部來訪）、`movedFrom` 照留。
  `applyPhotoMove()` 走 `rebookSlot(…, { status })`（日曆那條路不帶，一個字都不變）；**時長照舊**、治療師／醫師／診間照照片。
  `checkMoves()`：改完之後撞到別人、跟別段重疊、二返簽不成 → **不預設勾＋講**（不是不准改 —— 撞期在 app 裡從來不擋）
- 06：`photoDayPlan()` 一份計畫（改既有的 → 拿改完之後的組新的 → 驗證 → `writes` 照存的先後 → `rows` 的次數 → `deltas`），
  確認層 `plan()`、確認框 `aboveeConsequences({ plan })`、寫入 `record()` 三邊都讀它；寫入一位一位重讀、`writePhotoPlan()` 存一筆換一筆。
  確認框照實講（每一個「（扣／還 N 次）」加起來＝存完之後的差）、取消 Abovee 已經勾好那一句、健檢那條鏈整位算一次。
  存的那一下走 `planToWrite()`（只把已經存好的健檢換成真的 id；E2E `65` L6 抓到一開始的寫法會把同一張照片上的二返存成沒接上，`e9bf82f` 修了，lessons 一補了一條）
- E2E：05 相關 26 支 204 條全綠；06 相關 18 支 144／145（L6）→ 修完拍 Abovee 六支 38 條全綠
- **現在的畫面**：要改的那幾列（改狀態、改期）看起來還是「已經記了」＋那一句、沒有勾可以拿掉，但**按「記錄」會寫**（預設勾）——
  「記錄這 N 段」的 N 含它們、確認框分開講。07 給它們自己一塊與勾

## 段四做成什麼樣子（細節在 issues/07 的「做完時留下的」）

- domain：`offersChange()`、`changeLines()`（句子＋括號讀 `plan.rows`）、治療師／診間預設勾、`needsAttention()` 只留鎖著的、`summarizeAbovee()` 的 `changes`；確認框「補上 N 段」另一句
- 畫面：「要改的」那一塊在「要你看」前面、一行一個勾（`data-abl-change`／`data-abl-fill`）；「改成 Abovee 的」那顆拿掉；記錄那顆「記錄 N 段、改 M 段」；`refreshCloseBlocks()` 接上（中途發現 7）；沒拍到狀態那一欄一句常駐
- E2E 68（S1～S3）、41 A6、51 N5 改預期；`abovee-change-lines.test.js`
- `sw.js` 不用再升（11 已經是 v193、這一段沒有新檔）

## 段五做成什麼樣子（細節在 issues/08、09 的「做完時留下的」）

- 08：提示詞列六種（讀不出來寫空字串、不挑長得像的）＋一條測試；重考狀態 10/10、18/18，其餘沒有退步（ADR-0100），**兩套照片沒有待確認／聯繫中／失約的列，只證明沒退步**；
  staging 的 Function 10/15 15:52Z 部署了（`ACTIVE`、沒登入叫不動），**正式的沒有**
- 09：ADR-0149、domain.md 的推翻註記慣例、SPEC、CLAUDE.md 九列、操作手冊、常見問題四題、邊界測試清單 M13～M17、對照表、README 第 41 列
- 驗：`npm test` 4649；相關 E2E 本機 412 條 410 綠、61 H1 本來就跳過、41 A4 寫入逾時一次（機器忙，單獨 3/3 綠）；CI 全量三片綠；
  手動驗收清單 1～10 用 E2E 68 的種子＋假抄字在本機 390px 走過（截圖在 `.local/repro/walk-*.png`，假名）
- PR #157 內文有手動驗收清單、「我自己定的」、留給她決定的（中途發現 17）

## 段六：審查（10/16，`/matt-code-review` 從 merge-base `8ead80d`，Standards／Spec 兩個 subagent）

**次數**（她最在意的）：Spec 那一支拿真的 domain 函式＋照 `save()` 算快取的假身體跑了 20 種情境（已確認→未到、未到→已完成、改期到未到／已完成、
同一天取消＋改期＋新的、合併扣課改成完成／取消／改期、送的／體驗、n返、同一筆新的取消＋完成、那一天結案另開一筆、二返被擋…），
**修完之後重跑：每一種的確認框括號加總＝計畫 `rows`＝存完之後 `counts()` 的差，額度快取＝`counts()`**（腳本在那一次 session 的 scratchpad，s1～s8）。
找到兩條會讓次數錯的，都修了（下表 1、2）。

### 修了的（一條一個 commit）

| # | 哪一支提的 | 是什麼 | commit |
|---|---|---|---|
| 1 | Spec | **存的那一下重讀之後，新的那一列 app 上已經有了（別的地方剛記了、或上一趟其實寫進去了）照樣再記一次 → 同一段多扣一次**。`photoDayPlan()` 先拿掉 `alreadyInApp()` 的列、那一列講為什麼 | `3c943cf` |
| 2 | Spec | **她自己選的人（照片上沒認出來），照片要改狀態（例：已取消 → 還 1 次）卻預設打勾**；新的列本來就不勾。改狀態、換治療師／診間都問 `recognized`，那一行講「人是你選的，確定再勾」 | `049fbcd` |
| 3 | Spec | 健檢＋二返兩段照片都寫完成：健檢先存、那一下二返還沒做完 →「追蹤健檢報告」長出來、二返存完照留；**確認框一句都沒講**。確認框改成照存的先後一筆一筆算（`chainAsWritten()`）。寫入那一側沒改 —— 見「要她決定」第 2 題 | `fd90681` |
| 4 | Spec | 要改的每一件都改不成時，「改這 1 段」照樣按得下去、按了什麼都沒發生。`recordBar()`：數真的會寫的、改不成的講一句、0 段按不下去 | `86e2922` |
| 5 | Spec | 同一列一件改成了、一件沒改成（治療師剛在別處改過、狀態照改）：存完整列的勾拿掉、狀態那一行寫「不改」，其實已經改了。`missedField` 記是哪一格，只拿掉那一個勾 | `bc87fab` |
| 6 | 兩支 | 送的／體驗、n返改狀態：「要改的」寫「本來就不扣次數」、確認框寫「次數不變」。`changeChargeSay()` 一支 | `1e4878c` |
| 7 | 兩支 | `photoChangeDelta()` 畫面不叫、註解卻說確認框讀它 → 拿掉，那條測試改驗 `photoDayPlan()` | `57d658a` |
| 8 | Standards | `newVisitWith()` 直接讀 `slot.cancelReason` → 走 `slotCancelReasonOf()` | `a45341e` |
| 9 | Standards（壞味道） | 「日子過了還沒結案」收起來那一組拿句子的開頭比 → `photoRowReason()` 回種類 | `cf83e85` |
| 10 | Spec | 既有的那一段、照片上讀不出預約狀態：只寫「已經有了」→ 多講「讀不出預約狀態 —— 狀態沒有拿來比」（spec 01） | `f30206b` |
| 11 | Standards | `aboveeConsequences()` 兩條路（畫面走 `plan`、測試走 `groups`，次數各數一次）→ `planOfGroups()` 換成同一種形狀，底下一條路 | `6c94c53` |
| 12 | Standards | **常見問題與 ADR-0149 說「改錯了去日曆改回來」—— 不是真的**：已完成、已取消是終點，只有未到退得回簽療程單。照三種講怎麼辦 | `a5f93b9` |
| 13 | Standards | 操作手冊拍 Abovee 那一段定義了規則（取消 Abovee、壓完）→ 連回 ADR-0149 | `d207b1d` |

`npm test` 4660 全綠。

### 提了、沒改的（理由）

- **三處沒有 `closeBlock` 時退回寫死的「接的那一次健檢還沒做完」**（Standards 4）：跑不到（每個呼叫端都帶 `closeBlock`）；沒有那一格就不知道那一次是排著還是取消了，
  講不出比這一句更準的下一步
- **整天取消那一句「會被收掉」照 `ownKinds` 自己篩、只取消一段那一條拿 `registrationDropLines()`**（Standards）：整天那一句是這一輪之前就在的；
  整天取消時兩種算法答案一樣（全部收掉）。改成同一支會動到日曆、批次取消四個入口的字，不在這一輪
- 重複的小段落（`ATTENDED` 在 `slotDraft.js` 與 `closeVisit()` 各一份、`applyPhotoStatus()`／`applyPhotoMove()` 的「她看到的跟現在一樣嗎」、改期那一句的後半兩處、
  按鈕的字與確認框抬頭各組一次）：都是判斷題，現在兩邊一樣；抽出來的收益小於在審查這一段多動一批檔案的風險
- `aboveeImport.js` 2700 行（Divergent Change）：拆檔是另一輪的事
- `plan.deltas` 只有測試在讀：它是「計畫講的＝存完的差」那一條判準在驗的東西，留著

### 審查發現、要她決定的（做完一次列給她）

1. **同一天被拆成兩次來訪**（Spec 5）：照片上同一天「app 上那一段改成完成（或取消）」＋「一段新的」→ 計畫拿**改完之後**的那一天去併（issue 06 寫的），
   那一天改完就結案了 → 新的那一段另開一次來訪；確認框講「這天已經結案了，另開一次」。日曆上那一天會有兩張卡片，資料健檢「同一天有兩筆來訪」會列它（還寫著「這是舊資料」）。
   例：今天 10:00 SIS 照片寫課程完成、15:00 新約了復健科。**建議：改成拿拍照之前那一天開著沒去併**（一天一次來訪，ADR-0083）—— 要動 `photoDayPlan()` 組新段的順序，她說了才做
2. **健檢＋二返同一次記完成時多出來的「追蹤健檢報告」**（上表 3）：現在確認框會講，但那一張其實不需要（二返都做完了），她勾掉之後還會再長「寄報告給醫師」。
   **建議：照現在**（多一張可以勾掉，ADR-0142 她講的方向）；要「存完自動收掉」的話要動存檔那一支，而後一筆存失敗時那一張就安靜地少了
3. **照片抄錯成「課程完成」時，app 裡改不回來**（上表 12 查到的）：跟她自己在簽療程單點錯一樣（已完成鎖著）。照片的狀態欄考試全對，**建議：照現在**，只在常見問題講清楚
4. 中途發現 17 還在等她（`flagMoved()` 跳過 app 上取消過的那一格）
5. （這一輪之前就有的）資料健檢「同一天有兩筆來訪」那一項寫「現在同一天只會有一筆，這是舊資料」—— 那一天結案之後再排一段本來就會有第二筆（ADR-0083），那一句不對。要不要改字

## 中途發現（段落結束時一次列給她，問要不要修）

1. ✅（第零段）**一天只取消其中一段時，取消理由記不下來** —— 她 10/15：「可以就像記的話那樣，如果取消的話就顯示取消理由，整天取消先不用顯示」→ **issue 11 做完**
2. ✅（段一，她：「修」→ **issue 10 做完**）**只取消其中一段時，那一段還沒勾的 Examine／耀聖待辦被安靜收掉，確認框不講**。整天取消的確認框講「還沒做完的「Examine」會被收掉」，
   只取消一段那一條（`cancelConsequences()` 的 `picked` 那一段）沒有這一句。她其實掛了、只是忘了勾的話：待辦收掉、也不長「取消 Examine」，沒有人提醒她回 Examine 收。
   拍 Abovee 改成已取消（04）走同一條。建議：只取消一段的確認框補同一句，並說「已經掛了的話先去勾掉它，取消時才會提醒你回去收」
3. ➡ 段二（她：「好照你的建議」→ **寫進 issue 04 第 4 點**）**同一頁拍了兩張、同一列兩張的預約狀態不一樣時，先傳的那一張贏、安靜地**（`joinPages()` 只在第一張那一格空著才補）。
   01 之前沒差（狀態不拿來寫），03／04 之後它決定寫成什麼。spec 04 寫了「同一段在照片上有兩列、狀態不一樣 → 不自動改」，但兩列在進 04 之前就被併成一列、差異沒了。
   建議：段二做 04 時 `joinPages()` 記一個「兩張的狀態不一樣」（兩張都讀得出來、`photoStatus` 不同），04 不改、03 不預設勾、講一句
4. （段一，只記著、不用修）「一出生就勾好」的那一張被**復原**的話會變成「勾過又刪掉」，`seenTasks()` 當成做過。現在只有拍 Abovee 會傳 `freed`，
   而那一條路不給復原（`undoable: false`）—— 寫在 `cancelTasksFor()` 的註解裡，新增一條傳 `freed` 的路要先想這一條
5. （段二，問她）**照片上日子過了還是「確認前往」、app 裡沒有的那幾列，會排進最上面的「要你看」**。照她講的「過去的沒取消也沒完成也要提醒」做的：不預設勾＋講一句。
   拍一張比較舊的頁面（Abovee 上還沒改成課程完成的那種）時，可能一次好幾列都排到最上面，把真的要決定的擠下去。
   建議：先照現在（提醒得到）；她覺得擠的話，段四（07）改成留在那一天的那一組裡、只在那一列講一句、不進「要你看」
6. （段二，段三要收）**存的那一刻重算的那一份，跟確認層看到的不一樣**（lessons 一的「同一個入口裡的兩個時機」）：`record()` 存每一天時只拿**那一天的新列**重組
   （`planAbovee(d.items…)`），看不到照片要改的既有那幾段（04）與別天的新列。例：9/1 的健檢這一次從照片改成已完成、9/5 的二返是新的一列照片寫完成 ——
   確認層判「接得上、記成已完成」，存的時候重算卻看不到 9/1 改了 → 把二返記成待確認，沒有人講。06 的「一位一天一份計畫，三邊只讀它」正是要收這個；列出來是讓段三拿這一種當判準
7. （段二，小的）**讀照片那一下判好的「二返要改成已完成」不會跟著她之後的勾變**：她拿掉健檢那一列「要改成已完成」的勾，二返那一列還是寫要改。
   存的時候 `applyPhotoStatus()` 的閘門會擋下來（一格都不動、回在 `missed`），不會寫錯 —— 只是畫面上沒有先講。建議：07 接一個跟 `refreshNoExam()` 一樣的重算
   （段三：存完那一句現在照理由講 —— `missedSay()`「9/5 沒改成已完成：接的那一次健檢（9/1）還沒做完」）
8. ✅（段三，順手修了 —— 06 的判準要它）**「接哪一次健檢」那一排只看存著的來訪**：照片取消掉 10:00 那一場二返、11:00 新的二返要接同一次健檢時，
   驗證放行了，那一排卻還把那一次當成被 10:00 佔走、按不下去、也不先選。`examChoices(…, items)` 改看 `afterPhoto()`（照片要改的狀態、改期都套上去）
9. （段三，要跟她講一聲的決定）**改期之後撞到別人：我做成「不預設勾＋講」，不是 issue 寫的「不改」**。
   app 裡撞期從來不擋（ADR-0094，新的段撞期也是記得進去、只提醒）；改期之後撞到的常常是 app 上那一位還沒改。勾了照樣改期。要改成「勾不起來」要她說
10. （段三，小的，只記著）**同一位這一次又取消了一次健檢、又記了一次新的健檢時，同一場二返可能被講兩次**：「還接在被取消的健檢後面，不會跟著取消」（`strandedFollowupLines()`）
    與「另約健檢 —— 要接到這一次的話…」（`strandedOnNewExamLines()`）各一句。兩句都是真的，只是囉嗦；去重要知道兩句講的是不是同一場，先不做
11. （段三，行為變了、要跟她講一聲）**存的時候重讀之後才驗得出的錯誤，那一天不寫、講出來**（`missedSay()` 的「N 段存不下去：…」）。以前 `record()` 重讀之後不驗、照寫。
    只會在打開確認層到按記錄之間，她在別的地方把那一天改了才發生
12. （段四，問她）**「對不上」（狀態只提醒）的那一段，治療師／診間又不一樣時，那一列在「要你看」、治療師那一行在「要改的」**。
    兩件事不一樣（狀態我們不改、治療師改），但 issue 判準寫「同一列不會兩邊都出現」。我照「一行一件事」做；要改成「對不上的那一段治療師也不先勾、留在要你看」要她說
13. （段四，問她）**同一段的治療師與診間是一個勾**：資料上只有一格 `adopt` 管兩樣（`adoptAbovee()` 一次換兩格）。她要分開勾的話得拆那一支，牽到寫入與「別的裝置改過」那一道比對
14. （段四，小的）確認框「照 Abovee 改成「已完成」1 段」次數不變時**沒有括號**（`timesSay(0)` 回空的），「要改的」那一塊那一行寫「（次數不變）」。兩邊講的一樣，只是一邊沒寫。要的話段五順手補成「（次數不變）」
15. （段四，小的，原本就有）確認框那一句「「待確認」的 N 段 —— Abovee 上寫的「確認前往」不等於問過客人」：照片上寫「聯繫中」「待確認」的也被說成「確認前往」
16. （段四，小的，原本就有）日期分組裡「已經記了」「要改」的那幾列，「做什麼」那一格印的是照片原字（`SIS 60`），不是 app 的名字（`SIS(60)`）—— 那幾列的預選被清掉了，`slotOf()` 組不出一段，退回原字

17. （段五，問她）**日曆上改了時間、Abovee 還沒改，再拍那一頁**（邊界測試清單 M12，ADR-0144 那一種）：照片範圍包到 app 上新的那個時間時
    （例：讀得出第 1／1 頁），`flagMoved()` 把它認成「Abovee 把 11:00 改回 10:00」—— 那一列變成「要改的」裡一行**沒勾的**「11:00 → 10:00（不改）」，
    **沒寫為什麼不勾**，而且 ADR-0144 那一句「app 上這一段取消過 —— 回 Abovee 放掉」不見了（`asRecorded()` 把 `appCancelledHere` 清掉）。
    不會寫錯（沒勾），只是講錯方向：真正的情況是 app 先改、Abovee 還沒改。照片範圍沒包到時照舊（新的、不勾、那一句）。
    建議：`flagMoved()` 跳過 `appCancelledHere` 的列（那一格 app 上取消過，就不是 Abovee 改了時間），照 ADR-0144 走。`.local/repro/m12.test.mjs` 重現得出來
18. （段五，我弄的，只記著）重考時 `.local/references/ai-exam/abovee-photos-exam.mjs` 的日期寫死 `2026-10-09`，蓋掉了 10/9 那一份手機照片的原始抄字
    （分數還在 ADR-0100、10/14 兩次是同一批照片）。改成預設今天、這一次的另存成 `result-2026-10-15-abovee-photos-default.json`

## 她回的（10/15 段四結束後）—— 段四同一個 session 順手做完的標 ✅

- 5（過去還是確認前往的列擠在最上面）：「用收合的就好」→ ✅ `pastStillOpen()`：日子過了、Abovee 上還是待確認那三種（app 上沒有的新列、app 上也還沒結案的 `bothOpen`）
  收在「要你看」底下一組 `<details>`「日子過了、Abovee 上還沒結案的 N 段」，預設收著；抬頭另外數「過了還沒結案 N 段」、不算進「要你看」。別的理由也在的（二返簽不成、取消過…）不收。
  **她另外想要一支月底對帳的 skill** —— 見下面「之後另開一輪」
- 9（改期撞到別人）：照現在（不預設勾＋講一句）
- 10（同一場二返講兩次）：照建議，不修
- 11（存的那一下重讀之後驗不過的那一天不寫）：照現在。給她的白話：打開確認層到按記錄之間，她在別的地方把那一天改了，存的那一下 app 會重讀；
  重讀之後那一天驗證不過就不寫、跳一句「N 段存不下去：…」—— 以前照寫
- 12（對不上的那一段治療師也不一樣）：「以 Abovee 為主…確認是同一件事不是新的就好，先勾，留在要你看」→ ✅ 現在就是：那一列（同一位、同一個時間、同一門課，`crossCheck()` 認的）
  留在「要你看」，治療師那一件在「要改的」預設勾；**那一列收著多一行**「治療師：app 是 A、Abovee 是 B —— 照 Abovee 改（勾在最上面「要改的」那一塊）」，兩邊都看得到是同一件事
- 13（治療師與診間同一個勾）：**不是問題，撤回**。一門課只記其中一種（`course.assigns` 是 `therapist` 或 `room`，`assignsFor()` 回一個值），所以同一段永遠只會有一種不一樣，一個勾不會綁兩件事
- 14：✅ 確認框「照 Abovee 改成…」「照 Abovee 改期…」次數不變也寫「（次數不變）」
- 15：她問「為什麼會被說成確認前往」—— 確認框那一句寫死了「Abovee 上寫的『確認前往』」（她截圖那一次：兩段待確認，一段照片寫「聯繫中」，句子照樣說確認前往）。
  ✅ 改成照片上真的寫的那幾個字（`「聯繫中」、「確認前往」`）；讀不出來、還沒到就寫完成那種記成待確認的不算；沒拍到那一欄的舊呼叫照舊
- 16：不改

### 之後另開一輪（她 10/15 提的，**不在這一輪**）：月底對帳的 skill

她要的：月底或下個月初，一次檢查上個月 **Abovee 截圖 × 試算表 × app** 有沒有矛盾，**主要是有額度的來訪的次數**（多一層保障）。
**獨立於 app**：不在 app 上傳一堆截圖（耗 Gemini），用 Claude Code 讀她給的資料夾（整個月的截圖）＋直接讀 Firebase，用 skill 檢查；她提議用 `/skill-creator` 做。
我的建議（還沒動工）：
- 值得做，**另開一輪**（`/kickoff`），這一輪合進 develop 之後再開 —— 它讀的是這一輪寫進去的狀態，規則還在動的時候做會白做
- 不從零寫：截圖讀字用已經在 develop 的 `pixel-exact-screenshot-extraction`（本機逐像素比對，不叫 Gemini）；三方比對的程式 10/5 做過一份一次性的（`.local/references/abovee-m5-m10/三方比對/`），把它收成 skill
- Firebase 唯讀：服務帳號金鑰放 `.local/`（`*-sa.json` 本來就擋著），只讀不寫；報告與中間檔一律 `.local/`（有真名）
- 試算表那一側：讀 app 推過去的那一份，還是 app 自己現算（`sheetReport.js`）？要問她 —— 試算表是 app 推的，兩邊不一樣代表推送沒跟上，不代表次數錯
- 報告照「一次一題、畫出來」的寫法（她 10/5：資料總表看不懂）

## 她回的（10/15 段一結束後）

- 中途發現 1（每一段的取消理由）：「可以就像記的話那樣，如果取消的話，就可以顯示取消理由，整天取消就先不用顯示沒關係」→ issue 11
- 中途發現 2：「修」→ issue 10
- 中途發現 3：「好照你的建議」→ issue 04 第 4 點

## 她回的（10/15 段一開場）

- 每一段自己的取消理由：另開一小支，注意牽連，不擋這一輪（見中途發現 1）
- 08 重考的 Gemini 費用（約 US$0.1）：**可以**
- 「Abovee 待確認／聯繫中、app 已確認 → 不退回待確認」：同意
- 「Examine／耀聖的取消待辦照長」：同意。她問「忘記勾 Examine／耀聖的掛號待辦，會被當成沒做還是一直留著？」—— 段一查了：
  **當成沒做**，取消那一段時那一張被系統收掉（不會一直留著），也不長「取消 Examine」（見中途發現 2）

---

## 每一段的開場

共同的提醒（每一段開場都有）：動手前用 grep／graphify 找要改的每一個函式的所有呼叫端與畫面上的字；動工前掃 `docs/agents/lessons.md`；
中途發現她沒發現的關聯問題或類似的問題，先記進 HANDOFF「中途發現」、繼續做，這一段做完一次列給她問要不要修，修的時候注意會不會牽連別的地方。
每支：紅燈測試 → 綠 → `npm run verify` → 一個 commit → `Status: done` ＋ 在 issue 底下寫「做完時留下的」。

### 段一（effort：high）

```
接手「拍 Abovee 照片上的預約狀態為準」這一輪的段一。
分支 claude/abovee-status-follows-photo（只在本機）。先 git fetch，origin/develop 往前走了就 rebase。

先讀：.scratch/abovee-status-follows-photo-2026-10-15/HANDOFF.md、spec.md、issues/01、issues/02；
docs/agents/lessons.md（尤其一、四、五、七）；CLAUDE.md「拍 Abovee 記很多段」「取消類的待辦」「被刪掉的任務算不算做過」「一句『按下去會發生什麼』」四列；/kickoff skill 的第三段。

這一段只做 01（六種狀態對照＋時間合不合理）與 02（照片上已經放掉的段，「取消 Abovee」一出生就勾好 —— 在 domain 做，cancelTasksFor 的 freed）。03 以後不要碰。
動手前用 grep／graphify 找 aboveeState、item.cancelled、statusText、cancelTasksFor、cancelTaskLines、seenTasks、taskOps 的所有呼叫端。
過程中發現她沒發現的關聯問題或類似的問題，先記進 HANDOFF「中途發現」、繼續做；這一段做完一次列給她，問要不要修（修的時候注意會不會牽連別的地方）。

每支：紅燈測試 → 綠 → npm run verify → 一個 commit → Status: done ＋ issue 底下寫「做完時留下的」。
做完：更新 HANDOFF 進度，列中途發現，把段二的開場（HANDOFF 裡，effort xhigh）貼給她，停。
```

### 段二（effort：xhigh）

```
接手「拍 Abovee 照片上的預約狀態為準」這一輪的段二。
分支 claude/abovee-status-follows-photo（只在本機）。先 git fetch，origin/develop 往前走了就 rebase。

先讀：.scratch/abovee-status-follows-photo-2026-10-15/HANDOFF.md（段一做成什麼樣子、中途發現）、spec.md、issues/01、02、10、11 的「做完時留下的」、issues/03、issues/04；
docs/agents/lessons.md（尤其一、二、四、五）；CLAUDE.md「一段來訪的狀態」「一筆來訪改得動的地方」「新增一個會建立時段的入口」「次數的算法」「健檢與二返的關係」「拍 Abovee 記很多段」各列；/kickoff skill 的第三段。

這一段只做 03（app 沒有的列照照片狀態記；visitWithSlot／withExtraSlot 照新段狀態推整筆；同一組的段不可以掉；預設勾的新規則）與 04（app 已經有的段照照片改狀態；不弄壞 claimHalves／claimTimeless／rebookedHere）。
05、06、07 不要碰（存檔迴圈與確認框是 06、畫面是 07）。判準只到 domain：拿 planAbovee 組出來的那一筆、整筆狀態、counts() 驗。
段一的中途發現 3（同一頁拍兩張、兩張的狀態不一樣）她說照建議 → 已經寫進 issue 04 第 4 點，跟 04 一起做。段一另外做完了 10、11（見 HANDOFF「段一做成什麼樣子」）：
04 的照片「取消原因」交給 applyStatus() 的 reason 就會記在那一段上（issue 11），04 的確認句子要講的「還沒勾的 Examine 會被收掉」是 registrationDropLines()（issue 10，06 接）。
photoStatus 是 null（那一張沒拍到那一欄）的列：03 照舊的預設勾、04 一律不比。
次數是她最在意的：每一條次數判準都拿 counts() 算改之前與改之後，不看畫面上的字。
動手前用 grep／graphify 找 photoStatus、statusUnread、statusFromAbovee、joinPages、slotFromPicks、visitWithSlot、withExtraSlot、INITIAL_STATUS、resolveItem、asRecorded、planAbovee、crossCheck、claimHalves、claimTimeless、applyStatus、closeVisit、cannotClose 的所有呼叫端。
過程中發現她沒發現的關聯問題或類似的問題，先記進 HANDOFF「中途發現」、繼續做；這一段做完一次列給她，問要不要修（修的時候注意會不會牽連別的地方）。

每支：紅燈測試 → 綠 → npm run verify → 一個 commit → Status: done ＋ issue 底下寫「做完時留下的」。
做完：更新 HANDOFF 進度，列中途發現，把段三的開場（HANDOFF 裡，effort xhigh）貼給她，停。
```

### 段三（effort：xhigh）

```
接手「拍 Abovee 照片上的預約狀態為準」這一輪的段三。
分支 claude/abovee-status-follows-photo（只在本機）。先 git fetch，origin/develop 往前走了就 rebase。

先讀：.scratch/abovee-status-follows-photo-2026-10-15/HANDOFF.md（段二做成什麼樣子、中途發現 6）、spec.md、issues/01～04 的「做完時留下的」（**04 最後一段「給段三（06）」**）、issues/05、issues/06；
docs/agents/lessons.md（尤其一、二、三、五）；CLAUDE.md「拍 Abovee 記很多段」「一句『按下去會發生什麼』」「存一筆來訪時手上那一份是舊的」「健檢與二返的關係」各列；/kickoff skill 的第三段。

這一段只做 05（Abovee 改了時間 → 照片為準改期；rebookSlot 多收狀態、範圍跟 absentFromPhoto 共用一支、改期那一列不再被當新段）與
06（一位一天一份計畫：plan()、aboveeConsequences()、record() 三邊只讀它；record() 每存一筆換進手上那一份、失敗重按不重複；確認框的句子照實講；健檢那條鏈整批算一次）。
畫面上「要改的」那一塊是 07，不要做。判準：確認框的次數加總＝存完之後每一筆額度前後的差（counts() 與額度上的 doneCount／bookedCount 都驗）。
確認框（aboveeConsequences）照片改成已取消的段，還沒勾的 Examine／耀聖會被收掉那一句叫段一的 registrationDropLines()（issue 10），已經勾好的「取消 Abovee」用 cancelTaskLines(…, { freed })。
動手前用 grep／graphify 找 flagMoved、movedFrom、rebookSlot、boundsOf、within、absentFromPhoto、plan(、record(、visitsForCheck、aboveeConsequences、registrationsWhenSettled、settledDayLine、chainInputs 的所有呼叫端與畫面上的字。
過程中發現她沒發現的關聯問題或類似的問題，先記進 HANDOFF「中途發現」、繼續做；這一段做完一次列給她，問要不要修（修的時候注意會不會牽連別的地方）。

每支：紅燈測試 → 綠 → npm run verify → 一個 commit → Status: done ＋ issue 底下寫「做完時留下的」。
做完：更新 HANDOFF 進度，列中途發現，把段四的開場（HANDOFF 裡，effort high）貼給她，停。
```

### 段四（effort：high）

```
接手「拍 Abovee 照片上的預約狀態為準」這一輪的段四。
分支 claude/abovee-status-follows-photo（只在本機）。先 git fetch，origin/develop 往前走了就 rebase。

先讀：.scratch/abovee-status-follows-photo-2026-10-15/HANDOFF.md（段三做成什麼樣子、中途發現 7～11）、spec.md、issues/01～06 的「做完時留下的」（**06 最後一段「給段四（07）」**）、issues/07；
docs/agents/lessons.md（尤其一、五）；CLAUDE.md「畫面上一段常駐的說明」「貼在畫面底部的東西」「蓋住整頁的一層」「共用元件身上的屬性名字」「拍 Abovee 記很多段」各列、「測試怎麼跑」那一節；/kickoff skill 的第三段。

這一段只做 07：確認層「要改的」那一塊（一列一件事、預設勾、補治療師診間收成一行、從「要你看」拿掉治療師診間那一條；改狀態 adoptStatus、改期 adoptMove 現在預設勾著、按記錄就寫，但畫面上沒有勾可以拿掉 —— 這一塊要給）、
括號的次數讀 photoDayPlan() 的 rows（不在畫面上推）、抬頭與「記錄」的數字（現在 N 含要改的那幾列，確認框分開講「記錄 N、改 M」）、refreshCloseBlocks() 接上（中途發現 7）、
E2E spec 68（假抄字六種狀態、8/29 以前／當天／以後、不用真名、登記 related.js、不用 waitForTimeout）、改 41 的 A6 與 51 的 N5 和 issue 列的那幾支單元測試的預期（改之前先確認新結果是 spec 表上要的）、sw.js v193。
畫面要在本機模擬器真的點過（npm run emulators；同時只開一組模擬器＋一個瀏覽器，她的筆電會過熱；換 worktree 前依 port 停掉殘留的模擬器）。
動手前用 grep／graphify 找 adopt、adoptStatus、adoptMove、wantsWrite、adoptHtml、needsAttention、summarizeAbovee、pendingCount、diffSay、recordedSay 的所有呼叫端與畫面上的字（「改成 Abovee 的」）。
過程中發現她沒發現的關聯問題或類似的問題，先記進 HANDOFF「中途發現」、繼續做；這一段做完一次列給她，問要不要修（修的時候注意會不會牽連別的地方）。

做完：一個 commit、Status: done ＋「做完時留下的」、npm run verify、相關 E2E 本機跑；更新 HANDOFF 進度，列中途發現，把段五的開場（HANDOFF 裡，effort medium）貼給她，停。
```

### 段五（effort：medium）

```
接手「拍 Abovee 照片上的預約狀態為準」這一輪的段五。
（段四之後她回了中途發現 5、9～16，段四同一個 session 已經做完要做的 —— 見 HANDOFF「她回的（10/15 段四結束後）」；08 重考的 Gemini 費用她 10/15 已經說可以，不用再問。）
分支 claude/abovee-status-follows-photo（只在本機）。先 git fetch，origin/develop 往前走了就 rebase。

先讀：.scratch/abovee-status-follows-photo-2026-10-15/HANDOFF.md、spec.md（「推翻的決定」「我自己定、交付時要跟她講一聲的」）、issues/01～07 的「做完時留下的」、issues/08、issues/09；
docs/agents/lessons.md（尤其八、九、十）；CLAUDE.md「AI 的抄字格式」「拍照那一支 Function」兩列與「文件分工」；docs/STAGING.md「部署那一支 Function」；/kickoff skill 的第三、四段。

這一段做 08（提示詞列六種狀態＋一條測試；重考（費用她已經說可以）；改了 functions/ 跑 E2E 前重開模擬器；部署 staging 的 Function，正式的不要）
與 09（ADR-0149、SPEC、CLAUDE.md 那張表的那幾列、操作手冊、常見問題、邊界測試清單、課程與待辦對照表、README、domain.md 的推翻註記慣例）。
ADR-0149 要寫進：治療師／診間預設照 Abovee 改（推翻 ADR-0123 第 11 段「她按了才改」）、「要改的」那一塊、日子過了還沒結案的收起來（中途發現 5）。
CLAUDE.md「拍 Abovee 記很多段」那一列裡「她按了才 adoptAbovee()」「app 上還沒選的只是可以補，不進要你看」那幾句要跟著改；「一筆來訪改得動的地方」那一列的「她按了『改成 Abovee 的』才改」也是。
然後：npm run verify、相關 E2E 本機跑、全量丟 CI（gh workflow run e2e-full.yml --ref claude/abovee-status-follows-photo）、推分支、開 PR 進 develop
（內文附她可以照順序點的手動驗收清單，每一步在本機模擬器走過；不帶真名；spec「我自己定」那幾條寫進去）。這一段不合併。
過程中發現的先記進 HANDOFF「中途發現」；做完一次列給她，問要不要修。
做完：更新 HANDOFF 進度（PR 號碼），把段六的開場（HANDOFF 裡，effort xhigh）貼給她，停。
```

### 段六（effort：xhigh）

```
接手「拍 Abovee 照片上的預約狀態為準」這一輪的段六：審查與合併。
分支 claude/abovee-status-follows-photo，PR 已開（號碼見 HANDOFF）。先 git fetch。

先讀：.scratch/abovee-status-follows-photo-2026-10-15/HANDOFF.md、spec.md、每一支 issue 的「做完時留下的」；docs/agents/lessons.md；/kickoff skill 的第四段。

跑 /matt-code-review（從這一輪分支跟 origin/develop 的 merge-base 開始，審全部的改動）。照建議修（每一條修之前 grep 一次會不會牽連別的地方，一條一個 commit）；
提過沒改的寫理由進 HANDOFF。她最在意次數：審查要特別確認每一條會改狀態、改期、記新段的路，確認框講的次數、寫進去的次數、額度快取三邊一樣，都拿 counts() 驗過。
要她決定的、審查中發現她沒發現的，做完一次列給她，問要不要修。
CI 全綠、她沒有要再改的之後，合進 develop（staging 會自動部署；這一段又改了 functions/ 的話 staging 的 Function 再部署一次）。進 main 不在這一輪。
最後：HANDOFF 寫「已合進 develop（commit）」，把手動驗收清單貼給她。
```
