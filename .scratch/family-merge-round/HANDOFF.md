# HANDOFF：用家人的額度＋合併扣課照額度分鐘（2026-11-09）

分支 `claude/family-charge-merge-check`（從 develop `27128b86`）。全貌與她選的答案在 `spec.md`。主控＝開這一輪的 kickoff session。

## 分段

| 段 | issue | effort | 狀態 |
|---|---|---|---|
| 一 | 01 誰來的（資料形狀＋畫面）、02 試算表附註 | xhigh | **做完**（11/9；`638318dd`、`b352476b`，`npm run verify` 全綠：單元 6071、E2E 57 個檔 378 支） |
| 二 | 03 拍 Abovee 讀家人扣課、04 月底對帳對上家人那一段 | xhigh | **做完**（11/9；`c49a2ae0`、`a2617704`，`npm run verify` 全綠：單元 6099、E2E 22 個檔 127 支；staging Function 已部署） |
| 三 | 05 合併扣課照額度分鐘、06 月底對帳多一塊合併扣課＋讀她答過的 | xhigh | 待開 |
| 四 | `/matt-code-review` 審全部改動、照建議修 | xhigh | 待開 |
| 五 | 手動驗收清單（自己走過）、開 PR 進 develop、CI 綠就合 | medium | 待開 |
| — | 07 正式站補資料 | 主對話 | **等上 main**（她另外說），寫之前她要明講可以 |

## 每一段共同的規矩

- 先讀 `CLAUDE.md`、`docs/agents/lessons.md`、`spec.md`、自己那幾支 issue（「動工前先讀」列的照讀）。
- 動工前 `git fetch`；分支落後 develop 就 rebase，不重做。**不開 worktree**，在主資料夾這條分支上做。
- **改已經存在的函式、型別、畫面上的字之前照 `ripple-check`** 查呼叫端與波及範圍；修完 bug 找同一個形狀的地方。
- 一支 issue：紅燈（先寫失敗的測試、跑過確認紅）→ 綠 → `npm run verify` → 一個 commit → `Status: done` ＋ issue 底下「做完時留下的」。
- **中途發現的不岔出去修**：記進本檔「中途發現」（哪裡、什麼情境會錯、建議），段末一次問她。她說修的，修之前再照 `ripple-check` 查一次牽連。
- subagent 同時最多兩個（用內建瀏覽器點驗收清單的不限）。
- 動到 `public/` → 升 `public/sw.js` 的 `VERSION`（同一支 PR 第二次動也要再加一）＋`npm run shell:snapshot`。
- 真名、病歷號、健康資訊一個字都不進版控（假名「客戶A」「王小明」）；讀 `.local` 一律接 `| node .local/references/redact.mjs`。
- 會寫入的驗收在本機模擬器走；staging 畫面有真名，截圖不帶出來。**正式站一筆都不寫**（07 另外做）。
- **主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。**
- 做完：更新本檔（分段表狀態、中途發現、要她決定的、下一段要知道的），回覆簡短說做了什麼、卡在哪。

## 過目抓到的

唯讀 subagent 2026-11-09 過目，主控對過最重的三條（`rowMinutes()` 用起訖、`identifyCustomer()` 只給號碼回 null、`conflictWarnings()` 跳過同一筆），都成立。細節寫在各支 issue 的「過目補充」：

1. **一列幾分鐘不能只看 Abovee 起訖**（多排 15 分空檔）→ 05 照現在的 `looksMerged()` 認不出 10/30、會誤拆 10/28；`claimHalves()` 的 `covers()` 同一個原因（現有的 bug）。→ 05 補「分鐘取課程字與起訖較小的」＋假名回歸表。
2. **家人列改認被扣的那一位之後會搶到她自己同時間那一段**（`existingAt()`／`crossCheck()`／`mergeRows()`／`claimHalves()`／`flagMoved()`／`looksRepeated()`）→ 03、05 都加「誰來的要一樣」。
3. **同一筆裡的撞期只靠 `overlapWarnings()`** → 01 放寬重疊時要另寫同一筆內的撞期。
4. 02 不用改 `.gs`、不用升 `SYNC_FORMAT`；不要改在 `slotNoteOf()`。
5. 03 認被扣者要照 `paidByOf()`（候選剛好一位），ADR-0103 的例外；`resolveItem()` 的「她自己選的」判斷要改；抄字要動 `ABOVEE_KEYS`／`RIGHT_KEYS`／`EDGE_KEYS`、提示詞、三支寫死欄數的測試。
6. 05：拆開之後沒有合回去的按鈕 → 拿掉那條判準；「11 對額度 30 分」實際是 6 對各扣 60、2 對 ILIB 沒同類額度、3 對額度 30。
7. 段二 effort 改 xhigh（03 要動的比對比原本寫的多）。
8. 01 貼給客戶的話（`messages.js`）先生那段怎麼列 → 她答了（見「她已經決定的」）。

