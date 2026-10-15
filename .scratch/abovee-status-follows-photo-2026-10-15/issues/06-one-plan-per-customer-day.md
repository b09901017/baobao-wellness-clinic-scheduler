# 一位一天一份計畫：驗證、確認框、寫入只算一次（含存檔迴圈與確認框的句子）

Status: done
Blocked by: 02、03、04、05
動工前先讀：`spec.md`「一位一天一份計畫」「次數」兩節；ADR-0070（後果只講真的會發生的）、ADR-0104 第 5 點（一位一天一個 commit、存之前重讀）、ADR-0138、ADR-0142、ADR-0145；
`ui/components/aboveeConfirm.js` 的 `plan()`、`record()`（`:895-1000`：`fresh`、`savedDays`、`:962-963` 排序、`:973-976` 重讀後再跑 `planAbovee()`、`:984-988` 連存、`:1040-1046` 改不成那一句與重設）；
`domain/aboveeImport.js` 的 `planAbovee()`、`visitsForCheck()`、`resolveSaved()`、`plannedId()`、`stuckLinks()`、`queueMarksAfter()`（`:1622`）、`adoptAbovee()`；
`domain/consequences.js` 的 `aboveeConsequences()`（`:378-460`）、`cancelTaskLines()`（`:1097`）、`chainAfterClose()`（`:787`）、`registrationsWhenSettled()`（`:67-76`）、`settledDayLine()`、`closedDayLine()`、`strandedFollowupLines()`、`strandedOnNewExamLines()`（`:334`）、`followupBookingLines()`；
`data/visits.js` 的 `save()`（`:162-171` 次數快取用的是哪一份）、`chainInputs()`（`:295`）、`listByVisitForSync()`；`domain/followups.js` 的 `syncFollowupTasks()`；
CLAUDE.md「存一筆來訪時手上那一份是舊的」「一句『按下去會發生什麼』」「拍 Abovee 記很多段」三列；`docs/agents/lessons.md` 一、二、三、五

## 她要的

> 次數不能弄錯這很重要 ! !

> 確實有可能我會忘記或是其他情境導致一些問題，希望你都考慮進去

## 為什麼會這樣

「拍完、記錄之後那一天長什麼樣」現在有三個地方各算一次（10/15 過目）：
- `plan()`：驗證與提醒，只認識**新的段**
- `aboveeConsequences()`：確認框的句子與次數，也只認識新的段（`:389` 寫死「每一段都記成『待確認』」）
- `record()`：真的寫入；一天連存好幾筆時共用同一份舊的 `fresh`

03、04、05 把「改狀態」「改期」接進來之後，三份一定會分岔：照片上「舊時間已取消＋新時間的二返」那一對、合併扣課的後一半、同一天兩筆的那一天 ——
確認框講的次數、提醒、寫進去的會是三種結果（lessons 一、五）。具體會錯的：
- `plan()` 只驗新的段：同一天「10:00 已取消＋11:00 確認前往的二返」，舊的那一段在 `plan()` 裡還活著、還佔著那一次健檢 → 被擋成「已經接了」，或多跳一句超用
- `record()` 同一天存兩筆（那一天已經結案、新的段另開一筆；或改狀態的那一筆跟新段併進的不是同一筆）時用同一份 `fresh` 連存（`:984-988`）；
  `save()` 重算次數用的是 `fresh` 換掉自己之後的那一份（`data/visits.js:163`、`:171`）→ 第二筆看不到第一筆，**額度上的 `doneCount`／`bookedCount` 寫錯**
- 存到一半失敗（第一筆存了、第二筆失敗），再按一次會把同幾段新的段又併進剛存好的那一筆 → 重複（lessons 三）
- `aboveeConsequences()` 會變假話的句子（`:389`、`:406-407`「會出現在確認時間／簽療程單」、`:408-410` `settledDayLine()`「新的這一段是待確認」、
  `:421-424` `registrationsWhenSettled()` 把新加的每一段假設成已確認 → 已完成、已取消的段也被說成「之後會多一張 Examine」、`:451`「時間、狀態、待辦都不變」）
- `strandedOnNewExamLines()` 只問 `isLiveSlot()`（`:334`）：新的健檢被記成未到時照樣講「要接到這一次的話…」，但未到的健檢接不上

## 要做的

