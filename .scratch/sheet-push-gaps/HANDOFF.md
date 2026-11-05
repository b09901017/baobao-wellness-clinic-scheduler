# 試算表推送的縫：交接

分支 `claude/sheet-push-gaps`，在 worktree `.claude/worktrees/sheet-push-gaps-112028`（平行的一輪：主資料夾在做第一輪小修，
一次性客人在 `claude/one-time-visit-design` —— 都不碰）。小，不分段，這個 session 做完。

## 狀態

| issue | 狀態 |
|---|---|
| 01 推失敗自己再推、回到 app／網路回來／打開 app 補推 | done（PR #201，develop `2267a8bc`） |
| 02 平常推變快：先讀完再寫 | todo |
| 03 重畫變快：同一種動作收成一次 | todo |
| 04 兩台同時推：比較舊的那一包不畫（ADR-0174） | todo |

常見問題「刪整列、還原版本 → 整份重畫」：PR #202，develop `3dd2ee12`。

## 第二輪（02～04）分段

分支 `claude/sheet-speed`（從 origin/develop `3dd2ee12`），同一個 worktree。

| 段 | 做 | effort | 狀態 |
|---|---|---|---|
| 段一 | 02 → 03 → 04 | high | 還沒開 |
| 段二 | `/matt-code-review` 審 02～04、照建議修、開 PR、CI 綠合進 develop、寫她要照順序做的「貼 .gs 到 staging → 看執行紀錄比秒數」 | xhigh | 還沒開 |

之後（不在這一輪的段裡）：她把新的 `.gs` 貼到 staging 的試算表、重新部署 → 比 Apps Script 執行紀錄改前改後的秒數 → 夠快就貼正式版；
不夠快再談「Google Sheets API 進階服務」（她說多按一個設定沒關係）。

### 量的工具

`node scripts/sheet-gs-calls.mjs <整包.json>`：用測試的替身數一次推送讀幾次、寫幾次、寫完又馬上讀幾次（只印數字）。
正式站 11/5 那一包在主資料夾的 `.local/references/試算表健檢-2026-11-05/bundle-pushed.json`（在這個 worktree 裡是 `../../../.local/...`；**有真名，結果只印數字**）。
改前（develop `3dd2ee12`）：都沒變 讀 143／寫 46／寫完又讀 38；整份重畫 讀 619／寫 6,506／寫完又讀 276。

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

（沒有）

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

## 段一的開場

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
