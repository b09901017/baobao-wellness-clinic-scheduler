# 試算表推送的縫：交接

分支 `claude/sheet-push-gaps`，在 worktree `.claude/worktrees/sheet-push-gaps-112028`（平行的一輪：主資料夾在做第一輪小修，
一次性客人在 `claude/one-time-visit-design` —— 都不碰）。小，不分段，這個 session 做完。

## 狀態

| issue | 狀態 |
|---|---|
| 01 推失敗自己再推、回到 app／網路回來／打開 app 補推 | done（PR #201，develop `2267a8bc`） |
| 02 平常推變快：先讀完再寫 | done（`claude/sheet-speed`，rebase 後 `c1a40e9b`） |
| 03 重畫變快：同一種動作收成一次 | done（`881a5935`） |
| 04 兩台同時推：比較舊的那一包不畫（ADR-0174） | done（`6c6ad420`；段二審查小修 `345bb52a`） |

常見問題「刪整列、還原版本 → 整份重畫」：PR #202，develop `3dd2ee12`。

## 第二輪（02～04）分段

分支 `claude/sheet-speed`（從 origin/develop `3dd2ee12`），同一個 worktree。

| 段 | 做 | effort | 狀態 |
|---|---|---|---|
| 段一 | 02 → 03 → 04 | high | 做完（11/5，`854bd266`） |
| 段二 | `/matt-code-review` 審 02～04、照建議修、開 PR、CI 綠合進 develop、寫她要照順序做的「貼 .gs 到 staging → 看執行紀錄比秒數」 | xhigh | 審查與小修做完、rebase 到 origin/develop（`f5fb7b0a`）；**推不上去**：改寫過的分支要強制推，被 auto mode 擋下，等主控／她決定（見「段二」） |

之後（不在這一輪的段裡）：她把新的 `.gs` 貼到 staging 的試算表、重新部署 → 比 Apps Script 執行紀錄改前改後的秒數 → 夠快就貼正式版；
不夠快再談「Google Sheets API 進階服務」（她說多按一個設定沒關係）。

### 段二（審查、小修、她要照順序做的）

**審查**（`/matt-code-review`，起點 `5050997e`，11/5）：
- Spec：沒有問題。審查的人另外把改前（`5050997e`）的 `.gs` 換進 `tests/sheet-gs-batch.test.js` 跑，雜湊跟釘住的一樣（雜湊確實是改前跑出來的）；
  又寫了一串測試沒涵蓋的五步推送（一開始就空著的同名分頁、第一列清掉但別格還有字、`onEdit` 拿掉指紋、整頁清空、分頁被刪、一位不在這一包、整份重畫），新舊兩份每一步整份一樣。
  比較新的那一包不會被當成舊的：只有嚴格比較小才擋；沒帶、看不懂、沒記過都照畫；`force` 只在真的比較舊時擋；畫到一半不記；`restore-backup` 不寫新的稽核、`--wipe` 是軟刪除（`listRecent` 連刪掉的一起讀），還原之後是「一樣」→ 照畫
- Standards：沒有違反文件規定。判斷題照建議修了三條（`345bb52a`）：`renderCustomer()` 拿掉只為一支測試留的「沒給 book 就自己讀」（測試包裝改成整串轉傳）、
  `emptyOf()` → `lastRowOf()`、`.gs` 的 `dataAtOf(body)` → `requestDataAt()`（跟 domain 那一支同名、吃的不一樣）；`sheets/README.md`「升版之後」補「這一次格式沒升也要重貼」。
  沒修的（判斷題、改了風險比好處大）：`entry` 物件四處各自組、`sheetPushTiming.js` 多了組請求的 `pushBody()`、測試與比對腳本各寫一份「推一串拍一張」、替身裡沒人用的 `setProperties`／`getRanges()`
- **`LAYOUT_VERSION` 留 2**（審查指出畫法沒變、規則是畫法變了才加）：留著的理由 —— 替身驗不到真的 Google（合併格的格式、`getRangeList` 的細節），
  萬一有一點不一樣，全部重畫一次比「有的頁是舊畫法、有的是新畫法」好認；而且重貼後第一次推送正好量得到整份重畫的秒數。代價是那一次慢一點
