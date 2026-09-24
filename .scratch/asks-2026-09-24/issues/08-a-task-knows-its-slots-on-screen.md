# 「這一張待辦講的是哪幾段」＋ 詳情只開那幾段 ＋ N 項

Status: todo
Blocked by: 05、06
來源：`../spec.md` 第 08 條（第四點 a、第五點的顯示、R8）
動工前先讀：ADR-0089（沒指名哪一段的卡片只是目錄）、ADR-0091、ADR-0107、`.scratch/prelaunch-audit-2026-09-23/issues/21`、
`domain/taskRules.js` 的 `taskLine()`／`cancelSlotsOf()`、`domain/todoFlow.js` 的 `ownsCancel()`／`ownedKinds()`、
`domain/visits.js` 的 `slotsToShow()`、`ui/views/home.js` 的 `openTaskVisit()`／`openWhoVisit()`／`fillVisitInfo()`、
`ui/views/customerDetail.js` 的 `openVisitCard()`

## 她要的

> a 這個地方的詳情，為甚麼不是只呈現真的被取消的那幾段?而是其他段也會顯示出來 ? 不知道是不是只有取消這邊沒有改到 ?
> 像是我發現寫紀錄這個待辦的詳情在這兩個地方好像也是有問題 ? 所以幫我全域排查 詳情只呈現和這項有關的而不是整天的，
> 更何況看起來也不是整天的詳情 ? 所以不知道是上次改一半還是哪裡有問題

## 為什麼會這樣

- 三個入口的「詳情」都用 `focusFor(visit, null)`：待辦中心分類頁（`home.js:2169`）、依客戶抽屜（`home.js:1211`）、
  客戶詳情任務列（`customerDetail.js:349`）。那是那一天的**目錄**（ADR-0089：只列那幾段讓她點，不畫待辦）——
  所以它既不是被取消那一段，也不像整天的詳情。
- **改一半是真的**：9/13 取消類、9/23 掛號類開始帶 `slotIndexes`，9/23 的 issue 21 把那一行小字改成只講那幾段，
  但詳情那顆沒跟上（註解還寫著「任務綁的是一整天」）。寫紀錄（05 之前）與健檢鏈三種身上沒有 `slotIndexes`。
- 「N 項」是整天的段數（`home.js:1840`）。

## 談定的做法

- 一支 domain：**`taskSlots(task, visit, coursesById)` → 這一張講的是哪幾段**
  - 有 `slotIndexes` 照它
  - 沒有：照種類推 —— 取消類走既有的 `ownsCancel()` 那三層、寫紀錄＝要寫紀錄而且做完的段、健檢鏈三種＝健檢那一段、
    掛號＝長得出那一種的段；推不出來 → 整天
- `taskLine()`、「N 項」、三個入口的詳情全部問它
- 詳情：一段 → 直接打開那一段；兩段以上 → 目錄只列那幾段（`slotsToShow()` 收一份名單）

## 判準

- 「取消 Abovee」只蓋第 1 段：詳情直接打開第 1 段、「1 項」？
- 營養諮詢＋SIS 那一天的寫紀錄：那一行只寫營養諮詢、詳情只開營養諮詢？
- 舊的寫紀錄（沒有 `slotIndexes`）照樣只講要寫紀錄的那一段？
- 追蹤健檢報告：只講健檢那一段？
- 推不出來的（她手動加的）：照舊整天，不會變成空的？

## 對照 develop（`d00b644`，第一批合進去之後）

- 行號還對得上：`home.js` 的 `openWhoVisit()`（1196，`focusFor` 在 1211）、`openTaskVisit()`（2155，`focusFor` 在 2169）、
  「N 項」在 `fillVisitInfo()`（1840）；`customerDetail.js` 任務列那一顆走 349 → `openVisitCard()`（1828）。
- **寫紀錄 05 之後已經帶 `slotIndexes`**（`newRecords()`）—— 新長的走第一條「有就照它」。
  「要寫紀錄而且做完的段」那一條只剩給**沒有 `slotIndexes` 的舊寫紀錄**。
- `todosForVisit()` 的迴圈（`todoFlow.js:236` 附近）已經照「取消類 → `ownsCancel()`、有 `slotIndexes` → 照它、其餘 → `ownedKinds()`」歸屬。

## 動工時決定的（第二段補）

- **`taskSlots()` 就是 `todosForVisit()` 歸屬的反面**：「這一張屬於哪幾段」與「那一段的卡片列不列這一張」
  問的是同一件事，所以迴圈裡那一段抽成一支 `ownsTask()`，兩邊都叫它 —— 各寫一份的話，
  詳情打開第 1 段、第 1 段的卡片上卻沒有那一張。推不出來（`ownedKinds()` 的「推不出來一律留著」讓每一段都認）→ 整天。
- **`taskLine()` 從 `taskRules.js` 搬到 `todoFlow.js`**，跟 `taskSlots()` 住在一起。反過來讓 `taskRules.js` import
  `todoFlow.js` 會出事：`todoFlow.js` 頂層的 `FLOW` 讀 `RECORD_TASK_KIND`，先載到 `taskRules.js` 的話那一刻還沒初始化（TDZ）。
  四個呼叫端（`home.js`、`tasklist.js`、`customerDetail.js`、`sheetReport.js`）改 import，CLAUDE.md 那一列跟著改。
- 三個入口的按鈕改帶**任務**（id），打開時才問 `taskSlots()`：待辦中心那一列畫出來的時候來訪還沒讀回來。
- `focusFor()` 與 `slotsToShow()` 多收一份名單（`only`）：名單剛好一段 → 直接是那一段；兩段以上 → 目錄只列那幾段。
