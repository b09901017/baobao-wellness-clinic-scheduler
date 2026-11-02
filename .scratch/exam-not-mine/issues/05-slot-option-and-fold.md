# 05：「做什麼」那一排多一顆、收合改字

Status: done
Blocked by: 02

## 動工前先讀

- `CLAUDE.md` 連動表「額度那一排的順序」「送的／體驗、預設體驗的課、「這一段可以做什麼」那一排」兩列
- `public/js/domain/slotOptions.js`（全部）、`public/js/ui/components/giftFold.js`
- HANDOFF「使用者已經決定的」的收合那一題 —— 她 11/2 回「可以」：`foldOpen()` 不動；「健檢不是我排的」在收合裡再收一層「其他 ▸」（`data-giftfold-group`），點了才出現；選著它時那一層打開

## 她要的

> 1. 日曆新增時，沒有健檢的客人那顆「＋ n返」要直接出現，還是收起來點開才看得到
> ans : 收起來點開才看得到

收合那一顆的字改成「送的／體驗／其他…」：她回「可以」。

## 為什麼會這樣

- **只有壓表（`schedule.js:1576`）與拍 Abovee（`aboveeConfirm.js:761`）叫 `slotOptionsFor()`**；來訪編輯器自己組那一排（`visitEditor.js:692-714`：
  `arrangeSlotOptions([...額度, ＋n返, ...giftOptions()])`），`tests/gift-fold.test.js:112-121` 比的是兩邊排出來一樣（過目 M3）
- 收起來的那幾顆帶 `folded`；`giftFold.html()` 把它們照 `other` 分兩塊（`giftFold.js:43-50`、`:62-70`）：`other:false` 混進第一排（功醫門診、HRV）、
  `other:true` 照 `group` 併進分類那一顆 —— 二返那門課的分類是醫師門診（`seed.js:285`），新的一顆照現在的畫法會被併進「醫師門診 ▾」（過目 M4）
- 壓表與拍 Abovee 那一顆的副字是 `o.isNth || o.isGift ? '不扣次數' : 剩 ${remaining}`（`schedule.js:1302-1303`、`aboveeConfirm.js:583`）—— 新的一顆不認的話印「剩 —」
- `foldOpen()`（`slotOptions.js:183-186`）在這一排沒有任何一顆還有剩的額度時**自己打開**；來訪編輯器沒有額度的客人第一段預設功醫門診體驗（`visitEditor.js:225-229`）→ 一定開著；
  拍 Abovee 同樣開著。既有行為被測試釘著（`tests/gift-fold.test.js:131-133`、`:142-144`；E2E `67` 的 G6、G13、G14，`49-uncounted-course.spec.js:221`）（過目 M5）

## 要做的

- 一支獨立的函式產生那一顆（例如 `notMineOption(courses)`）：`slotOptionsFor()` 與來訪編輯器的 `entRow()` **都叫它**。**不要塞進 `giftOptions()`** ——
  那一組每一顆都是 `isGift`，壓表會把它當 `giftCourseId` 交出去（`schedule.js:2199`），`defaultGiftCourse()` 也讀那一組
- 那一顆：值是一個新的常數（像 `NTH_PICK` 那樣帶底線前綴、不是任何 id）、字「健檢不是我排的」、**自己的旗標（不帶 `isNth`／`isGift`）**、`folded`；二返那門課找不到（或兩門以上）就不畫
- 壓表與拍 Abovee 那兩處副字認新的旗標（「不扣次數」）
- `giftFold.html()` 多第三塊「其他 ▸」：**收合裡再收一層**，用既有的分類那一套（`data-giftfold-group`），點了才露出「健檢不是我排的」；這一段選著它時那一層一打開就是開的。`arrangeSlotOptions()` 把它單獨排在收合的最後
- `giftFold.js` 那一顆的字改成「送的／體驗／其他…」。字有三種形狀（`giftFold.js:81-85`）：開著「送的／體驗 ▾ 收起來」、收著且選了一門「X 送的／體驗 ▸」、其餘「送的／體驗…」——
  三種都要改；`grep "送的／體驗"` 不要只 grep「送的／體驗…」
