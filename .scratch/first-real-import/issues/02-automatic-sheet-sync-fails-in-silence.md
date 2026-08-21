# 自動推送失敗一個字都不說

Status: done
回報者：使用者，2026-08-21
動工前先讀：`data/sheetSync.js`、`ui/views/report.js` 的 `syncCard()` 與 `pushNow()`、
`docs/adr/0013-sheet-sync-is-a-push-not-a-pull.md`

## 症狀

`issues/01` 那個例外從第一次推送就在發生，但她完全不知道 ——
匯入成功的 toast 照樣跳出來，試算表上有一張表，看起來像是「成功了但資料怪怪的」。

她**唯一**發現的方法是手動按「立刻推一次」，因為只有那條路會把錯誤顯示出來。

## 為什麼

`data/sheetSync.js` 的 `schedule()`：

```js
timer = setTimeout(() => { push().catch(() => {}); }, QUIET_MS);
```

`push()` 失敗時**不會 throw**，它回的是 `{ ok: false, error: '…' }`。
而這裡沒有人讀那個回傳值，`.catch(() => {})` 只吃得到 throw。
所以密鑰錯了、格式版本不對、`.gs` 丟例外、網路斷了 —— 畫面上完全一樣。

ADR-0013 說「同步失敗永遠不會讓寫入看起來失敗」，那是對的，不要推翻。
**但「不要讓寫入看起來失敗」不等於「什麼都不要說」。**
資料在 Firestore 裡是安全的，可是**報表是錯的，而她會拿報表去對帳。**

### 第二個洞：`.gs` 講了，app 不轉述

`sheets/readonly-report.gs` 的 `doPost()` 回的是：

```js
{ ok: true, sheets: result.sheets, skipped: result.skipped }
```

`skipped` 是「這幾位客戶的分頁我認不出來，不敢清空，所以沒更新」
（`resetSheet()` 的守衛，見 `.scratch/visit-lifecycle/issues/05`）。
那條守衛做出來就是為了講話的。但 `data/sheetSync.js` 的 `run()` 回：

```js
return { ok: true, at, sheets: reply.sheets ?? null };
```

**`skipped` 整個掉在地上。** UI 也沒有地方顯示它。
所以「推好了，更新了 19 張分頁」和「推好了，更新了 19 張，另外 2 位沒動」
在畫面上長得一模一樣 —— 而後者代表那兩位的次數是舊的。

## 想要的樣子

不要跳彈窗打斷她（自動推送是背景的事），但**狀態要看得出來，而且點得進去看原因**。

具體三件事：

1. **`schedule()` 要收下 `push()` 的結果**，失敗時把 `error` 存起來
   （跟 `LAST_KEY` / `DIRTY_KEY` 一樣放 localStorage 就好，不需要進 Firestore）。
2. **`#/settings/report` 的「自動同步」那張卡要顯示上一次的失敗原因。**
   現在那張卡已經會說「有資料還沒推上去」，但那句話講的是「還沒推」，
   不是「推了但被拒絕」—— 這兩件事的處理方式完全不同。
3. **`skipped` 要一路帶回來並顯示。** `run()` 的回傳加 `skipped`，
   `pushNow()` 的成功訊息與那張卡都要講出來。

### 要決定的一件事

**失敗要不要在首頁出聲。** 傾向不要 —— 首頁是待辦中心，那裡只放「她要做的事」，
而推不出去大多不是她能處理的。但如果**連續失敗超過一段時間**（例如一整天），
那就變成她該知道的事了。這一支先做設定頁那三件，首頁那條另外想。

## 不要順手做的事

- **不要改成失敗就跳 toast。** 自動推送是每次存檔後十秒觸發的，
  網路差的時候她會被 toast 洗版，然後學會忽略它 —— 那比不說還糟。
- **不要因為推不出去就擋下寫入或回滾。** ADR-0013 的那句話還是對的。


## Comments

**2026-08-21 — 做完了。** `npm test` 從 699 變成 705 全過。

