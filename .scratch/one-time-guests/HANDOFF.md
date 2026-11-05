# 一次性客人 —— 交接

分支：`claude/one-time-visit-design`（從 develop `3bd4611d` 開；設計段的 commit 在上面）。
checkout：`.claude/worktrees/one-time-visit-design-15190a`（段都共用這一個資料夾，一次只有一段在寫）。
主控：設計段那個 session（2026-11-05）。**實作要等 `claude/small-fixes-2026-11-05` 合進 develop 才開始**，她說合了之後主控開段一。

## 分段

| 段 | issue | effort | 狀態 |
|---|---|---|---|
| 設計 | 談定 8 題、ADR-0172、CONTEXT.md、spec、issue 01–08、subagent 過目 | xhigh | **做完**（commit 見 git log） |
| 一 | 01 形狀與驗證、02 健檢那一串（domain：虛擬的一對） | xhigh | 等 small-fixes 合進 develop |
| 二 | 03 健檢那一串（呼叫端：先問有沒有真的二返額度就收手的那幾處）、04 名單、試算表、資料健檢、月底對帳 | xhigh | todo |
| 三 | 05 客戶清單最底下、名字卡那一頁（含表單元件）、轉成我的客戶；06 日曆新增、來訪編輯器與壓表、讀取卡片、「約二返」的按鈕 | high | todo |
| 四 | 07 拍 Abovee；08 文件；CI 全量 E2E；手動驗收清單草稿 | high | todo |
| 五 | `/matt-code-review` 審查這一輪全部 | xhigh | todo |
| 六 | 照審查修、手動驗收清單在模擬器走一次、開 PR 進 develop、CI 綠了合併 | medium | todo |

## 每一段共同的規矩

- **動工前先 `git fetch`**，確認 `claude/small-fixes-2026-11-05` 已經合進 develop（`git log origin/develop --oneline | grep -i "small-fixes"`，或 `gh pr list --state merged --head claude/small-fixes-2026-11-05`）。
  **沒合就停下來跟她說，不要開始改 app。** 合了 → `git rebase origin/develop`（不重做）
- **不碰**主資料夾（另一輪在那裡）、`claude/small-fixes-2026-11-05` 那條分支、`.scratch/small-fixes-2026-11-05/`
- 先讀 `CLAUDE.md`、`docs/agents/lessons.md`、ADR-0172、spec.md、這一段那幾支 issue（含前面幾支的「做完時留下的」）、下面「過目抓到的」
- **改一個已經存在的函式、型別或畫面上的字之前**，照 `ripple-check` 列出所有呼叫端、波及範圍與畫面上出現的地方；修完 bug 找同一個形狀的地方。
  **issue 上的行號是 2026-11-05 的 develop**，small-fixes 合進來之後可能位移 —— 照函式名找
- **中途發現的事不岔出去修**：記進下面「中途發現」（哪裡、什麼情境會錯、建議），繼續做原本的；段末一次問她。她說要修的，修之前再照 `ripple-check` 查一次
- **同時最多兩個 subagent**
- 一支 issue 一個 commit：紅燈 → 綠 → `npm run verify` → commit → `Status: done` → 「做完時留下的」。**不要每次全跑 E2E**（CLAUDE.md「測試怎麼跑」）
- `public/` 有動：`git fetch` 之後用 `origin/develop` 上 `sw.js` 的 `VERSION` 再加一、重跑 `npm run shell:snapshot`；同一支 PR 裡第二次動 `public/` 再加一；
  **新檔案要進 `sw.js` 的 `SHELL` 與 `tests-e2e/related.js`**（新的 spec 也要登記）
- ADR：0171 是另一輪的、0172 是這一輪的；要再寫一支先看 `docs/adr` 現在最大號再加一
- **公開 repo**：真名一律寫客戶A，公司名不寫（寫「一次性員工券」）；commit 訊息、PR 內文推之前自己看一眼
- 會寫入的驗收在本機模擬器走（CLAUDE.md「上線」）；她的筆電不要跑到全滿又放著
- **主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON**
- 整輪的判準（ADR-0172）：**這一行會不會讓一位一般客戶或一段沒有標記的段被放寬、被藏起來，或讓一次性的段被算進任何一筆真的額度、出現在試算表上？**

## 她已經決定的

spec.md「談定的」8 題（她每一題都選建議；第 2 題多「看已停用的」一起搬到最底下；第 8 題問清楚之後同意）。

