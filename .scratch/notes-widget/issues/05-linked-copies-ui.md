# 05：複製到別天的畫面（長按選單、小月曆、「共 N 天」）

Status: done
Blocked by: 04

## 動工前先讀

- `spec.md`「二」、04 的「做完時留下的」（函式名、分組那一支回什麼、選單最上面那幾天從哪裡拿）、ADR-0178
- `public/js/domain/notes.js` 的 `noteActions()`、`public/js/ui/components/note.js` 的 `runAction()`（`:484`）、`row()`；長按的三個呼叫端：`home.js:1873`、`customerDetail.js:429`、`calendar.js:1322`（**只有日曆傳 `onCalendar: true` 與 `onEdit`**）
- 清單類的入口：首頁那張卡 `notesCard()`（`:1554`）、`#/todo/notes` 的 `renderNotes()`／`paintNotes()`（`:4273-4330`）、客戶詳情 `notesBlock()`（`:1446`）；**照日子的**：日曆 `noteAsBar`／`noteLine`／`notesOn`、三格的 `notesBlock(ctx)`（`home.js:2375`）與已完成（`:2455`）
- 自己畫小月曆的前例：壓表的小月曆、日曆的 `openDatePicker()`（`weekOfMonth()` 那一條要照）—— 看能不能共用，不能就寫清楚為什麼另畫
- `CLAUDE.md`「一個會建立新資料的按鈕」（`withSaveState` 的 `key`）、「一個要分得出『不要了』與『手滑關掉』的確認框」

## 她要的

> 我想要連起來誒，不然就是可以複製的時候決定，但預設是連起來的，然後複製這個功能也可以放入長按裡面? 長按就可以選複製

> Q7 - 一次複製到幾天 : 好，照這樣做（小月曆一次點好幾天；帶文字與掛給誰；都是還沒勾的；營養品的提醒不給複製）

## 要做的

- **長按選單照她決定的重排**（HANDOFF「她已經決定的」；上限照舊五顆＋先不要）。日曆上那一份（`onCalendar`：「從日曆拿掉」）一起照改
- 「複製到別天」（`noteActions()` 給、`runAction()` 接）：打開一張卡，小月曆（這個月＋可以翻月）一次點好幾天；那一筆自己的日期標出來、點不了；
  底下開關「連在一起：勾一天，其他天一起勾」預設開；「複製到 N 天」按鈕（N＝點了幾天，0 天按不下去）。樣子照 `mockups/final-3.png` 的 7
- 連在一起的：選單最上面列出是哪幾天（例：「11/6(五)・11/8(日)・11/10(二)」，代表的那一天標出來）；「拆開這一天」放在她決定的位置
- **ADR-0060：兩顆新的都要另有一條不靠長按的路** —— 建議日曆點一筆待辦跳出的那張卡（`calendar.js` 的 `openNoteCard()`，有勾與鉛筆）多「複製到別天」、連在一起的多「拆開這一天」
- **改字、改掛給誰的地方講出會一起改**（lessons 五）：改文字那張卡（`askText`）、掛給誰（`askCustomer`）、日曆待辦編輯器存檔時，連在一起的多一句「另外 N 天會一起改」
- 清單上一列＝一組：垃圾桶（`home.js:4296`）、「清掉這 N 筆」照 HANDOFF「她已經決定的」作用在整組；數字一組算 1
- **清單類一組一列**：`row()` 的日期那一顆寫分組那一支給的那一天，旁邊一顆「共 N 天」（樣子跟客戶那一顆、日期那一顆同一家；**字色要過對比**）
- **照日子的不動**：日曆、三格每一天各一筆（04 已經保證資料是每天一筆，這裡確認沒有被分組那一支誤用）
- 勾一組裡的一筆：toast 講「勾掉了（共 N 天）」；拿回來同理
- 存完：toast「複製到 N 天」＋（連在一起時）「勾一天，其他天一起勾」；日曆打開著的話照常重畫
- E2E：新的一支 spec（登記進 `tests-e2e/related.js`）：長按 → 複製到兩天 → 清單一列「共 3 天」→ 日曆三天各一筆 → 勾其中一天 → 三天都勾掉；拆開一天 → 各勾各的

## 判準

- 清單上一組三天是一列、日曆上是三格嗎？
- 營養品的提醒長按，有沒有「複製到別天」？（沒有）
- 小月曆按兩下「複製」、或網路慢按兩次，會不會建出兩份？（`key`）
- 點外面關掉小月曆，會不會被當成「複製」？
- 「共 N 天」那一顆在深色主題、淺色主題都看得清楚嗎？

