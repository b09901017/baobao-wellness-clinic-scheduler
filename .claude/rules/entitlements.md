---
paths:
  - "public/js/domain/entitlements.js"
  - "public/js/domain/slotOptions.js"
  - "public/js/domain/purchases.js"
  - "public/js/domain/products.js"
  - "public/js/data/customers.js"
  - "public/js/ui/components/buy.js"
  - "public/js/ui/components/buySheet.js"
  - "public/js/ui/components/planTweak.js"
  - "public/js/ui/components/giftFold.js"
  - "public/js/ui/components/customerForm.js"
  - "public/js/ui/views/customersBulk.js"
---

# 額度、購買、送的／體驗、營養品

**每一節的標題是「改了這個」，底下每一條是「一定要一起檢查」的**（從根目錄 `CLAUDE.md`「容易漏掉的連動」那張表搬來，標題照舊）。
新長出來的連動補進對應的那一節（沒有就加一節）；不屬於這一份的補進別份或開新的一份，並加進根目錄 `CLAUDE.md` 的索引。

## 額度那一排的順序

- **只在 `domain/slotOptions.js` 的 `arrangeSlotOptions()` 排**（2026-10-06，issue 08）：照分類（`masterData.js` 的 `groupByCourse()`）、**不畫小標**（2026-10-07，issue 16：她試完說那一排列的是這位客戶有的，本來就沒幾顆；加購那一排列全部課程，分類照舊 —— 不要加回來）、類裡先額度**照名字**（不照剩幾次 —— 壓表讀快取、編輯器把草稿算進去，兩邊數字不一樣）。
- **送的／體驗那幾顆（`folded`）全部收在最後一顆「送的／體驗…」後面**（ADR-0148，推翻 issue 08 的「類裡再那一類不算次數的課」）：展開之後先預設體驗的課（同一類裡照 `GIFT_FIRST` 的種子 id → 名字，**不靠主檔讀回來的順序** —— Firestore 照文件 id 排，心臟科評估會跑到功醫門診前面；沒有額度的客戶預設的第一門只問 `defaultGiftCourse()`）、再「別的課當體驗」（`giftOptions()` 的 `other`，畫面上分類 → 課程兩步；健檢與二返不列）。
- 要不要一打開就展開只問 `foldOpen()`（沒有任何一顆還有剩的額度、或這一段現在就是送的／體驗）；畫法只在 `ui/components/giftFold.js`（三個入口各自給 `chip(o)`，展開、收回與換分類只改屬性；**開或收記在呼叫端、`foldOpen()` 只是第一次畫的預設**，壓表不重畫所以選了一顆之後叫 `giftFold.sync()`，2026-10-18 staging-polish 03）。
- **二返與 n返 一律最後一組而且另起一行**（`breakBefore`；她 2026-09-24：跟健檢並排一指就約錯 —— 照分類排之後健檢是最後一類，只隔一條線實體上還是隔壁）。
- **三個入口都照它**：壓表（`slotOptionsFor()` 回的就是排好的）、來訪編輯器（自己算剩幾次，順序問同一支；送的／體驗那幾顆問 `giftOptions()`）、拍 Abovee。
- **卡片牆那一排泡泡、客戶清單卡片的前 4 行、待辦中心「壓表登記」那一列是另一個順序**（`customerPools()`，2026-10-08，ADR-0137）：二返最後（`followupsLast()`）→ **有做過或排過的排前面** → 同一組裡快用完的排前面 → 名字。
- 後三層只寫在 `entitlements.js` 的 `poolOrder()`（「有在用」＝`inUse()`：`done + booked > 0`，取消與未到不算），**客戶詳情的額度卡共用同一支**（`sortPools()`：前面先套「還有剩的排前面」、最後套「健檢與二返相鄰」，ADR-0022）—— 改其中一頁的先後就是改 `poolOrder()`，不要在某一支裡另外排。
- **客戶之間「先壓誰」不吃這個順序**：`buildCustomerQueue()` 代表的那一筆額度由 `leadPool()` 自己挑（照舊「剩得少的」），讀 `pools[0]` 的話顯示順序一改排名就跟著動