## 中途發現

### 段一

1. **時段反查把先生那一段當成太太在忙**（`domain/scheduling.js` 的 `sameTimeVisit()`，`candidatesFor()` 那一圈）：拿這位客戶那一天的每一段比，不看誰來的 —— 太太那天有一段先生來的，那個時間太太被排除、寫「這個時間他已經有來訪了」。很少見（一年幾次夫妻），只是少推一位、不會寫錯資料。
   **同一行還有一個原本就在的洞**：它也不濾取消掉的那一段（只濾整天取消的 `isActive()`）—— 那一天取消了 14:00 那一段、整天沒取消，14:00 空出來時那位客戶照樣被排除。
   建議：兩個一起修（`.some()` 裡加 `isLiveSlot(s) && !attendeeOf(s)`，一行），放在段三或段四順手做，先寫失敗的測試。
2. **日曆列表的撞期標記、資料健檢的「衝突殘留」不看同一筆裡的段**（`calendar.js` 的 `markClashes()`、`health.js` 的 `checkConflicts()`）：同一筆裡先生與太太同時佔同一張只裝一位的床，只在存檔前那一道講，日曆列表不標紅、資料健檢不列。以前同一筆的重疊也只在存檔前講，所以**沒有退步**。
   建議：不動（要動就是三個地方的撞期規則一起改，代價比這種很少見的情況大）。
3. **手動貼上那一條路（`customerReport()`）本來就不印記一句**，所以也不會有「先生來」—— 跟自動推送不一樣是格式 5 起就這樣，不是這一輪造成的。
   建議：不動（她現在用的是自動推送）。
4. （issue 01 原本就寫「不在這一輪」的兩件）拍療程單認不得先生（`identify.js`）；日曆上「換一位」選太太時「誰來的」不會自動填。
   建議：記進記憶 backlog，等她遇到再說。

### 段二

1. **改了抄字的提示詞，照 `.claude/rules/photos.md` 要重考**（`scripts/ai-exam.mjs` 叫 Gemini、會花一點錢 —— 照「先問再做」沒跑）。
   而且考試的照片（`.local/references/images/`）多半沒有家人那一列，考了也只證明「多兩欄沒讓別的欄變差」。
   建議：**現在不考**；等她哪天拍到一張有家人那一列的 Abovee，再拿那一張考一次（或 staging 上直接拍一次看結果）。
2. **issue 03 第 5 條「換一位之後清掉誰來的」我沒照做**（理由寫在 03「做完時留下的」）：換成來的那一位本人才清，換成別人照樣寫 —— 被扣的那一位認不得、
   或號碼抄錯時，她選的就是被扣的那一位，清掉的話她得記完再去日曆補。人是她選的照舊不先勾。
   建議：照我做的（段四審查時再看一次）。
3. （順手修掉的，跟這一輪同一個形狀）`adoptAbovee()` 照「時間＋課程」找第一段 —— 本人與家人同一個時間同一門課時，「改成 Abovee 的治療師／診間」會改到另一段；
   改成先用 `existing.slotIndex`。月底對帳的 `coveringSlot()` 也補了誰來的一樣。都有測試。
