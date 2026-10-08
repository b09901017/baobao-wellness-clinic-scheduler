# 交接檔：2026-10-08 上線前修正

先讀 `CLAUDE.md` → `docs/agents/lessons.md` → 這一份 → `spec.md` → 要做的那一支 issue。
每一支 issue 的「審查之後」那一段會改掉前面「要做的」的部分作法，**以後寫的為準**；做了什麼寫在每一支的「做完時留下的」。

## 現況

| 段 | issue | 狀態 |
|---|---|---|
| 零 | spec、23 支 issue、subagent 過目 | done（10/8） |
| 一、匯入頁／隱私／部署／畫面小修／排序 | 01–08 | done（10/8，8 個 commit：`c83ffb2`…`4d44af0`） |
| 二、拍照 | 09–14 | todo |
| 三、規則、待辦、試算表 | 15–18 | todo |
| 四、人員簡寫、合併檔 v6、種子 | 19–21 | todo |
| 五、AI 小實驗、文件、收尾、開 PR | 22–23 | todo |
| 六、`/matt-code-review` 與照審查修正 | — | todo |

- 分支：`claude/prelaunch-fixes-2026-10-08`（**只在本機，還沒推**；段五才推、才開 PR）。基底 `origin/develop` `a84820d`。
- 一支 PR 進 `develop`。六段都在**同一個分支、同一個工作目錄、一段接一段**做 —— 不開 worktree、不平行（共用檔案多，她的筆電也不能同時跑兩組模擬器）。
- 編號：ADR 從 0137、E2E spec 從 61（一段一支新 spec）、`sw.js` `v186`（一支 PR 只升一號）、合併檔 v6。
  **用掉的**：ADR-0137（08）、spec `61`（段一）、`sw.js` 已經是 `v186`（01 升的，之後不再升）。**下一個**：ADR-0138、spec `62`。

## 每一段怎麼做（每一段的 session 都一樣）

1. `git fetch origin`。`origin/develop` 有新東西就 rebase（幾個 commit 的 rebase，不要重做）。
2. 一支一支來，**照編號**（`Blocked by` 標著的順序）。每一支：
   重現腳本跑一次確認還是錯的 → 改寫成 `tests/` 的失敗測試（**不帶真資料、真名**：客戶寫客戶A／王小明，人員寫「某」）→ 確認真的紅 → 修到綠 →
   `npm run verify`（E2E 只跑相關的那一支 spec：`node scripts/e2e.mjs <編號>`）→ 一支一個 commit → `Status: done` ＋ 補「做完時留下的」。
3. 這一段做完：更新這一份的現況表與下面「每一段留下的」；最後回她一段**給下一個 session 的開場**（下面有範本，把實際狀況填進去）。
4. 動到 domain 規則的那幾支（08、09–11、15、16、19、20）做完一支，「下一支需要知道的」先寫進那一支的「做完時留下的」，不要留在腦子裡。

不要做：段五以前不推、不開 PR；任何時候都不部署（staging 的 Function 也先問她）、不連正式站、人員全名不進 repo。

## 從上一輪帶過來、還成立的坑

（`.scratch/verified-bugs-2026-10-07/HANDOFF.md`「這一輪學到」那一段的原文在那裡，這裡只列用得到的。）

- E2E 一次只跑自己那一支 spec；`--related` 一跑二三十支，她的電腦會燙。`-g` 裡不要放 `|`（Windows 走 cmd）。全量丟 CI。
- 模擬器的 hosting 服務的是**啟動它的那個目錄**的 `public/`，跑完不會自己關：開跑前依 port 確認是從這個目錄起的。
- 改檔一律用 Edit 或 python（`newline=''`）；PowerShell 5.1 的 `Get-Content`／`Set-Content` 會把 UTF-8 中文讀壞。有反斜線的 python 不要放進 bash heredoc。
- 本機 `tests/slot-note.test.js` 可能因為 CRLF 假紅 —— 不是 develop 壞了，不要改那一支。
- 新的測試檔要 `git add` 之後再跑一次 `npm test`（真名掃描只掃被追蹤的檔案）。
- **有反斜線或樣板字串的改檔腳本不要放進 bash heredoc**（段一又踩了三次：`unexpected EOF`、正規表示式少一條反斜線）：
  用 Write 把 python 腳本寫到 scratchpad 再跑；路徑裡的反斜線用 `chr(92)`。