- 修完：`npm test` 5477 過、1 跳過（worktree 沒有 `.local/` 的那一條）；真名掃描用 junction 接主資料夾的 `.local` 跑，3 過 0 跳過；
  正式站那一包 `sheet-gs-compare.mjs` 四步 0 個不一樣、`sheet-gs-calls.mjs` 數字跟段一一樣（平常推 讀 76／寫 36／寫完又讀 0；整份重畫 讀 246／寫 1,498／寫完又讀 34）
- rebase 到 origin/develop `f5fb7b0a`：`docs/adr/README.md` 兩支 ADR 都留；`sw.js` 兩邊都是 v282 → **v283**、快照重跑

**卡住的**：rebase 之後分支要 `git push --force-with-lease` 才推得上去，auto mode 擋下（Git Destructive）。照她的規矩停下來沒繞。
選項：她允許強制推這一條分支（只有這一輪在用）；或改推到新分支 `claude/sheet-speed-2` 開 PR（舊的分支留著不動）。

**她要照順序做的**（PR 合進 develop、staging 自動部署之後）：
1. 打開 staging 那一份 Google 試算表 → 擴充功能 → Apps Script → 左邊「執行作業」：先記下最近幾次 `doPost` 的「持續時間」（改前的秒數；正式站 11/5 是平常推 25–48 秒、整份重畫約 192 秒）
2. 左邊「編輯器」→ 把 GitHub 上 develop 的 `sheets/readonly-report.gs` 整份貼上蓋掉 → 儲存
3. 部署 → 管理部署作業 → 鉛筆 → 版本選「新版本」→ 部署（網址不變，app 不用改）
4. staging 的 app（手機或 iPad）：最上面「有新版本・點一下更新」→ 點（新版 app 才會附上「這一包的時間」）
5. 設定 → 試算表報表 →「立刻推一次」：**這一次每一頁都會重畫**（正常，`LAYOUT_VERSION` 2）—— 回「執行作業」看秒數，這就是新的整份重畫
6. 在 app 改一筆會進試算表的東西（例如某位客戶的短備註），等十幾秒讓它自己推 → 「執行作業」最新那一次的秒數＝新的平常推
7. 設定 → 試算表報表 →「整份重畫」→ 再看一次秒數
8. 翻幾頁試算表，看起來跟以前一樣（名字、顏色、合併的格子、框線、凍結的列、鎖）
9. 夠快 → 正式那一份試算表照 2、3 再做一次（新的 `.gs` 跟還沒更新的 app 也合得來：沒帶時間照畫）；不夠快 → 再談 Sheets API 進階服務

**只在 staging 驗得到**（替身做不出來）：真的快多少；`getRangeList()` 一次帶幾十塊的實際表現；格式先下、之後才合併，Google 合併後是不是照左上角那一格的格式；
先寫值再合併不會跳確認；`getEditors()`／`canDomainEdit()` 擺在改名單之前的順序；真的兩台同時推；剛寫完那一則稽核 `at` 回 null 的頻率（null → 照畫不記，最壞跟以前一樣）。

**段末要問她**（主控來問）：「中途發現」1 —— 試算表每一頁的字現在全是 11 號（名字本來想 14 號、註記列本來想 9 號小灰字，都被最後那一行蓋掉）。
要不要讓名字變大、註記變小？建議：要（改 `finish()` 那一行、`LAYOUT_VERSION` 3，下一次推送每一頁重畫一次；可以等這一次的秒數量完再做）。

### 量的工具

`node scripts/sheet-gs-calls.mjs <整包.json>`：用測試的替身數一次推送讀幾次、寫幾次、寫完又馬上讀幾次（只印數字）。
正式站 11/5 那一包在主資料夾的 `.local/references/試算表健檢-2026-11-05/bundle-pushed.json`（在這個 worktree 裡是 `../../../.local/...`；**有真名，結果只印數字**）。
改前（develop `3dd2ee12`）：都沒變 讀 143／寫 46／寫完又讀 38；整份重畫 讀 619／寫 6,506／寫完又讀 276。
段一做完（`854bd266`）：都沒變 讀 76／寫 36／寫完又讀 **0**／文件屬性 35 → 1；整份重畫 讀 246／寫 **1,498**／寫完又讀 **34**（數法在 `tests/helpers/countGsCalls.js`）。