4. （不動，記著）`aboveeDiffs()` 拿 `same` 裡第一段活著的比治療師／診間，`crossCheck()` 拿「狀態一樣的那一段」比狀態 —— 同一個時間同一門課兩段（誰來的一樣）時兩邊可能比到不同段。
   以前就這樣（同一位同一個時間同一門課兩段本來就極少），這一輪誰來的不一樣的已經分開了。建議：不動。

### 段三
### 段四

## 要她決定的

（段末寫進來，主控問）

- ~~段一：上面「中途發現／段一」四條，收成一題「照建議」~~ → 她 11/9 答了（見「她已經決定的」）。
- ~~段二：「中途發現／段二」第 1、2、4 條~~ → 她 11/9 答了（見「她已經決定的」）。

## 她已經決定的

見 `spec.md`「談定的」。之後新答的補在這裡：

- 2026-11-09：貼給客戶的話（`messages.js`）裡，先生用太太額度的那一段**照樣列、後面加「（先生）」**（括號印「誰來的」那一格）。
- 2026-11-09：段一中途發現四條**照建議**：1 修（`scheduling.js` 的 `sameTimeVisit()` 加 `isLiveSlot(s) && !attendeeOf(s)`，**段三順手做**，先寫失敗的測試，一個 commit）；2、3 不動；4 記進記憶 backlog（主控記了）。
- 2026-11-09：段二中途發現**照建議**：1 現在不重考抄字（等她拍到一張有家人那一列的 Abovee，在 staging 拍一次看 —— 記進手動驗收清單）；2 換一位只在換成來的那一位本人時清「誰來的」（照段二做的）；4 不動。

## 段三要知道的（段二留下的）

- 家人那一列：列上 `family`（照片上的：`chartNo`／`relation`／`attendee`／`payerId`／`payerName`／`how`，`familyOf()`）＋ `attendee`（每次 `resolveItem()` 重算）。
  **兩列比「是不是同一個人」問 `sameWho(a, b)`、比 app 那一段問 `sameAttendee(slot, item)`** —— 05 改 `looksMerged()`／`mergeRows()`／`claimHalves()` 的判準時沿用（`mergeRows()` 的排序鍵也帶了 `attendee`）。
- `mergeRows()` 已經擋「本人一列＋家人一列」不配成一對；05 照分鐘合／拆時，家人那一對（先生兩列 30 分）照樣會配（同一位、誰來的都有字）。
- `appSlotOf()` 先認 `existing.slotIndex`（那一段的時間與課程要對得上），05 的 `covers()` 拿的就是它。
- 月底對帳：家人那一列在 `readAbovee()` 裡就是被扣的那一位的一列（`COLS` 有那兩欄）；`familyBucket()` 拿掉了。06 讀「她答過的」時，家人那幾件的 type 是 `familyMissing`（fix）與 `familyNoAttendee`（note）。
- `resolveItem()` 多第五個參數 `{ taken }`（家人那一列認舊段時跳過別列認領過的）；`mergedItem()` 叫它時沒帶 —— 家人那一對合成一段時不會去認舊段（沒有那種舊資料，不用）。
- `sw.js` 現在是 **v322**（段三動 `public/` 要升 v323）。
## 段二要知道的（段一留下的）

- 欄位叫 **`slot.attendee`**（字串）。**空的＝本人，本人那一段不寫這一格**。讀只走 `naming.js` 的 `attendeeOf()`；放回一段走 `slotDraft.js` 的 `withAttendee(slot, value, before)`（空的拿掉那個鍵）。
- `slotFromPicks()` 已經收 `attendee`（picks 裡給就寫）。**03 要做的是把它加進 `aboveeImport.js` 的 `picksOf()`**（還有 `resolveItem()`／`asRecorded()` 那幾條會不會掉）。
- 名字：`slotName(…, 'short')` 最後自己接 `(先生來)` —— 拍 Abovee 收著的那一行（`rowGlance()`）、「app 上 10:00 有一段 …」那幾句提示只要那一段有 `attendee` 就會跟著帶，不用另外拼；**拿名字字串去比對的地方要小心**（加了尾巴就對不上了）。
- 判斷「是不是同一個人」問 `attendeeOf()`：段一改了 `overlapWarnings()` 與 `conflictWarnings()`（同一筆裡誰來的不一樣的段當成別人，算診間人頭／治療師）；03 的 `existingAt()`／`crossCheck()`／`mergeRows()`／`claimHalves()`／`flagMoved()`／`looksRepeated()` 照「過目抓到的」第 2 條加「誰來的要一樣」。
- 試算表那一側（附註「先生來」、來訪紀錄 `(先生來)`）已經好了，03 存進去的段只要帶 `attendee` 就會出現。
- 新的 E2E：`100-slot-attendee`（登記在 `related.js`）；單元 `tests/slot-attendee.test.js`、`tests/sheet-attendee.test.js`。`sw.js` 現在是 **v321**（段二動 `public/` 要升 v322）。

