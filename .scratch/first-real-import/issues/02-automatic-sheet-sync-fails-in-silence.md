# 自動推送失敗一個字都不說

Status: 待動工
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
