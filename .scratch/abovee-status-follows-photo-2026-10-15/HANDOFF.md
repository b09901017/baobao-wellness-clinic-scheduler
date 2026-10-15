# 交接：拍 Abovee 照片上的預約狀態為準

分支：`claude/abovee-status-follows-photo`（10/15 從 origin/develop `8ead80d` 開）。只在本機，還沒推。
全貌與她的原話在 `spec.md`；每一支的細節在 `issues/`。流程照 `/kickoff`（`.claude/skills/kickoff/SKILL.md`）的第三、四段。

## 進度

| 段 | issue | effort | 狀態 |
|---|---|---|---|
| 零 | 談、開 issue、subagent 過目、照過目改 issue | — | ✅ 10/15 |
| 一 | 01 六種狀態、02「取消 Abovee」一出生就勾好；她回了中途發現之後加做 10、11 | high | ✅ 10/15（01 `8295384`、02 `f06854e`、10 `1ef4906`、11 `d35c407`） |
| 二 | 03 新的一列照狀態記（含整筆狀態推導）、04 既有的段照照片改狀態 | xhigh | ✅ 10/15（03 `56264c0`、04 `ab65ff9`） |
| 三 | 05 改期、06 一位一天一份計畫（驗證／確認框／寫入只算一次、存檔迴圈、確認框的句子） | xhigh | ✅ 10/15（05 `56988e1`、06 `e078695`） |
| 四 | 07 確認層「要改的」那一塊、E2E 68、改 41／51 與單元測試的預期 | high | 還沒開始 |
| 五 | 08 提示詞重考與部署 staging、09 文件與 ADR-0149、全量 E2E、開 PR | medium | 還沒開始 |
| 六 | `/matt-code-review`、照建議修、CI 綠了合進 develop | xhigh | 還沒開始 |

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
  確認框照實講（每一個「（扣／還 N 次）」加起來＝存完之後的差）、取消 Abovee 已經勾好那一句、健檢那條鏈整位算一次
- **現在的畫面**：要改的那幾列（改狀態、改期）看起來還是「已經記了」＋那一句、沒有勾可以拿掉，但**按「記錄」會寫**（預設勾）——
  「記錄這 N 段」的 N 含它們、確認框分開講。07 給它們自己一塊與勾

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
分支 claude/abovee-status-follows-photo（只在本機）。先 git fetch，origin/develop 往前走了就 rebase。

先讀：.scratch/abovee-status-follows-photo-2026-10-15/HANDOFF.md、spec.md（「推翻的決定」「我自己定、交付時要跟她講一聲的」）、issues/01～07 的「做完時留下的」、issues/08、issues/09；
docs/agents/lessons.md（尤其八、九、十）；CLAUDE.md「AI 的抄字格式」「拍照那一支 Function」兩列與「文件分工」；docs/STAGING.md「部署那一支 Function」；/kickoff skill 的第三、四段。

這一段做 08（提示詞列六種狀態＋一條測試；重考前先問她要不要花那一點 Gemini 費用；改了 functions/ 跑 E2E 前重開模擬器；部署 staging 的 Function，正式的不要）
與 09（ADR-0149、SPEC、CLAUDE.md 那張表的那幾列、操作手冊、常見問題、邊界測試清單、課程與待辦對照表、README、domain.md 的推翻註記慣例）。
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
