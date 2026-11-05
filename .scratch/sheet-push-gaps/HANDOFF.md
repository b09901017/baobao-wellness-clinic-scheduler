# 試算表推送的縫：交接

分支 `claude/sheet-push-gaps`，在 worktree `.claude/worktrees/sheet-push-gaps-112028`（平行的一輪：主資料夾在做第一輪小修，
一次性客人在 `claude/one-time-visit-design` —— 都不碰）。小，不分段，這個 session 做完。

## 狀態

| issue | 狀態 |
|---|---|
| 01 推失敗自己再推、回到 app／網路回來／打開 app 補推 | done |

## 規矩

- 不起模擬器、不跑 E2E、不停 port（主資料夾那一輪在用；她的筆電會熱）。單元測試可以；E2E 交給 PR 的 CI
- 動 `public/` 的 commit 升 `sw.js` 的 VERSION（從 v280 起）＋`npm run shell:snapshot`；開 PR 前 rebase 到 origin/develop，那一行留大的再加一
- 一次性客人那一輪 issue 04 改 `sheetReport.js` 的 `syncBundle()`／`customerReport()` 與 `ui/views/report.js`：這一輪不碰；非碰不可寫在這裡
- ADR 號碼用 0174（要寫的話）

## 她已經決定的

- 11/5「照建議修」：①②③⑤＋④被拒那一半（spec.md）
- 11/5「照建議先觀察」：④ 另一半（兩台同時推，舊的那一份蓋掉新的）不修。真的遇到了，下一次推送會補上；要修的話等下次反正要重貼 `.gs` 時一起做（`.gs` 記每一包的新舊、舊的不畫）
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

（還沒有）
