# 一次性客人 —— 段五審查（2026-11-05）

範圍：這一條分支自己的 diff（`git diff origin/develop...HEAD`；開工時把 develop 的 PR #208、#209 合進來，`c06e7867`，只動 `.gs` 與它的測試，沒有衝突）。
方法：`/matt-code-review` 兩軸各一個 subagent（Standards：`CLAUDE.md` 連動表、`docs/agents/lessons.md`、`CONTEXT.md`＋Fowler 味道；Spec：spec.md、ADR-0172、issue 01–08），
主控自己對整輪的判準、虛擬那一對、名單、拍 Abovee、試算表、文件，再拿 node 腳本 import 真的那幾支重現（腳本不進 repo；輸入是假資料「客戶A」）。

**每一條都對過程式碼；標「重現」的跑過。** 段六照這一份修：每條先紅燈、照 `ripple-check` 查牽連。R1–R3 動到存檔驗證與 domain，照 CLAUDE.md 先開一支 `issues/09-review-fixes.md`（編號照這一份）。

- 段四的 CI 全量 E2E run `41990743459`（`cfb60ed3`）：**六台全綠**
- 合進 develop 之後 `npm test`：5712 支全過、**skipped 0**

## 判準

整輪的那一句（ADR-0172）：**這一行會不會讓一位一般客戶或一段沒有標記的段被放寬、被藏起來，或讓一次性的段被算進任何一筆真的額度、出現在試算表上？**
R1、R2 違反它（一筆購買被藏起來、一次性客人的段扣了真的額度）；其餘是死路、講錯的句子、文件不實。

## 段六要修的

| # | 嚴重 | 在哪裡 | 一句話 |
|---|---|---|---|
| R1 | **高** | 拍訂購單（`orderForm.js` `sameNameCustomers()`、`orderConfirm.js`、`customers.js:235`） | 同名的一次性客人變成「加購到那一位」，額度加到一張還是一次性的卡上，哪一份名單都看不到 |
| R2 | 中 | `visits.js:1755` 驗證、`visitEditor.js:232`／`:332` 預設 | 一次性客人身上有一筆真的額度時，沒標記、扣著它的段存得下去 |
| R3 | 中 | `home.js:2714` `bookFollowup()`、`:1269` `labelGuestBookings()` | 轉成我的客戶之後，一次性那一次健檢的「約二返」按「去壓表」是死路 |
| R4 | 中低 | `calendar.js:1954` `newGuest()` | 「已建立名字卡」帶復原（段四第 1 條）—— 關掉 |
| R5 | 低 | `visits.js:1964`、`:1965` `oneTimeErrors()` | 轉成客戶之後改以前的一次性段、按真的額度 → 擋下來那一句沒講怎麼辦（段三第 2 條） |
| R6 | 低 | `consequences.js:1587` `toMyCustomerConsequences()` | 轉成客戶的確認框第一句講過頭（沒額度不會進問時間、壓表） |
| R7 | 低 | `customerDetail.js:590` `convertToMine()` | 轉完那一則有「復原」，確認框卻講「轉不回去」 |
| R8 | 低 | `calendar.js:1901` `pickCustomer()` | 打的字是某位客戶名字的一部分時，「＋ 新增一次性客人」不出來 |
| R9 | 低 | `customers.js:74`、`customerDetail.js:580`、`:591` | 文案用「妳」；app 其餘全用「你」（develop 上 `public/js` 一個「妳」都沒有，「你」126 處） |
| R10 | 低 | `consequences.js:262`、`:542` | 一次性客人存 n返，確認框照講「客戶身上的數字一個都不會變」（issue 06 要「不講任何次數」） |
| R11 | 低 | `health.js:2331` `checkEecpTrialCourse()` 的 `moved()` | 把一次性的段寫成 `giftKind: 'trial'`（下一次存那一天就被擋）—— 很少會發生 |
| R12 | 低 | `CLAUDE.md` 一次性客人那一列、`slotDraft.js:154` 註解 | 「接在一次性健檢上的 n返 只在 `slotFromPicks()` 一處判」不是真的 |
| R13 | 低（判斷） | `visitEditor.js:769` `secondOptionsFor()` | 「做什麼」那一排的兩顆在畫面裡自己組，不在 `slotOptions.js` |
| R14 | 流程 | worktree 根目錄的 `.local` 連結 | 跟 `docs/agents/lessons.md` 第十六節、`tests/helpers/localDir.js` 的警告衝突 |