## 客戶抬頭那一行、「買過什麼」

- **算出來的，不存字**（ADR-0090）：`domain/purchases.js` 的 `purchaseHeadline()`（清單卡片與詳情抬頭共用）與 `purchaseDays()`（「買過什麼」一天一張）。
- **套數是快照** `sourcePlanSets`，只在 `expandPlan()` 寫 —— 三條購買的路都經過它，另外寫一條路沒帶的話那一次購買在抬頭上只剩方案名；沒有快照的舊資料走 `setsOf()`，除不整就不寫 ×N。
- 品名走 `shortItemName()`（`SIS(60)`），**那是第四種名字，只准這三個地方讀**：客戶抬頭、「買過什麼」、試算表的「買過什麼」那一段（`sheetReport.js` 的 `purchaseLines()` 直接吃 `purchaseDays()`，ADR-0115）—— 其他畫面照舊用額度名

## 一筆額度叫什麼

- `domain/entitlements.js` 的 `poolName()` + `timedLabel()`，格式是 `復能-三選一(60)`／`復能-SIS(60)`（**單買一台也帶著課程，後半是器材的全名**，ADR-0078；半形括號、破折號兩邊不留空格）。
- 它跟 `slotName()` 是**兩件事**。
- 改格式要同時補 `legacyPoolNames()`，不然資料健檢的「復能額度還叫舊名字」認不出既有那幾筆，而她自己打的名字**不可以**被一顆按鈕改掉

## 方案的微調

- **三個入口各自一份微調、共用同一張「加一項」**（2026-10-18 過目時查到以前寫的「共用一張」不是真的）：客戶詳情的「加購一整個方案」是 `ui/components/planTweak.js`、新增客戶是 `ui/components/customerForm.js`、批次建立的「微調」面板是 `ui/views/customersBulk.js` 自己的。
- 三處的「＋ 加一項」開的都是 `components/buy.js` 那一張表（`fields()`／`wire()`，見「她賣了什麼給客戶」那一列），長相同一個 `.addrow`／`btn--addrow`（staging-polish 01）—— 改其中一處的次數規則要三處一起看。
- 改次數（0 就是不要那一項）＋ 加一項。
- **範本一個字都不會變**（ADR-0003）。
- 寫入一律走 `data/customers.js` 的 `entitlementWrites()` —— 三條路（加一筆、加一批、建新客戶）同一段身體，另外寫一支的話那幾筆健檢就會少掉二返

## 次數的算法

- `domain/entitlements.js` 的 `counts()`（現算）、`summarize()`（讀快取）、`reconcile()`（對帳）要一起改，見 ADR-0004。
- 「這一段算不算」只寫在同一支的 `slotOutcome()`，見 ADR-0025

## 營養品的形狀或交付

- 一次購買一筆（金額＋好幾款＋幾個月），規則只在 `domain/products.js`，見 ADR-0059。
- **提醒是一筆有日期的隨手記**（所以它自動在日曆的「待辦」那一類，不要開第八種顏色），交付記在額度的 `deliveries[]` —— 隨手記會被她清掉，而那份紀錄要進試算表。
- 四個勾隨手記的入口共用 `ui/components/note.js` 的 `prepareToggle()`。
- **一包只有一筆還沒勾的提醒**：「記一筆」那三個入口（泡泡、首頁那張卡、日曆待辦編輯器的新增）存檔走 `data/notes.js` 的 `createOrMove()` —— 選到「已經約了」的那一包是改那一筆（寫之前照 `entitlementId` 重讀；選了日期才改日期），不是長第二筆（2026-11-07，`.scratch/give-bag-once`；客戶詳情的「約時間」本來就改那一筆）。
- Android 不建營養品的提醒（「給營養品」打開網頁），`NotesWriter` 不抄這一支。
- **提醒掛給誰跟著那一包**：長按選單沒有「掛給誰」（`noteActions()`），日曆的待辦編輯器打開既有的營養品提醒也不畫「掛給誰」、不接打名字跳出客戶、存的時候只送日期（`calendar.js` 的 `bagOwned`；「從日曆拿掉」也不帶客戶那兩格 —— 讀表單會讀到空的、把掛的人清掉）。
- 改掛給別人的話，勾掉時 `prepareToggle()` 讀那一位的額度找不到那一包，「給了什麼？」不問、交付不記（上 main 前最後健檢 A，2026-11-07）—— **新增一個改得到掛給誰的入口要先擋營養品的提醒**

