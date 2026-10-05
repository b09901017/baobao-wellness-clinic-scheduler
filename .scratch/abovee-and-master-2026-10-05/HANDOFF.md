# 交接：這一輪做到哪、下一個 session 從哪裡接

（每一個接手的 session 做完一段就回來改這一份。）

## 現況（2026-10-05 晚）

- **第一、二段做完**：她答完全部的題（`spec.md` 底下兩段「她回的」）、14＋1 支 issue 開好、subagent 審查過、審查結果改進各支 issue 的「審查之後補的」那一節（**跟上面衝突的以那一節為準**）
- **01 做完**：PR #137（`claude/staging-real-data` → `develop`），CI 結果要看一眼；staging 已經清空（661 筆），等她貼合併檔。**合不合 #137 先問她**
- **02–15 都還沒動**。主分支 `claude/abovee-master-2026-10-05` 從 `origin/develop`（`6351f36`）開，上面只有 `.scratch` 這一份（`bc34a87`、`b261138`）

## 下一個 session 做什麼

照順序一支一個 commit（kickoff skill 第三段）：

```
02 分類 → 03 系統 → 04 醫師 → 05 不算次數 → 06 約時選時長      ← 第一個 session（設定與 domain）
07 辨識 → 08 換人與要做什麼 → 09 合併扣課 → 10 時間不同 → 11 改成 Abovee 的   ← 第二個 session（拍 Abovee）
12 主檔補齊 → 13 合併檔的功醫門診 → 15 試算表的記一句 → 14 文件總對   ← 第三個 session，做完開 PR、跑 /matt-code-review
```

每一支動工前：讀那一支 issue（含「審查之後補的」）＋它的「動工前先讀」。紅燈 → 綠 → 驗 → commit → `Status: done` ＋「做完時留下的」。

## 一定要記得的

- **只跑單元測試＋相關的 E2E**，不要全跑 E2E（她的電腦會過熱關機）。`npm run verify` 會因為 `seed.js`、新檔沒登記在 `tests-e2e/related.js` 而退回全跑 —— **02 第一件事就是登記**（見 02「審查之後補的」）；登記之前先用 `node scripts/e2e.mjs --related --dry` 看會跑幾支
- `sw.js` VERSION：develop 是 v143、#137 是 v144，**這一支從 v145 起**
- 真名：Abovee 上治療師與醫師的全名不進 repo。commit 之前跑一次 `node .local/references/staff-scan.mjs`（在分支的目錄裡跑；拿 `.local/references/圖片辨識參考/服務資源.md` 的名單掃這一支相對 `origin/develop` 改了的檔案與 commit 訊息，只印檔名行號不印名字）；`tests/no-secrets.test.js` 要 0 skipped（主目錄有 `.local/`；worktree 裡要接一個 `.local` 的 junction，`git check-ignore -v` 確認被擋）
- Bash 工具會吃掉一個反斜線：Python heredoc 裡有 `\n`、續行 `\` 的，改用 Write 寫檔再跑，或用 Edit
- ADR 號：0118 已用（#137）；0119 系統、0120 醫師、0121 不算次數、0122 約時選時長、0123 拍 Abovee、0124 治7
- 她說「有問題一樣問」：照 issue 做不下去、或要推翻 issue 裡寫的決定時問她，一次問完、附建議