- 模擬器**在 Windows 上不回 `firebase.json` 的 `headers`**（`glob-slasher` 把規則的斜線換掉）：她的機器上 `curl -sI 127.0.0.1:5000/…` 看不到 Cache-Control 是正常的。
- E2E 一輪的**第一支偶爾在登入那一步逾時**（`waitForSelector('[data-signin]')` 30 秒 ＋「console 留下 3 筆錯誤」）。段一遇到三次，
  都是上一輪剛跑完（或剛失敗）馬上再跑；原樣重跑就過，沒有一次是程式的問題。遇到先重跑一次，不要先懷疑自己剛改的那一行。
- 跑完 E2E **把模擬器關掉**（依 port：5000、8080、9099、9199、5001、4400、4000）—— 它不會自己關，她的筆電會一直轉。
- `.local/` 的重現腳本有的會讀真資料：只印數字的才可以把輸出貼進對話、issue、commit。

## 每一段留下的

（做完一段就在這裡加三五行：做了哪幾支、哪一支偏離了 issue 寫的作法與理由、沒做的、下一段要知道的。）

### 段零（10/8）：開 issue、subagent 過目

- 18 張有腳本的重現腳本整批重跑過，全部還重現得出來。
- 一個 subagent 唯讀過目了 spec 與 23 支 issue（逐支打開程式碼對），主控把它最重的幾條再對了一次程式碼，都屬實，**已經改進 issue 本文**：
  - **重寫**：15（「報告會被靜默收掉」不成立，ADR-0068 早就擋住 —— 只改「長出來」那一側）、16（`listUnclosed()` 撈不到還沒到的那幾天；只寫任務、不存來訪；取消類不長）、
    11（`settledDayLine()` 是另一句；沒有合併扣課那一欄的照片；取消的列不認領舊段）
  - **改了事實或作法**：01（`catch` 那條路更重，重算放 `finally`）、04（`tests/env.test.js:108` 釘著相反的事；`concurrency` 放 workflow 那一層）、
    05（畫在 `visitReadHtml()` 回的那一塊最上面，不動五個 `openCard()` 的抬頭）、14（比每一張各自的 `orderDraftFrom()`；「拿掉一張」是新的一顆）、
    19（簡寫整份人員不可重複；`parse()` 白名單）、20（驗證要自己叫、一個 commit、五種認法、`SKILL.md:112-113` 要改）、22（解析度與分單子的思考程度現在都沒有旋鈕）
  - **補了判準或連動**：02、07、08、09、10、12、13、17、18、21
- 審查標「待查」、沒有實跑過的三件（做到那一支時自己驗）：04 模擬器的 hosting 吃不吃 `firebase.json` 的 `headers`；
  10「兩張都有姓名、左右範圍不同」的拍法多常發生；13 右半從診間欄中間開始拍的鏡像情況。
- 審查沒做的：沒開模擬器、沒跑 E2E 與整套 `npm test`；ADR 只打開 0068 與 0104；21、23 只對了引用的檔案與行號，沒有逐格重查種子。

### 段一（10/8）：01–08

八支都做完，一支一個 commit，`npm test` 3929 條全綠（0 skipped）。E2E 只跑了自己那幾支：`61`（新，8 條過、H1 在 Windows 上跳過）、
`24`（F5、F6 是新的）、`09`、`27`、`04`、`00`、`03`。**沒有跑全量**，留給段五丟 CI。沒推、沒開 PR、沒部署。