`node scripts/sheet-gs-compare.mjs <改前的.gs> <整包.json>`：兩份 `.gs` 跑同一串推送（第一次、都沒變、一頁變了、整份重畫），逐格比值、格式、合併、框線、欄寬、列高、凍結、鎖、指紋，只印數字。
改前那一份：`git show 3dd2ee12:sheets/readonly-report.gs > old.gs`。正式站那一包四步都 0 個不一樣。

## 規矩

- 不起模擬器、不跑 E2E、不停 port（主資料夾那一輪在用；她的筆電會熱）。單元測試可以；E2E 交給 PR 的 CI
- 動 `public/` 的 commit 升 `sw.js` 的 VERSION（從 v280 起）＋`npm run shell:snapshot`；開 PR 前 rebase 到 origin/develop，那一行留大的再加一
- 一次性客人那一輪 issue 04 改 `sheetReport.js` 的 `syncBundle()`／`customerReport()` 與 `ui/views/report.js`：這一輪不碰；非碰不可寫在這裡
- ADR 號碼用 0174（04 寫）
- `.gs` 不跑在 node 裡：唯一的驗法是 `tests/helpers/appsScriptStub.js` 的替身。替身做不出來的 Google 行為（真的快不快、合併的細節）只有貼到 staging 才知道 —— 交付時要講清楚哪些只在替身裡驗過

## 她已經決定的

- 11/5「照建議修」：①②③⑤＋④被拒那一半（spec.md）
- 11/5「照建議先觀察」：④ 另一半（兩台同時推，舊的那一份蓋掉新的）不修。真的遇到了，下一次推送會補上；要修的話等下次反正要重貼 `.gs` 時一起做（`.gs` 記每一包的新舊、舊的不畫）
- 11/5 下午「我不介意多按一個設定，或做其他重貼甚麼的不用顧慮，不過可以照建議開這一輪」→ ④ 改成一起修（04）；`.gs` 批次化（02、03）；Sheets API 進階服務量完再決定；`.gs` 不拆檔
- ⑥⑦⑧⑨⑩ 不修，記在 `FINDINGS.md`

## 要她決定的

- 試算表的字級（「中途發現」1）—— 段二末，主控問
- 段二的分支怎麼推上去（強制推被擋）—— 見「段二」

## 過目抓到的

subagent 過目 01（11/5），主控對過後改了：
- 打開 app 時離線（`confirmed()` 在連不上時也會叫）→ 開機那一次一定讀到快取、留一句「上次沒推」而她什麼都沒寫 → 改成離線時等 `online` 再推
- `app.js` 那一行註解說確認之前「沒有寫入要推」，跟 ③ 相反 → 改註解
- 重試要掛在每一趟跑完（設定頁「立刻推一次」失敗也要排），`setTimeout` 問不出還剩多久 → 記 `dueAt`、一個計時器
- E2E `78` S1／S2、`45` P1 會被開機那一次推干擾 → 先等它推完再數
- `tests/sheet-fingerprint.test.js` 掃 `push()` 的兩行與 `buildBundle()`：保留原樣

## 中途發現

### 第二輪過目時（段二末一起問她）

1. **試算表每一頁的字其實全是 11 號**：`.gs` 的 `finish()` 最後整頁 `setFontSize(11)`，把名字那一格的 14 號（大字）、註記列（器材、記一句、二返註記）的 9 號小灰字的「9」都蓋掉了 ——
   程式本來想讓名字大一點、註記小一點，畫出來沒有。這一輪批次化照現在的樣子畫（一個像素都不變）。建議：問她要不要讓名字變大、註記變小（改的話 `LAYOUT_VERSION` 再加一，每一頁重畫一次）

### 段一（02～04）做的時候

2. **這個 worktree 裡 `npm test` 有 1 支跳過**：`tests/no-secrets.test.js` 的別名表那一條（worktree 底下沒有 `.local/`）。不是這一輪弄的、CI 上也是跳過。
   段一推之前另外把三個 commit 的 diff 與 commit 訊息整份過一次 `redact.mjs`：被遮的只有數字串與 `.gs` 註解裡本來就有的 `高能/sis`，沒有名字。
   建議：段二開 PR 前在主資料夾（有 `.local/`）跑一次 `node --test tests/no-secrets.test.js`，或照樣過一次過濾網
