# 06：日曆新增「要幫誰排？」、來訪編輯器與壓表的「做什麼」、讀取卡片的「一次性」、「約二返」那一張的按鈕

Status: done
Blocked by: 01、02、03、05（名字卡的表單元件）

## 動工前先讀

- spec.md「談定的」第 4、5 題與「我判斷的細節」（「做什麼」那一排、轉成客戶之後還欠的那一場）
- `CLAUDE.md` 連動表：「新增一個會建立時段的入口」「額度那一排的順序」（`giftFold`）「一筆來訪的讀取卡片」「打字找客戶的框」「健檢不是我排的」「一句『按下去會發生什麼』」那幾列
- `public/js/ui/views/calendar.js`：`pickCustomer()`（`:1860-1915`，「沒有這個人。」`:1898`）、`visitReadHtml()`（已經收 `data.customer`）、`fromLine()`（`:1737-1741`）
- `public/js/ui/views/visitEditor.js`：`boot`（`:136-152`）、**沒有額度的客戶第一段預設送的／體驗**（`:227-229`，ADR-0121）、`examField`（`:857`）、`readDraft()`／`readFreeSlot()`
- `public/js/ui/views/schedule.js`：`examChoicesOf`（`:1841-1857`，只認真的額度）
- `public/js/ui/views/home.js`：「約二返」那一張的「去壓表」（`:1211-1216`、`:2212` → `bookFollowup` `:2685-2715` → 壓表 `openPending`）
- `public/js/domain/slotOptions.js`、`ui/components/giftFold.js`、`masterData.js` 的 `groupCourses()`

## 她要的

> 一樣寫說他做了什麼跟哪一個診間……跟哪個醫生

> 只是我還是需要在日曆上看到他們的來訪，知道今天有哪些人

第 4 題：日曆新增「要幫誰排？」打名字找不到時多一顆「＋ 新增一次性客人『X』」→ 名字卡（名字帶好）→ 接著排；找得到時那一列標「一次性」；
「做什麼」那一排列全部的課（先分類再項目，同加購那一排），不扣任何東西；**壓表不做**。
第 5 題：讀取卡片的名字旁邊標「一次性」（小灰字）；日曆那一格、待辦那一列不標；讀取卡片「扣 X／沒扣 X」那一行一次性的段不畫。

## 為什麼會這樣

- `pickCustomer()` 只列客戶清單、找不到就「沒有這個人。」，沒有建人的路
- 來訪編輯器的「做什麼」那一排是這位客戶的額度＋「送的／體驗／其他…」；沒有額度的客戶第一段**預設成送的／體驗**（`:227-229`）—— 一次性客人照這個預設，存檔會被 01 的「一次性客人的段要標成一次性」擋下來
- 讀取卡片 `fromLine()` 沒有 `entitlementId` 就回空字串 —— **一次性的段本來就不畫「扣／沒扣」**，不用改，測試釘住就好（過目 7）
- 讀取卡片的抬頭（名字）是**五個呼叫端各自給**（`calendar.js:944`、`customerDetail.js:2037`、`home.js:1368/2567`、`progress.js:357`）—— 「一次性」小標畫在 `visitReadHtml()` 裡（它已經收 `data.customer`），不要五處各加一次
- 「約二返」那一張的按鈕帶她去壓表（`bookFollowup`）—— 一次性客人不在壓表上，按了是死路（過目 5）

## 要做的

- **「要幫誰排？」**：一次性客人那一列標「一次性」；打了字、一位都找不到 → 「＋ 新增一次性客人『X』」：05 的快速表單（名字帶好、病歷號、電話）→ 存（01 的 `oneTimeCustomer()`）→ 接著 `mountNew()`
- **來訪編輯器，一次性客人（還沒轉）**：
  - **不走 `:227-229` 的送的／體驗預設**；「做什麼」那一排＝全部的課、照分類（`groupCourses()`）；選了一門 → `slotFromPicks({ oneTime: true, courseId, … })`
  - 二返 → 「這是哪一次健檢的」那一排列他的一次性健檢（02 的 `oneTimeExamChoices()`）；沒有可以接的 → 那一排講一句、指她按「健檢不是我排的」
  - 「其他 ▸」裡留「健檢不是我排的」與「＋ n返」；「送的／體驗」不列
  - 器材、診間、醫師、時長照那門課自己的設定（`assignsFor()`、`equipmentChoicesFor()`、`doctorChoicesFor()`、`slotMinutes()` 都走既有的）
  - 確認框（`bookingConsequences()`）：不講任何次數；「會多一張 X」照舊
