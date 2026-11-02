# 04：紅字提醒與確認框那一句

Status: todo
Blocked by: 02

## 動工前先讀

- `CLAUDE.md` 連動表「一句「按下去會發生什麼」」「提醒與錯誤裡那一段叫什麼」「畫面上一段常駐的說明」三列
- `docs/agents/lessons.md` 第五節
- `visits.js` 的 `assignmentWarnings()`／`warningDetails()`／`mustSee()`；`consequences.js` 的 `bookingConsequences()`、`aboveeConsequences()`（520-532 n返 那一句）、來訪編輯器存檔前那一道

## 她要的

> 可以多一點步驟，多一點提醒或是多一點確認等等，讓一般的時候不會不小心多送

## 為什麼會這樣

最可能按錯的兩種：這位客人身上其實有二返額度（例如切換那天跟著舊表匯進來的套組），或其實有一次接得上的健檢。
那兩種按了「健檢不是我排的」，那一場就不扣、不接 —— 那次健檢的「約二返」不會收、二返額度留著剩 1。

## 要做的

- `validateVisit()` 的提醒多兩種（`warningDetails()` 的新 `source`，**進 `mustSee()`**，不收進 `tip()`）：
  - 帶標記的**二返**、這位客戶身上還有二返額度還有剩（`schedulable()` 的、活著的）→ 講幾次、哪一筆
  - 帶標記的任何一段、這位客戶有接得上的健檢 → 講哪一天。**一律問 `examChoicesForNth()` 的 `pickable`**（`nthFollowup.js:257-282`）——
    `examChoicesFor()` 在身上沒有二返額度時直接回空（`followups.js:444`），而「app 裡有健檢、身上卻沒有二返額度」正是資料健檢第二項那一種（`health.js:447`），
    用它的話這種客人一句紅字都不跳（過目 S5）。**同一筆正要存的健檢也算進去**（lessons 二）
  - 句子照 `slotLabel`（「提醒與錯誤裡那一段叫什麼」那一列）
- 確認框那一句「二返是健檢不是你排的 —— 不扣任何次數、不接健檢」：
  - **只講這一次新加的段**，照 `giftNames(…, added)` 的寫法 —— **不要**照抄 n返 那一句：`consequences.js:259` 的 `nthLabels(visit)` 沒帶 `added`、看的是整筆（過目 S6；
    n返 那一句本身記進 HANDOFF 中途發現）
  - 帶標記的三返**只講這一句**，不再接「三返是加約的」（`:260`、`:532`）—— 主控決定，兩句講的是同一件事
  - 壓表與日曆新增走 `bookingConsequences()`、拍 Abovee 走 `aboveeConsequences()`
- **既有的一段改成帶標記、或拿掉標記**（過目 M7）：現在沒有任何一道會跳 —— `chargeSwitchConsequences()` 只抓「扣不扣變了、而且有一邊是送的／體驗」
  （`consequences.js:1357-1359`，帶標記的段 `giftKindOf` 是 null → 回 null）；同一門課不算改期（`rebookSlot()` 只看開始時間與課程，`visits.js:414`），
  `visitEditor.js:1394-1398`、`:1408` 兩道都不跳。後果是真的：扣著二返額度、接著某一次健檢的那一段改成帶標記 → 額度還回 1、那一次健檢的「約二返」重新長出來（`followups.js:256-286`）。
  擴 `chargeSwitchConsequences()` 的條件或新寫一支；次數照 `:1366-1373` 用 `counts()` 試算、健檢那條鏈用 `followupBookingLines()`（`:849`）／`chainPlanLines()`（`:946`）那一類真的會跑的試算（lessons 五）。06 負責接上
- 這幾句話的字放 domain，畫面只畫

## 判準

- 紅字在預設的畫面上看得到嗎？（拍 Abovee 收著的列也看得到：`mustSee`）
- 沒有二返額度、沒有健檢的客人（她真的要用的情況）→ 一句紅字都不跳？
- 確認框的那一句是拿寫入的同一份計畫算的嗎？（lessons 五）
- 「三返是加約的 —— 這一場不扣任何次數」那一句，碰到帶標記的三返還講得對嗎？

## 做完時留下的

（做完的人寫）