---

### R1（高）拍訂購單：同名的一次性客人被當成「加購到那一位」

- **在哪裡**：`ui/views/customers.js:235` 把 `ctx.rows`（`data.list()`，含一次性客人）當 `existing` 交給 `openOrderConfirm()`；
  `domain/orderForm.js:494` 的 `sameNameCustomers()` 只濾刪掉的；`ui/components/orderConfirm.js:248` 起畫成「加購到 客戶A・還沒買過東西」（沒有「一次性」標記）；
  `blockersOf()` 接受她點那一位；存的那一下 `addEntitlements(target.id, …)`（`orderConfirm.js:617`）。
- **什麼情境會錯**：一次性客人（員工券來過一次）後來真的買了方案，她拍那張訂購單。名字一樣 → 卡片上兩顆「加購到 客戶A」「新增一位」，她很自然點第一顆（就是同一個人）。
  額度寫進一張 `oneTime: true` 的卡：客戶清單、壓表、問時間、試算表全部跳過他（每一處明寫 `isOneTime()`），名字卡那一頁不畫額度 —— **那一筆購買在 app 上哪裡都看不到**。
  接著她從日曆替他排一段，來訪編輯器拿那一筆當預設、那一段沒標一次性、扣著真的額度存得進去（見 R2）。
  也違反 spec 第 7 題「不給……加購」、ADR-0172 決定一（加購在「每一處明寫 `isOneTime()`」那份名單上）、CLAUDE.md 那一列「新增一份會列客戶的名單要回來想他列不列」。
- **重現**：`sameNameCustomers('客戶A', [一次性的客戶A, 一般的客戶B])` 回那一位一次性客人；`blockersOf({ who: 那一位 })` 回 `[]`（按得下去）。spec 軸的 subagent 另外獨立跑出同一個結果。
- **建議怎麼修**（照她說過的規則推得出來，不用問她）：
  1. 拍訂購單的同名比對**不收一次性客人**（`sameNameCustomers()` 濾 `isOneTime()`，或 `openOrderConfirm()` 收到之前濾 —— 選一處、測試釘住）
  2. 那一張卡的名字照片上跟一位一次性客人同名時，講 spec 第 6 題那一句（`GUEST_SAME_NAME`：去名字卡按「轉成我的客戶」）—— 跟新增客戶同一句；
     「新增一位」那一條走 `customerForm.js` 的 `fieldWarnings()` 本來就會講，**要確認拍訂購單那一層的 ⚠ 與存檔前那一道真的畫出來**
  3. `SPEC.md` 規則 13「不給……加購」補「拍訂購單也一樣」；CLAUDE.md 一次性客人那一列的名單補「拍訂購單的同名比對」
  - 另一條路（她要的話才做）：保留那一顆、寫成「加購到 客戶A（一次性客人 → 一起轉成你的客戶）」、存的時候 `customerChanges: toMyCustomer()` 同一個 commit。
    這是第二個「轉成我的客戶」的入口，spec 第 6 題沒談到，所以**預設照上面那三步**
- 測試：單元（`sameNameCustomers()`／`blockersOf()` 帶一位一次性客人）；手動驗收清單加一步（見最後）。

### R2（中）一次性客人身上一旦有真的額度：沒標記、扣著它的段存得下去

- **在哪裡**：`domain/visits.js:1755` 只擋「一次性客人身上**沒有標記也沒有額度**的段」；`ui/views/visitEditor.js:232`（`blankVisit()`）與 `:332`（`withNewSlot()`）
  一次性客人有額度時照樣拿 `entitlements[0]` 當第一段的預設，`blankSlot()` 只在 `guest && !entitlement` 時標一次性；`guestRow()` 那一排一顆都沒按著，但藏著的那一格值就是那一筆額度。