1. **一支 domain 函式**（例如 `photoDayPlan(重讀的這一位全部來訪, 那一天照片上的列, ctx)`，放 `aboveeImport.js` 或新的一支 domain 檔）回：
   `{ 改完的那幾筆來訪（要存的，照存的先後）, freed（每一筆放掉了哪幾段，給 02）, missed（改不成的那幾列與為什麼）, 每一筆額度前後差幾次, 提醒（warningDetails 的結果） }`
   - 組法：重讀的那一份 → `adoptAbovee()`（治療師／診間）→ 04 的改狀態 → 05 的改期 → 03 的新段（同一組接進同一筆、第一段才問要不要併進既有那一天）→ 推整筆狀態
   - 驗證拿**改完之後**的那一天（取消掉的那一段不再佔著那一次健檢、不再算進超用）；`visitsForCheck()` 換成改完的那一份（含同一張照片上別組的計畫）
   - 次數差：改之前與改之後各跑一次 `counts()` 相減
2. `plan()`、`aboveeConsequences()`、`record()` **三邊都只讀它**（`plan()` 要的是全部組的計畫：每一組各叫一次、彼此看得到 —— 跟現在 `visitsForCheck()` 的做法一樣）
3. `record()` 改成：重讀這一位 → `photoDayPlan()` → **寫之前那一份跟她看到的那一份比**（`missed`）→ 照先後存，**每存一筆就把它換進手上那一份**（下一筆與次數快取看得到它）→ `save(…, { freed })`。
   二返接同一張照片上的健檢：健檢那一天先存（現在 `:962-963` 只看新列的連結，要連「要改的段」一起看）；存的時候換好真的 id 之後拿重讀的那一份再問一次 `cannotClose()`
4. **存到一半失敗再按一次不重複**：逐筆記住「這一筆存過了」（不只逐組）；重讀之後已經在 app 上的段照「已經記了」認
5. 「標壓完」：只有那一天有一段活著（待確認、已完成、未到）才標；整組都是已取消的那一天不放進 `savedDays`（`:992-995`）、確認框那一句（`:901`）也不數
6. 改不成那一句（`:1040`）不再寫死「治療師／診間剛在別的裝置上改過」：照 `missed` 的理由講（狀態、改期也算）；重設也清狀態、改期那幾格（`:1042-1046`）
7. **健檢那條鏈**：這一位的每一件改動都套上去之後，叫一次 `syncFollowupTasks()`（不是一筆一筆算再合起來，CLAUDE.md「一句按下去會發生什麼」那一列）。
   `record()` 與確認框要替每一位讀 `chainInputs()`（`data/visits.js:295`）；改狀態的那幾筆也要讀 `listByVisitForSync()`（現在只讀「併進既有那一天」的，`aboveeConfirm.js:908-910`）
8. **確認框的句子**（`aboveeConsequences()`，讀這一份計畫）：
   - 「每一段都記成『待確認』」改成照實講：記成已完成 N 段、未到 N 段、已取消 N 段、待確認 N 段（「確認前往不等於問過客人」那半句只跟著待確認那幾段）
   - 改的：改成已完成 N 段、已取消 N 段（還 N 次）、未到 N 段（還 N 次）、改期 N 段、補治療師／診間 N 段
   - 「會出現在確認時間／簽療程單」只數待確認的那幾天；`settledDayLine()`、`registrationsWhenSettled()` 只算新加的、待確認的那幾段；「時間、狀態、待辦都不變」只在真的沒改狀態時講
   - 「取消 Abovee 已經勾好了」講一句；Examine／耀聖會多的那幾張拿 `cancelTaskLines(…, { freed })` 講
   - 健檢那條鏈那幾句（約二返長出來／收掉、還接在被取消或改成未到的健檢後面的二返 —— `strandedFollowupLines()` 換動詞、追蹤健檢報告）
   - `strandedOnNewExamLines()`：新的健檢是未到或已取消時不講「要接到這一次」
   - 每一項一句話（不塞分隔線）
9. 這一支到 domain 與存檔迴圈為止；畫面上「要改的」那一塊是 07

## 判準

