# 一次性客人 —— 交接

分支：`claude/one-time-visit-design`（設計段從 develop `3bd4611d` 開；11/5 小修合進 develop 之後 rebase 到 `f5fb7b0a`；段二開頭再 rebase 到 `926e5712`（試算表那一輪 PR #204 合進來了）—— 撞了 ADR 索引那一行與 `sw.js` 快照，`sw.js` 重新編號：01 v284、02 v285、03 v286、04 v287）。
checkout：`.claude/worktrees/one-time-visit-design-15190a`（段都共用這一個資料夾，一次只有一段在寫）。
主控：設計段那個 session（2026-11-05）。小修那一輪 11/5 合進 develop 了（PR #203，`f5fb7b0a`），主控同一天開段一。

## 分段

| 段 | issue | effort | 狀態 |
|---|---|---|---|
| 設計 | 談定 8 題、ADR-0172、CONTEXT.md、spec、issue 01–08、subagent 過目 | xhigh | **做完**（commit 見 git log） |
| 一 | 01 形狀與驗證、02 健檢那一串（domain：虛擬的一對） | xhigh | **做完**（11/5，`0668f0ee`、`ff12b4fd`；單元 5552 全過；CI 全量 E2E 六台全綠） |
| 二 | 03 健檢那一串（呼叫端：先問有沒有真的二返額度就收手的那幾處）、04 名單、試算表、資料健檢、月底對帳 | xhigh | **做完**（11/5，`7389fb7b`、`9ea77263`；單元 5634 全過、真名掃描 skipped 0；被 auto mode 擋下來之後，**她 11/5 准主控強制推一次**（`--force-with-lease`），推上去了；CI 全量 E2E 見中途發現段二第 1 條） |
| 三 | 05 客戶清單最底下、名字卡那一頁（含表單元件）、轉成我的客戶；06 日曆新增、來訪編輯器與壓表、讀取卡片、「約二返」的按鈕 | high | **做完**（11/5，`42b054f6`、`f2fc82a0`，都推上去了（一般的 push，沒有改寫）；單元 5664 全過、真名掃描 skipped 0；E2E `94`、`95` 本機全綠；CI 全量 run `41986269764` 見中途發現段三第 1 條） |
| 四 | 07 拍 Abovee；08 文件；CI 全量 E2E；手動驗收清單草稿 | high | todo |
| 五 | `/matt-code-review` 審查這一輪全部 | xhigh | todo |
| 六 | 照審查修、手動驗收清單在模擬器走一次、開 PR 進 develop、CI 綠了合併 | medium | todo |

## 每一段共同的規矩

- **動工前先 `git fetch`**；這一條分支落後 `origin/develop` 就**合併、不要 rebase**（11/5 起）：這個 worktree 是 app 開的，用 ccd_host 的 `sync_with_base_branch` 工具（沒有那個工具就 `git merge origin/develop`），解完衝突照常 commit、push。rebase 會換掉已經推上去的 commit，之後只能強制推送 ——
  auto mode 把它當成有破壞性的操作擋下來（段二被擋過；她 11/5 准過一次，**不是之後都准**）
- 小修那一輪（PR #203）已經在 develop：**來訪編輯器按儲存一律重讀這位客戶的全部來訪**、資料健檢「補上二返額度／補警示詞」的 id 掃描時鑄好、
  重算次數帶 `ifUpdatedAt`、營養品交付寫之前重讀、隨手記挑日期、行事備註顏色（ADR-0171）。**03、04、06 碰到 `data/visits.js`、`data/health.js`、`visitEditor.js` 的地方先看現在長怎樣**
- **還在平行做的兩輪**（各在自己的 worktree，**不碰它們的資料夾與分支**）：
  - 試算表變快（`claude/sheet-speed`）：正在改 `public/js/domain/sheetReport.js`、`public/js/data/sheetSync.js`、`public/js/domain/sheetPushTiming.js`、`sheets/readonly-report.gs`、`tests/sheet-fingerprint.test.js`。
    **這一輪永遠不改 `sheetSync.js`、`sheetPushTiming.js`、`.gs`**；`sheetReport.js` 只有 04 要改（`syncBundle()`／`customerReport()`）與 `ui/views/report.js` —— 見 04 開頭那一段
  - iPad（`claude/ipad-photo-and-speed`）：之後改 `camera.js`／`photo.js`，跟 07（`aboveeImport.js`、`aboveeConfirm.js`）不同檔