## 做完時留下的

段一（2026-11-06）。E2E `97-notes-linked-copy`（7 支，登記進 `related.js`）。sw.js v302（04 是 v300；v301 中途產過快照又改了 CSS，跳過）。

**長按選單三個入口共用一支 `note.openMenu(n, { notes, complete, customer, onCalendar, deps, onEdit, onBag, after })`**（`ui/components/note.js`）：
- `complete`：手上那一份是不是整組都在。首頁那張卡、隨手記那一頁、客戶詳情是（不重讀）；**日曆、逾期／今天／明天不是 → 打開選單之前 `deps.listLinked()` 重讀**（讀不到照手上那一份）
- 連在一起的：抬頭底下一排日子（`openActions()` 新的選填 `tags: [{ label, on }]`，代表的那一天 `on`），底下那一行小字「3 天一起」「只改這一天」「3 天一起改」（`noteActions(n, { linkedDays })`）
- 三份 `noteDeps()`（home、calendar、customerDetail 的 `noteRunDeps()`）多 `listLinked`、`copyTo`、`unlink`

`runAction()`：`date` → 「改日期」那張卡（`askDateChange()`，選項只問 `dateChoices()`；「改成某天」點了才露出日期框）；`copy` → `copyAction()`（先重讀那一組 → `askCopy()` 小月曆 → `copyTo()` 或 `unlink()`，`withSaveState` 帶 `key`）；
`edit`／`who` 的卡片抬頭講「另外 N 天會一起改」（`askText(value, { also })`、`askCustomer(load, id, { also })` —— **03 要在 `askCustomer()` 加搜尋框，簽名多了第三個參數**）；
`today`／`undate`／`remove` 三支拿掉了（選單上沒有了）。toast：勾「勾掉了（共 N 天）」（N 是 `setDone()` 重讀那一組回報的 `linkedDays` —— **`setDone()` 回的多了這一格**，`prepareToggle()` 拿掉才併回那一筆）、改字／掛給誰「（共 N 天）」、複製「複製到 N 天：勾一天，其他天一起勾」、拆開「拆開了：11/8(日)以後自己勾」。

小月曆（`askCopy()`／`copyDaysHtml()`）**另畫一份、不共用日曆的 `openDatePicker()`**：那一張點一天就跳過去、綁著日曆的 `state.view`；這一張要點好幾天、標出點不了的。
格子照 `monthWeeks()`（週一起算，跟日曆一樣；樣子圖是週日起算，照 app 的）、長相照 `.datepick__*`。它自己那一天與同一組已經有的那幾天虛線圈、點不了；**今天以前的點不了**（主控定的，段末問她）；開關是 `.choice--row` 的勾選框（app 裡的開關都長這樣，樣子圖畫的是滑桿）。
卡片比面板窄：格子 `min-width: 0; padding: 0`、翻月那一列左右留 6px（`.calbar__nav::after` 往外撐 6px，貼邊就是一條橫的捲軸 —— 截圖量到的）。

ADR-0060 那兩條不靠長按的路：日曆點一筆待辦跳出的那張卡多一顆「複製到別天」（營養品的提醒沒有），「拆開這一天」在那張小月曆最上面。
日曆待辦編輯器：連在一起的把抬頭底下那一行換成「連在一起：另外 N 天的字與掛給誰會一起改，日期只動這一筆。」（重讀那一組；不多長一段 `field__hint` —— `tests/fewer-words.test.js` 鎖著日曆那一支只准 1 段；也不能寫「改這一天」—— `tests/slot-first.test.js` 禁那四個字在 calendar.js）。

清單一列的徽章是 `.notecount`（`note.row(n, { badge })`，字是 `linkedBadge()`），淡綠底、字 `--accent`，深色淺色都截圖看過。CSS 新的四組都登記了 `CSS_SCOPES`（`notecount`、`datechoice`、`copydays`、`actionstags`）。

文件：`docs/操作手冊.md`「同一件事要好幾天提醒：複製到別天」、`docs/常見問題.md`「我勾了一筆隨手記，別天的也一起勾掉了」。

**沒做的、給後面的**：逾期／今天／明天那三頁與日曆上的那一列不標「連在一起」（照 spec 每一天各一列，長按才看得到是哪幾天）；小工具（07、08）照 `groupLinked()` 一組一列、選單照 `noteActions()` 的五顆。
