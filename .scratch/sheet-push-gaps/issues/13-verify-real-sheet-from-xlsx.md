# 13 用匯出的 .xlsx 驗真的 Google 畫得對不對（工具）

Status: todo
Blocked by: 08～12（拿新的畫法驗）

## 為什麼要

替身（`tests/helpers/appsScriptStub.js`）終究不是 Google。11/5 主控用她匯出的試算表驗了兩次（正式站早上那一份、staging 下午那一份）：
試算表裡藏著的 `_data` 分頁就是那一次推過去的原始整包 —— 拿它餵給 `.gs`（替身）畫一次，跟匯出檔逐格比（值、底色、字級），
不一樣的就是「真的 Google 跟替身不一樣」或「推過去之後被人動過」。那兩次的腳本在主控 session 的暫存區，沒進 repo；這一支把它做成 `scripts/` 底下的工具，第三輪改完版面拿來驗。

## 做法

- `scripts/sheet-xlsx-verify.mjs <匯出的.xlsx>`：
  1. 讀 xlsx：這台有 python ＋ openpyxl（`python -I`），node 沒有 xlsx 套件 —— 用一支小 python 把每一張分頁的值、底色、字級、合併、凍結、備註倒成 JSON（放在 `scripts/` 旁邊、或 `scripts/lib/`）
  2. `_data` 的 A2 起接回整包（`stashRawData()` 切 45000 字一格）
  3. 用替身跑一次現在的 `.gs`（`loadAppsScript()` ＋ `post({ bundle })`）→ `snapshotOf()`
  4. 逐頁逐格比，**只印數字**（哪一種不一樣、幾格）；有真名的細節寫進 `.local/references/`（參數或預設路徑）
- 已知會不一樣、要先處理掉才比得準的：Google 把 `2026-10-20` 這種字自己認成日期（08 寫成文字之後就不會了）；替身時鐘固定在 0 → `_data` 的 B1（計時）跳過；產生時間那一格跳過
- 讀 `.local` 一律接 `| node .local/references/redact.mjs`

## 判準

- 拿 staging 那一份（第三輪貼上去、整份重畫之後她匯出的）跑：每一頁每一格都一樣嗎？不一樣的有沒有一條一條講得出原因？
- 工具本身有一支小測試嗎？（假的 xlsx 倒出來的 JSON → 跟替身比 → 0 個不一樣；故意改一格 → 1 個不一樣）

## 做完時留下的

（做完填）