- **模擬器同一時間只能一組在跑**（同一組 port）：起之前先看 port 上有沒有人（`netstat -ano | findstr :5000` 之類）；**有的話不要停掉別人的，先問她**
- 先讀 `CLAUDE.md`、`docs/agents/lessons.md`、ADR-0172、spec.md、這一段那幾支 issue（含前面幾支的「做完時留下的」）、下面「過目抓到的」
- **改一個已經存在的函式、型別或畫面上的字之前**，照 `ripple-check` 列出所有呼叫端、波及範圍與畫面上出現的地方；修完 bug 找同一個形狀的地方。
  **issue 上的行號是 2026-11-05 的 develop**，small-fixes 合進來之後可能位移 —— 照函式名找
- **中途發現的事不岔出去修**：記進下面「中途發現」（哪裡、什麼情境會錯、建議），繼續做原本的；段末一次問她。她說要修的，修之前再照 `ripple-check` 查一次
- **同時最多兩個 subagent**
- 一支 issue 一個 commit：紅燈 → 綠 → `npm run verify` → commit → `Status: done` → 「做完時留下的」。**不要每次全跑 E2E**（CLAUDE.md「測試怎麼跑」）
- `public/` 有動：`git fetch` 之後用 `origin/develop` 上 `sw.js` 的 `VERSION` 再加一（11/5 develop 是 `v282`）、重跑 `npm run shell:snapshot`；同一支 PR 裡第二次動 `public/` 再加一；
  **新檔案要進 `sw.js` 的 `SHELL` 與 `tests-e2e/related.js`**（新的 spec 也要登記）
- ADR：0171 是小修的、0172 是這一輪的；**0173 留給 iPad、0174 留給試算表，這一輪再寫新的從 0175 起**
- **公開 repo**：真名一律寫客戶A，公司名不寫（寫「一次性員工券」）；commit 訊息、PR 內文推之前自己看一眼
- **真名掃描要真的有跑**（11/5 段一之後補的）：worktree 只帶得到被追蹤的檔案，`.local/` 本來不在這裡 → `tests/no-secrets.test.js` 一直是 skipped。
  現在 worktree 根目錄有一個目錄連結 `.local` → 主資料夾的 `.local`（`git check-ignore -v .local` 擋得住）。**推之前跑 `node --test tests/no-secrets.test.js`，要 skipped 0**；
  commit 訊息另外過一次過濾網（`git log origin/develop..HEAD --format=%B` 經 `node .local/references/redact.mjs`，比前後一不一樣、只印「一不一樣」）。
  **不要刪那個連結、不要往裡面寫**（那是她的私人 repo）；收 worktree 時 `git worktree remove` 會把連結留在原地，要另外刪（只刪連結，不會刪到主資料夾那一份）
- **查牽連用這個 worktree 自己的 CodeGraph 索引**（11/5 主控照 `docs/agents/worktree.md` 接好：`codegraph init -i`，`.codegraph/` 有被擋）——
  主資料夾那一份是 develop 的、看不到 01、02 新加或改過的符號（會印「This CodeGraph index belongs to a different git working tree」就是用錯了）。
  改了檔之後在**這個 worktree** `codegraph sync` 再查；照樣跟 grep 對一次（純 JS，兩邊常常不一樣：段一 `validateVisit` 圖上少了三個呼叫端）。
  graphify 查主資料夾那一份：`graphify query "<問題>" --graph <主資料夾>/graphify-out/graph.json`；**不要在 worktree 裡 `graphify update`**
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

### 段一（2026-11-05）

1. **`cannotClose()`／`closeBlocks()` 只在 ctx 給了 `coursesById` 時認得一次性客人**（原本的 ctx 只有 `{ entitlements, visits }`，認不出哪一段是健檢）。
   情境：一次性的二返接的健檢還沒做完，簽療程單照樣簽得下去。**03 要在每一個呼叫端補 `coursesById`**：`home.js` 的 `closeGuard()`（抽屜那一列、「全部 ✓」、存的那一下）、
   `visits.js` 的 `closeVisit()` 收的 guard、`consequences.js` 的 `closeConsequences()`（`:799`）、`aboveeImport.js` 的四處（`:1766`、`:1818`、`:1997`、`:2807`）。這就是 03 那一支的一部分，不另開
