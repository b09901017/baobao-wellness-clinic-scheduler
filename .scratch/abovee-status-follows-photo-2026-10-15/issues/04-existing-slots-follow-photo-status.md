# app 裡已經有的那一段：照照片改狀態（取消、完成、未到）

Status: done
Blocked by: 01、03（整筆狀態的推導 —— 改完一段之後整筆怎麼推，跟 03 同一套）
動工前先讀：`spec.md`「app 裡已經有同一段」「次數」兩節；ADR-0116（這一支推翻它的「只講不改」）、ADR-0056、ADR-0111、ADR-0145、ADR-0110、ADR-0144；
`domain/aboveeImport.js` 的 `existingAt()`、`crossCheck()`、`resolveItem()`（`:474-546`，含重設清單 `:475-491`）、`asRecorded()`（`:721-727`）、`claimHalves()`（`:748-775`）、`claimTimeless()`（`:777-796`）、
`rebookedHere()` 與它的豁免（`:500-506`）、`sameRow()`、`mismatchSay()`、`recordedSay()`、`needsAttention()`、`adoptAbovee()`（同一種「寫之前比對她看到的值」的做法）、`historyPartial()`；
`domain/visits.js` 的 `applyStatus()`、`settle()`、`closeVisit()`、`canTransition()`、`canCancelSlot()`、`lockedAt()`、`materialize()`；`domain/followups.js` 的 `cannotClose()`、`closeBlocks()`（`tickedHere`，`:659-660`）；
`domain/entitlements.js` 的 `counts()`、`chargesEntitlement()`（只讀，拿來試算）；CLAUDE.md「一段來訪的狀態」「一筆來訪改得動的地方」「拍 Abovee 記很多段」三列；`docs/agents/lessons.md` 一、二、四、五

## 她要的

> 如果是本來app上還沒取消的客拍照拍到已取消了，那也幫我把這堂課的狀態改成已取消，你懂嗎，就是連狀態也要考慮進去

> 就是以最新拍的照片為準，和app不一樣的提醒

第一段她回（第 3 題）：

> 預設打勾＋確認框講清楚 … 打勾就只是改狀態那些等等，不要多記或少記次數! 次數不能弄錯這很重要 ! !

## 為什麼會這樣

`crossCheck()`（`aboveeImport.js:404`）比出不一樣時回 `{ kind: 'mismatch' }`，那一列不能勾、只有一顆去日曆（ADR-0116：「照片是抄出來的字，抄錯一格的代價是改掉一段她談定的來訪」）。
她的用法是先在 Abovee 改好再拍，照片就是她的決定（ADR-0002：app 記錄決定，不做決定）。抄錯的風險改由「預設打勾＋一列一件事＋確認框講清楚＋寫之前比對」接住。

幾個現在靠 `crossCheck()` 的結果運作、一改就會壞的地方（10/15 過目查到）：
- `claimHalves()` 只認領 `recorded`、或理由是 `notClosed`／`appNoShow` 的對不上（`:749-751`）—— 新的種類或理由沒加進去，合併扣課的後一半就變成新的一段、預設勾 → **多扣一次**
- `claimTimeless()` 拿 `crossCheck()` 的結果當 kind（`:788`），`existing` 只有 `{ visitId, date }`（`:789`）—— 沒有開始時間，照 `adoptAbovee()` 的找法（比開始時間）永遠找不到
- `rebookedHere()` 的豁免靠 `verdict?.reason === 'aboveeCancelled'` 認（`:504`）—— 取消一改成「要改的」就對不到，照片上「已取消＋重約」那一對會把 app 上活著的那一段取消掉
- 逐段取消時 `cancelReason` 只由 `settle()` 在整天都取消時寫（`visits.js:1142-1154`）—— 一天兩段取消其中一段，理由沒地方放

## 要做的

1. `crossCheck()` 的結果多一種「照片要改這一段」（例如 `{ kind: 'recorded', statusChange: { from, to } }` 或新的 `kind`，自己定）—— 照 spec 那張 5×5 表：
   - 會改的 → 那一列帶著要改成什麼，**預設打勾**（`historyPartial()` 時不勾）
   - 只提醒的（⚠ 那幾格）→ 照舊是對不上、排進「要你看」，句子走 `mismatchSay()`：補「客戶失約」、「Abovee 上還沒改成課程完成」（app 已完成、照片還是待確認那一類 —— **不是**「已完成改不回來」，這裡沒有人要改回來）、
     「已完成改不回來」（app 已完成、照片已取消／失約）、「未到取消不掉」、「兩邊都還沒結案」（過去的日子）
