# 交接：這一輪做到哪、下一個 session 從哪裡接

（每一個接手的 session 做完一段就回來改這一份。）

## 現況（2026-10-05 深夜，第二個實作 session 做完）

- **01 做完、合了**：PR #137 → `develop`（`434a380`），staging 部署成功；staging 已清空、**她 10/5 晚貼了合併檔**
  （客戶 29、額度 159、來訪 135、時段 204 全部已完成；資料健檢 35 項）。**在 staging 上測拍 Abovee 用得到這些真客戶**；
  測試時截圖、清單、PR 一個真名都不帶
- **02–11 與 16 做完**，都在 `claude/abovee-master-2026-10-05` 上、已推（一支一個 commit，每一支的「做完時留下的」在它的 issue 檔最下面）：

  | 支 | commit | 留給後面的 |
  |---|---|---|
  | 02 分類 | `a7ea74b` | `GROUP_DEFAULTS` 在 `masterData.js`（12 補新課程時照它）；一組裡的順序是文件 id |
  | 03 系統 | `5c88696` | `systemsOf()`／`bookingSystemOf()`／`tasksForCourse()`；**不可以再比 `course.category`**（有測試掃） |
  | 04 醫師 | `0d892ac` | `doctorChoicesFor()` 三個入口共用；拍 Abovee 那一排不套 `preselect` |
  | 05 不算次數 | `e6bdc55` | `slotOptionsFor()`；`slotFromPicks({ uncountedCourseId })` |
  | 06 約時選時長 | `9d7228c` | `slotFromPicks({ minutes })`、`slotMinutesField()` |
  | 07 Abovee 寫法 | `317d729` | **五種主檔都有 `aboveeNames`**；`courseFrom()` 新順序、`staffRoleFor()`；**12 的資料健檢要補既有資料庫那幾格**（staging 現在沒有 → `高能量60`、`雪顏亮采` 認不得、`EECP20` 會認成正式課） |
  | 08 確認層 | `2737b2f` | `searchCustomers()`、`pickOption()`／`optionValueOf()`；`slotFromPicks()` 卡在後面那幾道照樣交回 `course` |
  | 16 提醒只講算數的段 | `e9d4674` | 她答「修!」的那一題；七支 warnings 一起 |
  | 09 合併扣課 | `58eb440` | 抄字第十欄、`mergeRows()`；**Function 要重新部署**（見下面「PR 裡要寫的」） |
  | 10 時間不同 | `494146c`、`40e2a01` | `flagMoved()` |
  | 11 改成 Abovee 的 | `43e408c` | `aboveeDiffs()`／`adoptAbovee()`；CLAUDE.md 兩列補了 |

- ADR-0123 寫完了（08–11 四段都在）；ADR-0100 補了 10/5 的重考
- `develop` 沒動過（還是 `434a380`），不用 rebase
- **合 PR 的規矩**（她 2026-10-05：「好給你合」）：這一輪的 PR，CI 綠、審查做完、她沒說要先看的，由 session 自己合進 `develop`，合完確認 staging 部署成功。**不碰 `main`**

## 下一個 session 做什麼（第三個）

```
12 主檔補齊 → 13 合併檔的功醫門診 → 15 試算表的記一句 → 14 文件總對   ← 做完開 PR（基底 develop）、跑 /matt-code-review
```

每一支動工前：讀那一支 issue（含「審查之後補的」）＋它的「動工前先讀」＋**02–11 各支最下面的「做完時留下的」**。
紅燈 → 綠 → 驗 → commit → `Status: done` ＋「做完時留下的」。

- **12 要多補的**（07 留下的）：資料健檢的「空格補上」要包含課程／器材／品項的 `aboveeNames`（種子預填的那幾個非人名寫法）；
  功醫門診、羊膜的種子課程帶 `aboveeNames`（形狀照 `tests-e2e/specs/51-abovee-picks.spec.js` 的 `FM`）
- **14**：issue 檔最下面「第二個 session 留的」—— CLAUDE.md 那三列已經改了，只對一遍；SPEC／CONTEXT／操作手冊還沒寫 08–11、16

### PR 裡要寫的（她要做的／我要做的）

- **Function 重新部署**（09 的抄字第十欄）：staging、正式各一次（`docs/STAGING.md` 第三之三節，手動）。沒部署之前抄不到「合併扣課」那一欄，
  照「沒有那一欄」那一條認（同一位治療師、接得上、兩台擇一池、同一筆 60 分的才合）
