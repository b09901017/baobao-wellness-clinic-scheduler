# 07 用 Google Sheets API 一次讀完每一頁（沒開就照舊）

Status: done
Blocked by: 06（同一支 `.gs`、同一段讀）

## 她要的

> 好（同 06）。我不介意多按一個設定（11/5 下午）

## 為什麼會這樣

平常推 16.5 秒裡「讀」8.4 秒：`readBook()` 35 頁各叫一次 `getName()` 與 `getRange(1,1).getValue()`，一次約 0.24 秒。
SpreadsheetApp 跨分頁沒有一次讀完的方法；Sheets API 有。

## 做法

- `readBookViaApi()`：`Sheets.Spreadsheets.get`（`fields` 只拿名字、藏起來了沒、大小、整頁的鎖與誰能改）＋`Sheets.Spreadsheets.Values.batchGet`（每一頁的 `'名字'!A1`，名字裡的單引號寫兩次）
- **沒開服務（`Sheets` 不存在）、丟錯、頁數對不上 → 照舊一頁一頁讀**（推送照樣成功，只是慢）
- 大小（`sizeOf()`）、藏起來了沒、鎖（`keepsLock()`、`lockState()`、`protectionsOf()`：API 說一道都沒有就不問）都從那一份拿
- 「認不認得是 app 畫的」那個檢查照留（ADR-0161 第 3 點），只是 35 次變 1 次

## 判準

- 開了 API 畫出來跟沒開一模一樣嗎？API 丟錯時退回逐頁讀、結果一樣嗎？
- 都沒變的那一次：API 只叫兩次、不再逐頁 `getValue`／`getName`／`isSheetHidden` 嗎？
- 整份重畫：不再逐頁 `getMaxRows`／`getMaxColumns`／`getProtections` 嗎？
- 她自己的分頁名字有單引號（`她's 筆記`）時讀得到嗎？

## 做完時留下的

- 替身多一個假的 `Sheets`（`loadAppsScript({ sheetsApi: 'on' | 'throw' | 'off' })`、`app.apiCalls`）、`ss.getId()`；`scripts/sheet-gs-compare.mjs` 多 `--api`
- 跟 develop 比（新的開 API）：正式站那一包四步一模一樣
- **她要做**：Apps Script 左邊「服務」→ ＋ →「Google Sheets API」→ 新增（staging 與正式各一次）；然後照常貼 `.gs`、部署新版本
- 只在 staging 驗得到：真的 API 的回傳（`fields` 寫法、`hidden` 只在藏起來時才有、空的 A1 不回 `values`）跟替身一樣嗎；真的省多少（「讀」那一格）
