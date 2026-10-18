# EECP 只有一門：約的時候 60／20，20 ⇔ 體驗；「EECP體驗」從種子刪掉

Status: todo
Blocked by: 03（同一個「送的／體驗…」開關；03 先改好收得回去，這一支的「選 20 → 跳到體驗」要看得到跳過去）
段：四（xhigh，這一段只做這一支）
動工前先讀：`domain/seed.js` 的 `course-eecp`、`course-eecp-trial`（約 `:436-475`，三次改動的原話都在註解裡）與 `course-followup` 的 `bookingMinutes`；
`domain/visits.js` 的 `slotMinutes()`、`slotMinutesField()`、`minuteChoicesFor()`、`bookingMinutesOf()`、`rebookSlot()`（`:410-415` 只在開始時間或課程變了才改期）；`domain/slotDraft.js` 的 `slotFromPicks()`；
`domain/slotOptions.js` 的 `slotOptionsFor()`、`giftOptions()`（`:142` 選項的 `durationMin`、`:147` `other: !isUncounted(course)`）、`defaultGiftCourse()`、`GIFT_FIRST`；`domain/masterData.js` 的 `isUncounted()`、`canBeGift()`、`giftKindOf()`、`validate()`；
三個入口換時長／換額度那一下：壓表（`schedule.js` 的 `resetCourseBoundPicks()`、時長那一排）、來訪編輯器（`visitEditor.js` 的 `readDraft()`／`readFreeSlot()`／`blankSlot()`／`key()`）、拍 Abovee（`aboveeImport.js` 的 `pickOption()`、`giftRow()`、`resolveItem()`、`isTrialRow()`）；
拍 Abovee「已經記了」怎麼認：`sameCourseHere()`（約 `:403`）、`crossCheck()`、`sameCourse`（約 `:1197`）、`claimHalves()`（約 `:1111`）、`sameRow()`（約 `:1235`）、`aboveeDiffs()`；
`domain/abovee.js` 的 `courseFrom()`（整格比 `aboveeNames` 在拆分鐘之前，`:238` 那一句講的就是 EECP20）；`domain/naming.js` 的 `slotName()`／`withMinutes()`（約 `:198`）；`domain/sheetReport.js` 的 `extraRows()`／`kindOf()`；`domain/consequences.js`（改一段的確認框）；
`ui/views/masterList.js` 課程那一張（設定頁的欄位、`foldout` 的 `onErrors()`）；`domain/audit.js` 的 `FIELD_LABELS` 與 `tests/audit-field-words.test.js` 的 `HERS`；
ADR-0108（改課程＝取消＋重新排）、ADR-0121（預設體驗）、ADR-0122（約的時候選的時長）、ADR-0148（送的／體驗）、ADR-0149（照片為準）；
CLAUDE.md「一段來訪要排多久」「送的／體驗、預設體驗的課」「新增一個會建立時段的入口」「一筆來訪改得動的地方」「拍 Abovee 記很多段」「`domain/seed.js`（種子）加一筆、改一格」幾列；
`docs/agents/lessons.md` 一（三個入口）、二、四、五、六；記憶「改種子之後要另外查的七個地方」

## 她要的

> 5. 如圖5，EECP只有一個EECP 不用EECP 體驗
> 應該要是這樣，EECP可以選60 20，以及可以選體驗/送的
> 目前似乎可以變成EECP體驗（體驗）？有點多餘
> 所以只要留一個EECP就好，預設是60分鐘 ，不選體驗/送的，然後如果選20就預設是體驗這樣可以嗎

> 5. 你說「EECP體驗」那一門停用、不刪，因為舊的來訪還指著它，我希望他直接不要誒，你說舊的來訪還指著它，但能不能幫我去改合併檔就好，反正現在我也還沒有真的開始使用，隨時都可以清空重來，沒有舊的之分，我要匯入時是新的就好 … 不要在靠資料健檢處理，一開始匯入時就應該是好的