- **轉成客戶之後**：「做什麼」那一排照一般客戶，**多一顆「二返（一次性那一次）」**（02 那一支，`owed > 0` 才有）—— **來訪編輯器與壓表兩個入口都接**（壓表的 `examChoicesOf` `:1841-1857` 要認那一顆；拍 Abovee 在 07）
- **讀取卡片**：客人是一次性的 → 名字旁邊「一次性」小灰字，畫在 `visitReadHtml()` 裡（四頁共用，`data.customer` 沒帶的那幾個呼叫端照 CLAUDE.md「一筆來訪的讀取卡片」那一列走 `fillMirror()`）
- **「約二返」那一張**（待辦中心與依客戶抽屜）：客人是一次性的 → 按鈕換成「去日曆排」，打開日曆新增、預選這位客人（同 `leaveFor()`／`takeFor()` 那一套，CLAUDE.md「從一頁帶人到另一頁」那一列）
- **其餘找人的框標「一次性」**：批次取消（`bulkCancel.js`）、隨手記「掛給誰」（`note.js:720` 那一份）—— 兩個都本來就列得到他，只是加標
- `public/` 有動：照 HANDOFF「共同的規矩」升 `VERSION`、新檔案進 `sw.js` 的 `SHELL` 與 `tests-e2e/related.js`

## 判準（domain 的是單元測試、畫面的是 E2E）

- 一般客戶的「要幫誰排？」、來訪編輯器（含沒有額度的客戶預設送的／體驗那條路）、壓表、讀取卡片、「約二返」的按鈕，跟改之前一模一樣嗎？
- 打一個沒有的名字 → 那一顆出來？建好之後排得進一段健檢、存得下去，日曆上看得到、待辦照長（掛號）？
- 一次性客人的二返沒接健檢、也沒按「健檢不是我排的」→ 存得下去嗎？（不可以，句子講得出要她做什麼）
- 一次性客人的「做什麼」那一排有沒有「送的／體驗」？（沒有）有沒有全部的課？
- 讀取卡片：從日曆、待辦中心、名字卡那一頁打開，一次性客人名字旁邊都有「一次性」？一次性的段沒有「扣／沒扣」那一行？（進度追蹤不列一次性客人，04）
- 一次性客人的「約二返」→ 按鈕帶到日曆新增、他已經選好？
- 轉成客戶、又買了額度：「二返（一次性那一次）」只在還欠的時候出來（編輯器與壓表）？按了存下去的段帶 `oneTime`、不扣他買的二返額度？

## 做完時留下的

段三（2026-11-05）。測試在 `tests/one-time-guest-booking.test.js`（14 條）與 E2E `95-one-time-guest-booking`（7 支：B1–B7，本機跑過全綠；`83`、`67`、`94` 一起跑過）。

- **domain**（`slotOptions.js`）：`guestOptions(courses, { keep, notMineKeep, nthExams })`（全部還在用的課照分類、`isGuest`＋`group`；「其他 ▸」＝`extra`：＋ n返（有接得上的健檢）、健檢不是我排的）、
  `guestPick(courseId)`／`guestCourseIdOf(value)`（那一排上的值，前綴 `__guest__:`）。`trialFromMinutes()` 不換一次性的那一顆（07 的拍 Abovee `pickMinutes()` 也叫它）
- **畫法**：`giftFold.coursesHtml({ options, value, chip, key, sm })` —— 分類 → 課程兩步與「其他 ▸」借 `giftFold` 那一套（`data-giftfold-group`／`data-giftfold-in`，`toggle()` 不重畫），外層 `[data-guestpicks]`。**07 拍 Abovee 照它畫**（自己給 `chip(o)`）
- **來訪編輯器**（`visitEditor.js`）：
  - 一次性客人（`isOneTime(ctx.customer)`）：`blankVisit()`／`withNewSlot()` 不走送的／體驗預設，第一段是 `{ oneTime: true, courseId: null }`；「做什麼」那一排是 `guestRow()`（`[data-guestpicks]`、`[data-chip="s${i}-ent"][data-chip-value="__guest__:<課程>"]`）
  - 讀回來：`guestValueOf()`（那一段在那一排上是哪一顆）→ `readGuestSlot()` → `slotFromPicks({ oneTime: true, courseId, followupForVisitId, … })`。組不出來（二返還沒接）時時長照那門課算（不留上一段的 60，E2E B3 釘著）
  - 一次性的二返「這是哪一次健檢的」：`guestExamField()`（`[data-chip="s${i}-gexam"]`，`oneTimeExamChoices()`）；接不上 → `[data-guestexam-none]` 那一句（`fieldgroup__empty`，不收進 `tip()`：會擋存檔）
  - 一次性客人的「健檢不是我排的」：`readNotMineSlot()` 交 `oneTime: guest`；n返：`readNthSlot()` 照 `isOneTimeExamVisit()` 標（這一條路自己組、不經過 `slotFromPicks()`）
  - **轉成我的客戶之後**：一般的那一排多 `secondOptionsFor()` —— 「二返（一次性那一次）」（`oneTimeSecondOptions()`，算的時候把這一張表單上的其他段也算進去；這一段現在就是它的話照樣列）、以前那一段一次性的段那一顆（`課程（一次性）`）。值 `__onetime2nd__` → `secondCourseOf()` → `readGuestSlot()`
