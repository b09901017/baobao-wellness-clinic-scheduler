# 01 推失敗自己再推；回到 app、網路回來、打開 app 都補推

Status: done
Blocked by: —

## 動工前先讀

- `.scratch/sheet-push-gaps/spec.md`、`FINDINGS.md`
- `CLAUDE.md`「試算表要讀哪些來訪」（讀到快取這一趟不推）、ADR-0013、ADR-0161 最後一節
- `public/js/data/sheetSync.js` 整支、`public/js/app.js` 的 `confirmed()`（`sheetSync.wire()` 只叫一次）
- E2E `45-sheet-push-race`（`page.route()` 頂替 Apps Script、測試自己叫 `push()` 的做法）

## 她要的

> 照建議修

（建議的原文在 spec.md。）

## 為什麼會這樣

- ① `run()` 失敗只 `noteFailure()`（立待推標記、記原因），沒有任何計時器；只有 `schedule()`（每次寫入）與 `wire()`（開機、`isDirty()` 才推）會再推。
- ② `schedule()` 是 10 秒的 `setTimeout`。手機鎖屏時網頁被暫停：計時器要等回到 app；推到一半被打斷的落到 ①。
- ③ `wire()` 在 `app.js` 的 `confirmed()` 才叫：之前那一兩秒的寫入沒有 `onCommitted` 聽眾，也不立待推標記。
- ⑤ `repo.commit()` 在 `await batch.commit()` 之後才 `announceCommitted()`；離線時那個 promise 不回來，app 關掉就永遠沒有人立待推標記。
- ④ 被拒那一半：`.gs` 的 `tryLock(30000)` 等不到 → 回「另一份同步還在進行中」→ 落到 ①（一次推要 25–48 秒）。

## 做法（談定的）

1. **失敗後退避重試**：1 分、5 分、15 分各一次，之後停，等下一次寫入／回到 app／網路回來／打開 app。成功或有新的寫入就從頭算。
   `off`（沒設定）不重試。
2. **回到 app**（`visibilitychange` → visible）與**網路回來**（`online`）：有待推標記就在 10 秒內推（已經排了更早的就不動）。
3. **打開 app**：`wire()` 不管有沒有待推標記，10 秒後推一次（③⑤ 都靠它：推的那一刻讀的是全部，早到的那一筆一定在裡面）。
4. 重試、喚醒**不加 `version`**（`version` 只記寫入，`run()` 靠它判斷能不能清待推標記）。
5. 「什麼時候推」的計算抽成一支純模組（node 測得到；`sheetSync.js` 一路 import 到 firebase 的 CDN 網址，node 跑不起來）。

## 判準

- 推失敗之後，她什麼都不做，會不會一直停在舊的？（不會：1／5／15 分各試一次）
- 一直失敗（密鑰錯、`.gs` 太舊）時，會不會無限重試、洗 Apps Script 的執行紀錄？（不會：三次就停）
- 重試或喚醒會不會讓「打包之後又有寫入」的判斷錯掉、提早清掉待推標記？（不會：不動 `version`）
- 回到 app 一直切來切去，會不會把已經排好的那一次一直往後延？（不會：已經排了更早的就不動）
- 一般的寫入照舊是「安靜 10 秒才推」嗎？（`schedule()` 每次重設 10 秒，不變）
- 沒設定試算表的人，打開 app 會不會多讀一整份資料？（不會：`run()` 先問 `isConfigured()`）

## 做完時留下的

- 規則在 `public/js/domain/sheetPushTiming.js`（純的）：`RETRY_MS`／`retryDelay()`（1／5／15 分，之後 null）、`wantsRetry()`（`off` 不算）、
  `keepsPending()`（排著的那一次比這一次早就不動）。`tests/sheet-push-retry.test.js` 釘規則，並掃 `sheetSync.js` 的接線
- `sheetSync.js`：計時器一律走 `arm(ms)`（記 `dueAt`）；`schedule()` 照舊每次重設 10 秒、`version += 1`、失敗次數歸零；
  `kick(ms)` 給重試與喚醒用（不動 `version`、不立待推標記）；`push()` 每一趟跑完 `afterRun()`（設定頁「立刻推一次」失敗也會排重試；
  丟例外的那一條也算失敗）；`wire()` 打開 app 一律 `kick()`，**離線時改等 `online`**（`bootPending`，過目抓到：不然開機那一次讀到快取、
  留一句「上次沒推」而她什麼都沒寫），`online` 與 `visibilitychange`→visible 有待推就 `kick()`
- `app.js` 只改註解（確認之前那一兩秒的寫入由開機那一次補上）
- E2E：`45` 的 P1 先等開機那一次推完、扣第二包；新增 P2（打開 app 沒寫也推、失敗後回到 app 10 秒內再推）、P3（網路回來再推）。
  `78` 的 S1／S2 先等開機那一次推完再數。1 分鐘的重試 E2E 等不了，交給單元測試
- `docs/常見問題.md`「試算表沒有更新」補了要等多久、第 3 列的產生時間怎麼看、不小心改到怎麼辦、設定頁只講這一台
- 本機沒跑 E2E（主資料夾那一輪佔著模擬器的 port）：交給 GitHub 上的 `e2e-full`