- **什麼情境會錯**：R1 那一筆額度（或任何一條以後替他加額度的路）→ 日曆替他排一段 → 存下去的是一段沒標一次性、扣真的額度的段。試算表因為他是一次性客人整個跳過，次數在 app 上也看不到。
  ADR-0172 決定一要「哪天有人替他加了一筆也不會漏出來」—— 名單做到了，存檔那一道沒有。
- **重現**：一次性客人＋一筆復能額度＋一段沒標記、扣那一筆、器材選好的段 → `validateVisit()` 的 errors 是 `[]`。
- **建議怎麼修**：
  1. 驗證：一次性客人身上**任何一段沒標一次性**就擋（拿掉 `&& !slot.entitlementId`；句子照舊「一次性客人的段要標成一次性」）。一次性客人沒有合法的「一般的段」—— 轉成客戶之後 `isOneTime()` 就是 false，不會誤擋
  2. 來訪編輯器：一次性客人（`isOneTime(customer)`）**永遠不拿額度當預設**（`blankVisit()`／`withNewSlot()` 的 `first` 對他是 `undefined`）
- 判準問句：這一改會不會擋到轉成客戶之後的人？（不會：他的 `oneTime` 是 `false`）

### R3（中）轉成我的客戶之後：一次性那一次健檢的「約二返」按「去壓表」是死路

- **在哪裡**：`ui/views/home.js:2714` `bookFollowup()` 只看**現在**是不是一次性客人；`:1269` `labelGuestBookings()` 同一個判斷。
- **什麼情境會錯**：她把一位一次性客人轉成自己的客戶（確認框也說「要先加購才排得進壓表」），還沒加購。他當一次性客人時的健檢做完、報告勾了 → 長「約二返」。
  按鈕是「去壓表」→ 壓表那一批沒有他（`batchRows()` 只接 `totalRemaining > 0` 的人）→ 停在那個月、沒有人被選起來 —— 過目第 5 條那一種死路，只是換成轉過的人。
  就算他已經加購、在壓表上，`bookFollowup()` 找不到配那一次健檢的真的二返額度，「二返（一次性那一次）」也不會先選好。
- **重現**：轉成客戶、沒有額度的人 → `buildCustomerQueue({ includeUsedUp: true })` 有他但 `totalRemaining` 是 0 → `batchRows()` 不接（讀過 `scheduling.js` 的 `batchRows()`）。spec 軸 subagent 獨立指出同一件事。
- **建議怎麼修**：「這一張待辦接的那一次健檢是一次性的健檢」（`nthFollowup.js` 的 `isOneTimeExamVisit(exam, entitlements, coursesById)`）→ 一樣走「去日曆排」
  （日曆新增的來訪編輯器已經有「二返（一次性那一次）」，`secondOptionsFor()`）。`labelGuestBookings()` 照同一個判斷換字 —— 那一支現在只讀客戶清單，要多讀那幾張待辦的健檢來訪
  （或把判斷收成一支 `bookFollowup()` 與換字共用，免得兩邊講兩種話）。操作手冊七之六「他的健檢、二返」補一句轉了之後也是去日曆排。

### R4（中低）日曆新增「已建立名字卡」帶復原（段四中途發現第 1 條）—— **建議關掉**

- **在哪裡**：`ui/views/calendar.js:1954`，`toast.withSaveState()` 沒給 `undoable`（預設 `true`，`toast.js:261`）。拍 Abovee 那一份（`aboveeConfirm.js` 的 `createGuest()`）給了 `undoable: false`。
- **什麼情境會錯**（對過程式碼路徑，沒在模擬器按）：按「復原」→ 那一筆客戶文件被軟刪除、畫面 `router.reload()`；
  接著排的那一張是掛在 `document.body` 上的面板（`sheet.js` 的 `openSheet()`），不跟著收；來訪編輯器開的時候讀過客戶（`visitEditor.js:136`），存檔不再問他還在不在 →
  存得下一段指著已刪客戶的來訪（日曆照畫、名字卡那一頁進不去、ADR-0109「還掛著來訪就刪不掉」被繞過）。同一個動作兩份寫法已經走岔（lessons 第一節）。
