---
paths:
  - "public/js/domain/abovee.js"
  - "public/js/domain/aboveeImport.js"
  - "public/js/domain/identify.js"
  - "public/js/ui/components/aboveeConfirm.js"
  - "functions/transcripts/aboveeList.js"
  - ".claude/skills/month-end-reconciliation/**"
---

# 拍 Abovee、照片上的人、Abovee 上的寫法

**每一節的標題是「改了這個」，底下每一條是「一定要一起檢查」的**（從根目錄 `CLAUDE.md`「容易漏掉的連動」那張表搬來，標題照舊）。
新長出來的連動補進對應的那一節（沒有就加一節）；不屬於這一份的補進別份或開新的一份，並加進根目錄 `CLAUDE.md` 的索引。

## 拍 Abovee 記很多段

- 規則只在 `domain/aboveeImport.js`：兩張照「第幾列」對上、**列數不一樣就不對**（`mergeAboveePhotos()`）；每一列分成新的／已經記了／對不上／認不得（`readAbovee()`，認人走 `identify.js`、課程診間治療師走 `abovee.js`）；組來訪一律 `planAbovee()` → `slotFromPicks()`；標壓完 `queueMarksAfter()`（不在清單裡的不加）。
- **照片上的預約狀態就是要記的狀態**（ADR-0149，2026-10-15，推翻 ADR-0116 的「只講不改」與 ADR-0104 的「新段一律待確認」）：六種字 → 四種狀態只在 `statusFromAbovee()`（讀不出來的不猜：待確認＋`statusUnread`、不先勾；那一張沒拍到那一欄 `photoStatus` 是 `null`，**不是待確認** —— 一律不比、照舊的預設勾）。
- 新的一列記成什麼是 `photoSlotStatus()`、預設勾不勾是 `photoWantsChecked()`（只換掉 ADR-0030 的「過去的不勾」，其餘不勾的條件一條都沒拿掉）、那幾句是 `photoRowSays()`。
- 既有的那一段：同一格同一個課程，`existingAt()` 活著的優先、沒有才看取消掉的，`crossCheck()` 照 spec 那張 5×5 表判 —— 要改的是「已經記了」＋`statusChange`＋`adoptStatus`（預設勾），只提醒的是對不上、理由全在 `mismatchSay()`（已完成改不回來、未到取消不掉、二返簽不成 `closeBlocked`、日子不合理、兩張照片不一樣）；套上去是 `applyPhotoStatus()`（寫之前比對她看到的、未到 → 已完成一格都不停在半路）。
- **一位一天只算一次**：`photoDayPlan()` 拿重讀的那一份 → 套照片要改的 → 組新的（要不要併看改完之後的；**拍照之前開著、被這張照片結掉的那一天照樣併進那一次** —— `intoDayClosedByPhoto()`，2026-10-16 她：一天一次，ADR-0083）→ 驗證，確認層的提醒、確認框（`aboveeConsequences({ plan })`）、寫入（`record()` → `planToWrite()` → `writePhotoPlan()`，存一筆換進手上那一份）**三邊只讀它** —— 各算一份的話三邊會講三種結果。
- 「整張套上照片之後」是 `afterPhoto()`（閘門、「接哪一次健檢」那一排都看它）。
- 確認框的次數讀計畫的 `rows`（`charge`），**每一個括號加起來＝存完之後額度前後的差**。
- 照片上放掉的段（記成已取消、改成已取消、改期的舊時間）帶 `freed` 進 `save()`，「取消 Abovee」一出生就勾好（見「取消類的待辦」那一節（`tasks.md`））。
- **app 上那一格只有取消掉的段、Abovee 上還掛著的，算新的一段、不預設打勾**（`appCancelledHere`，課程一不一樣都是；同一門課的多一格 `appCancelledSame`，句子不一樣、排進要你看；ADR-0144 推翻 ADR-0116 那一格）—— 取消之後同格重約的要記得進去，她勾了才寫，取消的那一段不救回來。
- **確認框的句子在 `consequences.js` 的 `aboveeConsequences()`**，跟壓表與日曆新增共用 `registrationsWhenSettled()`、`settledDayLine()` —— 以前寫在畫面裡，#129 的 22 與補登過去那一天它都沒跟上。
- **2026-10-05 確認層跟壓表一樣選得了**（ADR-0123）：每一列「換一位」（`domain/customers.js` 的 `searchCustomers()`）；「要做什麼」那一排＝`slotOptionsFor(…, { includeUsedUp: true })`，她按一顆與翻譯時預選**走同一支 `pickOption()`**（n返 與送的／體驗在挑額度之前分流；照片上的品項優先；送的／體驗走 `giftRow()`，照片上那一台屬於這門課才留）。
- **預約來源寫「體驗」**（抄字第十一欄，2026-10-14，ADR-0148）：判斷只有 `isTrialRow()`，`resolveItem()` 預選那門課的體驗、**不看身上有沒有額度**；健檢與二返（`canBeGift()` 是 false）照舊挑額度、`warningsByRow()` 多一句 `trialSay()`（**進 `mustSee`**）；「換一位」照樣是體驗（照片上的字）；合併扣課跳過送的／體驗的列（`mergeOrphan` 也不標）。
- 抄不到那一欄（Function 沒重新部署）就是不是體驗，行為跟以前一樣。
- **合併扣課**是 `mergeRows()`（`readAbovee()` 最後一步：一對記成一段、記一句自動寫、第二台的提醒 `mergedNotices()`；勾了找不到另一半的 `mergeOrphan` 不打勾），抄字第十欄，**Function 沒重新部署之前抄不到那一欄**。
- **搬了時間**是 `flagMoved()`：拿得準的那一對（剛好一對、舊的時間在照片範圍裡 —— 範圍跟「app 有、這次照片上沒有」同一支 `photoBounds()`、舊的還開著；**app 上新的那個時間取消過的列不算**（`appCancelledHere`：多半是日曆先改了、Abovee 還沒改，照 ADR-0144 走，2026-10-16 中途發現 17））→ 「已經記了」＋`move`＋`adoptMove`（預設勾），`applyPhotoMove()` 走 `rebookSlot(…, { status })`（新的那一段照照片的狀態、時長照舊、治療師診間照照片，`movedSlotFields()`）；改完撞期、重疊、二返簽不成 → `checkMoves()` 不先勾、講一句（**不是不准改**）。
- **它的 kind 是 `recorded`，不可以再被當成新的一段記一次**（舊的沒取消、新的多一段＝多扣一次）。
- 拿不準的照舊（新的、不預設打勾、去日曆改期）；不同天的改期認不出來。
- **改期那一對也比扣法**（staging-polish 16：Abovee 上改了時間又改成 EECP20）：`flagMoved()` 拿照片那一列跟舊的那一段問 `chargeChangeOf()`，有差同一列多一行、預設勾跟著改期；新的那一段的時長照**套的那一刻**舊的那一段（`applyPhotoMove()`，扣法先套），`checkMoves()` 也先套扣法再驗。
- **扣法不一樣**（ADR-0154：照片是體驗 —— 預約來源寫體驗、或分鐘＝`trialMinutes`（`EECP20`）—— app 那一段扣著額度，或照片清楚是正式課（`EECP60`）、app 那一段是體驗）是 `chargeChangeOf()` → 「已經記了」＋`chargeChange`＋`adoptCharge`（預設勾；已完成的 `chargeLocked` 只提醒；反過來挑不出額度不先勾）→ `applyPhotoCharge()`（只動 `entitlementId`／`giftKind`／`minutes`／`endsAt`，排在狀態之前；同一列兩件都改時 `rows` 的次數從扣法那一步之後算，不重複）。
- 以前 `EECP20` 是另一門課、配不上，合成一門之後不比就是安安靜靜地照扣。
- **治療師／診間不一樣**是 `aboveeDiffs()` → **預設勾**（`adopt` 是 `!locked`，ADR-0149 推翻 ADR-0123 第 11 段的「她按了才改」）→ `adoptAbovee()`（只動那兩格、換診間清 `bed`、寫之前比對她看到的值，不一樣就不蓋）；已完成的鎖著、照舊在「要你看」。
- **要改既有的那幾件收在確認層「要改的」那一塊**（`offersChange()` 判、`changeLines()` 一行一件事、括號讀計畫的 `rows`），app 上空著、照片上有的治療師／診間收成一行（`fill`）—— 不在「要你看」（`needsAttention()` 只留鎖著的）。
- 日子過了、Abovee 上還是待確認那三種的列收在「要你看」底下一組、預設收著（`pastStillOpen()`；有別的理由的照舊在「要你看」）。
- **「app 有、這次照片上沒有」**（ADR-0129，2026-10-06）是 `absentFromPhoto()`：範圍只在 `photoSpan()` 算（照片上第一列到最後一列、**兩頭那個時間不算**；讀得出第一頁／最後一頁才放寬到「起／訖」，**猜整個月只在每一列都在這裡時**（不重複的列數 ≥ 總筆數）—— **一次確認層就是一頁**，放寬錯了就是把下一頁喊成沒拍到）、哪幾段算問 `bookingSystemOf() === 'Abovee'`、抬頭的數字 `summarizeAbovee(items, absent)` 跟那一塊同一份（抬頭那一行的字只在 `aboveeSummaryLine()`：app 裡沒有的人另外數 `notInApp`，「照片上沒有讀到預約」只在一列都沒有時講）；**對誰另外問 `photoWho()`**（ADR-0153，2026-10-18）：照片上的字（`photoPeople()`：病歷號、名字差一個字算同一位）1～2 位只對那幾列認出來的人、還沒認出的那一位講一句不退回對大家，3 位以上對大家 —— **跟範圍放不放寬是兩件事**（`photoBounds()` 的 `customerId` 照舊要每一列都認出來，`flagMoved()` 也讀那一份），不要合回一格；**列上不放按鈕**（照片不留），整塊底下一顆「先記勾起來的再去日曆」走既有的 `save()`。
- 抄字多 `dateFromText`／`dateToText` 兩格，Function 沒重新部署之前讀不到、範圍退回列的日期。
- **算次數拿那幾位的全部來訪**（`aboveeConfirm.js` 的 `loadHistory()`，認得哪幾位問 `customersOnPhoto()`；讀不到的那一位不預設打勾、`partialSay()` 講一句 —— 見「算次數、驗證、預選額度要拿哪些來訪」那一節（`visit-editing.md`））。
- **兩張都有姓名的去重鑰匙是 `sameRow()`**（病歷號或名字＋同一天同一個開始時間＋課程＋取消了沒，空的那一格不比），**只跟別張的列比、同一張裡不去重**（同人同時兩門課是兩列）；取消之後同一格重約是 `rebookedHere()`（不喊對不上）；鑰匙擋不住、看起來是同一段的 `flagRepeats()`／`markRepeat()`（不預設打勾＋一句）。
- **左右兩半與兩張接起來，診間／服務資源／取消原因／預約來源兩邊都有字取比較長的**（`fullerCell()`；預約來源也在交界，所以 `RIGHT_KEYS`、`EDGE_KEYS` 都有它）—— 切到一半的那一格不蓋掉完整的。
- **「已經記了」認得三種形狀**：同一個時間、合併扣課的後一半（`claimHalves()`，app 那一段要蓋得住它）、沒有開始時間的舊段（`claimTimeless()`，一段只認領一列、取消的列不認領）；後處理的順序是 `claimHalves()` → `mergeRows()` → `claimTimeless()` → `flagMoved()` → `flagRepeats()`，換順序要回去跑 `tests/abovee-pages.test.js`。
- **提醒每一列只畫自己的**（`warningsByRow()`，靠 `planAbovee()` 每一組的 `at`），**會改變寫入結果的那幾種收著也看得出有事**（`mustSee()`：器材對警示、同一筆裡重疊、超用與到期、品項不一樣、撞期、「健檢不是我排的」那兩句）：辨識結果上是一個紅字短標記（最要緊的一個＋「+N」，短字與先後只在 `warningTag()`，那一列有沒有只問 `rowTag()`），整句在「發現問題」那一頁與點開之後（ADR-0170，推翻 ADR-0138 收著畫那一兩行）；那一頁列哪幾件、N 是多少只問 `problemsPage()`（「app 有、這次照片上沒有」那一塊講什麼、算幾件是 `absentShown()`；**兩頁只畫目前那一頁** —— 同時在的話 `data-abl-row` 會重複）；確認框講「其中 N 段有提醒」（`aboveeConsequences({ flagged })`，ADR-0138）。
- **沒勾的新的那一列點開才算「勾起來的話：」**（`whatIfChecked()`：當成勾起來整張重跑 `photoDayPlan()`、只讀那一列、不寫回勾；before-golive 09）—— 收著不畫、不進 `mustSee` 的那幾行與確認框的計數；點開著的那一列在別列勾起／拿掉時跟著重畫（`repaintRow()` 認 `openKey`）。
- **驗證一組時拿的來訪連這一次別組要記的一起算**（`visitsForCheck()`，2026-10-09 審查）：同一張照片上同一位客人別天的那幾段、別人同一天的那一段 —— 只看資料庫裡的話，只買 1 次、照片上三天各一段時三列都不講超用；還沒存的那幾筆要給暫時的 id（`validateVisit()` 靠 id 把自己濾掉）。
- **整張一起看才認領的欄位（`halfOf`、`timeless`、`repeatOf`、`movedFrom`、`noExam`、`closeBlock`、`statusChange`／`adoptStatus`、`chargeChange`／`adoptCharge`／`chargeLocked`、`move`／`adoptMove`／`moveWarnings`）換一位時要清掉**（`resolveItem()` 的 `next`），**變成「已經記了」時也要清**（`asRecorded()`）：新增一種兩處都加。
- **照片上是三返而接不上健檢、二返而一筆二返額度都沒有 → 不替她按、不勾**（`notMineHintFor()` → `notMineHint`、`newRowSay()` 那一句，ADR-0169，見「健檢不是我排的」那一節（`followups.md`））；她按了那一顆是列上的 `notMine` ＋ `nth`。
- **同一張照片上的健檢接得上二返**（ADR-0145）：還沒存的那一組只有一套暫時 id（`plannedId()`：`g.visit.id ?? 'abovee:客戶|日期'`），驗證（`visitsForCheck()`）、「接哪一次健檢」那一排（`examChoices(…, items, row)`）、存檔排先後與換 id（`resolveSaved()`）共用 —— 另寫一套的話列得出來的存不下去、或存進一個指到不存在的連結（存檔那一圈以前自己拼一次、只認得暫時的，健檢併進既有那一天時排不到前面）。
- **這一列自己那一天、這一次才要記的健檢列得出來但按不下去**（`unsaved`，丸子寫「存好才接得上」）：連結記的是來訪 id，而那一段跟這一列同一次寫進去 —— 來訪編輯器同一條；那一天存著的那一份本來就有健檢的照舊接得上。
- 存的時候**被同一批二返接著的那幾天先存**，暫時 id → 真的 id 記在確認層上（`savedIds`，跨好幾次按「記錄」）；換不到就不接。
- 讀照片的最後一步是 `linkBatchExams()`（一次都接不上 → `noExam`、不預設打勾、「先去約健檢」；**一列一列接**，後面那一列看得到前面那一列先選好的那一次 —— 各看各的話一次健檢、兩列二返會各選同一次、存的時候互相擋住）；**先選好哪一次只有一支**（`onlyOpen()`：讀照片那一下、她自己按一顆的 `pickOption(…, items)`、換一位的 `resolveItem(…, items)` —— 少傳 `items` 就只看資料庫，同一列按一次換一個答案）；她勾起／拿掉一列只重算旗標（`refreshNoExam()`），不動勾與選擇。
- **接的那一次健檢那一天這一次記不進去，二返那一列也先不記、講出來**（`stuckLinks()`）—— 照樣存就是她選好的那一次被安靜地存成沒接上。
- **一次性客人的列**（`guest`／`guestCourseId`／`guestSecond`／`bothSeconds`，後三格也在那三處清）見「一次性客人」那一節（`one-time-guests.md`）

