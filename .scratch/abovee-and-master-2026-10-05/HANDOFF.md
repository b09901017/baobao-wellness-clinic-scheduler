# 交接：這一輪做到哪、下一個 session 從哪裡接

（每一個接手的 session 做完一段就回來改這一份。）

## 現況（2026-10-06，她回了那五題、說合進 develop）

- **01 做完、合了**：PR #137 → `develop`（`434a380`），staging 部署成功；staging 已清空、**她 10/5 晚貼了合併檔**
  （客戶 29、額度 159、來訪 135、時段 204 全部已完成；資料健檢 35 項）。**在 staging 上測拍 Abovee 用得到這些真客戶**；
  測試時截圖、清單、PR 一個真名都不帶
- **02–17 全部做完**，都在 `claude/abovee-master-2026-10-05` 上（一支一個 commit，每一支的「做完時留下的」在它的 issue 檔最下面）：

  | 支 | commit | 一句話 |
  |---|---|---|
  | 02 分類 | `a7ea74b` | `GROUP_DEFAULTS` 在 `masterData.js`；一組裡的順序是文件 id |
  | 03 系統 | `5c88696` | `systemsOf()`／`bookingSystemOf()`／`tasksForCourse()`；不可以再比 `course.category` |
  | 04 醫師 | `0d892ac` | `doctorChoicesFor()` 三個入口共用 |
  | 05 不算次數 | `e6bdc55` | `slotOptionsFor()`；`slotFromPicks({ uncountedCourseId })` |
  | 06 約時選時長 | `9d7228c` | `slotFromPicks({ minutes })`、`slotMinutesField()` |
  | 07 Abovee 寫法 | `317d729` | 五種主檔都有 `aboveeNames`；`courseFrom()`、`staffRoleFor()` |
  | 08 確認層 | `2737b2f` | `searchCustomers()`、`pickOption()`／`optionValueOf()` |
  | 16 提醒只講算數的段 | `e9d4674` | 七支 warnings 一起 |
  | 09 合併扣課 | `58eb440` | 抄字第十欄、`mergeRows()`；**Function 要重新部署** |
  | 10 時間不同 | `494146c`、`40e2a01` | `flagMoved()` |
  | 11 改成 Abovee 的 | `43e408c` | `aboveeDiffs()`／`adoptAbovee()` |
  | 12 主檔補齊 | `3c4e336`、`d1527a9`、`e6811a6`、`d80e692` | 種子 14 款點滴、治7、功醫門診、羊膜；資料健檢 30 項（`seedIvProduct`、`seedBlanks`、診間的 `restore`）；ADR-0124。10/6 補：羊膜只壓 Abovee |
  | 13 合併檔 v5 | `c30c023` | HRV → 功醫門診＋30 分（`startOf()`）；沒有額度的段三個地方放行；`ivProductOf()` 不再把「營養師」讀成營養守護 |
  | 15 試算表格式 7 | `e7aaea6` | 沒有額度的段的記一句印在來訪紀錄那一行；**她要重貼 `.gs`** |
  | 17 找人一種比法 | `45bd313`、`ecc910e` | `nameHas()`；日曆「要幫誰排？」與批次取消（她 10/5：「好 ! 可以修改」）。10/6 補：壓表牆、客戶清單也換了 |
  | 14 文件總對 | `4c3a26e` | CONTEXT／SPEC／對照表／操作手冊；`CLAUDE.md` 連動表補三列 |

- ADR：0118–0125 都寫完了（0124＝治7 回來了、0125＝她已經有一筆同名的資料健檢就不再建）
- `sw.js` 用到 **v162**；E2E spec 編號用到 51（這一段沒有開新檔，加在 03、09、22、30 裡）
- 資料健檢現在 **30 項**；`SYNC_FORMAT` **7**；合併檔 **`baobao-merge/v5`**
- **PR #138**（基底 `develop`）2026-10-06 凌晨開的，CI 綠（單元、Rules、煙霧 E2E）。`/matt-code-review` 跑過、修正在 `6e60bfd`（見最下面）。
  **她 2026-10-06 說合**（「好幫我合進develop，我已經重貼 staging 那一份 .gs了」）—— 合了沒有看 `git log origin/develop`

## 合 PR 之前／之後要有人做的

| 誰 | 什麼 | 不做會怎樣 |
|---|---|---|
| 她或我（要擁有者帳號，本機） | **Function 重新部署**，staging、正式各一次：`npm --prefix functions ci` → `npx firebase deploy --only functions --project staging`（`docs/STAGING.md` 三之三「部署那一支 Function」） | 抄不到「合併扣課」那一欄，照「沒有那一欄」那一條認（同一位治療師、接得上、兩台擇一池、同一筆 60 分的才合） |
| 她 | **重貼 `.gs` 並重新部署**，staging 與正式各自接的那一份試算表（`sheets/README.md`「升版之後」）。**staging 那一份她 10/6 貼了；正式那一份等上 `main` 那天** | 那一份試算表整包拒收、停止更新；設定 → 試算表報表那一張卡會講 |
| 她 | 合進去之後：**設定 → 資料健檢**，把「課程主檔少了一門」「營養點滴品項少了幾款」「診間清單…」「課程的時長…」「主檔有幾格還沒跟上」按掉 | 拍 Abovee 認不得 `高能量60`、`雪顏亮采`，`EECP20` 認成正式課；功醫門診、治7 選不到 |
| 她 | 設定 → 治療師與醫師：加 Abovee 上有、app 沒有的那幾位，勾醫師的科別 | 拍 Abovee 那幾列的治療師要自己選（選一次就記住） |

## 她 2026-10-06 回的（那五題都結了）