做了什麼（細節在每一支的「做完時留下的」）：

- **01** 匯入頁 `run()` 進來先問 `running`（確認框開著也算）、`finally` 才放開、放開前重讀資料庫；`save-guards` 多一段掃這三個記號。
- **02** 雜事寫完就清勾、只剩雜事也重試得了；`importCaveats()`（對不到主檔幾處、同名跳過幾位）確認框與摘要卡共用；匯完的結果留在頁面上（`[data-import-result]`）。
- **03** `.gitignore` 擋 `排課系統備份-*.json`（任何一層）與 `*-sa.json`；真名掃描的名單搬到 `tests/helpers/realNames.js`、多讀病歷號名單與 Abovee 擷取檔（66 → 93 個名字，漏掉的 27 → 0）。
- **04** `firebase.json` 第一條 `**` 全部 no-cache、圖示蓋回一小時；`deploy.yml` workflow 那一層 `concurrency`；`.firebaserc` 預設改 staging。
- **05** `visitReadHtml()` 最上面畫警示；資料走 `fillMirror()`（日曆另外先給一份、客戶詳情直接傳）。
- **06** `.deck` 開著時 toast 站到抬頭中間名字那一段；拍訂購單的確認卡一起吃到。
- **07** `scheduling.js` 的 `presentQueue()`／`batchRows()`：畫的濾、存的不濾；「加這一段」存檔前問一次人還在不在。
- **08** `entitlements.js` 的 `inUse()`／`poolOrder()`，兩支排序共用；`leadPool()` 讓客戶之間的排名不跟著動。ADR-0137。

偏離 issue 寫的作法（理由都在那一支裡）：

- **04**：不是「一種一種副檔名改成 no-cache」，是「全部 no-cache、圖示例外」—— 反過來漏的下場只是圖示多一趟 304。
  「待查」的答案：模擬器吃 `headers`，但 Windows 上對不上任何一條，所以**本機驗不了**；改成 E2E `61` 的 H1（Windows 跳過、CI 量）。
- **05**：issue 要一支「給假客戶 → HTML 裡有那一顆」的單元測試 —— `calendar.js` 進不了 node（一路 import 到 `https://`），改成掃原始碼＋E2E 四個畫面。
  待辦中心兩個入口與進度追蹤上，那一排是跟「這一項的待辦」同一次重畫才出現（底下往下移一排）；日曆與客戶詳情不會。
- **06**：不是面板那一條的「最上面靠左」（會蓋住「上一位」），是抬頭中間名字那一段。量法是問 toast 底下 `elementFromPoint()`，不是比外框。
- **02**：多做了「結果留在頁面上」那一張卡（issue 只寫「完成提示講出來」）—— 一句 3 秒的 toast 撐不起「那張清單匯完再也看不到」。
- **07**、**03**、**08**：舊的重現／量測腳本（`r01-known-issues.mjs` 7b、`r-nosecrets-gap.mjs`、`r01-pool-order.mjs`）都是**照抄舊邏輯**寫的，修完照樣印舊數字。
  各補了一支讀真的那一支函式的（`*-after.mjs`），或由單元測試取代。**之後幾段的重現腳本也要先看它是 import 還是照抄。**

沒做、留著（23 收尾時寫進「沒做、留著」或驗收清單）：

- 02：有人失敗 → **重新整理再貼一次**時雜事的預設勾選又回來，那一趟會多寫一份雜事（只擋了「檔案還在畫面上重按」）。
- 05：日曆日／週那一列（`visitRow()`）沒有警示（issue 寫明不做）。
- 08：客戶清單點了課程丸之後取「同名的第一筆」—— 同名兩筆時取到的那一筆變了（從剩得少的變成有在用的）。
- 04：`r-deploy-race.mjs` 沒重跑（要合進 develop 之後才看得出差別）。
- `CLAUDE.md` 連動表：08 的那一列已經改了；**01、05、06、07 各欠一句，都留給 23**（每一支的「留給 23」寫了要補什麼）。
- 驗收清單（23 寫）要有的幾條：staging 部署完 `curl -sI …/js/app.js` 與 `/` 是 `no-cache`；連推兩次 develop 第二次是排隊；CI 全量時 `61` 的 H1 是綠的而且不是 skipped。

