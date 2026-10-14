# 「做什麼」那一排：送的／體驗收進最後一顆，按了才展開（壓表、來訪編輯器、拍 Abovee）

Status: done
Blocked by: 02
動工前先讀：`spec.md`「收起來」；`domain/slotOptions.js`（`slotOptionsFor()`、`arrangeSlotOptions()` 與它檔頭那兩段她的原話）；
CLAUDE.md「額度那一排的順序」「壓表那一頁的任何互動」「共用元件身上的屬性名字」「`public/` 底下任何檔案」四列；ADR-0038（壓表不整頁重畫）、ADR-0123（拍 Abovee 確認層選得了）；
`ui/components/buy.js` 的分類 → 課程兩步（`groupCourses()`、`buyGroup`）

## 她要的

> 然後我希望這種不算次數的，在壓表或是新增來訪那邊可以先預設不出現先收合或是擺到底下，畢竟不常用

2026-10-06 種子註解裡記著的那一句（她那時候的抱怨）：「好多課程然後都滑不到想要的」。

## 為什麼會這樣

- 不算次數的課**每一位客戶那一排都有**（`slotOptionsFor()` 最後那一圈），而 `arrangeSlotOptions()` 照分類把它夾在額度中間 ——
  功醫門診、HRV 跟復健科醫師門診的額度並排。05 之後多心臟科評估、EECP體驗，一排多四顆她幾乎不按的。
- 01 之後「任何課都能當體驗」，那一排如果把每一門課都列出來就是二十幾顆。
- `uncountedCourses()` 的順序是主檔讀回來的順序，而 `repo.list()` 沒有 `orderBy`、Firestore 照文件 id 排 ——
  05 之後會是 course-cardio → course-eecp-trial → course-fm → course-hrv，編輯器替沒有額度的客戶預設的第一門（`freeCourseOf()`）會從功醫門診變成心臟科評估（E2E `52` 釘著功醫門診）。

## 要做的

1. **domain**（`slotOptions.js`，三個入口唯一的答案）：
   - 每一顆多一格 `folded`：不算次數的課那幾顆是 true、額度與 n返 是 false。`arrangeSlotOptions()` 把 folded 的**全部排到最後**、不再照分類夾在中間；二返那一組照舊另起一行，排在 folded 前面
   - **folded 那一組的順序明訂**，不靠主檔讀回來的順序：照分類（`groupByCourse()` 的順序）、同一類裡寫一份明確的規則（建議：種子 id 的固定順序 功醫門診 → HRV → 心臟科評估 → EECP體驗，其餘照名字）。
     沒有額度的客戶預設的第一門（`freeCourseOf()`）讀這一份 —— **照舊是功醫門診**
   - 「別的課當體驗」的名單另回一份（`giftCourseChoices()` 之類）：還在用的課程，扣掉 `canBeGift()` 是 false 的（健檢、二返）、扣掉上面那一組已經列的；分類照 `groupCourses()`
   - 「要不要一打開就展開」一支（`foldOpen()`）：這一排沒有任何一顆**還有剩的**額度（拍 Abovee 的 `includeUsedUp` 列的用完那幾顆不算「有剩」）、或這一段現在就是送的／體驗
2. **畫面**（一支共用元件，`ui/components/` 底下；屬性用自己的前綴；新檔加進 `sw.js` 的 `SHELL`）：
   - 最後一顆「送的／體驗…」，按了展開：上面一排不算次數的課、底下「別的課當體驗」分類 → 課程兩步
   - 選了一顆之後一排「體驗｜送的」（預設體驗，01 的 `giftKind`）
   - 選著一顆送的／體驗時那一組不給收起來（收起來是畫面的事，不可以看起來像取消選取）
   - 三個入口：壓表（`schedule.js` 的「做什麼」那一排與 `entFields()`；**事件委派、只換那一塊**，ADR-0038；02 改好的 `picked` 查找要找得到「別的課當體驗」選的那一門）、
     來訪編輯器（`visitEditor.js` 那一排與 `readDraft()`）、拍 Abovee 確認層（`aboveeConfirm.js` 那一排）
3. 會被推翻、要改的測試：`tests/slot-options-order.test.js:82-89`（「不算次數的課接在它那一類後面」）、E2E `56` W1；文字會變的 E2E `51`、`52`、`58` P3。新的 E2E 登記進 `tests-e2e/related.js`

## 判準

- 一位有三筆額度的客戶：壓表那一排只有三顆額度＋最後一顆「送的／體驗…」；按了才看得到功醫門診、HRV（05 之後再加心臟科評估、EECP體驗）
- 一位什麼都沒買的客戶：一打開那一組就是展開的；來訪編輯器第一段預設功醫門診、體驗
- 打開一段舊的功醫門診（來訪編輯器）：那一組展開、功醫門診按著、「體驗」按著
- 壓表「別的課當體驗」→ 復能 → INDIBA → 30 分 → 加這一段：存下去是一段 INDIBA 30 分體驗、不扣、`endsAt` 30 分後
- 拍 Abovee 一列沒有額度的功醫門診：那一組展開、預選好
- 三個入口的順序一樣（同一位客戶）；folded 那一組的順序跟主檔的文件 id 無關（單元測試把主檔順序打亂）
- 壓表按展開、選一顆：不整頁重畫、不捲回最上面（E2E 量 `.app__main` 的 `scrollTop`）
- 手機寬度（360px）那一排不撐出橫向捲動

