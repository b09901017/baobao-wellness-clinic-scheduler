# 上 main 前最後健檢 第 1 組：一次性客人（PR #210、#212）

2026-11-07。查的是 develop `a8081e6b`（＝這個 worktree 的 HEAD）。**只查、只寫報告**：app 的程式一個字都沒改、沒有 commit。
對照基準：`.scratch/one-time-guests/spec.md`、`HANDOFF.md`、`REVIEW.md`（R1～R14）、`issues/01～09`、ADR-0172、`CLAUDE.md`「一次性客人」「健檢不是我排的」「健檢與二返的關係」三列。
做法：照 `ripple-check`，CodeGraph 用這個 worktree 自己的索引（`codegraph init --yes`，575 個檔）查呼叫端，再拿 grep 對一次；能跑的都跑過（node 腳本、Firestore 模擬器）。
名字一律假的（客戶A）；沒有讀 `.local/`、沒有碰 staging。

**一句話：沒有找到要在合進 main 之前修的。** 段五審查列的 R1～R12 都真的修好了（R13 是當時就決定不做的判斷題，R14 也確認了），
之後平行合進來的 #211～#224 沒有一支踩到一次性客人的規則。只有一件小的可以之後再做。

| 段 | 幾條 |
|---|---|
| 合進 main 之前建議修 | **0** |
| 可以之後再做 | **1**（批次建立打到一次性客人的名字，講不清楚那一位在哪裡） |
| 查過沒事的 | 見第三段（四件事逐項列） |

CI 在 develop `a8081e6b` 上：全量 E2E run `42337540955` **六台全綠**（含 `40`、`94`、`95`、`96` 那幾支一次性客人的），「測試與部署」run `42334077682` 綠。

---

## 一、合進 main 之前建議修

沒有。

---

## 二、可以之後再做

### 1. 批次建立打到一次性客人的名字：只講「已經有 1 位叫這個名字」，那一位在客戶清單上找不到

- **PR／檔案**：#210 沒有碰到的既有入口 —— `public/js/domain/bulkCustomers.js:86`（`duplicatesOf()` 數同名時把一次性客人也算進去）、`public/js/ui/views/customersBulk.js:262`（`dupText()`）
- **看到什麼**：新增客戶那一頁打到一次性客人的名字，⚠ 講的是 `GUEST_SAME_NAME`（「有一位同名的一次性客人 —— 要把他轉成你的客戶…按『轉成我的客戶』」，spec 第 6 題）；
  **批次建立**打同一個名字只講「已經有 1 位叫這個名字 —— 確認不是同一個人」。而一次性客人不在客戶清單平常那一份上，她回清單找會找不到「那 1 位」
- **怎麼重現**：
  ```bash
  node .scratch/final-check-2026-11-07/probe-bulk-same-name-guest.mjs
  ```
  實際輸出：
  ```
  批次建立 duplicatesOf： {"inList":0,"existing":1} → 畫面上那一句： 已經有 1 位叫這個名字
  新增客戶 fieldWarnings： 有一位同名的一次性客人 —— 要把他轉成你的客戶，去客戶清單最底下「看一次性客人」點他、按「轉成我的客戶」
  新增客戶有講「轉成我的客戶」： true
  ```
- **為什麼不急**：不會寫錯任何資料 —— 照樣有提醒、照樣建得了（跟新增客戶一樣不擋）。最壞的情況是她用批次建立替一位一次性客人另建一位一般客戶（同一個人兩份），而不是把他轉過來；批次建立是切換那天用的入口，上線之後很少用
- **建議怎麼修（小，半小時內）**：`duplicatesOf()` 把同名的一次性客人分開數（例：`{ inList, existing, guests }`），`dupText()` 有 `guests` 時接 `GUEST_SAME_NAME` 那一句；
  `tests/one-time-name-card.test.js` 加一條。CLAUDE.md「一次性客人」那一列「新增客戶打到同名的一次性客人講 `GUEST_SAME_NAME`」後面補「批次建立也是」