2. **ADR-0146「另約健檢時順便把那一場二返接過來」不認得一次性客人**：`relinkOffer()` 裡的 `strandedFollowups()` 認得（回的是原本那一份），
   但接著問「扣的二返額度配不配這一次新加的健檢」要真的額度 → 一次性客人永遠沒有那一顆；`relinkSlot()` 也比 `slot.entitlementId`。
   情境：客戶A 的一次性健檢取消了、二返還接著它，她在日曆新增另約一次一次性健檢 → 確認框講「有一場二返還接在被取消的那一次上」（03 接好之後），但沒有「順便接過來」那一顆，要自己去日曆改那一段。
   **建議 03 做**：`relinkOffer()`／`relinkSlot()` 多收 `coursesById`、在投影裡比（`relinkSlot()` 比完換回原本那一段、只動 `followupForVisitId`）；或明說不做、讓那一句照舊。不用問她（照第 3 題「跟一般客人一模一樣」推得出來）
3. **轉成我的客戶之後，接在一次性健檢上的 n返 要不要標一次性**：02 讓 `examChoicesForNth()` 列得出一次性的健檢（一次性的 n返 本來就要），所以轉成客戶之後壓表／編輯器的「＋ n返」也接得上一次性的那一次，
   組出來的是一段**沒有標記**的 n返。試算表會把它印在「三返（不算次數）」那一列、健檢那一欄底下的 `followupNotes` 指著一次性健檢那一天 —— 而那一天整天是一次性的、04 不畫那一欄。
   **建議照第 6 題推（不用問她）**：接的那一次是一次性的健檢時，n返 也標一次性（跟「還欠的那一場二返照舊標一次性」同一個理由：那一串是一次性那一次的）—— ~~06 的三個入口組時段時判~~ **改成 03 在 `slotFromPicks()` 一處判（主控，見第 7 條）**；
   04 的試算表另外保險：`followupNotes()` 指到的那一天沒有畫出來就不印。04、06 誰先做誰接
4. `followups.js` 的 `examStates()` 全站沒有呼叫端（死碼）。02 沒有套投影。不影響這一輪，記著
5. **E2E 這一段沒在本機跑**：`--related` 挑到 60 支（分支上還有設計段改的文件），本機 2 個 worker 也要二十幾分鐘。推上去用 CI 全量跑
   （`gh workflow run e2e-full.yml --ref claude/one-time-visit-design`，run `41976177226`，跑在 `ff12b4fd`）—— **六台全綠**（11/5）

### 主控用這個 worktree 自己的 CodeGraph 索引重查（2026-11-05，段一做完之後；她要的）

worktree 照 `docs/agents/worktree.md` 接好了：`codegraph init -i`（501 個檔、`.codegraph/` 有被擋）；graphify 查主資料夾的 `graphify-out/graph.json`。
拿 `0668f0ee`、`ff12b4fd` 動到的函式（`cannotClose`、`closeBlocks`、`examChoicesForNth`、`courseIdForNth`、`slotOptionsFor`、`slotFromPicks`、`validateVisit`、
`syncFollowupTasks`、`strandedFollowups`、`doneAheadOfExam`、`doubleClaimedExams`、`bookingStateForTask`、`giftKindOf`、`countOps`、`relinkOffer`、`relinkSlot`、
`examChoicesFor` 與新的那幾支）跑 `codegraph callers`，跟段一列的對：

6. **段一第 1 條漏了一處**：`home.js` 簽療程單抽屜「存的那一下」（`applyClose()`，`:4047` 附近）**自己組 guard**（`{ entitlements, visits: customerVisits }`），不經過 `closeGuard()`（`:3965`）——
   只補 `closeGuard()` 的話，抽屜那一列與「全部 ✓」擋得住，按下去存的那一下（`closeBlocks()` `:4048`、`closeVisit(…, guard)` `:4055`）照樣放行。**排進段二的 03**