- **建議**：`undoable: false`，註解照拍 Abovee 那一份（建錯了去名字卡那一頁刪）。不用問她（理由同段四已經關掉的那一份）。

### R5（低）轉成客戶之後改以前的一次性段、按真的額度：擋下來那一句換成「怎麼辦」（段三中途發現第 2 條）

- **擋是對的**：她第 6 題選了「以前的那幾段照舊算一次性、不扣之後買的額度」；安靜地拿掉那一格就是讓一次性的段被算進真的額度。**不改擋法，只改句子。**
- **在哪裡**：`domain/visits.js:1964` `oneTimeErrors()` 現在講「一次性的段不扣任何次數，不可以同時指定額度」；`:1965` 送的／體驗同一個形狀（轉成客戶之後那一排有「送的／體驗…」，按了也擋）。
- **重現**：轉成客戶（`oneTime: false`）、一段 `oneTime: true` 扣一筆真的額度 → errors 是「一次性的段不扣任何次數，不可以同時指定額度」。
- **建議的句子**：額度那一句「這一段是當一次性客人時記的，不扣次數 —— 要扣次數就取消這一段、另約一段」；送的／體驗那一句「這一段是當一次性客人時記的，不是送的也不是體驗 —— 要改就取消這一段、另約一段」。
  （那兩道也擋組時段漏了的程式錯，句子對那種情況也講得通。）找一下有沒有測試比原句（11/5 grep 沒有比全句的）。

### R6（低）轉成我的客戶的確認框第一句講過頭

- **在哪裡**：`domain/consequences.js:1587`「會出現在客戶清單上，也會進壓表、問這輪的時間、試算表的名單」。
- **什麼情境會錯**：轉了、還沒加購的人：`customersToAsk()` 要身上有剩的才列（重現：0 位）、壓表那一批也不接（R3）。ADR-0070：只講真的會發生的事；第二句只替壓表補了「要先加購」。
- **建議**：前兩句合成「會出現在客戶清單與試算表上；他身上還沒有任何額度 —— 加購之後才會進壓表、問這輪的時間」。

### R7（低）轉完那一則有「復原」，確認框講「轉不回去」

- **在哪裡**：`ui/views/customerDetail.js:590`（`withSaveState()` 沒給 `undoable`）對 `consequences.js` 最後一句「轉了就不能轉回一次性客人」。spec 第 6 題「不做轉回去」。
- **建議**：`undoable: false`（同 R4）。

### R8（低）「要幫誰排？」打的字是某位客戶名字的一部分時，「＋ 新增一次性客人」不出來

- **在哪裡**：`ui/views/calendar.js:1901`：那一顆只在「一位都找不到」時畫；找人是 `nameHas()`（包含就算）。
- **什麼情境會錯**：一次性客人叫王小（假名），清單上有王小明 → 打「王小」列出王小明 → 那一顆不出來。要先多打一個字讓它找不到、再在表單裡把名字改回來。
- **重現**：`nameHas('王小明', '王小')` 為真 → 列出一位 → 那一顆不畫。
- **建議**：列出來的人裡**沒有一位名字跟打的字一模一樣**（`identify.js` 的 `normalizeName()` 比）就在清單底下照樣畫那一顆。spec 第 4 題寫「找不到時」—— 這樣改是「找不到這個名字」，不是「找不到任何人」。

### R9（低）文案「妳」→「你」

`domain/customers.js:74`（`GUEST_SAME_NAME`）、`ui/views/customerDetail.js:580`（確認框標題）、`:591`（toast）。同一輪別處（拍 Abovee「不是你的客人」、編輯器「健檢不是你排的」）用「你」。

### R10（低）一次性客人存 n返，確認框照講次數