---

## 三、查過沒事的

### 1. 有沒有做到她要的（spec 8 題、HANDOFF 的決定、R1～R14）

| 她要的 | 在哪裡、怎麼查的 | 結果 |
|---|---|---|
| 第 1 題：一張名字卡、不在任何名單、沒有額度 | `domain/customers.js:26` `oneTimeCustomer()`（只有名字、病歷號、電話、LINE 名字、警示＋`oneTime: true`）；名單排除逐處見下面第 2 件 | 對 |
| 第 2 題：客戶清單最底下「看一次性客人」、「看已停用的」一起搬下去、三份互斥 | `domain/customers.js:63` `inCustomerList()`；`ui/views/customers.js:288`、`:358`（`guestCard()`） | 對 |
| 第 3 題：健檢在 app 裡跟一般客人一模一樣、一次健檢欠一場二返；不在 app 裡走「健檢不是我排的」 | `domain/oneTimeChain.js:91` `withOneTimeChain()`（總數＝還算數的一次性健檢段、二返同數）；鏈的函式進來先套、回去 `originalOf()` 換回原本那一份（`followups.js:140`、`:500`、`:516`、`:542`、`:594`、`:661`、`:686`、`:728`、`:813`、`:904`） | 對 |
| 第 4 題：日曆新增「＋ 新增一次性客人『X』」、拍 Abovee「記成一次性客人」、壓表不做、不看預約來源猜、「做什麼」列全部的課 | `ui/views/calendar.js:1892`（`offersNewGuest()`）、`:1932` `newGuest()`；`domain/slotOptions.js` `guestOptions()`；拍 Abovee 只在她按了才建（`aboveeImport.js:1335` `recordGuestOnPhoto()`） | 對；**另外實際跑了一次**：種子上每一門還在用的課（二返以外 19 門）替一次性客人組一段、過 `validateVisit()`，**19 門都存得下去**、形狀都是 `oneTime: true`＋`entitlementId`／`giftKind` 是 null（`node .scratch/final-check-2026-11-07/probe-guest-every-course.mjs` → `存得下去 19 門／沒有存不下去的`） |
| 第 5 題：讀取卡片與找人的框標「一次性」，日曆那一格、待辦那一列不標，「扣／沒扣」那一行不畫 | `calendar.js:1638`（`visitReadHtml()` 裡）、`:1900`；`bulkCancel.js:224`；`note.js:58` `guestTag()`（`#221` 之後三排都還帶著，見第 3 件）；`aboveeConfirm.js` 兩處 | 對 |
| 第 6 題：轉成我的客戶（寫 `oneTime: false`）、以前的段照舊一次性、不做轉回去、新增客戶同名多一句 | `customers.js:50` `toMyCustomer()`；`customerDetail.js:571` `convertToMine()`（`undoable: false`）；`customers.js:270` `fieldWarnings()` 的 `GUEST_SAME_NAME` | 對 |
| 第 7 題：試算表不進、備份跟著客戶、資料健檢、刪除改名同一般客戶、名字卡多 LINE 名字與警示 | 見第 2 件 | 對 |
| 第 8 題：月底對帳認得就是有記、一次性的段不比次數 | `.claude/skills/month-end-reconciliation/scripts/reconcile.mjs:169-171`（`guestSlot()`／`guestItem()`）、`:523`、`:534`；`absent.slots` 那一圈的 `slot` 在範圍裡（`:475`） | 對（#210 之後沒有 PR 再動這支 skill） |

段五審查 R1～R14 逐條對過程式碼（`tests/one-time-review-fixes.test.js` 23 條一條一個編號，跑過全綠）：

