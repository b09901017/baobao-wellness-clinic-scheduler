# 05：客戶清單最底下的連結、一次性客人名單、名字卡那一頁、轉成我的客戶

Status: done
Blocked by: 01、02、03（轉成客戶的確認框講鏈上的事）

## 動工前先讀

- spec.md「談定的」第 2、6 題與「我判斷的細節」
- `CLAUDE.md` 連動表：「刪掉一位客戶」「客戶改名」「貼在畫面底部的東西」「一句『按下去會發生什麼』」「畫面上一段常駐的說明」「`public/` 底下任何檔案」那幾列
- `public/js/ui/views/customers.js`（標題那一行的三個連結 `:101-109`、`view.showInactive` `:52`、`matches()` `:278`）、`ui/views/customerDetail.js`（路由 `#/customers/:id`）、
  `ui/components/customerForm.js`、同名與沒有聯絡方式的那幾句 `domain/customers.js` 的 `fieldWarnings()`（`:146-160`；病歷號撞到 `:162`）、`domain/customers.js` 的 `deleteBlockers()`／`renameTargets()`、`data/customers.js` 的 `updateWithSnapshots()`

## 她要的

第 2 題：

> 照你的建議選A，但是有一個要修正以及注意的地方，現在的「看已停用的」是在「客戶」那一頁的最上面誒 ? 之前也發生過，因為在最上面和看這個月進度以及長備註，並排所以很擠並且還擠到變兩行。我同意跟現在的「看已停用的」並排，但能不能都移到那一頁最底下 ?

第 6 題她選：小頁最底下「轉成我的客戶」，確認框答是才轉；轉了就是一般客戶；以前的那幾段照舊算一次性；不做轉回去；新增客戶打到同名的一次性客人時多一句「要不要直接把他轉成妳的客戶」。
第 7 題：刪除與改名同一般客戶；名字卡多 LINE 名字與警示兩格（選填）；不給傳時間表單、本輪可用性、長備註、加購。

## 為什麼會這樣

- 「看已停用的」現在在標題那一行（`customers.js:103-108`），跟「看這個月的進度」「長備註」並排，手機上擠成兩行
- 一次性客人是一份客戶文件，`#/customers/:id` 本來就打得開他 —— 只是那一頁畫的是一般客戶的全部（額度、加購、問時間…），一次性客人要的是名字卡

## 要做的

- **客戶清單**：
  - 「看已停用的」從標題那一行**搬到最底下**，旁邊多「看一次性客人」；標題那一行只留「看這個月的進度」「長備註」
  - 平常那一份與已停用那一份**都不列一次性客人**；「看一次性客人」那一份只列他們（同一頁換一份，同 `showInactive` 的做法；在那一份裡那個連結變「看在服務中的」）
  - 最底下那兩個連結**不被右下角的懸浮鈕或 toast 擋住**（量位置，`24-layout-reach` 那種；CLAUDE.md「貼在畫面底部的東西」那一列）
- **名字卡那一頁**（`#/customers/:id`，`isOneTime()` 時畫這一份，不另開路由）：
  - 抬頭：名字＋「一次性」小灰字
  - 名字卡：名字、病歷號、電話、LINE 名字、警示 —— 改得動（改名走既有的 `updateWithSnapshots()`／`renameTargets()`，同一般客戶）
  - 他的來訪（同客戶詳情的來訪紀錄那一塊，點一段開讀取卡片）
  - 最底下：「轉成我的客戶」、刪除（`deleteBlockers()` 同一般客戶；被擋時那一句照舊）
  - **沒有**：額度、加購、買過什麼、本輪可用性、傳表單連結、長備註、停用、壓表相關
- **轉成我的客戶**：確認框（`confirmAction()`）講真的會發生的事（ADR-0070，句子放 `consequences.js`）：會出現在客戶清單；要加購才排得進壓表；
  以前的 N 段照舊不扣、不進試算表；還欠的那一場一次性二返照舊不扣（02 算得出來才講）。答是 → 寫 `oneTime: false`（01 的那一支；**不是拿掉那一格**，見 01）→ 換成一般客戶詳情
- **名字卡的表單做成一個元件**（這一頁改名字卡用；06 日曆新增、07 拍 Abovee 的快速表單也用它 —— 只做一份，過目 15）：名字（必填）、病歷號、電話、LINE 名字、警示；
  快速表單只露前三格。`fieldWarnings()` 那幾句：**「沒有電話也沒有 LINE」不講**（名字卡選填）、同名照講、病歷號撞到照講（可能是同一個人）
- **新增客戶的同名提醒**（`fieldWarnings()` 那一句、與存檔前 `confirmReview()` 再講一次）：同名的是一次性客人時那一句換成
  「有一位同名的一次性客人 —— 要把他轉成妳的客戶，去客戶清單最底下『看一次性客人』點他、按『轉成我的客戶』」。**不放連結**：`confirmReview()`（`dialog.js:36`）只收字串（過目 12）
- `public/` 有動：照 HANDOFF「共同的規矩」升 `VERSION`、新檔案進 `sw.js` 的 `SHELL` 與 `tests-e2e/related.js`

## 判準（每一條一支測試；畫面那幾條是 E2E）