- `foldOpen()`：**既有的判斷不動**；收到新的那個值時回 true（同 `giftCourseIdOf` 那一條，不動既有行為）
- 這一顆的值在畫面上只活一下，組時段時換回 `examNotMine: true`＋第幾返（02 的 `slotFromPicks()`）

### 會紅的既有測試（過目 S13，改的時候逐一看是該改測試還是改錯了）

- 改字：`tests/gift-fold.test.js:159`、`:198`、`:217`、`:218`；`tests-e2e/specs/67-gift-and-trial.spec.js:394`
- 多一顆：`tests/gift-fold.test.js:47`（假設收起來的每一顆都是 `isGift`）、`:52`（第一排剛好四門）、`:112-121`；`tests/uncounted-courses.test.js:123-124`

## 判準

- 一般的客人（有額度、有健檢）一打開那一排，畫面跟現在一樣嗎？（只有收合的字變了）
- 那一顆選了，三個入口組出來的時段一樣嗎？（同一支）
- 那一顆會不會被當成額度 id 去查（`entitlements.find()`）？

## 做完時留下的

- `slotOptions.js`：
  - **`NOT_MINE_PICK = '__notmine__'`**（那一排上的值，跟 `NTH_PICK` 同一種底線前綴；`giftCourseIdOf()` 對它回 null）
  - **`notMineOption(courses)`**：`{ entitlementId: NOT_MINE_PICK, label: EXAM_NOT_MINE_LABEL, remaining: '—', durationMin, course: 二返那門課,
    entitlement: null, isNotMine: true, folded: true, extra: true }`；`examNotMineCourse()` 不是剛好一門（含停用）→ `null`。**旗標是 `isNotMine`**（不帶 `isNth`／`isGift`）
  - `slotOptionsFor()` 最後接 `notMineOption()`（有才接）；來訪編輯器的 `entRow()` 由 06 接（05 沒動編輯器 —— 接上卻沒接 `readDraft()` 的話按下去是壞的）
  - `arrangeSlotOptions()`：`extra` 那幾顆排在收合的最後、不照分類，`group` 是 **`EXTRA_GROUP = '其他'`**；前兩組改成 `!o.extra` 才收
  - `foldOpen()`：既有判斷不動，多一條 `value === NOT_MINE_PICK` → true
  - `trialFromMinutes()`：`NOT_MINE_PICK` 不換
- `giftFold.js`：第三塊「其他 ▸」＝分類那一套：**`data-giftfold-group="extra"`** 的鈕（字讀 `group`）、**`<div data-giftfold-in="extra">`** 那一層；
  value 是 `extra` 那一顆時那一層一打開就是開的、鈕是 `aria-pressed="true"`（09 照這個認：重畫時傳 `value` 就對，不用另外開）。
  `toggle()`／`sync()` 一個字都沒改（分類那一套本來就認字串 key）。`foldLabel()` 三種字都改「送的／體驗／其他」
- 副字：壓表 `schedule.js`、拍 Abovee `aboveeConfirm.js` 認 `o.isNotMine` → 「不扣次數」；編輯器本來就照 `o.entitlement` 判
- **拍 Abovee 的確認層暫時濾掉那一顆**（`aboveeConfirm.js` 的 `optionsFor()` 最後 `.filter((o) => !o.isNotMine)`）：`pickOption()` 還認不得它，按了會清空那一列 —— **09 接上時拿掉那個 filter**
- 改的既有測試：`gift-fold.test.js`（收起來的最後一顆是 `isNotMine`、第一排濾 `extra`、編輯器組法加 `notMineOption()`、三種字）、
  `uncounted-courses.test.js`、`slot-options-order.test.js`（同樣兩處）、E2E `67` 的 G12 那一句字
- 新測試 `tests/exam-not-mine-option.test.js`（18 支）：那一顆的形狀、不撞值、不是剛好一門／停用不畫、一般的客人上面那一排不變、沒額度沒健檢的客人也只在收合裡、
  編輯器組法跟壓表一樣、`defaultGiftCourse()` 不變、`foldOpen()` 三種、`trialFromMinutes()`、畫法（「其他」鈕、那一層藏著、不被併進醫師門診、選著時開著、收著時開關寫它、二返不是一門時沒有）
- E2E 跑了 `49`、`56`、`67`、`72`：27 passed
- `public/sw.js` v212 → v213、`npm run shell:snapshot`