## 每一段的開場

### 段一（effort：xhigh）

```
這一輪：用家人的額度（一段多一格「誰來的」）＋拍 Abovee 合併扣課照額度的分鐘。分支 claude/family-charge-merge-check（主資料夾，不開 worktree），上一段：無（kickoff 開好 issue）。

這一段做 .scratch/family-merge-round/issues/01（誰來的：資料形狀＋畫面）→ 02（試算表附註），照這個順序；不做 03～07。

先讀：CLAUDE.md、docs/agents/lessons.md、.scratch/family-merge-round/spec.md、.scratch/family-merge-round/HANDOFF.md（「每一段共同的規矩」「過目抓到的」）、issues/01、issues/02（含「過目補充」）與它們「動工前先讀」列的檔案。

她已經答了：貼給客戶的話（messages.js）先生那一段照樣列、後面加「（先生）」（括號印「誰來的」那一格）。

規矩：改既有的函式／型別／畫面上的字之前照 ripple-check 查牽連，修完找同一個形狀的地方；中途發現的記進 HANDOFF「中途發現／段一」不岔出去修，段末一次列給她；她說修的修之前再查一次牽連；subagent 同時最多兩個。
02 若發現非改 .gs 不可，先停、寫進 HANDOFF「要她決定的」。

主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。
做完要交：每支一個 commit、Status: done、issue 底下「做完時留下的」、npm run verify 通過、更新 HANDOFF（分段表、中途發現、要她決定的、段二要知道的）；最後回覆簡短說做了什麼、卡在哪。
```

### 段二（effort：xhigh）

```
這一輪：用家人的額度＋拍 Abovee 合併扣課照額度的分鐘。分支 claude/family-charge-merge-check（主資料夾，不開 worktree），上一段：段一做完 01、02（看 git log 與 HANDOFF 分段表）。

這一段做 .scratch/family-merge-round/issues/03（拍 Abovee 讀實際扣課病歷號／關係）→ 04（月底對帳對上家人那一段）；不做 05～07。
03 改抄字：做完照 docs/STAGING.md 部署 staging 的 Function（正式的不部署）。

先讀：CLAUDE.md、docs/agents/lessons.md、spec.md、HANDOFF.md（「每一段共同的規矩」「過目抓到的」「中途發現／段一」）、issues/01 與 02 的「做完時留下的」、issues/03、04 與「動工前先讀」列的檔案、.claude/rules/abovee.md 整份。

規矩：改既有的函式之前照 ripple-check 查牽連（aboveeImport.js 很多人在用），修完找同一個形狀的地方；中途發現記進 HANDOFF「中途發現／段二」，段末一次列給她；subagent 同時最多兩個。讀 .local 一律接 | node .local/references/redact.mjs。

主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。
做完要交：每支一個 commit、Status: done、「做完時留下的」、npm run verify 通過、更新 HANDOFF；最後回覆簡短說做了什麼、卡在哪。
```

### 段三（effort：xhigh）