- **壓表**（`schedule.js`）：`examChoicesOf()` 認 `picked.isOneTimeSecond` → `oneTimeExamChoices()`（只有一次就先選好，`pickExamIfObvious()` 照舊）；`addSlot()` 交 `oneTime`＋`courseId`。選擇器：`[data-ent="__onetime2nd__"]`、`[data-exam="<健檢那一天的來訪 id>"]`
- **日曆新增**（`calendar.js`）：`pickCustomer()` 一次性客人那一列 `.guestmark`；打了字一位都找不到 → `[data-new-guest]`「＋ 新增一次性客人『X』」→ `newGuest()`：`mountGuestForm({ quick: true })` → `createWithPlan(oneTimeCustomer(card), { plan: null, quantity: 0, extras: [] })`（key `customer:create-guest`）→ `mountEditor()` 接著排
- **讀取卡片**：`visitReadHtml()` 最上面 `.readguest .guestmark`「一次性」（問 `isOneTime(data.customer)`；`data.customer` 沒帶的那幾頁 `fillMirror()` 補讀之後重畫）。**抬頭（名字）是呼叫端給的，所以那一格在抬頭底下、卡片內容最上面** —— 不是貼在名字旁邊同一行。「扣／沒扣」那一行本來就不畫（E2E B4 釘著）
- **「約二返」**（`home.js`）：`labelGuestBookings()` 畫完讀一次客戶、一次性客人那幾顆換成「去日曆排」（`data-guest="true"`）；`bookFollowup()` 自己再問一次 —— 一次性客人 `leaveFor('calendar/new', { customerId, date })` → 日曆 `render()` 的 `takeFor('calendar/new')` 打開新增、他已經選好
- **找人的框**：批次取消（`bulkCancel.js`）、隨手記「掛給誰」兩排（`note.js` 的 `guestTag()`）標 `.guestmark`
- `sw.js` v289（05 是 v288）；spec `95` 進 `related.js`；`tests/visit-editor.test.js` 那一條 `withNewSlot(...)` 的比對多認一格 `isOneTime(customer)`
- **沒做的**：編輯器第一列（名字＋狀態那一列）沒標「一次性」（spec 沒要）；`chainInputs()` 沒有新的呼叫端（日曆新增走既有的來訪編輯器，03 已經傳三個參數）

### 手動驗收（她照順序點；在本機模擬器 `npm run emulators` ＋ `seed:staging`，或 staging 只看不寫）

1. 客戶 → 捲到最底下：看到「看已停用的」「看一次性客人」兩顆一行（`[data-listlinks]`）；標題那一行只有「看這個月的進度」「長備註」
2. 日曆 → 點今天那一格 → 右上「＋」→ 來訪 → 「要幫誰排？」打一個沒有的名字（例：客戶C）→ 按「＋ 新增一次性客人『客戶C』」→ 名字帶好、填病歷號 → 「建立，接著排」
3. 接著排的那一張：「做什麼」那一排是全部的課（醫師門診、運動區那幾類點了才露出裡面的課）、**沒有「送的／體驗／其他…」** → 按「健檢」→ 記錄這次來訪 → 確認框按「已確認，記錄」
4. 日曆上那一格看得到客戶C → 點那一列 → 讀取卡片最上面一小格「一次性」、沒有「扣」那一行
5. 客戶 → 最底下「看一次性客人」→ 只有客戶C（名字旁邊「一次性」）→ 點進去：名字卡、來訪紀錄那一列點得開；**沒有**加購、額度、LINE 訊息、停用
6. 名字卡那一頁 → 「編輯」→ 改電話 → 儲存
7. 日曆 → 點**明天**那一格（同一天會併進第 3 步那一筆，接不上自己那一天的健檢）→ ＋ → 來訪 → 客戶C → 醫師門診 ▾ → 二返 → 「這是哪一次健檢的」那一排列著第 3 步那一天 → 按它 → 記錄
8. （有健檢做完之後才有）待辦 → 「約二返」那一列的按鈕寫「去日曆排」→ 按 → 日曆新增、客戶C 已經選好
9. 名字卡那一頁最底下「轉成我的客戶」→ 確認框講會上清單、要先加購、以前的段照舊算一次性 → 轉 → 變成一般客戶詳情、客戶清單平常那一份看得到他
10. 客戶 → 新增一位 → 名字打一位一次性客人的名字 → 姓名旁邊 ⚠ 與存檔前那一道講「有一位同名的一次性客人…『看一次性客人』…『轉成我的客戶』」
