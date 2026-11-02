# 02：時段的形狀、組時段、存檔驗證

Status: todo
Blocked by: 01

## 動工前先讀

- spec.md「資料的形狀」「防一般的時候按錯」
- `CLAUDE.md` 連動表：「n返（三返、四返…）的形狀」「新增一個會建立時段的入口」「送的／體驗…」「健檢與二返的關係」那幾列
- `public/js/domain/nthFollowup.js`（檔頭）、`slotDraft.js` 的 `slotFromPicks()`、`visits.js` 的 `validateVisit()`（1712-1880）、`masterData.js` 的 `giftKindOf()`（200-206）

## 她要的

> 按了之後App就知道健檢不是我排的，就會走另一條路 ?
> 但要小心，不能影響或是有任何可能導致一般的情況算錯

## 為什麼會這樣

- `slotFromPicks()`（`slotDraft.js:76-82`）n返 的課程從那次健檢借，沒有健檢就是 null → 「先選要做什麼」；`:110` 沒接健檢 → 擋
- `validateVisit()`：`:1739-1740` 沒有額度又不是 n返／送的 → 「要選一個額度」；`:1870-1876` n返 沒接 → 擋
- `giftKindOf()`（`masterData.js:200-206`）：沒有額度、不是 n返、沒有 `giftKind` 那一格的段，課程勾了預設體驗就讀成體驗 —— 帶標記的二返不可以走到這一條
- 二返那門課怎麼找：`abovee.js:317` 已經有 `live(courses).find((c) => isFollowupCourse(c.id, live(courses)))`

## 要做的

- 一支讀標記的函式 `isExamNotMine(slot)`，**放在 `masterData.js`**（跟 `giftKindOf()` 同一處）—— 放 `nthFollowup.js` 會繞成循環 import
  （`nthFollowup.js:44` → `followups.js` → `entitlements.js` → `naming.js` → `masterData.js`；`masterData.js:6` 只 import `clinicalFlags.js`，是葉節點；過目 M1）。
  別處要的話從 `masterData.js` import（`nthFollowup.js` 可以轉出）。**全站只准問它**
- **判斷一律是 `slot?.examNotMine === true`，永遠不從形狀推**（「二返那門課＋沒有額度＋沒有連結」）—— 舊資料可能就有那種形狀（`sheetReport.js:238-240` 的 `free`）
- **沒有標記＝沒有那一格**：只有帶標記的段寫 `examNotMine: true`；不寫 `false`／`null`（不然每一段一般的段都多一格，違反 `slotDraft.js:151`「其餘的段長得跟以前一模一樣」）；
  清掉用解構把那一格拿掉（過目 S2）
- 找二返那門課的一支（沒有健檢也找得到）：**畫不畫那一顆**用「剛好一門才回」；**驗證**用 `isFollowupCourse(slot.courseId, courses)`（任何一門二返都算 ——
  她之後替別的課也設 `followupCourseId` 時，既有帶標記的段照樣存得下去，過目 S1b）。先去 staging 主檔看她現在有幾門，記進「做完時留下的」。
  **`abovee.js:317` 不改**（照舊 `.find()` 取第一門 —— 改成「剛好一門」會讓兩門以上時照片上的三返認不出來，過目 S1a）
- `slotFromPicks()` 多一條路（`examNotMine: true` ＋ `nth`：2 → 二返、3～10 → n返）：課程＝二返那門、`entitlementId`／`followupForVisitId`／`giftKind` 是 null。
  - 二返不寫 `followupNth`；`courseName` 照一般的段（課程名）
  - **3～10 走 `nthSlotFields({ nth, examVisitId: null, courseId })`**：快照 `courseName: nthLabel(nth)` 一定要寫 —— `slotName()` 看到 `followupNth` 就讀快照（`naming.js:151-153`），
    不寫的話日曆上一段三返會印成「二返(30)」（過目 M2）
  - `nth` 是 null（日曆、壓表不預選）→ `stop('先選第幾返')`，**帶著 `course`／`assigns` 回去**（拍 Abovee 靠它畫醫師那一排，`slotDraft.js:57-58、107`）
  - 標記跟 `entitlementId`／`isNth`／`giftCourseId` 同時給時誰贏：寫明在註解、測試釘住（建議：標記贏、其餘清空 —— 畫面上那一顆是她最後按的）
  - 其餘（時間、診間、醫師、時長、狀態）跟一般的段走同一段身體
- `validateVisit()` 的豁免**只放過那一種形狀**（lessons 四：豁免寫成它想放過的形狀）：
  帶標記的段 → 課程 `isFollowupCourse()`、`entitlementId`／`followupForVisitId`／`giftKind` 一定是空的、`followupNth` 不是空就要 3～10；
  滿足了才跳過「要選一個額度」與「n返 一定要指定是哪一次健檢的」。任何一格不對 → 講出是哪一格的錯
- `giftKindOf()`：帶標記的段一律 null（第一行）
- `withGiftKinds()`（`visits.js:912`）存檔寫實時不會把它寫成體驗（被上一條管到，測試釘住）
- 不用配資料健檢：新的欄位，沒有既有資料（CLAUDE.md「改資料的形狀要帶著既有資料走」那一條在這裡不適用，ADR 寫明）

### 測試怎麼寫（過目 S11）

- `placeSeconds()` 沒有 export（`followups.js:1147`）：經過 `syncFollowupTasks()` 測
- `giftKindOf()` 的退路：`slotFromPicks()` 每一段都寫 `giftKind: null`、有那一格就不猜（`masterData.js:204`）—— 要測退路得手組一段「沒有 `giftKind` 那一格＋二返那門課勾了預設體驗」的段

## 判準（每一條一支測試）

- 一般的 n返 沒接健檢 → 照舊擋？（沒有標記的段一個字都不放寬）
- 一般的二返沒選額度 → 照舊擋？
- 帶標記又帶額度／又接了健檢／又是送的／課程不是二返 → 擋下來，而且句子講對是哪一格？
- 帶標記的二返會不會被 `giftKindOf()` 讀成體驗（二返那門課勾了預設體驗也不會）？
- `counts()` 算任何一筆額度時，帶標記的段算不算進去？（不可以）
- `followupsOfExam()`、`placeSeconds()`、`syncFollowupTasks()` 看不看得到它？（看不到 —— 它沒有連結、沒有額度）
- 帶標記的段存進去、讀回來、再存一次，形狀一樣嗎？（`withSlotStatuses()`、`withGiftKinds()`、`withSlotNotes()` 都跑過）

## 做完時留下的

（做完的人寫）