> 2. 已經存成「EECP體驗」的舊來訪，要不要改成「EECP、20 分、體驗」ans : 要，但我希望如同我最上面說的，除了資料健檢多一列之外我希望下次我再匯入的時候就是最新的了，不需要再有EECP體驗

## 為什麼會這樣

「EECP體驗」是她自己要的第二門課，改過三次（種子註解有原話）：9/16「預設資料裡面要多一門EECP體驗課…匯入的也可以對應到了」（舊表那一列就叫這四個字）、
10/5 改成 20 分（Abovee 上叫 `EECP20`）、10/14 勾成預設體驗（gift-and-trial 05）。三件疊起來：課程名裡有「體驗」、`slotName()` 的 `short` 又替送的／體驗的段接一次 `(體驗)`（ADR-0148）→ `EECP體驗(20)(體驗)`。
她現在要的是 ADR-0122 那一種「同一門課、約的時候選時長」，再加上「時長跟體驗互相帶預設」。

**變成同一門課之後，有幾件事以前靠「兩門課」自然擋著、現在要自己擋**（過目查到、主控對過）：
- 拍 Abovee 認「已經記了」只比 `courseId`（＋器材）—— 以前 `EECP20` 是另一門課，永遠配不上 app 上的 EECP 60；合成一門之後，照片 `EECP20` 對上 app 同一個時間的 EECP 60（扣額度）會被認成「已經記了」，**那一段照舊扣額度**
- 來訪編輯器把一段 EECP 60（扣額度）改成 20（體驗）：`rebookSlot()` 只看開始時間與課程，所以是**原地改** —— 沒有「取消 Abovee」、也沒有任何一句確認框講「這一段不扣了」（`consequences.js` 沒有「改一段的扣法」那一種）
- `slotMinutes()` 有幾個呼叫端不帶 `giftKind`：合併檔主路徑直接寫檔案上的 `endsAt`（`mergeImport.js:396`）、候選補的那幾段（`addExtraVisits()`，`mergeImport.js:625`）、補登（`backfill.js:132`）都是 `slotMinutes({ course })`
- 舊表的「EECP體驗」那一欄由 `legacyImport.js` 對到 `course-eecp-trial`（`:109`、`resolveCourse()` 約 `:764`）—— **那門課身上可能有額度**，那幾段可能是扣額度的

## 要做的

1. **課程多一格「體驗排幾分」**（名字自己定，例如 `trialMinutes`；設定 → 課程 的字寫「體驗的時候排幾分」）。只在 `canBeGift()` 的課有意義；值要在那門課選得到的時長裡、**而且不可以等於那門課的預設時長**（`durationMin`）—— 等於的話，她重按一下預選好的那一顆就把一段扣額度的變成體驗（`validate()` 擋；`min`／`step` 跟驗證講同一句話）。
   `FIELD_LABELS` 補中文名、`audit-field-words` 的 `HERS` 補上；設定頁那一格如果收在 `foldout` 裡，錯誤字眼加進 `onErrors()`
2. **時長的推導**：`slotMinutes()` 在「這一段選的」之後、「品項」之前多一層：**送的／體驗的段、那門課有「體驗排幾分」→ 那個數字**。
   **每一個呼叫端都要傳 `giftKind`**：`grep -rn "slotMinutes(" public/js .claude/skills` 列一張表寫進「做完時留下的」（至少：三個入口、`mergeImport.js` 的 `addExtraVisits()`、`backfill.js`；合併檔主路徑寫檔案上的 `endsAt` 那一條由 11 負責讓檔案上的數字是對的）