三件事都做了，另外多做了一件（下面「做了 issue 上沒寫的事」那一段）。

| 在哪裡 | 做什麼 |
|---|---|
| `data/sheetSync.js` | 多兩個 localStorage 的鍵：`sheetSync.lastError`（`{ at, error }`）與 `sheetSync.lastSkipped`（`{ at, names }`）。失敗一律走新的 `noteFailure()`，成功時把 `lastError` 清掉、把 `.gs` 回的 `skipped` 存起來 |
| 同上 | `run()` 的回傳補上 `skipped`（陣列）。原本「還沒設定」那條回的也叫 `skipped`，但它是一句話不是清單，改名成 `off` + `error`，兩個東西不要共用一個欄位名 |
| 同上 | `schedule()` 的 `.catch(() => {})` 換成 `.catch((err) => noteFailure(…))`。痕跡留在 `run()` 裡而不是 `schedule()` 裡 —— 手動按「立刻推一次」走的是同一支，兩條路要留下同一份紀錄 |
| `domain/sheetReport.js` | 新的 `describeSync()`：那張卡現在該說哪幾句 |
| `ui/views/report.js` | `syncCard()` 讀 `describeSync()`；`pushNow()` 成功但有 `skipped` 時走 `toast.failed` 而不是 `toast.info` |
| `tests/sheet-report.test.js` | 六條，盯著「還沒推」與「推了被拒絕」不可以講成同一句 |

### 為什麼那句話抽成純函式

`data/sheetSync.js` 在 node 裡跑不起來（它一路 import 到 firebase 的 CDN 網址），
所以那一層寫什麼都測不到。而這一支真正壞掉的東西是**一句話講反了**：
「有資料還沒推上去」講的是「還沒推」，不是「推了但被拒絕」。
那條規則放進 `domain/sheetReport.js` 之後測得到，六條測試盯著它。

時間一律由 `ui/views/report.js` 格式化好再傳進去 —— `toLocaleString()` 跟著裝置的
時區與語系走，寫在純函式裡等於寫了一個在別台機器上會變的東西。

### 做了 issue 上沒寫的事

`describeSync()` 多回一個 `tone`（`off` / `ok` / `waiting` / `partial` / `failed`），
其中 **`partial` 是「推成功了，但有幾張沒更新」**。issue 只說 `skipped` 要顯示出來，
沒說它算不算「有問題」。做成獨立的一種是因為那兩件事在她那裡的後果不一樣：
`failed` 是整份報表都是舊的，`partial` 是**那幾位**的次數是舊的。
畫面上都會標成「有問題」，但講的句子不同。

### 沒有做的

- **首頁不出聲。** issue 裡「要決定的一件事」那段本來就寫著這一支先不做，
  連續失敗超過一天要不要浮到待辦中心，另外想。
  **2026-08-21 使用者確認照這樣做**，沒有另外開票 —— 等她實際用到「推不出去而
  我一整天沒發現」的時候再談，現在就開等於替一個還沒發生的問題設計。
- **沒有加 `data/` 那層的測試。** 這個 repo 目前一支都沒有（firebase SDK 是從
  CDN import 的，node 解析不了那個 URL）。要補的話得先給 `data/` 一個
  import map 或 stub loader，那是另一件事。

### 還沒驗證的

`.gs` 一個字都沒改，所以**不用重新部署**。但要看到這一支的效果，得先照
`issues/01` 的 Comments 把 `sheets/readonly-report.gs` 重新貼進 Apps Script 部署 ——
在那之前每一次推送都還是會被同一個例外擋下來，只是現在**畫面上會講出來**：
`#/settings/report` 的「自動同步」卡會顯示「上次推送被拒絕（時間）：<Google 的原文>」。

驗證方式（不用等真的壞掉）：把密鑰故意改錯一個字 → 存檔 → 等十秒 →
重新整理 `#/settings/report`，那張卡應該說「被拒絕：密鑰不對」。
改回來再按「立刻推一次」，那一句要消失。