7. **段一第 3 條（接在一次性健檢上的 n返）的入口不只 06**：`examChoicesForNth()` 的呼叫端是來訪編輯器 `nthExamChoices`（`visitEditor.js:772`）、壓表 `nthExamChoices`（`schedule.js:1637`）、
   **拍 Abovee `nthRows`（`aboveeConfirm.js:900`，07）**、`slotOptionsFor()`、`slotFromPicks()`、`examNotMineWarnings()`。三個入口組時段都經過 `slotFromPicks()`（`slotDraft.js:74`）——
   **在 `slotFromPicks()` 一處判**：n返 接的那一次健檢是一次性的段 → 這一段也標一次性；`validateVisit()` 擋「接一次性健檢、卻沒標一次性」的 n返。**排進段二的 03**（domain、小），06、07 不用各判一次
8. 對上了、不用改的：`cannotClose()`／`closeBlocks()` 在拍 Abovee 的四處（`applyPhotoStatus`、`gateStatusChanges`、`applyPhotoMove`、`blockedInGroups`）、`closeConsequences()`、`closeVisit()`；
   `validateVisit()` 的五個呼叫端（來訪編輯器 `paint`／`submit` 整份、壓表 `addSlot`、`relinkAfterSave`、拍 Abovee `checkMoves`／`photoDayPlan` 都經過 `checkCtxFor()`）；
   `relinkOffer()`／`relinkSlot()`（＝段一第 2 條）；`examChoicesFor()` 的呼叫端照設計不套投影（06、07 改走 `oneTimeExamChoices()`）
9. **知道就好**：`slotOptionsFor()` 多出來的「二返（一次性那一次）」已經流進壓表 `courseOptions`（`schedule.js:1622`）、拍 Abovee `optionsFor`（`aboveeConfirm.js:871`）、
   `nthOffered`（`aboveeImport.js:737`，只問 `isNth`，不受影響）—— 按下去的處理在 06（壓表）、07（拍 Abovee）；**轉成客戶（05）之前到不了**（`oneTimeOwed()` 要有一次性的健檢段），
   05、06 同一段，07 在段四，分段之間不部署所以沒事。來訪編輯器不叫 `slotOptionsFor()`，06 要自己加那一顆

### 段二（2026-11-05）

1. **兩個 commit 還沒推上去**：段二開頭 rebase 到 `926e5712`（落後 54 個），所以推這條分支要 `git push --force-with-lease origin claude/one-time-visit-design`——
   auto mode 判成「Git Destructive」擋下來，照規矩停了沒有繞。**推上去之後**跑一次 CI 全量：`gh workflow run e2e-full.yml --ref claude/one-time-visit-design`
   （本機 `--related` 挑到 74 支、2 個 worker 也要三十幾分鐘，跟段一一樣交給 CI）。推之前的檢查做過了：`tests/no-secrets.test.js` skipped 0、commit 訊息過過濾網前後一樣；
   diff 過過濾網有 26 行被遮，看過全是數字、日期與器材代號 `sis`（`eq-sis`），沒有名字
   → **她 11/5 准強制推一次，主控推了**（`--force-with-lease`，`3c2d052b`）；CI 全量 E2E run `41981609898`（跑在 `3c2d052b`）—— **段三開頭看了：六台全綠**（11/5），沒有要修的
2. **`strandedOnNewExamLines()` 也是同一個形狀**（issue 沒列）：它先問「新加的那一段扣不扣健檢額度」才講「有一場二返還接在被取消的那一次上」——
   一次性客人另約健檢時一句都不講，ADR-0146 那一顆也跟著沒有。**03 一起修了**（在投影裡認新加的那一段），測試在 `one-time-chain-callers.test.js`
3. **`chainInputs()` 多了第三個參數**（這位客戶的來訪）。06（日曆新增、來訪編輯器）與 07（拍 Abovee）**新增一條會叫它的路要傳**，不然一次性客人在那一道確認框上一句鏈上的話都不講；
   `one-time-chain-callers.test.js` 掃 `visitsData.chainInputs(` 每一處都有三個參數（新的那一處沒傳會紅）
4. **`relinkOffer()` 回的那一格叫 `guestSlot`、不叫 `oneTime`**：`one-time-guest.test.js` 掃全站沒有人自己讀 `.oneTime`（只准 `isOneTime()`／`isOneTimeSlot()`），
   `offer.oneTime` 會被當成違規。只有一次性的那一場才有那一格，一般客人回的形狀一個字都沒變