## 照片上的人是 app 裡的哪一位

- 只有 `domain/identify.js` 的 `identifyCustomer()`（名字＋病歷號交叉比對，ADR-0103），**拍 Abovee 與療程單兩個入口共用**。
- `numberOnly`／`conflict`／`ambiguous` 的 `customer` 一律是 null —— **對不上時不自動挑人**，挑一個「最像的」就是把一段時間記到別人身上，而畫面上看起來是認得的。
- **名字對上剛好一位、照片上有號碼、那一位一個號碼都沒有是 `nameNoChart`**（ADR-0160，從 `nameOnly` 分出來）：`customer` 照舊是他，但拍 Abovee **不先勾**（`aboveeImport.js` 的 `unverified()` 擋在 `recognized` 那一層 —— 改狀態、改期、扣法、治療師／診間的預設勾一起管到）、排進要你看、講一句（`chartNoSay()`，兩個確認層共用；療程單那一句是「照常存」）；她勾了（療程單：存了）存的時候順便把號碼記上（`chartNoWrites()`：只寫空著的、換一位的不寫、同一位兩個號碼不寫、寫去掉前面 0 的）。
- **唯一的例外是 `nearName`**（ADR-0128，她：「直接算吻合」）：病歷號對上剛好一位、名字跟他差一個字（`masterData.js` 的 `oneCharOff()`：三個字以上、一樣長；兩個字的不放寬）→ 認得，**而且畫面一定講出來**（`nearNameSay()`，兩個確認層共用 —— 拍 Abovee 走 `aboveeImport.js` 的 `nearSay()`）。
- 病歷號讀 `customer.chartNo`、**還寫成短備註的照樣認**（`chartNosOf()`：那一格排第一、再讀 `CHART_NO_PREFIX` 那幾則，ADR-0160）—— 回傳形狀沒變，`merge.mjs`、月底對帳照舊 import 它