3. **時長 → 體驗**（她：「如果選20就預設是體驗」）：那一段是那門課的額度、她在時長那一排按了「體驗排幾分」那個數字 → 那一段換成那門課的體驗（`giftKind: 'trial'`、`entitlementId: null`），選擇跳到「送的／體驗…」那一顆（03 收起來時寫出那一門）。
   **規則只寫一支在 domain**（輸入那一段現在的選擇＋按下去的時長，輸出新的選擇），三個入口都叫它 —— 各寫一份就是 lessons 一
   - 反過來不自動：體驗的段按 60 → 照樣是體驗 60（她說的是「選 20 就預設是體驗」；換回扣額度她按那一顆額度）
   - 按額度那一顆 → 時長回到預設（60）—— 跟「換了額度要重設」同一個時機
   - 沒有那門課的額度時，體驗那一顆在「送的／體驗…」裡：按了 → 時長自動是 20（第 2 點）
4. **「送的／體驗…」裡 EECP 放哪一排**：現在 EECP體驗是預設體驗的課、在展開後的第一排；合成之後 EECP 不是預設體驗，`giftOptions()` 會把它放進「別的課當體驗」（`:147`）。
   **建議：有「體驗排幾分」的課也排在第一排**（她最常約的體驗就是它），而且那一顆的 `durationMin` 讀「體驗排幾分」（`:142`）。不這樣做的話在 HANDOFF 講為什麼
5. **EECP**：`bookingMinutes: [60, 20]`、`durationMin: 60`、「體驗排幾分」20（它本來就沒有 `uncounted`，不用拿）；`aboveeNames` 留 `EECP`，`EECP20` 見第 7 點。
   **預期會變的**：`withMinutes()` 會讓每一段扣額度的 EECP 在月曆與讀取卡片上變成 `EECP(60)`（跟二返 `二返(30)` 同一條規則）—— 這是對的，寫進 ADR 與給她的驗收清單
6. **`course-eecp-trial` 從種子刪掉**（她：「直接不要」）—— 不是 `active: false`。每一個寫死它的地方（過目列的）：
   `slotOptions.js` 的 `GIFT_FIRST`、`buy.js`（不列預設體驗的課那一條與註解 `:231`）、`legacyImport.js:109`／`:1215`（舊表那一欄 → 11）、`entitlements.js:731`／`:767`、`treatmentSheets.js:149`（「被更長的那一個包住的不算」那一條還要不要）、`data/health.js:329`、
   `domain/health.js`（`:154`、`:224` 的 hint、`:1839` 那一張診間對照、`:1081`／`:1687`／`:1912` 的註解）、`docs/操作手冊.md`（7 處）、`docs/常見問題.md`（3 處）；
   測試：`master-catch-up`（11 處）、`master-data`（7）、`course-groups:70`、`provisional-courses:134`、`gift-kind`、`slot-options-order`、`merge-import:647`、`abovee.test:206`、E2E `03`、`51`、`55`
7. **拍 Abovee 的 `EECP20`** → EECP、20 分、體驗：`courseFrom()` 整格比對那一步之後，「EECP＋20 分」本來會認成正式課 —— 拆分鐘之後**分鐘＝那門課的「體驗排幾分」→ 體驗**（跟第 3 點同一支規則）。
   `EECP20` 這個寫法放哪裡由這一段決定（放在 EECP 的 `aboveeNames` 會被整格比對搶走、拆不到分鐘 —— 改 `courseFrom()` 的順序要跑 `tests/abovee.test.js` 那張 353 筆的表）。預約來源寫「正式課」的 `EECP20` 一樣記成體驗（她 10/5：「EECP20 就是 EECP 體驗」）
8. **拍 Abovee「已經記了」要認得扣法不一樣**：照片那一列（體驗 20）對上 app 同一個時間、同一門課但**扣額度的**那一段（或反過來）→ 不是安安靜靜的「已經記了」。
   照 ADR-0149「照片為準」：當成**要改的**（「改成體驗 20 分，不扣」那一行、預設勾，跟 `statusChange`／`aboveeDiffs()` 同一塊、括號讀計畫的 `rows`），已完成的鎖著只提醒；`claimHalves()`／`sameRow()` 這幾支認領的時候也要想一次會不會把兩種認成同一段