## 過目抓到的（設計段，2026-11-05；一個唯讀 subagent 對著程式碼，最重的四條主控自己對過）

| # | 抓到什麼 | 改了什麼 |
|---|---|---|
| 1 | **很多呼叫端在叫鏈之前先問「有沒有真的二返額度」就收手**：`chainInputs()`（`data/visits.js:477`）、`consequences.js` 三支、簽療程單抽屜（`home.js:3719`）、拍 Abovee 的 `chainKnown`（`aboveeConfirm.js:1164`）—— 只在鏈的函式裡套投影，一次性客人在那幾處一句都不講（主控對過 `:477`） | 拆出 **03**（呼叫端）；ADR-0172 決定三補「套在哪裡」 |
| 2 | n返 不可以填虛擬的二返 id：`counts()`、`linksOf()`、`doubleClaimedExams()` 照 id 認，會被算成二返 | 02：只填健檢段與接在一次性健檢上的二返段；n返 讓找健檢的那幾支認得一次性的健檢段；ADR 同步 |
| 3 | `validateVisit()` 整支吃投影會違反 01（一次性的段沒有額度）、還會講「超過總次數」 | 02：只有二返連結那幾道吃投影（列了行號） |
| 4 | 轉成客戶「拿掉那一格」做不到：`deleteField` 全站沒用過，`repo.commit()` 把變動原樣 `set()` 進稽核，刪除標記放進去整批失敗（主控對過 `repo.js:227-246`） | **改成寫 `oneTime: false`**（`isOneTime()` 只認 `true`）；ADR、01、05、spec 同步 |
| 5 | 「約二返」那一張的「去壓表」對一次性客人是死路 | 06：換成「去日曆排」 |
| 6 | 轉成客戶之後「二返（一次性那一次）」三個入口，壓表沒有 issue | 06 接壓表（`schedule.js` 的 `examChoicesOf`） |
| 7 | 讀取卡片「扣／沒扣」本來就不畫（`fromLine()` 沒有額度回空字串，主控對過）；抬頭是五個呼叫端各自給 | 06：不改那一行、測試釘住；「一次性」畫在 `visitReadHtml()` 裡 |
| 8 | 06 的判準要從進度追蹤打開讀取卡片，跟 04（進度追蹤不列他）矛盾 | 06 判準拿掉進度追蹤 |
| 9 | 來訪編輯器沒有額度的客戶第一段預設送的／體驗（`:227-229`），一次性客人照它會被 01 擋；`slotDraft.js:150` 沒有額度就清掉連結；n返 的路只認真的額度 | 06：不走那個預設；01：一次性的路不走 `:150`、一次性 n返 移到 02 |
| 10 | 三個 `validateVisit()` 呼叫端只傳半個客戶（`{flags}`） | 01：照 `ripple-check` 列每一個呼叫端，傳得出 `oneTime` |
| 11 | `counts()` 的總數讀 `totalQty`，不是 `total`（主控對過 `entitlements.js:123`） | 02 改 |
| 12 | 同名那一句在 `fieldWarnings()`，`confirmReview()` 只收字串放不了連結；「沒有聯絡方式」會在名字卡上響 | 05：句子指路、不放連結；名字卡不講「沒有聯絡方式」 |
| 13 | 手動貼上走 `customerReport()`、挑人那一排列每一位 | 04 兩處都濾 |
| 14 | 新檔案要進 `SHELL` 與 `related.js` | 共同的規矩補一條 |
| 15 | 名字卡表單會做兩份；月底對帳講次數的那幾句要換 | 05 做元件、06／07 重用；04 補那幾句 |

沒改的：無（15 條都照改了）。

## 中途發現

（每一段寫，分段記）

## 要她決定的

（目前沒有）

## 每一段的開場

### 段一（effort：xhigh）