2. **不要弄壞既有的認領與豁免**：
   - 新的種類、每一個新的對不上理由都加進 `claimHalves()` 的 `held` 與 `claimTimeless()`
   - `rebookedHere()` 的豁免照留：照片上同一格另有一列還掛著時，取消的那一列不拿去跟 app 上活著的那一段比、不改
   - 要改的那一列記下 `existing.{ visitId, slotIndex, startsAt, courseId, status }`（她在確認層看到的那一份）
   - 新的欄位都加進 `resolveItem()` 的重設清單（`:475-491`）與 `asRecorded()`（`:721-727`）—— 她換一位之後，舊的「要改什麼」不可以留在新的人身上
3. **沒有開始時間的舊段**（`claimTimeless()` 認到的）：**只提醒、不改**（spec「我自己定」）
4. **同一段在照片上有兩列、狀態不一樣**（同一頁拍兩次；`sameRow()` 只分取消／沒取消）→ 不自動改、提醒。
   **段一查到：兩張的那兩列進到這裡之前就被 `joinPages()` 併成一列了**（`sameRow()` 只分取消／沒取消 → 課程完成與確認前往算同一列），
   而 `joinPages()` 只在第一張那一格空著才補 —— **先傳的那一張贏、差異安靜地沒了**（實測：兩種順序各印一種）。
   所以 `joinPages()` 要記下「兩張都讀得出狀態、`photoStatus` 不一樣」（例如 `statusConflict`），這一支看到就不改、講一句；
   新的那一列（03）不預設勾、講一句。她 10/15 回「好，照你的建議」（段一中途發現 3）
5. 一支 domain 函式把「要改的狀態」套到**重讀回來的那一份**來訪上（例如 `applyPhotoStatus(visit, items, { today, guard })`），回 `{ visit, missed, freed }`，照 `adoptAbovee()` 的形狀：
   - 找那一段照 `existing.slotIndex`，再核對開始時間、課程、狀態跟她看到的一樣；**不一樣 → 不改、放進 `missed`**（講「這一段剛在別的地方改過」）
   - 走既有的幾支：取消 `applyStatus(…, 'cancelled', { slotIndex, reason })`、已完成與未到都走 `closeVisit()`（`attended: true/false`，跟簽療程單同一個形狀）帶 guard
   - **未到 → 已完成**：先問 `cannotClose()`，擋的話一格都不動、放進 `missed`；不擋才 `applyStatus(…, 'confirmed', { slotIndex })` 再 `closeVisit()`（ADR-0111 唯一的路）—— 不可以停在半路的已確認（多扣 1、又回到簽療程單）
   - **同一天健檢與二返都要改成已完成**：一次交給 `closeVisit()`（同一個 `attended` 陣列裡打勾的健檢才算數，`tickedHere`）；一段一段叫二返會被擋
   - 每一步都問 `canTransition()`；**不另寫一份轉移表**
   - 改成已取消的那幾段回在 `freed` 裡（只限 Abovee，02）
   - 改完整筆照 03 的推導
6. **取消原因**：照片上的「取消原因」交給 `applyStatus(…, 'cancelled', { slotIndex, reason })` —— **issue 11（段一做的）之後它記在那一段上**
   （`slot.cancelReason`，讀取卡片看得到），那一天全部取消時整筆那一格也照舊寫（`settle()`）。不另寫一份
7. 一支試算「這一列改了之後那一筆額度差幾次」（給 07 畫括號、給確認框加總）：拿改之前與改之後的來訪各跑一次 `counts()` 相減 —— **跟寫入同一份輸入**（06 會把它收進一位一天的計畫裡）
8. 這一支只做 domain 與測試；一位一天怎麼組、存檔迴圈是 06，畫面是 07

## 判準