5. **試算表：混著一般的段的那一天，沒有 `slotIndexes` 的鏈上待辦照印**（`sheetReport.js` 的 `guestTask()`，拿不準就印）。只有「轉成客戶那一天同一天又記了一般的段」才會發生，不修
6. 月底對帳那一頁「Abovee 上有、app 裡沒有這個人」那一塊的小字（`report.mjs`：「不是妳的客人就不用管。」）可以多一句「要記進 app 就建一次性客人」——
   等名字卡（05）與拍 Abovee 的「記成一次性客人」（07）做好再決定，**08 寫文件時一起看**
7. 知道就好：`home.js` 的 `bookFollowup()`（「約二返」那一張的「去壓表」）只認真的二返額度 —— 那是過目第 5 條，06 換成「去日曆排」

### 段三（2026-11-05）

1. **CI 全量 E2E**：段三兩個 commit 推上去之後跑了 `gh workflow run e2e-full.yml --ref claude/one-time-visit-design`，run `41986269764`（跑在 `f2fc82a0`）——
   段三結束時還在跑，**段四開頭先看**（紅了先修，那是 05、06 的）。本機 `--related` 挑到 89 支（幾乎全量），所以只跑了 `94`、`95`、`83`、`67`（32 支全綠）
2. **轉成我的客戶之後改一段以前的一次性的段、按一筆真的額度** → 那一段照舊帶 `oneTime: true`，存檔被擋（「一次性的段不扣任何次數，不可以同時指定額度」）。
   刻意沒有在換額度時拿掉那一格（她第 6 題：「以前的那幾段照舊算一次性」；安安靜靜把它變成扣額度，就是讓一次性的段被算進真的額度）。
   擋下來那一句講的不是「怎麼辦」—— **段五審查看要不要換一句**（例：「這一段是當一次性客人時記的，不扣額度；要扣就取消這一段、另約一段」），不用問她
3. **讀取卡片的「一次性」在抬頭底下、卡片內容最上面那一格**，不是跟名字同一行：抬頭（名字）是五個呼叫端各自給的，issue 要畫在 `visitReadHtml()` 裡。截圖看過，讀得出來。她驗收時如果要同一行，要改五個呼叫端的抬頭
4. **`SPEC.md:1616`** 還寫「看這個月的進度」和「看已停用的」並排 —— 08 寫文件時改（05 的「做完時留下的」也記了）
5. 知道就好：「約二返」那一顆換字（`home.js` 的 `labelGuestBookings()`）是畫完再讀一次客戶名單（任務身上只有 `customerId`）。字換過來之前按下去也走對（`bookFollowup()` 自己再問一次）
6. 知道就好：來訪編輯器第一列（名字＋狀態）沒標「一次性」—— spec 只要讀取卡片與找人的框
7. 段二第 6 條（月底對帳那一塊的小字要不要多一句「要記進 app 就建一次性客人」）：名字卡做好了，**等 07（拍 Abovee 的「記成一次性客人」）做完，08 寫文件時一起決定**

## 要她決定的

（目前沒有）

## 每一段的開場

### 段一（effort：xhigh）

```
這一輪在做「一次性客人」：不是她客人的人（例：公司發的一次性員工券）也記得進 app —— 日曆、待辦照常，
但不在客戶清單、壓表、試算表，沒有額度、不限次數。設計已經跟她談定、寫成 ADR-0172。
分支 claude/one-time-visit-design，資料夾就是這個 worktree；設計段的 commit 已經在上面。

小修那一輪 11/5 合進 develop 了（PR #203，f5fb7b0a），這條分支已經 rebase 上去。
先做：
1. git fetch；落後 origin/develop 就 git rebase origin/develop
2. 讀 CLAUDE.md、docs/agents/lessons.md、docs/adr/0172-a-one-time-guest-is-a-customer-off-every-list.md、
   docs/adr/0169-a-follow-up-whose-exam-she-did-not-book.md、.scratch/one-time-guests/spec.md、
   .scratch/one-time-guests/HANDOFF.md（「每一段共同的規矩」「過目抓到的」）

這一段做 .scratch/one-time-guests/issues/01-guest-and-slot-shape.md，再做 02-checkup-chain-virtual-pair.md。不做 03 以後的。
02 是整輪最要緊的一支：健檢那一串（ADR-0022/0139/0142/0145/0159）的規則一個字都不改，只在算的時候替一次性客人生一對虛擬的額度。
做不出來、或發現要改鏈本身的規則 → 停下來寫進 HANDOFF「要她決定的」，不要自己換成 ADR-0172 否決的路。
issue 上的行號是小修合進來之前的 develop，可能位移 —— 照函式名找。小修改過來訪編輯器的儲存（一律重讀全部來訪）與資料健檢，碰到先看現在長怎樣。
還有兩輪在平行做（試算表 claude/sheet-speed、iPad claude/ipad-photo-and-speed）：這一段不碰 sheetReport.js、sheetSync.js、sheetPushTiming.js、
readonly-report.gs、camera.js、photo.js。ADR 再寫新的從 0175 起（0173、0174 留給那兩輪）。sw.js 的 VERSION 用 origin/develop 上的再加一。
模擬器同一時間只能一組在跑：起之前先看 port 上有沒有人，有的話不要停掉別人的，先問她。

規矩照 HANDOFF「每一段共同的規矩」：改既有的函式前照 ripple-check 查牽連、修完找同一個形狀；中途發現記進 HANDOFF 不岔出去修；
subagent 同時最多兩個；一支一個 commit、npm run verify 通過、Status: done、寫「做完時留下的」。
主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。

做完要交：兩支各一個 commit；HANDOFF 的分段表、中途發現、要她決定的更新；段二的開場照下面那一份（有要改的就改）；
最後回覆簡短說做了什麼、卡在哪。
```