3. （不用她決定）`LAYOUT_VERSION` 2：新的 `.gs` 部署後第一次推送每一頁都重畫一次（約 1,500 次寫，照比例估一分鐘內）—— 是預期的，她比秒數時要拿**第二次以後**的平常推來比

## 段一的開場（已用掉）

這一輪：讓試算表推送變快（Apps Script `.gs` 批次讀寫，畫出來一模一樣），並讓兩台同時推時比較舊的那一包不畫。分支 `claude/sheet-speed`（worktree `.claude/worktrees/sheet-push-gaps-112028`），上一段做到 `2d61b660`（issue 02～04 與量的工具）。

**做** 02 → 03 → 04，照這個順序；一支一個 commit。**不做** Sheets API 進階服務、不改 `syncBundle()`／`customerReport()`／`ui/views/report.js`（一次性客人那一輪會動）。

先讀：
- `CLAUDE.md`（「試算表的 SYNC_FORMAT」那一列：指紋、`LAYOUT_VERSION`、`onEdit`）、`docs/agents/lessons.md`
- `.scratch/sheet-push-gaps/spec.md` 的「第二輪」、`HANDOFF.md` 的「第二輪（02～04）分段」「規矩」「中途發現」
- `.scratch/sheet-push-gaps/issues/02`、`03`、`04` 整支（每一支底下有「過目抓到的」）
- `docs/adr/0013`、`0161`；04 要寫 `docs/adr/0174`（並登記進 `docs/adr/README.md` 的索引）

規矩：
- 改已經存在、別處在用的程式碼之前照 `ripple-check` 查牽連；修完找同一個形狀的地方
- 中途發現的事不岔出去修：記進 HANDOFF「中途發現」（哪裡、什麼情境會錯、建議），繼續做原本的；段末一次列給主控
- subagent 同時最多兩個
- **不起模擬器、不跑 E2E、不停任何 port**（主資料夾另一輪在用；她的筆電會熱）。驗證：`npm test`；`.gs` 的行為只能在 `tests/helpers/appsScriptStub.js` 的替身裡驗，替身做不出來的寫進「只在 staging 驗得到」
- 讀 `.local` 一律接 `| node .local/references/redact.mjs`（在這個 worktree 裡 `.local` 是 `../../../.local`）；拿正式站那一包跑的結果只印數字
- 動 `public/` 的 commit 升 `public/sw.js` 的 VERSION（develop 上現在是 v281，從 v282 起）＋`npm run shell:snapshot`；**新增檔案先 `git add` 再跑快照與 `npm test`**
- 公開 repo：commit 訊息、檔案裡不帶真名

主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。

做完要交：每支一個 commit、`Status: done`、issue 底下「做完時留下的」（含 `scripts/sheet-gs-calls.mjs` 改前改後的數字）、`npm test` 全過、更新 HANDOFF（狀態、中途發現），把段二的開場寫進 HANDOFF（審查要特別看的：「這一行會不會讓畫出來的跟改前不一樣」「會不會讓比較新的那一包被當成舊的不畫」，要查牽連的：`render`、`renderCustomer`、`noteBlock`、`finish`、`doPost`、`buildBundle`、`pushedSay`）；推到 origin。最後回覆簡短說做了什麼、卡在哪。

## 段二的開場

這一輪：讓試算表推送變快（`.gs` 批次讀寫，畫出來一模一樣）＋兩台同時推時比較舊的那一包不畫（ADR-0174）。分支 `claude/sheet-speed`（worktree `.claude/worktrees/sheet-push-gaps-112028`），
段一做完 02、03、04，最新 `854bd266`、已推到 origin。這一段：**審查 → 照建議修 → 開 PR 進 develop → CI 綠就合 → 寫她要照順序做的事**。建議 effort：**xhigh**。