- **在哪裡**：`domain/consequences.js:262`（`bookingConsequences()`）與 `:542`（`aboveeConsequences()`）。帶「健檢不是我排的」的已經跳過（`:536` 的 `isExamNotMine()`），一次性的沒有。
- **重現**：一次性客人存一段一次性的三返 → 最後一句「三返是加約的 —— 這一場不扣任何次數，客戶身上的數字一個都不會變」。issue 06 要「不講任何次數」；他身上本來就沒有數字。
- **建議**：兩處都跳過 `isOneTimeSlot()` 的段（跟 `isExamNotMine()` 同一個寫法）。

### R11（低，很少會發生）資料健檢「EECP體驗 搬到 EECP」把一次性的段寫成體驗

- **在哪裡**：`domain/health.js:2331` `moved()`：`giftKindOf(slot) ?? 'trial'` —— 一次性的段 `giftKindOf()` 回 `null`，於是寫成 `'trial'`；修正是直接寫整包 `slots`，不過 `validateVisit()`。
- **什麼情境會錯**：她的主檔上還有舊的「EECP體驗」那一門而且還開著、有一位一次性客人被排在那一門 → 按那一顆 → 那一段變成「一次性＋體驗」，下一次存那一天被 `oneTimeErrors()` 擋。
  正式站切換之後那一門多半已經收掉（`checkEecpTrialCourse()` 第一行就回空），所以排在最後。
- **建議**：`moved()` 對 `isOneTimeSlot()` 的段 `giftKind` 寫 `null`（一次性的段只換課程與時長）。同一個形狀查過：資料健檢別的修正沒有寫 `giftKind`；存檔的 `withGiftKinds()` 對一次性的段寫 `null`，沒事。

### R12（低）CLAUDE.md 那一列有一句不是真的

- 一次性客人那一列寫「接在一次性健檢上的 n返 也標一次性，**只在 `slotFromPicks()` 一處判**」，`slotDraft.js:154` 的註解也說「三個入口都經過這裡，不各判一次」。
  實際上來訪編輯器的 n返 那一條自己組時段（`readNthSlot()`，不經過 `slotFromPicks()`），在 `visitEditor.js:1506` 又判了一次。驗證照樣擋得住（`validateVisit()` 的 n返 那一道），所以只是文件與註解不實。
- **建議**：改文件與註解（「`slotFromPicks()` 與來訪編輯器的 `readNthSlot()` 兩處，都問 `isOneTimeExamVisit()`；`validateVisit()` 擋對不上的」）—— 不建議為了這一句把 `readNthSlot()` 改走 `slotFromPicks()`（n返 那一條的時長、快照另有寫法，風險比收益大）。
- 其餘那一列講的函式名、行為逐條 grep 過，對得上（見最後「對過沒事的」）。

### R13（低，判斷）`secondOptionsFor()` 在畫面裡自己組兩顆

`visitEditor.js:769`：「二返（一次性那一次）」的保底那一顆與「課程（一次性）」那一顆在畫面裡組。CLAUDE.md「送的／體驗…」那一列：「那一排有哪幾顆只寫在 `slotOptions.js`」。
建議：`oneTimeSecondOptions()` 多收 `keep`（這一段現在就是它時照樣列），「課程（一次性）」那一顆也收進 `slotOptions.js` 一支。不修也不會錯，只是以後改字要改兩處 —— 段六有餘力再做。

### R14（流程）worktree 裡那個 `.local` 連結

- HANDOFF「共同的規矩」寫「worktree 根目錄有一個目錄連結 `.local` → 主資料夾的 `.local`……不要刪那個連結」；同一天 5 分鐘後進 develop 的 `d1eb79f2` 寫了反過來的規矩：
  `docs/agents/lessons.md` 第十六節「**不要在 worktree 裡建指向主資料夾 `.local` 的 junction／symlink 一直放著**：有些刪 worktree 的方式會順著連結刪進去，刪掉的是她唯一的一份真資料」，
  `tests/helpers/localDir.js` 也改成自己去主資料夾找（所以連結已經不需要）。
