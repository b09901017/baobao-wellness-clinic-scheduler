# 07：拍 Abovee —— 「記成一次性客人」與一次性客人的列

Status: done
Blocked by: 01、02、03、05（名字卡的表單元件）

## 動工前先讀

- spec.md「談定的」第 4、5、8 題
- `CLAUDE.md` 連動表：「拍 Abovee 記很多段」（整列都讀，尤其 `resolveItem()` 的 `next`、`pickOption()` 的 `base`、`asRecorded()` 三處清旗標那一句）、
  「照片上的人是 app 裡的哪一位」「健檢不是我排的」那幾列
- `public/js/domain/aboveeImport.js`：`readAbovee()`（`:1053` 認人）、`resolveItem()`（`:827-846`：認不得 → `kind: 'unknown'`、`checked: false`）、`pickOption()`、`notMineHintFor()`、`linkBatchExams()`／`onlyOpen()`
- `public/js/ui/components/aboveeConfirm.js`：勾得起來嗎（`:515` `canCheck`）、「app 裡沒有」那個標記（`:532`）、`WHY_UNKNOWN.none`（`:73`、`:656`）、換一位（`:853-861`）
- ADR-0170（辨識結果／發現問題兩頁）、ADR-0149（照片上的狀態就是要記的狀態）

## 她要的

> 像是10月對帳的時候，會出現不是我的客戶，我之前的作法好像就是直接不管 ?

第 4 題：照片上「app 裡沒有」那一列多一顆「記成一次性客人」（照片上的名字＋病歷號建名字卡、**她按了才建**），之後勾得起來、照照片填；**不靠預約來源猜**。
第 5 題：「換一位」的搜尋結果標「一次性」。

## 為什麼會這樣

- 認不得的列（`how === 'none'`）是 `kind: 'unknown'`、勾不起來，畫面上叫她「真的沒有就先去新增客戶」（`aboveeConfirm.js:73`）—— 現在只有建正式客戶一條路
- 一次性客人建好之後是一份客戶文件，`identifyCustomer()` 本來就認得（池子是沒刪、沒停用的客戶，`identify.js:99`）；但他沒有額度，
  `pickOption()` 從 `slotOptionsFor()` 挑不到任何一顆 → 那一列記不進去

## 要做的

- **「記成一次性客人」**：`how === 'none'` 的那一列點開之後多一顆（`WHY_UNKNOWN.none` 那一句改成講兩條路：打名字找找看／記成一次性客人）。
  按了 → 05 的快速表單（名字、病歷號帶照片上的字）→ 建好 → 那一列重認一次（同「換一位」之後那一圈）→ 變成新的一列、照照片勾不勾
  - 同一張照片上同一個名字的別列跟著認得（建一次就好）
  - 照片上的名字跟某一位既有客戶差一個字（`nearName`）的情況不會走到這裡（那是認得的）—— 不用另外處理
- **一次性客人的列**（`pickOption()`／`resolveItem()` 多一條「客人是一次性的」分流，在挑額度之前）：
  - 課程照照片（`courseFrom()`），組 `slotFromPicks({ oneTime: true, … })`
  - 二返：接得上他的一次性健檢 → 照 `onlyOpen()` 先選（02 的虛擬版；同一張照片上的健檢也算，`linkBatchExams()` 那一圈；`aboveeImport.js:346` 的 `examChoices` 要一條一次性的分流）；接不上 → 照舊 `notMineHint`（ADR-0169，不替她按）
  - 轉成客戶之後還欠的那一場一次性二返：「做什麼」那一排多的那一顆（02）在這裡也要列得出來、預選得到
  - 照片寫「體驗」的列：一次性客人不走體驗那條路（他本來就不扣）
  - 確認框（`aboveeConsequences()`）：一次性的段不進任何一個「扣 N 次」的括號
- **新增的旗標要在三處清**（`resolveItem()` 的 `next`、`pickOption()` 的 `base`、`asRecorded()`）—— 換一位從一次性客人換成一般客戶、或反過來，那一列重算
- **「換一位」**的結果裡一次性客人標「一次性」
- 預約來源那一格**不讀**來判斷（公司名不進 repo；她常忘了選）
- `public/` 有動：照 HANDOFF「共同的規矩」升 `VERSION`、新檔案進 `sw.js` 的 `SHELL` 與 `tests-e2e/related.js`

## 判準（domain 的是單元測試、畫面的是 E2E）

- 一般客戶的列，跟改之前一模一樣嗎？（`tests/abovee*.test.js` 全綠、沒有改既有的期望值）
- 認不得的列按「記成一次性客人」→ 名字卡建好、那一列變成新的、勾得起來、存下去之後日曆上有、段帶 `oneTime`、沒有扣任何一筆額度？
- 沒按 → 那一列照舊勾不起來（不替她建）？
- 下一張照片上有同一位 → 直接認得（不再是「app 裡沒有」）？
- 一次性客人照片上的二返：他有一次性健檢 → 先接好；沒有 → 不勾、講一句指她去「健檢不是我排的」？
- 換一位：一般 ⇄ 一次性來回換，那一列的課程、額度、接哪一次健檢有沒有殘留上一位的？

## 做完時留下的

