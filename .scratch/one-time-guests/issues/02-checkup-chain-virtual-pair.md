# 02：健檢那一串（domain）—— 一次性客人用一對只在算的時候存在的額度

Status: todo
Blocked by: 01

## 動工前先讀

- `docs/adr/0172-a-one-time-guest-is-a-customer-off-every-list.md` 決定三（**整支最要緊的一節**）與「被否決的路」
- ADR-0022、0063、0139、0142、0145、0159（鏈的規則；**一個字都不改**）
- `CLAUDE.md` 連動表：「健檢與二返的關係」「報告到手之後的那一站」「n返（三返、四返…）的形狀」「算次數、驗證、預選額度要拿哪些來訪」那幾列
- `public/js/domain/followups.js`：`pairsOf()`（`:109`）、`owed()`／`owedCounts()`（`:256-296`）、`usedAndDone()`（`:298`）、`linksOf()`／`claimedExams()`（`:400-418`）、
  `syncFollowupTasks()`（`:800`；任務只記 `visitId`，`:987` 附近）
- `public/js/domain/entitlements.js` 的 `counts()`（**總數讀 `totalQty`**，`:123`）
- `public/js/domain/nthFollowup.js`（`examEntitlementIds`／`isExamVisit` `:113-127`、`courseIdForNth`、`examChoicesForNth`、`nextNthFor`、`secondFollowupIds`、`followupsOfExam`）
- `public/js/domain/visits.js` 的 `validateVisit()` 二返連結那幾道：`examIds`（`:1710`）、`isExamVisit`（`:1850`）、`followupHolding`（`:1871`）、`examAfter`（`:2225`）、`unlinkedFollowupSay`（`:2155`）；
  `entitlementWarnings`（`:2102-2130`）
- 「過目抓到的」2、3、11（HANDOFF）
- `docs/agents/lessons.md` 一、二

## 她要的

> 他之前有用卷換了健檢，所以我要幫她排二返，雖然這次失約，但是之後還是會幫他排……如果我排他了我會希望在日曆上看到他，以及約完二返後的寫紀錄等等待辦，我也還是都要做，就和一般來訪一樣

第 3 題她選：**健檢記在 app 裡 → 跟一般客人一模一樣**（追蹤健檢報告 → 寄報告給醫師＋約二返，二返接回那一次健檢，**一次健檢欠一場二返**，失約了「約二返」再長）；
健檢不在 app 裡 → 二返按「健檢不是我排的」（ADR-0169 照舊）。第 6 題：轉成客戶之後，一次性時做的健檢還欠的那一場二返「照舊不扣、接回那一次」。

## 為什麼會這樣

整條鏈以額度為軸：`pairsOf()` 只從健檢額度＋指回它的二返額度配對；「做完一次健檢」是 `usedAndDone(v, pair.source.id)`（比 `slot.entitlementId`）；
`counts()`、`placeSeconds()`、`examsAwaitingReport()`、`examChoicesFor()` 全部跟著它。一次性的段 `entitlementId` 是 null → 一張都不長、二返接不上。
n返 不一樣：它本來就靠 `followupNth`＋沒有額度認，找健檢走 `examEntitlementIds`／`isExamVisit`。

## 要做的（這一支只做 domain；呼叫端在 03）

- **一支投影**（建議 `domain/oneTimeChain.js`；看 import 方向，不可以繞成一圈）：`withOneTimeChain({ entitlements, visits, coursesById })` → `{ entitlements, visits }`
  - 從**一次性的段**生虛擬的一對（id 以 `oneTime:` 開頭、一門健檢課程一對）：健檢那一筆 `courseId`＝那門健檢、**`totalQty`**＝他還活著的一次性健檢段數；
    二返那一筆 `followupForEntitlementId` 指回去、`courseId`＝那門健檢的 `followupCourseId`、`totalQty` 同數 → `owed()` 的 `min(做完的健檢, 二返總數)` 就是「一次健檢欠一場」。
    `label` 也給一個（`entitlementWarnings`、`:1796`、`:1847` 讀它；但那幾道本來就不該跑到虛擬的身上，見下）
  - 來訪**抄一份**，只填兩種段：一次性的健檢段 → 健檢那一筆的 id；**接在一次性健檢上的一次性二返段** → 二返那一筆的 id。
    **n返 不填**（填了會被 `counts()`、`linksOf()`、`doubleClaimedExams()` 當成二返；過目 2）；`examNotMine` 的段不填
  - **冪等**：已經投影過的再投影一次不變（呼叫鏈上可能套兩次）；**沒有一次性的段時原封不動交回**