## 做完時留下的

- **domain**（`slotOptions.js`）：每一顆多 `folded`（收在「送的／體驗…」後面）與 `other`（「別的課當體驗」）；
  旗子 `isUncounted` **改名 `isGift`**（不算次數的課與別的課當體驗都是它 —— 原本的名字在「別的課」上是錯的）。
  新的三支：`giftOptions(courses, { keep })`（每一門還在用、`canBeGift()` 的課一顆；`keep` 是這一段現在指著的那一門，停用了也列）、
  `foldOpen(options, value)`（沒有任何一顆**看得到的**額度還有剩、或現在按著的是送的／體驗）、`defaultGiftCourse(courses)`（編輯器沒有額度時的預設）。
  `arrangeSlotOptions()`：看得到的那幾顆照舊（分類、名字、二返另起一行），收起來的接在最後 —— 先不算次數的課、再別的課，兩組各自照分類，
  同一類裡照 `GIFT_FIRST`（種子 id：功醫門診 → HRV → 心臟科評估 → EECP體驗）→ 名字。**跟主檔讀回來的順序無關**（單元測試把主檔倒過來排）
- `masterData.js` 的 `uncountedCourses()` 沒人用了，拿掉
- **畫法**（`ui/components/giftFold.js`，新檔，進了 `sw.js` 的 SHELL；版號沒升，照舊 v192）：`html({ options, value, open, chip, cls, sm, empty })` 與 `toggle(e)`。
  容器 `data-giftfold="open|closed"`、最後一顆 `data-giftfold-more`、分類 `data-giftfold-group`、那一類的課 `data-giftfold-in`。
  一類只有一門的那一顆直接就是那一門（同加購）。**收不回去**（同「換一款」）；換分類時選著的那一門所在的那一類不收。CSS：`app.css` 的 `.giftfold`
- **壓表**：「做什麼」那一排畫 `giftFold.html()`；`entFields()` 多一排 `giftKindField()`（`data-giftkind`，點了只換 aria-pressed）——
  `view.giftKind` 第一次真的被設。`pickCourse()`：換一門送的課還是送的（同另外兩個入口）。`onDeckClick()` 先問 `giftFold.toggle(e)`。
  空的時候那一句改成「這位客戶身上沒有還有剩的額度了。」
- **來訪編輯器**：額度那一排不再走 `f.chips()`，改 `entRow()` 自己畫（每一顆照 `f.chips()` 的樣子：`data-chip="s<i>-ent"` ＋ 同名 hidden input，
  按下去走 `f.wireChips()` 原本那一條路）；送的／體驗那幾顆問 `giftOptions(…, { keep })`；`freeCourseOf()` 問 `defaultGiftCourse()`。
  多一排 `s<i>-gift`（`f.chips()`，選了重畫、抬頭跟著寫 `(送的)`）；`readFreeSlot()` 讀它（沒畫出來就照原本的）。`form` 上掛 `giftFold.toggle`。
  **換回扣額度那一下重畫，那一組又收起來**（`foldOpen()` 照新的值算）—— E2E 49 的 U6 因此多按一次「送的／體驗…」
- **拍 Abovee 確認層**：「要做什麼」那一排畫 `giftFold.html({ cls: 'abl-row__chips', sm: true })`；多一排「體驗或送的」（`data-abl-gift`）。
  展開只是 DOM 上的狀態：按了展開、還沒選就去按別的（器材…），那一列重畫時又收起來 —— 沒選就沒有理由開著，沒有另外記
- **設定 → 課程「不算次數」那一格的提示句改了**（她回：「好」）：講「送的／體驗…」那一顆在哪、預設體驗可改送的、沒勾的課在「別的課當體驗」。**名字沒改，09 問她**
- CLAUDE.md「額度那一排的順序」那一列改了（推翻 issue 08 的「類裡再那一類不算次數的課」）。**09 的 ADR 要寫這一條**
- 測試：新的 `tests/gift-fold.test.js`；改了 `slot-options-order`、`uncounted-courses`、`provisional-courses`（其餘五門「沒買就只在別的課當體驗裡」）；
  E2E `67` 多 G4–G8（壓表別的課當體驗 → 復能 → INDIBA 30 存下去、不重畫不捲回去；壓表送的；編輯器沒買的客戶預設功醫門診體驗 → 送的；
  編輯器舊的功醫門診；360px 兩個入口不撐橫向捲動）、`49` U3／U6、`51` a0／a2、`52` N3、`56` W1／W2（只數看得到的）；`related.js` 多登記 `giftFold.js`
- **09 要看的**：`docs/操作手冊.md`、`常見問題.md` 有沒有講到功醫門診那一顆在哪一排（現在收在「送的／體驗…」後面）
- 相關 E2E：第一輪 47 支、339 條（`--related --base fa26d45`）335 過、3 紅 —— `41` A4 是網路（gstatic 沒載完，畫面寫「程式檔案沒有下載完成」）；
  `67` G4 是量法錯（Playwright 按下面那幾顆時會先把卡片往下捲，改成按之前量、斷言沒有往回捲）；`67` G6 是測試按到「還沒定」那一顆醫師（多一道確認框）。
  改完跟 05、07 一起跑第二輪（29 支、186 條）全過。**`--related --base <舊 commit>` 在 rebase 之後不能用**（那一個 commit 不在歷史上了，退回比 merge-base），第二輪是點名跑的
