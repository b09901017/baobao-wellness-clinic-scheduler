# 03：健檢那一串（呼叫端）—— 先問「有沒有真的二返額度」就收手的那幾處

Status: done
Blocked by: 02

## 動工前先讀

- ADR-0172 決定三；02 的「做完時留下的」（投影放哪、叫什麼）
- HANDOFF「過目抓到的」1（這一支整支就是它）
- `CLAUDE.md` 連動表：「一句『按下去會發生什麼』」「待辦中心的兩張抽屜」「拍 Abovee 記很多段」（`dropChainLeftovers()` 那一段）「算次數、驗證…」那幾列

## 她要的

（同 02）她要一次性客人的待辦「就和一般來訪一樣」—— 確認框講的、抽屜擋的、拍 Abovee 收的，也要一樣。

## 為什麼會這樣

過目查到（2026-11-05，行號是那一天的 develop）：好幾處在叫到鏈之前就先問「這位有沒有真的二返額度」，沒有就收手 —— 一次性客人全部落在這裡：

| 地方 | 收手的那一行 | 後果 |
|---|---|---|
| `data/visits.js` 的 `chainInputs()` | `:477` `pairsOf(真的).some(p => p.followup)` 是 false → `null` | 吃它的十幾處（`calendar.js:1225`、`bulkCancel.js:635`、`home.js:3503/3573/3725`、`schedule.js:2368`、`visitEditor.js:1524/1693`、`aboveeConfirm.js:1160`）確認框一句鏈上的話都不講 |
| `consequences.js` | `cancelChainLines` `:935`、`followupBookingLines` `:878`、`chainAfterClose` `:1050`；`bookedFollowupFor` `:1144` 只繞真的那幾對 | 取消、約二返、簽療程單的確認框漏講 |
| `home.js` 簽療程單抽屜 | `:3719` 沒有那一對就不讀來訪 | 一次性二返接的健檢還沒做完，抽屜上的 ✓ 照樣按得下去（只有存的那一下 `:4046-4048` 擋） |
| `aboveeConfirm.js` | `:1164` `chainBy[id]` 有才填 `chainKnown` | `dropChainLeftovers()`（`:1226`）不跑 → 同一張照片健檢＋二返，中途長出來的「追蹤健檢報告」留著 |

## 要做的

- `chainInputs()` 認得一次性客人（他有一次性的健檢段，或轉了之後虛擬那一對還在）；回的東西照舊，算的地方吃 02 的投影
- 上表每一處收手的條件改成「真的或虛擬的那一對」；`bookedFollowupFor` 吃投影
- 先照 `ripple-check` 再列一次（CodeGraph `callers` ＋ grep `pairsOf(`、`chainInputs(`、`chainBy`）—— 過目列的不一定全；**`sheetReport.js:898` 不可以吃投影**（試算表）、`customerDetail.js:1065` 不用動
- 每一處補一支測試：一次性客人走那一條路，確認框／抽屜／收尾跟一般客人講一樣的話、擋一樣的東西

### 段一之後加進來的（HANDOFF 中途發現段一 1、2、6、7）

- **`cannotClose()`／`closeBlocks()` 的每一個呼叫端補 `coursesById`**（段一第 1 條）：`home.js` 的 `closeGuard()`，**加上簽療程單抽屜存的那一下 `applyClose()`**
  —— 它自己組 `{ entitlements, visits: customerVisits }`、不經過 `closeGuard()`（`closeBlocks()` 與 `closeVisit(…, guard)` 兩處，第 6 條）；`visits.js` 的 `closeVisit()` guard、
  `consequences.js` 的 `closeConsequences()`、`aboveeImport.js` 的四處（`applyPhotoStatus`、`gateStatusChanges`、`applyPhotoMove`、`blockedInGroups`）
- **`relinkOffer()`／`relinkSlot()`**（段一第 2 條）：照建議在投影裡比、`relinkSlot()` 只動 `followupForVisitId`，或明說不做、寫進「做完時留下的」
- **接在一次性健檢上的 n返 標一次性**（段一第 3 條＋第 7 條）：在 `slotFromPicks()` 一處判 —— n返 接的那一次健檢是一次性的段 → 這一段也寫 `oneTime: true`
  （轉成客戶之後的人也是）；`validateVisit()` 擋「接一次性健檢、卻沒標一次性」的 n返。三個入口（來訪編輯器、壓表、拍 Abovee 的 `nthRows`）都經過 `slotFromPicks()`，不用各判

## 判準

- 一般客戶走這幾條路，每一句話、每一個擋，跟改之前一模一樣？
- 一次性客人取消一場健檢（二返接著它）→ 確認框講「還有一場二返接在這一次上」？
- 一次性客人簽療程單：二返接的健檢還沒做完 → 抽屜上那一段的 ✓ 按不下去、「全部 ✓」跳過它？
- 拍 Abovee 同一張照片記一次性客人的健檢（做完）＋二返 → 存完之後有沒有留下一張用不到的「追蹤健檢報告」？（不可以）
- 簽療程單抽屜：一次性二返接的健檢還沒做完，**按下去存的那一下**也擋（不只畫面上的 ✓）？
- 轉成客戶的人約一場接在一次性健檢上的三返 → 那一段帶 `oneTime`？沒帶的話存得下去嗎？（不可以）一般客戶的三返（接真的健檢）→ 不帶、照舊？

## 做完時留下的