- **確認框的次數加總 ＝ 存完之後每一筆額度前後的差**：拿 `counts()` 驗，**也驗額度上的 `doneCount`／`bookedCount`**
- 一位一天：一段 app 已確認的照片已取消、一段新的課程完成（過去）、一段改期 → `photoDayPlan()` 一份、確認框講的、真的寫進去的三邊一樣
- 同一天「10:00 健檢已取消（app 已確認）＋11:00 確認前往的二返（新的，接另一次健檢）」：驗證不報「已經接了」、不報超用
- 那一天已經結案、照片多一段新的 → 另開一筆；**兩筆都存了之後額度快取算到兩筆**
- 存到第二筆失敗、再按一次：第一筆不重複、第二筆補上
- 整組都是照片上已取消的那一天：不標壓完、確認框的「標成壓完」不數它
- 二返接同一張照片上的健檢、兩段都寫完成（過去）：健檢那一天先存、二返接上真的 id、兩段都是已完成
- 確認框不講「每一段都記成『待確認』」除非真的每一段都是；已完成的新段不被說成「之後會多一張 Examine」
- 新的健檢記成未到：不講「要接到這一次」
- 沒有任何改狀態、改期的照片（只有新的、未來的確認前往）：確認框與寫入結果跟改之前一模一樣（既有 `tests/abovee-*.test.js`、`tests/consequences.test.js` 照樣綠，除了 07 列出要改預期的那幾條）

## 做完時留下的（10/15 段三）

**做成的樣子**（`domain/aboveeImport.js`，三邊只讀它）：

- `photoDayPlan(items, ctx, { at })`（export）：組法＝重讀的那一份 → `adoptAbovee()` → `applyPhotoStatus()` → `applyPhotoMove()`（閘門拿 `afterPhoto(…, [], items)`）
  → **拿改完之後的那一份** `planAbovee()`（要不要併進那一天、那一天結案了沒看改完之後的）→ 每一筆驗一次（`checkCtxFor()`，`visitsForCheck()` 拿的也是改完之後的）。回：
  - `groups`／`problems`／`warningsBy`／`mustSeeBy`：確認層畫的那一份（以前 `plan()` 自己組）。新的段的錯誤擋那一組；改期那一段的錯誤擋那一列；改狀態、換治療師診間只拿提醒（舊資料驗不過不可以因此改不了狀態）
  - `writes`：要存的每一筆，**照存的先後**（只改既有的排前面、新的段接後面，**被接著的那幾筆一律先存** —— 二返接的暫時 id 要等它；照片同一批改成已完成的健檢先存）。
    每一筆 `{ id（plannedId）, customerId, customerName, date, visit, before, freed, keys, adds（planAbovee 那一組，沒有就 null）, touch（改既有那一筆的 done／at／freed）, pressed }`。
    **欄位叫 `adds` 不叫 `group`**：`tests/course-groups.test.js` 掃 `.group` 當成 `course.group`
  - `missed`（`missedWhy`：`stale`／`closeBlocked`／`refused`）、`rows`（每一列做了什麼、`charge` ＝ 那一筆額度差幾次，一段一段 `chargesEntitlement()` 前後相減 —— `counts()` 的同一個定義）、
    `before`／`after`（每一位）、`deltas`（`countDeltas()`）
- `wantsWrite(item)`：會寫進去的列（勾著的新的、按著的改成 Abovee 的、打勾的改狀態與改期）。確認層的「記錄這 N 段」、還差一步、離開前那一句都問它
- `writePhotoPlan(plan, { hand, save, savedIds, onWrite })`：一筆一筆存、**存一筆換進手上那一份**（`save()` 的額度快取看得到前一筆）、新的一筆記住真的 id、後面接著它的二返換成真的（`withSavedLinks()`）。`save` 由呼叫端給（測試用假的，照 `countOps()` 算快取）
- `planToWrite(items, ctx, savedIds)`：存的那一下（一位重讀之後）算的那一份 —— 接著同一批別天那一次健檢的列，**那一次已經存好了**才先換成真的 id，
  還沒存的留著暫時 id 讓 `writePhotoPlan()` 存好就換。**E2E `65` 的 L6 抓到的**：一開始照舊每一列先 `resolveSaved()`，兩天都還沒存時二返的連結在算計畫之前就被清成空的
  （以前一天一天重組才碰巧對）。那一次健檢這一次沒要記、也沒存過的話，那一列本來就存不下去（「指定的健檢來訪不存在」，確認層的「還差一步」）
- `pressedDays(plan)`：標壓完只算那一天有一段活著的新段（整組照片上已取消的不算）
- `missedSay(missed)`：沒改成的那一句照理由講（取代寫死的「治療師／診間剛在別的裝置上改過」）
- `examChoices(…, items)` 改看 `afterPhoto()`（**這一條 issue 沒寫，是做判準「10:00 二返取消＋11:00 新的二返」時發現的**：驗證放行了，但「接哪一次健檢」那一排還把那一次當成被 10:00 佔走、按不下去）

