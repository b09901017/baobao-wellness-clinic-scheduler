# 日子過了才變成已確認的段，不長掛號待辦

Status: done
來源：第一批（PR #130）交付時留下的已知邊界，她 2026-09-24 回「要擋掉」
動工前先讀：ADR-0027（確認之後才長）、ADR-0097／0107（掛號逐段）、ADR-0111（未到只剩退回簽療程單）、
`domain/taskRules.js` 的 `registrationSlots()`／`newRegistrations()`／`syncTasksForVisit()`（已經收 `today`）、
`domain/consequences.js` 的 `registrationsWhenSettled()`、`scripts/seed-staging.mjs` 的 `registrationTasks()`、
`domain/visits.js` 的 `visitActions()`（`reopen` 那一顆的註解）

## 她要的

問她的那一句：

> 一段 A 類（門診、二返）從來沒確認過，一直是待確認，就直接被記成未到。之後你按「退回簽療程單」，
> 那一刻它會變成已確認，然後長出一張已經逾期的 Examine／耀聖。要擋掉嗎？還是先不管？

她回：

> 一段 A 類（門診、二返）從來沒確認過，一直是待確認，就直接被記成未到。之後你按「退回簽療程單」，
> 那一刻它會變成已確認，然後長出一張已經逾期的 Examine／耀聖 ， 要擋掉

## 為什麼會這樣

- 簽療程單列的是**還開著**的段（`slotsToClose()`），待確認也算 —— 所以一段從沒確認過的過去時段可以直接按 ✗ 記成未到。
- 退回簽療程單寫進去的是 `confirmed`（`TRANSITIONS.no_show`，ADR-0111）。
- 掛號那一族的閘門是 `acceptsNewTasks(slotStatus()) === 'confirmed'`，而那一段**從沒被任何一張掛號待辦蓋到過**
  （確認過的段在確認那一刻就長過一張，`seenTasks()` 含已勾的，所以不會重長）→ 這一刻長一張，死線是來訪前一天 → 一出生就逾期。
- 同一個形狀還有一條：過去某一天還在待確認的段，日曆長按「客戶說可以」→ 同樣長一張逾期的。
- `visitActions()` 裡 `reopen` 那一段的註解寫「客人早就說過可以了」—— 在這個邊界上不成立，要一起改。

## 建議的做法（動工前再驗一次）

**掛號是客人來之前的事。那一天已經過了（`visit.date < today`）才變成已確認的段，不長掛號待辦。**

- 閘門加在 `registrationSlots()`（或 `newRegistrations()`）的「born」那一側，`today` 從 `syncTasksForVisit()` 帶下去（它已經收了，`data/visits.js` 傳 `todayISO()`）
- **當天（`visit.date === today`）照長**：下午那一段早上才談定，掛號還來得及做
- 只擋 `create` 那一圈 —— 已經長出來的一張都不動（`tasksForVisit()` 不看狀態那一條不能動）
- `registrationsWhenSettled()` 也要帶 `today`，不然確認框會講一句不會發生的「會多一張 Examine」（ADR-0070）
- 查 `seed-staging.mjs` 的 `registrationTasks()`：種子裡過去的已確認段會不會因此少掉原本種好的掛號待辦
- 補一支 ADR（0113）：這是 ADR-0027「確認之後才長」多一個條件，不改舊的

另一條路（沒選）：退回時如果那一段從沒確認過就回到待確認。要多一條 `no_show → pending_confirm`，
而且 `visitActions()` 手上沒有任務、判斷不出「確認過沒」—— 比日期閘門大很多，理由也比較繞。

## 判準

- 過去某一天一段 A 類，待確認 → 簽療程單 ✗ → 長按「退回簽療程單」→ 待辦**沒有**多一張 Examine／耀聖？
- 同一段換成**確認過**再記未到、再退回 → 一樣沒有多一張（本來就不會，要有測試釘著）？
- 過去某一天還在待確認的段，長按「客戶說可以」→ 沒有多一張？
- **今天**的段早上才確認 → 照樣長一張？
- 未來的段確認 → 照樣長，確認框照樣講「會多一張 Examine」？

## 動工前驗證（2026-09-24）

- **staging 種子不會變**：`makeCustomer()` 裡過去的來訪一律 `done`（`acceptsNewTasks('done')` 本來就不長），
  今天那一天 `past = date < today` 是假 → 已確認／待確認，閘門放行當天。所以種子一張都不會少。
- **`registrationsWhenSettled()` 要帶 `today`**：`bookingConsequences()`（壓表與來訪編輯器新增，補登過去的日子會走到）
  與 `rebookConsequences()`（改期到過去某一天）。`confirmConsequences()` **不用**：確認抽屜列的是 `visitsToConfirm()`，
  它本來就只收 `date >= today`，過去的那幾筆進不來。
- **讀取卡片也要講同一件事**：`todoFlow.js` 的 `pendingRows()` 會替「還沒長出來」的掛號補一列「到時候才會長出來」。
  日子過了那一列就是假話（ADR-0070）。`mirrorHtml()` 早就把 `today` 傳進 `todosForVisit()`，只是沒人用 —— 接上。
  （順帶收掉一個既有的假話：待確認直接記成已完成的過去那一段，卡片上一直寫著 Examine「到時候才會長出來」。）
- 匯入（`importedTasksFor()`）照舊帶 `today`：`statusFor()` 只把今天以後的判成已確認，閘門不改任何一筆。

## 她 2026-09-24 回的（第二批動工前，排查時找到的）

補登過去某一天時，「已經在 X 壓好表了嗎？」那一道寫「待辦會多一張『跟客人確認時間』」—— 不會發生：
確認那一列（`visitsToConfirm()`）只收今天以後，過去那一天直接進「簽療程單」（`visitsToClose()` 收 `date <= today`）。
她選：**一起修在 14**（同一個 `today` 參數）。只改那一句，寫入一個字都不動。併進既有那一天時「會重新出現一張」同理。

## 判準（補）

- 補登昨天一段：確認框**不講**「會多一張跟客人確認時間」、講它會出現在「簽療程單」？也不講「等客人說可以之後會多一張 Examine」？
- 補登今天一段：照舊講「會多一張跟客人確認時間」？
