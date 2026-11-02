# 04：紅字提醒與確認框那一句

Status: done
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

- `visits.js`：`warningDetails()` 多一種 source **`examNotMine`**（新的 `examNotMineWarnings()`，沒 export），**進 `MUST_SEE`**（`mustSee()` 回 true）。只看帶標記、還算數的段：
  - 帶標記的**二返**（沒有返數）、身上還有活著的二返額度（`secondFollowupIds()`）還有剩 → `第 1 個時段：這位客戶身上還有「二返（8萬健檢）」剩 1 次 —— 按了「健檢不是我排的」，這一場不扣它`。
    剩幾次問 `countsWithDraft(e, customerVisits, visit, e.id)`（同一筆裡另一段正在扣的也算進去）
  - 帶標記的**任何一段**、`examChoicesForNth()` 有 `pickable` 的 → `…：這位客戶有 8/3(一) 的健檢接得上 —— 按了「健檢不是我排的」，這一場不接它`。
    拿 `[...customerVisits（濾掉這一筆存著的那一份）, visit]` 問 —— **這一筆自己還沒存的健檢也算**；日子去重（拍 Abovee 的暫時 id 會讓同一次出現兩次）
  - 前綴照 `ctx.slotLabel`；只提醒不擋（`validateVisit().errors` 不變）。她真的要用的那種客人（沒有二返額度、沒有接得上的健檢；取消／未到的健檢不算）一句都不跳
- `consequences.js`：
  - 新的 `notMineNames(visit, coursesById, added)`（寫法照 `giftNames()`：只看 `added`；名字走 `followupName()`）＋ `notMineLine(name)`：
    `三返的健檢不是你排的 —— 這一場不扣任何次數、不接 app 裡的任何一次健檢`。`bookingConsequences()`（壓表、日曆新增）與 `aboveeConsequences()` 都接
  - 帶標記的三返**不再講**「三返是加約的」：`nthLabels()` 與 `aboveeConsequences()` 那一圈都跳過 `isExamNotMine()` 的段
  - **`chargeSwitchConsequences()` 擴到「改成帶標記／拿掉標記」**（M7）：條件多 `isExamNotMine(old) !== isExamNotMine(now)`；
    一段一句（`二返(30) —— 改成「健檢不是我排的」：不扣「二返（8萬健檢）」、不再接 8/3(一) 那一次健檢（還 1 次）`／
    `拿掉「健檢不是我排的」：改成扣「…」／照樣不扣次數、接 8/3(一) 那一次健檢（扣 1 次）`），次數照舊 `counts()` 試算；
    **多收 `customer`、`chain`**（`data/visits.js` 的 `chainInputs()`）：有給就 `followupBookingLines()` 試算「約二返」長出來／收起來；
    最後一句換成「只改扣法與接不接健檢 —— 時間、狀態不動」（不說「待辦都不動」）；不講 Abovee 那一句（那一格照舊是二返那門課）；
    抬頭「這一段改成「健檢不是我排的」？」／「這一段拿掉「健檢不是我排的」？」。只改扣法（體驗 ⇔ 額度）的那幾句一個字都沒變（`tests/eecp-one-course.test.js` 照舊綠）
  - **06 要接**：`visitEditor.js:1394` 那一支現在沒傳 `customer`／`chain` → 鏈那幾句不講（但也不會說待辦都不動）。06 接上時傳 `customer: ctx.customer`、`chain: await chainInputs(customerId, coursesById)`（`data/visits.js:471`，讀不到回 null）
- 呼叫端（grep；這台雲端 VM 沒有 `codegraph`）：`warningDetails()` 三處（`validateVisit()`、`aboveeImport.js:1956、2782、2796`）—— 沒有帶標記的段時答案一樣；
  `chargeSwitchConsequences()` 一處（`visitEditor.js:1394`）；`nthLabels()`／`giftNames()` 只在 `consequences.js` 裡
- 測試 `tests/exam-not-mine-warnings.test.js`（26 支）：紅字的每一種（不跳的三種、二返額度、slotLabel、用完／刪掉、同一筆另一段在扣、三返不講額度、取消的段、
  做完／排著的健檢、同一筆還沒存的健檢、兩句都講、不是 error、一般的段一句都不多）、`bookingConsequences()` 四支、`aboveeConsequences()` 兩支、`chargeSwitchConsequences()` 五支
- E2E `82-exam-not-mine`（新的，登記進 `related.js`）：帶標記的二返＋三返存進 Firestore → 日曆印二返／三返 → 長按「客戶說可以」存得下去（02 之前會被擋）、
  讀回來標記與返數不變、Examine／耀聖只掛談定那一段、健檢那條鏈一張都不長。**紅字與確認框現在沒有任何畫面會傳帶標記的段**，E2E 由 06、07、09 補
- 文件（CLAUDE.md 連動表「拍 Abovee 記很多段」那一列的 `mustSee()` 名單、「一句按下去會發生什麼」）留給 10
- `public/sw.js` v211 → v212、`npm run shell:snapshot`