`domain/consequences.js` 的 `aboveeConsequences({ plan, chainBy, … })`：沒有 `plan` 的舊呼叫（`groups`／`adopts`）照舊 —— 只有新的、待確認的段時兩條講的一模一樣（測試釘著）。有 `plan` 時：
- 「每一段都記成待確認」只在真的每一段都是、又沒有改狀態改期時講；否則「新的 N 段照 Abovee 記：「已完成」a 段、…（扣 X 次）」＋待確認那幾段的「確認前往不等於問過客人」
- 「照 Abovee 改成「已取消」N 段（還 N 次）」「…「未到」…」「…「已完成」…」「照 Abovee 改期 N 段 —— …（還／扣）」：括號是 `rows` 的 `charge` 加起來 —— **所有括號加起來＝存完之後每一筆額度前後的差**
- 「跟客人確認時間／簽療程單」「等客人說可以之後會再多…」只數新的、待確認的段（含改期新的那一段）
- 照片放掉的段：「照片上已經放掉的 N 段，待辦的「取消 Abovee」直接勾好」＋`cancelTaskLines(…, { freed })`（Examine／耀聖沒勾的那幾張）＋`registrationDropLines()`（10）
- 記成已完成會長的「寫紀錄」（她第 1 題：照長）；健檢那條鏈每一位**全部套上去之後算一次**（`syncFollowupTasks()`：追蹤健檢報告、約二返長出來／收掉、`strandedFollowupLines()` 換動詞 —— `verb` 可以給一支，取消的「取消」、未到的「改成未到」）
- 「改 N 段的治療師與診間成 Abovee 上的 —— 只動這兩格，時間、狀態、待辦都不變」後半只在這一次沒有改狀態改期時講
- 抬頭：「記錄這 N 段、改 M 段？」／「記錄這 N 段？」／「改這 M 段？」
- `strandedOnNewExamLines()`：新的健檢是未到、已取消時不講「要接到這一次」（問 `PICKABLE_EXAM`，不問 `isLiveSlot()`）

`ui/components/aboveeConfirm.js`：`plan()` 一行叫 `photoDayPlan()`（只拿還沒記的列；記好的已經換進 `ctx.visitsBy`）。`record(p, n)`：讀每一筆的任務、每一位的 `chainInputs()` →
確認框 → **一位一位**：重讀 → `photoDayPlan()`（同一支）→ `writePhotoPlan()`（`onWrite` 記 `savedKeys`、`savedDays`、把手上那一份換進 `ctx`）→ 沒改成的收進 `missed`、重讀之後組不進去的是 `invalid`。
沒改成的那幾列拿掉要改的勾（她看到的不是現在的值，不再送一次）。

**給段四（07）**：
- 「要改的」那一塊要畫的都在 `rows`（`kind`／`to`／`charge`／`fields`／`filled`）與列上的 `statusChange`／`move`／`diffs`；括號讀 `rows` 的 `charge`
- 現在畫面上要改的那幾列還是「已經記了」＋那一句、**沒有勾可以拿掉**（`adoptStatus`／`adoptMove` 預設勾，存的時候就會寫）—— 07 要給勾
- 「記錄這 N 段」的 N 現在含要改的那幾列（`wantsWrite()`）；確認框的抬頭分開講「記錄 N、改 M」—— 07 決定按鈕上要不要也分開
- `refreshCloseBlocks()` 還沒接（中途發現 7）；她拿掉健檢那一列的勾之後，存的時候 `missed` 會接住、`missedSay()` 會講

測試：`tests/abovee-day-plan.test.js`（18 條：一位一天三種改動＋另開一筆的次數加總＝前後的差（`counts()` 與快取都驗）、存到一半失敗再按一次、驗證拿改完之後的、二返接同一張照片上的健檢（兩種順序、存的那一下重算的那一份 `planToWrite()`）、標壓完、確認框照實講六條、`missedSay()`）。
改了兩支掃原始碼的測試的寫法（`abovee-warnings-in-sight`：提醒搬進 domain；`abovee-whole-history`：重讀改成一位一次）。`npm test` 4639 全綠；相關 E2E 18 支 145 條：144 綠、`65` 的 L6 紅（上面 `planToWrite()` 那一條，修了）→ 修完重跑拍 Abovee 那六支（41、51、57、62、65、67）38 條全綠。
