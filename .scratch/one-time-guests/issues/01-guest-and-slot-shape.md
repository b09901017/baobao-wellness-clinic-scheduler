# 01：一次性客人與一次性的段 —— 形狀、組時段、存檔驗證

Status: todo
Blocked by: 無（但**整輪的實作要等 `claude/small-fixes-2026-11-05` 合進 develop 之後才開始**，見 HANDOFF「共同的規矩」）

## 動工前先讀

- `docs/adr/0172-a-one-time-guest-is-a-customer-off-every-list.md` 決定一、二
- `docs/adr/0169-a-follow-up-whose-exam-she-did-not-book.md`（同一種「只認 `true`、不從形狀推」的標記；這一支照抄它的做法）
- spec.md「資料的形狀」「我判斷的細節」
- `CLAUDE.md` 連動表：「新增一個會建立時段的入口」「健檢不是我排的（`examNotMine`）」「送的／體驗…」「新增一個會寫進稽核的欄位」那幾列
- `public/js/domain/slotDraft.js` 的 `slotFromPicks()`、`visits.js` 的 `validateVisit()`（「沒有指定客戶」`:1701`、「要選一個額度」`:1746` 附近、`examNotMineErrors()`）、
  `masterData.js` 的 `isExamNotMine()`／`giftKindOf()`、`domain/customers.js`

## 她要的

> 客戶那邊就不需要有他也不需要給他額度什麼的，他們就是一次性的

> 唯一的區別就是不會記錄到那頁中，也沒有額度限制甚麼的，也不用記到式算表中，但日曆和代辦我還是需要看到有他

第 6 題（轉成我的客戶）：她選「當一次性客人時的來訪留著、照舊算一次性：不扣之後買的額度、不進試算表」。

## 為什麼會這樣

- 一段沒有額度、不是 n返、不是送的／體驗、不是 `examNotMine` → `validateVisit()` 擋「要選一個額度」；健檢與二返又不可以是送的／體驗（`canBeGift()`）——
  所以現在一位沒有額度的人只排得進送的／體驗（ADR-0121 那條路，`visitEditor.js:227-229`），排不進健檢與二返
- 段上要有自己的標記（不只客人身上）：轉成客戶之後，以前那幾段要照舊算一次性（ADR-0172 決定二）

## 要做的

- **客人**：`domain/customers.js` 一支 `isOneTime(customer)`（`customer?.oneTime === true`）。**全站只准問它**（同 `isExamNotMine()` 的掃描測試）
  - 建名字卡的資料：`oneTimeCustomer({ name, chartNo, phone, lineId, flags })` → 一份客戶文件，多 `oneTime: true`、其餘照新增客戶的預設
  - 轉成我的客戶：一支回「要寫的變動」＝**`{ oneTime: false }`**（過目 4：拿掉那一格要 `deleteField`，而 `repo.commit()` 把 `changes` 原樣 `set()` 進稽核那一筆，
    放一個刪除標記進去整批會失敗；domain 也 import 不到 SDK。一般客戶沒有這一格、轉過的寫 `false`，`isOneTime()` 只認 `true`，兩種一樣 —— ADR-0172 決定二）
- **段**：`masterData.js` 一支 `isOneTimeSlot(slot)`（`slot?.oneTime === true`），放在跟 `isExamNotMine()` 同一處（葉節點，避免循環 import）。**全站只准問它**
- **`slotFromPicks()` 多一個 `picks.oneTime`（只認 `true`）**：
  - 課程＝她按的那一門（`picks.courseId`，一次性客人的「做什麼」那一排是全部的課）；`entitlementId`／`giftKind` 一律 `null`；最後 `oneTime: true`
  - 跟 `examNotMine` 可以同時給：兩格都寫（`examNotMine` 那條路照舊決定課程與返數）
  - 一次性的二返 → `followupForVisitId` 照 `picks` 給的寫（接哪一次健檢，02 列得出來）；**沒接、又不是 `examNotMine` → `stop('先選這是哪一次健檢的，或按「健檢不是我排的」')`**。
    注意 `slotDraft.js:150` 現在沒有額度就把 `followupForVisitId` 清成 null —— 一次性的路不可以走到那一行
  - **一次性的 n返 不在這一支**：n返 的路（`slotDraft.js:93-97、160`）只從真的額度找健檢，要等 02 讓它認得一次性的健檢段
  - **一般的段沒有這個鍵**（測試拿一般的 picks 比 `oneTime: false` 跟沒給 deepEqual）
- **`validateVisit()`**：
  - 一次性的段只放過那一種形狀：`entitlementId` 與 `giftKind` 是空的；二返要嘛接了健檢、要嘛 `examNotMine`；任何一格不對 → 講出是哪一格
  - 豁免「要選一個額度」**只給帶標記的段**
  - `ctx.customer` 是一次性客人、而某一段**沒有標記也沒有額度** → 擋（「一次性客人的段要標成一次性」——程式的錯，不該發生）。
    **有三個呼叫端只傳半個客戶**（過目 10：`schedule.js:2318` `{flags}`、`relinkFollowup.js:50` `{id,flags}`、`aboveeImport.js:3309` `{flags}`）—— 照 `ripple-check` 列出 `validateVisit(` 的每一個呼叫端，
    傳的客戶都要帶得出 `oneTime`（或整份），不然這一道在那幾條路上永遠不會響
  - 沒有標記的段一道都不放寬
- `giftKindOf()`：一次性的段一律 `null`（同 `examNotMine` 那一行）；`withGiftKinds()` 存檔寫實時不會把它寫成體驗
- 稽核：`audit.js` 的 `FIELD_LABELS` 補 `oneTime: '一次性客人'`（段上的那一格走整筆 `slots` 的比對，不用另外補）

## 判準（每一條一支測試）

- 一般客戶沒選額度的段 → 照舊擋？（沒有標記的段一個字都不放寬）
- 一次性的段又帶額度／又是送的 → 擋下來、句子講對是哪一格？
- 一次性的二返沒接健檢、也不是 `examNotMine` → 擋？接了 → 過？`examNotMine` → 過？
- `counts()` 算任何一筆額度時，一次性的段算不算進去？（不可以）
- `giftKindOf()` 會不會把一次性的段讀成體驗（課程勾了預設體驗也不會）？
- 一次性的段存進去、讀回來、再存一次，形狀一樣嗎？（`withSlotStatuses()`、`withGiftKinds()`、`withSlotNotes()` 都跑過）
- 一位一般客戶身上沒有 `oneTime` 那一格時，`isOneTime()` 回 false？舊資料裡「沒有額度的段」會不會被 `isOneTimeSlot()` 讀成一次性？（不會）
- 掃描測試：`public/js` 底下除了 `customers.js`／`masterData.js`，沒有別處讀 `.oneTime`

## 做完時留下的

（做完的那一段寫）
