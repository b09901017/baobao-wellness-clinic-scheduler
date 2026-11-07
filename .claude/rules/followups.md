---
paths:
  - "public/js/domain/followups.js"
  - "public/js/domain/nthFollowup.js"
  - "public/js/ui/relinkFollowup.js"
---

# 健檢與二返、n返、健檢不是我排的

**每一節的標題是「改了這個」，底下每一條是「一定要一起檢查」的**（從根目錄 `CLAUDE.md`「容易漏掉的連動」那張表搬來，標題照舊）。
新長出來的連動補進對應的那一節（沒有就加一節）；不屬於這一份的補進別份或開新的一份，並加進根目錄 `CLAUDE.md` 的索引。

## n返（三返、四返…）的形狀

- 它**不是額度**：時段的 `entitlementId` 是 `null`，靠 `followupNth` 與 `followupForVisitId` 站得住（ADR-0063）。
- 規則只在 `domain/nthFollowup.js`，**不要寫進 `domain/followups.js`** —— 那一支是二返的，而「二返一個字都不動」是這件事唯一站得住的理由。
- 判準：**這一行會不會讓一筆二返的資料被算成 n返，或反過來？** **問「連結」不問「哪一種返」的那幾支住在 `followups.js`**（`strandedFollowups()`、`doneAheadOfExam()`、`cannotClose()`，ADR-0145：接的那一次健檢怎麼了，二返與 n返 同一個答案；`nthFollowup.js` import 那一支，反過來會繞成一圈）—— 那不違反上面那一條。
- 兩個入口（壓表、來訪編輯器）共用 `nthSlotFields()` 組時段；換掉那顆丸子時 `followupNth` **一定要清乾淨**，不然那一段會同時帶著額度與返數。
- **名字只在快照上**（它借二返那個課程），所以 `slotName()` 看到 `followupNth` 填過就讀 `courseName` 不讀主檔 —— 讀主檔的話日曆上一段三返會印成「二返」

## 健檢不是我排的（`examNotMine`）

- **時段上一格 `examNotMine: true`**（ADR-0169，2026-11-02）：別人轉來、健檢不在 app 裡的客人，二返與三返～十返**不扣任何一筆額度、不接任何一次健檢**，其餘照二返那門課（日曆、醫師、診間、時長、Examine／耀聖、寫紀錄、不簽療程單）。
- **讀只走 `masterData.js` 的 `isExamNotMine()`**（只認 `=== true`，**永遠不從形狀推** —— 舊資料裡「二返那門課＋沒有額度＋沒有連結」的段本來就有；`tests/exam-not-mine.test.js` 掃 `public/js` 沒有別處讀 `.examNotMine`）；一般的段**沒有這一格**（不寫 `false`／`null`）。
- 二返**不寫 `followupNth`**（`nthOf()` 的「二返回 null」約定一個字都不動），三返～十返寫返數與快照。
- `giftKindOf()` 第一行對它回 `null`。
- 課程是 `examNotMineCourse()`（剛好一門才回 —— 不是就不畫那一顆）；驗證問的是 `isFollowupCourse()`（任何一門都算）。
- **組時段只走 `slotFromPicks()` 的 `examNotMine: true` ＋ `nth`**（標記贏：額度、n返、送的、連結一律不看；`nth` 不是 2～10 → 「先選第幾返」）；`validateVisit()` 的 `examNotMineErrors()` 只放過那一種形狀，**沒有標記的段一道都不放寬**（n返 沒接健檢、二返沒有額度照舊擋）。
- **三個入口**，那一顆都是 `slotOptions.js` 的 `notMineOption()`（值 `NOT_MINE_PICK`、旗標 `isNotMine`、收在「送的／體驗／其他…」裡的「其他 ▸」，`giftFold.js`）：壓表（`view.entitlementId === NOT_MINE_PICK` ＋ `view.nth`、`data-nmnth`）、來訪編輯器（`readNotMineSlot()`、`plainSlot()`、只在畫面上的 `pendingNth`、`s${i}-nmnth`）、拍 Abovee（列上的 `notMine` ＋ `nth`，`picksOf()` 交 `examNotMine`；`data-abl-nmnth`）—— 「第幾返」那一排**都不是 n返 那一排的名字**；**日曆、壓表不預選返數，拍照照照片**。
- **拍 Abovee 讀照片那一下從來不按它、不勾**（`notMineHintFor()`：三返～十返而那一排上沒有「＋ n返」、二返而 `entitlementChoices()` 是空的 → `notMineHint`、`newRowSay()` 指她去「其他」、排進要你看）；`notMine`／`notMineHint` 在 `resolveItem()` 的 `next`、`pickOption()` 的 `base`、`asRecorded()` **三處清掉** —— 新增一種列上的旗標照做。
- 紅字是 `warningDetails()` 的 source `examNotMine`（進 `mustSee()`：帶標記的二返而身上還有剩的二返額度、任何一段而有接得上的健檢）；確認框是 `consequences.js` 的 `notMineNames()`／`notMineLine()`（`bookingConsequences()`、`aboveeConsequences()`；帶標記的三返不講「加約的」）；**既有一段改成帶標記或拿掉**走 `chargeSwitchConsequences()`（要傳 `customer`、`chain`，「約二返」長出來／收起來才講得到）。
- 試算表：帶標記的二返進「二返（不算次數）」、排在三返那幾列前面（**舊資料裡沒有額度、沒有標記的二返也併進同一列**，S4），三返～十返進原本那一列（`sheetReport.js` 的 `extraRows()`／`rowNthOf()`）。
- 健檢那條鏈一支都看不到它（沒有額度、沒有連結）。
- 判準：**這一行會不會讓一段沒有標記的二返或 n返 被放寬，或讓一段有標記的被算進任何一筆額度、接到任何一次健檢？**