- **建議**：段六（或主控收 worktree 之前）`cmd /c rmdir .local`（只拆連結），再跑 `node --test tests/no-secrets.test.js` 確認照樣 skipped 0。HANDOFF 的共同規矩已經註明。
  **收這個 worktree 之前一定要先拆。** 段五沒有動它（不在這一段的範圍，HANDOFF 原本寫不要刪）。

---

## 兩軸的原始報告（輕整理；上面那張表已經合過、重現過）

### Standards

- 硬：拍訂購單同名比對含一次性客人（→ R1）；建名字卡兩份寫法走岔、日曆那份有復原（→ R4），轉成客戶有復原對「轉不回去」（→ R7）；
  `secondOptionsFor()` 在畫面裡組選項（→ R13）；`readNthSlot()` 又判一次 `isOneTimeExamVisit()`，跟 CLAUDE.md 那一列不一樣（→ R12）
- 判斷：`<span class="guestmark">一次性</span>` 寫了七次（可以抽一支，不修不會錯）；`courseIdForNth()`／`isOneTimeExamVisit()` 同一個迴圈；
  `validateVisit()` 投影兩次（`visitErrors()`、`assignmentWarnings()` 各一次，量不大）；日曆新增名字卡那一張多一句常駐的 `setNote()`（同一支的選人那一張本來就有一句，照舊）；
  文案「妳」（→ R9）；療程單的「是誰」（`sheetConfirm.js:220` 附近）列得到一次性客人但沒標 —— spec 第 5 題只要日曆新增與拍 Abovee 換一位標，**不算錯**，順手的話照 `.guestmark` 標
- 不報（對過）：`__guest__:` 前綴（有 `__course__:` 前例）；`scheduling.js` 五處各自明寫（規矩要求）；`sw.js` 版號／SHELL／快照、`FIELD_LABELS.oneTime`、`withSaveState` 的 key、`cannotClose()` 的 `coursesById`、`chainInputs()` 第三個參數

### Spec

- (a)＋(c) 拍訂購單沒排除一次性客人，排除之後還會一路錯下去（→ R1、R2）
- (c) 轉成客戶確認框第一句講過頭（→ R6）
- 待確認 → 主控重現了：一次性客人存 n返 照講次數（→ R10）；轉成客戶、還沒加購的人「約二返」去壓表是死路（→ R3）
- (b) 多做的：沒有（名字卡那一頁的「變更紀錄」、拍 Abovee 的 `bothSeconds`、n返 的反向擋都沒有放寬一般的客人或段）。「不做的」四件都沒做

## 段五另外判斷的兩件（HANDOFF 中途發現）

| 哪一條 | 判斷 | 理由 |
|---|---|---|
| 段三第 2 條（轉成客戶之後改以前的一次性段、按真的額度被擋） | **擋法不改、句子換**（R5） | 她第 6 題選了以前的段照舊算一次性；擋下來那一句要講「取消這一段、另約一段」 |
| 段四第 1 條（日曆新增「已建立名字卡」的復原） | **關掉**（R4） | 跟拍 Abovee 那一份同一個理由；留著會繞過「還掛著來訪就刪不掉」 |

## 對過沒事的（不用再查）

- **虛擬那一對**：`withOneTimeChain()` 沒有一次性的段時回傳進來的同一個陣列；冪等；`examNotMine`、n返、已帶真額度的段不填。
  鏈的函式回給呼叫端的 `visit`／`slot`／`exam` 都經 `originalOf()` 換回原本那一份（`strandedFollowups()`、`doneAheadOfExam()`、`doubleClaimedExams()`、`bookedFollowupFor()`）；
  `examChoicesFor()`／`examChoicesForNth()`／`oneTimeExamChoices()` 只回 id 與日期；`syncFollowupTasks()` 只回任務；`chainAfterEntitlements()` 回的是讀回來的那一份。
  **存檔**：`countOps()` 一進來 `assertNoOneTimeIds()`（`save()`／`remove()`／`restore()` 都經過）；`rebookSlot()`、拍 Abovee 改期（`...old`）、資料健檢直接寫 `slots` 的那幾條都拿存著的那一份，帶不進那一對的 id