段二（2026-11-05）。測試在 `tests/one-time-chain-callers.test.js`（32 條；判準每一條一支，每一條拿同一份情境換成真的額度對照「講一樣的話」）。

**兩道閘門**（新的兩支）：
- `oneTimeChain.js` 的 `hasOneTimeSlots(visits)`：**讀之前**的閘門，刻意寬（有一段標一次性就算）——
  `chainInputs()` 與簽療程單抽屜在叫鏈之前用它；寬的代價是多讀一次任務，窄的代價是一句都不講
- `followups.js` 的 `hasFollowupChain({ entitlements, visits, coursesById })`：**算的時候**的閘門（真的一對、或一次性客人的那一對），
  `visits` 要是全部來訪。`consequences.js` 的 `followupBookingLines()`、`chainAfterClose()` 換成問它

**每一處怎麼改**：
- `data/visits.js` 的 `chainInputs(customerId, coursesById, visits)`：多收第三個參數（呼叫端手上這位客戶的來訪）。沒有真的一對、而 `hasOneTimeSlots(visits)` → 照樣讀任務。
  回的額度照舊是真的那幾筆。**九個呼叫端都傳**：拍 Abovee（`visitsBy` ＋ 這一次要記的 `p.after`）、批次取消（`ctx.visits`）、日曆長按取消（`customerVisits`）、
  確認抽屜兩處（`customerVisits`）、簽療程單抽屜（`[visit]` —— 那裡只當閘門）、壓表存檔（`[...customerVisits, visit]`）、來訪編輯器兩處（連要存的那一筆）
- `consequences.js`：`followupBookingLines()`、`chainAfterClose()`（先算結完的那一份再問閘門）、`strandedFollowupLines()`（「本來接得上」在 `before` 的投影裡問）、
  `strandedOnNewExamLines()`（新加的那一段是不是健檢在投影裡認 —— **issue 沒列、同一個形狀**：一次性客人另約健檢時那一句與 ADR-0146 那一顆都靠它）、
  `bookedFollowupFor()`（拿回「追蹤健檢報告」那一道；回去的是原本那一份）、`closeConsequences()` 的 `closeBlocks()` 帶 `coursesById`
- `cannotClose()`／`closeBlocks()` 的 `coursesById`：`home.js` 的 `closeGuard()`、**簽療程單抽屜存的那一下 `applyClose()` 的 guard**（中途發現 6）、
  `consequences.js` 的 `closeConsequences()`、`aboveeImport.js` 四處（`gateStatusChanges`、`checkMoves` 的 guard、`blockedInGroups`、`photoDayPlan` 的 guard —— 新的 `chainCoursesOf(ctx)`）。
  `visits.js` 的 `closeVisit()` 只把 guard 往下傳，不用改
- 簽療程單抽屜（`openCloseDrawer()`）：`chained` 多認 `hasOneTimeSlots([visit])` —— 不然全部來訪是空的，`closeGuard()` 擋不到
- 拍 Abovee 收尾：`chainBy` 有一次性客人那一份 → `chainKnown` → `dropChainLeftovers()` 照跑（`chainLeftovers()` 02 就認得那一對，測試釘住）
- **`relinkOffer()`／`relinkSlot()`：做了**（中途發現 2 的建議）。`relinkOffer()` 在投影裡比（二返扣的那一對配不配新加的一次性健檢）；
  回的 `entitlementId` 改成她資料裡那一段扣的（一般客人一樣是那一筆二返額度 —— 本來就同一個值；一次性的是 `null`），
  一次性的那一場多一格 `guestSlot: true`（**一般客人回的形狀一個字都沒變**，`followup-relink-on-new-exam` 的 deepEqual 照過）。
  `relinkSlot()` 比 `entitlementId`（null 對 null）＋ `isOneTimeSlot()` 對 `guestSlot`，只動 `followupForVisitId`；存之前 `relinkAfterSave()` 照常過 `validateVisit()`（02 的投影認得一次性的連結）
- **接在一次性健檢上的 n返**（中途發現 3、7）：`nthFollowup.js` 新的 `isOneTimeExamVisit(examVisit, entitlements, coursesById)`（跟 `courseIdForNth()` 同一段認出健檢）；
  `slotFromPicks()` 的 n返 那一條（`nthPath`）接的那一次是一次性的健檢 → 寫 `oneTime: true`（沒給 `picks.oneTime` 也是）；
  `validateVisit()` 在 n返 那一圈多一道：**標不標一次性要跟接的那一次一樣**（沒標 →「接的是一次性那一次的健檢 —— 這一場也要標成一次性」；
  標了卻接一般的 →「一次性的 n返 只接一次性的健檢」）—— 反方向那一句 issue 沒要，對稱寫了；一次性客人身上每一次健檢都是一次性的，永遠不會誤擋

**刻意不吃投影**（照 issue）：`sheetReport.js:898`、`customerDetail.js:1065`、`chainAfterEntitlements()` 的 `inChain`（改的是真的額度）、
`aboveeImport.js:343/357/399/1185`、`schedule.js:1846`、`visitEditor.js:853`、`home.js:2699`（都是「選了一筆真的二返額度，接哪一次」—— 一次性的那一顆是 06、07 的 `oneTimeExamChoices()`）。

`sw.js` v286（origin/develop v283；段一 rebase 之後 01 是 v284、02 是 v285）。E2E 沒在本機跑（`--related` 挑到 74 支），04 做完推上去用 CI 全量跑一次。