## 健檢與二返的關係

- 只寫在 `domain/followups.js`（配對、還欠幾次、那條鏈上的三種待辦）。
- 不要在 `taskRules.js` 或 UI 裡再判斷一次，見 ADR-0022。
- **「一次健檢做完了」問健檢那一段**（`usedAndDone()`），**「一場二返／n返佔著那次健檢」只算待確認／已確認／已完成**（`holdsExam()`，取消與未到都不佔 —— 人沒來要重約一場接回同一次）—— 候選、追蹤報告、寄報告、n返、試算表的二返註記全部走這兩支（ADR-0112）。
- **「這是哪一次健檢的」那一排列出每一次、標它自己的狀態（`examStatusIn()`），待確認／已確認／已完成而且沒被別場佔走的按得下去、取消與未到按不下去**（`PICKABLE_EXAM`、`pickable`，ADR-0145 推翻 9/24 的「只有已完成」—— 她：「客人常當場一起約」；二返與 n返 兩排、壓表／來訪編輯器／拍 Abovee 三個入口共用，丸子上那一小格只寫在 `examChoiceNote()`）；存檔驗證擋**新接上**的連結指到取消／未到的那一次 ——**不算新接上的只有兩種，而且要是同一種段**（同一筆二返額度，或都是 n返；`visits.js` 的 `carried`）：同一個位置本來就指著它；或這一次存檔把本來指著它的那一段取消掉了（二返改時間，`rebookSlot()`：新的一段接在尾巴、帶著同一個連結 —— 所以不能只比位置）。
- 以前問「那一天有沒有任何一段指著它」：取消掉的段、n返 都算，那一天再加一場接同一次的二返時這一道與「一次只接一場」都跳過。
- **接在還沒做完的健檢上、還沒做的二返不算「約掉了一次」**（`owed()`，ADR-0145）：不扣的話別次健檢開著的「約二返」在約好的那一刻被收掉；**指到的那一次不在手上這一份來訪裡就照舊算**（只拿到部分來訪時不可以憑空長一張「約二返」）。
- 有連結、還佔著的每一段只從 `linksOf()` 一支出來（`claimedExams()`、`linkedSeconds()`、`bookingForExam()`、`owed()` 共用）。
- **一次健檢只接一場二返**：存檔驗證拿全部來訪擋新接上的第二場（`visits.js` 的 `followupHolding()`；要多約走 n返）。
- **接的那一次接不上了（取消、未到、改成別的課程）只講不改**：哪幾場只問 `strandedFollowups()`（取消的確認框、另約健檢的確認框、資料健檢共用），二返做了而健檢還沒做完是 `doneAheadOfExam()`、同一次被兩場接走是 `doubleClaimedExams()`；二返排在接的那一次之前只提醒（`visits.js` 的 `examAfter()`，不進 `mustSee()`）。
- 客戶詳情的健檢卡片**不講**「健檢做完 N 次：二返…」（2026-10-19 拿掉了，她：「數字加起來對不上」；`describePair()` 跟著刪了）—— 不要加回來。
- **沒接到的那一句提醒**（`visits.js` 的 `unlinkedFollowupSay()`，2026-10-07）也問 `examChoicesFor()`：有 `pickable` 的才說「還沒指定」，其餘講出為什麼選不到（還沒存的這一筆、都被佔走、只有取消或沒來的、一次都沒約過）與「簽療程單時照樣會扣」—— 她正在存的那一筆要自己算進去（同一天健檢＋二返）。
- 照舊只是 warning，舊資料沒連結照樣存得下去。
- 以前問整筆：健檢那段取消了、同一天 SIS 做了時整筆是已完成，那次被取消的健檢照樣接得到二返。
- **二返沒有連結的照位置算**：沒連結、做完的二返先配給最舊的那幾次（`placeSeconds()`，報告與約二返兩圈共用，ADR-0139）。
- **「約二返」的名額先給報告勾過的那一次**（ADR-0142，她：「多一張提醒可以勾掉，少一張沒人提醒」）：報告勾過而且已經開著「約二返」的那一張**連照位置算做完了的也留著**（那一場可能是跟別次一起約的）→ 報告勾過的 → 已經有待辦的 → 其餘 → 照位置算做完的。
- 改這個順序之前跑 `tests/followups.test.js` 最後那一條隨機定點。
- **照位置配的時候勾過「約二返」的那幾次也佔位置**（`placeSeconds()`，2026-10-09 審查：她自己勾掉的那一次，二返多半就是那一場沒連結的 —— 先拿掉再配，下一次健檢會被當成二返做完了、報告不長）；**照位置算二返做完、而且從來沒有過任何一張待辦的那一次不進名額**（匯進來的舊健檢：名額落到它身上只會長一張一出生就逾期的報告）。
- **另約一次健檢時可以順便把那一場二返接過來**（ADR-0146，2026-10-12；**系統照舊不自動搬**）：有沒有那一顆只問 `relinkOffer()` —— 這位客戶**剛好一場**接不上的回訪（`strandedFollowups()`，二返與 n返 一起數）、是二返、配的就是這一次新加的那一段健檢的額度、還開著、不在正要存的那一筆裡；按了之後那一筆長什麼樣只有 `relinkSlot()`（只動 `followupForVisitId`）。
- 放寬「剛好一場」之前先想那一顆的字講不講得清楚是哪一場。
- **改到健檢或二返額度就重算那一串**（ADR-0159，2026-10-19）：加購、改次數／購買日、刪掉、還原、資料健檢「補上二返額度」都在**同一個 commit** 裡帶上 `data/visits.js` 的 `chainAfterEntitlements()`（回 `{ ops, plan, visits, tasks }`；動到的不是健檢或二返就不讀、讀不完整就不重算 —— 額度照寫，ADR-0158 反過來用）—— 以前補了二返額度，「約二返」要等下一次存來訪才長；**新增一條改額度的路要走它**。
- 確認框（補一筆二返額度、刪除額度、資料健檢補上）拿同一支試算（`data/customers.js` 的 `previewChain()`、`data/health.js` 的 `previewFollowupChains()` → `consequences.js` 的 `chainPlanLines()`／`chainCountLines()`）；**沒有講到鏈的確認框的那幾條路**（改次數那一張表、加購一筆／一整個方案、拍訂購單加購、改購買日、從已刪除項目還原、「把計數欄位改成重算值」）存完的 toast 接半句（`chainSavedSay()`；`data/customers.js` 那幾支寫入都回 `chainSaid(chain)`，2026-10-19 issue 17、19）—— **新增一條改額度的路也要把它回給 toast**。
- 次數改少時多出來的「約二返」收起來，理由是「二返的次數不夠」（`reasonFor()`），不是「約好了」

