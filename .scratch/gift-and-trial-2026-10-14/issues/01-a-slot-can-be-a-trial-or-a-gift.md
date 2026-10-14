# 核心（domain）：一段可以是「體驗」或「送的」—— 存在那一段身上、任何課（健檢與二返除外）、不扣任何額度

Status: todo
Blocked by: —（第一支）
動工前先讀：`spec.md`「談定的策略」前兩節；ADR-0121（不算次數的課）、ADR-0063（n返 不是額度）、ADR-0122（約的時候選的時長）、ADR-0075（器材決定課程）；
`domain/visits.js` 的 `visitErrors()`（「要選一個額度」那一行）、`slotMinutes()`／`slotMinutesField()`、`picksEquipment()`、`courseForEquipment()`；
`domain/slotDraft.js`；`domain/naming.js` 檔頭 import 那兩行與 :137 的註解（為什麼它不 import `visits.js`）；`data/visits.js` 的 `save()`

**這一支只做 domain，畫面那三個入口是 02。** 判準全部在 domain 層驗（`slotFromPicks()`／`validateVisit()`／`counts()`／`slotName()`）——
畫面上「別的課當體驗」那一顆要到 04 才有。

## 她要的

> 那能不能把HRV和心臟門診都和EECP 體驗都變成不算次數，畢竟這個都是送，或是體驗的的不會需要買，就是如果有標註體驗的就直接送不算次數，就不會被沒有額度檔，畢竟是送的，但是來訪以及試算表還是要標註(送的)、(體驗)

第一段她選的：

> 任何課都能標（健檢、二返除外。IN 30、SIS 30、復健門診的體驗也直接標，不用先加送的額度；就算他身上有買那門課也不扣）

> 四門都寫體驗

## 為什麼會這樣

- 沒有額度的段只有兩種放行（`visits.js` `visitErrors()`）：n返、課程勾了不算次數。其餘一律「要選一個額度」。
  所以一段 IN 30 體驗、一段沒買過的心臟門診都存不下去 —— 切換那天只好替每一位加一筆「送的」額度。
- 「這一段不扣」是**推導的**（`!slot.entitlementId && isUncounted(course)`）。課程的勾一拿掉，既有那幾段下一次存檔就被擋。
- 一段身上沒有任何地方記「這是體驗／送的」，所以來訪與試算表都印不出來。

## 要做的

### 1. 那一格與它的讀法

- 時段多一格 **`giftKind`：`'trial'`（體驗）／`'gift'`（送的）／`null`**。沒有值一律寫 `null`，不寫 `undefined`（Firestore 不收，`public/js` 沒開 `ignoreUndefinedProperties`）。
  （不叫 `free`：`bookingConsequences()` 的 `free` 已經是「不用壓的段」，來訪編輯器也有 `freeCourseOf()`、`readFreeSlot()`，同一個字兩種意思會讀混。）
- **讀一律走一支 `giftKindOf(slot, coursesById)`**：有值照值；沒有那一格、沒有額度、不是 n返、課程勾了不算次數 → `'trial'`（舊資料的退路，同 `slotStatus()`）；其餘 `null`。
  **放在不會繞出循環 import 的地方**：`naming.js` 要問它（舊資料的名字），而 `visits.js` 已經 import `naming.js` —— 放 `masterData.js`（跟 `isUncounted()` 一起）或一支沒有其他依賴的新檔；
  「是不是 n返」照 `naming.js` 的做法直接看 `followupNth` 那一格，不 import `nthFollowup.js`
- **「健檢與二返不可以」只有一支**（`canBeGift(course, courses)` 之類）：健檢＝有 `followupCourseId`、二返＝是某一門課的 `followupCourseId`（`followups.js` 的 `followupCourseIdOf()`／`isFollowupCourse()` 是現成的判法；
  `followups.js` import `visits.js`，所以這一支也要放在 `visits.js` 讀得到、又不繞圈的地方）。驗證、組時段、04 的名單、06、08 全部問它

### 2. 驗證（`visitErrors()`）

- `giftKindOf()` 有值 → 不要額度。帶著 `entitlementId` 或 `followupNth` → 擋（兩種身分只能挑一種，同 n返 那一條）
- `canBeGift()` 是 false → 擋，句子講「健檢與二返沒有體驗或送的 —— 加約走 n返」
- 「要選一個額度」只剩：不是 n返、`giftKindOf()` 是 null
- `giftKind` 不是那三個值 → 擋

### 3. 組時段（`slotFromPicks()`）

- `uncountedCourseId` 換成 **`giftCourseId` ＋ `giftKind`**（預設 `'trial'`）。**不再要求那門課勾了不算次數**，只問 `canBeGift()`
- **擇一池那門課（復能）照器材重推課程**：`courseForEquipment()`，而且器材要屬於那門課 —— 現在的不扣次數那一條（`slotDraft.js:85-90`）不重推，存得出「課程是復能、器材是 ILIB、指派治療師」
- `slotOptions.js` 的 `uncountedPick()`／`uncountedCourseIdOf()` 改名成 `giftPick()`／`giftCourseIdOf()`（02 改呼叫端）

### 4. 選得到哪幾台、哪幾個分鐘（三個入口都畫它們，02 接）