9. **來訪編輯器把一段從扣額度改成體驗（或反過來）**：**待她決定**（見 HANDOFF「要問她的」）—— 原地改＋確認框講一句「這一段改成體驗，不扣 EECP 的額度（Abovee 上記得改成 EECP20）」，還是當成改課程走 `rebookSlot()`（舊的取消＋取消 Abovee 待辦、新的一段待確認）。
   不管哪一種，**確認框都要講扣法變了**（`consequences.js` 多一種：拿 `counts()` 試算前後的差，ADR-0070）
10. **名字**：`EECP(20)(體驗)`（`short`）、試算表那一列「EECP（體驗）」—— 確認 `withMinutes()` 接得到 20、`kindOf()` 不因為時長分成兩列
11. **資料健檢（保險，她說「除了資料健檢多一列之外」）**：主檔上還有「EECP體驗」那一門的資料庫（staging 現在那一份）→ 一列，她按了才寫：
    - 指著它、**沒有扣額度**的段 → EECP＋`giftKind: 'trial'`＋20 分、名字快照重算；**不動狀態**
    - **那門課身上有額度、或有段扣著那筆額度** → **只列不修**（那是當初買的，變成什麼要她決定；講出是哪幾位、幾筆）
    - 沒有任何東西指著它了 → 刪掉那一門；EECP 補上第 5 點的三格（`checkSeedBlanks()` 那一套，三條護欄：她改過的不動、一個種子 id 都沒有的資料庫不念、同名不重建）
    - 正路是 11 的合併檔一開始就對；staging 合進去之後 `npm run staging:reset` 重匯
12. 文件：ADR **0154**（EECP 一門、「體驗排幾分」、20 ⇔ 體驗、照片上扣法不一樣算要改的；推翻 9/16、10/5、10/14 那三次的「另一門課」，舊的 ADR 不改）、SPEC 課程那一節、`CONTEXT.md`、
    CLAUDE.md「一段來訪要排多久」「送的／體驗」「拍 Abovee 記很多段」三列補新的一層、`docs/課程與待辦對照表.md`

## 判準

- **這一行會不會讓一段體驗被算進 EECP 的額度，或反過來？** 每一條路各一個測試：
  - 壓表：客戶A 有 EECP 額度 → 預選 EECP(60)、60 分；按 20 → 那一段是體驗、`entitlementId: null`、額度的已排沒有多 1；再按 EECP 那一顆 → 60 分、扣額度
  - 來訪編輯器：新的一段同上三步；改一段既有的 EECP 60（扣額度）的時長成 20 → 照她選的那一種（第 9 點），確認框講「不扣了」
  - 拍 Abovee：照片 `EECP20`、預約來源「正式課」→ EECP、20 分、體驗、預設勾；`EECP60` 或 `EECP` → 正式課 60
  - 拍 Abovee：app 上 10:00 EECP 60 扣額度、照片上 10:00 `EECP20` → 不是「已經記了」，是「要改的」一行、預設勾；套上去之後那一段是體驗 20、額度的已排少 1
  - 沒有 EECP 額度：「送的／體驗…」裡按 EECP → 20 分、體驗
  - 候選補的、補登的一段體驗 EECP → 20 分（不是 60）
- 設定頁：把「體驗排幾分」填成 60（＝預設時長）→ 存不下去、講為什麼
- 存下去的段：`endsAt` 是開始＋20 分；`slotName(short)` 是 `EECP(20)(體驗)`；試算表那一列是「EECP（體驗）」，不進合計
- 種子上沒有 `course-eecp-trial`；`grep -rn "course-eecp-trial" public/js` 只剩資料健檢認舊資料庫那一列
- 資料健檢那一列：沒扣額度的兩段 → 按了之後是 EECP 體驗 20 分、那一門刪掉、再掃一次這一列消失；那門課身上有一筆額度 → 只列、不刪那一門；沒有那一門的資料庫這一列不念
- 改了種子之後跑一次記憶「改種子之後要另外查的七個地方」

## 做完時留下的

（做完寫）