## 報告到手之後的那一站

- 它是**兩張**不是一張：寄報告給醫師、約二返，死線一樣（ADR-0065）。
- **「寄報告」走在 `owed()` 那道閘門外面**（`syncFollowupTasks()` 的第二圈）—— 擠進第一圈的話，她一約好二返 `owed` 就掉到 0，還沒寄出去的那一張會被**靜默收掉**。
- `taskRules.js` 的 `CHAIN_KINDS` 要有它；`data/visits.js` 的 `chainKinds` 刻意沒有。
- **追蹤健檢報告長不長也不過 `owed()`**（ADR-0139）：`examsAwaitingReport()` 自己排，二返**做完了**才不追；只有約二返受還欠幾次管。
- 第一圈排「已經有待辦的」時這一輪要長的報告也算 —— 拿掉的話會這一輪長一張約二返、下一輪又收。
- **報告與寄報告不吃二返額度**（ADR-0159，推翻 ADR-0139 名額那一句的上限）：健檢做的比買的多，多出來那一次照樣追 —— 名額＝做完的健檢 − 做完的二返 − 先定案的；只有約二返受 `owed()` 的 `min(做完的健檢, 二返總次數)` 管。
- **超出二返額度、匯進來（`importedFrom`）、從來沒有過任何一張鏈上待辦的那一次不補報告**（切換那天的舊健檢）—— 只看「從來沒有過待辦」不夠：在 app 裡做完的超出那一次以前也被上限擋著、一樣沒有過