### 段二（effort：xhigh）—— 段一做完時對過了（11/5）

```
這一輪在做「一次性客人」（ADR-0172）。分支 claude/one-time-visit-design，資料夾就是這個 worktree；段一做完 01、02（commit 見 git log）。
先 git fetch，落後 develop 就 rebase；這個 worktree 已經有 node_modules（rebase 之後 package-lock 變了才重跑 npm ci）。
讀 CLAUDE.md、docs/agents/lessons.md、ADR-0172、.scratch/one-time-guests/spec.md、
.scratch/one-time-guests/HANDOFF.md（共同的規矩、過目抓到的、中途發現 —— 段一那五條＋主控重查的 6～9）、01 與 02 的「做完時留下的」。
查牽連用這個 worktree 自己的 CodeGraph 索引（已經 codegraph init -i；改了檔之後 codegraph sync 再查），graphify 查主資料夾的 graph.json（--graph）。
這一段做 .scratch/one-time-guests/issues/03-checkup-chain-callers.md，再做 04-lists-sheet-health-reconcile.md。不做 05 以後的。
02 的投影在 public/js/domain/oneTimeChain.js（withOneTimeChain／originalOf／assertNoOneTimeIds），鏈的函式進來自己套；
03 是「叫到鏈之前就先問有沒有真的二返額度」的那幾處，另外：cannotClose／closeBlocks 只在 ctx 給了 coursesById 時認得一次性客人，
每一個呼叫端要補（HANDOFF 中途發現段一第 1 條列了在哪，**加上第 6 條：簽療程單抽屜存的那一下 applyClose() 自己組 guard、不經過 closeGuard()**）；
relinkOffer／relinkSlot 照中途發現第 2 條的建議做或明說不做；**第 7 條：接在一次性健檢上的 n返 在 slotFromPicks() 一處標一次性、validateVisit() 擋沒標的**（03 一起做）。
04 碰到試算表時看中途發現第 3 條（followupNotes() 指到沒畫出來的那一天就不印）。
04 要改 sheetReport.js 的 syncBundle()／customerReport() 與 ui/views/report.js。試算表那一輪的 PR #204（claude/sheet-speed-2，ADR-0174）11/5 已經合進 develop、
sheetReport.js 那幾行在裡面；claude/sheet-speed 那條分支跟 develop 只差 .gs 與 sheets/README。開 04 之前 git fetch、rebase，
再看一次有沒有開著的 PR 動 sheetReport.js（gh pr list --state open）—— 有就先做 04 裡不碰試算表的部分（名單、資料健檢、月底對帳），試算表那一塊最後做，或問她要不要等。永遠不改 sheetSync.js、sheetPushTiming.js、.gs。ADR 再寫新的從 0175 起。
模擬器同一時間只能一組在跑：起之前先看 port 上有沒有人，有的話不要停掉別人的，先問她。
規矩照 HANDOFF「每一段共同的規矩」。主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。
做完要交：各一個 commit、HANDOFF 更新、段三的開場、簡短回覆。
```