段二（09–14）要知道的：

- 08 做完之後 `customerPools()` 回的每一筆 `pool` 都可以直接丟給 `inUse()`／`poolOrder()`。09 如果要「優先扣正在用的那一筆」，問這兩支。
- 匯入頁與拍 Abovee 沒有共用的程式；段一沒有動 `aboveeImport.js`、`aboveeConfirm.js`、`orderForm.js`、`orderConfirm.js`（06 的 CSS 規則會套到 `orderConfirm` 的那一疊，沒改它的 JS）。
- 14 的確認卡是 `.deck`：存完的 toast 現在站在抬頭上，E2E 要點「復原／重試」的話位置變了（選擇器沒變）。

## 給新 session 的開場（範本）

每一段結束時把下面對應那一段貼給她。**建議的 effort 只是建議**，她自己決定。

### 段一（01–08）—— effort：medium

```
/kickoff 上線前修正：第三段實作，做 01–08

這一輪的第一、二段（回答、開 issue、subagent 過目）已經做完，不用重來，也不用停下來問我 —— 我選了「全部一次做完，不用先問我」。

先讀：CLAUDE.md → docs/agents/lessons.md → .scratch/prelaunch-fixes-2026-10-08/HANDOFF.md → spec.md → issues/01～08。
分支 claude/prelaunch-fixes-2026-10-08（只在本機，還沒推）。照 HANDOFF.md「每一段怎麼做」一支一支做 01–08，一支一個 commit。
不推、不開 PR、不部署、不連正式站。E2E 只跑相關的那一支 spec（我的筆電會過熱）。
做完更新 HANDOFF.md，最後給我一段給下一個 session（段二：09–14）的開場。
```

### 段二（09–14）—— effort：high

```
/kickoff 上線前修正：第三段實作，做 09–14（拍 Abovee 與拍訂購單）

第一、二段與 01–08 已經做完（8 個 commit，最後一個 4d44af0），不用重來，也不用停下來問我。

先讀：CLAUDE.md → docs/agents/lessons.md（第二、四、五節）→ .scratch/prelaunch-fixes-2026-10-08/HANDOFF.md（「從上一輪帶過來、還成立的坑」與「段一」那兩段）→ spec.md → issues/09～14。
分支 claude/prelaunch-fixes-2026-10-08（只在本機）。09→10→11→12→13 動同一支 aboveeImport.js，照編號做；每一支做完把下一支要知道的寫進「做完時留下的」。
編號：ADR 從 0138 起（12 會補一支）、新的 E2E spec 是 62（這一段共用一支）、sw.js 已經是 v186 不要再升。
重現腳本先看它是 import 真的那一支還是照抄舊邏輯 —— 照抄的修完照樣印舊數字，要另外補一支。
13 會改 Abovee 的提示詞：這一段不重考（那會花我的錢，併在 22）、也不部署 Function。
不推、不開 PR、不部署、不連正式站。E2E 只跑相關的那一支 spec，跑完把模擬器關掉。
做完更新 HANDOFF.md，最後給我一段給下一個 session（段三：15–18）的開場。
```

### 段三（15–18）—— effort：xhigh（15、16 動規則）

