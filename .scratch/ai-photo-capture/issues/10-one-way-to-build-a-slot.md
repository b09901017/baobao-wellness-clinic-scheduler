# 組一段時段只有一支

Status: done
來源：`../spec.md`（13 的前置）
動工前先讀：`ui/views/schedule.js:2051` 的 `addSlot()`（組時段在 `:2093`）、同一支的 `courseOptions()`（`:1453`）、
`effectiveCourse()`（`:1560`）、`pickedMinutes()`（`:1335`）、`sameDayVisit()`（`:1792`）；
`domain/visits.js` 的 `assignsFor()`、`courseForEquipment()`（`:1239`）、`slotMinutes()`（`:1185`）、
`sameDayVisitFor()`（`:227`）、`withExtraSlot()`（`:310`）、`INITIAL_STATUS`（`:46`）；`domain/nthFollowup.js` 的 `nthSlotFields()`；
`ui/views/visitEditor.js` 的 `blankSlot()`（`:203`）；CLAUDE.md「新增一個會建立時段的入口」那一列

**這是純重構：壓表那一頁的行為一個像素都不變。** 單獨一支 PR，E2E 盯著。

## 她要的（原話）

> 第四 : 拍壓表的電腦畫面（Abovee）→ 一口氣新增很多來訪

（這一支是那件事的前置，她沒有直接講到它。）

## 為什麼會這樣

「一段時段長什麼樣」現在**寫在壓表的畫面裡**：`addSlot()` 從 `view` 讀她按了哪幾顆，
在 `:2066`～`:2116` 之間依序問 `effectiveCourse()`、`assignsFor()`、`nthSlotFields()`、`pickedMinutes()`，
然後把 `view.roomKey` 拆成 `roomId|bed`，組出一個物件。

13 是第三個會建立時段的入口，而且一次建十幾段。照抄一份的話，CLAUDE.md 那張表上
「兩個入口共用」的每一列（課程由器材決定、指派誰、n返清乾淨、營養點滴時長、新段自己寫 `INITIAL_STATUS`）
都會多一個會漏的地方 —— 症狀是**畫面看起來對、存進去的是錯的**。

## 要做什麼

- `domain/slotDraft.js`（純函式）：
  - `slotFromPicks(picks, ctx)`：`picks` 是「她選了什麼」（`entitlementId`、`equipmentId`、`ivProductId`、`startsAt`、
    `roomId`、`bed`、`therapistId`、`doctorId`、`nth`、`followupForVisitId`、`note`），
    `ctx` 是主檔與那位客戶的額度、來訪。回 `{ slot, errors }`
  - 裡面走的就是 `addSlot()` 現在那一串，**一行規則都不在這裡重寫**
  - 新段一定帶 `status: INITIAL_STATUS`
  - `visitWithSlot(customer, date, slot, sameDayVisits)`：有同一天的就 `withExtraSlot()`，沒有就組一筆新的（`addSlot()` 的 `:2127` 那一段）
- `addSlot()` 改成：讀 `view` → 組 `picks` → 呼叫上面兩支 → 後面的驗證、兩道確認、寫入**一個字都不動**
- 「前面那幾道先擋」（先選要做什麼、先選幾點、先選第幾返）搬進 `errors`，句子照抄
- 來訪編輯器的 `blankSlot()`／`readDraft()` **這一支不改**（在 spec 裡記成之後可以收的）

## 判準

- `tests/slot-draft.test.js`：
  - 擇一池選 SIS → 課程是復能、要治療師、不要診間（ADR-0075、0079）
  - 擇一池還沒選器材 → `assignsFor()` 是 `null`，`errors` 講出來，**不挑預設值**
  - ILIB → 要診間；營養點滴選護心抗老 → 180 分（ADR-0098）
  - n返 → `entitlementId` 是 `null`、帶 `followupNth` 與 `followupForVisitId`；換回普通額度 → 那兩格清乾淨
  - 新段的 `status` 是 `INITIAL_STATUS`，**就算併進一筆已確認的來訪也是**
- 壓表相關的 E2E 全部綠，**斷言沒有任何一條被改**
- `addSlot()` 裡不再出現 `assignsFor(`、`nthSlotFields(`、`effectiveCourse(` —— 有測試掃原始碼盯著，
  照 `tests/chips-and-chevrons.test.js` 的做法
- **這一支 diff 裡有沒有任何一行，讓壓表存進去的時段跟改之前不一樣？**

## 實作時跟上面不一樣的地方

- **「擇一池還沒選器材」不進 `slotFromPicks()` 的 `errors`**：那一句現在由 `validateVisit()` 講
  （「第 1 個時段：復能-四選一(60) 每次都要記錄用了哪一種器材」），搬進來的話壓表那一頁的字會變 ——
  跟「行為一個像素都不變」衝突。`slotFromPicks()` 回 `assigns: null`，治療師與診間兩格都是 null（不挑預設值），
  13 存之前一樣要跑 `validateVisit()`
- 新段多了明寫的 `status` 與 `note`：存進去的值跟以前一樣（以前是 `withExtraSlot()`／`withSlotStatuses()` 補上的）
- `tests/slot-note.test.js` 有一條掃的是「那一句寫進時段」的**寫法位置**，跟著搬到 `slotDraft.js`；不變量沒改
