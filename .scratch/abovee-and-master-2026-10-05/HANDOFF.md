# 交接：這一輪做到哪、下一個 session 從哪裡接

（每一個接手的 session 做完一段就回來改這一份。）

## 現況（2026-10-05 深夜，第一個實作 session 做完）

- **01 做完、合了**：PR #137 → `develop`（`434a380`），staging 部署成功；staging 已清空、**她 10/5 晚貼了合併檔**
  （客戶 29、額度 159、來訪 135、時段 204 全部已完成；資料健檢 35 項）。**在 staging 上測拍 Abovee 用得到這些真客戶**；
  測試時截圖、清單、PR 一個真名都不帶
- **02–06 做完**，都在 `claude/abovee-master-2026-10-05` 上、已推（一支一個 commit，每一支的「做完時留下的」在它的 issue 檔最下面）：

  | 支 | commit | 留給後面的 |
  |---|---|---|
  | 02 分類 | `a7ea74b` | `GROUP_DEFAULTS` 在 `masterData.js`（12 補新課程時照它）；一組裡的順序是文件 id |
  | 03 系統 | `5c88696` | `systemsOf()`／`bookingSystemOf()`／`tasksForCourse()`；**不可以再比 `course.category`**（有測試掃） |
  | 04 醫師 | `0d892ac` | `doctorChoicesFor()` 三個入口共用；**拍 Abovee 那一排只排序、沒收合、不套 `preselect`**（08 決定） |
  | 05 不算次數 | `e6bdc55` | 新檔 `domain/slotOptions.js` 的 `slotOptionsFor()`；**08 用 `{ includeUsedUp: true }` 取代 `entitlementChoices()`**；`slotFromPicks({ uncountedCourseId })` |
  | 06 約時選時長 | `9d7228c` | `slotFromPicks({ minutes })`、`slotMinutesField()`；**08 把照片上「二返60」的 60 交給它** |

- 另有一個獨立的小 commit `4e269be`：真名掃描把這一輪 `.scratch` 裡的「三返60」「任選60」當成疑似姓名，補進白名單（這一支分支上 `npm test` 本來是紅的）
- **07–15 都還沒動**。`develop` 沒動過（還是 `434a380`），不用 rebase
- **合 PR 的規矩**（她 2026-10-05：「好給你合」）：這一輪的 PR，CI 綠、審查做完、她沒說要先看的，由 session 自己合進 `develop`，合完確認 staging 部署成功。**不碰 `main`**

## 下一個 session 做什麼

照順序一支一個 commit（kickoff skill 第三段）：

```
07 辨識 → 08 換人與要做什麼 → 09 合併扣課 → 10 時間不同 → 11 改成 Abovee 的   ← 第二個 session（拍 Abovee），從 07 開始
12 主檔補齊 → 13 合併檔的功醫門診 → 15 試算表的記一句 → 14 文件總對   ← 第三個 session，做完開 PR、跑 /matt-code-review
```

每一支動工前：讀那一支 issue（含「審查之後補的」）＋它的「動工前先讀」＋**02–06 各支最下面的「做完時留下的」**
（07–11 會用到的接口都寫在那裡）。紅燈 → 綠 → 驗 → commit → `Status: done` ＋「做完時留下的」。

## 等她回的（第一個 session 查到的，都不擋 07）

1. **取消掉的段還在被提醒**：`validateVisit()` 的 warnings（還沒選醫師／診間／治療師）不跳過取消的段。改期之後舊那一段已經取消，
   第一道確認還是跳「第 1 個時段：二返 還沒選醫師」。建議：提醒只看還算數的段（`isLiveSlot()`），一行的事；要動的話補一支測試
2. **設定 → 課程 一組裡面的順序**是文件 id（醫師門診那一組：心臟科評估、二返、復健科醫師門診），不是她列的順序。
   要她能自己排得多一格順序；建議先不做，等她嫌再說
3. **既有的二返在日曆上會多出 `(30)`**（`二返(30)`、`三返(30)`），因為二返現在有兩種長度了（ADR-0122，跟 `SIS(30)` 同一個理由）。
   她不喜歡的話可以改成「只有不是預設長度才寫」，那是 `naming.js` 的 `withMinutes()` 一處

## 一定要記得的

- **只跑單元測試＋相關的 E2E**，不要全跑 E2E（她的電腦會過熱關機）。`seed.js` 與這一段的新檔都登記進 `tests-e2e/related.js` 了（02 做的）；新增檔案或 spec 記得登記，不然 `--related` 會退回全跑 —— 跑之前先 `node scripts/e2e.mjs --related --base HEAD --dry` 看會跑幾支
- `sw.js` VERSION：develop 是 v144（#137），這一支 02–06 用到 **v149**，**07 從 v150 起**
- **E2E 的實際成本**（這台機器、無頭、1 worker）：動到 `visits.js`／`schedule.js`／`visitEditor.js`／`taskRules.js` 任何一支，
  `--related` 就是 28–35 支、**17–22 分鐘**。跑的時候不能改 `public/`（hosting 即時從磁碟供檔）—— 這一段的作法是
  「跑的那二十分鐘寫下一支的測試與修改腳本（放 scratchpad，不放進 `tests/`、`public/`），跑完 commit 再套」。
  `--related` 的基底用 `--base HEAD`（只看這一支還沒 commit 的改動）；本機的 `develop` 已經 fast-forward 到 `434a380`
- **E2E 偶爾紅在 gstatic CDN**（`net::ERR_CONNECTION_RESET`、等不到 `[data-signin]`／`.app__nav`）：那是網路，不是程式 ——
  單獨重跑那一支。這一段碰到三次，三次重跑都過
- 新 spec 的編號用到 50（47 分類與系統、48 醫師、49 不算次數、50 時長），**07 從 51 起**；每一支都要登記進 `tests-e2e/related.js`
- 真名：Abovee 上治療師與醫師的全名不進 repo。commit 之前跑一次 `node .local/references/staff-scan.mjs`（在分支的目錄裡跑；拿 `.local/references/圖片辨識參考/服務資源.md` 的名單掃這一支相對 `origin/develop` 改了的檔案與 commit 訊息，只印檔名行號不印名字）；`tests/no-secrets.test.js` 要 0 skipped（主目錄有 `.local/`；worktree 裡要接一個 `.local` 的 junction，`git check-ignore -v` 確認被擋）
- Bash 工具會吃掉一個反斜線：Python heredoc 裡有 `\n`、續行 `\` 的，改用 Write 寫檔再跑，或用 Edit
- ADR 號：0118–0122 已用（#137、03、04、05、06）；**0123 拍 Abovee（08–11）、0124 治7（12）**
- 她說「有問題一樣問」：照 issue 做不下去、或要推翻 issue 裡寫的決定時問她，一次問完、附建議