- app 已確認、照片已取消（未來）：改成已取消、`counts()` 還 1 次、`freed` 有那一段；那一天只有這一段的話整筆的取消理由是照片上那一格
- 一天兩段、照片只取消其中一段：那一段已取消、**那一段的 `cancelReason` 是照片上那一格**、另一段不動、整筆照推導、整筆的 `cancelReason` 不寫
- 同一頁拍兩張、同一列一張寫課程完成一張寫確認前往：不改、講一句（兩種上傳順序都一樣）
- app 待確認、照片課程完成（過去）：改成已完成、**次數不變**；營養師諮詢的話長一張「寫紀錄」
- app 未到、照片課程完成：改成已完成、**扣 1 次**；二返而接的健檢還沒做完：**一格都不動**、進 `missed`
- 同一天健檢（已確認）與二返（已確認，接這一次）照片都寫完成：兩段都改成已完成
- app 已確認、照片客戶失約（過去）：改成未到、還 1 次
- app 已完成、照片已取消／失約：不改、「已完成改不回來」
- app 已完成、照片確認前往：不改、「Abovee 上還沒改成課程完成」
- app 未到、照片已取消：不改、「未到取消不掉」
- app 已確認、照片待確認（今天或未來）：**不動、不提醒**；過去的：不動、提醒「兩邊都還沒結案」
- 未來、照片課程完成、app 已確認：不改、提醒「還沒到就寫完成了」
- 合併扣課（照片兩列、app 一段）兩列都寫已取消：那一段改成已取消、**後一半照舊被認領**（不變成新的一段）；兩列一個取消一個完成：只提醒
- 照片上同一格「已取消＋重約（確認前往）」那一對、app 上那一格活著：**不取消**（豁免照舊）
- 沒有開始時間的舊段、照片寫已取消：只提醒、不改
- 她在確認層看到「已確認」，存之前那一段在日曆上被改成已取消：不改、進 `missed`
- 她把一列換一位：那一列不再帶著上一位的「要改什麼」
- 每一條次數判準都拿 `counts()` 算改之前與改之後
- 同一張照片拍兩次：第二次全部是「已經記了」，一段都不再改

## 做完時留下的（10/15 段二）

**做成的樣子**（全部在 `domain/aboveeImport.js`）：

- `crossCheck(item, found, sameCourse, today)` 照 spec 那張 5×5 表：
  - 要改的 → `{ kind: 'recorded', statusChange: { from, to } }`（app 已經有這一段、照片要它換狀態）。`resolveItem()` 給它 **`adoptStatus: true`**（預設打勾；
    讀不到這位的全部來訪時 `false` ＋ `partialHistory`），`existing` 是她看到的那一段 `{ visitId, date, slotIndex, startsAt, courseId, status }`
  - 只提醒的 → 對不上，理由：`aboveeNotDone`、`aboveeNotNoShow`、`bothOpen`（過去、兩邊都還沒結案）、`futureDone`、`futureNoShow`、`appDoneStays`（已完成改不回來）、
    `noShowStays`（未到取消不掉）、`appCancelled`（app 已取消、照片失約）、`photosDiffer`；後處理再加 `closeBlocked`、`halvesDiffer`、`timeless`。句子全在 `mismatchSay()`
  - 拿不準的不比：`photoStatus` 是 null、讀不出來 → 已經記了；兩張照片不一樣 → `photosDiffer`
  - 已經是同一個狀態 → 已經記了。同一個時間同一門課兩段時先找狀態已經一樣的那一段
  - 舊的三個理由（`aboveeCancelled`、`notClosed`、`appNoShow`）拿掉了（再也不會長出來）
