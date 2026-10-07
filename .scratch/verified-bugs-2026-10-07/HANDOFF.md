# 交接檔：2026-10-07 驗證過的問題清單那一輪

先讀 `CLAUDE.md` → 這一份 → `spec.md` → 要看的那一支 issue。每一支 issue 的「審查之後」那一段會改掉前面「要做的」的部分作法，**以後寫的為準**；
做了什麼寫在每一支的「做完時留下的」。

## 狀態：18 支都 done，三支 PR 都開了、都審過、照審查修過

| 分支 | PR | 收哪幾支 | `sw.js` |
|---|---|---|---|
| `claude/verified-bugs-1-rules-2026-10-07` | #144 | 01–07 | v183 |
| `claude/verified-bugs-2-words-2026-10-07` | #145 | 08–17 | v184 |
| `claude/verified-bugs-3-health-2026-10-07` | #146 | 18 | v185 |

**照 1 → 2 → 3 合**（疊著開，基底都是 `develop`；先合上層的話上層會合進一個沒人看的分支）。合之前後兩支 PR 的 diff 會包含下面那幾支的 commit。

編號用到：ADR 0136、E2E spec 60。

## 每一支的審查之後改了什麼（commit 訊息裡也有）

- #144：進度追蹤走 `isLiveSlot()`、營養品「額度名稱不可空白」不先講（判斷搬回 `validateEntitlement()`）、取消框抬頭走 `slotLabelFor()`、
  拍 Abovee「改成 Abovee 的」那一段叫「這一段」再篩（同時間同名兩段不再互拿提醒）、「A 跟 B 時間重疊」兩邊留空格。
- #145：抽屜送出途中按返回不再靜默失敗（先把 `drawer` 拿在手上）、`leaveFor()` 沒被拿走就在下一次換頁丟掉、
  取消框「那一天剩下的」走 `sameDayState()`、稽核補四個欄位名、W8 多量 393 寬。
- #146：同一位客戶照 `whoId` 收成一列、結論那一塊分紅黃綠、`healthBadge()` 刪掉、卡片那一句進 `fewer-words` 棘輪、`03` 的 H4 真的觸發超用。

## 審查提過、沒有改的（理由）

- 客戶詳情「看全部 N 天」數的是來訪文件：那一天已完成之後再加的段會是第二筆（ADR-0083），N 會多 1。很少見，列的那一頁也是一筆一列。
- 換到不是擇一池、但課程要選器材的舊額度時，器材會被清掉要重選（`equipmentAfterSwitch()` 對非擇一池回 null）。照 issue 02 寫的做；那種額度在她的資料上沒看到。
- 03 的 E2E 只蓋客戶詳情那一個入口（三個入口共用 `commitNewProduct()`，單元測試蓋那一支）。
- 12 沒有「抽屜開著時點底部導覽列換頁」的 E2E（換頁時 `render()` 走 `closeDrawer()`，那時那一層已經不 active）。
- `.flag--alert` 現在全站都會換行（壓表卡片牆上也是）：只有名字很長的警示才會變兩行，沒另外量。

## 本機留著的

- worktree `../wt-rules`（第一支）、`../wt-health`（第三支），`node_modules` 是 junction 到主目錄。PR 合完 `git worktree remove` 就好。
- 模擬器最後是從 `../wt-health` 起的 —— 換目錄跑 E2E 之前先依 port 停掉。

## 這一輪學到、要記得的

- `--related` 的 E2E 一跑就是二三十支，她的電腦會燙。每一支只跑自己那支 spec（`node scripts/e2e.mjs 59`），全量丟 CI。
  `-g` 裡**不要放 `|`**（Windows 上那一條走 cmd，會被當成管線）—— 用 `-g "W[89]"` 這種字元集。
- 量「整頁會不會左右滑」要量 `.app__main`，`document.documentElement` 永遠是 false。
- `masterDocs()` 把種子上停用的點滴8、VIP7 寫成啟用的 —— 要「資料健檢全部沒事」的測試要自己改回停用。
- PowerShell 5.1 的 `Get-Content`／`Set-Content` 會把 UTF-8 中文讀壞（`sw.js` 被整個改爛過一次）：改檔一律用 Edit 或 python（`newline=''`）。
- bash heredoc 裡的 python 字串，反斜線會被吃掉（`\n`、regex）—— 有反斜線的一律用 Write 寫成檔案再跑，或直接用 Edit。