- 手動驗收清單（staging 上點；**會寫入的那幾步在本機模擬器走**）：
  1. 設定 → 課程 → EECP體驗 → 編輯：「Abovee 上的寫法」那一格（staging 上是空的 —— 12 的資料健檢按下去之前自己打 `EECP20`）
  2. 設定 → 診間 → 編輯一間 → 「Abovee 上的寫法」填一個、存；另一間填同一個 → 存不下去、講是誰的
  3. 壓表 → 選月份 → 右下角相機 → 拍 Abovee 列表 → 確認層：點一列 → 「是誰」旁邊「換一位」→ 打兩個字 → 選
  4. 點一列課程認不出來的 → 「要做什麼」那一排選一顆（二返在最後）→ 器材 → 治療師 → 勾起來 → 記錄
  5. 三返那一列：「＋ n返」按好、「第幾返」三返、「排多久」照照片、「接哪一次健檢」自己選
  6. Abovee 上搬了時間的那一列：在「要你看」、沒打勾、有「去日曆 M/D 改期」
  7. 已經記了、診間或治療師不一樣的那一列：「app 是 A、Abovee 是 B」→「改成 Abovee 的」→ 記錄 → 日曆那一段只換了那一格
  8. （Function 部署之後）兩列勾了合併扣課 → 一列「合併扣課 IN 30＋SIS 30 → 記成一段 60 分、扣一次」→ 記錄 → 日曆一格 60 分、記一句寫好；「拆開成兩段」變回兩列

## 等她回的（第二個 session 查到的）

1. **日曆新增「要幫誰排？」與批次取消的找人**還是 `String(name).includes(q)`（不認空白、全形半形）。拍 Abovee 與療程單已經改用 `searchCustomers()`。
   建議：兩處一起換（一行一處，E2E 22 與日曆那幾支會跑）
2. **（我定了，跟她講一聲）** 11：app 上還沒選治療師／診間的那幾列，照樣寫出「app 上還沒選、Abovee 是 X」、按得下去，**但不排進要你看** ——
   合併檔匯進來的來訪都沒有治療師與診間，全排進去會把真的不一樣淹掉
3. **（我定了，跟她講一聲）** 不算次數的課（之後她勾營養諮詢那種）：照片上那一列，客戶身上**還有那門課的額度就照舊扣**、沒有剩才不扣（ADR-0121「有額度的照舊扣」）

她 10/5 晚已經回的三題（第一個 session 問的）：1 取消掉的段還在被提醒 → 修了（16）；2 設定 → 課程 一組裡的順序 → 先不做；
3 既有的二返在日曆上多出 `(30)` → 保留。

## 一定要記得的

- **只跑單元測試＋相關的 E2E**，不要全跑 E2E（她的電腦會過熱關機）。`seed.js` 與這一段的新檔都登記進 `tests-e2e/related.js` 了（02 做的）；新增檔案或 spec 記得登記，不然 `--related` 會退回全跑 —— 跑之前先 `node scripts/e2e.mjs --related --base HEAD --dry` 看會跑幾支
- `sw.js` VERSION：develop 是 v144（#137），這一支用到 **v155**（11 之後的補丁），**12 從 v156 起**
- **E2E 的實際成本**（這台機器、無頭、1 worker）：動到 `visits.js`／`schedule.js`／`visitEditor.js`／`taskRules.js` 任何一支，
  `--related` 就是 28–35 支、**17–22 分鐘**。跑的時候不能改 `public/`（hosting 即時從磁碟供檔）—— 這一段的作法是
  「跑的那二十分鐘寫下一支的測試與修改腳本（放 scratchpad，不放進 `tests/`、`public/`），跑完 commit 再套」。
  `--related` 的基底用 `--base HEAD`（只看這一支還沒 commit 的改動）；本機的 `develop` 已經 fast-forward 到 `434a380`
- **E2E 偶爾紅在 gstatic CDN**（`net::ERR_CONNECTION_RESET`、等不到 `[data-signin]`／`.app__nav`）：那是網路，不是程式 ——
  單獨重跑那一支。這一段碰到三次，三次重跑都過
- 新 spec 的編號用到 51（`51-abovee-picks`，N1–N5 是 07–11），**12 從 52 起**；每一支都要登記進 `tests-e2e/related.js`
- 真名：Abovee 上治療師與醫師的全名不進 repo。commit 之前跑一次 `node .local/references/staff-scan.mjs`（在分支的目錄裡跑；拿 `.local/references/圖片辨識參考/服務資源.md` 的名單掃這一支相對 `origin/develop` 改了的檔案與 commit 訊息，只印檔名行號不印名字）；`tests/no-secrets.test.js` 要 0 skipped（主目錄有 `.local/`；worktree 裡要接一個 `.local` 的 junction，`git check-ignore -v` 確認被擋）
- Bash 工具會吃掉一個反斜線：Python heredoc 裡有 `\n`、續行 `\` 的，改用 Write 寫檔再跑，或用 Edit。**Python 在 Windows 上寫檔會變 CRLF**：`open(…, newline='')` 讀寫
- ADR 號：0118–0123 已用（0123＝拍 Abovee 08–11）；**0124 治7（12）**
- 她說「有問題一樣問」：照 issue 做不下去、或要推翻 issue 裡寫的決定時問她，一次問完、附建議
- **模擬器的 Function 不會自己重載**：改了 `functions/` 底下（抄字格式、提示詞）要停掉模擬器重開，不然 E2E 測到的是舊的 Function
  （09 的 N3 第一次就是這樣紅的）。停的方法：依 port 找 `OwningProcess` 再 `Stop-Process`
- **這一段的 E2E 成本**：動到 `aboveeImport.js`／`consequences.js`／`customers.js` 是 29 支、14–20 分鐘；`visits.js` 也是 29 支、20 分鐘。
  同一段改兩支（16＋09、10＋11）就一起跑一次、分兩個 commit