- 客戶清單平常那一份、已停用那一份，會不會出現一次性客人？（不會）「看一次性客人」那一份會不會出現一般客戶？（不會）
- 標題那一行還有「看已停用的」嗎？最底下兩個連結在手機寬度下是一行、而且點得到（懸浮鈕沒蓋住）？
- 名字卡那一頁找得到「加購」「額度」「傳表單連結」嗎？（不可以）
- 轉了之後：他在客戶清單上？他以前那幾段身上的 `oneTime` 還在？他身上那一格是 `false`、`isOneTime()` 回 false？稽核上看得到「一次性客人 是 → 否」？
- 還掛著來訪或待辦的一次性客人刪得掉嗎？（不可以，同一般客戶）改名之後，今天以後的來訪、還沒做的待辦換了名字？
- 新增客戶打到一次性客人的名字 → 那一句出來？名字卡沒填電話與 LINE → 不講「沒有聯絡方式」？打到一般客戶的名字 → 跟以前一模一樣？

## 做完時留下的

段三（2026-11-05）。測試在 `tests/one-time-name-card.test.js`（16 條）與 E2E `94-one-time-guest-card`（7 支，本機 2 個 worker 跑過全綠）。

- **客戶清單**（`customers.js`）：`view.showInactive` 換成 `view.list`（`'active'|'inactive'|'oneTime'`）；列誰只問 domain 的 `inCustomerList(customer, list)`（`domain/customers.js`，三份互斥、刪掉的哪一份都不列）。
  最底下那一排 `[data-listlinks]`（`.footlinks.custfoot`）：兩顆 `[data-list]`，現在看的那一份那一顆寫「看在服務中的」。標題那一行只剩「看這個月的進度」「長備註」。
  「看一次性客人」那一份的卡是 `guestCard()`（`[data-guestrow]`：名字＋`.guestmark`「一次性」、警示、備註那一排；沒有額度那一段）。懸浮鈕：`.app__main:has(.fab)` 本來就讓 130px，E2E O1 量中心點最上層是它自己
- **名字卡表單**：`ui/components/guestForm.js` 的 `mountGuestForm(host, { card, id, existing, alerts, quick, submitLabel, onSubmit, onCancel })`，`onSubmit({ card })`
  （`cardOf()`：`{ name, chartNo, phone, lineId, flags }`，交給 `oneTimeCustomer()`）。`quick: true` 只露名字、病歷號、電話（06 日曆新增、07 拍 Abovee 用）。
  選擇器：`[data-gf-form]`、`[name="name|chartNo|phone|lineId"]`、`[data-gf-submit]`、`[data-gf-cancel]`、⚠ 在 `[data-gf-warn="name|chartNo"]`。存檔前那一道是 `confirmReview(warnings(...))`；**它不寫資料庫**
- **名字卡那一頁**：`customerDetail.js` 的 `render()` 看到 `isOneTime()` 就畫 `paintGuest()`（`[data-guestpage]`，同一條路由）。抬頭 `.hero__name .guestmark`、`[data-guestcard]`（病歷號／電話／LINE 名字）、
  `[data-guestvisits] [data-visit]`（點了 `openVisitCard()`）、`[data-guest-edit]`（`paintGuestEdit()`，全部五格）、`[data-to-mine]`、`[data-audit]`、`[data-guest-delete]`
- **抽出來共用的兩支**：`deleteCustomer(ctx)`（「停用與刪除」那一張與名字卡那一頁，`deleteBlockers()` 照舊）、`saveBasics(ctx, changes, { review })`（客戶詳情「編輯」與名字卡「編輯」，改名照舊 `ownWhole()` → `renameTargets()` → `updateWithSnapshots()`；名字卡表單自己問過同名那一道，給 `review: false`）。
  `tests/own-whole-reads.test.js` 的 13、14 改成掃這兩支（斷言一個字都沒放寬）
- **轉成我的客戶**：`convertToMine()` → `confirmAction()`（句子是 `consequences.js` 的 `toMyCustomerConsequences({ visits, entitlements, coursesById })`：上清單、要先加購才排得進壓表、以前的 N 段照舊算一次性（數還算數的一次性段）、還欠 N 場二返（`oneTimeOwed()`）、不能轉回）→ `data.update(id, toMyCustomer())` → `reload()` 畫成一般客戶詳情。稽核留得下 `before.oneTime: true`／`after.oneTime: false`（E2E O4）
- **同名那一句**：`fieldWarnings()` —— 一般客戶打到同名的一次性客人 → `GUEST_SAME_NAME`（同時有同名的一般客戶就兩句接起來）；名字卡（一次性）照舊數每一位、不講「沒有聯絡方式」。`confirmReview()` 只收字串，所以那一句自己指路
- CSS：`.guestmark`（11px、`--text-mute`，06 讀取卡片與找人的框也用它）、`.custfoot`、`.guestcard`、`.guestconvert`
- `sw.js` v288（origin/develop v283、這條分支段二是 v287）；`guestForm.js` 進 `SHELL`；spec `94` 進 `related.js`
- **沒做的**：`SPEC.md:1616` 還寫著「看這個月的進度」和「看已停用的」並排 —— 08 寫文件時改