- **名單**：`customersData.list()` 的每一個呼叫端對過 —— 客戶清單三份互斥（`inCustomerList()`）、壓表那一批（`buildCustomerQueue()`＋`batchRows()`）、問時間兩支、壓表登記、
  時段反查（`backfill.js` → `candidatesFor()`）、看這個月的進度、長備註寫給誰、手動貼上、資料健檢問時間那一項、試算表兩條路都明寫排除；
  找人的四處（日曆新增、批次取消、隨手記掛給誰、拍 Abovee 換一位）列得到而且標。**漏的只有拍訂購單（R1）**。
  `audit.js`（名字）、`customersBulk.js`、新增客戶頁（同名提醒）、療程單、待辦首頁那幾支（`loadReviewNames()`、`loadGivableBags()`）列他沒有錯
- **`slotFromPicks()`／`validateVisit()`**：一次性的二返沒接健檢也不是 `examNotMine` → 組時段 `stop()`、驗證 `oneTimeErrors()` 兩道都擋；接在一次性健檢上的 n返 不標 → 驗證擋；
  一般客戶與沒有標記的段一道都沒放寬（`要選一個額度` 只對一次性客人跳過）
- **轉成客戶之後的編輯器**：以前的一次性段改時間（`readGuestSlot()`）、以前的「健檢不是我排的」段（`readNotMineSlot()` 的 `base` 帶著原本那一格）、以前的 n返（`readNthSlot()` 重判）都留著 `oneTime`
- **拍 Abovee**：`guest`／`guestCourseId`／`guestSecond`／`bothSeconds` 在 `resolveItem()` 的 `next`、`pickOption()` 的 `base`、`asRecorded()` 三處清（`guest` 是客人的屬性，`asRecorded()` 刻意不清）；
  `recordGuestOnPhoto()` 只動「認不得、`how === 'none'`」而且重認出是他（或她按的那一列）的列；`linkBatchExams(…, keys)` 只動那幾列；合併扣課不收一次性的列
- **試算表**：`sheetVisits()` 混著一般與一次性的那一天先 `withSlotStatuses()` 再拿掉一次性的段、整筆照留下的重推；兩條路的次數、矩陣、註記都吃濾過的那一份，
  待辦（`taskBlocks()`）吃沒濾過的那一份（`guestTask()` 看得到那一天的段）
- **月底對帳**：`guestItem()`／`guestSlot()` 用到的 `customersById`、`slot` 都在範圍裡；次數表兩側都不數一次性的段
- **文件**：`SPEC.md` 規則 13、5.3 節、8.5／8.6 節；操作手冊七之六的按鈕字（「＋ 新增一次性客人」「建立，接著排」「記成一次性客人」「建立名字卡」「看一次性客人」「轉成我的客戶」「新增來訪」）對得上畫面

## 手動驗收清單要加的（段六修完之後，接在 HANDOFF 草稿 15 步後面）

16. （R1）客戶 → 右下角相機那一顆 → 拍訂購單 → 照片上的名字是一位一次性客人的名字 → 卡片上**沒有**「加購到 客戶C」那一顆、名字旁邊 ⚠ 講「有一位同名的一次性客人…轉成我的客戶」
17. （R3）把一位有做完的一次性健檢的一次性客人轉成我的客戶（不加購）→ 待辦「約二返」那一列的按鈕寫「去日曆排」→ 按 → 日曆新增、他已經選好、「做什麼」那一排有「二返（一次性那一次）」
18. （R4）日曆新增一位一次性客人 → 底下那一則「已建立名字卡」**沒有**復原
19. （R8）清單上有王小明（假名）→ 日曆新增「要幫誰排？」打「王小」→ 王小明列著、底下照樣有「＋ 新增一次性客人「王小」」

（選擇器段六走過再寫進清單。）