```
這一輪在做「一次性客人」：不是她客人的人（例：公司發的一次性員工券）也記得進 app —— 日曆、待辦照常，
但不在客戶清單、壓表、試算表，沒有額度、不限次數。設計已經跟她談定、寫成 ADR-0172。
分支 claude/one-time-visit-design，資料夾就是這個 worktree；設計段的 commit 已經在上面。

先做：
1. git fetch；確認 claude/small-fixes-2026-11-05 已經合進 develop（git log origin/develop --oneline | grep -i "small-fixes"）。
   沒合 → 停下來跟她說，什麼都不要改。合了 → git rebase origin/develop
2. 讀 CLAUDE.md、docs/agents/lessons.md、docs/adr/0172-a-one-time-guest-is-a-customer-off-every-list.md、
   docs/adr/0169-a-follow-up-whose-exam-she-did-not-book.md、.scratch/one-time-guests/spec.md、
   .scratch/one-time-guests/HANDOFF.md（「每一段共同的規矩」「過目抓到的」）

這一段做 .scratch/one-time-guests/issues/01-guest-and-slot-shape.md，再做 02-checkup-chain-virtual-pair.md。不做 03 以後的。
02 是整輪最要緊的一支：健檢那一串（ADR-0022/0139/0142/0145/0159）的規則一個字都不改，只在算的時候替一次性客人生一對虛擬的額度。
做不出來、或發現要改鏈本身的規則 → 停下來寫進 HANDOFF「要她決定的」，不要自己換成 ADR-0172 否決的路。
issue 上的行號是 2026-11-05 的 develop，small-fixes 合進來之後可能位移 —— 照函式名找。

規矩照 HANDOFF「每一段共同的規矩」：改既有的函式前照 ripple-check 查牽連、修完找同一個形狀；中途發現記進 HANDOFF 不岔出去修；
subagent 同時最多兩個；一支一個 commit、npm run verify 通過、Status: done、寫「做完時留下的」。
主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。

做完要交：兩支各一個 commit；HANDOFF 的分段表、中途發現、要她決定的更新；段二的開場照下面那一份（有要改的就改）；
最後回覆簡短說做了什麼、卡在哪。
```

### 段二（effort：xhigh）—— 段一做完時再對一次

```
這一輪在做「一次性客人」（ADR-0172）。分支 claude/one-time-visit-design，資料夾就是這個 worktree；段一做完 01、02（commit 見 git log）。
先 git fetch，落後 develop 就 rebase。讀 CLAUDE.md、docs/agents/lessons.md、ADR-0172、.scratch/one-time-guests/spec.md、
.scratch/one-time-guests/HANDOFF.md（共同的規矩、過目抓到的、中途發現）、01 與 02 的「做完時留下的」。
這一段做 .scratch/one-time-guests/issues/03-checkup-chain-callers.md，再做 04-lists-sheet-health-reconcile.md。不做 05 以後的。
規矩照 HANDOFF「每一段共同的規矩」。主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。
做完要交：各一個 commit、HANDOFF 更新、段三的開場、簡短回覆。
```

### 段三（effort：high）—— 段二做完時再對一次

```
這一輪在做「一次性客人」（ADR-0172）。分支 claude/one-time-visit-design，資料夾就是這個 worktree；段一、二做完 01–04。
先 git fetch，落後 develop 就 rebase。讀 CLAUDE.md、docs/agents/lessons.md、ADR-0172、.scratch/one-time-guests/spec.md、
.scratch/one-time-guests/HANDOFF.md、01–04 的「做完時留下的」。
這一段做 .scratch/one-time-guests/issues/05-name-card-page-and-convert.md，再做 06-calendar-new-editor-read-card.md。不做 07、08。
05 的名字卡表單做成元件（06、07 重用）。畫面的判準寫 E2E；手動驗收的路要寫實際的選擇器（她照著點）。
規矩照 HANDOFF「每一段共同的規矩」。主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。
做完要交：各一個 commit、HANDOFF 更新、段四的開場、簡短回覆。
```

### 段四（high）、段五（xhigh，審查單獨一段）、段六（medium）

段三做完時寫。段四：07 拍 Abovee、08 文件、`gh workflow run e2e-full.yml --ref claude/one-time-visit-design` 全量、手動驗收清單草稿（她照順序點的路）。
段五：`/matt-code-review` 審這一輪全部（從設計段的第一個 commit 起），「要特別看的」寫成判準問句＋要查牽連的符號
（`isOneTime`、`isOneTimeSlot`、`withOneTimeChain`、`chainInputs`、`syncBundle`、`customerReport`、`slotFromPicks`、`validateVisit`；grep `oneTime:`）。
段六：照審查修（每條先紅燈）、手動驗收清單在模擬器走一次、推之前看一眼有沒有真名／公司名、開 PR 進 develop、CI 綠了合併（CLAUDE.md：不用再問）。