## 「她賣了什麼給客戶」的那張表

- 只寫在 `ui/components/buy.js`。
- **新增一排丸子一定要加進 `DETAIL_CHIPS`** —— 沒加的那一排只有客戶詳情那一張表會跟著改名，另外兩張換了丸子名字不動（「其他…」那一格漏了兩次就是這個形狀）。
- **三個入口共用一份**：客戶詳情的「加購」、新增客戶的「加一項」、批次建立「微調」面板裡的「加一項」——欄位與**接線**（`wire()`）都是同一份，呼叫端只回答「哪一塊要重畫」。
- 多接一次的代價已經付過了：「其他…」那一格漏了兩次。
- **營養品是一筆排不進來訪的額度**（ADR-0057），所以它不可以流進任何「還要排幾次」：閘門在 `domain/entitlements.js` 的 `schedulable()`，用在 `customerPools()`、`summarize()`／`lowRemaining()`、資料健檢的「還沒問這輪方便的時間」（以前叫「資料過期」，只是提醒，ADR-0150）、來訪編輯器的額度丸子。
- 試算表報表刻意**有那一列但不進合計**。
- **預設體驗的課不列**（`courseChips()`：功醫門診、HRV、心臟科評估 —— 2026-10-14 種子勾起心臟科評估，她：「不會需要買」；EECP體驗 那一門 2026-10-18 合成進 EECP，ADR-0154）。
- **「買了什麼」那一排先分類再項目**（2026-10-06）：一類只有一門的那一顆直接就是那一門，兩門以上按了才露出第二排「哪一門」（`buyItem`）；**第二排是選課程不是細節** —— 它跟第一排走同一支 `afterTap()`（→ `pick()`），放進 `DETAIL_CHIPS` 的話換課程時等級、品項、時長都不會重設。
- 開著哪一類是草稿上的 `buyGroup`（同 `tierOther`），`payload()` 是白名單所以存不進去；哪一門在哪一類只問 `masterData.js` 的 `groupCourses()`。
- **換一門課時長不跟著過來**（2026-10-07）：只在 `pick()` 的 `minutesAfterPick()` 算 —— 新的那一門有「幾分鐘」那一排就只收它名單上的數字，沒有那一排而上一顆有就清掉（那個數字是那一排的，不是她在「進階設定」打的）；以前健檢會存成 ILIB 的 60 分，而 `slotMinutes()` 先問額度。
- 已經存成那樣的由資料健檢 `entitlementMinutes` 列出來、**只列不修**（分不出哪幾筆是她自己設的；營養點滴不看 —— 品項排在額度前面）。
- **照那個數字排出去、還開著的段**是下一項 `slotMinutes`（issue 20，同樣只列不修：清掉額度的時長 → 日曆「改這一段」→ 存，`endsAt` 重算）；「哪一筆的時長是錯的」兩項共用 `minutesOff()`

## 送的／體驗、預設體驗的課、「這一段可以做什麼」那一排