## 主檔的 `aboveeNames`（Abovee 上的寫法）

- **五種主檔都有**：治療師與醫師、課程、器材、營養點滴品項、診間（2026-10-05，abovee-and-master/07），設定頁那一格同一支 `masterList.js` 的 `aliasField()`。
- 比法只有 `masterData.js` 的 `normalizeAlias()`／`hasAlias()` 一份（`identify.js` 也用它）；**同一種主檔裡兩筆不可以同一個寫法**（`aliasErrors()`，五個 validator 共用），跨種不擋、撞到時 `abovee.js` 的 `courseFrom()` 照品項 → 器材 → 課程（越具體越先）。
- `courseFrom()` 的順序（整格原字比寫法 → 拆分鐘比品項／器材／課程 → `三返` → 舊表的 `rowShape()`）寫在它的註解裡，**改順序要回去跑 `tests/abovee.test.js` 那張 353 筆寫法的表**。
- 四步都認不出來才比**差一個字**（`nearFrom()`，ADR-0128：照品項 → 器材 → 課程一種一種數、那一種剛好一筆才算，結果帶 `near` 讓確認層講出來）；`staffFrom()` 也是名字規則都沒人時才拿**她記著的寫法**比差一個字（結尾／開頭那兩條不放寬）；**診間不放寬**。
- 認人先認課程（`staffRoleFor()`）再分角色比 —— 復能那一列不會被姓李的醫師搶走。
- **人名的寫法只活在她的主檔上**（真名不進 repo），其餘的（`高能量`、`雪顏亮采`…）種子預填（`EECP20` 2026-10-18 起不是寫法：拆成 EECP＋20 分 → 體驗，ADR-0154）。
- 拍 Abovee 存檔時由 `aliasWrites()` 寫治療師的（她替認不出的全名選了人之後）；本來就認得的、已經是別人的寫法都不寫。
- 拍訂購單、文宣、療程單**不讀** `aboveeNames`（各自一張對照表）

## 月底對帳 skill 讀的那幾支（`readAbovee()` 每一列的 `kind`／`reason`／`statusChange`／`existing`、`absentFromPhoto()`、`counts()`、`syncBundle()` 額度列的順序）

- `.claude/skills/month-end-reconciliation/scripts/reconcile.mjs` 照它們分類、數次數（2026-10-16）—— 改了形狀或新增一種 `reason` 要回去對它的分類表，`tests/month-end-reconciliation.test.js` 用假資料整支跑一次盯著。
- **它叫 `absentFromPhoto()` 一定傳 `{ everyone: true }`**（一整個月、每一位都要對；不傳就照照片上幾位只對那一兩位，ADR-0153）。
- 那支 skill **只讀 Firebase**（`snapshot.mjs` 把寫入的入口換成丟錯），有真名的東西只在 `.local/references/月底對帳/`