### 段三（effort：high）—— 段二做完時對過了（11/5）

```
這一輪在做「一次性客人」（ADR-0172）。分支 claude/one-time-visit-design，資料夾就是這個 worktree；段一、二做完 01–04（commit 見 git log）。
段二那兩個 commit（03、04）主控 11/5 推上去了（她准強制推一次），也跑了 CI 全量 E2E（run 編號在 HANDOFF 中途發現段二第 1 條）：
先 gh run view <那個編號> 看結果 —— 紅了先修（那是 03、04 的），每一條先紅燈、寫回 HANDOFF，再開始 05。
接著 git fetch；落後 develop 就合併、不要 rebase（用 ccd_host 的 sync_with_base_branch 工具，沒有就 git merge origin/develop；package-lock 變了才重跑 npm ci）——
rebase 之後只能強制推送，auto mode 會擋。
讀 CLAUDE.md、docs/agents/lessons.md、ADR-0172、.scratch/one-time-guests/spec.md、
.scratch/one-time-guests/HANDOFF.md（共同的規矩、過目抓到的、中途發現 —— 段一、主控重查、段二那七條）、01–04 的「做完時留下的」。
查牽連用這個 worktree 自己的 CodeGraph 索引（改了檔之後 codegraph sync 再查，照樣跟 grep 對一次），graphify 查主資料夾的 graph.json（--graph）。
這一段做 .scratch/one-time-guests/issues/05-name-card-page-and-convert.md，再做 06-calendar-new-editor-read-card.md。不做 07、08。
段二留給這一段的：
- data/visits.js 的 chainInputs(customerId, coursesById, visits) 多了第三個參數 —— 06 新增一條會叫它的路要傳這位客戶的來訪（連要存的那一筆），
  tests/one-time-chain-callers.test.js 掃每一處都有三個參數
- 05 轉成我的客戶的確認框講鏈上的事：試算拿 followups.js 的 hasFollowupChain()／syncFollowupTasks()（03 起認得那一對），句子放 consequences.js
- 名字卡那一頁畫來訪紀錄可以照客戶詳情用 domain/progress.js 的 buildProgress()：它刻意沒濾一次性客人（濾在 ui/views/progress.js 那一行，04）
- 客戶清單（05）要自己明寫 isOneTime() 排除（04 只做了進度、長備註、手動貼上那幾張）；「看已停用的」那一份也不列一次性客人
- 06：約二返那一張的「去壓表」（home.js 的 bookFollowup()）換成「去日曆排」（過目 5）；日曆新增另約一次一次性健檢時，
  ADR-0146 那一顆「順便把那一場二返接到這一次」03 已經認得一次性客人（relinkOffer／relinkSlot）
- 接在一次性健檢上的 n返：slotFromPicks() 會自己標一次性（03），三個入口不用各判；validateVisit() 擋標法跟健檢對不上的
05 的名字卡表單做成元件（06、07 重用）。畫面的判準寫 E2E；手動驗收的路要寫實際的選擇器（她照著點）。
public/ 有動：sw.js 的 VERSION 用 origin/develop 上的與這條分支上的大的那一個再加一（段二結束時這條分支是 v287）；新檔案進 SHELL 與 tests-e2e/related.js。
ADR 再寫新的從 0175 起。模擬器同一時間只能一組在跑：起之前先看 port 上有沒有人，有的話不要停掉別人的，先問她。
推之前 node --test tests/no-secrets.test.js 要 skipped 0。
規矩照 HANDOFF「每一段共同的規矩」。主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。
做完要交：各一個 commit（推到 origin 的同一條分支）、HANDOFF 更新、段四的開場、簡短回覆。
```

### 段四（effort：high）—— 段三做完時對過了（11/5）