段四（2026-11-05）。測試在 `tests/one-time-abovee.test.js`（27 條）與 E2E `96-one-time-abovee`（T1、T2，本機跑過全綠；`85` 一起跑過）。

- **列上多三格、一格判斷**（`aboveeImport.js`）：`guest`（這一位是一次性客人，`resolveItem()` 照 `ctx.customers` 寫；是客人的屬性，`asRecorded()` 不清）、
  `guestCourseId`（按的那一門）、`guestSecond`（轉成我的客戶之後按的是「二返（一次性那一次）」）、`bothSeconds`（轉成客戶之後照片上的二返：一次性那一次還欠、身上也有真的二返額度 → 不替她選、不勾、`newRowSay()` 講、排進要你看）。
  後三格在 `resolveItem()` 的 `next`、`pickOption()` 的 `base`、`asRecorded()` **三處清**
- **交給 `slotFromPicks()`**：`picksOf()` 多 `oneTime`（`guest` 或有 `guestCourseId`；一次性客人的「健檢不是我排的」、n返 也標）與 `courseId`（`guestCourseId`）。一般客戶 `oneTime: false`、`courseId: null`（`slotFromPicks()` 的預設，段一個字都不變）
- **讀照片那一下**（`resolveItem()`）：一次性客人 → 課程照照片按 `guestPick()`，**不走體驗那條路、不看預約來源**；課程認不出來不按。三返～十返照舊問 `notMineHintFor()`（`nthOffered()` 的 `slotOptionsFor()` 02 起認得一次性的健檢），接不上回 `guestHint()`（`{ nth, offered, guest: true }`，那一句講「這位一次性客人在 app 裡沒有接得上的健檢」）
- **一次性的二返接哪一次**：`guestExamChoices(customerId, courseId, ctx, items, row)`（`examChoices()` 的一次性版：`oneTimeExamChoices()`、連同這一批 `afterPhoto()`、自己那一天的健檢 `unsaved`）。
  `guestRow()` 按下去時 `onlyOpen()` 先選；`linkBatchExams()` 整張一起看（一列一列接），一次都接不上 → `guestHint(2)`＋不勾（**不用 `noExam`**：一次性的二返沒接存不下去，「先記也可以」那一句不對）；`refreshNoExam()` 只動那一格旗標；`closeBlockedKeys()` 也認一次性的二返（`guestSecondOf()`）
- **轉成我的客戶之後**：`ONE_TIME_SECOND_PICK` → `guestRow(…, { guestSecond: true })`，課程照照片上那一門二返配得上的、不然第一門（`owedGuestSeconds()` ＝ `oneTimeSecondOptions()`）。
  讀照片那一下：沒有真的二返額度 → 預選它；兩種都有 → `bothSeconds`。`notMineHintFor()` 看到還欠的那一場就不講「沒有二返額度」
- **「記成一次性客人」**：`recordGuestOnPhoto(items, customer, ctx, { key })` —— 認不得、`how === 'none'` 的列重跑 `identifyCustomer()`，認出的是他就 `resolveItem()`（認人認出的 → 照照片勾）；她按的那一列名字改過、認不出來也算他（她選的人：不自動勾）；最後 `linkBatchExams(…, keys)` 只動這幾列
- **合併扣課**：一次性的列跟送的／體驗一樣不進 `mergeRows()`、不標 `mergeOrphan`（不扣，沒有扣兩次的風險）—— issue 沒列，順手補了（測試先紅過）
- **確認層**（`aboveeConfirm.js`）：
  - 認不得那一列（`how === 'none'`）點開多一顆 `[data-abl-guest]`「記成一次性客人」→ 列裡掛 05 的快速表單（`[data-abl-guestform]` 裡的 `[data-gf-form]`，名字、病歷號帶照片上的字，`mountGuestForms()` 每次重畫掛回去）→ 「建立名字卡」→ `createGuest()`：`createWithPlan(oneTimeCustomer(card), { plan: null, quantity: 0, extras: [] })`（key `customer:create-guest`，同日曆新增）→ 換進 `ctx`（額度、來訪都是空的、`whole`）→ `recordGuestOnPhoto()` → `refreshNoExam()`／`refreshCloseBlocks()` → 整頁重畫
  - `WHY_UNKNOWN.none` 與找不到人那一句講兩條路（新增客戶／記成一次性客人）
  - 一次性客人那一列：「要做什麼」是 `guestOptions()`＋`giftFold.coursesHtml()`（`[data-abl-opt="__guest__:<課程>"]`）；一次性的二返「接哪一次健檢」是 `guestExamChoices()`（同一個 `[data-abl-exam]`）；「二返（一次性那一次）」那一顆的小字是「不扣次數」
  - 「是誰」那一位與換一位的結果標 `.guestmark`（`GUEST_MARK`、`chipHtml({ guest })`）
- 確認框（`aboveeConsequences()`）不用改：一次性的段沒有 `entitlementId`，次數的括號本來就數不到（測試釘住）
- `sw.js` v290；spec `96` 與假抄字 `aboveeList-one-time.json` 進 `related.js`；沒有新的 `public/` 檔
- **沒做的**：見 HANDOFF 中途發現段四