| # | 現在的樣子 | 修好了沒 |
|---|---|---|
| R1 拍訂購單同名 | `orderForm.js:500` `sameNameCustomers()` 濾 `isOneTime()`；`blockersOf()`（`:528`）、`addOnTarget()`（`:545`）、卡上那兩顆（`orderConfirm.js:250`）都問它；卡上 ⚠ 是 `guestSameNameSay()`（`orderForm.js:509`、`orderConfirm.js:241`） | 修好。另外找了**同一個形狀**（還有哪裡能替一位一次性客人加額度）：`addEntitlements()`／`createEntitlement()` 的呼叫端只有客戶詳情（名字卡那一頁在 `customerDetail.js:201` 就先 return，畫不到加購）、拍訂購單（已濾）、資料健檢補二返（要先有健檢額度）—— 沒有別的路 |
| R2 有真額度時沒標記的段 | `visits.js:1757` `if (guestCustomer && !guest)` 拿掉了 `&& !slot.entitlementId`；`visitEditor.js:233`、`:334` 一次性客人的 `first` 是 `undefined` | 修好。`validateVisit()` 六個呼叫端都傳整份客戶（`relinkFollowup.js:51`、`schedule.js:2329`、`visitEditor.js:372`、`:1679`、拍 Abovee `checkCtxFor()` 的 `aboveeImport.js:3473`） |
| R3 轉了之後「約二返」去壓表是死路 | `nthFollowup.js:209` `followupGoesToCalendar()`，`home.js:1272` `labelGuestBookings()` 與 `:2729` `bookFollowup()` 共用 | 修好 |
| R4、R7 名字卡、轉成我的客戶的復原 | `calendar.js:1948`、`customerDetail.js:586` 都是 `undoable: false`；拍 Abovee 那一份本來就是 | 修好 |
| R5 擋下來那一句 | `visits.js:1968-1969` 換成「這一段是當一次性客人時記的…取消這一段、另約一段」 | 修好 |
| R6 轉成客戶確認框第一句 | `consequences.js:1589` | 修好 |
| R8 打「王小」也給「＋ 新增一次性客人」 | `customers.js:110` `offersNewGuest()` 比「有沒有一位一模一樣」 | 修好 |
| R9 「妳」→「你」 | `GUEST_SAME_NAME`、確認框標題、toast | 修好 |
| R10 n返 不講次數 | `tests/one-time-review-fixes.test.js` R10 那三條（壓表／日曆新增、一般客人照講、拍 Abovee） | 修好 |
| R11 EECP體驗搬家寫成 trial | `health.js:2348` `isOneTimeSlot(slot) ? null : …` | 修好 |
| R12 文件不實 | CLAUDE.md 那一列寫「`slotFromPicks()` 與來訪編輯器的 `readNthSlot()` 兩處判」、`slotDraft.js:154` 註解同 | 修好 |
| R13 `secondOptionsFor()` 在畫面裡組 | 段六判斷不做（不修也不會錯） | 照當時的決定，不算新的 |
| R14 worktree 的 `.local` 連結 | 掃了 `.claude/worktrees/` 底下 19 個 worktree：**沒有一個還有 `.local`**（只看、沒動） | 確認拆了 |

### 2. 改的過程完不完整

**`chainInputs()` 第三個參數**：CodeGraph 列出 8 個呼叫函式、grep 九處，**每一處都傳了這位客戶的來訪**（`aboveeConfirm.js:1278`、`bulkCancel.js:635`、`calendar.js:1246`、`home.js:3566`、`:3636`、`:3790`、`schedule.js:2379`、`visitEditor.js:1707`、`:1876`）；`tests/one-time-chain-callers.test.js` 也掃著。

**`cannotClose()`／`closeBlocks()` 要 `coursesById`**：簽療程單抽屜三處（`home.js:4030` `closeGuard()`、`:4055`「全部 ✓」、存的那一下 `:4117` 自己組的 guard）、`consequences.js:806`、拍 Abovee 四處（`chainCoursesOf(ctx)`）都帶了；抽屜的 ctx 有 `coursesById`（`home.js:3742`）。

**名單一處一處明寫排除**（CLAUDE.md「一次性客人」那一列列的每一處，逐行找到）：