- **`equipmentChoicesFor(entitlement, course, equipment)`**：有擇一池額度照池；沒有額度就是 `equipment.courseId === 課程` 的那幾台（還在用的）。
  現在壓表 `equipmentOptionsFor()`（`schedule.js:1587-1592`）與編輯器 `equipmentField()`（`visitEditor.js:837-843`）沒有額度時列**全部器材**（ILIB 也在），拍 Abovee 只有擇一池才畫那一排（`aboveeConfirm.js:521-525`）
- **`minuteChoicesFor({ entitlement, course, giftKind })`**：送的／體驗的段＝那門課的 `bookingMinutes` ∪ `durationChoices`；其餘照舊只有 `bookingMinutes`
- `slotMinutes()`／`slotMinutesField()` 第一層改問 `minuteChoicesFor()`（多收 `giftKind`）。呼叫端都要多傳那一格：`slotDraft.js:110-112`、`schedule.js:1390`、`aboveeConfirm.js:555`、
  編輯器 `blankSlot()`／`readDraft()`、`mergeImport.js:607`、`health.js:996`。**不改 `durationChoicesOf()`**（CLAUDE.md「一段來訪要排多久」講了為什麼）。
  產檔那側 `merge.mjs:1283-1287` 的 `endOf()` 是第二份，順序要一樣（合併檔帶 `giftKind` 是 08 的事；這裡先讓兩份規則一樣）

### 5. 名字（`slotName()`）

- `short` 後面接 `(體驗)`／`(送的)`；`line`（貼給客人的，`messages.js` 那三處）**不加**。n返 讀快照那一條路不會有 `giftKind`，但別讓那條路先 return 掉別的情況
- **`short` 用的地方都會跟著帶**：月曆、日／週那一列、讀取卡片、來訪編輯器抬頭，還有待辦那一行（`todoFlow.js` 經 `visitCourseLabel()` → 待辦中心、客戶詳情、試算表 TODO／FINISHED）、
  提醒句 `slotSay()`、撞期句、稽核句、拍 Abovee「沒拍到／搬了時間」那幾句、進度追蹤、批次取消。**決定：都帶**（她要的是「來訪要標註」，一處帶一處不帶她會以為是兩種東西）；
  釘著字串的測試跟著改

### 6. 確認框（`consequences.js` 的 `uncountedNames()` 與那兩句）

講體驗／送的、不扣，例：「心臟科評估(體驗) —— 客戶身上的數字一個都不會變」。數的是 `giftKindOf()` 有值的段。
結案「做了的 N 段扣掉次數」、取消「次數也會還回來」照舊只數扣著額度的段（應該已經對，要驗）

### 7. 存檔時寫實（舊資料）

`save()` 補空格那個路口（`data/visits.js:156`，`withSlotNotes(withSlotStatuses(...))`）把退路讀出來的寫實。**那裡手上沒有課程主檔**（課程要到 `taskOps()` 才讀，:228-231）——
把讀課程往前搬、或由呼叫端傳進來，二選一寫進「做完時留下的」。匯入的 `importPlan()`（`data/legacyImport.js:80-95`）不走 `save()`：那一條靠 08 在 `planForCustomer()` 寫好。

（稽核那一側不用動：`changedFields()` 只比最上層的鍵，`giftKind` 在 `slots` 裡，稽核上照舊是「時段」那一格變了。）

## 判準

- **這一行會不會讓一段送的／體驗被算進某一筆額度，或反過來？**（ADR-0121 那一句的延伸）
- `slotFromPicks({ giftCourseId: 復能, giftKind: 'trial', equipmentId: INDIBA, minutes: 30 })`，客戶身上有 復能-三選一(30) 剩 5：
  `entitlementId` null、課程復能、器材 INDIBA、`endsAt` 是 30 分後；`counts()` 那一筆還是剩 5
- 同上但 `equipmentId: ILIB`：課程推成 ILIB、指派診間 —— 或者擋下來（ILIB 不屬於復能）；**不可以**存成「復能＋ILIB＋治療師」
- 一段扣著額度的復能，改成 `giftKind: 'trial'`（`entitlementId` 清掉）：那筆額度的 `counts()` 多一次剩的；反過來也對
- 健檢、二返帶 `giftKind`：`validateVisit()` 擋、句子講得出為什麼
- 帶著 `giftKind` 又帶著 `entitlementId`：擋
- 舊資料：沒有 `giftKind`、功醫門診、沒有額度 → `giftKindOf()` 是 `'trial'`、`slotName()` 是 `功醫門診(體驗)`；存過一次之後那一格寫實了；
  寫實之後把功醫門診的「不算次數」拿掉，那一段照樣過 `validateVisit()`
- `slotName(…, 'line')` 沒有括號
- `minuteChoicesFor()`：體驗的復能 → [30, 60]；扣額度的復能 → []；二返 → [30, 60]（`bookingMinutes`，不變）

## 也要一起看的

- 單元測試裡寫死 `uncountedPick`、`uncountedCourseId`、`（不算次數）`、`不算次數 ——` 的那幾支
- 舊資料退路的代價（她在舊的那幾段被存過之前就把某門課的勾拿掉，名字與驗證會跟著翻）：正式站切換那天整份重匯、合併檔 v7 帶著那一格，所以只剩 staging；09 的 ADR 寫明接受