- **n返**：一次性客人的 n返 接他的一次性健檢 —— 讓 `examEntitlementIds`／`isExamVisit`／`courseIdForNth`／`examChoicesForNth`／`nextNthFor` 認得一次性的健檢段
  （吃投影過的那一份，或在那幾支裡認 `isOneTimeSlot()` 的健檢段；**選一種寫進「做完時留下的」**）。`slotFromPicks()` 的 n返 路（`slotDraft.js:93-97、160`）跟著通
- **`validateVisit()` 只在二返連結那幾道吃投影**（`:1710`、`:1850`、`:1871`、`:2155`、`:2225`）：
  - 一次性的二返接一次性的健檢 → 「新接上的連結指到取消／未到」「一次只接一場」照樣擋（現在 `ent` 是 undefined，那三道整個跳過，`:1845/1863/1870`）
  - **其餘照原本那一份驗**：01 的「一次性的段 `entitlementId` 一定是空的」、`entitlementWarnings` 的超用（拿虛擬的去算會講「超過總次數」）都不可以看到投影過的那一份（過目 3）
- **「做什麼」那一排要的兩支**（給 06、07 用）：
  - `oneTimeExamChoices(...)`：一次性客人按了二返 → 列他的一次性健檢（`examChoicesFor()` 的虛擬版，`pickable` 規則照 ADR-0145）
  - `slotOptions.js`：**轉成客戶之後**虛擬那一對 `owed > 0` 才多一顆「二返（一次性那一次）」，按了組出來的段帶 `oneTime: true`、接那一次健檢 —— 三個入口（壓表、來訪編輯器、拍 Abovee）共用這一支
- **存檔那一道防線**（`data/visits.js` 的 `save()`，commit 之前）：要存的來訪、以及拿去算 `countOps` 的那一份，任何一段 `entitlementId` 以 `oneTime:` 開頭 → 丟錯（不是悄悄清掉）。
  不擋的話 `countOps`（`:762`）會去更新一筆不存在的額度文件
- 任務：鏈上那三種只記 `visitId`，虛擬的 id 不會跑進任何一筆任務 —— 測試釘住

## 判準（每一條一支測試）

- 一般客戶（沒有任何一次性的段）跑 `syncFollowupTasks()`、`examChoicesFor()`、`strandedFollowups()`、`validateVisit()`…，加不加投影結果一模一樣嗎？（拿 `tests/followups.test.js` 既有的情境各跑一次）
- 投影兩次跟一次一樣嗎？
- 一次性客人一次健檢做完 → 長「追蹤健檢報告」？勾了 → 長「寄報告給醫師」＋「約二返」？約好一場接回去的二返 → 「約二返」收起來？那一場二返未到 → 「約二返」再長？
- 一次性客人做了兩次健檢 → 欠兩場二返？
- 一次性的三返接一次性的健檢 → 存得下去？它會不會讓「約二返」收起來、讓那一次健檢顯示被佔走？（不會 —— n返 不佔二返）
- 一次性的二返接一次性的健檢 → `validateVisit()` 不講「超過總次數」、不講「要選一個額度」？第二場接同一次 → 擋？
- 一次性的二返接的健檢還沒做完 → `cannotClose()` 擋？
- `examNotMine` 的一次性二返會不會被算進虛擬那一對？（不會）
- 一段 `entitlementId` 以 `oneTime:` 開頭的來訪 → `save()` 擋下來？任何一筆任務、任何一段存進去的來訪身上找得到 `oneTime:` 開頭的 id 嗎？（不可以）
- 轉成客戶、又買了一筆真的健檢：真的那一對與虛擬那一對各算各的（`placeSeconds()` 不會把一次性的二返配給真的健檢）？

## 做完時留下的

（做完的那一段寫：投影放哪、n返 怎麼認、`validateVisit()` 哪幾道吃投影）