- **重約的豁免**：`rebookedHere()` 照舊；`resolveItem()` 改成在比之前就判（照片已取消＋app 上那一格活著、同一門課＋照片同一格另有一列還掛著）→ 不拿去比，照新的、已取消的走
- **治療師／診間**（11）：每一個對到活著那一段的（要改的、只提醒的）都比；**照片要改成已取消的那一段不比**
- `joinPages()` 記 `statusConflict`（兩張都讀得出、翻出來不一樣 → 兩個原字），`photoStatusOf()` 帶到列上。新的那一列（03）不預設勾、`photoRowSays()` 講；既有的 → `photosDiffer`
- `claimHalves()`：前一列只要對到 app 上活著的那一段就算（`existing.slotIndex`；已經記了、要改的、只提醒的），**後一半寫已取消也認領**；兩列的狀態不一樣 → 前一列改成 `halvesDiffer`（不改）
- `claimTimeless()`：先讓沒取消的列認領，已取消的列只認剩下的、**還開著的**舊段；照片要改它的 → `timeless`（只提醒、不改）
- `applyPhotoStatus(visit, items, { at, guard })`（export）：照 `adoptAbovee()` 的形狀。核對 `slotIndex`／開始時間／課程／狀態跟她看到的一樣（不一樣 → `missed`，`missedWhy: 'stale'`）；
  已完成與未到一次交給 `closeVisit()`（帶 guard）；未到 → 已完成先 `applyStatus(…, 'confirmed')` 退回再結，**閘門拿退回之後的那一份問、擋到就一格都不動**（`closeBlocked`，帶 `closeBlock`）；
  取消走 `applyStatus(…, 'cancelled', { slotIndex, reason: 照片上的取消原因 })`（issue 11：理由記在那一段上；整天都取消時整筆那一格也寫）。回 `freed`（改成已取消的那幾段）。
  一段都沒改成就回原本那一個物件
- `gateStatusChanges()`（`readAbovee()` 的後處理，排在 `linkBatchExams()` 之後、`flagCloseBlocks()` 之前）：二返／n返 要改成已完成、接的那一次健檢**記完之後**還是沒做完 → `closeBlocked`。
  「記完之後」是 `afterPhoto()`：存著的來訪套上照片要改的狀態（不帶閘門）＋這一次要記的那幾組（暫時 id）—— 03 的 `blockedInGroups()` 也換成它（照片上同一批改成已完成的健檢算數）
- `countDeltas(entitlements, before, after)`（export）：每一筆額度「改之後 − 改之前」（`remaining`／`done`／`booked`／`noShow`），只回有變的。`photoChangeDelta(item, ctx)`（export）：一列的試算，套的是寫入那一支
- `recordedSay()` 多一句「照 Abovee 改成「X」」；`flagCloseBlocks()`／`refreshCloseBlocks()` 只管新的列（不清掉 04 記在對不上那一列的 `closeBlock`）

**次數（每一條都拿 `counts()` 驗，`tests/abovee-existing-slots-photo-status.test.js`）**：已確認 → 已取消 還 1、已確認 → 未到 還 1、待確認 → 已完成 不變、未到 → 已完成 扣 1、
合併扣課兩列都取消 還 1（不是 2）、二返被閘門擋 一格都不動（差 0）、同一張照片拍兩次第二次一段都不改。

**改了的既有測試**（都對過 spec 的表）：`abovee-import`（已取消／還開著那一段 → 要改的；未來的完成 → `futureDone`）、`abovee-pages`（app 已完成、照片已取消 → `appDoneStays`）、
`abovee-recorded-shapes`（前一列要改成已完成、後一半照樣被認領；沒有時間的舊段 → `timeless`）、`abovee-absent`、`abovee-six-statuses`（未來的失約 → `futureNoShow`）、
E2E `41` 的 A6（`a7` 從「對不上」變成「已取消」＋「照 Abovee 改成「已取消」」、要你看 2 → 1 —— **07 會整個換成「要改的」那一塊**）

**給段三（06）**：
- **確認層現在的畫面不會套 `statusChange`**：`record()` 只寫新的那幾組與「改成 Abovee 的」。要改的那幾列現在看起來是「已經記了／已取消」、按記錄什麼都不改 —— 06 接
- **寫入的時候閘門要拿「改完之後」的那一份**：`applyPhotoStatus()` 的 `guard.visits` 拿改之前的話，跨天的二返（健檢那一天這一次也從照片改成已完成）會被擋（測試釘著兩種）。
  `record()` 現在存的時候重組的那一份只有那一天的新列（`planAbovee(d.items…)`），**看不到 04 要改的與別天的新列** —— 03 的閘門在那裡會跟確認層講的不一樣。06 的「一位一天一份計畫」要從整批算一次
- `freed`：`applyPhotoStatus()` 回的與 `planAbovee()` 每一組的 `freed` 都要帶進 `save()`；`registrationDropLines()`（issue 10）拿改完之後的那一筆講
- 她在確認層拿掉一列健檢的「要改成已完成」：二返那一列讀照片那一下判的「要改」不會跟著變成擋 —— 寫的時候 `missed` 會接住（`closeBlocked`），06 要講出來；07 要不要即時重算再說