| 名單 | 在哪一行 |
|---|---|
| 客戶清單三份互斥 | `customers.js:63` `inCustomerList()`（`ui/views/customers.js:250`、`:288` 用） |
| 壓表佇列、問時間兩支、壓表登記、時段反查 | `scheduling.js:258`、`:506`、`:581`、`:652`、`:944` |
| `batchRows()` | `scheduling.js:854` |
| 看這個月的進度 | `ui/views/progress.js:74` |
| 長備註「寫給誰」 | `ui/views/longNotes.js:319` |
| 手動貼上挑人那一排 | `ui/views/report.js:76` |
| 拍訂購單的同名比對 | `orderForm.js:502` |
| 資料健檢問時間那一項 | `health.js:803` |
| 試算表兩條路 | `sheetReport.js:639`（客戶）、`:646`、`:100`（`sheetVisits()`）；待辦 `guestTask()`（`:64`）吃沒濾過的來訪（`:751`、`:194`） |

讀客戶名單的地方（`customersData.list()` 等）**#210 合進來時 26 處、現在還是 26 處**，沒有新長出來的；home.js 十處、calendar.js 四處逐一對過是哪一種（名單的都排除了、找人的都列而且標）。

**資料形狀（`customer.oneTime`、`slot.oneTime`）**：
- **`firestore.rules` 真的寫了一次**：`npx firebase emulators:exec --project demo-rules-test --only firestore "node --test .scratch/final-check-2026-11-07/rules-one-time.test.mjs"` → 建名字卡、轉成我的客戶（`oneTime: false`）、一次性的段（連同 `examNotMine`）**三條都寫得進去**（`pass 3 / fail 0`）。`validCustomer()`、`validVisit()` 只驗形狀、沒有欄位白名單（`firestore.rules:63`、`:215`）；#221 動過 Rules（隨手記的 `linkId`），這一次跑的是現在那一份。跑完模擬器自己關了（8080／4000／4400 確認沒人在聽）
- **備份與還原**：`data/backup.js:37`、`:40` 整份 `listWithDeleted()`；`scripts/restore-backup.mjs:168` 整份寫回（只拿掉 `id`）—— 兩格跟著走
- **稽核**：`audit.js:148` `oneTime: '一次性客人'`（`fieldLabel('oneTime')` 實際印出「一次性客人」）；她看得到的變動，不進 `QUIET_IN_SENTENCE` 是對的
- **資料健檢每一項**：逐一看了會走客戶的九支（`checkCounts`、`checkFollowups`、`checkOverused`、`checkStaleAvailability`、`checkDuplicateAvailability`、`checkChartNo`、`checkChartNoField`、健檢鏈那兩支 `:2228`、`:2255`）與孤兒那一支（`refState(null)` 不報）：沒有額度與本輪可用性的人不會被誤報；病歷號撞號照樣比得到他（該比）；鏈那兩支經 `strandedFollowups()` 等吃投影
- **月底對帳**：見第 1 件第 8 題

**虛擬的那一對絕對不存**：寫來訪的路全部列出來 —— `data/visits.js` 的 `save()`／`remove()`／`restore()` 都經過 `countOps()` → `assertNoOneTimeIds()`（`:753`）；`setFollowupNote()` 只寫兩格字；資料健檢直接寫 `slots` 的三種（`clearBeds`、`moveBedToRoom`、`trialSlotsToCourse`）拿的都是 `repo.list('visits')` 讀回來的原本那一份、修正都不經過鏈（健檢鏈那兩項 `fix: null`）；合併檔匯入不經過鏈；改名只寫 `customerName`。任務只記 `visitId`（`followups.js:903`）。**沒有一條寫入路拿得到投影那一份**。

**同一個形狀的缺陷**：R1 的形狀（能把東西掛到一次性客人身上的「目標」挑選）全部找過：拍 Abovee 換一位（段標一次性）、療程單「是誰」（存在他身上，照一般來訪，對的）、隨手記掛給誰（對的）、給營養品（他沒有營養品）、長備註（排除）、手動貼上（排除）、批次取消（該列、有標）、加購（只有已排除的兩條路）。R4／R7 的形狀（建或轉之後有復原）：三條建／轉都關了。