先讀：
- `CLAUDE.md`（「試算表的 SYNC_FORMAT」那一列，段一補了一段）、`docs/agents/lessons.md`
- `.scratch/sheet-push-gaps/HANDOFF.md`（「量的工具」「規矩」「中途發現」）、`spec.md` 的「第二輪」
- `.scratch/sheet-push-gaps/issues/02`、`03`、`04` 整支 —— 每一支的「做完時留下的」寫了做法、跟 issue 寫的不一樣的地方、只在 staging 驗得到的
- `docs/adr/0174-older-sheet-bundle-is-not-drawn.md`、`0161`、`0013`

做：
1. `/matt-code-review`，起點 `5050997e`（段一開始之前）。**審查要特別看**：
   - 「這一行會不會讓畫出來的跟改前不一樣？」—— `Canvas`／`paint()`／`rectsByValue()`／`mergeAll()`：格式只記最後一次、沒設過的格子不碰、值先寫再合併、凍結最後；
     `getLastRow()` 照 Google 的算法（替身也改成不算 `''`）。比法：`tests/sheet-gs-batch.test.js` 的雜湊（改前的 `.gs` 跑出來的）、`scripts/sheet-gs-compare.mjs` 跑正式站那一包（只印數字）
   - 「會不會讓比較新的那一包被當成舊的不畫？」—— `dataAtOf()`、`isStaleBundle()`、`buildBundle()` 先讀稽核再讀資料、`doPost()` 拿到鎖之後才比、畫完才記、沒帶時間照畫
   - 先讀完再寫那一套（`readBook()`、`sizeOf()`、`protectionsOf()`、`emptyOf()`）：**整頁空著的分頁照舊算我們的**、她自己的同名分頁照舊跳過、畫到一半逾時那一頁的指紋照舊不在、
     `_data` 的鎖對了才不重上、`forgetStale()` 不用 `setProperties(…, true)`（`onEdit` 同時拿掉的指紋會被救回來）
   - 要查牽連的：`render`、`renderCustomer`（測試會單獨包它、少傳 `book`）、`noteBlock`、`finish`、`doPost`、`buildBundle`（只有 `run()` 叫，回傳改成 `{ bundle, dataAt }`）、`pushedSay`（`ui/views/report.js` 一行沒動）
   - 替身改了什麼（`tests/helpers/appsScriptStub.js`）：會不會讓既有的測試變得比 Google 寬鬆（`getLastRow`、`removeEditors` 真的拿掉人、`Protection.remove()` 只拿掉自己）
2. 照建議修（範圍內、小的順手修；要她決定的段末一次問）。動 `public/` 要再升 `sw.js` VERSION（現在 v282）＋`npm run shell:snapshot`
3. 開 PR 進 **develop**（rebase 到 origin/develop，`sw.js` 那一行留大的再加一）。PR 內文與 commit 不帶真名；推之前在主資料夾跑一次 `node --test tests/no-secrets.test.js`
   （這個 worktree 沒有 `.local/`，那一條會跳過 —— HANDOFF「中途發現」2）。CI 綠就合（不用再問）。E2E 交給 CI，**本機不跑 E2E、不起模擬器、不停 port**
4. 寫她要照順序做的事（白話、一步一步）：**貼新的 `.gs` 到 staging 的試算表 → 重新部署（同一個網址）→ 第一次推送會每一頁重畫（`LAYOUT_VERSION` 2，正常）→
   之後在 app 改一筆、看 Apps Script「執行作業」那一頁平常推與「整份重畫」各幾秒，跟改前（平常推 25–48 秒、整份重畫約 192 秒）比** → 夠快再貼正式版；
   不夠快再談 Sheets API 進階服務。另外列出「只在 staging 驗得到」的那幾件（02、03、04 的「做完時留下的」最後一段）
5. 段末一次問她：HANDOFF「中途發現」1（名字大字、註記小字現在都被蓋成 11 號，要不要改）

規矩：讀 `.local` 一律接 `| node ../../../.local/references/redact.mjs`、正式站那一包的結果只印數字；subagent 同時最多兩個；中途發現記進 HANDOFF 不岔出去修。

做完：PR 合進 develop、HANDOFF 狀態更新、她的步驟寫在 HANDOFF 與回覆裡；回覆簡短說做了什麼、卡在哪。