```
這一輪：用家人的額度＋拍 Abovee 合併扣課照額度的分鐘。分支 claude/family-charge-merge-check（主資料夾，不開 worktree），上一段：段二做完 03、04。

這一段做 .scratch/family-merge-round/issues/05（合併扣課照額度分鐘、跟勾不一樣就講一句，補 ADR 推翻 ADR-0123 那一點）→ 06（月底對帳多一塊合併扣課＋讀 .local/references/月底對帳/她答過的.md）→ 順手修 HANDOFF「中途發現／段一」第 1 條（她說修：scheduling.js 的 sameTimeVisit() 不看取消掉的段與誰來的不一樣的段，先寫失敗的測試，一個 commit）；不做 07。

先讀：CLAUDE.md、docs/agents/lessons.md、spec.md、HANDOFF.md（「每一段共同的規矩」「過目抓到的」「中途發現」）、issues/03 的「做完時留下的」、issues/05、06、.scratch/abovee-merge-check/issues/01-remind-when-merge-looks-wrong-on-photo.md 整份、.claude/rules/abovee.md、docs/adr/README.md 索引。

規矩：同上（ripple-check、中途發現記「段三」、subagent 最多兩個、讀 .local 接 redact.mjs）。改 .local 的檔在 .local 私人 repo commit、不 push。

主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。
做完要交：同上；最後回覆簡短說做了什麼、卡在哪。
```

### 段四（effort：xhigh）

```
這一輪：用家人的額度＋拍 Abovee 合併扣課照額度的分鐘。分支 claude/family-charge-merge-check，上一段：段三做完 05、06（01～06 都 done）。

這一段：用 Skill 叫 matt-code-review，審 develop 到這條分支的全部改動（git merge-base origin/develop HEAD 起）；照建議修（每條先紅燈、一條一個 commit），沒改的寫理由進 HANDOFF「中途發現／段四」。

先讀：CLAUDE.md、docs/agents/lessons.md、spec.md、HANDOFF.md、issues/01～06 的「判準」與「做完時留下的」。

要特別看的：
- 舊資料（slot 沒有誰來的）每一個畫面、驗證、試算表、拍 Abovee 的結果會不會變了一個字？
- 誰來的不一樣就不報重疊 —— 會不會把同診間／同治療師的撞期也一起吞掉？
- 改期、複製一段、拆開／合併、換一位、asRecorded() 之後，誰來的與被扣者會不會掉了或帶到別人身上？
- 照分鐘合成一段之後，確認框的次數括號加起來還等不等於存完之後額度前後的差？
- 兩列沒勾、額度 30 分一次（11 對那種）會不會被誤合？沒有合併扣課那一欄的舊照片行為有沒有變？
- 試算表指紋有沒有跟著內容變（不然推送不重畫）？.gs 要不要重貼？
- 月底對帳讀「她答過的」：沒列在裡面的新一件會不會也被標成答過了？
- grep：attendee（或段一定的欄位名）、mergeRows、looksMerged、claimHalves、SYNC_FORMAT、familyBucket。

規矩：subagent 同時最多兩個（matt-code-review 自己開兩個，算在裡面）；修之前照 ripple-check 查牽連。
主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。
做完要交：修的每條一個 commit、npm run verify 通過、更新 HANDOFF；最後回覆簡短說找到幾條、修了幾條。
```

### 段五（effort：medium）

```
這一輪：用家人的額度＋拍 Abovee 合併扣課照額度的分鐘。分支 claude/family-charge-merge-check，上一段：段四審查修完。

這一段：
1. 寫她可以照順序點的手動驗收清單（staging 上點；會寫入的你自己先在本機模擬器走過一次，選擇器照真的畫面寫）。
2. 推之前看一眼 commit 訊息：沒有真名、病歷號、健康資訊（repo 是 public）。
3. 開 PR 進 develop（內文：這一輪做了什麼、她選的答案、手動驗收清單、還沒做的 07 要等上 main），開 Auto-fix；CI 全綠就合進 develop（不用再問）。合完 staging 會自動部署；Function 若段二沒部署，照 docs/STAGING.md 部署 staging 的。
4. 切回 develop。更新 HANDOFF（合進哪個 commit、所有 issue 是否 done）、記憶 backlog 第 25、26 條改成「已合進 develop、等上 main、07 未做」。

先讀：CLAUDE.md、HANDOFF.md、issues/01～06 的「做完時留下的」。
主控會接手 07：不要自己開 session，也不要存 limit-guard 的開場 JSON。
做完回覆：PR 連結、合進哪個 commit、清單在哪。
```