```
/kickoff 上線前修正：第三段實作，做 15–18（報告那兩張待辦、改課程重算待辦、試算表兩件）

第一、二段與 01–14 已經做完，不用重來，也不用停下來問我。

先讀：CLAUDE.md → docs/agents/lessons.md（第三、五、六節）→ .scratch/prelaunch-fixes-2026-10-08/HANDOFF.md → spec.md → issues/15～18，以及 15、16 列的每一支 ADR。
分支 claude/prelaunch-fixes-2026-10-08（只在本機）。15 與 16 各補一支新的 ADR，舊的一個字都不改。
15 有一條判準要拿我的合併檔量「改之前與改之後報告鏈的待辦各幾張」：腳本放 .local/、只印數字。
不推、不開 PR、不部署、不連正式站。E2E 只跑相關的那一支 spec。
做完更新 HANDOFF.md，最後給我一段給下一個 session（段四：19–21）的開場，並提醒我：段四開始前要先從 staging 的設定頁匯出一份備份放到 .local/references/（21 要拿它跟種子比）。
```

### 段四（19–21）—— effort：high

```
/kickoff 上線前修正：第三段實作，做 19–21（人員簡寫、合併檔 v6 帶全名、種子）

第一、二段與 01–18 已經做完，不用重來，也不用停下來問我。

先讀：CLAUDE.md → docs/agents/lessons.md（第六、八節）→ .scratch/prelaunch-fixes-2026-10-08/HANDOFF.md → spec.md「決定 1」「決定 3」→ issues/19～21。
分支 claude/prelaunch-fixes-2026-10-08（只在本機）。人員全名一個字都不進 repo：測試寫「王某」「某小芳」；名單只放 .local/references/staff-names.json，建完跑 git check-ignore。
staging 的備份我放在 .local/references/（檔名：＿＿＿；沒放的話 21 第三部分先跳過、寫進交接）。
要給我看的兩個「只看不寫」做到就停下來給我看：20 的匯入頁摘要卡（本機模擬器，截圖放 .local/）、21 第三部分要寫回種子的清單。我點頭之前不在 staging 貼、不寫回種子。
另外要問我的只有一件：種子上用了異體字的那一位治療師，簡寫要用哪一個寫法（issue 21 第四部分）。其餘不用問我。
不推、不開 PR、不部署、不連正式站。E2E 只跑相關的那一支 spec。做完跑一次 node .local/references/staff-scan.mjs。
做完更新 HANDOFF.md，最後給我一段給下一個 session（段五：22–23）的開場。
```

### 段五（22–23）—— effort：medium

```
/kickoff 上線前修正：收尾，做 22（AI 小實驗）與 23（文件、CLAUDE.md、開 PR、驗收清單）

01–21 已經做完。

先讀：CLAUDE.md → docs/agents/lessons.md → .scratch/prelaunch-fixes-2026-10-08/HANDOFF.md → issues/22、23，以及每一支 issue 的「做完時留下的」。
22：先算出實際要考幾張次、大概多少錢，告訴我，我說可以才跑。我沒回之前先做 23。
23：照它列的順序收尾，推分支、開 PR 進 develop（內文一個真名都不帶）、全量 E2E 丟 CI。驗收清單每一條都要在本機模擬器走過。
staging 的 Function 要不要部署先問我；不連正式站。
做完更新 HANDOFF.md，最後給我一段給下一個 session（段六：/matt-code-review）的開場。
```

### 段六（審查）—— effort：xhigh

```
/matt-code-review origin/develop

審 claude/prelaunch-fixes-2026-10-08 這支 PR（上線前修正，23 支 issue）。
規格在 .scratch/prelaunch-fixes-2026-10-08/spec.md 與 issues/；每一支的「判準」就是要對照的東西。標準在 CLAUDE.md 與 docs/agents/lessons.md。
審完照建議修（一類一個 commit），不同意的寫進 HANDOFF.md「審查提過、沒有改的」並附理由。
E2E 只跑相關的那一支 spec；全量丟 CI。不部署、不連正式站。
最後給我：改了什麼、沒改什麼與理由、驗收清單有沒有因此要改。
```