```
這一輪在做「一次性客人」（ADR-0172）。分支 claude/one-time-visit-design，資料夾就是這個 worktree；段一～三做完 01–06（commit 見 git log）。
段三的兩個 commit（05、06）推上去了，也跑了 CI 全量 E2E：run 41986269764（跑在 f2fc82a0）。
先 gh run view 41986269764 看結果 —— 還在跑就先讀文件、等它；紅了先修（那是 05、06 的），每一條先紅燈、寫回 HANDOFF 中途發現段三第 1 條底下，再開始 07。
接著 git fetch；落後 develop 就合併、不要 rebase（用 ccd_host 的 sync_with_base_branch 工具，沒有就 git merge origin/develop；package-lock 變了才重跑 npm ci）——
rebase 之後只能強制推送，auto mode 會擋；擋了就停下來問她，不要換寫法繞。
讀 CLAUDE.md、docs/agents/lessons.md、ADR-0172、.scratch/one-time-guests/spec.md、
.scratch/one-time-guests/HANDOFF.md（共同的規矩、過目抓到的、中途發現 —— 段一、主控重查、段二、段三那幾條）、01–06 的「做完時留下的」。
查牽連用這個 worktree 自己的 CodeGraph 索引（改了檔之後 codegraph sync 再查，照樣跟 grep 對一次），graphify 查主資料夾的 graph.json（--graph）。
這一段做 .scratch/one-time-guests/issues/07-abovee-photo.md，再做 08-docs.md。
段三留給這一段的：
- 名字卡快速表單：components/guestForm.js 的 mountGuestForm(host, { card: { name, chartNo }, existing, quick: true, onSubmit({ card }) })，建名字卡走
  data/customers.js 的 createWithPlan(oneTimeCustomer(card), { plan: null, quantity: 0, extras: [] })（日曆的 newGuest() 是照抄的樣子）
- 一次性客人那一列「要做什麼」那一排：slotOptions.js 的 guestOptions(courses, { keep, notMineKeep, nthExams })，畫法 giftFold.coursesHtml({ options, value, chip, key, sm })（自己給 chip）；
  值是 guestPick(courseId)、讀回來 guestCourseIdOf(value) → slotFromPicks({ oneTime: true, courseId, followupForVisitId })；一次性的二返接哪一次問 oneTimeExamChoices()
- 轉成我的客戶之後的「二返（一次性那一次）」：slotOptionsFor() 本來就列（ONE_TIME_SECOND_PICK、isOneTimeSecond）—— 拍 Abovee 的 pickOption() 要認它（壓表的寫法：schedule.js 的 examChoicesOf()／addSlot()）
- trialFromMinutes() 已經不換一次性的那一顆（拍 Abovee 的 pickMinutes() 叫它）
- 「換一位」與搜尋結果標「一次性」：class 是 .guestmark（app.css「一次性客人」那一段）
- 08 文件：CLAUDE.md 連動表補「一次性客人」那一列；SPEC.md:1616（看已停用的搬到最底下）；docs/操作手冊.md 與 docs/常見問題.md；
  06 的「做完時留下的」最後有一份手動驗收清單（她照順序點的路），整理進這一段的手動驗收清單草稿；中途發現段二第 6 條、段三第 7 條（月底對帳那一句）這裡決定
- 中途發現段三第 2 條（轉成客戶之後改以前的一次性段、按真的額度 → 擋下來那一句）留給段五
段四做完之後再跑一次 CI 全量（gh workflow run e2e-full.yml --ref claude/one-time-visit-design）。
public/ 有動：sw.js 的 VERSION 用 origin/develop 上的與這條分支上的大的那一個再加一（段三結束時這條分支是 v289）；新檔案進 SHELL 與 tests-e2e/related.js。
ADR 再寫新的從 0175 起。模擬器同一時間只能一組在跑：起之前先看 port 上有沒有人，有的話不要停掉別人的，先問她；跑完照那幾組的 port 停（node tests-e2e/emulator-groups.mjs stop）。
推之前 node --test tests/no-secrets.test.js 要 skipped 0。
規矩照 HANDOFF「每一段共同的規矩」。主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。
做完要交：各一個 commit（推到 origin 的同一條分支）、HANDOFF 更新、段五的開場、簡短回覆。
```

### 段五（xhigh，審查單獨一段）、段六（medium）

段四做完時寫。段五：`/matt-code-review` 審這一輪全部（從設計段的第一個 commit 起），「要特別看的」寫成判準問句＋要查牽連的符號
（`isOneTime`、`isOneTimeSlot`、`withOneTimeChain`、`chainInputs`、`syncBundle`、`customerReport`、`slotFromPicks`、`validateVisit`；grep `oneTime:`）。
段六：照審查修（每條先紅燈）、手動驗收清單在模擬器走一次、推之前看一眼有沒有真名／公司名、開 PR 進 develop、CI 綠了合併（CLAUDE.md：不用再問）。
