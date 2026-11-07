---
paths:
  - "public/js/domain/oneTimeChain.js"
  - "public/js/ui/components/guestForm.js"
  - "public/js/domain/customers.js"
  - "public/js/domain/scheduling.js"
---

# 一次性客人

**每一節的標題是「改了這個」，底下每一條是「一定要一起檢查」的**（從根目錄 `CLAUDE.md`「容易漏掉的連動」那張表搬來，標題照舊）。
新長出來的連動補進對應的那一節（沒有就加一節）；不屬於這一份的補進別份或開新的一份，並加進根目錄 `CLAUDE.md` 的索引。

## 一次性客人（`customer.oneTime`、`slot.oneTime`）

- **不是她客人的人也記得進來**（ADR-0172，2026-11-05）：一份**不在任何名單上的客戶文件**（`oneTime: true`；名字卡只露既有的 `name`／`chartNo`／`phone`／`lineId`／`flags`），他約的每一段標 `oneTime: true`（`entitlementId`、`giftKind` 都是 null，不扣、不進試算表）。
- **讀只走 `masterData.js` 的 `isOneTime()`（客人）與 `isOneTimeSlot()`（段）**，都只認 `=== true`、永遠不從形狀推；畫面從 `customers.js` import（`isOneTime` 住在 `masterData.js` 是為了不繞成一圈）—— `tests/one-time-guest.test.js` 掃全站沒有別處讀 `.oneTime`。
- 一般客戶與一般的段**沒有這一格**；轉成我的客戶寫 `oneTime: false`（`toMyCustomer()`；`deleteField` 進不了稽核那一筆），**以前的段照舊帶著**。
- 建名字卡走 `oneTimeCustomer()` ＋ `createWithPlan(…, { plan: null, quantity: 0, extras: [] })`（日曆 `newGuest()`、拍 Abovee `createGuest()`），表單只有 `ui/components/guestForm.js` 的 `mountGuestForm()`（`quick` 是名字、病歷號、電話）。
- **名單一處一處明寫排除，不靠沒有額度**：客戶清單三份互斥（`inCustomerList()`）、`scheduling.js` 五支（壓表佇列、問時間兩支、壓表登記、時段反查）與 `batchRows()`、看這個月的進度（`ui/views/progress.js` 那一行，**刻意不放進 `buildProgress()`** —— 名字卡那一頁要畫他）、長備註「寫給誰」、手動貼上挑人那一排、**拍訂購單的同名比對**（`orderForm.js` 的 `sameNameCustomers()`：沒有「加購到他」那一顆，名字旁邊講 `guestSameNameSay()`）、資料健檢的 `checkStaleAvailability()`；試算表兩條路（`syncBundle()`、`customerReport()`）客戶跳過 `isOneTime()`、來訪先過 `sheetVisits()`（一次性的段拿掉、混著的那一天整筆狀態重推）、待辦 `guestTask()`。
- **新增一份會列客戶的名單要回來想他列不列。****健檢→二返那一串一個字都不改**：算的時候替他生一對**只在記憶體裡**的額度（`domain/oneTimeChain.js` 的 `withOneTimeChain()`，id 是 `oneTime:` 開頭 —— `isOneTimeEntitlementId()`；健檢那一筆的次數＝還算數的一次性健檢段數，**一次健檢欠一場二返**），鏈的函式進來自己套、回給呼叫端的換回原本那一份（`originalOf()`）；**絕不存**：`data/visits.js` 的 `countOps()` 一進來先問 `assertNoOneTimeIds()`。
- 叫鏈之前先問「有沒有真的二返額度」就收手的那幾處改問 `hasOneTimeSlots()`（讀之前，寬）／`hasFollowupChain()`（算的時候）；`chainInputs()` 收第三個參數（這位客戶的來訪，連要存的那一筆）—— `tests/one-time-chain-callers.test.js` 掃每一處都傳；`cannotClose()`／`closeBlocks()` 要給 `coursesById` 才認得他。
- 一次性的二返**一定要接一次健檢（他的一次性健檢）或是 `examNotMine`**（`slotFromPicks()` 擋、`validateVisit()` 的 `oneTimeErrors()` 再擋 —— 沒有額度可以照位置配）；接哪一次問 `followups.js` 的 `oneTimeExamChoices()`（拍 Abovee 是 `aboveeImport.js` 的 `guestExamChoices()`，連同這一張照片）；**接在一次性健檢上的 n返 也標一次性**，`slotFromPicks()` 與來訪編輯器的 `readNthSlot()` 兩處判，都問 `isOneTimeExamVisit()`，`validateVisit()` 擋標法跟接的那一次對不上的。
- 「做什麼」那一排：一次性客人是 `slotOptions.js` 的 `guestOptions()`（全部的課、先分類再項目、「其他 ▸」留「＋ n返」與「健檢不是我排的」、**沒有送的／體驗**，值 `guestPick()`／`guestCourseIdOf()`，畫法 `giftFold.coursesHtml()`）；轉成我的客戶之後多一顆「二返（一次性那一次）」（`oneTimeSecondOptions()`、`ONE_TIME_SECOND_PICK`、`isOneTimeSecond`，有 `oneTimeOwed()` 才有），來訪編輯器、壓表、拍 Abovee 三個入口都認。
- **入口只有日曆新增與拍 Abovee**（「記成一次性客人」她按了才建，`recordGuestOnPhoto()`；**不看預約來源猜**），壓表不做。
- 讀取卡片最上面「一次性」畫在 `visitReadHtml()` 裡、找人的框標 `.guestmark`；日曆那一格、待辦那一列不標，段的名字不加尾巴。
- 「約二返」那一張的「去壓表」對他換成「去日曆排」——**轉成我的客戶之後、接的是一次性那一次的健檢也是**；判斷只有 `nthFollowup.js` 的 `followupGoesToCalendar()`（`home.js` 的 `labelGuestBookings()`／`bookFollowup()` 共用）。
- **一次性客人身上每一段都要標一次性**（`validateVisit()`，扣著真的額度也擋；來訪編輯器不拿額度當預設）；建名字卡與轉成我的客戶都沒有復原。
- 轉成客戶的確認框句子在 `consequences.js` 的 `toMyCustomerConsequences()`；新增客戶打到同名的一次性客人講 `GUEST_SAME_NAME`（**批次建立也是**：`bulkCustomers.js` 的 `duplicatesOf()` 把他另外數成 `guests`、不算「已經有 N 位」，那一句只走 `duplicateSay()`）。
- 月底對帳：有名字卡就是認得（`identifyCustomer()` 的池子含他），一次性的段不拿去比次數（`reconcile.mjs` 的 `guestSlot()`／`guestItem()`）。
- 判準：**這一行會不會讓一位一般客戶或一段沒有標記的段被放寬、被藏起來，或讓一次性的段被算進任何一筆真的額度、出現在試算表上？**