- **時段上的 `giftKind`**（`'trial'`／`'gift'`／`null`，ADR-0148）：有值的那一段不扣任何一筆額度（`entitlementId` 一定是 null，**就算身上有那門課的額度**）。
- **任何課都可以，健檢與二返除外** —— 判斷只有 `masterData.js` 的 `canBeGift()`，**讀只有 `giftKindOf()`**（有那一格照那一格、`null` 也算；沒有那一格的舊資料：沒有額度、不是 n返、課程勾了預設體驗 → 體驗）。
- **存起來，不推導**：`data/visits.js` 的 `save()` 每次都 `withGiftKinds()` 寫實；不經過 `save()` 的寫入（匯入）自己寫。
- **EECP 只有一門**（ADR-0154，2026-10-18）：「EECP體驗」那一門從種子刪了，體驗是約的時候按 20；既有資料庫上那一門由資料健檢最後一項收掉。
- **來訪編輯器把既有那一段的扣法改了（扣額度 ⇔ 體驗）是原地改**（她選的：不取消、不長「取消 Abovee」），存檔前那一道是 `consequences.js` 的 `chargeSwitchConsequences()`（拿 `counts()` 試算、講 Abovee 上記得改成 EECP20）。
- 課程上的 `uncounted`（設定頁的字「**預設體驗**」，2026-10-14 以前叫「不算次數」，ADR-0121）只剩「按那門課那一顆就是體驗」，判斷只有 `isUncounted()`；**它是「可以不用額度就排」，不是「不准有額度」**：有額度的照舊扣、照舊驗 —— 寫成「勾了又指了額度就擋」的話，她一勾營養諮詢既有每一段與方案範本都存不下去。
- **那一排有哪幾顆只寫在 `domain/slotOptions.js`**：`slotOptionsFor()`（額度／＋n返／送的／體驗）、`giftOptions()`（預設體驗的課與有「體驗的時候排幾分」的課在第一排＋「別的課當體驗」）、`defaultGiftCourse()`（只挑預設體驗的課）、`foldOpen()`；**按「排多久」換成體驗只有 `trialFromMinutes()`**（ADR-0154：扣著那門課額度的段按了 `trialMinutes` → 那門課的體驗；三個入口都叫它：壓表 `[data-minutes]`、來訪編輯器 `readDraft()`、拍 Abovee `pickMinutes()`；反過來不自動）；`NTH_PICK` 與 `giftPick()` 是那一排上的值，不是額度的 id（`giftCourseIdOf()` 讀回來）。
- **組那一段走 `slotFromPicks()` 的 `giftCourseId` ＋ `giftKind`**，來訪編輯器的 `readFreeSlot()` 也是 —— 不在畫面裡重組一次。
- 時長選得到 `minuteChoicesFor()`（送的／體驗多認 `durationChoices`：IN 30 體驗是 30）、器材 `equipmentChoicesFor()`。
- **待辦與療程單照那門課自己的設定**（體驗的 IN 30 照樣要簽）。
- **試算表上那一段的記一句印在來訪紀錄那一行**（格式 7）。
- **確認框跟次數有關的三句只數扣著額度的段**（`consequences.js`：新增的 `giftNames()`、結案的 `charged`、取消的 `refund`；n返 同一條）。
- 判準：**這一行會不會讓一段送的／體驗被算進某一筆額度，或反過來？** 合併檔 v7 帶 `giftKind`（見「舊表 B2」那一節（`import.md`））；補登（`backfill.js`）還只認額度

## 營養品的名字或金額

- `components/buy.js` 的 `commitNewProduct()` 是**存檔前唯一補名字的地方**（三個入口都經過它：客戶詳情、`buySheet.js`、批次建立的 `addBuy()`），**驗證也在裡面、而且排在建主檔之前**（2026-10-07：回 `{ draft, errors }`，呼叫端不自己再 `validate()` 一次）—— 順序是補名字 →「＋新增…」那一款先當成已經在裡面、名字用 `retitle()` 重算（她自己打過的不蓋）→ 驗證 → 過了才 `createProduct()`。
- 反過來的話驗證沒過主檔照樣多一筆、名字少一款、只打新的一款時「額度名稱不可空白」；讀的那一側 `itemsOf(e, master)` 要能從主檔認回舊資料的空名字。
- 名字沒了會**同時**弄壞三個東西：顯示名稱、提醒那一句（變成「營養品：營養品」）與交付面板（整片空白）。
- 金額那一格不可以有倍數限制（`step` 要是 1），整數那一條由 `firestore.rules` 定