1. **Abovee 上只做過功醫門診的那 9 位**：「聽你的建議」—— **不補過去的**。之後他們再來，新增客戶就記得進去。細節在 `issues/13` 最下面
2. **另外兩個找人的框**：「好」—— 換了（`ecc910e`，`issues/17` 最下面）
3. **羊膜**：「先預設和營養針一樣，然後是預設選復建科醫師」—— 系統與寫紀錄跟營養點滴一樣：只壓 Abovee、不寫紀錄（`d80e692`，`issues/12` 最下面）。
   **我讀成只回那兩格**：診間（不選）、時長（30 分）沒有照抄營養點滴。讀錯的話她在 設定 → 課程 改得動，或再說一聲
4. **EECP體驗 20 分、體驗課也可以排治7**：「對」
5. 第二個 session 定的那兩條（還沒選治療師／診間的不排進「要你看」；不算次數的課有額度照舊扣）：跟她講過了，她沒有反對

## 還沒有人做的

- **Function 重新部署**（staging、正式各一次）—— 上面那張表第一列
- 她還沒在 staging 上按那五塊資料健檢、還沒加治療師與醫師

## 一定要記得的

- **只跑單元測試＋相關的 E2E**，不要全跑 E2E（她的電腦會過熱關機）。新增檔案或 spec 記得登記進 `tests-e2e/related.js`；
  跑之前先 `node scripts/e2e.mjs --related --base HEAD --dry` 看會跑幾支
- **邊改邊跑 E2E 的作法（這一段用的）**：commit 之後開一個暫存 worktree（`git worktree add --detach <scratchpad>/e2e-wt <commit>`，
  `node_modules` 與 `functions/node_modules` 用 PowerShell 的 Junction 指回本體），從那裡起模擬器、跑 `--related --base <上一支的 commit>`；
  本體照改不影響它。換下一個 commit 就 `git -C <wt> checkout --detach <新的>`。**收的時候先 `cmd /c rmdir` 那兩個 junction，再 `git worktree remove --force`**
- **`npm test` 要在新檔案 `git add` 之後再跑一次**：真名掃描只掃被追蹤的檔案 —— 12 那一個 commit 就是這樣紅的
  （測試檔頭引用她的原話「先預設30分鐘」，commit 之後才被掃到）
- **改了種子要另外想一次**：哪幾支 E2E 寫死了筆數（47、16、17）、`merge.mjs` 的 `ivProductOf()` 會不會誤認、資料健檢要不要多一列
  （`CLAUDE.md` 連動表「`domain/seed.js`」那一列）
- **只改註解也會被 `--related` 挑到**：14 那一支挑了 42 支，其中 9 支只因為五個檔案改了註解。比對過去掉註解後一字不差才不跑
- **E2E 偶爾紅在 gstatic CDN**（`net::ERR_CONNECTION_RESET`／`ERR_SOCKET_NOT_CONNECTED`、等不到 `[data-signin]`）：那是網路，單獨重跑那一支
- 真名：commit 之前跑一次 `node .local/references/staff-scan.mjs`；`tests/no-secrets.test.js` 要 0 skipped
- Bash 工具會吃掉一個反斜線：有 `\n`、`\s` 的替換用 Write 寫成 `.mjs` 再跑，或用 Edit（這一段有一行 regex 被吃成真的換行）
- **模擬器的 Function 不會自己重載**：改了 `functions/` 要停掉模擬器重開
- 她說「有問題一樣問」：照 issue 做不下去、或要推翻 issue 裡寫的決定時問她，一次問完、附建議

## PR #138 的審查（2026-10-06，`/matt-code-review`，兩個 sub-agent 各看一軸）

修了的（`6e60bfd`）：

- **bug（15）**：舊資料那一句還在整筆身上（`visit.note`）、同一天有一段有額度又有一段沒有額度時，那一句印兩次
  （額度那一格一次、來訪紀錄一次）。`sheetReport.js` 多一支 `logNote()`：整天沒有「算數而且有額度」的段才退回整筆那一句
- **文件**：還有十來處寫著「EECP 只能治5、治8」（CONTEXT、SPEC 四處、操作手冊、邊界測試清單 C11-5、設定頁那一格的提示、幾段註解）；
  SPEC 第 12 節的 `slotMinutes()` 順序少一層；`merge.mjs` 註解裡體驗課還寫 30 分
- 資料健檢「主檔有幾格還沒跟上」的確認框：EECP 那一列連「常用診間」一起寫的時候，那一句照實講（`fix.why`）
- `merge.mjs` 自己比了一次 `uncounted` → 改走 `isUncounted()`
- ADR-0124 裝了兩個決定 → `sameNamed()` 那一條分出去成 **ADR-0125**

審查提了、沒有動的（判斷題，留給之後）：

- `checkSeedCourse()`／`checkSeedIvProduct()`／`checkSeedEquipment()` 三支長得很像，可以收成一支 —— 三支的護欄、文案、id 的鍵名都不一樣，
  收起來要五個參數；等第四種出現再收
- `checkSeedBlanks()` 裡 EECP 那一段其實是「還停在舊值」不是「空格」，名字不夠貼 —— 檢查的 id（`seedBlanks`）已經在畫面與測試上，
  畫面上的字是「主檔有幾格還沒跟上」，兩種都講得通
- `merge.mjs` 的 `startOf()` 直接比 `'功醫門診'` 這個字 —— 那一支的簡寫表本來就是用課程名字當鍵

審查標成「超出 issue」、issue 檔裡都寫了的：`sameNamed()` 也套在既有的診間與課程那兩列、EECP 的常用診間跟著補、
行事曆的「功醫」也認（issue 只寫 HRV；她行事曆上真的有三句這樣寫）、`ivProductOf()` 的三個字門檻、CONTEXT 兩條本來就壞的