### 3. 平行合進來的 PR 有沒有踩到它

`git log --first-parent origin/main..develop` 的先後：#203（11/5，比 #210 早合，#210 那條分支當時已經合進它）→ **#210** → #211、#212、#214、#213、#216、#215、#217、#218～#220、#221、#223、#222、#224。
逐支看了 #210 之後動到 `public/js` 的 diff：

| PR | 動到「會列客戶、會吃來訪、會算次數」的地方 | 對一次性客人 |
|---|---|---|
| #211、#213 試算表版面 | `syncBundle()` 多 `noteLines`（`readMarks(customer)`）、營養品多 `purchasedAt` | 都在客戶那一圈裡面，那一圈先濾掉一次性客人（`sheetReport.js:639`）；來訪照舊吃 `sheetVisits()` 濾過的那一份。沒踩到 |
| #218～#220 試算表（記一句疊在日期底下、不凍結、列高） | 只動 `.gs` 與 `scripts/` | `.gs` 畫的是 `syncBundle()` 給的資料，一次性的段進不去。沒踩到 |
| #221 隨手記 | `nameSuggestions()`（打名字跳出客戶）、「掛給誰」兩格的搜尋、`linkId`、`deleteBlockers()` 一組一行、資料健檢多一項 | 三排列客戶的地方（`wireWho()`、長按的 `askCustomer()`、打名字跳出來那一排）**都還帶 `guestTag()`**（`note.js:287`、`:1188`、`:445`），名單照規則**列**一次性客人；Android 小工具那一份也列、標「一次性」（`android/app/.../Customers.kt:37`）。刪名字卡照樣問 `deleteBlockers()`；新的資料健檢那一項只看隨手記。沒踩到 |
| #224 給營養品改原本那一筆 | `createOrMove()`、`loadGivableBags()` | 一次性客人沒有營養品額度（也沒有路加），列不到他。沒踩到 |
| #212 | `[data-guestpicks]` 的間距 | `giftFold.coursesHtml()` 是三個入口共用的那一份（`giftFold.js:111`）。屬性選擇器不在 `CSS_SCOPES` 裡 → 改到它時 E2E 退回全跑（多跑，不是少跑） |
| #214、#215、#216、#217、#222、#223 | 待辦間距、iPad 拍照與開機、試算表驗證腳本、文件、Android | 不碰名單、來訪、次數 |

### 4. 值得做的優化

除了第二段那一條，沒有找到有實際好處的。看過但不建議做的：`labelGuestBookings()` 每畫一次「約二返」就讀一次整份客戶（`home.js:1275`）—— 只在有「約二返」時才讀、讀的是有快取的集合，省下來的不多；
療程單「是誰」那一排沒標「一次性」—— 段五審查已經判定不算錯（spec 第 5 題沒要），維持。

---

## 跑過的東西（都在這個資料夾，重跑照指令）

| 檔案 | 跑法 | 結果 |
|---|---|---|
| 一次性客人相關的單元測試 | `node --test tests/one-time-*.test.js tests/eecp-one-course.test.js tests/month-end-reconciliation.test.js tests/audit-field-words.test.js tests/notes-name-suggestions.test.js` | 313 條全過 |
| `probe-guest-every-course.mjs` | `node .scratch/final-check-2026-11-07/probe-guest-every-course.mjs` | 19 門都存得下去 |
| `rules-one-time.test.mjs` | `npx firebase emulators:exec --project demo-rules-test --only firestore "node --test .scratch/final-check-2026-11-07/rules-one-time.test.mjs"`（8080 要空著） | 3 條都寫得進去 |
| `probe-bulk-same-name-guest.mjs` | `node .scratch/final-check-2026-11-07/probe-bulk-same-name-guest.mjs` | 重現第二段第 1 條 |

沒有跑本機 E2E：CI 在同一個 commit 上的全量 E2E 已經綠了，而這一輪沒有要靠畫面重現的問題。
